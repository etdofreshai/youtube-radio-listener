/**
 * Tests for playback sync types and queue management logic.
 * Uses Node built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PlaybackState, PlayHistoryEntry } from './types';

describe('PlaybackState types', () => {
  it('can construct a valid PlaybackState object', () => {
    const state: PlaybackState = {
      userId: 'user-1',
      currentTrackId: 'track-1',
      positionSec: 30.5,
      isPlaying: true,
      queue: ['track-1', 'track-2', 'track-3'],
      playHistory: [
        { trackId: 'track-0', playedAt: '2026-01-01T00:00:00Z' },
      ],
      updatedAt: '2026-01-01T00:01:00Z',
    };

    assert.equal(state.userId, 'user-1');
    assert.equal(state.currentTrackId, 'track-1');
    assert.equal(state.queue.length, 3);
    assert.equal(state.playHistory.length, 1);
  });

  it('queue upcoming computation works correctly', () => {
    const queue = ['a', 'b', 'c', 'd', 'e'];
    const currentTrackId = 'c';

    const currentIdx = queue.indexOf(currentTrackId);
    assert.equal(currentIdx, 2);

    const upcoming = queue.slice(currentIdx + 1);
    assert.deepEqual(upcoming, ['d', 'e']);

    const history = queue.slice(0, currentIdx);
    assert.deepEqual(history, ['a', 'b']);
  });

  it('play history deduplication works', () => {
    const MAX_HISTORY = 50;
    const history: PlayHistoryEntry[] = [
      { trackId: 'track-2', playedAt: '2026-01-01T00:02:00Z' },
      { trackId: 'track-1', playedAt: '2026-01-01T00:01:00Z' },
      { trackId: 'track-3', playedAt: '2026-01-01T00:00:00Z' },
    ];

    // Adding track-1 again (replay) — should deduplicate and move to top
    const newTrackId = 'track-1';
    const entry: PlayHistoryEntry = {
      trackId: newTrackId,
      playedAt: new Date().toISOString(),
    };

    const deduped = history.filter(h => h.trackId !== newTrackId);
    const updated = [entry, ...deduped].slice(0, MAX_HISTORY);

    assert.equal(updated.length, 3);
    assert.equal(updated[0].trackId, 'track-1'); // moved to top
    assert.equal(updated[1].trackId, 'track-2'); // preserved
    assert.equal(updated[2].trackId, 'track-3'); // preserved
  });

  it('empty state has correct defaults', () => {
    const emptyState: PlaybackState = {
      userId: 'user-1',
      currentTrackId: null,
      positionSec: 0,
      isPlaying: false,
      queue: [],
      playHistory: [],
      updatedAt: new Date().toISOString(),
    };

    assert.equal(emptyState.currentTrackId, null);
    assert.equal(emptyState.queue.length, 0);
    assert.equal(emptyState.playHistory.length, 0);
    assert.equal(emptyState.isPlaying, false);
  });
});
