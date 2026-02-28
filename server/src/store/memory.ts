import { v4 as uuidv4 } from 'uuid';
import type {
  Track, Playlist, Favorite,
  CreateTrackInput, UpdateTrackInput,
  CreatePlaylistInput, UpdatePlaylistInput,
  AudioStatus, VideoStatus, EnrichmentStatus, FieldConfidence,
  PaginationParams, PaginatedResponse,
  SortableTrackField, SortDirection,
} from '../types';

// ---------- In-memory store ----------

const tracks = new Map<string, Track>();
const playlists = new Map<string, Playlist>();
const favorites = new Map<string, Favorite>(); // keyed by favorite id

// ---------- Default metadata fields ----------

function defaultMetadata(): Pick<Track,
  'ytChannel' | 'ytChannelId' | 'ytUploadDate' | 'ytDescription' |
  'ytThumbnailUrl' | 'ytViewCount' | 'ytLikeCount' |
  'album' | 'releaseYear' | 'genre' | 'label' | 'isrc' | 'bpm' |
  'artworkUrl' | 'artworkSource' | 'alternateLinks' |
  'metadataSource' | 'metadataConfidence' | 'fieldConfidences' | 'lastEnrichedAt' |
  'enrichmentStatus' | 'enrichmentAttempts' | 'enrichmentError' |
  'nextEnrichAt' | 'stageACompletedAt' | 'stageBCompletedAt' |
  'verified' | 'verifiedBy' | 'verifiedAt' |
  'videoStatus' | 'videoError' | 'videoFilename'
> {
  return {
    ytChannel: null,
    ytChannelId: null,
    ytUploadDate: null,
    ytDescription: null,
    ytThumbnailUrl: null,
    ytViewCount: null,
    ytLikeCount: null,
    album: null,
    releaseYear: null,
    genre: null,
    label: null,
    isrc: null,
    bpm: null,
    artworkUrl: null,
    artworkSource: null,
    alternateLinks: null,
    metadataSource: null,
    metadataConfidence: null,
    fieldConfidences: [],
    lastEnrichedAt: null,
    enrichmentStatus: 'none',
    enrichmentAttempts: 0,
    enrichmentError: null,
    nextEnrichAt: null,
    stageACompletedAt: null,
    stageBCompletedAt: null,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    videoStatus: 'none',
    videoError: null,
    videoFilename: null,
  };
}

// ---------- Sorting helper ----------

function compareField(a: Track, b: Track, field: SortableTrackField, dir: SortDirection): number {
  let valA: string | number | boolean | null;
  let valB: string | number | boolean | null;

  switch (field) {
    case 'artist':
      valA = (a.artist || '').toLowerCase();
      valB = (b.artist || '').toLowerCase();
      break;
    case 'title':
      valA = (a.title || '').toLowerCase();
      valB = (b.title || '').toLowerCase();
      break;
    case 'youtubeUrl':
      valA = (a.youtubeUrl || '').toLowerCase();
      valB = (b.youtubeUrl || '').toLowerCase();
      break;
    case 'createdAt':
      valA = new Date(a.createdAt).getTime();
      valB = new Date(b.createdAt).getTime();
      break;
    case 'updatedAt':
      valA = new Date(a.updatedAt).getTime();
      valB = new Date(b.updatedAt).getTime();
      break;
    case 'duration':
      valA = a.duration ?? -1;
      valB = b.duration ?? -1;
      break;
    case 'verified':
      valA = a.verified ? 1 : 0;
      valB = b.verified ? 1 : 0;
      break;
    case 'album':
      valA = (a.album || '').toLowerCase();
      valB = (b.album || '').toLowerCase();
      break;
    case 'genre':
      valA = (a.genre || '').toLowerCase();
      valB = (b.genre || '').toLowerCase();
      break;
    case 'releaseYear':
      valA = a.releaseYear ?? -1;
      valB = b.releaseYear ?? -1;
      break;
    default:
      valA = new Date(a.createdAt).getTime();
      valB = new Date(b.createdAt).getTime();
  }

  let cmp = 0;
  if (valA < valB) cmp = -1;
  else if (valA > valB) cmp = 1;

  return dir === 'desc' ? -cmp : cmp;
}

// ---------- Tracks ----------

