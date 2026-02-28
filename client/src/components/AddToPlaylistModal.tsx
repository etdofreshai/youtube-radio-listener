import { useState, useEffect, useCallback } from 'react';
import { getPlaylists, addTrackToPlaylist, createPlaylist } from '../api';
import type { Playlist } from '../types';

interface AddToPlaylistModalProps {
  trackId: string;
  trackTitle: string;
  onClose: () => void;
}

export default function AddToPlaylistModal({ trackId, trackTitle, onClose }: AddToPlaylistModalProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    try {
      const data = await getPlaylists();
      setPlaylists(data);
    } catch {
      setFeedback({ type: 'error', message: 'Failed to load playlists' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  const handleAdd = async (playlistId: string, playlistName: string) => {
    setAdding(playlistId);
    setFeedback(null);
    try {
      await addTrackToPlaylist(playlistId, trackId);
      setFeedback({ type: 'success', message: `Added to "${playlistName}"` });
      // Auto-close after success
      setTimeout(onClose, 1200);
    } catch (err: any) {
      const msg = err?.message?.includes('already')
        ? `Already in "${playlistName}"`
        : `Failed to add to "${playlistName}"`;
      setFeedback({ type: 'error', message: msg });
    } finally {
      setAdding(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setFeedback(null);
    try {
      const pl = await createPlaylist({ name: newName.trim(), trackIds: [trackId] });
      setFeedback({ type: 'success', message: `Created "${pl.name}" with track` });
      setNewName('');
      setShowCreate(false);
      setTimeout(onClose, 1200);
    } catch {
      setFeedback({ type: 'error', message: 'Failed to create playlist' });
    } finally {
      setCreating(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add to playlist">
      <div className="add-to-playlist-modal" onClick={e => e.stopPropagation()}>
        <div className="add-to-playlist-header">
          <h3>Add to Playlist</h3>
          <button className="btn-icon add-to-playlist-close" onClick={onClose} aria-label="Close" title="Close">✕</button>
        </div>

        <p className="add-to-playlist-track" title={trackTitle}>
          {trackTitle}
        </p>

        {feedback && (
          <div className={`add-to-playlist-feedback ${feedback.type === 'success' ? 'feedback-success' : 'feedback-error'}`}>
            {feedback.type === 'success' ? '✓' : '✕'} {feedback.message}
          </div>
        )}

        {loading ? (
          <div className="add-to-playlist-loading">Loading playlists…</div>
        ) : (
          <div className="add-to-playlist-list" role="listbox" aria-label="Available playlists">
            {playlists.map(pl => (
              <button
                key={pl.id}
                className="add-to-playlist-item"
                onClick={() => handleAdd(pl.id, pl.name)}
                disabled={adding !== null}
                role="option"
                aria-selected={false}
                aria-label={`Add to ${pl.name}`}
              >
                <span className="add-to-playlist-item-name">📋 {pl.name}</span>
                <span className="add-to-playlist-item-count">{pl.trackIds.length} tracks</span>
                {adding === pl.id && <span className="add-to-playlist-item-spinner">⏳</span>}
              </button>
            ))}
            {playlists.length === 0 && (
              <p className="add-to-playlist-empty">No playlists yet. Create one below!</p>
            )}
          </div>
        )}

        <div className="add-to-playlist-footer">
          {showCreate ? (
            <form onSubmit={handleCreate} className="add-to-playlist-create-form">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="New playlist name…"
                className="add-to-playlist-input"
                autoFocus
                aria-label="New playlist name"
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={creating || !newName.trim()}>
                {creating ? '⏳' : '✓'}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setShowCreate(false)}>
                ✕
              </button>
            </form>
          ) : (
            <button className="btn btn-sm add-to-playlist-new-btn" onClick={() => setShowCreate(true)}>
              + New Playlist
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
