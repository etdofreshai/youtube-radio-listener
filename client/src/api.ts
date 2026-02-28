import type {
  Track, Playlist, Favorite, Artist, Album, CreateTrackInput, UpdateTrackInput, CreatePlaylistInput,
  PaginatedResponse, SortableTrackField, SortDirection, SchedulerStatus,
  PaginatedEvents, PlaySession, SessionState, SessionMember, SessionFull,
  YouTubeSearchResponse, TrackVariant, CreateVariantInput, UpdateVariantInput,
  LinkTrackInput, LinkedTrackSummary, TrackGroup,
} from './types';

const BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---------- Tracks ----------

export interface GetTracksParams {
  page?: number;
  pageSize?: number;
  sortBy?: SortableTrackField;
  sortDir?: SortDirection;
  search?: string;
  verified?: boolean;
}

export const getTracks = (params?: GetTracksParams) => {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  if (params?.sortBy) query.set('sortBy', params.sortBy);
  if (params?.sortDir) query.set('sortDir', params.sortDir);
  if (params?.search) query.set('search', params.search);
  if (params?.verified !== undefined) query.set('verified', String(params.verified));
  const qs = query.toString();
  return request<PaginatedResponse<Track>>(`/api/tracks${qs ? '?' + qs : ''}`);
};

export const getTrack = (id: string) => request<Track>(`/api/tracks/${id}`);

export const createTrack = (data: CreateTrackInput) =>
  request<Track>('/api/tracks', { method: 'POST', body: JSON.stringify(data) });

export const updateTrack = (id: string, data: UpdateTrackInput) =>
  request<Track>(`/api/tracks/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deleteTrack = (id: string) =>
  request<void>(`/api/tracks/${id}`, { method: 'DELETE' });

// Audio
export const downloadTrack = (id: string) =>
  request<Track>(`/api/tracks/${id}/download`, { method: 'POST' });

export const refreshTrack = (id: string) =>
  request<Track>(`/api/tracks/${id}/refresh`, { method: 'POST' });

// Verification
export const verifyTrack = (id: string, verified: boolean, verifiedBy?: string) =>
  request<Track>(`/api/tracks/${id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ verified, verifiedBy }),
  });

// Enrichment
export const enrichTrack = (id: string) =>
  request<Track>(`/api/tracks/${id}/enrich`, { method: 'POST' });

export const enrichAllTracks = (force?: boolean) =>
  request<{ message: string; queued: number }>(`/api/tracks/enrich-all${force ? '?force=true' : ''}`, { method: 'POST' });

// Scheduler / enrichment status
export const getEnrichmentStatus = () =>
  request<SchedulerStatus>('/api/tracks/enrichment/status');

export const forceEnrichmentTick = () =>
  request<{ message: string; status: SchedulerStatus }>('/api/tracks/enrichment/tick', { method: 'POST' });

// YouTube Search
export const searchYouTube = (query: string, maxResults = 10) => {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  return request<YouTubeSearchResponse>(`/api/tracks/search-youtube?${params}`);
};

// Audio URL helper
export function getAudioUrl(trackId: string): string {
  return `${BASE}/api/audio/${trackId}`;
}

// Live stream URL helper — resolves + proxies live YouTube stream audio
export function getStreamUrl(trackId: string): string {
  return `${BASE}/api/stream/${trackId}`;
}

// Get the appropriate playback URL for a track (stream for live, audio for downloaded)
export function getPlaybackUrl(track: { id: string; isLiveStream: boolean }): string {
  return track.isLiveStream ? getStreamUrl(track.id) : getAudioUrl(track.id);
}

// Video URL helper
export function getVideoUrl(trackId: string): string {
  return `${BASE}/api/video/${trackId}`;
}

// Video download
export const downloadVideo = (id: string) =>
  request<Track>(`/api/tracks/${id}/download-video`, { method: 'POST' });

// Lyrics
export interface LyricsResponse {
  lyrics: string | null;
  lyricsSource: string | null;
  cached?: boolean;
}

