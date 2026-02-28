/**
 * Tests for queue management and playlist interruption behavior.
 *
 * Covers:
 *  - Queue loading on playPlaylist() — all tracks queued upfront
 *  - Play Now interruption — clear playlist + remaining tracks
 *  - Queue ordering and "Up Next" display computation
 *  - Edge cases: empty playlist, single track playlist
 *  - playFromQueue — keeps playlist context, advances within queue
 *  - playTrackNow — clears playlist context and replaces queue
 *
 * Run:
 *   cd client && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Types (mirrors app types for pure-function testing) ──────────────────────

interface SimpleTrack {
  id: string;
  title: string;
  artist: string;
  audioStatus: 'ready' | 'error' | 'pending' | 'downloading';
}

interface PlaylistContext {
  playlistId: string;
  playlistName: string;
  tracks: SimpleTrack[];
  trackIndex: number;
}

// ── Pure functions extracted from AudioPlayer / usePlaybackSync logic ─────────

/**
 * Build the full queue from a playlist. Mirrors playPlaylist() behavior:
 * sets queue to ALL tracks, with startIndex track as current.
 */
function buildPlaylistQueue(
  tracks: SimpleTrack[],
  startIndex = 0,
): { queue: SimpleTrack[]; currentIndex: number } {
  if (tracks.length === 0) return { queue: [], currentIndex: -1 };
  const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
  return { queue: [...tracks], currentIndex: idx };
}

/**
 * Compute "Up Next" tracks from a queue and current track.
 * queue[currentIndex] = currently playing
 * queue.slice(currentIndex + 1) = Up Next
 */
function getUpNext(queue: SimpleTrack[], currentTrackId: string | null): SimpleTrack[] {
  if (!currentTrackId || queue.length === 0) return [];
  const idx = queue.findIndex(t => t.id === currentTrackId);
  if (idx < 0) return [];
  return queue.slice(idx + 1);
}

/**
 * Simulate playTrackNow() — interrupt current playlist, clear queue,
 * play the given track immediately.
 * Returns new state: queue becomes [track], playlistContext becomes null.
 */
function simulatePlayTrackNow(
  track: SimpleTrack,
  _currentPlaylistContext: PlaylistContext | null,
): {
  queue: SimpleTrack[];
  playlistContext: null;
  currentTrack: SimpleTrack;
} {
  return {
    queue: [track],
    playlistContext: null,
    currentTrack: track,
  };
}

/**
 * Simulate playFromQueue() — play a track from the current queue
 * without clearing playlist context.
 * Updates trackIndex in playlistContext if applicable.
 */
function simulatePlayFromQueue(
  track: SimpleTrack,
  currentQueue: SimpleTrack[],
  currentPlaylistContext: PlaylistContext | null,
): {
  queue: SimpleTrack[];
  playlistContext: PlaylistContext | null;
  currentTrack: SimpleTrack;
} {
  const ctx = currentPlaylistContext
    ? {
        ...currentPlaylistContext,
        trackIndex: currentPlaylistContext.tracks.findIndex(t => t.id === track.id),
      }
    : null;

  return {
    queue: currentQueue, // queue unchanged
    playlistContext: ctx,
    currentTrack: track,
  };
}

/**
 * Build sync queue (track IDs) from playlist context.
 * Mirrors the usePlaybackSync playlist watcher.
 */
function buildSyncQueueFromPlaylist(ctx: PlaylistContext): string[] {
  return ctx.tracks.map(t => t.id);
}

/**
 * Build sync queue when playlist is cleared (non-playlist mode).
 * Falls back to the audioQueue from the player.
 */
function buildSyncQueueOnClear(
  audioQueue: SimpleTrack[],
  currentTrack: SimpleTrack | null,
): string[] {
  if (audioQueue.length > 0) return audioQueue.map(t => t.id);
  if (currentTrack) return [currentTrack.id];
  return [];
}

// ── Test data ────────────────────────────────────────────────────────────────

function makeTracks(count: number): SimpleTrack[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `track-${i + 1}`,
    title: `Track ${i + 1}`,
    artist: `Artist ${i + 1}`,
    audioStatus: 'ready' as const,
  }));
}

// ── Tests: Queue loading on playPlaylist ──────────────────────────────────────

