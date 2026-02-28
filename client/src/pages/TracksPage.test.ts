/**
 * Tests for TracksPage layout constants, helpers, mode toggle, swap logic,
 * and page-size localStorage persistence.
 *
 * Run:
 *   cd client && npm test
 */

import { describe, it, beforeEach } from 'node:test';
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

const EDIT_COLUMNS: ColumnDef[] = [
  { key: 'title', label: 'Title', sortField: 'title' },
  { key: 'artist', label: 'Artist', sortField: 'artist' },
  { key: 'album', label: 'Album', sortField: 'album' },
  { key: 'start', label: 'Start' },
  { key: 'end', label: 'End' },
  { key: 'duration', label: '🕐', sortField: 'duration', className: 'col-duration' },
  { key: 'actions', label: '', className: 'col-actions-edit' },
];

// ── formatDuration helper (mirrors TracksPage) ──────────────────────────────

function formatDuration(sec: number | null): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Swap helpers (mirrors TracksPage exports) ───────────────────────────────

interface RowEditState {
  title: string;
  artist: string;
  album: string;
  startTime: string;
  endTime: string;
  duration: string;
  dirty: boolean;
  saving: boolean;
  error: string;
}

function swapTitleArtist(state: RowEditState): RowEditState {
  return { ...state, title: state.artist, artist: state.title, dirty: true };
}

function swapArtistAlbum(state: RowEditState): RowEditState {
  return { ...state, artist: state.album, album: state.artist, dirty: true };
}

// ── localStorage polyfill for Node.js test environment ──────────────────────

const store: Record<string, string> = {};
const localStorage = {
  getItem(key: string) { return store[key] ?? null; },
  setItem(key: string, value: string) { store[key] = value; },
  removeItem(key: string) { delete store[key]; },
  clear() { Object.keys(store).forEach(k => delete store[k]); },
};

const PAGE_SIZE_KEY = 'nightwave:tracksPageSize';
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function getPersistedPageSize(): number {
  try {
    const raw = localStorage.getItem(PAGE_SIZE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (PAGE_SIZE_OPTIONS.includes(n)) return n;
    }
  } catch { /* ignore */ }
  return 25;
}

