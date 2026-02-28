export type AudioStatus = 'pending' | 'downloading' | 'ready' | 'error';

// ---------- Playlist Import ----------

export interface SkippedExistingItem {
  videoId: string;
  title: string | null;
  existingTrackId: string;
}

export interface FailedImportItem {
  videoId: string;
  title: string | null;
  reason: string;
}

export interface PlaylistImportSummary {
  /** Tracks successfully created in this run. */
  added: Track[];
  /** Items skipped because the video already exists as a variant. */
  skipped_existing: SkippedExistingItem[];
  /** Items that failed for any other reason. */
  failed: FailedImportItem[];
  /** Total items considered (after cap). */
  total: number;
  /** Human-readable playlist title, if available. */
  playlistTitle: string | null;
  /** True when the playlist was longer than the per-run cap. */
  truncated: boolean;
  /** The cap that was applied. */
  limit: number;
}
export type VideoStatus = 'none' | 'pending' | 'downloading' | 'ready' | 'error';

export type EnrichmentStatus =
  | 'none' | 'queued' | 'stage_a' | 'stage_a_done'
  | 'stage_b' | 'complete' | 'error';

// ---------- Metadata ----------

export interface FieldConfidence {
  field: string;
  confidence: 'high' | 'medium' | 'low' | 'manual';
  source: string;
  updatedAt: string;
}

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
  artworkUrl: string | null;
  artworkSource: string | null;
  alternateLinks: Record<string, string> | null;
}

export interface TrackProvenance {
  metadataSource: string | null;
  metadataConfidence: string | null;
  fieldConfidences: FieldConfidence[];
  lastEnrichedAt: string | null;
}

export interface TrackEnrichmentState {
  enrichmentStatus: EnrichmentStatus;
  enrichmentAttempts: number;
  enrichmentError: string | null;
  nextEnrichAt: string | null;
  stageACompletedAt: string | null;
  stageBCompletedAt: string | null;
}

export interface TrackVerification {
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

// ---------- Artist / Album ----------

export interface Artist {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Album {
  id: string;
  title: string;
  slug: string;
  artistId: string | null;
  artistName: string | null;
  releaseYear: number | null;
  artworkUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight artist reference embedded in track responses */
export interface ArtistSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}

// ---------- Track ----------

export interface Track extends TrackMetadata, TrackProvenance, TrackEnrichmentState, TrackVerification {
  id: string;
  slug: string | null;
  youtubeUrl: string;
  title: string;
  artist: string;
  artistId: string | null;
  albumId: string | null;
  startTimeSec: number | null;
  endTimeSec: number | null;
  volume: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Live stream flag
  isLiveStream: boolean;
  // Audio pipeline fields
  audioStatus: AudioStatus;
  audioError: string | null;
  audioFilename: string | null;
  duration: number | null;
  lastDownloadAt: string | null;
  // Video pipeline
  videoStatus: VideoStatus;
  videoError: string | null;
  videoFilename: string | null;
  // Lyrics
  lyrics: string | null;
  lyricsSource: string | null;
  // Populated relations
  artists?: ArtistSummary[];
  albumName?: string | null;
  albumSlug?: string | null;
  variants?: TrackVariant[];
  trackGroupId?: string | null;
  linkedTracks?: LinkedTrackSummary[];
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

export interface SearchLearningResourcesResult {
  trackId: string;
  searchQuery: string;
  cached: boolean;
  searchedAt: string;
  resources: LearningResourceGrouped;
}

export interface CreateLearningResourceInput {
  resourceType: LearningResourceType;
  title: string;
  provider: string;
  url: string;
  snippet?: string;
  confidence?: LearningResourceConfidence;
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

// ---------- Scheduler Status ----------

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

// ---------- Other models ----------

export interface Playlist {
  id: string;
  slug: string | null;
  name: string;
  description: string;
  trackIds: string[];
  // Ownership / sharing (v11)
  ownerId: string | null;
  ownerUsername: string | null;
  updatedBy: string | null;
  updatedByUsername: string | null;
  isPublic: boolean;
  isEditableByOthers: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Play Session ----------

export interface PlaySession {
  id: string;
  token: string;
  name: string;
  ownerId: string;
  playlistId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface SessionState {
  sessionId: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  positionSec: number;
  positionUpdatedAt: string;
  queue: string[];
  updatedBy: string | null;
  updatedAt: string;
}

export interface SessionMember {
  id: string;
  sessionId: string;
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
  leftAt: string | null;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  userId: string | null;
  eventType: string;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface SessionFull {
  session: PlaySession;
  state: SessionState;
  members: SessionMember[];
  currentTrack?: Track | null;
}

export interface Favorite {
  id: string;
  trackId: string;
  likedAt: string;
  track?: Track | null;
}

// ---------- YouTube Search ----------

export interface YouTubeSearchResultItem {
  videoId: string;
  title: string;
  channel: string;
  channelId: string | null;
  duration: number | null;
  thumbnailUrl: string | null;
  viewCount: number | null;
  youtubeUrl: string;
}

export interface YouTubeSearchResponse {
  results: YouTubeSearchResultItem[];
  query: string;
}

// ---------- Input types ----------

export interface CreateTrackInput {
  youtubeUrl: string;
  title?: string;
  artist?: string;
  artistIds?: string[];
  startTimeSec?: number | null;
  endTimeSec?: number | null;
  volume?: number;
  notes?: string;
  isLiveStream?: boolean;
}

export interface UpdateTrackInput {
  youtubeUrl?: string;
  title?: string;
  artist?: string;
  artistIds?: string[];
  albumId?: string | null;
  startTimeSec?: number | null;
  endTimeSec?: number | null;
  volume?: number;
  notes?: string;
  isLiveStream?: boolean;
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

// ---------- Playback State (cross-device sync) ----------

export interface PlayHistoryEntry {
  trackId: string;
  playedAt: string;
}

export interface PlaybackState {
  userId: string;
  currentTrackId: string | null;
  positionSec: number;
  isPlaying: boolean;
  queue: string[];
  playHistory: PlayHistoryEntry[];
  updatedAt: string;
  // Hydrated from server
  currentTrack?: Track | null;
  queueTracks?: Track[];
  historyTracks?: Track[];
}

// ---------- Events / History ----------

export interface AppEvent {
  id: string;
  userId: string | null;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, any>;
  createdAt: string;
}

export interface PaginatedEvents {
  data: AppEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
