import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAudioPlayer } from '../components/AudioPlayer';
import type { LoopMode } from '../components/AudioPlayer';
import { getVideoUrl, downloadVideo as apiDownloadVideo, getTrack } from '../api';
import { usePlaybackSync } from '../hooks/usePlaybackSync';
import TrackMenu from '../components/TrackMenu';
import FavoriteButton from '../components/FavoriteButton';
import DownloadButton from '../components/DownloadButton';
import type { Track } from '../types';

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
    isMuted,
    shuffle,
    loopMode,
    queue: playerQueue,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    toggleMute,
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

  // Playback sync (cross-device) and history
  const {
    playHistory,
    historyTracks,
    isSynced,
    jumpToQueueTrack,
    replayFromHistory,
  } = usePlaybackSync();

  type QueueTab = 'queue' | 'history';
  const [queueTab, setQueueTab] = useState<QueueTab>('queue');

  // Compute upcoming queue from AudioPlayer's queue (immediate, no server roundtrip)
  const currentPlayerQueueIndex = currentTrack
    ? playerQueue.findIndex(t => t.id === currentTrack.id)
    : -1;
  const upcomingTracks = currentPlayerQueueIndex >= 0
    ? playerQueue.slice(currentPlayerQueueIndex + 1)
    : [];

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
              <DownloadButton track={track} variant="button" />
              <FavoriteButton type="track" entityId={track.id} size="lg" />
              <TrackMenu
                trackId={track.id}
                trackTitle={track.title}
                youtubeUrl={track.youtubeUrl}
                track={track}
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
            <button
              className="btn-icon now-playing-mute-btn"
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              aria-pressed={isMuted}
            >
              {isMuted ? '🔇' : volume > 100 ? '🔊⚡' : volume > 0 ? '🔊' : '🔇'}
            </button>
            <input
              type="range"
              className={`now-playing-vol-slider${isMuted ? ' now-playing-vol-slider-muted' : ''}`}
              min={0}
              max={200}
              value={volume}
              disabled={isMuted}
              onChange={e => setVolume(Number(e.target.value))}
              title={isMuted ? 'Muted' : `${volume}%`}
            />
            <span className="now-playing-vol-label" style={{ opacity: isMuted ? 0.4 : 1 }}>{volume}%</span>
          </div>
        </div>
      </div>

      {/* ── Queue & History Panel ── */}
      <div className="now-playing-queue-panel">
        <div className="queue-panel-header">
          <div className="queue-panel-tabs">
            <button
              className={`queue-tab-btn ${queueTab === 'queue' ? 'queue-tab-active' : ''}`}
              onClick={() => setQueueTab('queue')}
            >
              📋 Up Next {upcomingTracks.length > 0 && <span className="queue-tab-count">{upcomingTracks.length}</span>}
            </button>
            <button
              className={`queue-tab-btn ${queueTab === 'history' ? 'queue-tab-active' : ''}`}
              onClick={() => setQueueTab('history')}
            >
              📜 History {playHistory.length > 0 && <span className="queue-tab-count">{playHistory.length}</span>}
            </button>
          </div>
          <span className={`queue-sync-indicator ${isSynced ? 'queue-synced' : 'queue-unsynced'}`} title={isSynced ? 'Synced across devices' : 'Not synced'}>
            {isSynced ? '🔗' : '⛓️‍💥'}
          </span>
        </div>

        <div className="queue-panel-body">
          {queueTab === 'queue' && (
            <div className="queue-list">
              {/* Current track highlight */}
              {currentTrack && (
                <div className="queue-item queue-item-current">
                  <div className="queue-item-indicator">▶</div>
                  <div className="queue-item-art">
                    {(currentTrack.artworkUrl ?? currentTrack.ytThumbnailUrl)
                      ? <img src={(currentTrack.artworkUrl ?? currentTrack.ytThumbnailUrl)!} alt="" />
                      : <span className="queue-item-art-placeholder">🎵</span>}
                  </div>
                  <div className="queue-item-info">
                    <span className="queue-item-title">{currentTrack.title}</span>
                    <span className="queue-item-artist">{currentTrack.artist}</span>
                  </div>
                  <span className="queue-item-badge">Now Playing</span>
                </div>
              )}

              {upcomingTracks.length > 0 ? (
                upcomingTracks.map((t, i) => (
                  <button
                    key={t.id}
                    className="queue-item queue-item-upcoming"
                    onClick={() => jumpToQueueTrack(t.id)}
                    title={`Play "${t.title}"`}
                  >
                    <div className="queue-item-indicator queue-item-number">{i + 1}</div>
                    <div className="queue-item-art">
                      {(t.artworkUrl ?? t.ytThumbnailUrl)
                        ? <img src={(t.artworkUrl ?? t.ytThumbnailUrl)!} alt="" />
                        : <span className="queue-item-art-placeholder">🎵</span>}
                    </div>
                    <div className="queue-item-info">
                      <span className="queue-item-title">{t.title}</span>
                      <span className="queue-item-artist">{t.artist}</span>
                    </div>
                    {t.duration && <span className="queue-item-duration">{formatTime(t.duration)}</span>}
                  </button>
                ))
              ) : (
                <div className="queue-empty">
                  <span className="queue-empty-icon">📋</span>
                  <p>Queue is empty</p>
                  <p className="queue-empty-hint">Play tracks to build your queue</p>
                </div>
              )}
            </div>
          )}

          {queueTab === 'history' && (
            <div className="queue-list">
              {playHistory.length > 0 ? (
                playHistory.slice(0, 20).map((entry, i) => {
                  const t = historyTracks.find(ht => ht.id === entry.trackId);
                  if (!t) return null;
                  const ago = getTimeAgo(entry.playedAt);
                  return (
                    <button
                      key={`${entry.trackId}-${i}`}
                      className="queue-item queue-item-history"
                      onClick={() => replayFromHistory(entry.trackId)}
                      title={`Replay "${t.title}"`}
                    >
                      <div className="queue-item-indicator queue-item-number">{i + 1}</div>
                      <div className="queue-item-art">
                        {(t.artworkUrl ?? t.ytThumbnailUrl)
                          ? <img src={(t.artworkUrl ?? t.ytThumbnailUrl)!} alt="" />
                          : <span className="queue-item-art-placeholder">🎵</span>}
                      </div>
                      <div className="queue-item-info">
                        <span className="queue-item-title">{t.title}</span>
                        <span className="queue-item-artist">{t.artist}</span>
                      </div>
                      <span className="queue-item-ago">{ago}</span>
                    </button>
                  );
                })
              ) : (
                <div className="queue-empty">
                  <span className="queue-empty-icon">📜</span>
                  <p>No history yet</p>
                  <p className="queue-empty-hint">Your recently played tracks will appear here</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Format a timestamp as relative time ago string */
function getTimeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