describe('Queue loading on playPlaylist()', () => {
  it('loads ALL tracks into queue (not just first)', () => {
    const tracks = makeTracks(30);
    const { queue, currentIndex } = buildPlaylistQueue(tracks);
    assert.strictEqual(queue.length, 30);
    assert.strictEqual(currentIndex, 0);
    assert.strictEqual(queue[0].id, 'track-1');
    assert.strictEqual(queue[29].id, 'track-30');
  });

  it('sets currentIndex to startIndex', () => {
    const tracks = makeTracks(10);
    const { queue, currentIndex } = buildPlaylistQueue(tracks, 5);
    assert.strictEqual(queue.length, 10);
    assert.strictEqual(currentIndex, 5);
    assert.strictEqual(queue[5].id, 'track-6');
  });

  it('clamps startIndex to valid range', () => {
    const tracks = makeTracks(5);
    const { currentIndex: idx1 } = buildPlaylistQueue(tracks, -1);
    assert.strictEqual(idx1, 0);
    const { currentIndex: idx2 } = buildPlaylistQueue(tracks, 99);
    assert.strictEqual(idx2, 4);
  });

  it('handles empty playlist gracefully', () => {
    const { queue, currentIndex } = buildPlaylistQueue([]);
    assert.strictEqual(queue.length, 0);
    assert.strictEqual(currentIndex, -1);
  });

  it('handles single-track playlist', () => {
    const tracks = makeTracks(1);
    const { queue, currentIndex } = buildPlaylistQueue(tracks);
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(currentIndex, 0);
    assert.strictEqual(queue[0].id, 'track-1');
  });
});

// ── Tests: Up Next computation ────────────────────────────────────────────────

describe('Up Next display from queue', () => {
  const tracks = makeTracks(5);

  it('shows remaining tracks after current', () => {
    const upNext = getUpNext(tracks, 'track-1');
    assert.strictEqual(upNext.length, 4);
    assert.strictEqual(upNext[0].id, 'track-2');
    assert.strictEqual(upNext[3].id, 'track-5');
  });

  it('shows nothing when current is last track', () => {
    const upNext = getUpNext(tracks, 'track-5');
    assert.strictEqual(upNext.length, 0);
  });

  it('shows one track when current is second-to-last', () => {
    const upNext = getUpNext(tracks, 'track-4');
    assert.strictEqual(upNext.length, 1);
    assert.strictEqual(upNext[0].id, 'track-5');
  });

  it('returns empty array when track not in queue', () => {
    const upNext = getUpNext(tracks, 'unknown-track');
    assert.strictEqual(upNext.length, 0);
  });

  it('returns empty array when currentTrackId is null', () => {
    const upNext = getUpNext(tracks, null);
    assert.strictEqual(upNext.length, 0);
  });

  it('returns empty array for empty queue', () => {
    const upNext = getUpNext([], 'track-1');
    assert.strictEqual(upNext.length, 0);
  });

  it('shows 29 tracks in Up Next for a 30-track playlist at position 0', () => {
    const bigPlaylist = makeTracks(30);
    const upNext = getUpNext(bigPlaylist, 'track-1');
    assert.strictEqual(upNext.length, 29);
  });

  it('shows 15 tracks when current is at position 15 of 30', () => {
    const bigPlaylist = makeTracks(30);
    const upNext = getUpNext(bigPlaylist, 'track-15');
    assert.strictEqual(upNext.length, 15);
    assert.strictEqual(upNext[0].id, 'track-16');
  });
});

// ── Tests: Play Now interruption ──────────────────────────────────────────────

describe('playTrackNow() interruption', () => {
  const playlistTracks = makeTracks(10);
  const playlistCtx: PlaylistContext = {
    playlistId: 'pl-1',
    playlistName: 'My Playlist',
    tracks: playlistTracks,
    trackIndex: 3,
  };

  it('clears playlist context', () => {
    const newTrack = { id: 'external-1', title: 'External Track', artist: 'Other', audioStatus: 'ready' as const };
    const result = simulatePlayTrackNow(newTrack, playlistCtx);
    assert.strictEqual(result.playlistContext, null);
  });

  it('replaces queue with single track', () => {
    const newTrack = { id: 'external-1', title: 'External Track', artist: 'Other', audioStatus: 'ready' as const };
    const result = simulatePlayTrackNow(newTrack, playlistCtx);
    assert.strictEqual(result.queue.length, 1);
    assert.strictEqual(result.queue[0].id, 'external-1');
  });

  it('sets the clicked track as current', () => {
    const newTrack = { id: 'external-1', title: 'External Track', artist: 'Other', audioStatus: 'ready' as const };
    const result = simulatePlayTrackNow(newTrack, playlistCtx);
    assert.strictEqual(result.currentTrack.id, 'external-1');
  });

  it('removes all remaining playlist tracks from queue', () => {
    const newTrack = { id: 'external-1', title: 'External Track', artist: 'Other', audioStatus: 'ready' as const };
    const result = simulatePlayTrackNow(newTrack, playlistCtx);
    // No playlist tracks should remain
    const playlistIds = new Set(playlistTracks.map(t => t.id));
    const remainingPlaylistTracks = result.queue.filter(t => playlistIds.has(t.id));
    assert.strictEqual(remainingPlaylistTracks.length, 0);
  });

  it('works when no playlist is active (null context)', () => {
    const newTrack = { id: 'solo-1', title: 'Solo Track', artist: 'Solo', audioStatus: 'ready' as const };
    const result = simulatePlayTrackNow(newTrack, null);
    assert.strictEqual(result.playlistContext, null);
    assert.strictEqual(result.queue.length, 1);
    assert.strictEqual(result.currentTrack.id, 'solo-1');
  });
});

