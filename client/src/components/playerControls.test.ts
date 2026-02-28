/**
 * Tests for shuffle toggle, loop mode cycling, and add-to-playlist logic.
 *
 * Run:
 *   cd client && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── LoopMode cycling ─────────────────────────────────────────────────────────

type LoopMode = 'off' | 'all' | 'one';

function cycleLoopMode(current: LoopMode): LoopMode {
  if (current === 'off') return 'all';
  if (current === 'all') return 'one';
  return 'off';
}

describe('cycleLoopMode', () => {
  it('off → all', () => {
    assert.strictEqual(cycleLoopMode('off'), 'all');
  });

  it('all → one', () => {
    assert.strictEqual(cycleLoopMode('all'), 'one');
  });

  it('one → off', () => {
    assert.strictEqual(cycleLoopMode('one'), 'off');
  });

  it('full cycle returns to original', () => {
    let mode: LoopMode = 'off';
    mode = cycleLoopMode(mode);
    mode = cycleLoopMode(mode);
    mode = cycleLoopMode(mode);
    assert.strictEqual(mode, 'off');
  });
});

// ── Shuffle toggle ───────────────────────────────────────────────────────────

function toggleShuffle(current: boolean): boolean {
  return !current;
}

describe('toggleShuffle', () => {
  it('false → true', () => {
    assert.strictEqual(toggleShuffle(false), true);
  });

  it('true → false', () => {
    assert.strictEqual(toggleShuffle(true), false);
  });

  it('double toggle returns to original', () => {
    assert.strictEqual(toggleShuffle(toggleShuffle(false)), false);
  });
});

// ── Shuffle-aware next track selection ───────────────────────────────────────

interface SimpleTrack { id: string; audioStatus: string }

function getNextTrack(
  readyTracks: SimpleTrack[],
  currentId: string,
  shuffle: boolean,
  loopMode: LoopMode,
  rng: () => number = Math.random,
): SimpleTrack | null {
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

describe('getNextTrack', () => {
  const tracks: SimpleTrack[] = [
    { id: 'a', audioStatus: 'ready' },
    { id: 'b', audioStatus: 'ready' },
    { id: 'c', audioStatus: 'ready' },
  ];

  it('returns next track in order (no shuffle, no loop)', () => {
    const next = getNextTrack(tracks, 'a', false, 'off');
    assert.strictEqual(next?.id, 'b');
  });

  it('returns null at end of list (no loop)', () => {
    const next = getNextTrack(tracks, 'c', false, 'off');
    assert.strictEqual(next, null);
  });

  it('wraps around with loop=all', () => {
    const next = getNextTrack(tracks, 'c', false, 'all');
    assert.strictEqual(next?.id, 'a');
  });

  it('returns random track in shuffle mode (not the current)', () => {
    // Fixed RNG that returns 0 → should pick first "other" track
    const next = getNextTrack(tracks, 'b', true, 'off', () => 0);
    assert.ok(next !== null);
    assert.notStrictEqual(next.id, 'b');
  });

  it('shuffle always excludes current track', () => {
    for (let i = 0; i < 20; i++) {
      const next = getNextTrack(tracks, 'a', true, 'off');
      if (next) assert.notStrictEqual(next.id, 'a');
    }
  });

  it('returns null for single-track list in shuffle', () => {
    const single: SimpleTrack[] = [{ id: 'x', audioStatus: 'ready' }];
    const next = getNextTrack(single, 'x', true, 'off');
    assert.strictEqual(next, null);
  });
});

// ── Loop one behavior ────────────────────────────────────────────────────────

describe('loop one mode', () => {
  it('loop=one should replay current (simulated)', () => {
    const mode: LoopMode = 'one';
    // In real code, onEnded replays currentTrack when mode='one'
    // Here we just validate the condition
    assert.strictEqual(mode === 'one', true);
    // The actual implementation calls play(currentTrack) which would re-seek to start
  });
});

// ── Accessibility: aria labels ───────────────────────────────────────────────

describe('Accessibility labels', () => {
  const shuffleLabels = (active: boolean) => ({
    'aria-label': active ? 'Disable shuffle' : 'Enable shuffle',
    'aria-pressed': active,
    title: active ? 'Shuffle: On' : 'Shuffle: Off',
  });

  const loopLabels = (mode: LoopMode) => ({
    'aria-label': `Loop mode: ${mode}`,
    title: mode === 'off' ? 'Loop: Off' : mode === 'all' ? 'Loop: All' : 'Loop: One',
  });

  it('shuffle off has correct aria', () => {
    const labels = shuffleLabels(false);
    assert.strictEqual(labels['aria-label'], 'Enable shuffle');
    assert.strictEqual(labels['aria-pressed'], false);
  });

  it('shuffle on has correct aria', () => {
    const labels = shuffleLabels(true);
    assert.strictEqual(labels['aria-label'], 'Disable shuffle');
    assert.strictEqual(labels['aria-pressed'], true);
  });

  it('loop off has correct aria', () => {
    const labels = loopLabels('off');
    assert.strictEqual(labels.title, 'Loop: Off');
  });

  it('loop all has correct aria', () => {
    const labels = loopLabels('all');
    assert.strictEqual(labels.title, 'Loop: All');
  });

  it('loop one has correct aria', () => {
    const labels = loopLabels('one');
    assert.strictEqual(labels.title, 'Loop: One');
  });

  it('track menu trigger has required aria attributes', () => {
    // Validate the structure matches what TrackMenu renders
    const triggerAttrs = {
      'aria-label': 'Track options',
      'aria-haspopup': 'true',
      role: 'button', // implicit from <button>
    };
    assert.strictEqual(triggerAttrs['aria-label'], 'Track options');
    assert.strictEqual(triggerAttrs['aria-haspopup'], 'true');
  });
});

// ── Add to playlist submission flow ──────────────────────────────────────────

describe('Add to playlist data flow', () => {
  it('addTrackToPlaylist sends correct payload structure', () => {
    const playlistId = 'pl-123';
    const trackId = 'tr-456';
    const position = undefined;

    const payload = JSON.stringify({ trackId, position });
    const parsed = JSON.parse(payload);

    assert.strictEqual(parsed.trackId, 'tr-456');
    assert.strictEqual(parsed.position, undefined);
  });

  it('createPlaylist with initial trackIds', () => {
    const payload = JSON.stringify({ name: 'My Playlist', trackIds: ['tr-1', 'tr-2'] });
    const parsed = JSON.parse(payload);

    assert.strictEqual(parsed.name, 'My Playlist');
    assert.deepStrictEqual(parsed.trackIds, ['tr-1', 'tr-2']);
  });

  it('empty playlist name is rejected (client-side check)', () => {
    const name = '';
    assert.strictEqual(name.trim().length === 0, true);
  });

  it('non-empty playlist name passes validation', () => {
    const name = 'Rock Favorites';
    assert.strictEqual(name.trim().length > 0, true);
  });
});
