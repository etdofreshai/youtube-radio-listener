import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Playlist, CreatePlaylistInput } from '../types';
import * as api from '../api';

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setPlaylists(await api.getPlaylists());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load playlists');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const data: CreatePlaylistInput = { name: name.trim(), description: description.trim() };
    try {
      const created = await api.createPlaylist(data);
      setName('');
      setDescription('');
      setShowForm(false);
      // Navigate directly to editor for new playlist
      navigate(`/playlists/${created.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create playlist');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Don't trigger card click
    if (!confirm('Delete this playlist?')) return;
    await api.deletePlaylist(id);
    load();
  };

  return (
    <>
      <div className="page-header">
        <h1>Playlists</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + New Playlist
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {playlists.length === 0 ? (
        <div className="empty-state">
          <h3>No playlists yet</h3>
          <p>Create your first playlist to organize tracks.</p>
        </div>
      ) : (
        <div className="playlist-grid">
          {playlists.map(p => (
            <div
              key={p.id}
              className="playlist-card"
              onClick={() => navigate(`/playlists/${p.id}`)}
            >
              <h3>{p.name}</h3>
              <p>{p.description || 'No description'}</p>
              <p style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {p.trackIds.length} track{p.trackIds.length !== 1 ? 's' : ''}
              </p>
              <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => { e.stopPropagation(); navigate(`/playlists/${p.id}`); }}
                >
                  ✏️ Edit
                </button>
                <button className="btn btn-danger btn-sm" onClick={(e) => handleDelete(e, p.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal">
            <h2>New Playlist</h2>
            <div className="form-group">
              <label>Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="My awesome mix"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What's this playlist about?" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!name.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
