import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Track, RadioStation } from '../types';
import { getPlaybackUrl, resolveRadioStream } from '../api';

export type LoopMode = 'off' | 'all' | 'one';

interface AudioPlayerState {
  currentTrack: Track | null;
  currentRadio: RadioStation | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  radioLoading: boolean;
  radioError: string | null;
  shuffle: boolean;
  loopMode: LoopMode;
}

interface AudioPlayerActions {
  play: (track: Track) => void;
  playRadio: (station: RadioStation) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  playNext: () => void;
  playPrev: () => void;
  /** Patch fields on currentTrack in-place (e.g. after video download completes). */
  updateCurrentTrack: (updates: Partial<Track>) => void;
  toggleShuffle: () => void;
  cycleLoopMode: () => void;
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
  const [currentRadio, setCurrentRadio] = useState<RadioStation | null>(null);
  const [radioLoading, setRadioLoading] = useState(false);
  const [radioError, setRadioError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(100);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [shuffle, setShuffle] = useState(false);
  const [loopMode, setLoopMode] = useState<LoopMode>('off');

  // Ref to hold auto-advance callback (updated when playlist/currentTrack change)
  const onEndedRef = useRef<() => void>(() => {});

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
    audio.addEventListener('ended', () => onEndedRef.current());
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

    audio.src = getPlaybackUrl(track);
    const vol = track.volume ?? volume;
    // Use GainNode for volume — supports 0-200% (gain 0.0-2.0)
    if (gainRef.current) {
      gainRef.current.gain.value = vol / 100;
    }
    setVolumeState(vol);
    setCurrentTrack(track);
    setCurrentRadio(null);

    // If track has startTimeSec, seek to it
    if (track.startTimeSec) {
      audio.currentTime = track.startTimeSec;
    }

    audio.play().catch(err => console.error('Play failed:', err));
  }, [volume]);

  const playRadio = useCallback(async (station: RadioStation) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Resume AudioContext if suspended (browser autoplay policy)
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    // Set radio state immediately for UI feedback
    setCurrentRadio(station);
    setCurrentTrack(null);
    setRadioLoading(true);
    setRadioError(null);

    try {
      // Resolve M3U/playlist URLs to actual stream URLs via server
      const resolved = await resolveRadioStream(station.id);
      if (resolved.error) {
        console.warn('Stream resolve warning:', resolved.error);
      }

      const streamUrl = resolved.streamUrl;

      // Set up error handler before setting src
      const errorHandler = () => {
        const mediaError = audio.error;
        let msg = 'Failed to load radio stream';
        if (mediaError) {
          switch (mediaError.code) {
            case MediaError.MEDIA_ERR_ABORTED: msg = 'Stream playback was aborted'; break;
            case MediaError.MEDIA_ERR_NETWORK: msg = 'Network error — check your connection'; break;
            case MediaError.MEDIA_ERR_DECODE: msg = 'Stream format not supported'; break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: msg = 'Stream URL not supported or unavailable'; break;
          }
        }
        setRadioError(msg);
        setRadioLoading(false);
        setIsPlaying(false);
      };

      const playingHandler = () => {
        setRadioLoading(false);
        setRadioError(null);
        // Clean up one-shot listeners
        audio.removeEventListener('error', errorHandler);
        audio.removeEventListener('playing', playingHandler);
      };

      audio.addEventListener('error', errorHandler, { once: true });
      audio.addEventListener('playing', playingHandler, { once: true });

      audio.src = streamUrl;
      // Reset to current volume for radio
      if (gainRef.current) {
        gainRef.current.gain.value = volume / 100;
      }

      await audio.play();
    } catch (err: any) {
      console.error('Radio play failed:', err);
      setRadioError(err?.message || 'Failed to play radio stream');
      setRadioLoading(false);
    }
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
    setCurrentRadio(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setRadioLoading(false);
    setRadioError(null);
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

  // Handle endTimeSec — stop at specified end time and auto-advance
  useEffect(() => {
    if (!currentTrack?.endTimeSec || !isPlaying) return;
    if (currentTime >= currentTrack.endTimeSec) {
      audioRef.current?.pause();
      // Trigger auto-advance as if track ended naturally
      onEndedRef.current();
    }
  }, [currentTime, currentTrack, isPlaying]);

  const playNext = useCallback(() => {
    if (!currentTrack || playlist.length === 0) return;
    const readyTracks = playlist.filter(t => t.audioStatus === 'ready');
    const idx = readyTracks.findIndex(t => t.id === currentTrack.id);
    if (shuffle) {
      // Pick a random track that isn't the current one
      const others = readyTracks.filter(t => t.id !== currentTrack.id);
      if (others.length > 0) play(others[Math.floor(Math.random() * others.length)]);
    } else if (idx < readyTracks.length - 1) {
      play(readyTracks[idx + 1]);
    } else if (loopMode === 'all' && readyTracks.length > 0) {
      play(readyTracks[0]);
    }
  }, [currentTrack, playlist, play, shuffle, loopMode]);

  const playPrev = useCallback(() => {
    if (!currentTrack || playlist.length === 0) return;
    const readyTracks = playlist.filter(t => t.audioStatus === 'ready');
    const idx = readyTracks.findIndex(t => t.id === currentTrack.id);
    if (idx > 0) play(readyTracks[idx - 1]);
    else if (loopMode === 'all' && readyTracks.length > 0) {
      play(readyTracks[readyTracks.length - 1]);
    }
  }, [currentTrack, playlist, play, loopMode]);

  /** Patch fields on currentTrack without restarting playback. */
  const updateCurrentTrack = useCallback((updates: Partial<Track>) => {
    setCurrentTrack(prev => prev ? { ...prev, ...updates } : null);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle(prev => !prev);
  }, []);

  const cycleLoopMode = useCallback(() => {
    setLoopMode(prev => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  }, []);

  // Auto-advance: when track ends, play next (respects loop + shuffle)
  useEffect(() => {
    onEndedRef.current = () => {
      const readyTracks = playlist.filter(t => t.audioStatus === 'ready');
      const idx = currentTrack ? readyTracks.findIndex(t => t.id === currentTrack.id) : -1;

      // Loop one: replay current track
      if (loopMode === 'one' && currentTrack) {
        play(currentTrack);
        return;
      }

      // Shuffle: pick random
      if (shuffle && readyTracks.length > 1) {
        const others = readyTracks.filter(t => t.id !== currentTrack?.id);
        if (others.length > 0) {
          play(others[Math.floor(Math.random() * others.length)]);
          return;
        }
      }

      if (idx >= 0 && idx < readyTracks.length - 1) {
        play(readyTracks[idx + 1]);
      } else if (loopMode === 'all' && readyTracks.length > 0) {
        // Wrap around to first track
        play(readyTracks[0]);
      } else {
        setIsPlaying(false);
      }
    };
  }, [currentTrack, playlist, play, shuffle, loopMode]);

  return (
    <AudioPlayerContext.Provider value={{
      currentTrack, currentRadio, isPlaying, currentTime, duration, volume,
      radioLoading, radioError,
      shuffle, loopMode,
      play, playRadio, pause, resume, stop, seek, setVolume, setPlaylist, playNext, playPrev,
      updateCurrentTrack, toggleShuffle, cycleLoopMode,
    }}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

// ---------- Bottom player bar ----------

import TrackMenu from './TrackMenu';

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ShuffleButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      className={`btn-icon player-shuffle-btn ${active ? 'player-control-active' : ''}`}
      onClick={onClick}
      title={active ? 'Shuffle: On' : 'Shuffle: Off'}
      aria-label={active ? 'Disable shuffle' : 'Enable shuffle'}
      aria-pressed={active}
    >
      🔀
    </button>
  );
}

function LoopButton({ mode, onClick }: { mode: LoopMode; onClick: () => void }) {
  const label = mode === 'off' ? 'Loop: Off' : mode === 'all' ? 'Loop: All' : 'Loop: One';
  return (
    <button
      className={`btn-icon player-loop-btn ${mode !== 'off' ? 'player-control-active' : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {mode === 'one' ? '🔂' : '🔁'}
    </button>
  );
}

export function PlayerBar() {
  const {
    currentTrack, currentRadio, isPlaying, currentTime, duration, volume,
    radioLoading, radioError,
    shuffle, loopMode,
    pause, resume, stop, seek, setVolume, playNext, playPrev,
    toggleShuffle, cycleLoopMode,
  } = useAudioPlayer();

  if (!currentTrack && !currentRadio) return null;

  // Radio station bar
  if (currentRadio) {
    return (
      <div className="player-bar">
        <div className="player-track-info">
          <Link to="/radios" className="player-now-playing-link" title="Open Radios">
            <div className="player-title">
              <span className="badge-live" title="Live Radio">LIVE</span>
              {currentRadio.name}
            </div>
            <div className="player-artist">
              {radioLoading ? '⏳ Connecting…' : radioError ? `❌ ${radioError}` : '📻 Streaming'}
            </div>
          </Link>
        </div>

        <div className="player-controls">
          {radioLoading ? (
            <button className="btn-icon player-play-btn" disabled title="Connecting…">⏳</button>
          ) : isPlaying ? (
            <button className="btn-icon player-play-btn" onClick={pause} title="Pause">⏸</button>
          ) : (
            <button className="btn-icon player-play-btn" onClick={resume} title="Play">▶️</button>
          )}
          <button className="btn-icon" onClick={stop} title="Stop">⏹</button>
        </div>

        <div className="player-progress player-progress-live">
          {radioError ? (
            <span style={{ color: 'var(--error, #f87171)', fontSize: '0.8rem' }}>Stream error — try again</span>
          ) : radioLoading ? (
            <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>Connecting to stream…</span>
          ) : (
            <span className="badge-live-pulse" title="Streaming live">● LIVE</span>
          )}
          {currentRadio.homepageUrl && (
            <a
              href={currentRadio.homepageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="radio-homepage-link"
              title="Open station homepage"
              style={{ marginLeft: '0.75rem', fontSize: '0.75rem', opacity: 0.7 }}
            >
              🔗 Homepage
            </a>
          )}
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

  return (
    <div className="player-bar">
      <div className="player-track-info">
        <Link to="/now-playing" className="player-now-playing-link" title="Open Now Playing">
          <div className="player-title">
            {currentTrack!.isLiveStream && <span className="badge-live" title="Live Stream">LIVE</span>}
            {currentTrack!.title}
          </div>
          <div className="player-artist">{currentTrack!.artist}</div>
        </Link>
      </div>

      <div className="player-controls">
        <ShuffleButton active={shuffle} onClick={toggleShuffle} />
        <button className="btn-icon" onClick={playPrev} title="Previous">⏮</button>
        {isPlaying ? (
          <button className="btn-icon player-play-btn" onClick={pause} title="Pause">⏸</button>
        ) : (
          <button className="btn-icon player-play-btn" onClick={resume} title="Play">▶️</button>
        )}
        <button className="btn-icon" onClick={playNext} title="Next">⏭</button>
        <LoopButton mode={loopMode} onClick={cycleLoopMode} />
        <button className="btn-icon" onClick={stop} title="Stop">⏹</button>
      </div>

      {currentTrack!.isLiveStream ? (
        <div className="player-progress player-progress-live">
          <span className="badge-live-pulse" title="Streaming live">● LIVE</span>
        </div>
      ) : (
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
      )}

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

      <TrackMenu
        trackId={currentTrack!.id}
        trackTitle={currentTrack!.title}
        youtubeUrl={currentTrack!.youtubeUrl}
        className="player-bar-menu"
      />
    </div>
  );
}
