/**
 * Tests for playlist playback logic.
 *
 * Covers:
 *  - Playlist loading (track resolution in playlist order)
 *  - Queue auto-advance (sequential, shuffle, loop)
 *  - Skip forward/backward within playlist
 *  - PlaylistContext metadata (label formatting, index tracking)
 *  - Shuffle/loop behavior with playlists
 *
 * Run:
 *   cd client && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Types ────────────────────────────────────────────────────────────────────

interface SimpleTrack {
  id: string;
  audioStatus: 'ready' | 'error' | 'pending' | 'downloading';
}

type LoopMode = 'off' | 'all' | 'one';

interface PlaylistContext {
  playlistId: string;
  playlistName: string;
  trackIndex: number;
  totalTracks: number;
}

// ── Helpers extracted from AudioPlayer logic ─────────────────────────────────

/**
 * Resolve playlist trackIds to full track objects in playlist order.
 * Mirrors the logic in getPlaylistTracks() and AudioPlayerProvider.
 */
function resolvePlaylistTracks(
  trackIds: string[],
  allTracks: SimpleTrack[],
): SimpleTrack[] {
  const trackMap = new Map(allTracks.map(t => [t.id, t]));
  return trackIds
    .map(id => trackMap.get(id))
    .filter((t): t is SimpleTrack => t !== undefined);
}

/**
 * Returns the next track when the current track ends.
 * Mirrors onEndedRef logic in AudioPlayerProvider.
 */
function getAutoAdvanceTrack(
  tracks: SimpleTrack[],
  currentId: string,
  loopMode: LoopMode,
  shuffle: boolean,
  rng: () => number = Math.random,
): SimpleTrack | null {
  const readyTracks = tracks.filter(t => t.audioStatus === 'ready');
  const idx = readyTracks.findIndex(t => t.id === currentId);

  // Loop one: replay same track
  if (loopMode === 'one') {
    return readyTracks.find(t => t.id === currentId) ?? null;
  }

  // Shuffle: random non-current track
  if (shuffle && readyTracks.length > 1) {
    const others = readyTracks.filter(t => t.id !== currentId);
    if (others.length > 0) return others[Math.floor(rng() * others.length)];
    return null;
  }

  // Sequential
  if (idx >= 0 && idx < readyTracks.length - 1) return readyTracks[idx + 1];
  if (loopMode === 'all' && readyTracks.length > 0) return readyTracks[0];
  return null;
}

/**
 * Skips forward by one track.
 * Mirrors playNext logic in AudioPlayerProvider.
 */
function skipForward(
  tracks: SimpleTrack[],
  currentId: string,
  loopMode: LoopMode,
  shuffle: boolean,
  rng: () => number = Math.random,
): SimpleTrack | null {
  const readyTracks = tracks.filter(t => t.audioStatus === 'ready');
  const idx = readyTracks.findIndex(t => t.id === currentId);

  if (shuffle) {
    const others = readyTracks.filter(t => t.id !== currentId);
    if (others.length > 0) return others[Math.floor(rng() * others.length)];
    return null;
  }
  if (idx < readyTracks.length - 1) return readyTracks[idx + 1];
  if (loopMode === 'all' && readyTracks.length > 0) return readyTracks[0];
  return null;
}

/**
 * Skips backward by one track.
 * Mirrors playPrev logic in AudioPlayerProvider.
 */
function skipBackward(
  tracks: SimpleTrack[],
  currentId: string,
  loopMode: LoopMode,
): SimpleTrack | null {
  const readyTracks = tracks.filter(t => t.audioStatus === 'ready');
  const idx = readyTracks.findIndex(t => t.id === currentId);

  if (idx > 0) return readyTracks[idx - 1];
  if (loopMode === 'all' && readyTracks.length > 0) return readyTracks[readyTracks.length - 1];
  return null;
}

/** Format the playlist context label shown in the player bar. */
function formatPlaylistLabel(ctx: PlaylistContext): string {
  return `📋 ${ctx.playlistName} · ${ctx.trackIndex + 1}/${ctx.totalTracks}`;
}

