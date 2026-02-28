export type AudioStatus = 'pending' | 'downloading' | 'ready' | 'error';

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
}

export interface TrackProvenance {
  metadataSource: string | null;      // 'youtube' | 'musicbrainz' | 'manual' | etc.
  metadataConfidence: string | null;  // 'high' | 'medium' | 'low'
  lastEnrichedAt: string | null;      // ISO timestamp
}

// ---------- Verification ----------

export interface TrackVerification {
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;         // ISO timestamp
}

// ---------- Track ----------

export interface Track extends TrackMetadata, TrackProvenance, TrackVerification {
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