// ── Tests: playFromQueue — within playlist ────────────────────────────────────

describe('playFromQueue() within playlist', () => {
  const playlistTracks = makeTracks(5);
  const playlistCtx: PlaylistContext = {
    playlistId: 'pl-1',
    playlistName: 'My Playlist',
    tracks: playlistTracks,
    trackIndex: 0,
  };

  it('keeps playlist context intact', () => {
    const result = simulatePlayFromQueue(playlistTracks[3], playlistTracks, playlistCtx);
    assert.ok(result.playlistContext !== null);
    assert.strictEqual(result.playlistContext!.playlistId, 'pl-1');
    assert.strictEqual(result.playlistContext!.playlistName, 'My Playlist');
  });

  it('updates trackIndex to the jumped-to track', () => {
    const result = simulatePlayFromQueue(playlistTracks[3], playlistTracks, playlistCtx);
    assert.strictEqual(result.playlistContext!.trackIndex, 3);
  });

  it('does not modify the queue', () => {
    const result = simulatePlayFromQueue(playlistTracks[3], playlistTracks, playlistCtx);
    assert.strictEqual(result.queue.length, 5);
    assert.strictEqual(result.queue, playlistTracks); // same reference
  });

  it('sets the clicked track as current', () => {
    const result = simulatePlayFromQueue(playlistTracks[3], playlistTracks, playlistCtx);
    assert.strictEqual(result.currentTrack.id, 'track-4');
  });

  it('works when jumping backward in queue', () => {
    const ctxAtEnd = { ...playlistCtx, trackIndex: 4 };
    const result = simulatePlayFromQueue(playlistTracks[1], playlistTracks, ctxAtEnd);
    assert.strictEqual(result.playlistContext!.trackIndex, 1);
    assert.strictEqual(result.currentTrack.id, 'track-2');
  });
});

// ── Tests: Sync queue building ────────────────────────────────────────────────

describe('Sync queue from playlist context', () => {
  it('builds sync queue with all playlist track IDs', () => {
    const tracks = makeTracks(10);
    const ctx: PlaylistContext = {
      playlistId: 'pl-1',
      playlistName: 'Test',
      tracks,
      trackIndex: 0,
    };
    const syncQueue = buildSyncQueueFromPlaylist(ctx);
    assert.strictEqual(syncQueue.length, 10);
    assert.deepStrictEqual(syncQueue, tracks.map(t => t.id));
  });

  it('preserves playlist track order', () => {
    const tracks = makeTracks(5).reverse(); // reversed order
    const ctx: PlaylistContext = {
      playlistId: 'pl-1',
      playlistName: 'Reversed',
      tracks,
      trackIndex: 0,
    };
    const syncQueue = buildSyncQueueFromPlaylist(ctx);
    assert.strictEqual(syncQueue[0], 'track-5');
    assert.strictEqual(syncQueue[4], 'track-1');
  });
});

describe('Sync queue on playlist clear', () => {
  it('falls back to audioQueue when playlist is cleared', () => {
    const pageTracks = makeTracks(3);
    const currentTrack = pageTracks[1];
    const syncQueue = buildSyncQueueOnClear(pageTracks, currentTrack);
    assert.strictEqual(syncQueue.length, 3);
    assert.deepStrictEqual(syncQueue, pageTracks.map(t => t.id));
  });

  it('falls back to just current track when audioQueue is empty', () => {
    const currentTrack = makeTracks(1)[0];
    const syncQueue = buildSyncQueueOnClear([], currentTrack);
    assert.strictEqual(syncQueue.length, 1);
    assert.strictEqual(syncQueue[0], 'track-1');
  });

  it('returns empty when both audioQueue and currentTrack are empty/null', () => {
    const syncQueue = buildSyncQueueOnClear([], null);
    assert.strictEqual(syncQueue.length, 0);
  });
});

