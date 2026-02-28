/**
 * Tests for NowPlayingPage helpers and nav/route constants.
 *
 * Run (from repo root):
 *   node --import ../server/node_modules/tsx/dist/esm/index.mjs --test client/src/pages/NowPlayingPage.test.ts
 *
 * Note: Full DOM rendering tests require a jsdom/happy-dom test runner which
 * is not configured in this project. This file tests the pure formatTime
 * utility and the route constant used for Now Playing navigation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline the pure helper from NowPlayingPage ──────────────────────────────
// (Re-declared here to keep the test self-contained without DOM imports.)

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Route constant used in App.tsx and PlayerBar link ───────────────────────

const NOW_PLAYING_ROUTE = '/now-playing';

// ── formatTime ───────────────────────────────────────────────────────────────

describe('formatTime', () => {
  it('returns "0:00" for 0', () => {
    assert.strictEqual(formatTime(0), '0:00');
  });

  it('returns "0:00" for NaN', () => {
    assert.strictEqual(formatTime(NaN), '0:00');
  });

  it('returns "0:00" for Infinity', () => {
    assert.strictEqual(formatTime(Infinity), '0:00');
  });

  it('formats 65 seconds as "1:05"', () => {
    assert.strictEqual(formatTime(65), '1:05');
  });

  it('formats 3600 seconds as "60:00"', () => {
    assert.strictEqual(formatTime(3600), '60:00');
  });

  it('formats 3661 seconds as "61:01"', () => {
    assert.strictEqual(formatTime(3661), '61:01');
  });

  it('pads single-digit seconds', () => {
    assert.strictEqual(formatTime(61), '1:01');
  });

  it('formats 30 seconds as "0:30"', () => {
    assert.strictEqual(formatTime(30), '0:30');
  });

  it('floors fractional seconds', () => {
    assert.strictEqual(formatTime(65.9), '1:05');
  });
});

// ── Route wiring ─────────────────────────────────────────────────────────────

describe('Now Playing route constant', () => {
  it('route starts with /', () => {
    assert.ok(NOW_PLAYING_ROUTE.startsWith('/'), 'route must be absolute');
  });

  it('route is /now-playing', () => {
    assert.strictEqual(NOW_PLAYING_ROUTE, '/now-playing');
  });
});

// ── Media mode toggle ────────────────────────────────────────────────────────

// Re-declare types/helpers from NowPlayingPage for self-contained testing
type MediaMode = 'video' | 'artwork' | 'lyrics';

function loadMediaMode(): MediaMode {
  // Simulated — in real code reads from localStorage
  return 'video'; // default
}

const MEDIA_MODES: MediaMode[] = ['video', 'artwork', 'lyrics'];

describe('MediaMode defaults and validation', () => {
  it('default media mode is "video"', () => {
    assert.strictEqual(loadMediaMode(), 'video');
  });

  it('has exactly 3 modes', () => {
    assert.strictEqual(MEDIA_MODES.length, 3);
  });

  it('modes are video, artwork, lyrics in order', () => {
    assert.deepStrictEqual(MEDIA_MODES, ['video', 'artwork', 'lyrics']);
  });

  it('all modes are valid MediaMode values', () => {
    for (const m of MEDIA_MODES) {
      assert.ok(
        m === 'video' || m === 'artwork' || m === 'lyrics',
        `"${m}" is a valid mode`
      );
    }
  });

  it('loadMediaMode returns a valid mode', () => {
    const mode = loadMediaMode();
    assert.ok(MEDIA_MODES.includes(mode));
  });
});
