/**
 * React context that manages download state, progress tracking, and
 * exposes helpers for downloading/checking tracks across the app.
 *
 * Wraps the IndexedDB downloadStore and provides real-time state via
 * React context so any component can show download status.
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { Track } from '../types';
import {
  saveDownload,
  savePartialMeta,
  deleteDownload as dbDeleteDownload,
  deleteAllDownloads as dbDeleteAllDownloads,
  clearIncompleteDownloads as dbClearIncomplete,
  getAllDownloadMeta,
  getAudioBlob,
  getTotalStorageSize,
  getStorageEstimate,
  formatBytes,
  type DownloadMetadata,
} from '../services/downloadStore';
import { getAudioUrl } from '../api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DownloadProgress {
  trackId: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
}

interface DownloadContextType {
  /** Map of trackId → metadata for all downloaded tracks */
  downloads: Map<string, DownloadMetadata>;
  /** Currently active downloads (trackId → progress) */
  activeDownloads: Map<string, DownloadProgress>;
  /** Total storage used by downloads (bytes) */
  totalSize: number;
  /** Estimated available storage (bytes) */
  storageQuota: number;
  /** Start downloading a track */
  startDownload: (track: Track) => Promise<void>;
  /** Cancel an active download */
  cancelDownload: (trackId: string) => void;
  /** Delete a downloaded track */
  removeDownload: (trackId: string) => Promise<void>;
  /** Delete all downloads */
  removeAllDownloads: () => Promise<void>;
  /** Clear incomplete/corrupted downloads */
  clearIncomplete: () => Promise<number>;
  /** Check if a track is downloaded (complete) */
  isTrackDownloaded: (trackId: string) => boolean;
  /** Check if a track is currently downloading */
  isTrackDownloading: (trackId: string) => boolean;
  /** Get audio blob URL for local playback (returns null if not downloaded) */
  getLocalAudioUrl: (trackId: string) => Promise<string | null>;
  /** Refresh download list from IndexedDB */
  refresh: () => Promise<void>;
}

const DownloadContext = createContext<DownloadContextType | null>(null);

export function useDownloads() {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error('useDownloads must be used within DownloadProvider');
  return ctx;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [downloads, setDownloads] = useState<Map<string, DownloadMetadata>>(new Map());
  const [activeDownloads, setActiveDownloads] = useState<Map<string, DownloadProgress>>(new Map());
  const [totalSize, setTotalSize] = useState(0);
  const [storageQuota, setStorageQuota] = useState(100 * 1024 * 1024);

  // Abort controllers for active downloads
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Object URLs to revoke on cleanup
  const objectUrlsRef = useRef<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    try {
      const allMeta = await getAllDownloadMeta();
      const map = new Map(allMeta.map(m => [m.trackId, m]));
      setDownloads(map);

      const size = await getTotalStorageSize();
      setTotalSize(size);

      const est = await getStorageEstimate();
      setStorageQuota(est.quota);
    } catch (err) {
      console.error('Failed to refresh download state:', err);
    }
  }, []);

  // Load initial state
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach(url => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const startDownload = useCallback(async (track: Track) => {
    const { id: trackId, title, artist } = track;

    // Don't download if already downloading or downloaded
    if (abortControllersRef.current.has(trackId)) return;
    if (downloads.has(trackId) && downloads.get(trackId)!.status === 'complete') return;

    const controller = new AbortController();
    abortControllersRef.current.set(trackId, controller);

    // Save partial metadata
    await savePartialMeta({ trackId, title, artist });

    // Set initial progress
    setActiveDownloads(prev => {
      const next = new Map(prev);
      next.set(trackId, { trackId, bytesDownloaded: 0, totalBytes: 0, percent: 0 });
      return next;
    });

    try {
      const url = getAudioUrl(trackId);
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const chunks: BlobPart[] = [];
      let bytesDownloaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        bytesDownloaded += value.length;

        const percent = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0;
        setActiveDownloads(prev => {
          const next = new Map(prev);
          next.set(trackId, { trackId, bytesDownloaded, totalBytes, percent });
          return next;
        });
      }

      // Combine chunks into blob
      const audioBlob = new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });

      // Save to IndexedDB
      await saveDownload({ trackId, title, artist }, audioBlob);

      // Update state
      await refresh();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Download was cancelled — clean up partial metadata
        try { await dbDeleteDownload(trackId); } catch { /* ignore */ }
      } else {
        console.error(`Download failed for ${trackId}:`, err);
        // Mark as corrupted if partial data was written
        try { await dbDeleteDownload(trackId); } catch { /* ignore */ }
      }
      await refresh();
    } finally {
      abortControllersRef.current.delete(trackId);
      setActiveDownloads(prev => {
        const next = new Map(prev);
        next.delete(trackId);
        return next;
      });
    }
  }, [downloads, refresh]);

  const cancelDownload = useCallback((trackId: string) => {
    const controller = abortControllersRef.current.get(trackId);
    if (controller) controller.abort();
  }, []);

  const removeDownload = useCallback(async (trackId: string) => {
    // Cancel if downloading
    const controller = abortControllersRef.current.get(trackId);
    if (controller) controller.abort();

    // Revoke any object URL
    const url = objectUrlsRef.current.get(trackId);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(trackId);
    }

    await dbDeleteDownload(trackId);
    await refresh();
  }, [refresh]);

  const removeAllDownloads = useCallback(async () => {
    // Cancel all active downloads
    abortControllersRef.current.forEach(c => c.abort());
    abortControllersRef.current.clear();

    // Revoke all object URLs
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();

    await dbDeleteAllDownloads();
    await refresh();
  }, [refresh]);

  const clearIncomplete = useCallback(async () => {
    const count = await dbClearIncomplete();
    await refresh();
    return count;
  }, [refresh]);

  const isTrackDownloaded = useCallback((trackId: string) => {
    const meta = downloads.get(trackId);
    return meta?.status === 'complete';
  }, [downloads]);

  const isTrackDownloading = useCallback((trackId: string) => {
    return activeDownloads.has(trackId);
  }, [activeDownloads]);

  const getLocalAudioUrl = useCallback(async (trackId: string): Promise<string | null> => {
    // Check if we already have an object URL cached
    const existing = objectUrlsRef.current.get(trackId);
    if (existing) return existing;

    try {
      const blob = await getAudioBlob(trackId);
      if (!blob || blob.size === 0) return null;

      // Validate blob isn't corrupted (basic check)
      if (blob.size < 100) return null;

      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.set(trackId, url);
      return url;
    } catch {
      return null;
    }
  }, []);

  return (
    <DownloadContext.Provider value={{
      downloads,
      activeDownloads,
      totalSize,
      storageQuota,
      startDownload,
      cancelDownload,
      removeDownload,
      removeAllDownloads,
      clearIncomplete,
      isTrackDownloaded,
      isTrackDownloading,
      getLocalAudioUrl,
      refresh,
    }}>
      {children}
    </DownloadContext.Provider>
  );
}
