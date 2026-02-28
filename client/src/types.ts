export type AudioStatus = 'pending' | 'downloading' | 'ready' | 'error';

// ---------- Metadata ----------

export interface TrackMetadata {
  ytChannel: string | null;
  ytChannelId: string | null;
  ytUploadDate: string | null;
  ytDescription: string | null;
  ytThumbnailUrl: string | null;
  ytViewCount: number | null;
  ytLikeCount: number | null;
  album: string | null;
  releaseYear: number | null;
  genre: string | null;
  label: string | null;
  isrc: string | null;
  bpm: number | null;
}

export interface TrackProvenance {
  metadataSource: string | null;
  metadataConfidence: string | null;
  lastEnrichedAt: string | null;
}

export interface TrackVerification {
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

// ---------- Track ----------

export interface Track extends TrackMetadata, TrackProvenance, TrackVerification {
  id: string;
  youtubeUrl: string;
  title: string;
  artist: string;
  startTimeSec: number | null;
  endTimeSec: number | null;
  volume: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
  audioStatus: AudioStatus;
  audioError: string | null;
  audioFilename: string | null;
  duration: number | null;
  lastDownloadAt: string | null;
}

// ---------- Pagination / Sort ----------

export type SortableTrackField = 'artist' | 'title' | 'youtubeUrl' | 'createdAt' | 'updatedAt' | 'duration' | 'verified' | 'album' | 'genre' | 'releaseYear';
export type SortDirection = 'asc' | 'desc';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortBy: string;
  sortDir: string;
}

// ---------- Other models ----------

export interface Playlist {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Favorite {
  id: string;
  trackId: string;
  likedAt: string;
  track?: Track | null;
}

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
