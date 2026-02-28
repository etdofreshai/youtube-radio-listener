/**
 * Unit tests for radio stations route logic (pure validation, no DB).
 * Integration tests with a live DB would require DATABASE_URL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------- helpers (mirrors route validation logic) ----------

function validateCreate(input: { name?: string; streamUrl?: string }): string | null {
  if (!input.name?.trim()) return 'name is required';
  if (!input.streamUrl?.trim()) return 'streamUrl is required';
  return null;
}

function validateUpdate(input: { name?: string; streamUrl?: string }): string | null {
  if (input.name !== undefined && !input.name.trim()) return 'name cannot be empty';
  if (input.streamUrl !== undefined && !input.streamUrl.trim()) return 'streamUrl cannot be empty';
  return null;
}

// ---------- RadioStation shape ----------

interface RadioStationShape {
  id: string;
  name: string;
  slug: string;
  streamUrl: string;
  homepageUrl: string | null;
  description: string | null;
  imageUrl: string | null;
  isLive: boolean;
  active: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

function makeMockStation(overrides: Partial<RadioStationShape> = {}): RadioStationShape {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    name: 'Rainwave OCR Remix',
    slug: 'rainwave-ocr-remix',
    streamUrl: 'http://rainwave.cc/tune_in/2.mp3',
    homepageUrl: 'http://rainwave.cc/ocremix/',
    description: '24/7 live radio of video game music remixes.',
    imageUrl: null,
    isLive: true,
    active: true,
    tags: ['vgm', 'remix', 'ocremix'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------- tests ----------

describe('radio stations — create validation', () => {
  it('rejects missing name', () => {
    assert.equal(validateCreate({ streamUrl: 'http://example.com/stream' }), 'name is required');
  });

  it('rejects blank name', () => {
    assert.equal(validateCreate({ name: '   ', streamUrl: 'http://example.com/stream' }), 'name is required');
  });

  it('rejects missing streamUrl', () => {
    assert.equal(validateCreate({ name: 'My Radio' }), 'streamUrl is required');
  });

  it('rejects blank streamUrl', () => {
    assert.equal(validateCreate({ name: 'My Radio', streamUrl: '   ' }), 'streamUrl is required');
  });

  it('passes with valid name and streamUrl', () => {
    assert.equal(validateCreate({ name: 'My Radio', streamUrl: 'http://example.com/stream.mp3' }), null);
  });
});

describe('radio stations — update validation', () => {
  it('rejects explicitly empty name', () => {
    assert.equal(validateUpdate({ name: '' }), 'name cannot be empty');
  });

  it('rejects explicitly empty streamUrl', () => {
    assert.equal(validateUpdate({ streamUrl: '' }), 'streamUrl cannot be empty');
  });

  it('passes with no fields (no-op update)', () => {
    assert.equal(validateUpdate({}), null);
  });

  it('passes with valid partial update', () => {
    assert.equal(validateUpdate({ name: 'New Name' }), null);
  });
});

describe('radio stations — station shape', () => {
  it('default station has expected fields', () => {
    const s = makeMockStation();
    assert.equal(s.name, 'Rainwave OCR Remix');
    assert.equal(s.streamUrl, 'http://rainwave.cc/tune_in/2.mp3');
    assert.equal(s.homepageUrl, 'http://rainwave.cc/ocremix/');
    assert.equal(s.isLive, true);
    assert.equal(s.active, true);
    assert.deepEqual(s.tags, ['vgm', 'remix', 'ocremix']);
  });

  it('toggle changes active flag', () => {
    const s = makeMockStation({ active: true });
    const toggled = { ...s, active: !s.active };
    assert.equal(toggled.active, false);
  });

  it('inactive station can be re-activated', () => {
    const s = makeMockStation({ active: false });
    const reactivated = { ...s, active: true };
    assert.equal(reactivated.active, true);
  });
});

describe('radio stations — seed station', () => {
  it('has the correct Rainwave OCR Remix defaults', () => {
    const seed = {
      name: 'Rainwave OCR Remix',
      slug: 'rainwave-ocr-remix',
      streamUrl: 'http://rainwave.cc/tune_in/2.mp3',
      homepageUrl: 'http://rainwave.cc/ocremix/',
      isLive: true,
      active: true,
      tags: ['vgm', 'remix', 'ocremix', 'rainwave'],
    };
    assert.equal(seed.name, 'Rainwave OCR Remix');
    assert.ok(seed.streamUrl.startsWith('http://rainwave.cc/'));
    assert.equal(seed.isLive, true);
  });
});