/** Determine playlist context trackIndex after playing a new track. */
function updatePlaylistContextIndex(
  ctx: PlaylistContext & { tracks: SimpleTrack[] },
  newTrackId: string,
): number | null {
  const idx = ctx.tracks.findIndex(t => t.id === newTrackId);
  return idx >= 0 ? idx : null;
}

// ── Tests: Playlist loading ───────────────────────────────────────────────────

describe('Playlist loading', () => {
  const allTracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
    { id: 'c', audioStatus: 'ready' },
  ];

  it('resolves tracks in playlist order (not insertion order)', () => {
    const trackIds = ['c', 'a', 'b'];
    const resolved = resolvePlaylistTracks(trackIds, allTracks);
    assert.strictEqual(resolved.length, 3);
    assert.strictEqual(resolved[0].id, 'c');
    assert.strictEqual(resolved[1].id, 'a');
    assert.strictEqual(resolved[2].id, 'b');
  });

  it('omits missing (not-yet-downloaded) tracks gracefully', () => {
    const trackIds = ['a', 'missing-id', 'b'];
    const resolved = resolvePlaylistTracks(trackIds, allTracks);
    assert.strictEqual(resolved.length, 2);
    assert.deepStrictEqual(resolved.map(t => t.id), ['a', 'b']);
  });

  it('returns empty array for empty trackIds', () => {
    const resolved = resolvePlaylistTracks([], allTracks);
    assert.strictEqual(resolved.length, 0);
  });

  it('returns empty array when no tracks exist at all', () => {
    const resolved = resolvePlaylistTracks(['a', 'b'], []);
    assert.strictEqual(resolved.length, 0);
  });

  it('preserves duplicate track IDs in order', () => {
    // Edge case: playlist has same track twice (shouldn't happen but handle gracefully)
    const trackIds = ['a', 'b', 'a'];
    const resolved = resolvePlaylistTracks(trackIds, allTracks);
    assert.strictEqual(resolved.length, 3);
    assert.strictEqual(resolved[0].id, 'a');
    assert.strictEqual(resolved[1].id, 'b');
    assert.strictEqual(resolved[2].id, 'a');
  });
});

// ── Tests: Queue auto-advance ─────────────────────────────────────────────────

describe('Playlist auto-advance (sequential)', () => {
  const tracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
    { id: 'c', audioStatus: 'ready' },
  ];

  it('advances to next track in order', () => {
    const next = getAutoAdvanceTrack(tracks, 'a', 'off', false);
    assert.strictEqual(next?.id, 'b');
  });

  it('advances from middle to last', () => {
    const next = getAutoAdvanceTrack(tracks, 'b', 'off', false);
    assert.strictEqual(next?.id, 'c');
  });

  it('returns null at last track with loop off', () => {
    const next = getAutoAdvanceTrack(tracks, 'c', 'off', false);
    assert.strictEqual(next, null);
  });

  it('wraps to first track with loop all', () => {
    const next = getAutoAdvanceTrack(tracks, 'c', 'all', false);
    assert.strictEqual(next?.id, 'a');
  });

  it('only considers ready tracks (skips non-ready)', () => {
    const mixed: SimpleTrack[] = [
      { id: 'a', audioStatus: 'ready' },
      { id: 'b', audioStatus: 'downloading' },  // not ready
      { id: 'c', audioStatus: 'ready' },
    ];
    const next = getAutoAdvanceTrack(mixed, 'a', 'off', false);
    assert.strictEqual(next?.id, 'c');
  });

  it('returns null when only one ready track (no loop)', () => {
    const single: SimpleTrack[] = [
      { id: 'only', audioStatus: 'ready' },
      { id: 'err', audioStatus: 'error' },
    ];
    const next = getAutoAdvanceTrack(single, 'only', 'off', false);
    assert.strictEqual(next, null);
  });
});

// ── Tests: Loop one ───────────────────────────────────────────────────────────

