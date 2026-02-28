// ─── Core Data Model ───

/** A discovered YouTube video candidate */
export interface Candidate {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  durationSeconds: number;
  publishedAt: string;
  thumbnailUrl: string;
  discoveredAt: string;
  source: CandidateSource;
  /** Scoring result — filled by the filter stage */
  scoring?: ScoringResult;
  /** Final decision */
  decision?: Decision;
}

export type CandidateSource =
  | { type: 'related'; seedVideoId: string }
  | { type: 'search'; query: string }
  | { type: 'channel'; channelId: string }
  | { type: 'seed' };

export interface ScoringResult {
  score: number; // 0–1
  passed: boolean;
  reasons: ScoringReason[];
}

export interface ScoringReason {
  rule: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface Decision {
  action: 'accept' | 'reject' | 'skip';
  reason: string;
  rejectionReason?: RejectionReason;
  decidedAt: string;
}

// ─── Rejection Tracking ───

/** Why a candidate was rejected — used for persistent rejection records */
export type RejectionReason =
  | 'not_music'       // title/channel heuristics say it's not music
  | 'duration'        // outside duration bounds
  | 'duplicate'       // already in library or already rejected
  | 'low_confidence'  // scored below threshold but no single dominant reason
  | 'other';          // catch-all

/** A persistently rejected video — never re-proposed */
export interface RejectedRecord {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  durationSeconds: number;
  rejectionReason: RejectionReason;
  confidence: number;
  source: CandidateSource;
  rejectedAt: string;
  discoveredAt: string;
  /** Human-readable explanation */
  detail: string;
}

// ─── Import Result Types ───

/** Explicit per-item status from the importer */
export type ImportItemStatus =
  | 'accepted'
  | 'rejected_duplicate'
  | 'rejected_not_music'
  | 'rejected_duration'
  | 'rejected_other';

export interface ImportItemResult {
  videoId: string;
  title: string;
  status: ImportItemStatus;
  detail: string;
}

/** An accepted track in the library */
export interface Track {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  durationSeconds: number;
  addedAt: string;
  source: CandidateSource;
  confidence: number;
  plays: number;
  lastPlayedAt: string | null;
}

// ─── Adapter Types ───

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string;
  durationSeconds: number;
  publishedAt: string;
  thumbnailUrl: string;
}

export interface YouTubeAdapter {
  searchVideos(query: string, maxResults?: number): Promise<YouTubeSearchResult[]>;
  getRelatedVideos(videoId: string, maxResults?: number): Promise<YouTubeSearchResult[]>;
  getChannelVideos(channelId: string, maxResults?: number): Promise<YouTubeSearchResult[]>;
  getVideoDetails(videoId: string): Promise<YouTubeSearchResult | null>;
}

// ─── Config ───

export interface RecommendationConfig {
  /** Enable/disable AI-powered recommendations */
  enabled: boolean;
  /** How often to run recommendation discovery (minutes). Default: 60 (hourly) */
  intervalMinutes: number;
  /** Maximum tracks to add per recommendation run. Default: 5 */
  addPerRunCap: number;
  /** Cloud Agent SDK OAuth token for authentication */
  cloudAgentOAuthToken: string;
  /** Model to use for recommendations */
  model: string;
  /** API endpoint for Cloud Agent SDK */
  endpoint: string;
}

export interface AppConfig {
  mode: 'dry-run' | 'live';
  youtubeApiKey: string;
  dataDir: string;
  /** Discovery interval in minutes. Default: 60 (hourly) */
  discoveryIntervalMinutes: number;
  /** Maximum tracks to import per hour. Default: 5 */
  hourlyImportCap: number;
  minConfidenceScore: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** AI-powered recommendation configuration */
  recommendation: RecommendationConfig;
}

// ─── Store Types ───

export interface StoreData {
  tracks: Track[];
  candidates: Candidate[];
  rejectedRecords: RejectedRecord[];
  seenVideoIds: string[];
  runLog: RunLogEntry[];
}

export interface RunLogEntry {
  runId: string;
  startedAt: string;
  completedAt: string;
  candidatesDiscovered: number;
  candidatesAccepted: number;
  candidatesRejected: number;
}
