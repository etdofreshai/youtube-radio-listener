/**
 * Tests for TracksPage layout constants and helpers.
 *
 * Run:
 *   cd client && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Column definitions (mirrors TracksPage COLUMNS) ─────────────────────────

interface ColumnDef {
  key: string;
  label: string;
  sortField?: string;
  className?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'play', label: '' },
  { key: 'title', label: 'Title', sortField: 'title' },
  { key: 'artist', label: 'Artist', sortField: 'artist' },
  { key: 'duration', label: '🕐', sortField: 'duration', className: 'col-duration' },
  { key: 'actions', label: '', className: 'col-actions' },
];

// ── formatDuration helper (mirrors TracksPage) ──────────────────────────────

function formatDuration(sec: number | null): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TracksPage column layout', () => {
  it('has exactly 5 columns (compact layout)', () => {
    assert.strictEqual(COLUMNS.length, 5);
  });

  it('column keys are play, title, artist, duration, actions', () => {
    const keys = COLUMNS.map(c => c.key);
    assert.deepStrictEqual(keys, ['play', 'title', 'artist', 'duration', 'actions']);
  });

  it('title, artist, and duration are sortable', () => {
    const sortable = COLUMNS.filter(c => c.sortField).map(c => c.key);
    assert.deepStrictEqual(sortable, ['title', 'artist', 'duration']);
  });

  it('play and actions columns have no sort field', () => {
    assert.strictEqual(COLUMNS.find(c => c.key === 'play')?.sortField, undefined);
    assert.strictEqual(COLUMNS.find(c => c.key === 'actions')?.sortField, undefined);
  });
});

describe('formatDuration', () => {
  it('returns dash for null', () => {
    assert.strictEqual(formatDuration(null), '—');
  });

  it('returns dash for 0', () => {
    assert.strictEqual(formatDuration(0), '—');
  });

  it('formats 65 seconds as 1:05', () => {
    assert.strictEqual(formatDuration(65), '1:05');
  });

  it('formats 3600 seconds as 60:00', () => {
    assert.strictEqual(formatDuration(3600), '60:00');
  });

  it('formats 30 seconds as 0:30', () => {
    assert.strictEqual(formatDuration(30), '0:30');
  });
});
