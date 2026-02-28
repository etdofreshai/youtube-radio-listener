/**
 * Tests for effective duration computation.
 *
 * Run: cd client && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveDuration, getEffectiveDurationFromStrings } from './effectiveDuration.js';
import { parseEndTime } from './endTimeParse.js';

// ── getEffectiveDuration ─────────────────────────────────────────────────────

describe('getEffectiveDuration – no trim', () => {
  it('returns original duration when no start/end set', () => {
    const r = getEffectiveDuration(240, null, null);
    assert.strictEqual(r.effective, 240);
    assert.strictEqual(r.original, 240);
    assert.strictEqual(r.isTrimmed, false);
  });

  it('returns null effective when original is null and no trim', () => {
    const r = getEffectiveDuration(null, null, null);
    assert.strictEqual(r.effective, null);
    assert.strictEqual(r.original, null);
    assert.strictEqual(r.isTrimmed, false);
  });

  it('treats startTimeSec=0 as no start trim', () => {
    const r = getEffectiveDuration(300, 0, null);
    assert.strictEqual(r.effective, 300);
    assert.strictEqual(r.isTrimmed, false);
  });

  it('treats endTimeSec=0 as no end trim', () => {
    const r = getEffectiveDuration(300, null, 0);
    assert.strictEqual(r.effective, 300);
    assert.strictEqual(r.isTrimmed, false);
  });
});

describe('getEffectiveDuration – both start and end', () => {
  it('computes end - start when both provided', () => {
    const r = getEffectiveDuration(300, 30, 180);
    assert.strictEqual(r.effective, 150);
    assert.strictEqual(r.original, 300);
    assert.strictEqual(r.isTrimmed, true);
  });

  it('returns null effective when start >= end (invalid)', () => {
    const r = getEffectiveDuration(300, 200, 100);
    assert.strictEqual(r.effective, null);
    assert.strictEqual(r.isTrimmed, false);
  });

  it('returns null effective when start == end', () => {
    const r = getEffectiveDuration(300, 100, 100);
    assert.strictEqual(r.effective, null);
    assert.strictEqual(r.isTrimmed, false);
  });

  it('works when original duration is null', () => {
    const r = getEffectiveDuration(null, 10, 60);
    assert.strictEqual(r.effective, 50);
    assert.strictEqual(r.original, null);
    assert.strictEqual(r.isTrimmed, true);
  });

  it('isTrimmed false if effective matches original within 0.5s', () => {
    // start=0.1 end=300.1 → effective=300, original=300 → not trimmed (close enough)
    const r = getEffectiveDuration(300, 0.1, 300.1);
    assert.strictEqual(r.effective, 300);
    assert.strictEqual(r.isTrimmed, false);
  });
});

describe('getEffectiveDuration – only end', () => {
  it('returns end as effective duration (plays 0→end)', () => {
    const r = getEffectiveDuration(300, null, 120);
    assert.strictEqual(r.effective, 120);
    assert.strictEqual(r.original, 300);
    assert.strictEqual(r.isTrimmed, true);
  });

  it('works when original is null', () => {
    const r = getEffectiveDuration(null, null, 120);
    assert.strictEqual(r.effective, 120);
    assert.strictEqual(r.isTrimmed, true);
  });
});

describe('getEffectiveDuration – only start', () => {
  it('returns duration - start when original known', () => {
    const r = getEffectiveDuration(300, 60, null);
    assert.strictEqual(r.effective, 240);
    assert.strictEqual(r.original, 300);
    assert.strictEqual(r.isTrimmed, true);
  });

  it('returns null effective when original is null', () => {
    const r = getEffectiveDuration(null, 60, null);
    assert.strictEqual(r.effective, null);
    assert.strictEqual(r.isTrimmed, true);
  });

  it('returns null effective when start >= original', () => {
    const r = getEffectiveDuration(60, 100, null);
    assert.strictEqual(r.effective, null);
    assert.strictEqual(r.isTrimmed, true);
  });
});

// ── getEffectiveDurationFromStrings ──────────────────────────────────────────

describe('getEffectiveDurationFromStrings', () => {
  it('computes from valid time strings', () => {
    const r = getEffectiveDurationFromStrings(300, '1:00', '3:00', parseEndTime);
    assert.strictEqual(r.effective, 120); // 180 - 60
    assert.strictEqual(r.isTrimmed, true);
  });

  it('returns original when both strings empty', () => {
    const r = getEffectiveDurationFromStrings(300, '', '', parseEndTime);
    assert.strictEqual(r.effective, 300);
    assert.strictEqual(r.isTrimmed, false);
  });

  it('handles invalid time strings gracefully (falls back to no trim)', () => {
    const r = getEffectiveDurationFromStrings(300, 'abc', 'xyz', parseEndTime);
    assert.strictEqual(r.effective, 300);
    assert.strictEqual(r.isTrimmed, false);
  });

  it('handles only start string', () => {
    const r = getEffectiveDurationFromStrings(300, '1:00', '', parseEndTime);
    assert.strictEqual(r.effective, 240);
    assert.strictEqual(r.isTrimmed, true);
  });

  it('handles only end string', () => {
    const r = getEffectiveDurationFromStrings(300, '', '2:00', parseEndTime);
    assert.strictEqual(r.effective, 120);
    assert.strictEqual(r.isTrimmed, true);
  });
});