export const getLyrics = (id: string) =>
  request<LyricsResponse>(`/api/tracks/${id}/lyrics`);

export const fetchLyrics = (id: string) =>
  request<LyricsResponse>(`/api/tracks/${id}/fetch-lyrics`, { method: 'POST' });

// Preview URL helper — streams audio directly from YouTube via server proxy
export function getPreviewUrl(videoId: string): string {
  return `${BASE}/api/preview/${videoId}`;
}

// ---------- Track Variants ----------

export const getVariants = (trackId: string) =>
  request<TrackVariant[]>(`/api/tracks/${trackId}/variants`);

export const addVariant = (trackId: string, data: CreateVariantInput) =>
  request<TrackVariant>(`/api/tracks/${trackId}/variants`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateVariant = (trackId: string, variantId: string, data: UpdateVariantInput) =>
  request<TrackVariant>(`/api/tracks/${trackId}/variants/${variantId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteVariant = (trackId: string, variantId: string) =>
  request<void>(`/api/tracks/${trackId}/variants/${variantId}`, { method: 'DELETE' });

export const setPreferredVariant = (trackId: string, variantId: string) =>
  request<Track>(`/api/tracks/${trackId}/variants/${variantId}/prefer`, { method: 'POST' });

export const createTrackForceNew = (data: CreateTrackInput) =>
  request<Track>('/api/tracks?forceCreate=true', { method: 'POST', body: JSON.stringify(data) });

// ---------- Track Links / Groups ----------

export const getTrackLinks = (trackId: string) =>
  request<{ trackId: string; trackGroupId: string | null; group?: TrackGroup; linkedTracks: LinkedTrackSummary[] }>(`/api/tracks/${trackId}/links`);

export const linkTrack = (trackId: string, data: LinkTrackInput) =>
  request<{ track: Track; group: TrackGroup }>(`/api/tracks/${trackId}/links`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const unlinkTrack = (trackId: string, targetTrackId: string) =>
  request<void>(`/api/tracks/${trackId}/links/${targetTrackId}`, { method: 'DELETE' });

export const setPreferredLinkedTrack = (trackId: string, preferredTrackId: string) =>
  request<TrackGroup>(`/api/tracks/${trackId}/links/preferred`, {
    method: 'POST',
    body: JSON.stringify({ preferredTrackId }),
  });

export const getPlaybackSource = (trackId: string) =>
  request<{ requestedTrackId: string; preferredTrackId: string; track: Track }>(`/api/tracks/${trackId}/playback-source`);

// ---------- Playlists ----------

export const getPlaylists = () => request<Playlist[]>('/api/playlists');
export const getPlaylist = (id: string) => request<Playlist>(`/api/playlists/${id}`);

export const createPlaylist = (data: CreatePlaylistInput) =>
  request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify(data) });

export const updatePlaylist = (id: string, data: Partial<CreatePlaylistInput>) =>
  request<Playlist>(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const deletePlaylist = (id: string) =>
  request<void>(`/api/playlists/${id}`, { method: 'DELETE' });

export const addTrackToPlaylist = (playlistId: string, trackId: string, position?: number) =>
  request<Playlist>(`/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ trackId, position }),
  });

export const removeTrackFromPlaylist = (playlistId: string, trackId: string) =>
  request<Playlist>(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: 'DELETE' });

