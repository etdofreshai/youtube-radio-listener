export type AudioStatus = 'pending' | 'downloading' | 'ready' | 'error';
export type VideoStatus = 'none' | 'pending' | 'downloading' | 'ready' | 'error';

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
  slug: string | null;
  youtubeUrl: string;
  title: string;
  artist: string;
  artistId: string | null;  // FK to artists table (primary/legacy)
  albumId: string | null;   // FK to albums table
  startTimeSec: number | null;
  endTimeSec: number | null;
  volume: number; // 0-200 (percentage; >100 = amplification via gain)
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Live stream flag
  isLiveStream: boolean;     // true = stream-only (no download), false = normal downloaded track
  // Audio pipeline fields
  audioStatus: AudioStatus;
  audioError: string | null;
  audioFilename: string | null;
  duration: number | null;
  lastDownloadAt: string | null;
  // Video pipeline fields
  videoStatus: VideoStatus;
  videoError: string | null;
  videoFilename: string | null;
  // Lyrics
  lyrics: string | null;           // plain-text lyrics
  lyricsSource: string | null;     // 'youtube-subtitles' | 'manual' | etc.
  // Populated relations (optional — included in API responses)
  artists?: ArtistSummary[];     // all linked artists (from track_artists join)
  albumName?: string | null;     // denormalized album title
  albumSlug?: string | null;     // denormalized album slug
  variants?: TrackVariant[];     // all YouTube URL variants for this canonical track
  trackGroupId?: string | null;  // group id when linked to alternate track rows
  linkedTracks?: LinkedTrackSummary[]; // other track rows in the same group
}

/** Lightweight artist reference embedded in track responses */
export interface ArtistSummary {
  id: string;
  name: string;
  slug: string;
  role: string;  // 'primary' | 'featured' | 'remix'
}

// ---------- Artist ----------

