/**
 * Tests for the end-time parser utility.
 *
 * Run: node --import tsx --test client/src/utils/endTimeParse.test.ts
 *   (from the repo root, with tsx available on PATH / in node_modules/.bin)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEndTime } from './endTimeParse.js';

// ── Empty / blank ─────────────────────────────────────────────────────────────

describe('parseEndTime – empty input', () => {
  it('returns null for empty string', () => {
    assert.strictEqual(parseEndTime(''), null);
  });

  it('returns null for whitespace-only string', () => {
    assert.strictEqual(parseEndTime('   '), null);
  });
});

// ── Seconds-only format ───────────────────────────────────────────────────────

describe('parseEndTime – seconds only', () => {
  it('parses "0" → 0', () => {
    const r = parseEndTime('0');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 0);
  });

  it('parses "95" → 95', () => {
    const r = parseEndTime('95');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 95);
  });

  it('parses "3600" → 3600', () => {
    const r = parseEndTime('3600');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 3600);
  });

  it('rejects negative number notation "-5"', () => {
    const r = parseEndTime('-5');
    assert.ok(r && !r.ok);
  });

  it('rejects float "1.5"', () => {
    const r = parseEndTime('1.5');
    assert.ok(r && !r.ok);
  });

  it('rejects non-numeric "abc"', () => {
    const r = parseEndTime('abc');
    assert.ok(r && !r.ok);
  });

  it('rejects empty-segment input ":"', () => {
    // two parts, both empty
    const r = parseEndTime(':');
    assert.ok(r && !r.ok);
  });
});

// ── MM:SS format ──────────────────────────────────────────────────────────────

describe('parseEndTime – MM:SS', () => {
  it('parses "1:35" → 95', () => {
    const r = parseEndTime('1:35');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 95);
  });

  it('parses "0:00" → 0', () => {
    const r = parseEndTime('0:00');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 0);
  });

  it('parses "2:00" → 120', () => {
    const r = parseEndTime('2:00');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 120);
  });

  it('parses "60:59" → 3659', () => {
    const r = parseEndTime('60:59');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 60 * 60 + 59);
  });

  it('rejects seconds >= 60 → "1:60"', () => {
    const r = parseEndTime('1:60');
    assert.ok(r && !r.ok);
    assert.ok(r.error.includes('59'));
  });

  it('rejects non-integer minutes "a:35"', () => {
    const r = parseEndTime('a:35');
    assert.ok(r && !r.ok);
  });

  it('rejects non-integer seconds "1:b"', () => {
    const r = parseEndTime('1:b');
    assert.ok(r && !r.ok);
  });
});

// ── MM:SS:mmm format ─────────────────────────────────────────────────────────

describe('parseEndTime – MM:SS:mmm', () => {
  it('parses "1:35:250" → 95.25', () => {
    const r = parseEndTime('1:35:250');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 95.25);
  });

  it('parses "0:00:000" → 0', () => {
    const r = parseEndTime('0:00:000');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 0);
  });

  it('parses "0:01:500" → 1.5', () => {
    const r = parseEndTime('0:01:500');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 1.5);
  });

  it('parses "0:00:001" → 0.001', () => {
    const r = parseEndTime('0:00:001');
    assert.ok(r && r.ok);
    // floating point – use approximate comparison
    assert.ok(Math.abs(r.value - 0.001) < 1e-10);
  });

  it('rejects seconds >= 60 in MM:SS:mmm → "0:60:000"', () => {
    const r = parseEndTime('0:60:000');
    assert.ok(r && !r.ok);
  });

  it('rejects milliseconds >= 1000 → "0:01:1000"', () => {
    const r = parseEndTime('0:01:1000');
    assert.ok(r && !r.ok);
    assert.ok(r.error.includes('999'));
  });

  it('rejects non-integer milliseconds "0:01:abc"', () => {
    const r = parseEndTime('0:01:abc');
    assert.ok(r && !r.ok);
  });
});

// ── Too many colons ───────────────────────────────────────────────────────────

describe('parseEndTime – too many colons', () => {
  it('rejects "1:35:250:99"', () => {
    const r = parseEndTime('1:35:250:99');
    assert.ok(r && !r.ok);
    assert.ok(r.error.toLowerCase().includes('colon'));
  });
});

// ── Whitespace trimming ───────────────────────────────────────────────────────

describe('parseEndTime – leading/trailing whitespace', () => {
  it('trims and parses "  95  "', () => {
    const r = parseEndTime('  95  ');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 95);
  });

  it('trims and parses "  1:35  "', () => {
    const r = parseEndTime('  1:35  ');
    assert.ok(r && r.ok);
    assert.strictEqual(r.value, 95);
  });
});
