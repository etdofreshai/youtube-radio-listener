import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { StoreData, Track, Candidate, RunLogEntry, RejectedRecord } from '../types.js';
import { log } from '../utils/logger.js';

const EMPTY_STORE: StoreData = {
  tracks: [],
  candidates: [],
  rejectedRecords: [],
  seenVideoIds: [],
  runLog: [],
};

export class Store {
  private filePath: string;
  private data: StoreData;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, 'store.json');
    this.data = this.load();
  }

  private load(): StoreData {
    if (!existsSync(this.filePath)) {
      log.info('No existing store found — starting fresh');
      return structuredClone(EMPTY_STORE);
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoreData;
      // Migrate older stores that lack rejectedRecords
      if (!parsed.rejectedRecords) parsed.rejectedRecords = [];
      log.info(`Loaded store: ${parsed.tracks.length} tracks, ${parsed.rejectedRecords.length} rejected, ${parsed.candidates.length} candidates, ${parsed.seenVideoIds.length} seen`);
      return parsed;
    } catch (err) {
      log.error('Failed to load store, starting fresh:', err);
      return structuredClone(EMPTY_STORE);
    }
  }

  save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    log.debug('Store saved');
  }

  // ─── Tracks ───

  getTracks(): Track[] {
    return this.data.tracks;
  }

  getTrack(videoId: string): Track | undefined {
    return this.data.tracks.find(t => t.videoId === videoId);
  }

  addTrack(track: Track): boolean {
    if (this.data.tracks.some(t => t.videoId === track.videoId)) {
      log.warn(`Track ${track.videoId} already exists — skipping`);
      return false;
    }
    this.data.tracks.push(track);
    return true;
  }

  recordPlay(videoId: string): void {
    const track = this.data.tracks.find(t => t.videoId === videoId);
    if (track) {
      track.plays += 1;
      track.lastPlayedAt = new Date().toISOString();
    }
  }

  // ─── Candidates ───

  getCandidates(): Candidate[] {
    return this.data.candidates;
  }

  addCandidate(candidate: Candidate): void {
    this.data.candidates.push(candidate);
  }

  getPendingCandidates(): Candidate[] {
    return this.data.candidates.filter(c => !c.decision);
  }

  getAcceptedCandidates(): Candidate[] {
    return this.data.candidates.filter(c => c.decision?.action === 'accept');
  }

  // ─── Rejected Records ───

  getRejectedRecords(): RejectedRecord[] {
    return this.data.rejectedRecords;
  }

  getRejectedRecord(videoId: string): RejectedRecord | undefined {
    return this.data.rejectedRecords.find(r => r.videoId === videoId);
  }

  isRejected(videoId: string): boolean {
    return this.data.rejectedRecords.some(r => r.videoId === videoId);
  }

  addRejectedRecord(record: RejectedRecord): boolean {
    if (this.data.rejectedRecords.some(r => r.videoId === record.videoId)) {
      log.debug(`Rejected record ${record.videoId} already exists — skipping`);
      return false;
    }
    this.data.rejectedRecords.push(record);
    return true;
  }

  /** All video IDs that have been rejected (for dedupe) */
  getRejectedVideoIds(): string[] {
    return this.data.rejectedRecords.map(r => r.videoId);
  }

  // ─── Seen Set ───

  getSeenVideoIds(): string[] {
    return this.data.seenVideoIds;
  }

  setSeenVideoIds(ids: string[]): void {
    this.data.seenVideoIds = ids;
  }

  // ─── Run Log ───

  addRunLog(entry: RunLogEntry): void {
    this.data.runLog.push(entry);
    // Keep last 100 runs
    if (this.data.runLog.length > 100) {
      this.data.runLog = this.data.runLog.slice(-100);
    }
  }

  getRunLog(): RunLogEntry[] {
    return this.data.runLog;
  }

  /** Count of tracks imported in the last hour */
  tracksImportedLastHour(): number {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    return this.data.tracks.filter(t => t.addedAt > oneHourAgo).length;
  }

  /** Get seed video IDs (existing tracks, prioritized by play count) */
  getSeedVideoIds(limit = 10): string[] {
    return [...this.data.tracks]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, limit)
      .map(t => t.videoId);
  }
}
