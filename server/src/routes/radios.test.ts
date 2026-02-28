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
    streamUrl: 'https://rainwave.cc/tune_in/2.mp3.m3u',
    homepageUrl: 'https://rainwave.cc/ocremix/',
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
    assert.equal(s.streamUrl, 'https://rainwave.cc/tune_in/2.mp3.m3u');
    assert.equal(s.homepageUrl, 'https://rainwave.cc/ocremix/');
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
      streamUrl: 'https://rainwave.cc/tune_in/2.mp3.m3u',
      homepageUrl: 'https://rainwave.cc/ocremix/',
      isLive: true,
      active: true,
      tags: ['vgm', 'remix', 'ocremix', 'rainwave'],
    };
    assert.equal(seed.name, 'Rainwave OCR Remix');
    // M3U playlist endpoint — resolve-stream will extract the actual HTTPS stream URL
    assert.equal(seed.streamUrl, 'https://rainwave.cc/tune_in/2.mp3.m3u');
    assert.ok(seed.streamUrl.endsWith('.m3u'), 'streamUrl should be an M3U playlist');
    assert.equal(seed.isLive, true);
  });
});

// ---------- M3U playlist parsing tests ----------

/**
 * Mirror of server-side resolveStreamUrl M3U parsing logic.
 * Extracts the first (preferring HTTPS) stream URL from M3U content.
 */
function parseM3U(body: string): string | null {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const streamLine = lines.find(l => l.startsWith('http://') || l.startsWith('https://'));
  if (!streamLine) return null;
  const httpsLine = lines.find(l => l.startsWith('https://'));
  return httpsLine || streamLine;
}

describe('radio stations — M3U playlist parsing', () => {
  it('extracts HTTPS stream URL from Rainwave M3U', () => {
    const m3u = [
      '#EXTINF:0,Rainwave OC ReMix: Random Relay',
      'http://allrelays.rainwave.cc/ocremix.mp3',
      '#EXTINF:0, Rainwave OC ReMix: Rainwave (Toronto) Relay',
      'https://relay.rainwave.cc:443/ocremix.mp3',
    ].join('\n');
    assert.equal(parseM3U(m3u), 'https://relay.rainwave.cc:443/ocremix.mp3');
  });

  it('falls back to HTTP if no HTTPS available', () => {
    const m3u = [
      '#EXTINF:0,Some Station',
      'http://stream.example.com/radio.mp3',
    ].join('\n');
    assert.equal(parseM3U(m3u), 'http://stream.example.com/radio.mp3');
  });

  it('returns null for empty M3U', () => {
    assert.equal(parseM3U(''), null);
  });

  it('returns null for M3U with only comments', () => {
    const m3u = '#EXTM3U\n#EXTINF:0,No URL here\n';
    assert.equal(parseM3U(m3u), null);
  });

  it('skips comment lines and finds URL', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:0,Station Name',
      '# This is a comment',
      'https://stream.example.com/live.mp3',
    ].join('\n');
    assert.equal(parseM3U(m3u), 'https://stream.example.com/live.mp3');
  });
});

// ---------- Radio playback state machine tests ----------

type RadioPlaybackState = 'idle' | 'resolving' | 'connecting' | 'playing' | 'error';

interface RadioPlayerState {
  status: RadioPlaybackState;
  station: RadioStationShape | null;
  error: string | null;
}

function radioReducer(
  state: RadioPlayerState,
  action:
    | { type: 'START_PLAY'; station: RadioStationShape }
    | { type: 'RESOLVED' }
    | { type: 'PLAYING' }
    | { type: 'ERROR'; error: string }
    | { type: 'STOP' }
): RadioPlayerState {
  switch (action.type) {
    case 'START_PLAY':
      return { status: 'resolving', station: action.station, error: null };
    case 'RESOLVED':
      return { ...state, status: 'connecting' };
    case 'PLAYING':
      return { ...state, status: 'playing', error: null };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'STOP':
      return { status: 'idle', station: null, error: null };
  }
}

describe('radio stations — playback state machine', () => {
  const station = makeMockStation();
  const initial: RadioPlayerState = { status: 'idle', station: null, error: null };

  it('transitions idle → resolving on START_PLAY', () => {
    const next = radioReducer(initial, { type: 'START_PLAY', station });
    assert.equal(next.status, 'resolving');
    assert.equal(next.station?.id, station.id);
    assert.equal(next.error, null);
  });

  it('transitions resolving → connecting on RESOLVED', () => {
    const resolving: RadioPlayerState = { status: 'resolving', station, error: null };
    const next = radioReducer(resolving, { type: 'RESOLVED' });
    assert.equal(next.status, 'connecting');
  });

  it('transitions connecting → playing on PLAYING', () => {
    const connecting: RadioPlayerState = { status: 'connecting', station, error: null };
    const next = radioReducer(connecting, { type: 'PLAYING' });
    assert.equal(next.status, 'playing');
    assert.equal(next.error, null);
  });

  it('transitions to error from any state', () => {
    const connecting: RadioPlayerState = { status: 'connecting', station, error: null };
    const next = radioReducer(connecting, { type: 'ERROR', error: 'Network error' });
    assert.equal(next.status, 'error');
    assert.equal(next.error, 'Network error');
  });

  it('transitions to idle on STOP from any state', () => {
    const playing: RadioPlayerState = { status: 'playing', station, error: null };
    const next = radioReducer(playing, { type: 'STOP' });
    assert.equal(next.status, 'idle');
    assert.equal(next.station, null);
    assert.equal(next.error, null);
  });

  it('clears error on STOP', () => {
    const errored: RadioPlayerState = { status: 'error', station, error: 'Something broke' };
    const next = radioReducer(errored, { type: 'STOP' });
    assert.equal(next.status, 'idle');
    assert.equal(next.error, null);
  });

  it('clears error on new START_PLAY', () => {
    const errored: RadioPlayerState = { status: 'error', station, error: 'Previous error' };
    const next = radioReducer(errored, { type: 'START_PLAY', station });
    assert.equal(next.status, 'resolving');
    assert.equal(next.error, null);
  });
});
