/**
 * Deduplication utilities.
 *
 * Canonical form: plain 11-char YouTube videoId (no URL prefix).
 * We maintain a persistent "seen set" and a per-run cache.
 */

/** Extract videoId from various YouTube URL formats or plain ids */
export function canonicalVideoId(input: string): string {
  // Already a bare id
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);
    // youtu.be/ID
    if (url.hostname === 'youtu.be') {
      return url.pathname.slice(1).split('/')[0];
    }
    // youtube.com/watch?v=ID
    const v = url.searchParams.get('v');
    if (v) return v;
    // youtube.com/embed/ID or /v/ID
    const match = url.pathname.match(/\/(embed|v)\/([A-Za-z0-9_-]{11})/);
    if (match) return match[2];
  } catch {
    // not a URL — return trimmed input
  }
  return input.trim();
}

export class DedupeSet {
  private persistent: Set<string>;
  private rejected: Set<string>;
  private runCache: Set<string>;

  constructor(existingIds: string[] = [], rejectedIds: string[] = []) {
    this.persistent = new Set(existingIds);
    this.rejected = new Set(rejectedIds);
    this.runCache = new Set();
  }

  /** Returns true if the videoId has already been seen (accepted or rejected) */
  hasSeen(videoId: string): boolean {
    const id = canonicalVideoId(videoId);
    return this.persistent.has(id) || this.rejected.has(id) || this.runCache.has(id);
  }

  /** Returns true if the videoId was specifically rejected */
  isRejected(videoId: string): boolean {
    return this.rejected.has(canonicalVideoId(videoId));
  }

  /** Mark a videoId as seen in the current run */
  markSeen(videoId: string): void {
    const id = canonicalVideoId(videoId);
    this.runCache.add(id);
  }

  /** Commit run cache to persistent set (call at end of run) */
  commit(): void {
    for (const id of this.runCache) {
      this.persistent.add(id);
    }
    this.runCache.clear();
  }

  /** Get all seen IDs (for persistence) */
  allIds(): string[] {
    const merged = new Set([...this.persistent, ...this.runCache]);
    return [...merged];
  }

  /** Stats */
  get size(): number {
    return new Set([...this.persistent, ...this.runCache]).size;
  }
}
