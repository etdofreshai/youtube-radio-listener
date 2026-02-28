import { useState, useEffect } from 'react';
import type { Track, CreateTrackInput, Artist, PlaylistImportSummary } from '../types';
import { parseEndTime } from '../utils/endTimeParse';
import { detectYouTubeUrl, isPlaylistImportUrl } from '../utils/youtubeUrl';
import * as api from '../api';

interface TrackFormProps {
  initial?: Track;
  onSubmit: (data: CreateTrackInput) => Promise<void>;
  onCancel: () => void;
  /** Called after a successful playlist import so the parent can reload. */
  onPlaylistImported?: (result: PlaylistImportSummary) => void;
}

export default function TrackForm({ initial, onSubmit, onCancel, onPlaylistImported }: TrackFormProps) {
  const [youtubeUrl, setYoutubeUrl] = useState(initial?.youtubeUrl ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [artist, setArtist] = useState(initial?.artist ?? '');
  const [startTimeSec, setStartTimeSec] = useState(initial?.startTimeSec?.toString() ?? '');
  const [endTimeText, setEndTimeText] = useState(initial?.endTimeSec?.toString() ?? '');
  const [endTimeError, setEndTimeError] = useState('');
  const [volume, setVolume] = useState(initial?.volume?.toString() ?? '100');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [isLiveStream, setIsLiveStream] = useState(initial?.isLiveStream ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Playlist-specific state
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [playlistImportResult, setPlaylistImportResult] = useState<PlaylistImportSummary | null>(null);
  const [importProgress, setImportProgress] = useState(0); // 0 = idle, >0 = in progress

  // Multi-artist state
  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  const [selectedArtistIds, setSelectedArtistIds] = useState<string[]>(
    initial?.artists?.map(a => a.id) ?? []
  );
  const [artistSearch, setArtistSearch] = useState('');
  const [showArtistDropdown, setShowArtistDropdown] = useState(false);

  const isEditing = !!initial;
  const hasUrl = youtubeUrl.trim().length > 0;

  // Load available artists
  useEffect(() => {
    api.getArtists().then(setAllArtists).catch(() => {});
  }, []);

  // Auto-detect URL type whenever youtubeUrl changes
  const handleUrlChange = (val: string) => {
    setYoutubeUrl(val);
    if (!isEditing) {
      setIsPlaylist(isPlaylistImportUrl(val));
      // Reset any previous import result when URL changes
      setPlaylistImportResult(null);
      setError('');
    }
  };

  /** Validate end-time text on every change */
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

  const handleAddArtist = (artistId: string) => {
    if (!selectedArtistIds.includes(artistId)) {
      setSelectedArtistIds(prev => [...prev, artistId]);
    }
    setArtistSearch('');
    setShowArtistDropdown(false);
  };

  const handleRemoveArtist = (artistId: string) => {
    setSelectedArtistIds(prev => prev.filter(id => id !== artistId));
  };

  const filteredArtists = allArtists.filter(a =>
    !selectedArtistIds.includes(a.id) &&
    a.name.toLowerCase().includes(artistSearch.toLowerCase())
  );

  const buildCreateInput = (): CreateTrackInput => {
    const endTimeParsed = parseEndTime(endTimeText);
    const data: CreateTrackInput = {
      youtubeUrl: youtubeUrl.trim(),
      startTimeSec: startTimeSec ? parseInt(startTimeSec, 10) : null,
      endTimeSec: (endTimeParsed && endTimeParsed.ok) ? endTimeParsed.value : null,
      volume: volume ? Math.min(200, Math.max(0, parseInt(volume, 10))) : 100,
      notes: notes.trim(),
      isLiveStream,
    };
    if (title.trim()) data.title = title.trim();
    if (artist.trim()) data.artist = artist.trim();
    if (selectedArtistIds.length > 0) data.artistIds = selectedArtistIds;
    return data;
  };

  // ── Playlist import handler ───────────────────────────────────────────────

  const handlePlaylistSubmit = async () => {
    if (!hasUrl) {
      setError('YouTube URL is required.');
      return;
    }

    setSubmitting(true);
    setError('');
    setImportProgress(1);

    try {
      const data = buildCreateInput();
      const result = await api.importPlaylistUrl(data);
      setPlaylistImportResult(result);
      onPlaylistImported?.(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Playlist import failed');
    } finally {
      setSubmitting(false);
      setImportProgress(0);
    }
  };

  // ── Single track submit handler ───────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Delegate to playlist handler when applicable
    if (isPlaylist && !isEditing) {
      await handlePlaylistSubmit();
      return;
    }

    if (!hasUrl) {
      setError('YouTube URL is required.');
      return;
    }

    if (isEditing && (!title.trim() || !artist.trim())) {
      setError('Title and artist are required when editing.');
      return;
    }

    const endTimeParsed = parseEndTime(endTimeText);
    if (endTimeParsed && !endTimeParsed.ok) {
      setEndTimeError(endTimeParsed.error);
      setError('Please fix the end time field before submitting.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onSubmit(buildCreateInput());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Playlist summary view ─────────────────────────────────────────────────

  if (playlistImportResult) {
    const { added, skipped_existing, failed, total, playlistTitle, truncated, limit } = playlistImportResult;
    return (
      <div>
        <h3 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          📋 Playlist Import Complete
        </h3>

        {playlistTitle && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 16px' }}>
            <strong>{playlistTitle}</strong>
          </p>
        )}

        {truncated && (
          <div style={{
            background: 'var(--warning-bg, #fff3cd)',
            border: '1px solid var(--warning, #ffc107)',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 14,
            fontSize: '0.85rem',
          }}>
            ⚠️ Playlist was capped at <strong>{limit}</strong> tracks. The full playlist has more items.
          </div>
        )}

        {/* Summary stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={summaryBadgeStyle('var(--success, #28a745)')}>
            ✅ <strong>{added.length}</strong> added
          </div>
          <div style={summaryBadgeStyle('var(--text-muted, #888)')}>
            ⏭ <strong>{skipped_existing.length}</strong> already existed
          </div>
          {failed.length > 0 && (
            <div style={summaryBadgeStyle('var(--danger, #dc3545)')}>
              ❌ <strong>{failed.length}</strong> failed
            </div>
          )}
          <div style={summaryBadgeStyle('var(--text-muted, #888)')}>
            Total: {total}
          </div>
        </div>

        {/* Added tracks */}
        {added.length > 0 && (
          <details open style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--success, #28a745)' }}>
              ✅ Added ({added.length})
            </summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: '0.82rem', maxHeight: 160, overflowY: 'auto' }}>
              {added.map(t => (
                <li key={t.id}><strong>{t.title}</strong>{t.artist ? ` — ${t.artist}` : ''}</li>
              ))}
            </ul>
          </details>
        )}

        {/* Skipped existing */}
        {skipped_existing.length > 0 && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              ⏭ Already existed ({skipped_existing.length})
            </summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: '0.82rem', maxHeight: 120, overflowY: 'auto' }}>
              {skipped_existing.map(s => (
                <li key={s.videoId}>{s.title ?? s.videoId}</li>
              ))}
            </ul>
          </details>
        )}

        {/* Failed */}
        {failed.length > 0 && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: 'var(--danger, #dc3545)' }}>
              ❌ Failed ({failed.length})
            </summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: '0.82rem', maxHeight: 120, overflowY: 'auto' }}>
              {failed.map(f => (
                <li key={f.videoId}>
                  <strong>{f.title ?? f.videoId}</strong>: {f.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onCancel}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Normal form ───────────────────────────────────────────────────────────

  const urlKindInfo = hasUrl ? detectYouTubeUrl(youtubeUrl.trim()) : null;

  return (
    <form onSubmit={handleSubmit}>
      {error && <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: '0.85rem' }}>{error}</p>}

      <div className="form-group">
        <label>YouTube URL *</label>
        <input
          value={youtubeUrl}
          onChange={e => handleUrlChange(e.target.value)}
          placeholder="https://youtube.com/watch?v=... or playlist URL"
          autoFocus={!isEditing}
        />

        {/* URL type indicator */}
        {!isEditing && hasUrl && urlKindInfo && (
          <div style={{ marginTop: 4 }}>
            {urlKindInfo.kind === 'playlist' && (
              <p style={{ color: 'var(--primary, #4f8ef7)', fontSize: '0.82rem', margin: 0 }}>
                📋 <strong>Playlist URL detected</strong> — all videos will be imported (up to 100 tracks).
              </p>
            )}
            {urlKindInfo.kind === 'video_with_playlist' && (
              <p style={{ color: 'var(--primary, #4f8ef7)', fontSize: '0.82rem', margin: 0 }}>
                📋 <strong>Video + Playlist URL detected</strong> — the full playlist will be imported (up to 100 tracks).
              </p>
            )}
            {urlKindInfo.kind === 'single_video' && !title.trim() && !artist.trim() && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>
                💡 Title &amp; artist will be auto-detected from the video. You can override below.
              </p>
            )}
            {urlKindInfo.kind === 'not_supported' && (
              <p style={{ color: 'var(--warning, #ffc107)', fontSize: '0.82rem', margin: 0 }}>
                ⚠️ Channel / user URLs are not supported. Paste a video or playlist URL.
              </p>
            )}
          </div>
        )}

        {/* Loading indicator during playlist import */}
        {importProgress > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
            color: 'var(--primary, #4f8ef7)', fontSize: '0.85rem',
          }}>
            <span className="spinner" style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
            Importing playlist tracks… this may take a while.
          </div>
        )}
      </div>

      {/* Playlist mode: hide most fields (they don't apply to batch imports) */}
      {!isPlaylist && (
        <>
          {/* Live Stream toggle */}
          <div className="form-group">
            <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isLiveStream}
                onChange={e => setIsLiveStream(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span>
                {isLiveStream ? '📡 Live Stream' : '🎵 Downloaded Track'}
              </span>
            </label>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 4 }}>
              {isLiveStream
                ? 'Audio will be streamed live from YouTube at play time. No file is downloaded.'
                : 'Audio will be downloaded and stored locally for offline playback. Auto-detected for live YouTube URLs.'
              }
            </p>
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

          {/* Multi-artist linking */}
          {allArtists.length > 0 && (
            <div className="form-group">
              <label>Link to Artists (optional)</label>
              {/* Selected artist chips */}
              {selectedArtistIds.length > 0 && (
                <div className="artist-chips">
                  {selectedArtistIds.map((id, idx) => {
                    const a = allArtists.find(x => x.id === id);
                    return a ? (
                      <span key={id} className="artist-chip">
                        {idx === 0 ? '★' : '+'} {a.name}
                        <button type="button" className="artist-chip-remove" onClick={() => handleRemoveArtist(id)}>✕</button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}
              {/* Search/add dropdown */}
              <div className="artist-search-wrapper">
                <input
                  type="text"
                  value={artistSearch}
                  onChange={e => { setArtistSearch(e.target.value); setShowArtistDropdown(true); }}
                  onFocus={() => setShowArtistDropdown(true)}
                  onBlur={() => setTimeout(() => setShowArtistDropdown(false), 200)}
                  placeholder="Search artists to link…"
                  className="artist-search-input"
                />
                {showArtistDropdown && artistSearch && filteredArtists.length > 0 && (
                  <div className="artist-dropdown">
                    {filteredArtists.slice(0, 8).map(a => (
                      <div key={a.id} className="artist-dropdown-item" onMouseDown={() => handleAddArtist(a.id)}>
                        {a.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 4 }}>
                First artist = primary. Additional artists are marked as featured.
              </p>
            </div>
          )}

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
        </>
      )}

      {/* Playlist mode: simplified info */}
      {isPlaylist && !isEditing && (
        <div style={{
          background: 'var(--surface-alt, rgba(79,142,247,0.08))',
          border: '1px solid var(--primary, #4f8ef7)',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
        }}>
          <strong style={{ color: 'var(--text)' }}>📋 Playlist import mode</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>All videos in the playlist will be added (up to 100 tracks per run).</li>
            <li>Tracks that already exist will be skipped automatically.</li>
            <li>Failures are reported without aborting the import.</li>
          </ul>
        </div>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting || !hasUrl}>
          {submitting
            ? (isPlaylist ? '📋 Importing…' : (isEditing ? 'Saving...' : 'Adding…'))
            : (isPlaylist ? '📋 Import Playlist' : (isEditing ? 'Update' : 'Add Track'))
          }
        </button>
      </div>
    </form>
  );
}

// ── Internal helper ───────────────────────────────────────────────────────────

function summaryBadgeStyle(color: string): React.CSSProperties {
  return {
    background: 'var(--surface-alt, rgba(0,0,0,0.04))',
    border: `1px solid ${color}`,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: '0.85rem',
    color,
  };
}
