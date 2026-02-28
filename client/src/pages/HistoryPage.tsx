import { useState, useEffect, useCallback } from 'react';
import type { AppEvent } from '../types';
import * as api from '../api';

const EVENT_TYPE_LABELS: Record<string, { icon: string; label: string }> = {
  'track.created': { icon: '🎵', label: 'Track Added' },
  'track.updated': { icon: '✏️', label: 'Track Updated' },
  'track.deleted': { icon: '🗑️', label: 'Track Deleted' },
  'track.played': { icon: '▶️', label: 'Track Played' },
  'track.verified': { icon: '✅', label: 'Track Verified' },
  'track.unverified': { icon: '❌', label: 'Track Unverified' },
  'track.download_started': { icon: '⬇️', label: 'Download Started' },
  'track.download_completed': { icon: '✅', label: 'Download Completed' },
  'track.refresh_started': { icon: '🔄', label: 'Audio Refresh' },
  'track.enrich_started': { icon: '🔍', label: 'Enrichment Started' },
  'track.enrichment_stage_a_completed': { icon: '🔍', label: 'Enrichment Stage A Done' },
  'track.enrichment_stage_b_completed': { icon: '🤖', label: 'Enrichment Stage B Done' },
  'playlist.created': { icon: '📋', label: 'Playlist Created' },
  'playlist.updated': { icon: '✏️', label: 'Playlist Updated' },
  'playlist.deleted': { icon: '🗑️', label: 'Playlist Deleted' },
  'playlist.track_added': { icon: '➕', label: 'Track Added to Playlist' },
  'playlist.track_removed': { icon: '➖', label: 'Track Removed from Playlist' },
  'playlist.reordered': { icon: '↕️', label: 'Playlist Reordered' },
  'favorite.added': { icon: '❤️', label: 'Added to Favorites' },
  'favorite.removed': { icon: '💔', label: 'Removed from Favorites' },
};

const EVENT_TYPE_FILTERS = [
  { value: '', label: 'All Events' },
  { value: 'track.created', label: '🎵 Track Added' },
  { value: 'track.played', label: '▶️ Track Played' },
  { value: 'track.updated', label: '✏️ Track Updated' },
  { value: 'track.deleted', label: '🗑️ Track Deleted' },
  { value: 'track.verified', label: '✅ Track Verified' },
  { value: 'playlist.created', label: '📋 Playlist Created' },
  { value: 'playlist.track_added', label: '➕ Track → Playlist' },
  { value: 'favorite.added', label: '❤️ Favorited' },
];

function formatTime(iso: string): string {
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
  if (days < 7) return `${days}d ago`;
  return formatTime(iso);
}

function EventMetadata({ event }: { event: AppEvent }) {
  const meta = event.metadata;
  if (!meta || Object.keys(meta).length === 0) return null;

  const parts: string[] = [];

  if (meta.title) parts.push(`"${meta.title}"`);
  if (meta.artist) parts.push(`by ${meta.artist}`);
  if (meta.name) parts.push(`"${meta.name}"`);
  if (meta.trackTitle) parts.push(`"${meta.trackTitle}"`);
  if (meta.trackCount !== undefined) parts.push(`${meta.trackCount} tracks`);
  if (meta.confidence) parts.push(`confidence: ${meta.confidence}`);
  if (meta.changes && Array.isArray(meta.changes)) parts.push(`fields: ${meta.changes.join(', ')}`);
  if (meta.duration) parts.push(`${meta.duration}s`);
  if (meta.filename) parts.push(meta.filename);

  if (parts.length === 0) return null;

  return <span className="event-metadata">{parts.join(' · ')}</span>;
}

export default function HistoryPage() {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [eventType, setEventType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getEvents({
        page,
        pageSize: 50,
        eventType: eventType || undefined,
      });
      setEvents(result.data);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [page, eventType]);

  useEffect(() => { load(); }, [load]);

  const handleFilterChange = (value: string) => {
    setEventType(value);
    setPage(1);
  };

  return (
    <>
      <div className="page-header">
        <h1>📜 Activity History</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select
            value={eventType}
            onChange={e => handleFilterChange(e.target.value)}
            className="search-input"
            style={{ width: 200 }}
          >
            {EVENT_TYPE_FILTERS.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? '⏳' : '🔄'} Refresh
          </button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {events.length === 0 && !loading ? (
        <div className="empty-state">
          <h3>No events yet</h3>
          <p>Activity will appear here as you use the app.</p>
        </div>
      ) : (
        <>
          <div className="event-list">
            {events.map(event => {
              const info = EVENT_TYPE_LABELS[event.eventType] || { icon: '📝', label: event.eventType };
              return (
                <div key={event.id} className="event-row">
                  <span className="event-icon">{info.icon}</span>
                  <div className="event-content">
                    <span className="event-label">{info.label}</span>
                    <EventMetadata event={event} />
                  </div>
                  <span className="event-time" title={formatTime(event.createdAt)}>
                    {timeAgo(event.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="pagination">
            <div className="pagination-info">
              {total} event{total !== 1 ? 's' : ''}
            </div>
            <div className="pagination-controls">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(1)}>««</button>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>«</button>
              <span className="pagination-page">Page {page} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>»</button>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»»</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
