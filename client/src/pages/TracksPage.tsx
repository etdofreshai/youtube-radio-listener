import { useState, useEffect, useCallback } from 'react';
import type { Track, CreateTrackInput, UpdateTrackInput } from '../types';
import * as api from '../api';
import TrackForm from '../components/TrackForm';

export default function TracksPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setTracks(await api.getTracks());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tracks');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: CreateTrackInput) => {
    await api.createTrack(data);
    setShowForm(false);
    load();
  };

  const handleUpdate = async (data: UpdateTrackInput) => {
    if (!editing) return;
    await api.updateTrack(editing.id, data);
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this track?')) return;
    await api.deleteTrack(id);
    load();
  };

  return (
    <>
      <div className="page-header">
        <h1>Tracks</h1>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          + Add Track
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {tracks.length === 0 ? (
        <div className="empty-state">
          <h3>No tracks yet</h3>
          <p>Add your first YouTube track to get started.</p>
        </div>
      ) : (
        <div className="track-list">
          <div className="track-row" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
            <span>Title / Artist</span>
            <span>YouTube URL</span>
            <span>Time Range</span>
            <span>Vol</span>
            <span>Actions</span>
          </div>
          {tracks.map(t => (
            <div key={t.id} className="track-row">
              <div>
                <div className="track-title">{t.title}</div>
                <div className="track-artist">{t.artist}</div>
              </div>
              <div className="track-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.youtubeUrl}
              </div>
              <div className="track-meta">
                {t.startTimeSec != null || t.endTimeSec != null
                  ? `${t.startTimeSec ?? 0}s – ${t.endTimeSec ?? '∞'}s`
                  : '—'}
              </div>
              <div className="track-meta">{t.volume}%</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(t); setShowForm(true); }}>
                  Edit
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.id)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setEditing(null); } }}>
          <div className="modal">
            <h2>{editing ? 'Edit Track' : 'Add Track'}</h2>
            <TrackForm
              initial={editing ?? undefined}
              onSubmit={editing ? handleUpdate : handleCreate}
              onCancel={() => { setShowForm(false); setEditing(null); }}
            />
          </div>
        </div>
      )}
    </>
  );
}
