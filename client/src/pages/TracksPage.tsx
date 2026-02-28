import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Track, CreateTrackInput, UpdateTrackInput, SortableTrackField, SortDirection, EnrichmentStatus } from '../types';
import * as api from '../api';
import TrackForm from '../components/TrackForm';
import YouTubeSearch from '../components/YouTubeSearch';
import { useAudioPlayer } from '../components/AudioPlayer';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface ColumnDef {
  key: string;
  label: string;
  sortField?: SortableTrackField;
  className?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'play', label: '' },
  { key: 'title', label: 'Title', sortField: 'title' },
  { key: 'artist', label: 'Artist', sortField: 'artist' },
  { key: 'duration', label: '🕐', sortField: 'duration', className: 'col-duration' },
  { key: 'actions', label: '', className: 'col-actions' },
];

export default function TracksPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [error, setError] = useState('');
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [showYtSearch, setShowYtSearch] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Pagination + sort
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

  // Poll while any track is downloading or enriching
  useEffect(() => {
    const hasActive = tracks.some(t =>
      t.audioStatus === 'downloading' || t.audioStatus === 'pending' ||
      t.videoStatus === 'downloading' || t.videoStatus === 'pending' ||
      t.enrichmentStatus === 'stage_a' || t.enrichmentStatus === 'stage_b' || t.enrichmentStatus === 'queued'
    );
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(load, 3000);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [tracks, load]);

  // Close action menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  // Handlers
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
    setOpenMenuId(null);
    load();
  };

  const handlePlay = (track: Track) => {
    if (currentTrack?.id === track.id && isPlaying) pause();
    else play(track);
  };

  const handleRefresh = async (id: string) => { await api.refreshTrack(id); setOpenMenuId(null); load(); };
  const handleDownload = async (id: string) => { await api.downloadTrack(id); setOpenMenuId(null); load(); };
  const handleDownloadVideo = async (id: string) => { await api.downloadVideo(id); setOpenMenuId(null); load(); };

  const handleVerify = async (track: Track) => {
    await api.verifyTrack(track.id, !track.verified);
    setOpenMenuId(null);
    load();
  };

  const handleEnrich = async (id: string) => {
    setEnrichingIds(prev => new Set(prev).add(id));
    setOpenMenuId(null);
    try {
      await api.enrichTrack(id);
      load();
    } finally {
      setEnrichingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleSort = (field: SortableTrackField) => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir(field === 'createdAt' ? 'desc' : 'asc'); }
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  // Helpers
  function formatDuration(sec: number | null): string {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function SortIndicator({ field }: { field: SortableTrackField }) {
    if (sortBy !== field) return <span className="sort-indicator">⇅</span>;
    return <span className="sort-indicator active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  function StatusDot({ track }: { track: Track }) {
    switch (track.audioStatus) {
      case 'ready': return <span className="status-dot status-ready" title="Audio ready">●</span>;
      case 'downloading': return <span className="status-dot status-downloading" title="Downloading…">◉</span>;
      case 'pending': return <span className="status-dot status-pending" title="Pending download">○</span>;
      case 'error': return <span className="status-dot status-error" title={track.audioError || 'Download failed'}>✕</span>;
      default: return null;
    }
  }

  function EnrichmentBadge({ status, confidence }: { status: EnrichmentStatus; confidence: string | null }) {
    switch (status) {
      case 'none': return null; // Don't show anything for un-enriched — less noise
      case 'queued': return <span className="badge badge-enrich-queued" title="Queued for enrichment">⏳</span>;
      case 'stage_a': return <span className="badge badge-enrich-active" title="Stage A running">🔍A</span>;
      case 'stage_a_done':
        return <span className={`badge badge-enrich-${confidence === 'high' ? 'high' : confidence === 'medium' ? 'med' : 'low'}`} title={`Stage A done · ${confidence}`}>A✓</span>;
      case 'stage_b': return <span className="badge badge-enrich-active" title="Stage B (AI) running">🤖B</span>;
      case 'complete':
        return <span className={`badge badge-enrich-${confidence === 'high' ? 'high' : confidence === 'medium' ? 'med' : 'low'}`} title={`Complete · ${confidence}`}>✓</span>;
      case 'error': return <span className="badge badge-enrich-error" title="Enrichment error">⚠</span>;
      default: return null;
    }
  }

  function ConfidenceDots({ confidence }: { confidence: string | null }) {
    const level = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : confidence === 'low' ? 1 : 0;
    return (
      <span className="confidence-dots" title={`Confidence: ${confidence || 'none'}`}>
        {[1, 2, 3].map(i => (
          <span key={i} className={`confidence-dot ${i <= level ? 'filled' : ''}`} />
        ))}
      </span>
    );
  }

  // ---------- Action Menu ----------
  function ActionMenu({ track }: { track: Track }) {
    const isOpen = openMenuId === track.id;
    const isEnriching = enrichingIds.has(track.id) ||
      track.enrichmentStatus === 'stage_a' || track.enrichmentStatus === 'stage_b' || track.enrichmentStatus === 'queued';

    return (
      <div className="action-menu-wrap" ref={isOpen ? menuRef : undefined}>
        <button
          className={`btn-icon action-menu-trigger ${isOpen ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); setOpenMenuId(isOpen ? null : track.id); }}
          title="Actions"
          aria-label="Track actions"
        >
          ⋯
        </button>
        {isOpen && (
          <div className="action-menu-dropdown" onClick={e => e.stopPropagation()}>
            <button className="action-menu-item" onClick={() => { setEditing(track); setShowForm(true); setOpenMenuId(null); }}>
              <span className="action-menu-icon">✏️</span> Edit
            </button>
            <button className="action-menu-item" onClick={() => handleVerify(track)}>
              <span className="action-menu-icon">{track.verified ? '☑️' : '☐'}</span>
              {track.verified ? 'Unverify' : 'Verify'}
            </button>
            <button className="action-menu-item" onClick={() => handleEnrich(track.id)} disabled={isEnriching}>
              <span className="action-menu-icon">🔍</span>
              {isEnriching ? 'Enriching…' : 'Enrich'}
            </button>
            {track.audioStatus === 'ready' && (
              <button className="action-menu-item" onClick={() => handleRefresh(track.id)}>
                <span className="action-menu-icon">🔄</span> Re-download
              </button>
            )}
            {(track.audioStatus === 'error' || track.audioStatus === 'pending') && (
              <button className="action-menu-item" onClick={() => handleDownload(track.id)}>
                <span className="action-menu-icon">⬇️</span> Download
              </button>
            )}
            {track.videoStatus !== 'ready' && track.videoStatus !== 'downloading' && (
              <button className="action-menu-item" onClick={() => handleDownloadVideo(track.id)}>
                <span className="action-menu-icon">🎬</span> Download Video
              </button>
            )}
            <div className="action-menu-divider" />
            <button className="action-menu-item action-menu-danger" onClick={() => handleDelete(track.id)}>
              <span className="action-menu-icon">🗑️</span> Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------- Expandable Detail Panel ----------
  function TrackDetail({ track }: { track: Track }) {
    const isEnriching = enrichingIds.has(track.id) ||
      track.enrichmentStatus === 'stage_a' || track.enrichmentStatus === 'stage_b' || track.enrichmentStatus === 'queued';

    return (
      <div className="track-detail">
        <div className="track-detail-grid">
          {/* Left: basic info */}
          <div className="track-detail-section">
            <h4>Track Info</h4>
            <dl>
              <dt>YouTube URL</dt>
              <dd><a href={track.youtubeUrl} target="_blank" rel="noopener">{track.youtubeUrl}</a></dd>
              <dt>Volume</dt>
              <dd>{track.volume}%{track.volume > 100 ? ' ⚡' : ''}</dd>
              {track.notes && <><dt>Notes</dt><dd>{track.notes}</dd></>}
              <dt>Date Added</dt>
              <dd>{formatDateTime(track.createdAt)}</dd>
              <dt>Last Updated</dt>
              <dd>{formatDateTime(track.updatedAt)}</dd>
              <dt>Audio Status</dt>
              <dd>
                {track.audioStatus === 'ready' && <span className="badge badge-ready">● Ready</span>}
                {track.audioStatus === 'downloading' && <span className="badge badge-downloading">⏳ Downloading…</span>}
                {track.audioStatus === 'pending' && <span className="badge badge-pending">○ Pending</span>}
                {track.audioStatus === 'error' && <span className="badge badge-error" title={track.audioError || 'Download failed'}>✕ Error</span>}
              </dd>
              <dt>Video Status</dt>
              <dd>
                {track.videoStatus === 'ready' && <span className="badge badge-ready">🎬 Ready</span>}
                {track.videoStatus === 'downloading' && <span className="badge badge-downloading">⏳ Downloading…</span>}
                {track.videoStatus === 'pending' && <span className="badge badge-pending">○ Pending</span>}
                {track.videoStatus === 'error' && <span className="badge badge-error" title={track.videoError || 'Download failed'}>✕ Error</span>}
                {track.videoStatus === 'none' && <span className="badge badge-pending">—</span>}
              </dd>
              {track.verified && (
                <>
                  <dt>Verified</dt>
                  <dd>✅ {track.verifiedBy ? `by ${track.verifiedBy}` : ''} {track.verifiedAt ? `on ${formatDateTime(track.verifiedAt)}` : ''}</dd>
                </>
              )}
            </dl>

            {/* Artwork */}
            {track.artworkUrl && (
              <div className="track-artwork">
                <img src={track.artworkUrl} alt="Artwork" />
                {track.artworkSource && <span className="track-artwork-source">{track.artworkSource}</span>}
              </div>
            )}

            {/* Alternate links */}
            {track.alternateLinks && Object.keys(track.alternateLinks).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h4>Alternate Links</h4>
                <div className="track-alt-links">
                  {Object.entries(track.alternateLinks).map(([name, url]) => (
                    <a key={name} href={url} target="_blank" rel="noopener" className="btn btn-secondary btn-sm">
                      {name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: metadata + enrichment */}
          <div className="track-detail-section">
            <h4>
              Metadata
              <ConfidenceDots confidence={track.metadataConfidence} />
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => handleEnrich(track.id)}
                disabled={isEnriching}
              >
                {isEnriching ? '⏳ Enriching…' : '🔍 Enrich Now'}
              </button>
            </h4>
            <dl>
              {track.ytChannel && <><dt>Channel</dt><dd>{track.ytChannel}</dd></>}
              {track.ytUploadDate && <><dt>Upload Date</dt><dd>{track.ytUploadDate}</dd></>}
              {(track.albumName || track.album) && (
                <><dt>Album</dt><dd>
                  {track.albumName ? (
                    <Link to={`/albums/${track.albumSlug || track.albumId}`} className="entity-link">{track.albumName}</Link>
                  ) : track.album}
                </dd></>
              )}
              {track.artists && track.artists.length > 0 && (
                <><dt>Artists</dt><dd>
                  {track.artists.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 && ', '}
                      <Link to={`/artists/${a.slug}`} className="entity-link">{a.name}</Link>
                      {a.role !== 'primary' && <span className="artist-role"> ({a.role})</span>}
                    </span>
                  ))}
                </dd></>
              )}
              {track.releaseYear && <><dt>Release Year</dt><dd>{track.releaseYear}</dd></>}
              {track.genre && <><dt>Genre</dt><dd>{track.genre}</dd></>}
              {track.label && <><dt>Label</dt><dd>{track.label}</dd></>}
              {track.ytViewCount != null && <><dt>Views</dt><dd>{track.ytViewCount.toLocaleString()}</dd></>}
              {track.ytLikeCount != null && <><dt>Likes</dt><dd>{track.ytLikeCount.toLocaleString()}</dd></>}
              {track.bpm && <><dt>BPM</dt><dd>{track.bpm}</dd></>}
              {track.isrc && <><dt>ISRC</dt><dd>{track.isrc}</dd></>}
            </dl>

            {/* Enrichment status bar */}
            <div className="enrichment-status-bar">
              <div className="enrichment-pipeline">
                <span className={`pipeline-stage ${track.stageACompletedAt ? 'done' : track.enrichmentStatus === 'stage_a' ? 'active' : ''}`}>
                  A{track.stageACompletedAt ? '✓' : ''}
                </span>
                <span className="pipeline-arrow">→</span>
                <span className={`pipeline-stage ${track.stageBCompletedAt ? 'done' : track.enrichmentStatus === 'stage_b' ? 'active' : ''}`}>
                  B{track.stageBCompletedAt ? '✓' : ''}
                </span>
              </div>
              <div className="enrichment-meta">
                {track.enrichmentStatus !== 'none' && (
                  <span>Status: {track.enrichmentStatus}</span>
                )}
                {track.enrichmentAttempts > 0 && (
                  <span> · Attempts: {track.enrichmentAttempts}</span>
                )}
                {track.lastEnrichedAt && (
                  <span> · Last: {timeAgo(track.lastEnrichedAt)}</span>
                )}
                {track.nextEnrichAt && new Date(track.nextEnrichAt).getTime() > Date.now() && (
                  <span> · Next: {timeAgo(track.nextEnrichAt)}</span>
                )}
              </div>
              {track.enrichmentError && (
                <div className="enrichment-error" title={track.enrichmentError}>
                  ⚠ {track.enrichmentError.slice(0, 100)}
                </div>
              )}
            </div>

            {/* Provenance */}
            {track.metadataSource && (
              <div className="track-detail-provenance">
                Source: {track.metadataSource}
                {track.metadataConfidence && ` · Confidence: ${track.metadataConfidence}`}
                {track.lastEnrichedAt && ` · Enriched: ${formatDate(track.lastEnrichedAt)}`}
              </div>
            )}

            {/* Per-field confidences */}
            {track.fieldConfidences && track.fieldConfidences.length > 0 && (
              <details className="field-confidences">
                <summary>Field provenance ({track.fieldConfidences.length} fields)</summary>
                <div className="field-confidence-list">
                  {track.fieldConfidences.map((fc, i) => (
                    <div key={i} className="field-confidence-item">
                      <span className="fc-field">{fc.field}</span>
                      <span className={`fc-badge fc-${fc.confidence}`}>{fc.confidence}</span>
                      <span className="fc-source">{fc.source}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {track.enrichmentStatus === 'none' && (
              <p className="track-detail-provenance">Not yet enriched. Click "Enrich Now" or wait for background scheduler.</p>
            )}
          </div>
        </div>
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
        <div className="tracks-toolbar">
          <form onSubmit={handleSearchSubmit} className="tracks-search">
            <input
              type="text"
              placeholder="Search tracks…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="search-input"
            />
            {search && (
              <button type="button" className="btn btn-secondary btn-sm"
                onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }} title="Clear search">✕</button>
            )}
          </form>
          <button
            className={`btn btn-sm ${showYtSearch ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => setShowYtSearch(v => !v)}
          >
            {showYtSearch ? '✕ Close' : '🔍 YouTube'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowForm(true); }}>
            + Add
          </button>
        </div>
      </div>

      {showYtSearch && (
        <YouTubeSearch
          existingTracks={tracks}
          onTrackAdded={load}
        />
      )}

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {tracks.length === 0 && !search ? (
        <div className="empty-state">
          <h3>No tracks yet</h3>
          <p>Add your first YouTube track to get started.</p>
        </div>
      ) : tracks.length === 0 && search ? (
        <div className="empty-state">
          <h3>No results</h3>
          <p>No tracks match &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <>
          <div className="track-list">
            <div className="track-row track-header">
              {COLUMNS.map(col => (
                <span
                  key={col.key}
                  className={`${col.sortField ? 'sortable-header' : ''} ${col.className || ''}`}
                  onClick={col.sortField ? () => handleSort(col.sortField!) : undefined}
                >
                  {col.label}
                  {col.sortField && <SortIndicator field={col.sortField} />}
                </span>
              ))}
            </div>

            {tracks.map(t => {
              const isCurrent = currentTrack?.id === t.id;
              const canPlay = t.audioStatus === 'ready';
              const isExpanded = expandedTrackId === t.id;

              return (
                <div key={t.id}>
                  <div className={`track-row ${isCurrent ? 'track-active' : ''} ${isExpanded ? 'track-expanded' : ''}`}>
                    {/* Play */}
                    <div className="col-play">
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

                    {/* Title — includes album subtitle + inline badges */}
                    <div
                      className="track-title-cell"
                      onClick={() => setExpandedTrackId(isExpanded ? null : t.id)}
                      title="Click to expand details"
                    >
                      <div className="track-title-row">
                        <span className="track-title">
                          {t.title}
                        </span>
                        <span className="track-badges">
                          <StatusDot track={t} />
                          {t.verified && <span className="verified-tick" title="Verified">✓</span>}
                          <EnrichmentBadge status={t.enrichmentStatus} confidence={t.metadataConfidence} />
                        </span>
                      </div>
                      {/* Album as subtitle */}
                      {(t.albumName || t.album) && (
                        <div className="track-subtitle">
                          {t.albumName ? (
                            <Link to={`/albums/${t.albumSlug || t.albumId}`} className="entity-link" onClick={e => e.stopPropagation()}>
                              {t.albumName}
                            </Link>
                          ) : (
                            <span className="track-album-text">{t.album}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Artist */}
                    <div className="track-artist">
                      {t.artists && t.artists.length > 0 ? (
                        t.artists.map((a, i) => (
                          <span key={a.id}>
                            {i > 0 && ', '}
                            <Link to={`/artists/${a.slug}`} className="entity-link" onClick={e => e.stopPropagation()}>
                              {a.name}
                            </Link>
                          </span>
                        ))
                      ) : t.artistId ? (
                        <Link to={`/artists/${t.artistId}`} className="entity-link">{t.artist}</Link>
                      ) : (
                        t.artist
                      )}
                    </div>

                    {/* Duration */}
                    <div className="track-duration col-duration">{formatDuration(t.duration)}</div>

                    {/* Actions — compact ⋯ menu */}
                    <div className="col-actions">
                      <ActionMenu track={t} />
                    </div>
                  </div>

                  {isExpanded && <TrackDetail track={t} />}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="pagination">
            <div className="pagination-info">
              {startItem}–{endItem} of {total}
            </div>
            <div className="pagination-controls">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(1)} title="First page">««</button>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} title="Previous page">«</button>
              <span className="pagination-page">{page} / {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} title="Next page">»</button>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)} title="Last page">»»</button>
            </div>
            <div className="pagination-size">
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} title="Items per page">
                {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
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
