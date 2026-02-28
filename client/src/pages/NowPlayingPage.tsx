import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudioPlayer } from '../components/AudioPlayer';
import { getVideoUrl, downloadVideo as apiDownloadVideo } from '../api';

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
    pause,
    resume,
    stop,
    seek,
    setVolume,
    playNext,
    playPrev,
  } = useAudioPlayer();

  const [theaterMode, setTheaterMode] = useState(false);
  const [videoDownloading, setVideoDownloading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const theaterRef = useRef<HTMLDivElement>(null);

  const hasVideo = currentTrack?.videoStatus === 'ready';

  // Sync video playback with audio state
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo) return;

    // Mute video — audio comes from the audio player
    video.muted = true;

    // Sync play/pause
    if (isPlaying && video.paused) {
      video.play().catch(() => {});
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  }, [isPlaying, hasVideo]);

  // Sync video seek with audio time (only when difference is noticeable)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideo) return;

    const drift = Math.abs(video.currentTime - currentTime);
    if (drift > 1.5) {
      video.currentTime = currentTime;
    }
  }, [currentTime, hasVideo]);

  // Toggle theater mode
  const toggleTheater = useCallback(() => {
    setTheaterMode(prev => !prev);
  }, []);

  // Toggle true browser fullscreen on the video element
  const toggleFullscreen = useCallback(() => {
    const el = theaterRef.current || videoRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // Handle video download request
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

  // Video status indicator
  const videoStatusLabel = (() => {
    switch (currentTrack.videoStatus) {
      case 'none': return null;
      case 'pending': return '⏳ Video queued';
      case 'downloading': return '⬇️ Downloading video…';
      case 'ready': return null; // shown as player
      case 'error': return `❌ Video error: ${currentTrack.videoError || 'unknown'}`;
      default: return null;
    }
  })();

  return (
    <div className={`now-playing-page ${theaterMode ? 'now-playing-theater' : ''}`}>
      {/* Back nav */}
      <button className="btn-icon now-playing-back" onClick={() => navigate(-1)} title="Go back">
        ← Back
      </button>

      <div className="now-playing-layout">
        {/* Artwork / Video */}
        <div className="now-playing-art-wrap" ref={theaterRef}>
          {hasVideo ? (
            <div className="now-playing-video-container">
              <video
                ref={videoRef}
                className="now-playing-video"
                src={getVideoUrl(currentTrack.id)}
                muted
                playsInline
                preload="auto"
              />
              <div className="now-playing-video-controls">
                <button
                  className="btn-icon now-playing-video-btn"
                  onClick={toggleTheater}
                  title={theaterMode ? 'Exit theater mode' : 'Theater mode'}
                >
                  {theaterMode ? '⊡' : '⊞'}
                </button>
                <button
                  className="btn-icon now-playing-video-btn"
                  onClick={toggleFullscreen}
                  title="Fullscreen"
                >
                  ⛶
                </button>
              </div>
            </div>
          ) : artwork ? (
            <div className="now-playing-art">
              <img src={artwork} alt={`${currentTrack.title} artwork`} />
              {artworkSource && (
                <span className="now-playing-art-source">{artworkSource}</span>
              )}
            </div>
          ) : (
            <div className="now-playing-art-placeholder">🎵</div>
          )}
        </div>

        {/* Track info + controls */}
        <div className="now-playing-info-wrap">
          {/* Title / artist / album */}
          <div className="now-playing-meta">
            <h1 className="now-playing-title">{currentTrack.title}</h1>
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

          {/* Video status / download button */}
          <div className="now-playing-video-status">
            {videoStatusLabel && (
              <span className="now-playing-video-status-text">{videoStatusLabel}</span>
            )}
            {!hasVideo && currentTrack.videoStatus !== 'downloading' && currentTrack.videoStatus !== 'pending' && (
              <button
                className="btn btn-sm now-playing-video-dl-btn"
                onClick={handleDownloadVideo}
                disabled={videoDownloading}
                title="Download music video"
              >
                {videoDownloading ? '⬇️ Requesting…' : '🎬 Download Video'}
              </button>
            )}
          </div>

          {/* Progress bar */}
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
            {/* Visual progress fill */}
            <div
              className="now-playing-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Playback controls */}
          <div className="now-playing-controls">
            <button className="btn-icon now-playing-btn" onClick={playPrev} title="Previous">⏮</button>
            {isPlaying ? (
              <button
                className="btn-icon now-playing-btn now-playing-play-btn"
                onClick={pause}
                title="Pause"
              >
                ⏸
              </button>
            ) : (
              <button
                className="btn-icon now-playing-btn now-playing-play-btn"
                onClick={resume}
                title="Play"
              >
                ▶️
              </button>
            )}
            <button className="btn-icon now-playing-btn" onClick={playNext} title="Next">⏭</button>
            <button
              className="btn-icon now-playing-btn now-playing-stop-btn"
              onClick={stop}
              title="Stop"
            >
              ⏹
            </button>
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
                <>
                  <dt>Genre</dt>
                  <dd>{currentTrack.genre}</dd>
                </>
              )}
              {currentTrack.bpm && (
                <>
                  <dt>BPM</dt>
                  <dd>{currentTrack.bpm}</dd>
                </>
              )}
              {currentTrack.label && (
                <>
                  <dt>Label</dt>
                  <dd>{currentTrack.label}</dd>
                </>
              )}
              {currentTrack.isrc && (
                <>
                  <dt>ISRC</dt>
                  <dd>{currentTrack.isrc}</dd>
                </>
              )}
              {currentTrack.duration && (
                <>
                  <dt>Duration</dt>
                  <dd>{formatTime(currentTrack.duration)}</dd>
                </>
              )}
              {currentTrack.ytChannel && (
                <>
                  <dt>Channel</dt>
                  <dd>{currentTrack.ytChannel}</dd>
                </>
              )}
              {currentTrack.ytUploadDate && (
                <>
                  <dt>Uploaded</dt>
                  <dd>{currentTrack.ytUploadDate}</dd>
                </>
              )}
              {currentTrack.youtubeUrl && (
                <>
                  <dt>YouTube</dt>
                  <dd>
                    <a
                      href={currentTrack.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open ↗
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