/** Get all tracks (legacy — returns newest first) */
export function getAllTracks(): Track[] {
  return Array.from(tracks.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Get tracks with pagination, sorting, and filtering */
export function getTracksPaginated(params: PaginationParams): PaginatedResponse<Track> {
  let result = Array.from(tracks.values());

  // Filter by search
  if (params.search) {
    const q = params.search.toLowerCase();
    result = result.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      (t.album && t.album.toLowerCase().includes(q)) ||
      (t.genre && t.genre.toLowerCase().includes(q))
    );
  }

  // Filter by verification status
  if (params.verified !== undefined) {
    result = result.filter(t => t.verified === params.verified);
  }

  // Sort
  result.sort((a, b) => compareField(a, b, params.sortBy, params.sortDir));

  const total = result.length;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  const page = Math.min(params.page, totalPages);
  const start = (page - 1) * params.pageSize;
  const data = result.slice(start, start + params.pageSize);

  return {
    data,
    total,
    page,
    pageSize: params.pageSize,
    totalPages,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
  };
}

/**
 * Find tracks that need enrichment, prioritized:
 * 1. Never enriched (enrichmentStatus === 'none')
 * 2. Stage A done but low confidence → candidates for Stage B
 * 3. Error with backoff elapsed
 * Returns at most `limit` tracks.
 */
export function getTracksNeedingEnrichment(limit: number, now: number): Track[] {
  const all = Array.from(tracks.values());

  // Score each track for enrichment priority (lower = more urgent)
  const scored: Array<{ track: Track; score: number }> = [];

  for (const t of all) {
    // Skip tracks currently being processed
    if (t.enrichmentStatus === 'stage_a' || t.enrichmentStatus === 'stage_b' || t.enrichmentStatus === 'queued') {
      continue;
    }

    // Skip tracks with nextEnrichAt in the future (backoff cooldown)
    if (t.nextEnrichAt && new Date(t.nextEnrichAt).getTime() > now) {
      continue;
    }

    let score: number;

    if (t.enrichmentStatus === 'none') {
      // Never enriched — highest priority. Older tracks first.
      score = 0 + (now - new Date(t.createdAt).getTime()) / 1e12;
    } else if (t.enrichmentStatus === 'stage_a_done' && t.metadataConfidence !== 'high') {
      // Stage A done but incomplete — needs Stage B
      const confPriority = t.metadataConfidence === 'low' ? 100 : 200;
      score = confPriority + (now - new Date(t.createdAt).getTime()) / 1e12;
    } else if (t.enrichmentStatus === 'error') {
      // Error — retry with lower priority
      score = 300 + t.enrichmentAttempts * 50;
    } else if (t.enrichmentStatus === 'complete' && t.metadataConfidence !== 'high') {
      // Complete but still low confidence — re-attempt with lowest priority
      score = 500;
    } else {
      // Already complete with high confidence — skip
      continue;
    }

    scored.push({ track: t, score });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(s => s.track);
}

export function getTrack(id: string): Track | undefined {
  return tracks.get(id);
}

export function createTrack(input: CreateTrackInput): Track {
  const now = new Date().toISOString();
  const track: Track = {
    id: uuidv4(),
    slug: null,
    youtubeUrl: input.youtubeUrl,
    title: input.title || 'Untitled',
    artist: input.artist || 'Unknown Artist',
    artistId: null,
    albumId: null,
    startTimeSec: input.startTimeSec ?? null,
    endTimeSec: input.endTimeSec ?? null,
    volume: input.volume ?? 100,
    notes: input.notes ?? '',
    createdAt: now,
    updatedAt: now,
    // Audio fields
    audioStatus: 'pending',
    audioError: null,
    audioFilename: null,
    duration: null,
    lastDownloadAt: null,
    // Metadata + verification + enrichment defaults
    ...defaultMetadata(),
  };
  tracks.set(track.id, track);
  return track;
}

export function updateTrack(id: string, input: UpdateTrackInput): Track | null {
  const existing = tracks.get(id);
  if (!existing) return null;

  const updates: Partial<Track> = {};
  if (input.youtubeUrl !== undefined) updates.youtubeUrl = input.youtubeUrl;
  if (input.title !== undefined) updates.title = input.title;
  if (input.artist !== undefined) updates.artist = input.artist;
  if (input.startTimeSec !== undefined) updates.startTimeSec = input.startTimeSec;
  if (input.endTimeSec !== undefined) updates.endTimeSec = input.endTimeSec;
  if (input.volume !== undefined) updates.volume = input.volume;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.album !== undefined) updates.album = input.album;
  if (input.releaseYear !== undefined) updates.releaseYear = input.releaseYear;
  if (input.genre !== undefined) updates.genre = input.genre;
  if (input.label !== undefined) updates.label = input.label;

  const updated: Track = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  tracks.set(id, updated);
  return updated;
}

export function updateTrackAudio(
  id: string,
  fields: {
    audioStatus: AudioStatus;
    audioError?: string | null;
    audioFilename?: string | null;
    duration?: number | null;
    lastDownloadAt?: string | null;
  }
): Track | null {
  const existing = tracks.get(id);
  if (!existing) return null;
  const updated: Track = {
    ...existing,
    audioStatus: fields.audioStatus,
    audioError: fields.audioError ?? existing.audioError,
    audioFilename: fields.audioFilename ?? existing.audioFilename,
    duration: fields.duration ?? existing.duration,
    lastDownloadAt: fields.lastDownloadAt ?? existing.lastDownloadAt,
    updatedAt: new Date().toISOString(),
  };
  tracks.set(id, updated);
  return updated;
}

export function updateTrackVideo(
  id: string,
  fields: {
    videoStatus: VideoStatus;
    videoError?: string | null;
    videoFilename?: string | null;
  }
): Track | null {
  const existing = tracks.get(id);
  if (!existing) return null;
  const updated: Track = {
    ...existing,
    videoStatus: fields.videoStatus,
    videoError: fields.videoError ?? existing.videoError,
    videoFilename: fields.videoFilename ?? existing.videoFilename,
    updatedAt: new Date().toISOString(),
  };
  tracks.set(id, updated);
  return updated;
}

/** Update metadata enrichment fields on a track */
export function updateTrackMetadata(
  id: string,
  fields: Partial<Pick<Track,
    'ytChannel' | 'ytChannelId' | 'ytUploadDate' | 'ytDescription' |
    'ytThumbnailUrl' | 'ytViewCount' | 'ytLikeCount' |
    'album' | 'releaseYear' | 'genre' | 'label' | 'isrc' | 'bpm' |
    'artworkUrl' | 'artworkSource' | 'alternateLinks' |
    'metadataSource' | 'metadataConfidence' | 'fieldConfidences' | 'lastEnrichedAt' |
    'enrichmentStatus' | 'enrichmentAttempts' | 'enrichmentError' |
    'nextEnrichAt' | 'stageACompletedAt' | 'stageBCompletedAt'
  >>
): Track | null {
  const existing = tracks.get(id);
  if (!existing) return null;
  const updated: Track = {
    ...existing,
    ...fields,
    updatedAt: new Date().toISOString(),
  };
  tracks.set(id, updated);
  return updated;
}

/** Set verification status on a track */
export function verifyTrack(
  id: string,
  verified: boolean,
  verifiedBy?: string | null
): Track | null {
  const existing = tracks.get(id);
  if (!existing) return null;
  const updated: Track = {
    ...existing,
    verified,
    verifiedBy: verified ? (verifiedBy ?? null) : null,
    verifiedAt: verified ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
  tracks.set(id, updated);
  return updated;
}

export function deleteTrack(id: string): boolean {
  return tracks.delete(id);
}

// ---------- Playlists ----------

export function getAllPlaylists(): Playlist[] {
  return Array.from(playlists.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getPlaylist(id: string): Playlist | undefined {
  return playlists.get(id);
}

export function createPlaylist(input: CreatePlaylistInput): Playlist {
  const now = new Date().toISOString();
  const playlist: Playlist = {
    id: uuidv4(),
    name: input.name,
    slug: null,
    description: input.description ?? '',
    trackIds: input.trackIds ?? [],
    createdAt: now,
    updatedAt: now,
  };
  playlists.set(playlist.id, playlist);
  return playlist;
}

export function updatePlaylist(id: string, input: UpdatePlaylistInput): Playlist | null {
  const existing = playlists.get(id);
  if (!existing) return null;
  const updated: Playlist = {
    ...existing,
    ...input,
    updatedAt: new Date().toISOString(),
  };
  playlists.set(id, updated);
  return updated;
}

export function deletePlaylist(id: string): boolean {
  return playlists.delete(id);
}

// ---------- Favorites ----------

export function getAllFavorites(): Favorite[] {
  return Array.from(favorites.values()).sort(
    (a, b) => new Date(b.likedAt).getTime() - new Date(a.likedAt).getTime()
  );
}

export function addFavorite(trackId: string): Favorite | null {
  if (!tracks.has(trackId)) return null;
  for (const fav of favorites.values()) {
    if (fav.trackId === trackId) return fav;
  }
  const fav: Favorite = {
    id: uuidv4(),
    trackId,
    likedAt: new Date().toISOString(),
  };
  favorites.set(fav.id, fav);
  return fav;
}

export function removeFavorite(trackId: string): boolean {
  for (const [id, fav] of favorites.entries()) {
    if (fav.trackId === trackId) {
      favorites.delete(id);
      return true;
    }
  }
  return false;
}

export function isFavorite(trackId: string): boolean {
  for (const fav of favorites.values()) {
    if (fav.trackId === trackId) return true;
  }
  return false;
}
