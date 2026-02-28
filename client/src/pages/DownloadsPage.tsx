/**
 * Downloads management page — lists downloaded tracks stored in IndexedDB,
 * allows sorting, searching, selecting, and bulk/individual deletion.
 */

import { useState, useMemo, useCallback } from 'react';
import { useDownloads } from '../context/DownloadContext';
import { formatBytes, type DownloadMetadata } from '../services/downloadStore';

type SortKey = 'title' | 'artist' | 'size' | 'downloadedAt';
type SortDir = 'asc' | 'desc';

export default function DownloadsPage() {
  const {
    downloads,
    activeDownloads,
    totalSize,
    storageQuota,
    removeDownload,
    removeAllDownloads,
    clearIncomplete,
    cancelDownload,
  } = useDownloads();

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('downloadedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // Convert Map to sorted/filtered array
  const allMeta = useMemo(() => Array.from(downloads.values()), [downloads]);

  const filteredMeta = useMemo(() => {
    let list = allMeta;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.title.toLowerCase().includes(q) ||
        m.artist.toLowerCase().includes(q)
      );
    }

    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'artist': cmp = a.artist.localeCompare(b.artist); break;
        case 'size': cmp = a.size - b.size; break;
        case 'downloadedAt': cmp = new Date(a.downloadedAt).getTime() - new Date(b.downloadedAt).getTime(); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [allMeta, search, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'downloadedAt' ? 'desc' : 'asc');
    }
  };

  const toggleSelect = (trackId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredMeta.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredMeta.map(m => m.trackId)));
    }
  };

  const handleDeleteSelected = async () => {
    const toDelete = Array.from(selected);
    for (const id of toDelete) {
      await removeDownload(id);
    }
    setSelected(new Set());
  };

  const handleDeleteAll = async () => {
    await removeAllDownloads();
    setSelected(new Set());
    setConfirmDeleteAll(false);
  };

  const handleClearIncomplete = async () => {
    const count = await clearIncomplete();
    if (count > 0) {
      // State auto-refreshes via context
    }
  };

  const handleReDownload = useCallback(async (trackId: string) => {
    // Remove then the user can trigger download again from Tracks page
    await removeDownload(trackId);
  }, [removeDownload]);

  // Storage gauge
  const usedPercent = storageQuota > 0 ? Math.min(100, (totalSize / storageQuota) * 100) : 0;
  const isStorageWarning = usedPercent > 80;

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function SortIndicator({ field }: { field: SortKey }) {
    if (sortKey !== field) return <span className="sort-indicator">⇅</span>;
    return <span className="sort-indicator active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <>
      <div className="page-header">
        <h1>📥 Downloads</h1>
        <div className="tracks-toolbar">
          <input
            type="text"
            placeholder="Search downloads…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {/* Storage gauge */}
      <div className={`downloads-storage-gauge ${isStorageWarning ? 'storage-warning' : ''}`}>
        <div className="storage-gauge-bar">
          <div
            className="storage-gauge-fill"
            style={{ width: `${usedPercent}%` }}
          />
        </div>
        <div className="storage-gauge-label">
          Stored: {formatBytes(totalSize)} / ~{formatBytes(storageQuota)} available
          {isStorageWarning && <span className="storage-warning-text"> ⚠️ Storage nearly full</span>}
        </div>
      </div>

      {/* Active downloads */}
      {activeDownloads.size > 0 && (
        <div className="downloads-active-section">
          <h3>Downloading ({activeDownloads.size})</h3>
          {Array.from(activeDownloads.values()).map(progress => (
            <div key={progress.trackId} className="download-active-row">
              <span className="download-active-info">
                ⬇️ {progress.trackId.slice(0, 8)}…
              </span>
              <div className="download-progress-bar-wrap">
                <div className="download-progress-bar" style={{ width: `${progress.percent}%` }} />
              </div>
              <span className="download-active-pct">{progress.percent}%</span>
              <span className="download-active-size">
                {formatBytes(progress.bytesDownloaded)}
                {progress.totalBytes > 0 ? ` / ${formatBytes(progress.totalBytes)}` : ''}
              </span>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => cancelDownload(progress.trackId)}
                title="Cancel download"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bulk actions */}
      {allMeta.length > 0 && (
        <div className="downloads-bulk-actions">
          {selected.size > 0 && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={handleDeleteSelected}
            >
              🗑️ Delete Selected ({selected.size})
            </button>
          )}
          <button
            className="btn btn-sm btn-secondary"
            onClick={handleClearIncomplete}
            title="Remove incomplete or corrupted downloads"
          >
            🧹 Clear Cache
          </button>
          {confirmDeleteAll ? (
            <span className="delete-all-confirm">
              <span>Delete all {allMeta.length} downloads?</span>
              <button className="btn btn-sm btn-danger" onClick={handleDeleteAll}>Yes, delete all</button>
              <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDeleteAll(false)}>Cancel</button>
            </span>
          ) : (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setConfirmDeleteAll(true)}
            >
              🗑️ Delete All
            </button>
          )}
        </div>
      )}

      {/* Downloads list */}
      {allMeta.length === 0 ? (
        <div className="empty-state">
          <h3>No downloads yet</h3>
          <p>Download tracks from the Tracks page for offline playback.</p>
          <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: 8 }}>
            Downloaded tracks play from your browser's local storage — no server needed.
          </p>
        </div>
      ) : filteredMeta.length === 0 ? (
        <div className="empty-state">
          <h3>No results</h3>
          <p>No downloads match &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <div className="track-list downloads-list">
          {/* Header */}
          <div className="track-row track-header downloads-header">
            <span className="col-checkbox">
              <input
                type="checkbox"
                checked={selected.size === filteredMeta.length && filteredMeta.length > 0}
                onChange={toggleSelectAll}
                title="Select all"
              />
            </span>
            <span className="sortable-header" onClick={() => handleSort('title')}>
              Title <SortIndicator field="title" />
            </span>
            <span className="sortable-header" onClick={() => handleSort('artist')}>
              Artist <SortIndicator field="artist" />
            </span>
            <span className="sortable-header col-size" onClick={() => handleSort('size')}>
              Size <SortIndicator field="size" />
            </span>
            <span className="sortable-header col-date" onClick={() => handleSort('downloadedAt')}>
              Downloaded <SortIndicator field="downloadedAt" />
            </span>
            <span className="col-actions">Status</span>
            <span className="col-actions" />
          </div>

          {filteredMeta.map(meta => (
            <div key={meta.trackId} className={`track-row downloads-row ${selected.has(meta.trackId) ? 'row-selected' : ''}`}>
              <span className="col-checkbox">
                <input
                  type="checkbox"
                  checked={selected.has(meta.trackId)}
                  onChange={() => toggleSelect(meta.trackId)}
                />
              </span>
              <span className="track-title downloads-title">{meta.title}</span>
              <span className="track-artist downloads-artist">{meta.artist}</span>
              <span className="col-size">{formatBytes(meta.size)}</span>
              <span className="col-date">{formatDate(meta.downloadedAt)}</span>
              <span className="col-actions">
                {meta.status === 'complete' && <span className="badge badge-ready" title="Complete">✓</span>}
                {meta.status === 'partial' && <span className="badge badge-pending" title="Incomplete">⏳</span>}
                {meta.status === 'corrupted' && <span className="badge badge-error" title="Corrupted">⚠</span>}
              </span>
              <span className="col-actions">
                {meta.status !== 'complete' && (
                  <button
                    className="btn-icon"
                    onClick={() => handleReDownload(meta.trackId)}
                    title="Remove and re-download from Tracks page"
                  >
                    🔄
                  </button>
                )}
                <button
                  className="btn-icon"
                  onClick={() => removeDownload(meta.trackId)}
                  title="Delete download"
                  style={{ color: 'var(--danger, #f87171)' }}
                >
                  🗑️
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {filteredMeta.length > 0 && (
        <div className="downloads-summary">
          {filteredMeta.length} track{filteredMeta.length !== 1 ? 's' : ''} · {formatBytes(filteredMeta.reduce((s, m) => s + m.size, 0))} total
        </div>
      )}
    </>
  );
}