export interface Artist {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- Album ----------

export interface Album {
  id: string;
  title: string;
  slug: string;
  artistId: string | null;
  artistName: string | null;  // denormalized for convenience
  releaseYear: number | null;
  artworkUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- User ----------

export interface User {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- Playlist ----------

export interface Playlist {
  id: string;
  name: string;
  slug: string | null;
  description: string;
  trackIds: string[];
  // Ownership / sharing
  ownerId: string | null;       // created_by user id
  ownerUsername: string | null; // denormalized for display
  updatedBy: string | null;     // last editor user id
  updatedByUsername: string | null; // denormalized for display
  isPublic: boolean;            // visible to all users
  isEditableByOthers: boolean;  // editable by any authenticated user
  createdAt: string;
  updatedAt: string;
}

// ---------- Play Session ----------

export interface PlaySession {
  id: string;
  token: string;           // shareable link token
  name: string;
  ownerId: string;
  playlistId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface SessionMember {
  id: string;
  sessionId: string;
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
  leftAt: string | null;
}

export interface SessionState {
  sessionId: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  positionSec: number;
  positionUpdatedAt: string;  // ISO — client calculates actual position as: positionSec + (now - positionUpdatedAt) if isPlaying
  queue: string[];            // ordered track IDs
  updatedBy: string | null;
  updatedAt: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  userId: string | null;
  eventType: string;
  metadata: Record<string, any>;
  createdAt: string;
}

// ---------- Track Variant ----------

export type VariantKind =
  | 'original'
  | '4k'
  | 'official-video'
  | 'audio-only'
  | 'live'
  | 'remaster'
  | 'lyric-video'
  | 'remix'
  | 'acoustic'
  | 'other';

export interface TrackVariant {
  id: string;
  trackId: string;
  youtubeUrl: string;
  videoId: string;
  kind: VariantKind;
  label: string;
  isPreferred: boolean;
  position: number;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVariantInput {
  youtubeUrl: string;
  kind?: VariantKind;
  label?: string;
  isPreferred?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateVariantInput {
  kind?: VariantKind;
  label?: string;
  isPreferred?: boolean;
  metadata?: Record<string, any>;
}

// ---------- Track Linking / Grouping ----------

export interface LinkedTrackSummary {
  id: string;
  title: string;
  artist: string;
  youtubeUrl: string;
  isLiveStream: boolean;
  trackGroupId: string | null;
  createdAt: string;
}

export interface TrackGroup {
  id: string;
  name: string;
  canonicalTrackId: string | null;
  trackIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LinkTrackInput {
  targetTrackId: string;
  groupName?: string;
}

export interface SetPreferredLinkedTrackInput {
  preferredTrackId: string;
}

// ---------- Learning Resources (Learn/Play) ----------

export type LearningResourceType =
  | 'guitar-tabs'
  | 'guitar-chords'
  | 'piano-keys'
  | 'sheet-music'
  | 'tutorial';

export type LearningResourceConfidence = 'high' | 'medium' | 'low';

export interface LearningResource {
  id: string;
  trackId: string;
  resourceType: LearningResourceType;
  title: string;
  provider: string;
  url: string;
  snippet: string | null;
  confidence: LearningResourceConfidence | null;
  isSaved: boolean;
  searchQuery: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LearningResourceGrouped {
  guitarTabs: LearningResource[];
  guitarChords: LearningResource[];
  pianoKeys: LearningResource[];
  sheetMusic: LearningResource[];
  tutorials: LearningResource[];
}

export interface CreateLearningResourceInput {
  resourceType: LearningResourceType;
  title: string;
  provider: string;
  url: string;
  snippet?: string;
  confidence?: LearningResourceConfidence;
}

export interface SearchLearningResourcesResult {
  trackId: string;
  searchQuery: string;
  cached: boolean;
  searchedAt: string;
  resources: LearningResourceGrouped;
}

// ---------- Favorite (legacy) ----------

export interface Favorite {
  id: string;
  trackId: string;
  likedAt: string;
}

// ---------- User Favorite (polymorphic) ----------

export type FavoriteType = 'track' | 'artist' | 'album' | 'radio_station' | 'playlist';

export interface UserFavorite {
  id: string;
  userId: string;
  favoriteType: FavoriteType;
  entityId: string;
  addedAt: string;
  // Denormalized entity info (populated in API responses)
  entityName?: string;
  entityMeta?: Record<string, any>;
}

// ---------- Radio Stations ----------

export interface RadioStation {
  id: string;
  name: string;
  slug: string;
  streamUrl: string;
  homepageUrl: string | null;
  description: string | null;
  imageUrl: string | null;
  isLive: boolean;
  active: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRadioStationInput {
  name: string;
  streamUrl: string;
  homepageUrl?: string;
  description?: string;
  imageUrl?: string;
  isLive?: boolean;
  active?: boolean;
  tags?: string[];
}

export interface UpdateRadioStationInput {
  name?: string;
  streamUrl?: string;
  homepageUrl?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  isLive?: boolean;
  active?: boolean;
  tags?: string[];
}

// ---------- Input types ----------

export interface CreateTrackInput {
  youtubeUrl: string;
  title?: string;
  artist?: string;
  artistIds?: string[];   // link to multiple artists by ID
  startTimeSec?: number | null;
  endTimeSec?: number | null;
  volume?: number;
  notes?: string;
  isLiveStream?: boolean; // true = stream-only (no download)
}

export interface UpdateTrackInput {
  youtubeUrl?: string;
  title?: string;
  artist?: string;
  artistIds?: string[];   // replace linked artists
  albumId?: string | null;
  startTimeSec?: number | null;
  endTimeSec?: number | null;
  volume?: number;
  notes?: string;
  isLiveStream?: boolean;
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
  isPublic?: boolean;
  isEditableByOthers?: boolean;
}

export interface UpdatePlaylistInput {
  name?: string;
  description?: string;
  trackIds?: string[];
  isPublic?: boolean;
  isEditableByOthers?: boolean;
}

export interface CreateUserInput {
  username: string;
  displayName?: string | null;
}

export interface UpdateUserInput {
  username?: string;
  displayName?: string | null;
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
  query?: string;     // alias for search
  artist?: string;    // filter by artist name/slug
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

// ---------- Playback State (cross-device sync) ----------

/** Lightweight entry in play_history JSONB array */
export interface PlayHistoryEntry {
  trackId: string;
  playedAt: string;  // ISO timestamp
}

export interface PlaybackState {
  userId: string;
  currentTrackId: string | null;
  positionSec: number;
  isPlaying: boolean;
  queue: string[];              // ordered track IDs
  playHistory: PlayHistoryEntry[];  // most recent first
  updatedAt: string;
}

export interface UpdatePlaybackStateInput {
  currentTrackId?: string | null;
  positionSec?: number;
  isPlaying?: boolean;
  queue?: string[];
  playHistory?: PlayHistoryEntry[];
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
