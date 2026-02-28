import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudioPlayer } from '../components/AudioPlayer';
import {
  getVideoUrl,
  downloadVideo as apiDownloadVideo,
  fetchLyrics as apiFetchLyrics,
  setPreferredVariant as apiSetPreferredVariant,
} from '../api';
import type { TrackVariant, VariantKind } from '../types';

// ── Types ────────────────────────────────────────────────────

/** Three media modes the user can toggle between */
export type MediaMode = 'video' | 'artwork' | 'lyrics';

const MEDIA_MODE_KEY = 'nightwave:mediaMode';

/** Read persisted media mode from localStorage (default: 'video') */
export function loadMediaMode(): MediaMode {
  try {
    const v = localStorage.getItem(MEDIA_MODE_KEY);
    if (v === 'video' || v === 'artwork' || v === 'lyrics') return v;
  } catch { /* ignore */ }
  return 'video';
}

/** Persist media mode */
function saveMediaMode(m: MediaMode) {
  try { localStorage.setItem(MEDIA_MODE_KEY, m); } catch { /* ignore */ }
}

// ── Helpers ──────────────────────────────────────────────────

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Component ────────────────────────────────────────────────

export default function NowPlayingPage() {
  const navigate = useNavigate();
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    playNext,
    playPrev,
  } = useAudioPlayer();

  const [mediaMode, setMediaModeState] = useState<MediaMode>(loadMediaMode);
  const [theaterMode, setTheaterMode] = useState(false);
  const [videoDownloading, setVideoDownloading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaPanelRef = useRef<HTMLDivElement>(null);

  // Lyrics state
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [lyricsSource, setLyricsSource] = useState<string | null>(null);
  const [lyricsFetching, setLyricsFetching] = useState(false);
  const [lyricsFetched, setLyricsFetched] = useState(false);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const hasVideo = currentTrack?.videoStatus === 'ready';

  // Persist mode changes
  const setMediaMode = useCallback((m: MediaMode) => {
    setMediaModeState(m);
    saveMediaMode(m);
  }, []);

  // Reset lyrics state when track changes
  useEffect(() => {
    if (currentTrack) {
      setLyrics(currentTrack.lyrics ?? null);
      setLyricsSource(currentTrack.lyricsSource ?? null);
      setLyricsFetched(!!currentTrack.lyrics);
    } else {
      setLyrics(null);
      setLyricsSource(null);
      setLyricsFetched(false);
    }
  }, [currentTrack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch lyrics when switching to lyrics mode if not yet fetched
  useEffect(() => {
    if (mediaMode !== 'lyrics' || !currentTrack || lyricsFetched || lyricsFetching) return;
    setLyricsFetching(true);
    apiFetchLyrics(currentTrack.id)
      .then(res => {
        setLyrics(res.lyrics);
        setLyricsSource(res.lyricsSource);
        setLyricsFetched(true);
      })
      .catch(() => {
        setLyricsFetched(true); // mark as attempted
      })
      .finally(() => setLyricsFetching(false));
  }, [mediaMode, currentTrack?.id, lyricsFetched, lyricsFetching]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync video playback with audio state
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo || mediaMode !== 'video') return;

    video.muted = true;
    if (isPlaying && video.paused) {
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, hasVideo, mediaMode]);

  // Sync video seek with audio time
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo || mediaMode !== 'video') return;

    const drift = Math.abs(video.currentTime - currentTime);
    if (drift > 1.5) {
      video.currentTime = currentTime;
    }
  }, [currentTime, hasVideo, mediaMode]);

  // Auto-scroll lyrics based on playback position
  useEffect(() => {
    if (mediaMode !== 'lyrics' || !lyrics || !lyricsContainerRef.current) return;

    const container = lyricsContainerRef.current;
    const lines = container.querySelectorAll('.lyrics-line');
    if (lines.length === 0 || duration <= 0) return;

    // Simple proportional scroll: estimate current line from time progress
    const progress = currentTime / duration;
    const lineIdx = Math.min(
      Math.floor(progress * lines.length),
      lines.length - 1
    );

    // Update active line highlight
    lines.forEach((el, i) => {
      el.classList.toggle('lyrics-line-active', i === lineIdx);
    });

    // Scroll the active line into view (smooth, centered)
    const activeLine = lines[lineIdx];
    if (activeLine) {
      activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime, duration, lyrics, mediaMode]);

  const toggleTheater = useCallback(() => {
    setTheaterMode(prev => !prev);
  }, []);

  const handleDownloadVideo = useCallback(async () => {
    if (!currentTrack) return;
    setVideoDownloading(true);
    try {
      await apiDownloadVideo(currentTrack.id);
    } catch (err) {
      console.error('Video download request failed:', err);
    } finally {
      setVideoDownloading(false);
    }
  }, [currentTrack]);

  const handleRefreshLyrics = useCallback(async () => {
    if (!currentTrack) return;
    setLyricsFetching(true);
    try {
      const res = await apiFetchLyrics(currentTrack.id);
      setLyrics(res.lyrics);
      setLyricsSource(res.lyricsSource);
      setLyricsFetched(true);
    } catch {
      // ignore
    } finally {
      setLyricsFetching(false);
    }
  }, [currentTrack]);

  // ── no-track state ────────────────────────────────────────────────
  if (!currentTrack) {
    return (
      <div className="now-playing-page now-playing-empty">
        <div className="now-playing-empty-inner">
          <div className="now-playing-empty-icon">🎵</div>
          <h2>Nothing playing right now</h2>
          <p>Pick a track from your library to start listening.</p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/')}
          >
            Browse Tracks
          </button>
        </div>
      </div>
    );
  }

  const artwork = currentTrack.artworkUrl ?? currentTrack.ytThumbnailUrl ?? null;
  const artworkSource = currentTrack.artworkSource ?? null;

  const progressPercent =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  // What the video status indicator should show
  const videoStatusLabel = (() => {
    if (mediaMode !== 'video') return null;
    switch (currentTrack.videoStatus) {
      case 'none': return null;
      case 'pending': return '⏳ Video queued';
      case 'downloading': return '⬇️ Downloading video…';
      case 'ready': return null;
      case 'error': return `❌ Video error: ${currentTrack.videoError || 'unknown'}`;
      default: return null;
    }
  })();

  // Parse lyrics into lines for rendering
  const lyricsLines = lyrics ? lyrics.split('\n') : [];

  // ── Render media panel content ────────────────────────────────────
  // Capture for narrowing inside nested function
  const track = currentTrack;

  function renderMediaContent() {
    switch (mediaMode) {
      case 'video':
        if (hasVideo) {
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
              <div className="now-playing-video-controls">
                <button
                  className="btn-icon now-playing-video-btn"
                  onClick={toggleTheater}
                  title={theaterMode ? 'Exit theater mode' : 'Theater mode (keeps player bar)'}
                >
                  {theaterMode ? '⊡' : '⊞'}
                </button>
              </div>
            </div>
          );
        }
        // Fallthrough: no video available — show artwork with download prompt
        if (artwork) {
          return (
            <div className="now-playing-art">
              <img src={artwork} alt={`${track.title} artwork`} />
              {artworkSource && <span className="now-playing-art-source">{artworkSource}</span>}
              {track.videoStatus !== 'downloading' && track.videoStatus !== 'pending' && (
                <button
                  className="now-playing-video-overlay-btn"
                  onClick={handleDownloadVideo}
                  disabled={videoDownloading}
                  title="Download music video"
                >
                  {videoDownloading ? '⬇️' : '🎬'}
                </button>
              )}
            </div>
          );
        }
        return <div className="now-playing-art-placeholder">🎵</div>;

      case 'artwork':
        if (artwork) {
          return (
            <div className="now-playing-art">
              <img src={artwork} alt={`${track.title} artwork`} />
              {artworkSource && <span className="now-playing-art-source">{artworkSource}</span>}
            </div>
          );
        }
        return <div className="now-playing-art-placeholder">🎵</div>;

      case 'lyrics':
        return (
          <div className="now-playing-lyrics-panel" ref={lyricsContainerRef}>
            {lyricsFetching ? (
              <div className="now-playing-lyrics-loading">
                <span className="lyrics-spinner">⏳</span>
                <p>Fetching lyrics…</p>
              </div>
            ) : lyricsLines.length > 0 ? (
              <div className="now-playing-lyrics-text">
                {lyricsLines.map((line, i) => (
                  <p key={i} className="lyrics-line">
                    {line || '\u00A0'}
                  </p>
                ))}
                {lyricsSource && (
                  <p className="lyrics-source-tag">Source: {lyricsSource}</p>
                )}
              </div>
            ) : (
              <div className="now-playing-lyrics-empty">
                <span className="lyrics-empty-icon">📝</span>
                <p>Lyrics unavailable</p>
                <button
                  className="btn btn-sm"
                  onClick={handleRefreshLyrics}
                  disabled={lyricsFetching}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        );
    }
  }

  return (
    <div className={`now-playing-page ${theaterMode ? 'now-playing-theater' : ''}`}>
      {/* Back nav */}
      <button className="btn-icon now-playing-back" onClick={() => navigate(-1)} title="Go back">
        ← Back
      </button>

      <div className="now-playing-layout">
        {/* Media Panel */}
        <div className="now-playing-art-wrap" ref={mediaPanelRef}>
          {renderMediaContent()}

          {/* Mode toggle + maximize */}
          <div className="now-playing-mode-bar">
            <div className="now-playing-mode-toggle">
              <button
                className={`mode-toggle-btn ${mediaMode === 'video' ? 'mode-toggle-active' : ''}`}
                onClick={() => setMediaMode('video')}
                title="Video mode"
              >
                🎬
              </button>
              <button
                className={`mode-toggle-btn ${mediaMode === 'artwork' ? 'mode-toggle-active' : ''}`}
                onClick={() => setMediaMode('artwork')}
                title="Artwork mode"
              >
                🖼️
              </button>
              <button
                className={`mode-toggle-btn ${mediaMode === 'lyrics' ? 'mode-toggle-active' : ''}`}
                onClick={() => setMediaMode('lyrics')}
                title="Lyrics mode"
              >
                📝
              </button>
            </div>
            <button
              className="btn-icon mode-maximize-btn"
              onClick={toggleTheater}
              title={theaterMode ? 'Exit theater mode' : 'Maximize (keeps player bar)'}
            >
              {theaterMode ? '⊡' : '⊞'}
            </button>
          </div>

          {/* Status line (video downloading, etc.) */}
          {videoStatusLabel && (
            <div className="now-playing-status-line">
              <span>{videoStatusLabel}</span>
            </div>
          )}
        </div>

        {/* Track info + controls */}
        <div className="now-playing-info-wrap">
          {/* Title / artist / album */}
          <div className="now-playing-meta">
            <h1 className="now-playing-title">
              {currentTrack.isLiveStream && <span className="badge-live badge-live-lg" title="Live Stream">LIVE</span>}
              {currentTrack.title}
            </h1>
            <p className="now-playing-artist">{currentTrack.artist}</p>
            {currentTrack.album && (
              <p className="now-playing-album">
                <span className="now-playing-label">Album</span>
                {currentTrack.album}
              </p>
            )}
            {currentTrack.releaseYear && (
              <p className="now-playing-year">{currentTrack.releaseYear}</p>
            )}
          </div>

          {/* Video download prompt (only in video mode when no video; hidden for live streams) */}
          {!currentTrack.isLiveStream && mediaMode === 'video' && !hasVideo && currentTrack.videoStatus !== 'downloading' && currentTrack.videoStatus !== 'pending' && (
            <button
              className="btn btn-sm now-playing-video-dl-btn"
              onClick={handleDownloadVideo}
              disabled={videoDownloading}
              title="Download music video"
            >
              {videoDownloading ? '⬇️ Requesting…' : '🎬 Download Video'}
            </button>
          )}

          {/* Progress bar */}
          {currentTrack.isLiveStream ? (
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
              <div
                className="now-playing-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}

          {/* Playback controls */}
          <div className="now-playing-controls">
            <button className="btn-icon now-playing-btn" onClick={playPrev} title="Previous">⏮</button>
            {isPlaying ? (
              <button className="btn-icon now-playing-btn now-playing-play-btn" onClick={pause} title="Pause">⏸</button>
            ) : (
              <button className="btn-icon now-playing-btn now-playing-play-btn" onClick={resume} title="Play">▶️</button>
            )}
            <button className="btn-icon now-playing-btn" onClick={playNext} title="Next">⏭</button>
            <button className="btn-icon now-playing-btn now-playing-stop-btn" onClick={stop} title="Stop">⏹</button>
          </div>

          {/* Volume */}
          <div className="now-playing-volume">
            <span className="now-playing-vol-icon">
              {volume > 100 ? '🔊⚡' : volume > 0 ? '🔊' : '🔇'}
            </span>
            <input
              type="range"
              className="now-playing-vol-slider"
              min={0}
              max={200}
              value={volume}
              onChange={e => setVolume(Number(e.target.value))}
              title={`${volume}%${volume > 100 ? ' (boosted — may clip)' : ''}`}
            />
            <span className="now-playing-vol-label">{volume}%</span>
          </div>

          {/* Key metadata */}
          <div className="now-playing-details">
            <h3 className="now-playing-details-title">Track Details</h3>
            <dl className="now-playing-dl">
              {currentTrack.genre && (
                <><dt>Genre</dt><dd>{currentTrack.genre}</dd></>
              )}
              {currentTrack.bpm && (
                <><dt>BPM</dt><dd>{currentTrack.bpm}</dd></>
              )}
              {currentTrack.label && (
                <><dt>Label</dt><dd>{currentTrack.label}</dd></>
              )}
              {currentTrack.isrc && (
                <><dt>ISRC</dt><dd>{currentTrack.isrc}</dd></>
              )}
              {currentTrack.duration && (
                <><dt>Duration</dt><dd>{formatTime(currentTrack.duration)}</dd></>
              )}
              {currentTrack.ytChannel && (
                <><dt>Channel</dt><dd>{currentTrack.ytChannel}</dd></>
              )}
              {currentTrack.ytUploadDate && (
                <><dt>Uploaded</dt><dd>{currentTrack.ytUploadDate}</dd></>
              )}
              {currentTrack.youtubeUrl && (
                <><dt>YouTube</dt><dd><a href={currentTrack.youtubeUrl} target="_blank" rel="noopener noreferrer">Open ↗</a></dd></>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
