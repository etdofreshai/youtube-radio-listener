import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Link } from 'react-router-dom';
import type { Track, CreateTrackInput, UpdateTrackInput, SortableTrackField, SortDirection, EnrichmentStatus, TrackVariant, VariantKind, CreateVariantInput } from '../types';
import * as api from '../api';
import TrackForm from '../components/TrackForm';
import YouTubeSearch from '../components/YouTubeSearch';
import LearnPanel from '../components/LearnPanel';
import FavoriteButton from '../components/FavoriteButton';
import { useAudioPlayer } from '../components/AudioPlayer';
import { parseEndTime } from '../utils/endTimeParse';
import { getEffectiveDuration, getEffectiveDurationFromStrings } from '../utils/effectiveDuration';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const PAGE_SIZE_KEY = 'nightwave:tracksPageSize';

/** Read persisted page size from localStorage (default 25) */
export function getPersistedPageSize(): number {
  try {
    const raw = localStorage.getItem(PAGE_SIZE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (PAGE_SIZE_OPTIONS.includes(n)) return n;
    }
  } catch { /* ignore */ }
  return 25;
}

/** Persist page size to localStorage */
export function persistPageSize(size: number): void {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch { /* ignore */ }
}

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

const EDIT_COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Title', sortField: 'title' },
  { key: 'swap_ta', label: '' },
  { key: 'artist', label: 'Artist', sortField: 'artist' },
  { key: 'swap_aa', label: '' },
  { key: 'album', label: 'Album', sortField: 'album' },
  { key: 'start', label: 'Start' },
  { key: 'end', label: 'End' },
  { key: 'duration', label: '🕐', sortField: 'duration', className: 'col-duration' },
  { key: 'actions', label: '', className: 'col-actions-edit' },
];

// ── Inline edit state per row ──────────────────────────────────────────────

interface RowEditState {
  title: string;
  artist: string;
  album: string;
  startTime: string;
  endTime: string;
  duration: string;
  dirty: boolean;
  saving: boolean;
  error: string;
}

function makeRowEdit(t: Track): RowEditState {
  return {
    title: t.title || '',
    artist: t.artist || '',
    album: t.albumName || t.album || '',
    startTime: t.startTimeSec != null ? formatSecondsToTime(t.startTimeSec) : '',
    endTime: t.endTimeSec != null ? formatSecondsToTime(t.endTimeSec) : '',
    duration: t.duration != null ? formatSecondsToTime(t.duration) : '',
    dirty: false,
    saving: false,
    error: '',
  };
}

