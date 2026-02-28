import { useState, useEffect, useCallback, useRef } from 'react';
import type { Track, CreateTrackInput, UpdateTrackInput } from '../types';
import * as api from '../api';
import TrackForm from '../components/TrackForm';
import { useAudioPlayer } from '../components/AudioPlayer';

export default function TracksPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { play, pause, currentTrack, isPlaying, setPlaylist } = useAudioPlayer();

  const load = useCallback(async () => {
    try {
      const data = await api.getTracks();
      setTracks(data);
      setPlaylist(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tracks');
    }
  }, [setPlaylist]);

  useEffect(() => { load(); }, [load]);

  // Poll for status updates while any track is downloading
  useEffect(() => {
    const hasDownloading = tracks.some(t => t.audioStatus === 'downloading' || t.audioStatus === 'pending');
    if (hasDownloading && !pollRef.current) {
      pollRef.current = setInterval(load, 3000);
    } else if (!hasDownloading && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [tracks, load]);

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

  const handlePlay = (track: Track) => {
    if (currentTrack?.id === track.id && isPlaying) {
      pause();
    } else {
      play(track);
    }
  };

  const handleRefresh = async (id: string) => {
    await api.refreshTrack(id);
    load();
  };

  const handleDownload = async (id: string) => {
    await api.downloadTrack(id);
    load();
  };

  function formatDuration(sec: number | null): string {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function AudioStatusBadge({ track }: { track: Track }) {
    switch (track.audioStatus) {
      case 'ready':
        return <span className="badge badge-ready">● Ready</span>;
      case 'downloading':
        return <span className="badge badge-downloading">⏳ Downloading…</span>;
      case 'pending':
        return <span className="badge badge-pending">○ Pending</span>;
      case 'error':
        return (
          <span className="badge badge-error" title={track.audioError || 'Download failed'}>
            ✕ Error
          </span>
        );
      default:
        return null;
    }
  }

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
          <div className="track-row track-header">
            <span></span>
            <span>Title / Artist</span>
            <span>Duration</span>
            <span>Status</span>
            <span>Vol</span>
            <span>Actions</span>
          </div>
          {tracks.map(t => {
            const isCurrent = currentTrack?.id === t.id;
            const canPlay = t.audioStatus === 'ready';
            return (
              <div key={t.id} className={`track-row ${isCurrent ? 'track-active' : ''}`}>
                {/* Play button */}
                <div>
                  {canPlay ? (
                    <button
                      className={`btn-play ${isCurrent && isPlaying ? 'playing' : ''}`}
                      onClick={() => handlePlay(t)}
                      title={isCurrent && isPlaying ? 'Pause' : 'Play'}
                    >
                      {isCurrent && isPlaying ? '⏸' : '▶'}
                    </button>
                  ) : t.audioStatus === 'downloading' ? (
                    <span className="btn-play disabled" title="Downloading...">⏳</span>
                  ) : (
                    <span className="btn-play disabled" title="Audio not ready">▶</span>
                  )}
                </div>

                {/* Title / Artist */}
                <div>
                  <div className="track-title">{t.title}</div>
                  <div className="track-artist">{t.artist}</div>
                </div>

                {/* Duration */}
                <div className="track-meta">{formatDuration(t.duration)}</div>

                {/* Status */}
                <div>
                  <AudioStatusBadge track={t} />
                </div>

                {/* Volume */}
                <div className="track-meta">{t.volume}%</div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {t.audioStatus === 'ready' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleRefresh(t.id)} title="Re-download audio">
                      🔄
                    </button>
                  )}
                  {(t.audioStatus === 'error' || t.audioStatus === 'pending') && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleDownload(t.id)} title="Download audio">
                      ⬇️
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(t); setShowForm(true); }}>
                    Edit
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.id)}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
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
