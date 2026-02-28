/**
 * Store abstraction — routes to in-memory or PostgreSQL based on DATABASE_URL.
 *
 * When DATABASE_URL is set, all functions become async (returning Promises).
 * For backward compatibility, the memory store's synchronous API is wrapped.
 *
 * Usage: `import * as store from '../store';`
 * All functions return Promises regardless of backend.
 */

import * as memStore from './memory';
import * as pgStore from './postgres';
export type { AppEvent } from './postgres';
export { isUuid } from './postgres';

const usePostgres = !!process.env.DATABASE_URL;

function log(msg: string) {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[store] ${msg}`);
  }
}

if (usePostgres) {
  log('Using PostgreSQL store');
} else {
  log('Using in-memory store (no DATABASE_URL)');
}

// Wrap synchronous memory functions as async for uniform interface
function wrap<T>(syncResult: T): Promise<T> {
  return Promise.resolve(syncResult);
}

// ============================================================
// Tracks
// ============================================================

export function getAllTracks() {
  return usePostgres ? pgStore.getAllTracks() : wrap(memStore.getAllTracks());
}

export function getTracksPaginated(...args: Parameters<typeof memStore.getTracksPaginated>) {
  return usePostgres ? pgStore.getTracksPaginated(...args) : wrap(memStore.getTracksPaginated(...args));
}

export function getTracksNeedingEnrichment(...args: Parameters<typeof memStore.getTracksNeedingEnrichment>) {
  return usePostgres ? pgStore.getTracksNeedingEnrichment(...args) : wrap(memStore.getTracksNeedingEnrichment(...args));
}

export function getTrack(id: string) {
  return usePostgres ? pgStore.getTrack(id) : wrap(memStore.getTrack(id));
}

export function createTrack(...args: Parameters<typeof memStore.createTrack>) {
  return usePostgres ? pgStore.createTrack(...args) : wrap(memStore.createTrack(...args));
}

export function updateTrack(...args: Parameters<typeof memStore.updateTrack>) {
  return usePostgres ? pgStore.updateTrack(...args) : wrap(memStore.updateTrack(...args));
}

export function updateTrackAudio(...args: Parameters<typeof memStore.updateTrackAudio>) {
  return usePostgres ? pgStore.updateTrackAudio(...args) : wrap(memStore.updateTrackAudio(...args));
}

export function updateTrackVideo(...args: Parameters<typeof memStore.updateTrackVideo>) {
  return usePostgres ? pgStore.updateTrackVideo(...args) : wrap(memStore.updateTrackVideo(...args));
}

export function updateTrackMetadata(...args: Parameters<typeof memStore.updateTrackMetadata>) {
  return usePostgres ? pgStore.updateTrackMetadata(...args) : wrap(memStore.updateTrackMetadata(...args));
}

export function verifyTrack(...args: Parameters<typeof memStore.verifyTrack>) {
  return usePostgres ? pgStore.verifyTrack(...args) : wrap(memStore.verifyTrack(...args));
}

export function deleteTrack(id: string) {
  return usePostgres ? pgStore.deleteTrack(id) : wrap(memStore.deleteTrack(id));
}

export function getTracksByArtist(artistId: string) {
  if (!usePostgres) return Promise.resolve([]);
  return pgStore.getTracksByArtist(artistId);
}

export function getTracksByAlbum(albumId: string) {
  if (!usePostgres) return Promise.resolve([]);
  return pgStore.getTracksByAlbum(albumId);
}

// ============================================================
// Playlists
// ============================================================

export function getAllPlaylists() {
  return usePostgres ? pgStore.getAllPlaylists() : wrap(memStore.getAllPlaylists());
}

export function getPlaylist(id: string) {
  return usePostgres ? pgStore.getPlaylist(id) : wrap(memStore.getPlaylist(id));
}

export function createPlaylist(...args: Parameters<typeof memStore.createPlaylist>) {
  return usePostgres ? pgStore.createPlaylist(...args) : wrap(memStore.createPlaylist(...args));
}

export function updatePlaylist(...args: Parameters<typeof memStore.updatePlaylist>) {
  return usePostgres ? pgStore.updatePlaylist(...args) : wrap(memStore.updatePlaylist(...args));
}

export function deletePlaylist(id: string) {
  return usePostgres ? pgStore.deletePlaylist(id) : wrap(memStore.deletePlaylist(id));
}

// ============================================================
// Favorites
// ============================================================

export function getAllFavorites() {
  return usePostgres ? pgStore.getAllFavorites() : wrap(memStore.getAllFavorites());
}

export function addFavorite(trackId: string) {
  return usePostgres ? pgStore.addFavorite(trackId) : wrap(memStore.addFavorite(trackId));
}

export function removeFavorite(trackId: string) {
  return usePostgres ? pgStore.removeFavorite(trackId) : wrap(memStore.removeFavorite(trackId));
}

export function isFavorite(trackId: string) {
  return usePostgres ? pgStore.isFavorite(trackId) : wrap(memStore.isFavorite(trackId));
}

// ============================================================
// Events (only available with PostgreSQL; no-op for memory)
// ============================================================

export async function recordEvent(...args: Parameters<typeof pgStore.recordEvent>): ReturnType<typeof pgStore.recordEvent> {
  if (!usePostgres) {
    // No-op for in-memory mode — return a stub
    return {
      id: 'memory-no-op',
      userId: args[1]?.userId ?? null,
      eventType: args[0],
      entityType: args[1]?.entityType ?? null,
      entityId: args[1]?.entityId ?? null,
      metadata: args[1]?.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
  }
  return pgStore.recordEvent(...args);
}

export async function getEvents(...args: Parameters<typeof pgStore.getEvents>): ReturnType<typeof pgStore.getEvents> {
  if (!usePostgres) {
    return { data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 };
  }
  return pgStore.getEvents(...args);
}

// ============================================================
// Artists (postgres-only)
// ============================================================

export function getArtist(idOrSlug: string) {
  if (!usePostgres) return Promise.resolve(undefined);
  return pgStore.getArtist(idOrSlug);
}
export function getAllArtists() {
  if (!usePostgres) return Promise.resolve([]);
  return pgStore.getAllArtists();
}
export function createArtist(...args: Parameters<typeof pgStore.createArtist>) {
  if (!usePostgres) throw new Error('Artists require PostgreSQL');
  return pgStore.createArtist(...args);
}
export function updateArtist(...args: Parameters<typeof pgStore.updateArtist>) {
  if (!usePostgres) throw new Error('Artists require PostgreSQL');
  return pgStore.updateArtist(...args);
}
export function findOrCreateArtist(name: string) {
  if (!usePostgres) throw new Error('Artists require PostgreSQL');
  return pgStore.findOrCreateArtist(name);
}

// ============================================================
// Albums (postgres-only)
// ============================================================

export function getAlbum(idOrSlug: string) {
  if (!usePostgres) return Promise.resolve(undefined);
  return pgStore.getAlbum(idOrSlug);
}
export function getAllAlbums() {
  if (!usePostgres) return Promise.resolve([]);
  return pgStore.getAllAlbums();
}
export function createAlbum(...args: Parameters<typeof pgStore.createAlbum>) {
  if (!usePostgres) throw new Error('Albums require PostgreSQL');
  return pgStore.createAlbum(...args);
}
export function findOrCreateAlbum(...args: Parameters<typeof pgStore.findOrCreateAlbum>) {
  if (!usePostgres) throw new Error('Albums require PostgreSQL');
  return pgStore.findOrCreateAlbum(...args);
}

// ============================================================
// Play Sessions (postgres-only)
// ============================================================

export function createSession(...args: Parameters<typeof pgStore.createSession>) {
  if (!usePostgres) throw new Error('Sessions require PostgreSQL');
  return pgStore.createSession(...args);
}
export function getSession(token: string) {
  if (!usePostgres) return Promise.resolve(undefined);
  return pgStore.getSession(token);
}
export function getSessionById(id: string) {
  if (!usePostgres) return Promise.resolve(undefined);
  return pgStore.getSessionById(id);
}
export function getSessionState(sessionId: string) {
  if (!usePostgres) return Promise.resolve(undefined);
  return pgStore.getSessionState(sessionId);
}
export function getSessionMembers(sessionId: string) {
  if (!usePostgres) return Promise.resolve([]);
  return pgStore.getSessionMembers(sessionId);
}
export function joinSession(...args: Parameters<typeof pgStore.joinSession>) {
  if (!usePostgres) throw new Error('Sessions require PostgreSQL');
  return pgStore.joinSession(...args);
}
export function leaveSession(...args: Parameters<typeof pgStore.leaveSession>) {
  if (!usePostgres) throw new Error('Sessions require PostgreSQL');
  return pgStore.leaveSession(...args);
}
export function updateSessionState(...args: Parameters<typeof pgStore.updateSessionState>) {
  if (!usePostgres) throw new Error('Sessions require PostgreSQL');
  return pgStore.updateSessionState(...args);
}
export function regenerateSessionToken(...args: Parameters<typeof pgStore.regenerateSessionToken>) {
  if (!usePostgres) throw new Error('Sessions require PostgreSQL');
  return pgStore.regenerateSessionToken(...args);
}
export function endSession(...args: Parameters<typeof pgStore.endSession>) {
  if (!usePostgres) throw new Error('Sessions require PostgreSQL');
  return pgStore.endSession(...args);
}
export function recordSessionEvent(...args: Parameters<typeof pgStore.recordSessionEvent>) {
  if (!usePostgres) throw new Error('Sessions require PostgreSQL');
  return pgStore.recordSessionEvent(...args);
}
export function getSessionEvents(...args: Parameters<typeof pgStore.getSessionEvents>) {
  if (!usePostgres) return Promise.resolve({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 });
  return pgStore.getSessionEvents(...args);
}
export function getUserSessions(userId: string) {
  if (!usePostgres) return Promise.resolve([]);
  return pgStore.getUserSessions(userId);
}

// ============================================================
// Meta
// ============================================================

export function isPostgres(): boolean {
  return usePostgres;
}
