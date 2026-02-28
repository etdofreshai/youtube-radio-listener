import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudioPlayer } from '../components/AudioPlayer';
import type { LoopMode } from '../components/AudioPlayer';
import { getVideoUrl, downloadVideo as apiDownloadVideo, getTrack } from '../api';
import TrackMenu from '../components/TrackMenu';

export type MediaMode = 'video' | 'artwork' | 'lyrics';

const MEDIA_MODE_KEY = 'nightwave:mediaMode';

export function loadMediaMode(): MediaMode {
  try {
    const v = localStorage.getItem(MEDIA_MODE_KEY);
    if (v === 'video' || v === 'artwork' || v === 'lyrics') return v;
  } catch {
    // ignore storage errors
  }
  return 'video';
}

function saveMediaMode(m: MediaMode) {
  try {
    localStorage.setItem(MEDIA_MODE_KEY, m);
  } catch {
    // ignore storage errors
  }
}

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function NowPlayingPage() {
  const navigate = useNavigate();
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    shuffle,
    loopMode,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    playNext,
    playPrev,
    updateCurrentTrack,
    toggleShuffle,
    cycleLoopMode,
  } = useAudioPlayer();

  const [mediaMode, setMediaModeState] = useState<MediaMode>(loadMediaMode);
  const [theaterMode, setTheaterMode] = useState(false);
  const [videoDownloading, setVideoDownloading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const hasVideo = currentTrack?.videoStatus === 'ready';

  // ── Poll for video status updates while a download is in progress ──────────
  // currentTrack is set once when play() is called and never auto-refreshes,
  // so we poll the API to detect when videoStatus changes to 'ready'/'error'.
  useEffect(() => {
    const id = currentTrack?.id;
    const status = currentTrack?.videoStatus;
    if (!id || (status !== 'downloading' && status !== 'pending')) return;

    const POLL_MS = 3_000;
    const timer = setInterval(async () => {
      try {
        const fresh = await getTrack(id);
        updateCurrentTrack({
          videoStatus: fresh.videoStatus,
          videoFilename: fresh.videoFilename ?? undefined,
          videoError: fresh.videoError ?? undefined,
        });
        if (fresh.videoStatus === 'ready') {
          // Auto-switch to video mode when download completes
          setMediaModeState('video');
          saveMediaMode('video');
          clearInterval(timer);
        } else if (fresh.videoStatus === 'error') {
          clearInterval(timer);
        }
      } catch {
        // Network error — keep polling
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, currentTrack?.videoStatus]);

  const setMediaMode = useCallback((m: MediaMode) => {
    setMediaModeState(m);
    saveMediaMode(m);
  }, []);

  const effectiveMode = useMemo<MediaMode>(() => {
    if (mediaMode === 'video' && !hasVideo) return 'artwork';
    return mediaMode;
  }, [mediaMode, hasVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo || effectiveMode !== 'video') return;

    video.muted = true;
    if (isPlaying && video.paused) {
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, hasVideo, effectiveMode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo || effectiveMode !== 'video') return;

    const drift = Math.abs(video.currentTime - currentTime);
    if (drift > 1.5) video.currentTime = currentTime;
  }, [currentTime, hasVideo, effectiveMode]);

  useEffect(() => {
    if (effectiveMode !== 'lyrics' || !lyricsContainerRef.current || !currentTrack?.lyrics) return;
    const lines = lyricsContainerRef.current.querySelectorAll('.lyrics-line');
    if (!lines.length || !duration) return;

    const idx = Math.min(lines.length - 1, Math.floor((currentTime / duration) * lines.length));
    lines.forEach((el, i) => el.classList.toggle('lyrics-line-active', i === idx));
    lines[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [effectiveMode, currentTrack?.lyrics, currentTime, duration]);

  const toggleTheater = useCallback(() => {
    setTheaterMode(prev => !prev);
  }, []);

  const handleDownloadVideo = useCallback(async () => {
    if (!currentTrack || currentTrack.isLiveStream) return;
    setVideoDownloading(true);
    // Optimistic update — show spinner immediately without waiting for server ACK
    updateCurrentTrack({ videoStatus: 'downloading' });
    try {
      await apiDownloadVideo(currentTrack.id);
      // Server returns track with videoStatus 'downloading'; polling effect takes over
    } catch {
      // Revert optimistic update on error
      updateCurrentTrack({ videoStatus: 'none' });
    } finally {
      setVideoDownloading(false);
    }
  }, [currentTrack, updateCurrentTrack]);

  if (!currentTrack) {
    return (
      <div className="now-playing-page now-playing-empty">
        <div className="now-playing-empty-inner">
          <div className="now-playing-empty-icon">🎵</div>
          <h2>Nothing playing right now</h2>
          <p>Pick a track from your library to start listening.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Browse Tracks</button>
        </div>
      </div>
    );
  }

  const track = currentTrack;
  const artwork = track.artworkUrl ?? track.ytThumbnailUrl ?? null;
  const artworkSource = track.artworkSource ?? null;
  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const lyricsLines = track.lyrics ? track.lyrics.split('\n') : [];

  function renderMediaPanel() {
    try {
      if (effectiveMode === 'video' && hasVideo) {
        return (
          <div className="now-playing-video-container">
            <video
              ref={videoRef}
              className="now-playing-video"
              src={getVideoUrl(track.id)}
              muted
              playsInline
              preload="auto"
            />
          </div>
        );
      }

      if (effectiveMode === 'lyrics') {
        return (
          <div className="now-playing-lyrics-panel" ref={lyricsContainerRef}>
            {lyricsLines.length > 0 ? (
              <div className="now-playing-lyrics-text">
                {lyricsLines.map((line, i) => (
                  <p key={i} className="lyrics-line">{line || '\u00A0'}</p>
                ))}
                {track.lyricsSource && <p className="lyrics-source-tag">Source: {track.lyricsSource}</p>}
              </div>
            ) : (
              <div className="now-playing-lyrics-empty">
                <span className="lyrics-empty-icon">📝</span>
                <p>Lyrics unavailable</p>
              </div>
            )}
          </div>
        );
      }

      if (artwork) {
        return (
          <div className="now-playing-art">
            <img src={artwork} alt={`${track.title} artwork`} />
            {artworkSource && <span className="now-playing-art-source">{artworkSource}</span>}
          </div>
        );
      }

      return <div className="now-playing-art-placeholder">🎵</div>;
    } catch {
      if (artwork) {
        return (
          <div className="now-playing-art">
            <img src={artwork} alt={`${track.title} artwork`} />
          </div>
        );
      }
      return <div className="now-playing-art-placeholder">🎵</div>;
    }
  }

  return (
    <div className={`now-playing-page ${theaterMode ? 'now-playing-theater' : ''}`}>
      <button className="btn-icon now-playing-back" onClick={() => navigate(-1)} title="Go back">← Back</button>

      <div className="now-playing-layout">
        <div className="now-playing-art-wrap">
          {renderMediaPanel()}

          <div className="now-playing-mode-bar">
            <div className="now-playing-mode-toggle">
              <button className={`mode-toggle-btn ${mediaMode === 'video' ? 'mode-toggle-active' : ''}`} onClick={() => setMediaMode('video')} title="Video">🎬</button>
              <button className={`mode-toggle-btn ${mediaMode === 'artwork' ? 'mode-toggle-active' : ''}`} onClick={() => setMediaMode('artwork')} title="Thumbnail">🖼️</button>
              <button className={`mode-toggle-btn ${mediaMode === 'lyrics' ? 'mode-toggle-active' : ''}`} onClick={() => setMediaMode('lyrics')} title="Lyrics">📝</button>
            </div>
            <button className="btn-icon mode-maximize-btn" onClick={toggleTheater} title={theaterMode ? 'Exit maximize' : 'Maximize (keeps bottom bar)'}>
              {theaterMode ? '⊡' : '⊞'}
            </button>
          </div>

          {mediaMode === 'video' && !hasVideo && !track.isLiveStream && (
            <div className="now-playing-status-line">
              {track.videoStatus === 'downloading' && (
                <span>⬇️ Downloading video… will switch automatically when ready.</span>
              )}
              {track.videoStatus === 'error' && (
                <span title={track.videoError ?? undefined}>⚠️ Video download failed — showing thumbnail.</span>
              )}
              {(track.videoStatus === 'none' || track.videoStatus === 'pending') && (
                <span>Video unavailable — showing thumbnail.</span>
              )}
            </div>
          )}
        </div>

        <div className="now-playing-info-wrap">
          <div className="now-playing-meta">
            <div className="now-playing-meta-header">
              <h1 className="now-playing-title">
                {track.isLiveStream && <span className="badge-live badge-live-lg" title="Live Stream">LIVE</span>}
                {track.title}
              </h1>
              <TrackMenu
                trackId={track.id}
                trackTitle={track.title}
                youtubeUrl={track.youtubeUrl}
                className="now-playing-track-menu"
              />
            </div>
            <p className="now-playing-artist">{track.artist}</p>
            {track.album && <p className="now-playing-album"><span className="now-playing-label">Album</span>{track.album}</p>}
            {track.releaseYear && <p className="now-playing-year">{track.releaseYear}</p>}
          </div>

          {mediaMode === 'video' && !hasVideo && !track.isLiveStream && (
            <button
              className="btn btn-sm now-playing-video-dl-btn"
              onClick={handleDownloadVideo}
              disabled={videoDownloading || track.videoStatus === 'downloading' || track.videoStatus === 'pending'}
            >
              {(videoDownloading || track.videoStatus === 'downloading') ? '⬇️ Downloading…' : track.videoStatus === 'error' ? '🔁 Retry Download' : '🎬 Download Video'}
            </button>
          )}

          {track.isLiveStream ? (
            <div className="now-playing-progress now-playing-progress-live">
              <span className="badge-live-pulse badge-live-lg">● STREAMING LIVE</span>
            </div>
          ) : (
            <div className="now-playing-progress">
              <input
                type="range"
                className="now-playing-seek"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={e => seek(Number(e.target.value))}
              />
              <div className="now-playing-times">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="now-playing-progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          )}

          <div className="now-playing-controls">
            <button
              className={`btn-icon now-playing-btn now-playing-shuffle-btn ${shuffle ? 'player-control-active' : ''}`}
              onClick={toggleShuffle}
              title={shuffle ? 'Shuffle: On' : 'Shuffle: Off'}
              aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
              aria-pressed={shuffle}
            >
              🔀
            </button>
            <button className="btn-icon now-playing-btn" onClick={playPrev} title="Previous">⏮</button>
            {isPlaying
              ? <button className="btn-icon now-playing-btn now-playing-play-btn" onClick={pause} title="Pause">⏸</button>
              : <button className="btn-icon now-playing-btn now-playing-play-btn" onClick={resume} title="Play">▶️</button>}
            <button className="btn-icon now-playing-btn" onClick={playNext} title="Next">⏭</button>
            <button
              className={`btn-icon now-playing-btn now-playing-loop-btn ${loopMode !== 'off' ? 'player-control-active' : ''}`}
              onClick={cycleLoopMode}
              title={loopMode === 'off' ? 'Loop: Off' : loopMode === 'all' ? 'Loop: All' : 'Loop: One'}
              aria-label={`Loop mode: ${loopMode}`}
            >
              {loopMode === 'one' ? '🔂' : '🔁'}
            </button>
            <button className="btn-icon now-playing-btn now-playing-stop-btn" onClick={stop} title="Stop">⏹</button>
          </div>

          <div className="now-playing-volume">
            <span className="now-playing-vol-icon">{volume > 100 ? '🔊⚡' : volume > 0 ? '🔊' : '🔇'}</span>
            <input
              type="range"
              className="now-playing-vol-slider"
              min={0}
              max={200}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
            />
            <span className="now-playing-vol-label">{volume}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
