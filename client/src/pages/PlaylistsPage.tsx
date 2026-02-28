import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Playlist, CreatePlaylistInput } from '../types';
import * as api from '../api';

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isEditableByOthers, setIsEditableByOthers] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const currentUserId = api.getActiveUserId() || '00000000-0000-0000-0000-000000000001';

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
    const data: CreatePlaylistInput = {
      name: name.trim(),
      description: description.trim(),
      isPublic,
      isEditableByOthers,
    };
    try {
      const created = await api.createPlaylist(data);
      setName('');
      setDescription('');
      setIsPublic(false);
      setIsEditableByOthers(false);
      setShowForm(false);
      navigate(`/playlists/${created.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create playlist');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this playlist?')) return;
    try {
      await api.deletePlaylist(id);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete playlist');
    }
  };

  /** True when current user can edit this playlist */
  function canEdit(p: Playlist): boolean {
    if (!p.ownerId) return true;          // legacy — open to all
    if (p.ownerId === currentUserId) return true; // owner
    return p.isEditableByOthers;
  }

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
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {p.isPublic && (
                    <span title="Public playlist" style={{
                      fontSize: '0.7rem', padding: '2px 6px', borderRadius: 10,
                      background: 'var(--accent, #3b82f6)', color: '#fff', fontWeight: 600,
                    }}>🌐 Public</span>
                  )}
                  {p.isEditableByOthers && (
                    <span title="Anyone can edit" style={{
                      fontSize: '0.7rem', padding: '2px 6px', borderRadius: 10,
                      background: 'var(--warning, #f59e0b)', color: '#fff', fontWeight: 600,
                    }}>✏️ Shared</span>
                  )}
                </div>
              </div>

              <p style={{ margin: '6px 0 4px' }}>{p.description || 'No description'}</p>

              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {p.trackIds.length} track{p.trackIds.length !== 1 ? 's' : ''}
              </p>

              {p.ownerUsername && (
                <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  👤 {p.ownerUsername}
                </p>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                {canEdit(p) && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => { e.stopPropagation(); navigate(`/playlists/${p.id}`); }}
                  >
                    ✏️ Edit
                  </button>
                )}
                {(!p.ownerId || p.ownerId === currentUserId) && (
                  <button className="btn btn-danger btn-sm" onClick={(e) => handleDelete(e, p.id)}>
                    Delete
                  </button>
                )}
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
            <div className="form-group" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={e => setIsPublic(e.target.checked)}
                />
                🌐 Public (visible to all)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isEditableByOthers}
                  onChange={e => setIsEditableByOthers(e.target.checked)}
                />
                ✏️ Editable by others
              </label>
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
