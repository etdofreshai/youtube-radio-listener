import { useState } from 'react';
import type { Track, CreateTrackInput } from '../types';
import { parseEndTime } from '../utils/endTimeParse';

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
  const [endTimeText, setEndTimeText] = useState(initial?.endTimeSec?.toString() ?? '');
  const [endTimeError, setEndTimeError] = useState('');
  const [volume, setVolume] = useState(initial?.volume?.toString() ?? '100');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isEditing = !!initial;
  const hasUrl = youtubeUrl.trim().length > 0;

  /** Validate end-time text on every change; clear error once input becomes valid or empty. */
  const handleEndTimeChange = (raw: string) => {
    setEndTimeText(raw);
    if (!raw.trim()) {
      setEndTimeError('');
      return;
    }
    const result = parseEndTime(raw);
    if (result && !result.ok) {
      setEndTimeError(result.error);
    } else {
      setEndTimeError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!hasUrl) {
      setError('YouTube URL is required.');
      return;
    }

    // When editing, title and artist are still required (track already exists)
    if (isEditing && (!title.trim() || !artist.trim())) {
      setError('Title and artist are required when editing.');
      return;
    }

    // Validate and parse end-time field
    const endTimeParsed = parseEndTime(endTimeText);
    if (endTimeParsed && !endTimeParsed.ok) {
      setEndTimeError(endTimeParsed.error);
      setError('Please fix the end time field before submitting.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const data: CreateTrackInput = {
        youtubeUrl: youtubeUrl.trim(),
        startTimeSec: startTimeSec ? parseInt(startTimeSec, 10) : null,
        endTimeSec: endTimeParsed ? endTimeParsed.value : null,
        volume: volume ? Math.min(200, Math.max(0, parseInt(volume, 10))) : 100,
        notes: notes.trim(),
      };

      // Only include title/artist if user provided them (let server auto-detect if empty)
      if (title.trim()) data.title = title.trim();
      if (artist.trim()) data.artist = artist.trim();

      await onSubmit(data);
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
        <input
          value={youtubeUrl}
          onChange={e => setYoutubeUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=..."
          autoFocus={!isEditing}
        />
        {!isEditing && hasUrl && !title.trim() && !artist.trim() && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 4 }}>
            💡 Title &amp; artist will be auto-detected from the video. You can override below.
          </p>
        )}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Title{isEditing ? ' *' : ' (optional — auto-detected)'}</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={isEditing ? 'Song title' : 'Leave blank to auto-detect'} />
        </div>
        <div className="form-group">
          <label>Artist{isEditing ? ' *' : ' (optional — auto-detected)'}</label>
          <input value={artist} onChange={e => setArtist(e.target.value)} placeholder={isEditing ? 'Artist name' : 'Leave blank to auto-detect'} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Start Time (sec)</label>
          <input type="number" min="0" value={startTimeSec} onChange={e => setStartTimeSec(e.target.value)} placeholder="0" />
        </div>
        <div className="form-group">
          <label>End Time</label>
          <input
            type="text"
            value={endTimeText}
            onChange={e => handleEndTimeChange(e.target.value)}
            placeholder="e.g. 95, 1:35, or 1:35:250"
            style={endTimeError ? { borderColor: 'var(--danger)' } : undefined}
          />
          {endTimeError ? (
            <p style={{ color: 'var(--danger)', fontSize: '0.78rem', marginTop: 4 }}>
              {endTimeError}
            </p>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 4 }}>
              Accepts: <code>95</code> (secs), <code>1:35</code> (MM:SS), or <code>1:35:250</code> (MM:SS:mmm). Leave blank for no limit.
            </p>
          )}
        </div>
      </div>

      <div className="form-group">
        <label>Volume ({volume}%){parseInt(volume) > 100 ? ' ⚡ Boost' : ''}</label>
        <input type="range" min="0" max="200" value={volume} onChange={e => setVolume(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
          <span>0%</span>
          <span>100%</span>
          <span>200%</span>
        </div>
      </div>

      <div className="form-group">
        <label>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this track..." />
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? (isEditing ? 'Saving...' : 'Adding…') : (isEditing ? 'Update' : 'Add Track')}
        </button>
      </div>
    </form>
  );
}
