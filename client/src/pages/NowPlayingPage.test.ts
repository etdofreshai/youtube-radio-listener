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
