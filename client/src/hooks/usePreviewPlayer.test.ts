/**
 * Tests for preview player state logic (pure functions).
 *
 * Run:
 *   cd client && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  derivePreviewState,
  computePlayTransition,
  computePauseTransition,
  computeStopTransition,
} from './previewState';

// ── derivePreviewState ──────────────────────────────────────

describe('derivePreviewState', () => {
  it('returns idle when videoId does not match activeVideoId', () => {
    assert.strictEqual(derivePreviewState('abc', 'xyz', 'playing'), 'idle');
  });

  it('returns idle when activeVideoId is null', () => {
    assert.strictEqual(derivePreviewState('abc', null, 'idle'), 'idle');
  });

  it('returns the active state when videoId matches activeVideoId', () => {
    assert.strictEqual(derivePreviewState('abc', 'abc', 'playing'), 'playing');
    assert.strictEqual(derivePreviewState('abc', 'abc', 'paused'), 'paused');
    assert.strictEqual(derivePreviewState('abc', 'abc', 'loading'), 'loading');
    assert.strictEqual(derivePreviewState('abc', 'abc', 'error'), 'error');
    assert.strictEqual(derivePreviewState('abc', 'abc', 'idle'), 'idle');
  });
});

// ── computePlayTransition ───────────────────────────────────

describe('computePlayTransition', () => {
  it('transitions to loading when playing a new video from idle', () => {
    const [vid, state] = computePlayTransition('abc', null, 'idle');
    assert.strictEqual(vid, 'abc');
    assert.strictEqual(state, 'loading');
  });

  it('transitions to loading when switching to a different video', () => {
    const [vid, state] = computePlayTransition('new', 'old', 'playing');
    assert.strictEqual(vid, 'new');
    assert.strictEqual(state, 'loading');
  });

  it('resumes (playing) when the same video is paused', () => {
    const [vid, state] = computePlayTransition('abc', 'abc', 'paused');
    assert.strictEqual(vid, 'abc');
    assert.strictEqual(state, 'playing');
  });

  it('transitions to loading when replaying same video from idle', () => {
    const [vid, state] = computePlayTransition('abc', 'abc', 'idle');
    assert.strictEqual(vid, 'abc');
    assert.strictEqual(state, 'loading');
  });

  it('transitions to loading when retrying same video from error', () => {
    const [vid, state] = computePlayTransition('abc', 'abc', 'error');
    assert.strictEqual(vid, 'abc');
    assert.strictEqual(state, 'loading');
  });

  it('transitions to loading when already playing (restart)', () => {
    const [vid, state] = computePlayTransition('abc', 'abc', 'playing');
    assert.strictEqual(vid, 'abc');
    assert.strictEqual(state, 'loading');
  });
});

// ── computePauseTransition ──────────────────────────────────

describe('computePauseTransition', () => {
  it('pauses when currently playing', () => {
    const [vid, state] = computePauseTransition('abc', 'playing');
    assert.strictEqual(vid, 'abc');
    assert.strictEqual(state, 'paused');
  });

  it('no-op when already paused', () => {
    const [vid, state] = computePauseTransition('abc', 'paused');
    assert.strictEqual(vid, 'abc');
    assert.strictEqual(state, 'paused');
  });

  it('no-op when idle', () => {
    const [vid, state] = computePauseTransition(null, 'idle');
    assert.strictEqual(vid, null);
    assert.strictEqual(state, 'idle');
  });

  it('no-op when loading', () => {
    const [vid, state] = computePauseTransition('abc', 'loading');
    assert.strictEqual(vid, 'abc');
    assert.strictEqual(state, 'loading');
  });
});

// ── computeStopTransition ───────────────────────────────────

describe('computeStopTransition', () => {
  it('always returns [null, idle]', () => {
    const [vid, state] = computeStopTransition();
    assert.strictEqual(vid, null);
    assert.strictEqual(state, 'idle');
  });
});

// ── Single-active preview enforcement (integration-level logic) ─────────

describe('single-active preview enforcement', () => {
  it('playing video B while A is active makes A idle', () => {
    // Simulate: A is playing
    let activeVideoId: string | null = 'A';
    let activeState = 'playing' as const;

    // User plays B → computePlayTransition
    const [nextVid, nextState] = computePlayTransition('B', activeVideoId, activeState);
    activeVideoId = nextVid;
    activeState = nextState as any;

    // A should now derive as idle
    assert.strictEqual(derivePreviewState('A', activeVideoId, activeState), 'idle');
    // B should be loading
    assert.strictEqual(derivePreviewState('B', activeVideoId, activeState), 'loading');
  });

  it('stopping clears all derived states to idle', () => {
    // Simulate: B is playing
    let activeVideoId: string | null = 'B';

    // User stops
    const [nextVid, nextState] = computeStopTransition();
    activeVideoId = nextVid;

    assert.strictEqual(derivePreviewState('A', activeVideoId, nextState), 'idle');
    assert.strictEqual(derivePreviewState('B', activeVideoId, nextState), 'idle');
    assert.strictEqual(derivePreviewState('C', activeVideoId, nextState), 'idle');
  });
});

// ── Full lifecycle scenario ─────────────────────────────────

describe('full lifecycle scenario', () => {
  it('play → pause → resume → stop', () => {
    let vid: string | null = null;
    let st: any = 'idle';

    // Play A
    [vid, st] = computePlayTransition('A', vid, st);
    assert.deepStrictEqual([vid, st], ['A', 'loading']);

    // Simulate: audio starts playing
    st = 'playing';
    assert.strictEqual(derivePreviewState('A', vid, st), 'playing');

    // Pause A
    [vid, st] = computePauseTransition(vid, st);
    assert.deepStrictEqual([vid, st], ['A', 'paused']);
    assert.strictEqual(derivePreviewState('A', vid, st), 'paused');

    // Resume A
    [vid, st] = computePlayTransition('A', vid, st);
    assert.deepStrictEqual([vid, st], ['A', 'playing']);

    // Stop
    [vid, st] = computeStopTransition();
    assert.deepStrictEqual([vid, st], [null, 'idle']);
    assert.strictEqual(derivePreviewState('A', vid, st), 'idle');
  });
});
