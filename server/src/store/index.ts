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

export function updateTrackMetadata(...args: Parameters<typeof memStore.updateTrackMetadata>) {
  return usePostgres ? pgStore.updateTrackMetadata(...args) : wrap(memStore.updateTrackMetadata(...args));
}

export function verifyTrack(...args: Parameters<typeof memStore.verifyTrack>) {
  return usePostgres ? pgStore.verifyTrack(...args) : wrap(memStore.verifyTrack(...args));
}

export function deleteTrack(id: string) {
  return usePostgres ? pgStore.deleteTrack(id) : wrap(memStore.deleteTrack(id));
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
// Meta
// ============================================================

export function isPostgres(): boolean {
  return usePostgres;
}