/** Format seconds to M:SS string */
function formatSecondsToTime(sec: number): string {
  if (sec === 0) return '0:00';
  const totalSec = Math.round(sec);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Swap helpers (pure functions, exported for testing) ─────────────────

export function swapTitleArtist(state: RowEditState): RowEditState {
  return { ...state, title: state.artist, artist: state.title, dirty: true };
}

export function swapArtistAlbum(state: RowEditState): RowEditState {
  return { ...state, artist: state.album, album: state.artist, dirty: true };
}

export type TracksPageMode = 'regular' | 'edit';

// ── Action Menu — module-level so React never unmounts/remounts it ──────────
// Defining components inside a parent component causes React to treat them as
// a new type on every render, forcing unmount+remount and closing any open menu.
// By moving ActionMenu here, its identity is stable across all parent renders.

interface ActionMenuProps {
  track: Track;
  isEnriching: boolean;
  onEdit: (track: Track) => void;
  onVerify: (track: Track) => void;
  onEnrich: (id: string) => void;
  onLearn: (id: string) => void;
  onRefresh: (id: string) => void;
  onDownload: (id: string) => void;
  onDownloadVideo: (id: string) => void;
  onDelete: (id: string) => void;
}

const ActionMenu = memo(function ActionMenu({
  track,
  isEnriching,
  onEdit,
  onVerify,
  onEnrich,
  onLearn,
  onRefresh,
  onDownload,
  onDownloadVideo,
  onDelete,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(prev => !prev);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="action-menu-wrap" ref={menuRef}>
      <button
        className={`btn-icon action-menu-trigger ${open ? 'active' : ''}`}
        onClick={toggle}
        title="Actions"
        aria-label="Track actions"
      >
        ⋯
      </button>
      {open && (
        <div className="action-menu-dropdown" onClick={e => e.stopPropagation()}>
          <button className="action-menu-item" onClick={() => { setOpen(false); onEdit(track); }}>
            <span className="action-menu-icon">✏️</span> Edit
          </button>
          <button className="action-menu-item" onClick={() => { setOpen(false); onVerify(track); }}>
            <span className="action-menu-icon">{track.verified ? '☑️' : '☐'}</span>
            {track.verified ? 'Unverify' : 'Verify'}
          </button>
          <button className="action-menu-item" onClick={() => { setOpen(false); onEnrich(track.id); }} disabled={isEnriching}>
            <span className="action-menu-icon">🔍</span>
            {isEnriching ? 'Enriching…' : 'Enrich'}
          </button>
          <button className="action-menu-item" onClick={() => { setOpen(false); onLearn(track.id); }}>
            <span className="action-menu-icon">🎸</span>
            Learn
          </button>
          {!track.isLiveStream && track.audioStatus === 'ready' && (
            <button className="action-menu-item" onClick={() => { setOpen(false); onRefresh(track.id); }}>
              <span className="action-menu-icon">🔄</span> Re-download
            </button>
          )}
          {!track.isLiveStream && (track.audioStatus === 'error' || track.audioStatus === 'pending') && (
            <button className="action-menu-item" onClick={() => { setOpen(false); onDownload(track.id); }}>
              <span className="action-menu-icon">⬇️</span> Download
            </button>
          )}
          {!track.isLiveStream && track.videoStatus !== 'ready' && track.videoStatus !== 'downloading' && (
            <button className="action-menu-item" onClick={() => { setOpen(false); onDownloadVideo(track.id); }}>
              <span className="action-menu-icon">🎬</span> Download Video
            </button>
          )}
          <div className="action-menu-divider" />
          <button className="action-menu-item action-menu-danger" onClick={() => { setOpen(false); onDelete(track.id); }}>
            <span className="action-menu-icon">🗑️</span> Delete
          </button>
        </div>
      )}
    </div>
  );
});

export default function TracksPage() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [error, setError] = useState('');
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [showYtSearch, setShowYtSearch] = useState(false);
  const [learnTrackId, setLearnTrackId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mode toggle
  const [mode, setMode] = useState<TracksPageMode>('regular');

  // Inline edit state (edit mode)
  const [editStates, setEditStates] = useState<Record<string, RowEditState>>({});

  // Pagination + sort
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => getPersistedPageSize());
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

  // Initialize edit states when tracks change or mode switches to edit
  useEffect(() => {
    if (mode === 'edit') {
      setEditStates(prev => {
        const next: Record<string, RowEditState> = {};
        for (const t of tracks) {
          // Preserve dirty rows
          if (prev[t.id] && prev[t.id].dirty) {
            next[t.id] = prev[t.id];
          } else {
            next[t.id] = makeRowEdit(t);
          }
        }
        return next;
      });
    }
  }, [tracks, mode]);

  // Poll while any track is downloading or enriching
  useEffect(() => {
    const hasActive = tracks.some(t =>
      t.audioStatus === 'downloading' || t.audioStatus === 'pending' ||
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

  // Handlers
  const handleCreate = async (data: CreateTrackInput) => {
    await api.createTrack(data);
    setShowForm(false);
    load();
  };

  const handlePlaylistImported = () => {
    // Reload tracks so the parent list reflects newly added items.
    // The form will show the summary and waits for user to click Done.
    load();
  };

  const handleUpdate = async (data: UpdateTrackInput) => {
    if (!editing) return;
    await api.updateTrack(editing.id, data);
    setEditing(null);
    load();
  };

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Delete this track?')) return;
    await api.deleteTrack(id);
    load();
  }, [load]);

  const handlePlay = (track: Track) => {
    if (currentTrack?.id === track.id && isPlaying) pause();
    else play(track);
  };

  const handleRefresh = useCallback(async (id: string) => { await api.refreshTrack(id); load(); }, [load]);
  const handleDownload = useCallback(async (id: string) => { await api.downloadTrack(id); load(); }, [load]);
  const handleDownloadVideo = useCallback(async (id: string) => { await api.downloadVideo(id); load(); }, [load]);

  const handleVerify = useCallback(async (track: Track) => {
    await api.verifyTrack(track.id, !track.verified);
    load();
  }, [load]);

  const handleEnrich = useCallback(async (id: string) => {
    setEnrichingIds(prev => new Set(prev).add(id));
    try {
      await api.enrichTrack(id);
      load();
    } finally {
      setEnrichingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, [load]);

  // Stable callbacks for ActionMenu — prevent prop changes from causing re-renders
  const handleMenuEdit = useCallback((track: Track) => {
    setEditing(track);
    setShowForm(true);
  }, []);

  const handleMenuLearn = useCallback((id: string) => {
    setLearnTrackId(id);
  }, []);

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

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    persistPageSize(newSize);
    setPage(1);
  };

  // ── Edit mode handlers ──────────────────────────────────────────────

  const updateEditField = (trackId: string, field: keyof RowEditState, value: string) => {
    setEditStates(prev => ({
      ...prev,
      [trackId]: { ...prev[trackId], [field]: value, dirty: true, error: '' },
    }));
  };

  const handleSwapTitleArtist = (trackId: string) => {
    setEditStates(prev => ({
      ...prev,
      [trackId]: swapTitleArtist(prev[trackId]),
    }));
  };

  const handleSwapArtistAlbum = (trackId: string) => {
    setEditStates(prev => ({
      ...prev,
      [trackId]: swapArtistAlbum(prev[trackId]),
    }));
  };

  const handleInlineSave = async (trackId: string) => {
    const es = editStates[trackId];
    if (!es || !es.dirty) return;

    // Validate time fields
    let startSec: number | null = null;
    let endSec: number | null = null;

    if (es.startTime.trim()) {
      const parsed = parseEndTime(es.startTime);
      if (parsed && !parsed.ok) {
        setEditStates(prev => ({ ...prev, [trackId]: { ...prev[trackId], error: `Start: ${parsed.error}` } }));
        return;
      }
      if (parsed) startSec = parsed.value;
    }

    if (es.endTime.trim()) {
      const parsed = parseEndTime(es.endTime);
      if (parsed && !parsed.ok) {
        setEditStates(prev => ({ ...prev, [trackId]: { ...prev[trackId], error: `End: ${parsed.error}` } }));
        return;
      }
      if (parsed) endSec = parsed.value;
    }

    // Validate: start must be < end when both present
    if (startSec != null && endSec != null && startSec >= endSec) {
      setEditStates(prev => ({ ...prev, [trackId]: { ...prev[trackId], error: 'Start time must be before end time' } }));
      return;
    }

    setEditStates(prev => ({ ...prev, [trackId]: { ...prev[trackId], saving: true, error: '' } }));

    try {
      const data: UpdateTrackInput = {
        title: es.title.trim(),
        artist: es.artist.trim(),
        album: es.album.trim() || null,
        startTimeSec: startSec,
        endTimeSec: endSec,
      };
      await api.updateTrack(trackId, data);
      // Reload and reset this row's dirty state
      await load();
      setEditStates(prev => {
        const track = tracks.find(t => t.id === trackId);
        if (!track) return prev;
        return { ...prev, [trackId]: { ...makeRowEdit(track), saving: false } };
      });
    } catch (err: unknown) {
      setEditStates(prev => ({
        ...prev,
        [trackId]: { ...prev[trackId], saving: false, error: err instanceof Error ? err.message : 'Save failed' },
      }));
    }
  };

  const handleInlineCancel = (trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (track) {
      setEditStates(prev => ({ ...prev, [trackId]: makeRowEdit(track) }));
    }
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
      case 'none': return null;
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

  // ---------- Expandable Detail Panel ----------
  const VARIANT_KIND_LABELS: Record<string, string> = {
    'original': '🎵 Original',
    '4k': '📺 4K',
    'official-video': '🎬 Official',
    'audio-only': '🎧 Audio',
    'live': '🎤 Live',
    'remaster': '✨ Remaster',
    'lyric-video': '📝 Lyrics',
    'remix': '🔄 Remix',
    'acoustic': '🪕 Acoustic',
    'other': '📎 Other',
  };

  function TrackVariantsSection({ track, onUpdated }: { track: Track; onUpdated: () => void }) {
    const [addingVariant, setAddingVariant] = useState(false);
    const [newUrl, setNewUrl] = useState('');
    const [newKind, setNewKind] = useState<VariantKind>('original');
    const [newLabel, setNewLabel] = useState('');
    const [saving, setSaving] = useState(false);
    const [varError, setVarError] = useState('');

    const variants = track.variants || [];

    const handleAddVariant = async () => {
      if (!newUrl.trim()) return;
      setSaving(true);
      setVarError('');
      try {
        await api.addVariant(track.id, {
          youtubeUrl: newUrl.trim(),
          kind: newKind,
          label: newLabel.trim() || undefined,
        });
        setNewUrl('');
        setNewLabel('');
        setNewKind('original');
        setAddingVariant(false);
        onUpdated();
      } catch (err: unknown) {
        setVarError(err instanceof Error ? err.message : 'Failed to add variant');
      } finally {
        setSaving(false);
      }
    };

    const handleSetPreferred = async (variantId: string) => {
      try {
        await api.setPreferredVariant(track.id, variantId);
        onUpdated();
      } catch (err) {
        console.error('Failed to set preferred variant:', err);
      }
    };

    const handleDeleteVariant = async (variantId: string) => {
      if (!confirm('Remove this variant?')) return;
      try {
        await api.deleteVariant(track.id, variantId);
        onUpdated();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to delete variant');
      }
    };

    return (
      <div className="track-variants-section">
        <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          🔗 Variants ({variants.length})
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setAddingVariant(!addingVariant)}
          >
            {addingVariant ? '✕ Cancel' : '+ Add Variant'}
          </button>
        </h4>

        {addingVariant && (
          <div className="variant-add-form">
            <input
              type="text"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="YouTube URL…"
              style={{ flex: 1 }}
            />
            <select value={newKind} onChange={e => setNewKind(e.target.value as VariantKind)}>
              <option value="original">Original</option>
              <option value="4k">4K</option>
              <option value="official-video">Official Video</option>
              <option value="audio-only">Audio Only</option>
              <option value="live">Live</option>
              <option value="remaster">Remaster</option>
              <option value="lyric-video">Lyric Video</option>
              <option value="remix">Remix</option>
              <option value="acoustic">Acoustic</option>
              <option value="other">Other</option>
            </select>
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              style={{ width: 150 }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAddVariant}
              disabled={saving || !newUrl.trim()}
            >
              {saving ? '⏳' : 'Add'}
            </button>
            {varError && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{varError}</span>}
          </div>
        )}

        <div className="variants-list">
          {variants.map(v => (
            <div key={v.id} className={`variant-row ${v.isPreferred ? 'variant-preferred' : ''}`}>
              <span className="variant-kind-badge">{VARIANT_KIND_LABELS[v.kind] || v.kind}</span>
              {v.label && <span className="variant-label">{v.label}</span>}
              <a href={v.youtubeUrl} target="_blank" rel="noopener" className="variant-url" title={v.youtubeUrl}>
                {v.videoId}
              </a>
              {v.isPreferred ? (
                <span className="variant-active-badge">★ Active</span>
              ) : (
                <>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleSetPreferred(v.id)}
                    title="Set as preferred variant"
                  >
                    ▶ Use
                  </button>
                  <button
                    className="btn-icon btn-sm"
                    onClick={() => handleDeleteVariant(v.id)}
                    title="Remove variant"
                    style={{ color: 'var(--danger)' }}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function TrackLinksSection({ track, onUpdated }: { track: Track; onUpdated: () => void }) {
    const [targetTrackId, setTargetTrackId] = useState('');
    const [groupName, setGroupName] = useState('');
    const [busy, setBusy] = useState(false);
    const [linkError, setLinkError] = useState('');
    const [preferredTrackId, setPreferredTrackId] = useState<string>(track.id);

    const linked = track.linkedTracks || [];
    const candidateTracks = tracks.filter(t =>
      t.id !== track.id &&
      !linked.some(l => l.id === t.id)
    );

    const refreshPreferred = useCallback(async () => {
      try {
        const linkInfo = await api.getTrackLinks(track.id);
        setPreferredTrackId(linkInfo.group?.canonicalTrackId || track.id);
      } catch {
        setPreferredTrackId(track.id);
      }
    }, [track.id]);

    useEffect(() => {
      refreshPreferred();
    }, [refreshPreferred]);

    const handleLink = async () => {
      if (!targetTrackId) return;
      setBusy(true);
      setLinkError('');
      try {
        await api.linkTrack(track.id, {
          targetTrackId,
          groupName: groupName.trim() || undefined,
        });
        setTargetTrackId('');
        setGroupName('');
        await refreshPreferred();
        onUpdated();
      } catch (err: unknown) {
        setLinkError(err instanceof Error ? err.message : 'Failed to link tracks');
      } finally {
        setBusy(false);
      }
    };

    const handleUnlink = async (linkedTrackId: string) => {
      if (!confirm('Unlink this track?')) return;
      setBusy(true);
      setLinkError('');
      try {
        await api.unlinkTrack(track.id, linkedTrackId);
        await refreshPreferred();
        onUpdated();
      } catch (err: unknown) {
        setLinkError(err instanceof Error ? err.message : 'Failed to unlink track');
      } finally {
        setBusy(false);
      }
    };

    const handlePrefer = async (id: string) => {
      setBusy(true);
      setLinkError('');
      try {
        await api.setPreferredLinkedTrack(track.id, id);
        setPreferredTrackId(id);
        onUpdated();
      } catch (err: unknown) {
        setLinkError(err instanceof Error ? err.message : 'Failed to set preferred playback source');
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="track-variants-section" style={{ marginTop: 12 }}>
        <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          🧷 Linked Tracks ({linked.length})
          {track.trackGroupId && (
            <span className="variant-kind-badge" title="Track group id">Group: {track.trackGroupId.slice(0, 8)}</span>
          )}
        </h4>

        <div className="variant-add-form">
          <select
            value={targetTrackId}
            onChange={e => setTargetTrackId(e.target.value)}
            style={{ minWidth: 260 }}
          >
            <option value="">Select track to link…</option>
            {candidateTracks.map(t => (
              <option key={t.id} value={t.id}>{t.artist} — {t.title}</option>
            ))}
          </select>
          <input
            type="text"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            placeholder="Group label (optional)"
            style={{ width: 180 }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={handleLink}
            disabled={!targetTrackId || busy}
            title="Link selected track"
          >
            {busy ? '⏳' : 'Link'}
          </button>
        </div>

        {linkError && <div style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: 8 }}>{linkError}</div>}

        {linked.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No linked tracks yet.</div>
        ) : (
          <div className="variants-list">
            <div className="variant-row">
              <span className="variant-kind-badge">🎯 This track</span>
              <span>{track.artist} — {track.title}</span>
              {preferredTrackId === track.id ? (
                <span className="variant-active-badge">★ Preferred</span>
              ) : (
                <button className="btn btn-sm btn-secondary" onClick={() => handlePrefer(track.id)} disabled={busy}>Prefer</button>
              )}
            </div>

            {linked.map(l => (
              <div key={l.id} className="variant-row">
                <span className="variant-kind-badge">{l.isLiveStream ? '📡 Live' : '🎵 Track'}</span>
                <span>{l.artist} — {l.title}</span>
                <a href={l.youtubeUrl} target="_blank" rel="noopener" className="variant-url" title={l.youtubeUrl}>
                  Open ↗
                </a>
                {preferredTrackId === l.id ? (
                  <span className="variant-active-badge">★ Preferred</span>
                ) : (
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => handlePrefer(l.id)}
                    disabled={busy}
                    title="Use this track as preferred playback source"
                  >
                    Prefer
                  </button>
                )}
                <button
                  className="btn-icon btn-sm"
                  onClick={() => handleUnlink(l.id)}
                  title="Unlink"
                  style={{ color: 'var(--danger)' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

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
              {track.isLiveStream && (
                <><dt>Mode</dt><dd><span className="badge badge-live">📡 Live Stream</span></dd></>
              )}
              <dt>Audio Status</dt>
              <dd>
                {track.isLiveStream ? (
                  <span className="badge badge-ready">📡 Streaming</span>
                ) : (
                  <>
                    {track.audioStatus === 'ready' && <span className="badge badge-ready">● Ready</span>}
                    {track.audioStatus === 'downloading' && <span className="badge badge-downloading">⏳ Downloading…</span>}
                    {track.audioStatus === 'pending' && <span className="badge badge-pending">○ Pending</span>}
                    {track.audioStatus === 'error' && <span className="badge badge-error" title={track.audioError || 'Download failed'}>✕ Error</span>}
                  </>
                )}
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

        {/* Linked tracks section */}
        <TrackLinksSection track={track} onUpdated={load} />

        {/* Variants section */}
        {track.variants && track.variants.length > 0 && (
          <TrackVariantsSection track={track} onUpdated={load} />
        )}
      </div>
    );
  }

  // ---------- Render ----------

  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, total);

  const renderRegularMode = () => (
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
                  {canPlay || t.isLiveStream ? (
                    <button
                      className={`btn-play ${isCurrent && isPlaying ? 'playing' : ''}`}
                      onClick={() => handlePlay(t)}
                      title={isCurrent && isPlaying ? 'Pause' : (t.isLiveStream ? 'Stream Live' : 'Play')}
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
                      {t.isLiveStream && <span className="badge-live" title="Live Stream">LIVE</span>}
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

                {/* Duration — show effective (trimmed) duration if start/end set */}
                <div className="track-duration col-duration">
                  {t.isLiveStream ? <span className="badge-live-sm" title="Live Stream">📡</span> : (() => {
                    const info = getEffectiveDuration(t.duration, t.startTimeSec, t.endTimeSec);
                    return formatDuration(info.effective);
                  })()}
                </div>

                {/* Actions — favorite + compact ⋯ menu */}
                <div className="col-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                  <FavoriteButton type="track" entityId={t.id} size="sm" />
                  <ActionMenu
                    track={t}
                    isEnriching={enrichingIds.has(t.id) || t.enrichmentStatus === 'stage_a' || t.enrichmentStatus === 'stage_b' || t.enrichmentStatus === 'queued'}
                    onEdit={handleMenuEdit}
                    onVerify={handleVerify}
                    onEnrich={handleEnrich}
                    onLearn={handleMenuLearn}
                    onRefresh={handleRefresh}
                    onDownload={handleDownload}
                    onDownloadVideo={handleDownloadVideo}
                    onDelete={handleDelete}
                  />
                </div>
              </div>

              {isExpanded && <TrackDetail track={t} />}
            </div>
          );
        })}
      </div>
    </>
  );

  const renderEditMode = () => (
    <div className="track-list edit-mode-list">
      <div className="track-row-edit track-header-edit">
        {EDIT_COLUMNS.map(col => (
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
        const es = editStates[t.id];
        if (!es) return null;

        return (
          <div key={t.id} className={`track-row-edit ${es.dirty ? 'row-dirty' : ''} ${es.error ? 'row-error' : ''}`}>
            {/* Title with pencil */}
            <div className="edit-cell">
              <span className="edit-pencil" title="Edit title">✏️</span>
              <input
                className="edit-input"
                value={es.title}
                onChange={e => updateEditField(t.id, 'title', e.target.value)}
                placeholder="Title"
                title="Title"
                aria-label="Edit title"
              />
            </div>

            {/* Swap title ↔ artist (between Title and Artist columns) */}
            <div className="edit-cell-swap">
              <button
                className="btn-swap"
                onClick={() => handleSwapTitleArtist(t.id)}
                title="Swap title ↔ artist"
                aria-label="Swap title and artist"
              >
                ↔
              </button>
            </div>

            {/* Artist with pencil */}
            <div className="edit-cell">
              <span className="edit-pencil" title="Edit artist">✏️</span>
              <input
                className="edit-input"
                value={es.artist}
                onChange={e => updateEditField(t.id, 'artist', e.target.value)}
                placeholder="Artist"
                title="Artist"
                aria-label="Edit artist"
              />
            </div>

            {/* Swap artist ↔ album (between Artist and Album columns) */}
            <div className="edit-cell-swap">
              <button
                className="btn-swap"
                onClick={() => handleSwapArtistAlbum(t.id)}
                title="Swap artist ↔ album"
                aria-label="Swap artist and album"
              >
                ↔
              </button>
            </div>

            {/* Album with pencil */}
            <div className="edit-cell">
              <span className="edit-pencil" title="Edit album">✏️</span>
              <input
                className="edit-input"
                value={es.album}
                onChange={e => updateEditField(t.id, 'album', e.target.value)}
                placeholder="Album"
                title="Album"
                aria-label="Edit album"
              />
            </div>

            {/* Start Time */}
            <div className="edit-cell edit-cell-time">
              <input
                className="edit-input edit-input-time"
                value={es.startTime}
                onChange={e => updateEditField(t.id, 'startTime', e.target.value)}
                placeholder="0:00"
                title="Start time (MM:SS or seconds)"
                aria-label="Edit start time"
              />
            </div>

            {/* End Time */}
            <div className="edit-cell edit-cell-time">
              <input
                className="edit-input edit-input-time"
                value={es.endTime}
                onChange={e => updateEditField(t.id, 'endTime', e.target.value)}
                placeholder="—"
                title="End time (MM:SS or seconds)"
                aria-label="Edit end time"
              />
            </div>

            {/* Duration (read-only computed) — shows effective with trim indicator */}
            <div className="edit-cell edit-cell-time col-duration">
              {(() => {
                const info = es.dirty
                  ? getEffectiveDurationFromStrings(t.duration, es.startTime, es.endTime, parseEndTime)
                  : getEffectiveDuration(t.duration, t.startTimeSec, t.endTimeSec);
                if (info.isTrimmed) {
                  return (
                    <span className="edit-duration-display trimmed" title={`Original: ${formatDuration(info.original)} → Trimmed: ${formatDuration(info.effective)}`}>
                      ✂️ {formatDuration(info.effective)}
                    </span>
                  );
                }
                return <span className="edit-duration-display">{formatDuration(info.effective)}</span>;
              })()}
            </div>

            {/* Actions: save/cancel */}
            <div className="col-actions-edit">
              {es.dirty && (
                <>
                  <button
                    className="btn-inline-save"
                    onClick={() => handleInlineSave(t.id)}
                    disabled={es.saving}
                    title="Save changes"
                    aria-label="Save row"
                  >
                    {es.saving ? '⏳' : '💾'}
                  </button>
                  <button
                    className="btn-inline-cancel"
                    onClick={() => handleInlineCancel(t.id)}
                    disabled={es.saving}
                    title="Cancel changes"
                    aria-label="Cancel row edits"
                  >
                    ✕
                  </button>
                </>
              )}
              {es.error && (
                <span className="inline-error" title={es.error}>⚠</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="page-header">
        <h1>Tracks</h1>
        <div className="tracks-toolbar">
          {/* Mode toggle */}
          <div className="mode-toggle" role="tablist" aria-label="Tracks page mode">
            <button
              className={`mode-toggle-btn ${mode === 'regular' ? 'active' : ''}`}
              onClick={() => setMode('regular')}
              role="tab"
              aria-selected={mode === 'regular'}
              title="Regular mode — browse and play"
            >
              🎵 Browse
            </button>
            <button
              className={`mode-toggle-btn ${mode === 'edit' ? 'active' : ''}`}
              onClick={() => setMode('edit')}
              role="tab"
              aria-selected={mode === 'edit'}
              title="Edit mode — inline editing"
            >
              ✏️ Edit
            </button>
          </div>

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
          {mode === 'regular' && (
            <button
              className={`btn btn-sm ${showYtSearch ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => setShowYtSearch(v => !v)}
            >
              {showYtSearch ? '✕ Close' : '🔍 YouTube'}
            </button>
          )}
          {mode === 'regular' && (
            <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowForm(true); }}>
              + Add
            </button>
          )}
        </div>
      </div>

      {showYtSearch && mode === 'regular' && (
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
          {mode === 'regular' ? renderRegularMode() : renderEditMode()}

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
              <select value={pageSize} onChange={e => handlePageSizeChange(Number(e.target.value))} title="Items per page">
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
              onPlaylistImported={handlePlaylistImported}
            />
          </div>
        </div>
      )}

      {learnTrackId && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setLearnTrackId(null); }}>
          <div className="modal modal-lg">
            <LearnPanel
              track={tracks.find(t => t.id === learnTrackId)!}
              onClose={() => setLearnTrackId(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}
