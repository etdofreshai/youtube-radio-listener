import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Playlist, Track } from '../types';
import * as api from '../api';
import { useAudioPlayer } from '../components/AudioPlayer';

type Toast = { message: string; type: 'success' | 'error' };

export default function PlaylistEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);

  // Editable metadata
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [editIsEditableByOthers, setEditIsEditableByOthers] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Search filter for available tracks
  const [search, setSearch] = useState('');

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  const currentUserId = api.getActiveUserId() || '00000000-0000-0000-0000-000000000001';
  const { playPlaylist } = useAudioPlayer();

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [pl, tracksResult] = await Promise.all([api.getPlaylist(id), api.getTracks({ pageSize: 200 })]);
      setPlaylist(pl);
      setAllTracks(tracksResult.data);
      setEditName(pl.name);
      setEditDesc(pl.description);
      setEditIsPublic(pl.isPublic);
      setEditIsEditableByOthers(pl.isEditableByOthers);
      setMetaDirty(false);
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load playlist');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Track lookup
  const trackMap = new Map(allTracks.map(t => [t.id, t]));

  // Tracks in playlist (resolved)
  const playlistTracks = (playlist?.trackIds ?? [])
    .map(tid => trackMap.get(tid))
    .filter((t): t is Track => !!t);

  // Available tracks (not in playlist)
  const playlistTrackSet = new Set(playlist?.trackIds ?? []);
  const availableTracks = allTracks.filter(t => {
    if (playlistTrackSet.has(t.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q);
  });

  /** Whether the current user can edit this playlist */
  function canEdit(p: Playlist): boolean {
    if (!p.ownerId) return true;
    if (p.ownerId === currentUserId) return true;
    return p.isEditableByOthers;
  }

  // --- Handlers ---

  const handleSaveMeta = async () => {
    if (!playlist || !editName.trim()) return;
    try {
      setSaving(true);
      const updated = await api.updatePlaylist(playlist.id, {
        name: editName.trim(),
        description: editDesc.trim(),
        isPublic: editIsPublic,
        isEditableByOthers: editIsEditableByOthers,
      });
      setPlaylist(updated);
      setMetaDirty(false);
      showToast('Playlist updated');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTrack = async (trackId: string) => {
    if (!playlist) return;
    try {
      const updated = await api.addTrackToPlaylist(playlist.id, trackId);
      setPlaylist(updated);
      showToast('Track added');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to add track', 'error');
    }
  };

  const handleRemoveTrack = async (trackId: string) => {
    if (!playlist) return;
    try {
      const updated = await api.removeTrackFromPlaylist(playlist.id, trackId);
      setPlaylist(updated);
      showToast('Track removed');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to remove track', 'error');
    }
  };

  const handleMoveTrack = async (fromIndex: number, toIndex: number) => {
    if (!playlist) return;
    const ids = [...playlist.trackIds];
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    setPlaylist({ ...playlist, trackIds: ids });
    try {
      const updated = await api.reorderPlaylistTracks(playlist.id, ids);
      setPlaylist(updated);
    } catch (e: unknown) {
      load();
      showToast(e instanceof Error ? e.message : 'Failed to reorder', 'error');
    }
  };

  // Drag-and-drop handlers
  const handleDragStart = (index: number) => { dragItem.current = index; };
  const handleDragEnter = (index: number) => { dragOver.current = index; };
  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOver.current !== null && dragItem.current !== dragOver.current) {
      handleMoveTrack(dragItem.current, dragOver.current);
    }
    dragItem.current = null;
    dragOver.current = null;
  };

  const handlePlayAll = useCallback(() => {
    if (!playlist || playlistTracks.length === 0) return;
    playPlaylist(playlist.id, playlist.name, playlistTracks);
    showToast(`▶ Playing "${playlist.name}" — ${playlistTracks.length} track${playlistTracks.length !== 1 ? 's' : ''}`);
  }, [playlist, playlistTracks, playPlaylist, showToast]);

  const handleDeletePlaylist = async () => {
    if (!playlist || !confirm(`Delete playlist "${playlist.name}"?`)) return;
    try {
      await api.deletePlaylist(playlist.id);
      navigate('/playlists');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error');
    }
  };

  // --- Render ---

  if (loading) {
    return <div className="empty-state"><p>Loading...</p></div>;
  }

  if (error || !playlist) {
    return (
      <div className="empty-state">
        <h3>Error</h3>
        <p>{error || 'Playlist not found'}</p>
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => navigate('/playlists')}>
          ← Back to Playlists
        </button>
      </div>
    );
  }

  const userCanEdit = canEdit(playlist);
  const isOwner = !playlist.ownerId || playlist.ownerId === currentUserId;

  return (
    <div className="playlist-editor">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/playlists')}>
            ← Back
          </button>
          <h1>Edit Playlist</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {playlistTracks.length > 0 && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handlePlayAll}
              title={`Play all ${playlistTracks.length} tracks in order`}
            >
              ▶ Play All ({playlistTracks.length})
            </button>
          )}
          {isOwner && (
            <button className="btn btn-danger btn-sm" onClick={handleDeletePlaylist}>
              🗑 Delete Playlist
            </button>
          )}
        </div>
      </div>

      {/* Ownership info */}
      <div style={{
        fontSize: '0.8rem', color: 'var(--text-muted)',
        display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12,
      }}>
        {playlist.ownerUsername && (
          <span>👤 Owner: <strong>{playlist.ownerUsername}</strong></span>
        )}
        {playlist.updatedByUsername && (
          <span>📝 Last updated by: <strong>{playlist.updatedByUsername}</strong></span>
        )}
        {playlist.isPublic && (
          <span style={{ color: 'var(--accent, #3b82f6)' }}>🌐 Public</span>
        )}
        {playlist.isEditableByOthers && (
          <span style={{ color: 'var(--warning, #f59e0b)' }}>✏️ Editable by others</span>
        )}
      </div>

      {/* Metadata section */}
      <section className="editor-section">
        <h2 className="editor-section-title">Details</h2>
        <div className="editor-meta-form">
          <div className="form-group">
            <label>Name</label>
            <input
              value={editName}
              onChange={e => { setEditName(e.target.value); setMetaDirty(true); }}
              placeholder="Playlist name"
              disabled={!userCanEdit}
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              value={editDesc}
              onChange={e => { setEditDesc(e.target.value); setMetaDirty(true); }}
              placeholder="Optional description"
              rows={2}
              disabled={!userCanEdit}
            />
          </div>

          {/* Sharing controls — only owner can change these */}
          {isOwner && (
            <div className="form-group" style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editIsPublic}
                  onChange={e => { setEditIsPublic(e.target.checked); setMetaDirty(true); }}
                />
                🌐 Shareable (public)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editIsEditableByOthers}
                  onChange={e => { setEditIsEditableByOthers(e.target.checked); setMetaDirty(true); }}
                />
                ✏️ Editable by others
              </label>
            </div>
          )}

          {metaDirty && userCanEdit && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSaveMeta}
                disabled={saving || !editName.trim()}
              >
                {saving ? 'Saving...' : '💾 Save Changes'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setEditName(playlist.name);
                  setEditDesc(playlist.description);
                  setEditIsPublic(playlist.isPublic);
                  setEditIsEditableByOthers(playlist.isEditableByOthers);
                  setMetaDirty(false);
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {!userCanEdit && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              🔒 You can view this playlist but not edit it.
            </p>
          )}
        </div>
      </section>

      {/* Two-panel layout */}
      <div className="editor-panels">
        {/* Left: Playlist tracks */}
        <section className="editor-section editor-panel">
          <h2 className="editor-section-title">
            Playlist Tracks
            <span className="editor-count">{playlistTracks.length}</span>
            {playlistTracks.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handlePlayAll}
                style={{ marginLeft: 8 }}
                title="Play all tracks in order"
              >
                ▶ Play
              </button>
            )}
          </h2>
          {playlistTracks.length === 0 ? (
            <div className="editor-empty">
              <p>No tracks yet. {userCanEdit ? 'Add tracks from the right panel →' : 'No tracks in this playlist.'}</p>
            </div>
          ) : (
            <div className="editor-track-list">
              {playlistTracks.map((track, index) => (
                <div
                  key={track.id}
                  className="editor-track-item"
                  draggable={userCanEdit}
                  onDragStart={() => userCanEdit && handleDragStart(index)}
                  onDragEnter={() => userCanEdit && handleDragEnter(index)}
                  onDragEnd={() => userCanEdit && handleDragEnd()}
                  onDragOver={e => e.preventDefault()}
                >
                  {userCanEdit && <span className="editor-track-grip" title="Drag to reorder">⠿</span>}
                  <span className="editor-track-number">{index + 1}</span>
                  <div className="editor-track-info">
                    <div className="track-title">{track.title}</div>
                    <div className="track-artist">{track.artist}</div>
                  </div>
                  {userCanEdit && (
                    <div className="editor-track-actions">
                      <button
                        className="btn-icon"
                        title="Move up"
                        disabled={index === 0}
                        onClick={() => handleMoveTrack(index, index - 1)}
                      >▲</button>
                      <button
                        className="btn-icon"
                        title="Move down"
                        disabled={index === playlistTracks.length - 1}
                        onClick={() => handleMoveTrack(index, index + 1)}
                      >▼</button>
                      <button
                        className="btn-icon editor-remove-btn"
                        title="Remove from playlist"
                        onClick={() => handleRemoveTrack(track.id)}
                      >✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right: Available tracks — only shown if user can edit */}
        {userCanEdit && (
          <section className="editor-section editor-panel">
            <h2 className="editor-section-title">
              Available Tracks
              <span className="editor-count">{availableTracks.length}</span>
            </h2>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search tracks..."
                style={{ fontSize: '0.85rem' }}
              />
            </div>
            {availableTracks.length === 0 ? (
              <div className="editor-empty">
                <p>{search ? 'No matching tracks' : allTracks.length === 0 ? 'No tracks exist yet' : 'All tracks are in this playlist'}</p>
              </div>
            ) : (
              <div className="editor-track-list">
                {availableTracks.map(track => (
                  <div key={track.id} className="editor-track-item editor-track-available">
                    <div className="editor-track-info">
                      <div className="track-title">{track.title}</div>
                      <div className="track-artist">{track.artist}</div>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleAddTrack(track.id)}
                    >
                      + Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="toast"
          style={{
            borderColor: toast.type === 'error' ? 'var(--danger)' : 'var(--success)',
            borderLeft: `3px solid ${toast.type === 'error' ? 'var(--danger)' : 'var(--success)'}`,
          }}
        >
          {toast.type === 'error' ? '❌ ' : '✅ '}{toast.message}
        </div>
      )}
    </div>
  );
}