// ── Tests: Queue ordering correctness ─────────────────────────────────────────

describe('Queue ordering', () => {
  it('queue preserves playlist order (not alphabetical or by id)', () => {
    const tracks: SimpleTrack[] = [
      { id: 'z', title: 'Zebra', artist: 'Zoo', audioStatus: 'ready' },
      { id: 'a', title: 'Apple', artist: 'Ant', audioStatus: 'ready' },
      { id: 'm', title: 'Mango', artist: 'Monkey', audioStatus: 'ready' },
    ];
    const { queue } = buildPlaylistQueue(tracks);
    assert.strictEqual(queue[0].id, 'z');
    assert.strictEqual(queue[1].id, 'a');
    assert.strictEqual(queue[2].id, 'm');
  });

  it('Up Next from middle of queue shows correct remaining tracks', () => {
    const tracks: SimpleTrack[] = [
      { id: 'x', title: 'X', artist: 'X', audioStatus: 'ready' },
      { id: 'y', title: 'Y', artist: 'Y', audioStatus: 'ready' },
      { id: 'z', title: 'Z', artist: 'Z', audioStatus: 'ready' },
      { id: 'w', title: 'W', artist: 'W', audioStatus: 'ready' },
    ];
    const upNext = getUpNext(tracks, 'y');
    assert.strictEqual(upNext.length, 2);
    assert.strictEqual(upNext[0].id, 'z');
    assert.strictEqual(upNext[1].id, 'w');
  });
});

// ── Tests: Edge cases ─────────────────────────────────────────────────────────

describe('Queue edge cases', () => {
  it('playTrackNow with same track thats in playlist still clears context', () => {
    const tracks = makeTracks(5);
    const ctx: PlaylistContext = {
      playlistId: 'pl-1',
      playlistName: 'Test',
      tracks,
      trackIndex: 2,
    };
    // User clicks "Play Now" on a track that happens to be in the current playlist
    const result = simulatePlayTrackNow(tracks[2], ctx);
    assert.strictEqual(result.playlistContext, null);
    assert.strictEqual(result.queue.length, 1);
  });

  it('single-track playlist has empty Up Next', () => {
    const tracks = makeTracks(1);
    const { queue } = buildPlaylistQueue(tracks);
    const upNext = getUpNext(queue, 'track-1');
    assert.strictEqual(upNext.length, 0);
  });

  it('playFromQueue at last track shows empty Up Next', () => {
    const tracks = makeTracks(5);
    const ctx: PlaylistContext = {
      playlistId: 'pl-1',
      playlistName: 'Test',
      tracks,
      trackIndex: 0,
    };
    const result = simulatePlayFromQueue(tracks[4], tracks, ctx);
    const upNext = getUpNext(result.queue, result.currentTrack.id);
    assert.strictEqual(upNext.length, 0);
  });

  it('playFromQueue without playlist context (non-playlist queue)', () => {
    const tracks = makeTracks(3);
    const result = simulatePlayFromQueue(tracks[1], tracks, null);
    assert.strictEqual(result.playlistContext, null);
    assert.strictEqual(result.currentTrack.id, 'track-2');
    assert.strictEqual(result.queue.length, 3);
  });

  it('queue integrity after multiple operations', () => {
    // 1. Start playlist
    const playlistTracks = makeTracks(10);
    let state = {
      queue: playlistTracks,
      playlistContext: {
        playlistId: 'pl-1',
        playlistName: 'Test',
        tracks: playlistTracks,
        trackIndex: 0,
      } as PlaylistContext | null,
      currentTrack: playlistTracks[0],
    };
    assert.strictEqual(getUpNext(state.queue, state.currentTrack.id).length, 9);

    // 2. Advance to track 5
    state = simulatePlayFromQueue(playlistTracks[4], state.queue, state.playlistContext);
    assert.strictEqual(getUpNext(state.queue, state.currentTrack.id).length, 5);
    assert.strictEqual(state.playlistContext?.trackIndex, 4);

    // 3. Play Now — interrupt with external track
    const external = { id: 'ext-1', title: 'External', artist: 'Ext', audioStatus: 'ready' as const };
    state = simulatePlayTrackNow(external, state.playlistContext);
    assert.strictEqual(state.playlistContext, null);
    assert.strictEqual(state.queue.length, 1);
    assert.strictEqual(getUpNext(state.queue, state.currentTrack.id).length, 0);
  });
});