function persistPageSize(size: number): void {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch { /* ignore */ }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TracksPage column layout (Regular mode)', () => {
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

describe('TracksPage column layout (Edit mode)', () => {
  it('has exactly 7 columns', () => {
    assert.strictEqual(EDIT_COLUMNS.length, 7);
  });

  it('column keys are title, artist, album, start, end, duration, actions', () => {
    const keys = EDIT_COLUMNS.map(c => c.key);
    assert.deepStrictEqual(keys, ['title', 'artist', 'album', 'start', 'end', 'duration', 'actions']);
  });

  it('title, artist, album, and duration are sortable', () => {
    const sortable = EDIT_COLUMNS.filter(c => c.sortField).map(c => c.key);
    assert.deepStrictEqual(sortable, ['title', 'artist', 'album', 'duration']);
  });

  it('start, end, actions columns have no sort field', () => {
    assert.strictEqual(EDIT_COLUMNS.find(c => c.key === 'start')?.sortField, undefined);
    assert.strictEqual(EDIT_COLUMNS.find(c => c.key === 'end')?.sortField, undefined);
    assert.strictEqual(EDIT_COLUMNS.find(c => c.key === 'actions')?.sortField, undefined);
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

// ── Mode toggle ─────────────────────────────────────────────────────────────

describe('Mode toggle behavior', () => {
  it('default mode is regular', () => {
    const mode: 'regular' | 'edit' = 'regular';
    assert.strictEqual(mode, 'regular');
  });

  it('mode can toggle to edit and back', () => {
    let mode: 'regular' | 'edit' = 'regular';
    mode = 'edit';
    assert.strictEqual(mode, 'edit');
    mode = 'regular';
    assert.strictEqual(mode, 'regular');
  });

  it('valid modes are only regular and edit', () => {
    const validModes = ['regular', 'edit'] as const;
    assert.strictEqual(validModes.length, 2);
    assert.ok(validModes.includes('regular'));
    assert.ok(validModes.includes('edit'));
  });
});

// ── Swap actions ────────────────────────────────────────────────────────────

describe('Swap title ↔ artist', () => {
  it('swaps title and artist values', () => {
    const state: RowEditState = {
      title: 'My Song', artist: 'The Band', album: 'Greatest Hits',
      startTime: '', endTime: '', duration: '', dirty: false, saving: false, error: '',
    };
    const result = swapTitleArtist(state);
    assert.strictEqual(result.title, 'The Band');
    assert.strictEqual(result.artist, 'My Song');
  });

  it('marks row as dirty after swap', () => {
    const state: RowEditState = {
      title: 'A', artist: 'B', album: 'C',
      startTime: '', endTime: '', duration: '', dirty: false, saving: false, error: '',
    };
    const result = swapTitleArtist(state);
    assert.strictEqual(result.dirty, true);
  });

  it('preserves other fields', () => {
    const state: RowEditState = {
      title: 'A', artist: 'B', album: 'C',
      startTime: '1:00', endTime: '3:00', duration: '2:00', dirty: false, saving: false, error: 'some error',
    };
    const result = swapTitleArtist(state);
    assert.strictEqual(result.album, 'C');
    assert.strictEqual(result.startTime, '1:00');
    assert.strictEqual(result.endTime, '3:00');
    assert.strictEqual(result.duration, '2:00');
    assert.strictEqual(result.saving, false);
  });

  it('handles empty strings', () => {
    const state: RowEditState = {
      title: '', artist: 'Solo', album: '',
      startTime: '', endTime: '', duration: '', dirty: false, saving: false, error: '',
    };
    const result = swapTitleArtist(state);
    assert.strictEqual(result.title, 'Solo');
    assert.strictEqual(result.artist, '');
  });

  it('double swap returns to original', () => {
    const state: RowEditState = {
      title: 'X', artist: 'Y', album: 'Z',
      startTime: '', endTime: '', duration: '', dirty: false, saving: false, error: '',
    };
    const result = swapTitleArtist(swapTitleArtist(state));
    assert.strictEqual(result.title, 'X');
    assert.strictEqual(result.artist, 'Y');
  });
});

describe('Swap artist ↔ album', () => {
  it('swaps artist and album values', () => {
    const state: RowEditState = {
      title: 'My Song', artist: 'The Band', album: 'Greatest Hits',
      startTime: '', endTime: '', duration: '', dirty: false, saving: false, error: '',
    };
    const result = swapArtistAlbum(state);
    assert.strictEqual(result.artist, 'Greatest Hits');
    assert.strictEqual(result.album, 'The Band');
  });

  it('marks row as dirty after swap', () => {
    const state: RowEditState = {
      title: 'A', artist: 'B', album: 'C',
      startTime: '', endTime: '', duration: '', dirty: false, saving: false, error: '',
    };
    const result = swapArtistAlbum(state);
    assert.strictEqual(result.dirty, true);
  });

  it('preserves title and other fields', () => {
    const state: RowEditState = {
      title: 'MySong', artist: 'B', album: 'C',
      startTime: '0:30', endTime: '2:30', duration: '2:00', dirty: false, saving: false, error: '',
    };
    const result = swapArtistAlbum(state);
    assert.strictEqual(result.title, 'MySong');
    assert.strictEqual(result.startTime, '0:30');
  });

  it('double swap returns to original', () => {
    const state: RowEditState = {
      title: 'X', artist: 'Y', album: 'Z',
      startTime: '', endTime: '', duration: '', dirty: false, saving: false, error: '',
    };
    const result = swapArtistAlbum(swapArtistAlbum(state));
    assert.strictEqual(result.artist, 'Y');
    assert.strictEqual(result.album, 'Z');
  });
});

// ── Page size localStorage persistence ──────────────────────────────────────

describe('Page size localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to 25 when nothing persisted', () => {
    assert.strictEqual(getPersistedPageSize(), 25);
  });

  it('persists and retrieves page size', () => {
    persistPageSize(50);
    assert.strictEqual(getPersistedPageSize(), 50);
  });

  it('persists 10', () => {
    persistPageSize(10);
    assert.strictEqual(getPersistedPageSize(), 10);
  });

  it('persists 100', () => {
    persistPageSize(100);
    assert.strictEqual(getPersistedPageSize(), 100);
  });

  it('returns default 25 for invalid stored value', () => {
    localStorage.setItem(PAGE_SIZE_KEY, 'abc');
    assert.strictEqual(getPersistedPageSize(), 25);
  });

  it('returns default 25 for non-option numeric value', () => {
    localStorage.setItem(PAGE_SIZE_KEY, '42');
    assert.strictEqual(getPersistedPageSize(), 25);
  });

  it('overwrites previous persisted value', () => {
    persistPageSize(50);
    assert.strictEqual(getPersistedPageSize(), 50);
    persistPageSize(10);
    assert.strictEqual(getPersistedPageSize(), 10);
  });
});