export const reorderPlaylistTracks = (playlistId: string, trackIds: string[]) =>
  request<Playlist>(`/api/playlists/${playlistId}/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ trackIds }),
  });

// ---------- Favorites ----------

export const getFavorites = () => request<Favorite[]>('/api/favorites');

export const addFavorite = (trackId: string) =>
  request<Favorite>('/api/favorites', { method: 'POST', body: JSON.stringify({ trackId }) });

export const removeFavorite = (trackId: string) =>
  request<void>(`/api/favorites/${trackId}`, { method: 'DELETE' });

// ---------- Events / History ----------

export interface GetEventsParams {
  page?: number;
  pageSize?: number;
  eventType?: string;
  entityType?: string;
  entityId?: string;
  mine?: boolean;
}

export const getEvents = (params?: GetEventsParams) => {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  if (params?.eventType) query.set('eventType', params.eventType);
  if (params?.entityType) query.set('entityType', params.entityType);
  if (params?.entityId) query.set('entityId', params.entityId);
  if (params?.mine) query.set('mine', 'true');
  const qs = query.toString();
  return request<PaginatedEvents>(`/api/events${qs ? '?' + qs : ''}`);
};

export const getMyEvents = (params?: { page?: number; pageSize?: number; eventType?: string }) => {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('pageSize', String(params.pageSize));
  if (params?.eventType) query.set('eventType', params.eventType);
  const qs = query.toString();
  return request<PaginatedEvents>(`/api/events/my${qs ? '?' + qs : ''}`);
};

// ---------- Play Sessions ----------

export const createSession = (data: { name?: string; playlistId?: string; queue?: string[] }) =>
  request<{ session: PlaySession; state: SessionState }>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

export const getSession = (token: string) =>
  request<SessionFull>(`/api/sessions/${token}`);

export const getMySessions = () =>
  request<PlaySession[]>('/api/sessions/mine');

export const joinSession = (token: string) =>
  request<SessionFull>(`/api/sessions/${token}/join`, { method: 'POST' });

export const leaveSession = (token: string) =>
  request<{ message: string }>(`/api/sessions/${token}/leave`, { method: 'POST' });

export const getSessionState = (token: string) =>
  request<{ state: SessionState; currentTrack: Track | null }>(`/api/sessions/${token}/state`);

export const updateSessionState = (token: string, action: string, data?: { trackId?: string; positionSec?: number; queue?: string[] }) =>
  request<{ state: SessionState; currentTrack: Track | null }>(`/api/sessions/${token}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
  });

export const regenerateSessionToken = (token: string) =>
  request<{ token: string; message: string }>(`/api/sessions/${token}/regenerate`, { method: 'POST' });

export const endSessionApi = (token: string) =>
  request<{ message: string }>(`/api/sessions/${token}/end`, { method: 'POST' });

// ---------- Artists ----------

export const getArtists = () => request<Artist[]>('/api/artists');

export const getArtist = (idOrSlug: string) =>
  request<Artist & { tracks: Track[] }>(`/api/artists/${encodeURIComponent(idOrSlug)}`);

export const createArtist = (data: { name: string; imageUrl?: string; bio?: string }) =>
  request<Artist>('/api/artists', { method: 'POST', body: JSON.stringify(data) });

// ---------- Albums ----------

export const getAlbums = () => request<Album[]>('/api/albums');

export const getAlbumDetail = (idOrSlug: string) =>
  request<Album & { tracks: Track[] }>(`/api/albums/${encodeURIComponent(idOrSlug)}`);

// ---------- Learning Resources (Learn/Play) ----------

import type {
  LearningResource,
  LearningResourceGrouped,
  SearchLearningResourcesResult,
  CreateLearningResourceInput,
} from './types';

export const getLearningResources = (trackId: string, refresh = false) =>
  request<SearchLearningResourcesResult>(`/api/tracks/${trackId}/learn${refresh ? '?refresh=true' : ''}`);

export const getSavedLearningResources = (trackId: string) =>
  request<LearningResource[]>(`/api/tracks/${trackId}/learn/saved`);

export const addLearningResource = (trackId: string, data: CreateLearningResourceInput) =>
  request<LearningResource>(`/api/tracks/${trackId}/learn`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const saveLearningResource = (trackId: string, resourceId: string) =>
  request<LearningResource>(`/api/tracks/${trackId}/learn/${resourceId}/save`, { method: 'POST' });

export const unsaveLearningResource = (trackId: string, resourceId: string) =>
  request<LearningResource>(`/api/tracks/${trackId}/learn/${resourceId}/save`, { method: 'DELETE' });

export const deleteLearningResource = (trackId: string, resourceId: string) =>
  request<void>(`/api/tracks/${trackId}/learn/${resourceId}`, { method: 'DELETE' });
