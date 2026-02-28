import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import type { Track } from '../types';
import { getAudioUrl } from '../api';

interface AudioPlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

interface AudioPlayerActions {
  play: (track: Track) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  playNext: () => void;
  playPrev: () => void;
}

interface AudioPlayerContextType extends AudioPlayerState, AudioPlayerActions {
  setPlaylist: (tracks: Track[]) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null);

export function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  return ctx;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(100);
  const [playlist, setPlaylist] = useState<Track[]>([]);

  // Create audio element + Web Audio API gain node once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    // Keep HTMLAudioElement volume at max — gain node controls actual volume
    audio.volume = 1.0;
    audioRef.current = audio;

    // Set up Web Audio API for >100% amplification
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = 1.0; // 100%
    source.connect(gain);
    gain.connect(ctx.destination);
    audioCtxRef.current = ctx;
    sourceRef.current = source;
    gainRef.current = gain;

    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('durationchange', () => setDuration(audio.duration));
    audio.addEventListener('ended', () => setIsPlaying(false));
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));

    return () => {
      audio.pause();
      audio.src = '';
      ctx.close();
    };
  }, []);

  const play = useCallback((track: Track) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Resume AudioContext if suspended (browser autoplay policy)
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    audio.src = getAudioUrl(track.id);
    const vol = track.volume ?? volume;
    // Use GainNode for volume — supports 0-200% (gain 0.0-2.0)
    if (gainRef.current) {
      gainRef.current.gain.value = vol / 100;
    }
    setVolumeState(vol);
    setCurrentTrack(track);

    // If track has startTimeSec, seek to it
    if (track.startTimeSec) {
      audio.currentTime = track.startTimeSec;
    }

    audio.play().catch(err => console.error('Play failed:', err));
  }, [volume]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    audioRef.current?.play().catch(() => {});
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.src = '';
    setCurrentTrack(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.min(200, Math.max(0, vol));
    setVolumeState(clamped);
    // Use GainNode for volume — supports 0-200% (gain 0.0-2.0)
    if (gainRef.current) {
      gainRef.current.gain.value = clamped / 100;
    }
  }, []);

  // Handle endTimeSec
  useEffect(() => {
    if (!currentTrack?.endTimeSec || !isPlaying) return;
    if (currentTime >= currentTrack.endTimeSec) {
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  }, [currentTime, currentTrack, isPlaying]);

  const playNext = useCallback(() => {
    if (!currentTrack || playlist.length === 0) return;
    const readyTracks = playlist.filter(t => t.audioStatus === 'ready');
    const idx = readyTracks.findIndex(t => t.id === currentTrack.id);
    if (idx < readyTracks.length - 1) play(readyTracks[idx + 1]);
  }, [currentTrack, playlist, play]);

  const playPrev = useCallback(() => {
    if (!currentTrack || playlist.length === 0) return;
    const readyTracks = playlist.filter(t => t.audioStatus === 'ready');
    const idx = readyTracks.findIndex(t => t.id === currentTrack.id);
    if (idx > 0) play(readyTracks[idx - 1]);
  }, [currentTrack, playlist, play]);

  return (
    <AudioPlayerContext.Provider value={{
      currentTrack, isPlaying, currentTime, duration, volume,
      play, pause, resume, stop, seek, setVolume, setPlaylist, playNext, playPrev,
    }}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

// ---------- Bottom player bar ----------

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PlayerBar() {
  const {
    currentTrack, isPlaying, currentTime, duration, volume,
    pause, resume, stop, seek, setVolume, playNext, playPrev,
  } = useAudioPlayer();

  if (!currentTrack) return null;

  return (
    <div className="player-bar">
      <div className="player-track-info">
        <div className="player-title">{currentTrack.title}</div>
        <div className="player-artist">{currentTrack.artist}</div>
      </div>

      <div className="player-controls">
        <button className="btn-icon" onClick={playPrev} title="Previous">⏮</button>
        {isPlaying ? (
          <button className="btn-icon player-play-btn" onClick={pause} title="Pause">⏸</button>
        ) : (
          <button className="btn-icon player-play-btn" onClick={resume} title="Play">▶️</button>
        )}
        <button className="btn-icon" onClick={playNext} title="Next">⏭</button>
        <button className="btn-icon" onClick={stop} title="Stop">⏹</button>
      </div>

      <div className="player-progress">
        <span className="player-time">{formatTime(currentTime)}</span>
        <input
          type="range"
          className="player-seek"
          min={0}
          max={duration || 0}
          value={currentTime}
          onChange={e => seek(Number(e.target.value))}
        />
        <span className="player-time">{formatTime(duration)}</span>
      </div>

      <div className="player-volume">
        <span>{volume > 100 ? '🔊⚡' : volume > 0 ? '🔊' : '🔇'}</span>
        <input
          type="range"
          className="player-volume-slider"
          min={0}
          max={200}
          value={volume}
          onChange={e => setVolume(Number(e.target.value))}
          title={`${volume}%${volume > 100 ? ' (boosted — may clip)' : ''}`}
        />
        <span style={{ fontSize: '0.7rem', minWidth: 36, textAlign: 'right' }}>{volume}%</span>
      </div>
    </div>
  );
}
