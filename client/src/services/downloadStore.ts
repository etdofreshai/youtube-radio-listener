/**
 * IndexedDB-backed download store for offline audio playback.
 *
 * Database: "nightwave_downloads"
 * Object stores:
 *   - downloadMetadata: { trackId PK, title, artist, size, downloadedAt, status }
 *   - downloadedAudio:  { trackId PK, audioBlob, downloadedAt }
 */

export type DownloadStatus = 'complete' | 'partial' | 'corrupted';

export interface DownloadMetadata {
  trackId: string;
  title: string;
  artist: string;
  size: number;
  downloadedAt: string;
  status: DownloadStatus;
}

export interface DownloadedAudio {
  trackId: string;
  audioBlob: Blob;
  downloadedAt: string;
}

const DB_NAME = 'nightwave_downloads';
const DB_VERSION = 1;
const META_STORE = 'downloadMetadata';
const AUDIO_STORE = 'downloadedAudio';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'trackId' });
      }
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE, { keyPath: 'trackId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

/** Wrap an IDB request in a Promise */
function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Wrap an IDB transaction completion in a Promise */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

// ── CRUD operations ──────────────────────────────────────────────────────────

/** Save a downloaded track (metadata + audio blob). */
export async function saveDownload(
  meta: Omit<DownloadMetadata, 'downloadedAt' | 'status' | 'size'>,
  audioBlob: Blob,
): Promise<void> {
  const db = await openDB();
  const now = new Date().toISOString();
  const tx = db.transaction([META_STORE, AUDIO_STORE], 'readwrite');

  const metaRecord: DownloadMetadata = {
    ...meta,
    size: audioBlob.size,
    downloadedAt: now,
    status: 'complete',
  };

  const audioRecord: DownloadedAudio = {
    trackId: meta.trackId,
    audioBlob,
    downloadedAt: now,
  };

  tx.objectStore(META_STORE).put(metaRecord);
  tx.objectStore(AUDIO_STORE).put(audioRecord);

  await txDone(tx);
}

/** Save partial download metadata (no audio yet or incomplete). */
export async function savePartialMeta(
  meta: Omit<DownloadMetadata, 'downloadedAt' | 'status' | 'size'>,
): Promise<void> {
  const db = await openDB();
  const now = new Date().toISOString();
  const tx = db.transaction(META_STORE, 'readwrite');

  const metaRecord: DownloadMetadata = {
    ...meta,
    size: 0,
    downloadedAt: now,
    status: 'partial',
  };

  tx.objectStore(META_STORE).put(metaRecord);
  await txDone(tx);
}

/** Get metadata for a single track. */
export async function getDownloadMeta(trackId: string): Promise<DownloadMetadata | undefined> {
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readonly');
  const result = await reqP(tx.objectStore(META_STORE).get(trackId));
  return result ?? undefined;
}

/** Get all download metadata entries. */
export async function getAllDownloadMeta(): Promise<DownloadMetadata[]> {
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readonly');
  return reqP(tx.objectStore(META_STORE).getAll());
}

/** Get audio blob for a track. Returns undefined if not found. */
export async function getAudioBlob(trackId: string): Promise<Blob | undefined> {
  const db = await openDB();
  const tx = db.transaction(AUDIO_STORE, 'readonly');
  const record: DownloadedAudio | undefined = await reqP(tx.objectStore(AUDIO_STORE).get(trackId));
  return record?.audioBlob;
}

/** Check if a track has a complete download. */
export async function isDownloaded(trackId: string): Promise<boolean> {
  const meta = await getDownloadMeta(trackId);
  return meta?.status === 'complete';
}

/** Delete a single download (both metadata and audio). */
export async function deleteDownload(trackId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([META_STORE, AUDIO_STORE], 'readwrite');
  tx.objectStore(META_STORE).delete(trackId);
  tx.objectStore(AUDIO_STORE).delete(trackId);
  await txDone(tx);
}

/** Delete all downloads. */
export async function deleteAllDownloads(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([META_STORE, AUDIO_STORE], 'readwrite');
  tx.objectStore(META_STORE).clear();
  tx.objectStore(AUDIO_STORE).clear();
  await txDone(tx);
}

/** Delete incomplete/corrupted downloads only. */
export async function clearIncompleteDownloads(): Promise<number> {
  const all = await getAllDownloadMeta();
  const toDelete = all.filter(m => m.status !== 'complete');
  for (const m of toDelete) {
    await deleteDownload(m.trackId);
  }
  return toDelete.length;
}

/** Calculate total stored size in bytes. */
export async function getTotalStorageSize(): Promise<number> {
  const all = await getAllDownloadMeta();
  return all.reduce((sum, m) => sum + m.size, 0);
}

/** Get estimated available storage (uses StorageManager API if available). */
export async function getStorageEstimate(): Promise<{ used: number; quota: number }> {
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    return { used: est.usage ?? 0, quota: est.quota ?? 100 * 1024 * 1024 };
  }
  // Fallback: assume ~100MB available
  const used = await getTotalStorageSize();
  return { used, quota: 100 * 1024 * 1024 };
}

/** Format bytes to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
