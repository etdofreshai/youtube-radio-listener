import { useState, useEffect, useCallback, useRef } from 'react';
import type { Track, CreateTrackInput, UpdateTrackInput, SortableTrackField, SortDirection } from '../types';
import * as api from '../api';
import TrackForm from '../components/TrackForm';
import { useAudioPlayer } from '../components/AudioPlayer';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Column definitions for the sortable table
interface ColumnDef {
  key: string;
  label: string;
  sortField?: SortableTrackField;
  width?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'play', label: '', width: '40px' },
  { key: 'title', label: 'Title', sortField: 'title' },
  { key: 'artist', label: 'Artist', sortField: 'artist' },
  { key: 'duration', label: 'Duration', sortField: 'duration', width: '80px' },
  { key: 'status', label: 'Status', width: '110px' },
  { key: 'verified', label: '✓', sortField: 'verified', width: '50px' },
  { key: 'dateAdded', label: 'Date Added', sortField: 'createdAt', width: '110px' },
  { key: 'actions', label: 'Actions', width: '160px' },
];

export default function TracksPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [error, setError] = useState('');
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pagination + sort state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState<SortableTrackField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');

  const { play, pause, currentTrack, isPlaying, setPlaylist } = useAudioPlayer();

  const load = useCallback(async () => {
    try {
      const result = await api.getTracks({ page, pageSize, sortBy, sortDir, search: search || undefined });
      setTracks(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setPlaylist(result.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tracks');
    }
  }, [page, pageSize, sortBy, sortDir, search, setPlaylist]);

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

  // ---------- Handlers ----------

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

  const handleVerify = async (track: Track) => {
    await api.verifyTrack(track.id, !track.verified);
    load();
  };

  const handleEnrich = async (id: string) => {
    setEnrichingIds(prev => new Set(prev).add(id));
    try {
      await api.enrichTrack(id);
      load();
    } finally {
      setEnrichingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleSort = (field: SortableTrackField) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir(field === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(1); // Reset to page 1 on sort change
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  // ---------- Helpers ----------

  function formatDuration(sec: number | null): string {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function SortIndicator({ field }: { field: SortableTrackField }) {
    if (sortBy !== field) return <span className="sort-indicator">⇅</span>;
    return <span className="sort-indicator active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
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

  // ---------- Expandable Detail Panel ----------

  function TrackDetail({ track }: { track: Track }) {
    return (
      <div className="track-detail">
        <div className="track-detail-grid">
          {/* Left column: basic info */}
          <div className="track-detail-section">
            <h4>Track Info</h4>
            <dl>
              <dt>YouTube URL</dt>
              <dd><a href={track.youtubeUrl} target="_blank" rel="noopener">{track.youtubeUrl}</a></dd>
              <dt>Volume</dt>
              <dd>{track.volume}%{track.volume > 100 ? ' ⚡' : ''}</dd>
              {track.notes && <><dt>Notes</dt><dd>{track.notes}</dd></>}
              <dt>Date/Time Added</dt>
              <dd>{formatDateTime(track.createdAt)}</dd>
              <dt>Last Updated</dt>
              <dd>{formatDateTime(track.updatedAt)}</dd>
            </dl>
          </div>

          {/* Right column: metadata */}
          <div className="track-detail-section">
            <h4>
              Metadata
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => handleEnrich(track.id)}
                disabled={enrichingIds.has(track.id)}
              >
                {enrichingIds.has(track.id) ? '⏳ Enriching…' : '🔍 Enrich'}
              </button>
            </h4>
            <dl>
              {track.ytChannel && <><dt>Channel</dt><dd>{track.ytChannel}</dd></>}
              {track.ytUploadDate && <><dt>Upload Date</dt><dd>{track.ytUploadDate}</dd></>}
              {track.album && <><dt>Album</dt><dd>{track.album}</dd></>}
              {track.releaseYear && <><dt>Release Year</dt><dd>{track.releaseYear}</dd></>}
              {track.genre && <><dt>Genre</dt><dd>{track.genre}</dd></>}
              {track.label && <><dt>Label</dt><dd>{track.label}</dd></>}
              {track.ytViewCount != null && <><dt>Views</dt><dd>{track.ytViewCount.toLocaleString()}</dd></>}
              {track.ytLikeCount != null && <><dt>Likes</dt><dd>{track.ytLikeCount.toLocaleString()}</dd></>}
              {track.bpm && <><dt>BPM</dt><dd>{track.bpm}</dd></>}
              {track.isrc && <><dt>ISRC</dt><dd>{track.isrc}</dd></>}
            </dl>
            {track.metadataSource && (
              <div className="track-detail-provenance">
                Source: {track.metadataSource}
                {track.metadataConfidence && ` · Confidence: ${track.metadataConfidence}`}
                {track.lastEnrichedAt && ` · Enriched: ${formatDate(track.lastEnrichedAt)}`}
              </div>
            )}
            {!track.metadataSource && !track.lastEnrichedAt && (
              <p className="track-detail-provenance">Not yet enriched. Click "Enrich" to fetch metadata.</p>
            )}
          </div>
        </div>

        {/* Verification */}
        {track.verified && track.verifiedAt && (
          <div className="track-detail-provenance" style={{ marginTop: 8 }}>
            ✅ Verified {track.verifiedBy ? `by ${track.verifiedBy}` : ''} on {formatDateTime(track.verifiedAt)}
          </div>
        )}
      </div>
    );
  }

  // ---------- Render ----------

  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  return (
    <>
      <div className="page-header">
        <h1>Tracks</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* Search */}
          <form onSubmit={handleSearchSubmit} className="tracks-search">
            <input
              type="text"
              placeholder="Search tracks…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="search-input"
            />
            {search && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </form>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            + Add Track
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {tracks.length === 0 && !search ? (
        <div className="empty-state">
          <h3>No tracks yet</h3>
          <p>Add your first YouTube track to get started.</p>
        </div>
      ) : tracks.length === 0 && search ? (
        <div className="empty-state">
          <h3>No results</h3>
          <p>No tracks match "{search}"</p>
        </div>
      ) : (
        <>
          <div className="track-list">
            {/* Header row */}
            <div className="track-row track-header">
              {COLUMNS.map(col => (
                <span
                  key={col.key}
                  className={col.sortField ? 'sortable-header' : ''}
                  onClick={col.sortField ? () => handleSort(col.sortField!) : undefined}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.label}
                  {col.sortField && <SortIndicator field={col.sortField} />}
                </span>
              ))}
            </div>

            {/* Data rows */}
            {tracks.map(t => {
              const isCurrent = currentTrack?.id === t.id;
              const canPlay = t.audioStatus === 'ready';
              const isExpanded = expandedTrackId === t.id;

              return (
                <div key={t.id}>
                  <div className={`track-row ${isCurrent ? 'track-active' : ''} ${isExpanded ? 'track-expanded' : ''}`}>
                    {/* Play */}
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

                    {/* Title (clickable to expand) */}
                    <div
                      className="track-title-cell"
                      onClick={() => setExpandedTrackId(isExpanded ? null : t.id)}
                      title="Click to expand details"
                    >
                      <div className="track-title">{t.title}</div>
                      {t.album && <div className="track-album">{t.album}</div>}
                    </div>

                    {/* Artist */}
                    <div className="track-artist">{t.artist}</div>

                    {/* Duration */}
                    <div className="track-meta">{formatDuration(t.duration)}</div>

                    {/* Status */}
                    <div>
                      <AudioStatusBadge track={t} />
                    </div>

                    {/* Verified */}
                    <div>
                      <button
                        className={`btn-verify ${t.verified ? 'verified' : ''}`}
                        onClick={() => handleVerify(t)}
                        title={t.verified ? 'Verified — click to unverify' : 'Click to verify'}
                      >
                        {t.verified ? '✅' : '○'}
                      </button>
                    </div>

                    {/* Date Added */}
                    <div className="track-meta" title={formatDateTime(t.createdAt)}>
                      {formatDate(t.createdAt)}
                    </div>

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

                  {/* Expandable detail panel */}
                  {isExpanded && <TrackDetail track={t} />}
                </div>
              );
            })}
          </div>

          {/* Pagination controls */}
          <div className="pagination">
            <div className="pagination-info">
              Showing {startItem}–{endItem} of {total} tracks
            </div>

            <div className="pagination-controls">
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(1)}
                title="First page"
              >
                ««
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                title="Previous page"
              >
                «
              </button>

              <span className="pagination-page">
                Page {page} of {totalPages}
              </span>

              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                title="Next page"
              >
                »
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                title="Last page"
              >
                »»
              </button>
            </div>

            <div className="pagination-size">
              <label>Per page:</label>
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              >
                {PAGE_SIZE_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </>
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
