import type { Track, Playlist, Favorite, CreateTrackInput, UpdateTrackInput, CreatePlaylistInput } from './types';

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

// Tracks
export const getTracks = () => request<Track[]>('/api/tracks');
export const getTrack = (id: string) => request<Track>(`/api/tracks/${id}`);
export const createTrack = (data: CreateTrackInput) =>
  request<Track>('/api/tracks', { method: 'POST', body: JSON.stringify(data) });
export const updateTrack = (id: string, data: UpdateTrackInput) =>
  request<Track>(`/api/tracks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTrack = (id: string) =>
  request<void>(`/api/tracks/${id}`, { method: 'DELETE' });

// Audio download/refresh
export const downloadTrack = (id: string) =>
  request<Track>(`/api/tracks/${id}/download`, { method: 'POST' });
export const refreshTrack = (id: string) =>
  request<Track>(`/api/tracks/${id}/refresh`, { method: 'POST' });

// Audio URL helper
export function getAudioUrl(trackId: string): string {
  return `${BASE}/api/audio/${trackId}`;
}

// Playlists
export const getPlaylists = () => request<Playlist[]>('/api/playlists');
export const getPlaylist = (id: string) => request<Playlist>(`/api/playlists/${id}`);
export const createPlaylist = (data: CreatePlaylistInput) =>
  request<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify(data) });
export const updatePlaylist = (id: string, data: Partial<CreatePlaylistInput>) =>
  request<Playlist>(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deletePlaylist = (id: string) =>
  request<void>(`/api/playlists/${id}`, { method: 'DELETE' });

// Playlist track management
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

// Favorites
export const getFavorites = () => request<Favorite[]>('/api/favorites');
export const addFavorite = (trackId: string) =>
  request<Favorite>('/api/favorites', { method: 'POST', body: JSON.stringify({ trackId }) });
export const removeFavorite = (trackId: string) =>
  request<void>(`/api/favorites/${trackId}`, { method: 'DELETE' });
