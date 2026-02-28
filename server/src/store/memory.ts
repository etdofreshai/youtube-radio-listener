import { v4 as uuidv4 } from 'uuid';
import type {
  Track, Playlist, Favorite,
  CreateTrackInput, UpdateTrackInput,
  CreatePlaylistInput, UpdatePlaylistInput,
} from '../types';

// ---------- In-memory store ----------

const tracks = new Map<string, Track>();
const playlists = new Map<string, Playlist>();
const favorites = new Map<string, Favorite>(); // keyed by favorite id

// ---------- Tracks ----------

export function getAllTracks(): Track[] {
  return Array.from(tracks.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getTrack(id: string): Track | undefined {
  return tracks.get(id);
}

export function createTrack(input: CreateTrackInput): Track {
  const now = new Date().toISOString();
  const track: Track = {
    id: uuidv4(),
    youtubeUrl: input.youtubeUrl,
    title: input.title,
    artist: input.artist,
    startTimeSec: input.startTimeSec ?? null,
    endTimeSec: input.endTimeSec ?? null,
    volume: input.volume ?? 80,
    notes: input.notes ?? '',
    createdAt: now,
    updatedAt: now,
  };
  tracks.set(track.id, track);
  return track;
}

export function updateTrack(id: string, input: UpdateTrackInput): Track | null {
  const existing = tracks.get(id);
  if (!existing) return null;
  const updated: Track = {
    ...existing,
    ...input,
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
  // Check if track exists
  if (!tracks.has(trackId)) return null;
  // Check if already favorited
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