describe('Playlist auto-advance (loop one)', () => {
  const tracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
  ];

  it('replays the same track on loop one', () => {
    const next = getAutoAdvanceTrack(tracks, 'a', 'one', false);
    assert.strictEqual(next?.id, 'a');
  });

  it('loop one on last track also replays same', () => {
    const next = getAutoAdvanceTrack(tracks, 'b', 'one', false);
    assert.strictEqual(next?.id, 'b');
  });

  it('loop one takes priority over shuffle', () => {
    // Even with shuffle=true, loop one should replay current
    const next = getAutoAdvanceTrack(tracks, 'a', 'one', true);
    assert.strictEqual(next?.id, 'a');
  });
});

// ── Tests: Shuffle within playlist ────────────────────────────────────────────

describe('Playlist auto-advance (shuffle)', () => {
  const tracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
    { id: 'c', audioStatus: 'ready' },
    { id: 'd', audioStatus: 'ready' },
  ];

  it('shuffle never picks current track', () => {
    for (let i = 0; i < 30; i++) {
      const next = getAutoAdvanceTrack(tracks, 'b', 'off', true);
      if (next) assert.notStrictEqual(next.id, 'b');
    }
  });

  it('shuffle with fixed RNG picks predictably from others', () => {
    // rng() = 0 → first element of others array
    const next = getAutoAdvanceTrack(tracks, 'a', 'off', true, () => 0);
    assert.ok(next !== null);
    assert.notStrictEqual(next.id, 'a');
    assert.strictEqual(next.id, 'b'); // first of [b, c, d]
  });

  it('shuffle returns null when only one track', () => {
    const single: SimpleTrack[] = [{ id: 'solo', audioStatus: 'ready' }];
    const next = getAutoAdvanceTrack(single, 'solo', 'off', true);
    assert.strictEqual(next, null);
  });

  it('shuffle loop=all still excludes current (not special loop-back behaviour)', () => {
    for (let i = 0; i < 20; i++) {
      const next = getAutoAdvanceTrack(tracks, 'c', 'all', true);
      if (next) assert.notStrictEqual(next.id, 'c');
    }
  });
});

// ── Tests: Skip forward/backward ─────────────────────────────────────────────

describe('Skip forward within playlist', () => {
  const tracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
    { id: 'c', audioStatus: 'ready' },
  ];

  it('skips to next track', () => {
    assert.strictEqual(skipForward(tracks, 'a', 'off', false)?.id, 'b');
    assert.strictEqual(skipForward(tracks, 'b', 'off', false)?.id, 'c');
  });

  it('returns null at end with loop off', () => {
    assert.strictEqual(skipForward(tracks, 'c', 'off', false), null);
  });

  it('wraps to first with loop all', () => {
    assert.strictEqual(skipForward(tracks, 'c', 'all', false)?.id, 'a');
  });

  it('shuffle skip picks different track', () => {
    const next = skipForward(tracks, 'b', 'off', true, () => 0);
    assert.ok(next !== null);
    assert.notStrictEqual(next.id, 'b');
  });
});

describe('Skip backward within playlist', () => {
  const tracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
    { id: 'c', audioStatus: 'ready' },
  ];

  it('skips to previous track', () => {
    assert.strictEqual(skipBackward(tracks, 'c', 'off')?.id, 'b');
    assert.strictEqual(skipBackward(tracks, 'b', 'off')?.id, 'a');
  });

  it('returns null at first track with loop off', () => {
    assert.strictEqual(skipBackward(tracks, 'a', 'off'), null);
  });

  it('wraps to last track with loop all', () => {
    assert.strictEqual(skipBackward(tracks, 'a', 'all')?.id, 'c');
  });

  it('skip forward then backward returns to original', () => {
    const fwd = skipForward(tracks, 'a', 'off', false);
    assert.strictEqual(fwd?.id, 'b');
    const back = skipBackward(tracks, fwd!.id, 'off');
    assert.strictEqual(back?.id, 'a');
  });
});

// ── Tests: PlaylistContext metadata ───────────────────────────────────────────

