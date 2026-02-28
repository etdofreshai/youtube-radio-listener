/**
 * Reusable download button for tracks.
 * Shows download progress, "Downloaded ✓" state, or download icon.
 */

import { useCallback } from 'react';
import { useDownloads } from '../context/DownloadContext';
import type { Track } from '../types';

interface DownloadButtonProps {
  track: Track;
  /** Visual variant: 'icon' (compact, for track rows) or 'button' (labeled) */
  variant?: 'icon' | 'button';
  /** Additional CSS class */
  className?: string;
}

export default function DownloadButton({ track, variant = 'icon', className = '' }: DownloadButtonProps) {
  const {
    isTrackDownloaded,
    isTrackDownloading,
    activeDownloads,
    startDownload,
    cancelDownload,
    removeDownload,
  } = useDownloads();

  const downloaded = isTrackDownloaded(track.id);
  const downloading = isTrackDownloading(track.id);
  const progress = activeDownloads.get(track.id);

  // Don't show for live streams or tracks without audio
  if (track.isLiveStream || track.audioStatus !== 'ready') return null;

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (downloading) {
      cancelDownload(track.id);
      return;
    }

    if (downloaded) {
      // Already downloaded — clicking could re-download or remove
      // For now, do nothing (use Downloads page to manage)
      return;
    }

    await startDownload(track);
  }, [track, downloading, downloaded, startDownload, cancelDownload]);

  if (variant === 'button') {
    return (
      <button
        className={`btn btn-sm download-btn ${downloaded ? 'download-btn-complete' : ''} ${downloading ? 'download-btn-active' : ''} ${className}`}
        onClick={handleClick}
        disabled={downloaded}
        title={downloaded ? 'Downloaded to local storage' : downloading ? 'Click to cancel' : 'Download for offline playback'}
      >
        {downloading && progress ? (
          <>⬇️ {progress.percent}%</>
        ) : downloaded ? (
          <>✓ Downloaded</>
        ) : (
          <>📥 Download</>
        )}
      </button>
    );
  }

  // Icon variant (compact)
  return (
    <button
      className={`btn-icon download-icon-btn ${downloaded ? 'download-icon-complete' : ''} ${downloading ? 'download-icon-active' : ''} ${className}`}
      onClick={handleClick}
      title={downloaded ? 'Downloaded ✓' : downloading ? `Downloading ${progress?.percent ?? 0}% — click to cancel` : 'Download for offline'}
      aria-label={downloaded ? 'Downloaded' : downloading ? 'Downloading' : 'Download'}
    >
      {downloading ? (
        <span className="download-progress-ring">
          <svg viewBox="0 0 20 20" width="18" height="18">
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
            <circle
              cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
              strokeDasharray={`${(progress?.percent ?? 0) * 0.5} 50`}
              strokeLinecap="round"
              transform="rotate(-90 10 10)"
            />
          </svg>
        </span>
      ) : downloaded ? (
        <span style={{ color: 'var(--success, #22c55e)' }}>✓</span>
      ) : (
        '📥'
      )}
    </button>
  );
}
