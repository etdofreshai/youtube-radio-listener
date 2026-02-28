import { useState } from 'react';
import type { Track, CreateTrackInput } from '../types';

interface TrackFormProps {
  initial?: Track;
  onSubmit: (data: CreateTrackInput) => Promise<void>;
  onCancel: () => void;
}

export default function TrackForm({ initial, onSubmit, onCancel }: TrackFormProps) {
  const [youtubeUrl, setYoutubeUrl] = useState(initial?.youtubeUrl ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [artist, setArtist] = useState(initial?.artist ?? '');
  const [startTimeSec, setStartTimeSec] = useState(initial?.startTimeSec?.toString() ?? '');
  const [endTimeSec, setEndTimeSec] = useState(initial?.endTimeSec?.toString() ?? '');
  const [volume, setVolume] = useState(initial?.volume?.toString() ?? '80');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim() || !title.trim() || !artist.trim()) {
      setError('YouTube URL, title, and artist are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        youtubeUrl: youtubeUrl.trim(),
        title: title.trim(),
        artist: artist.trim(),
        startTimeSec: startTimeSec ? parseInt(startTimeSec, 10) : null,
        endTimeSec: endTimeSec ? parseInt(endTimeSec, 10) : null,
        volume: volume ? parseInt(volume, 10) : 80,
        notes: notes.trim(),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: '0.85rem' }}>{error}</p>}

      <div className="form-group">
        <label>YouTube URL *</label>
        <input value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Song title" />
        </div>
        <div className="form-group">
          <label>Artist *</label>
          <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist name" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Start Time (sec)</label>
          <input type="number" min="0" value={startTimeSec} onChange={e => setStartTimeSec(e.target.value)} placeholder="0" />
        </div>
        <div className="form-group">
          <label>End Time (sec)</label>
          <input type="number" min="0" value={endTimeSec} onChange={e => setEndTimeSec(e.target.value)} placeholder="∞" />
        </div>
      </div>

      <div className="form-group">
        <label>Volume ({volume}%)</label>
        <input type="range" min="0" max="100" value={volume} onChange={e => setVolume(e.target.value)} />
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this track..." />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Saving...' : (initial ? 'Update' : 'Add Track')}
        </button>
      </div>
    </form>
  );
}