describe('PlaylistContext label formatting', () => {
  it('formats first track correctly', () => {
    const label = formatPlaylistLabel({
      playlistId: 'pl-1',
      playlistName: 'My Playlist',
      trackIndex: 0,
      totalTracks: 10,
    });
    assert.strictEqual(label, '📋 My Playlist · 1/10');
  });

  it('formats last track correctly', () => {
    const label = formatPlaylistLabel({
      playlistId: 'pl-1',
      playlistName: 'Rock Mix',
      trackIndex: 9,
      totalTracks: 10,
    });
    assert.strictEqual(label, '📋 Rock Mix · 10/10');
  });

  it('formats single-track playlist', () => {
    const label = formatPlaylistLabel({
      playlistId: 'pl-1',
      playlistName: 'Solo',
      trackIndex: 0,
      totalTracks: 1,
    });
    assert.strictEqual(label, '📋 Solo · 1/1');
  });

  it('handles playlist names with special characters', () => {
    const label = formatPlaylistLabel({
      playlistId: 'pl-2',
      playlistName: 'Best of 80s & 90s 🎸',
      trackIndex: 4,
      totalTracks: 20,
    });
    assert.strictEqual(label, '📋 Best of 80s & 90s 🎸 · 5/20');
  });
});

describe('PlaylistContext index tracking', () => {
  const tracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
    { id: 'c', audioStatus: 'ready' },
  ];

  const baseCtx = {
    playlistId: 'pl-1',
    playlistName: 'Test Playlist',
    trackIndex: 0,
    totalTracks: 3,
    tracks,
  };

  it('updates trackIndex when advancing to next track', () => {
    const newIdx = updatePlaylistContextIndex({ ...baseCtx, trackIndex: 0 }, 'b');
    assert.strictEqual(newIdx, 1);
  });

  it('updates trackIndex when wrapping around', () => {
    const newIdx = updatePlaylistContextIndex({ ...baseCtx, trackIndex: 2 }, 'a');
    assert.strictEqual(newIdx, 0);
  });

  it('returns null when track is not in playlist (e.g. user played external track)', () => {
    const newIdx = updatePlaylistContextIndex(baseCtx, 'external-track-id');
    assert.strictEqual(newIdx, null);
  });

  it('tracks accurate index for middle track', () => {
    const newIdx = updatePlaylistContextIndex(baseCtx, 'c');
    assert.strictEqual(newIdx, 2);
  });
});

// ── Tests: playPlaylist startIndex clamping ───────────────────────────────────

describe('playPlaylist startIndex clamping', () => {
  const tracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
    { id: 'c', audioStatus: 'ready' },
  ];

  function clampStartIndex(startIndex: number, tracksLength: number): number {
    return Math.max(0, Math.min(startIndex, tracksLength - 1));
  }

  it('clamps negative index to 0', () => {
    assert.strictEqual(clampStartIndex(-1, tracks.length), 0);
  });

  it('clamps out-of-bounds index to last', () => {
    assert.strictEqual(clampStartIndex(99, tracks.length), 2);
  });

  it('preserves valid index', () => {
    assert.strictEqual(clampStartIndex(1, tracks.length), 1);
  });

  it('index 0 for first element', () => {
    assert.strictEqual(clampStartIndex(0, tracks.length), 0);
  });
});

// ── Tests: Playlist plays only ready tracks ───────────────────────────────────

describe('Playlist respects audioStatus', () => {
  it('only ready tracks participate in auto-advance', () => {
    const tracks: SimpleTrack[] = [
      { id: 'r1', audioStatus: 'ready' },
      { id: 'p1', audioStatus: 'pending' },
      { id: 'r2', audioStatus: 'ready' },
      { id: 'e1', audioStatus: 'error' },
      { id: 'r3', audioStatus: 'ready' },
    ];
    const next = getAutoAdvanceTrack(tracks, 'r1', 'off', false);
    assert.strictEqual(next?.id, 'r2');
    const next2 = getAutoAdvanceTrack(tracks, 'r2', 'off', false);
    assert.strictEqual(next2?.id, 'r3');
  });

  it('returns null if all other tracks are non-ready', () => {
    const tracks: SimpleTrack[] = [
      { id: 'r1', audioStatus: 'ready' },
      { id: 'p1', audioStatus: 'pending' },
      { id: 'e1', audioStatus: 'error' },
    ];
    const next = getAutoAdvanceTrack(tracks, 'r1', 'off', false);
    assert.strictEqual(next, null);
  });
});
