export type AudioStatus = 'pending' | 'downloading' | 'ready' | 'error';

// ---------- Enrichment Pipeline ----------

/** Overall enrichment lifecycle status */
export type EnrichmentStatus =
  | 'none'           // never attempted
  | 'queued'         // waiting in queue
  | 'stage_a'        // deterministic pass running
  | 'stage_a_done'   // deterministic pass complete
  | 'stage_b'        // AI deep pass running
  | 'complete'       // all passes done
  | 'error';         // last attempt failed

/** Per-field confidence for granular provenance */
export interface FieldConfidence {
  field: string;
  confidence: 'high' | 'medium' | 'low' | 'manual';
  source: string;         // e.g. 'youtube', 'ai-research', 'manual'
  updatedAt: string;      // ISO timestamp
}

// ---------- Metadata / Enrichment ----------

export interface TrackMetadata {
  // YouTube-sourced
  ytChannel: string | null;
  ytChannelId: string | null;
  ytUploadDate: string | null;     // ISO date string (YYYY-MM-DD)
  ytDescription: string | null;
  ytThumbnailUrl: string | null;
  ytViewCount: number | null;
  ytLikeCount: number | null;
  // Music metadata
  album: string | null;
  releaseYear: number | null;
  genre: string | null;
  label: string | null;
  isrc: string | null;
  bpm: number | null;
  // Artwork
  artworkUrl: string | null;       // album art / cover image URL
  artworkSource: string | null;    // 'youtube-thumbnail' | 'musicbrainz' | 'discogs' | etc.
  // Alternate links
  alternateLinks: Record<string, string> | null;  // { spotify: url, apple: url, altYoutube: url, ... }
}

export interface TrackProvenance {
  metadataSource: string | null;         // 'youtube' | 'youtube+ai' | 'manual' | etc.
  metadataConfidence: string | null;     // overall: 'high' | 'medium' | 'low'
  fieldConfidences: FieldConfidence[];   // per-field granular provenance
  lastEnrichedAt: string | null;         // ISO timestamp
}

export interface TrackEnrichmentState {
  enrichmentStatus: EnrichmentStatus;
  enrichmentAttempts: number;            // total attempts (A + B)
  enrichmentError: string | null;        // last error message
  nextEnrichAt: string | null;           // ISO timestamp — backoff-scheduled next attempt
  stageACompletedAt: string | null;      // when Stage A last finished
  stageBCompletedAt: string | null;      // when Stage B last finished
}

// ---------- Verification ----------

export interface TrackVerification {
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;         // ISO timestamp
}

// ---------- Track ----------

export interface Track extends TrackMetadata, TrackProvenance, TrackEnrichmentState, TrackVerification {
  id: string;
  youtubeUrl: string;
  title: string;
  artist: string;
  startTimeSec: number | null;
  endTimeSec: number | null;
  volume: number; // 0-200 (percentage; >100 = amplification via gain)
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Audio pipeline fields
  audioStatus: AudioStatus;
  audioError: string | null;
  audioFilename: string | null;
  duration: number | null;
  lastDownloadAt: string | null;
}

// ---------- Playlist ----------

export interface Playlist {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Favorite ----------

export interface Favorite {
  id: string;
  trackId: string;
  likedAt: string;
}

// ---------- Input types ----------

export interface CreateTrackInput {
  youtubeUrl: string;
  title: string;
  artist: string;
  startTimeSec?: number | null;
  endTimeSec?: number | null;
  volume?: number;
  notes?: string;
}

export interface UpdateTrackInput {
  youtubeUrl?: string;
  title?: string;
  artist?: string;
  startTimeSec?: number | null;
  endTimeSec?: number | null;
  volume?: number;
  notes?: string;
  // Allow manual metadata updates
  album?: string | null;
  releaseYear?: number | null;
  genre?: string | null;
  label?: string | null;
}

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  trackIds?: string[];
}

export interface UpdatePlaylistInput {
  name?: string;
  description?: string;
  trackIds?: string[];
}

// ---------- Pagination / Sorting ----------

export type SortableTrackField = 'artist' | 'title' | 'youtubeUrl' | 'createdAt' | 'updatedAt' | 'duration' | 'verified' | 'album' | 'genre' | 'releaseYear';
export type SortDirection = 'asc' | 'desc';

export interface PaginationParams {
  page: number;       // 1-based
  pageSize: number;
  sortBy: SortableTrackField;
  sortDir: SortDirection;
  search?: string;    // full-text search across title + artist
  verified?: boolean; // filter by verification status
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortBy: string;
  sortDir: string;
}

// ---------- Scheduler / Queue ----------

export interface SchedulerStatus {
  running: boolean;
  intervalMs: number;
  queueLength: number;
  activeJobs: number;
  maxConcurrency: number;
  budget: {
    aiEnrichesThisHour: number;
    aiEnrichesToday: number;
    maxAiPerHour: number;
    maxAiPerDay: number;
  };
  lastTickAt: string | null;
  nextTickAt: string | null;
  stats: {
    totalStageACompleted: number;
    totalStageBCompleted: number;
    totalErrors: number;
  };
}
