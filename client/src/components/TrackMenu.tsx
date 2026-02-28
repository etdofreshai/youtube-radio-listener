import { useState, useRef, useEffect, useCallback } from 'react';
import AddToPlaylistModal from './AddToPlaylistModal';
import { useDownloads } from '../context/DownloadContext';
import type { Track } from '../types';

interface TrackMenuProps {
  trackId: string;
  trackTitle: string;
  youtubeUrl?: string;
  className?: string;
  /** Full track object — needed for download functionality */
  track?: Track;
}

export default function TrackMenu({ trackId, trackTitle, youtubeUrl, className, track }: TrackMenuProps) {
  const [open, setOpen] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isTrackDownloaded, isTrackDownloading, startDownload, removeDownload } = useDownloads();

  const toggle = useCallback(() => setOpen(prev => !prev), []);

  // Close menu on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleAddToPlaylist = () => {
    setOpen(false);
    setShowPlaylistModal(true);
  };

  const handleShare = () => {
    setOpen(false);
    if (navigator.share) {
      navigator.share({ title: trackTitle, url: youtubeUrl || window.location.href }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(youtubeUrl || window.location.href).catch(() => {});
    }
  };

  return (
    <>
      <div className={`track-menu-container ${className || ''}`} ref={menuRef}>
        <button
          className="btn-icon track-menu-trigger"
          onClick={toggle}
          aria-label="Track options"
          aria-haspopup="true"
          aria-expanded={open}
          title="More options"
        >
          ⋯
        </button>

        {open && (
          <div className="track-menu-dropdown" role="menu" aria-label="Track options menu">
            <button className="track-menu-item" onClick={handleAddToPlaylist} role="menuitem">
              <span className="track-menu-item-icon">📋</span>
              Add to Playlist
            </button>
            {youtubeUrl && (
              <a
                className="track-menu-item"
                href={youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                <span className="track-menu-item-icon">▶️</span>
                Open on YouTube
              </a>
            )}
            {track && !track.isLiveStream && track.audioStatus === 'ready' && (
              isTrackDownloaded(trackId) ? (
                <button className="track-menu-item" onClick={() => { setOpen(false); removeDownload(trackId); }} role="menuitem">
                  <span className="track-menu-item-icon">🗑️</span>
                  Remove Download
                </button>
              ) : isTrackDownloading(trackId) ? (
                <button className="track-menu-item" disabled role="menuitem">
                  <span className="track-menu-item-icon">⬇️</span>
                  Downloading…
                </button>
              ) : (
                <button className="track-menu-item" onClick={() => { setOpen(false); startDownload(track); }} role="menuitem">
                  <span className="track-menu-item-icon">📥</span>
                  Download Offline
                </button>
              )
            )}
            <button className="track-menu-item" onClick={handleShare} role="menuitem">
              <span className="track-menu-item-icon">🔗</span>
              Share
            </button>
          </div>
        )}
      </div>

      {showPlaylistModal && (
        <AddToPlaylistModal
          trackId={trackId}
          trackTitle={trackTitle}
          onClose={() => setShowPlaylistModal(false)}
        />
      )}
    </>
  );
}
