/**
 * Tests for the Learning Resources service
 *
 * Covers: normalization, ranking/sorting, filtering, deduplication,
 * grouping, type inference, query generation, and static resource fallback.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractProvider,
  calculateConfidence,
  filterJunk,
  dedupeResources,
  groupResources,
  inferResourceType,
  generateSearchQueries,
  generateStaticResources,
  sortResources,
} from './learn';
import type { LearningResource, Track } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockResource = (overrides: Partial<LearningResource> = {}): LearningResource => ({
  id: 'test-id',
  trackId: 'track-1',
  resourceType: 'guitar-chords',
  title: 'Test Resource',
  provider: 'example.com',
  url: 'https://example.com/test',
  snippet: 'Test snippet',
  confidence: 'medium',
  isSaved: false,
  searchQuery: 'test query',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const mockTrack = (overrides: Partial<Track> = {}): Track => ({
  id: 'track-1',
  slug: null,
  youtubeUrl: 'https://youtube.com/watch?v=test',
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  artistId: null,
  albumId: null,
  startTimeSec: null,
  endTimeSec: null,
  volume: 100,
  notes: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isLiveStream: false,
  audioStatus: 'pending',
  audioError: null,
  audioFilename: null,
  duration: null,
  lastDownloadAt: null,
  videoStatus: 'none',
  videoError: null,
  videoFilename: null,
  lyrics: null,
  lyricsSource: null,
  verified: false,
  verifiedBy: null,
  verifiedAt: null,
  ytChannel: null,
  ytChannelId: null,
  ytUploadDate: null,
  ytDescription: null,
  ytThumbnailUrl: null,
  ytViewCount: null,
  ytLikeCount: null,
  album: null,
  releaseYear: null,
  genre: null,
  label: null,
  isrc: null,
  bpm: null,
  artworkUrl: null,
  artworkSource: null,
  alternateLinks: null,
  metadataSource: null,
  metadataConfidence: null,
  fieldConfidences: [],
  lastEnrichedAt: null,
  enrichmentStatus: 'none',
  enrichmentAttempts: 0,
  enrichmentError: null,
  nextEnrichAt: null,
  stageACompletedAt: null,
  stageBCompletedAt: null,
  ...overrides,
});

// ── extractProvider ───────────────────────────────────────────────────────────

describe('extractProvider', () => {
  it('extracts domain from standard URLs', () => {
    assert.equal(extractProvider('https://www.ultimate-guitar.com/tabs/test'), 'ultimate-guitar.com');
    assert.equal(extractProvider('https://songsterr.com/a/wsa/test'), 'songsterr.com');
  });

  it('handles URLs without www', () => {
    assert.equal(extractProvider('https://musescore.com/sheetmusic'), 'musescore.com');
  });

  it('handles youtu.be short links', () => {
    assert.equal(extractProvider('https://youtu.be/abc123'), 'youtu.be');
  });

  it('strips www prefix', () => {
    assert.equal(extractProvider('https://www.songsterr.com/tab'), 'songsterr.com');
  });

  it('returns unknown for invalid URLs', () => {
    assert.equal(extractProvider('not-a-url'), 'unknown');
  });

  it('handles tabs.ultimate-guitar.com subdomain', () => {
    assert.equal(extractProvider('https://tabs.ultimate-guitar.com/tab/song'), 'tabs.ultimate-guitar.com');
  });
});

// ── calculateConfidence ───────────────────────────────────────────────────────

describe('calculateConfidence', () => {
  it('returns high for trusted providers', () => {
    const conf = calculateConfidence(
      'https://tabs.ultimate-guitar.com/tab/test',
      'Test Song Guitar Tab',
      'test song tab',
    );
    assert.equal(conf, 'high');
  });

  it('returns high for official content with keywords', () => {
    const conf = calculateConfidence(
      'https://some-site.com/video',
      'Official Guitar Tutorial - Test Song',
      'test song tutorial',
    );
    assert.equal(conf, 'high');
  });

  it('returns medium for content with learning keywords', () => {
    const conf = calculateConfidence(
      'https://blog.com/post',
      'How to play Test Song on guitar',
      'test song',
    );
    assert.equal(conf, 'medium');
  });

  it('returns medium for "chord" in title', () => {
    const conf = calculateConfidence(
      'https://random-site.com/page',
      'Test Song Chord Progression',
      'test song',
    );
    assert.equal(conf, 'medium');
  });

  it('returns medium for "tab" in URL', () => {
    const conf = calculateConfidence(
      'https://random-site.com/guitar-tab',
      'Some Song',
      'test song',
    );
    assert.equal(conf, 'medium');
  });

  it('returns low for generic content', () => {
    const conf = calculateConfidence(
      'https://random-site.com/page',
      'Some random page',
      'test song',
    );
    assert.equal(conf, 'low');
  });

  it('returns high for songsterr (trusted provider)', () => {
    assert.equal(
      calculateConfidence('https://www.songsterr.com/tab', 'Song Tab', 'song'),
      'high',
    );
  });

  it('returns high for musescore (trusted provider)', () => {
    assert.equal(
      calculateConfidence('https://musescore.com/user/score', 'Sheet Music', 'song'),
      'high',
    );
  });
});

// ── filterJunk ────────────────────────────────────────────────────────────────

describe('filterJunk', () => {
  it('filters out Buy MP3 results', () => {
    const resources = [
      mockResource({ title: 'Buy MP3 - Test Song', url: 'https://mp3site.com/test' }),
      mockResource({ title: 'Test Song Guitar Tab', url: 'https://tabs.com/test' }),
    ];
    const filtered = filterJunk(resources);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].title, 'Test Song Guitar Tab');
  });

  it('filters out ringtone download results', () => {
    const resources = [
      mockResource({ title: 'Test Song - Free Download Ringtone', url: 'https://ringtones.com/test' }),
      mockResource({ title: 'Test Song Chords', url: 'https://chords.com/test' }),
    ];
    const filtered = filterJunk(resources);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].title, 'Test Song Chords');
  });

  it('filters out mp3 download links', () => {
    const resources = [
      mockResource({ title: 'Test Song MP3 Download', url: 'https://mp3.com/test' }),
      mockResource({ title: 'Test Song Sheet Music', url: 'https://musescore.com/test' }),
    ];
    const filtered = filterJunk(resources);
    assert.equal(filtered.length, 1);
  });

  it('keeps results from trusted providers even without obvious keywords', () => {
    const resources = [
      mockResource({ title: 'Some Song', provider: 'ultimate-guitar.com', url: 'https://ultimate-guitar.com/page' }),
    ];
    const filtered = filterJunk(resources);
    assert.equal(filtered.length, 1);
  });

  it('keeps results with "cover" in the title', () => {
    const resources = [
      mockResource({ title: 'Song - Guitar Cover Lesson', url: 'https://example.com/cover' }),
    ];
    const filtered = filterJunk(resources);
    assert.equal(filtered.length, 1);
  });

  it('keeps sheet music results', () => {
    const resources = [
      mockResource({ title: 'Song Sheet Music PDF', url: 'https://musicnotes.com/page' }),
    ];
    const filtered = filterJunk(resources);
    assert.equal(filtered.length, 1);
  });
});

// ── dedupeResources ───────────────────────────────────────────────────────────

describe('dedupeResources', () => {
  it('removes duplicate URLs, keeping first occurrence', () => {
    const resources = [
      mockResource({ id: '1', url: 'https://example.com/test', title: 'First' }),
      mockResource({ id: '2', url: 'https://example.com/test', title: 'Second' }),
      mockResource({ id: '3', url: 'https://other.com/test', title: 'Third' }),
    ];
    const deduped = dedupeResources(resources);
    assert.equal(deduped.length, 2);
    assert.equal(deduped.find(r => r.url === 'https://example.com/test')?.title, 'First');
  });

  it('returns all resources when all URLs are unique', () => {
    const resources = [
      mockResource({ id: '1', url: 'https://a.com/1' }),
      mockResource({ id: '2', url: 'https://b.com/2' }),
      mockResource({ id: '3', url: 'https://c.com/3' }),
    ];
    assert.equal(dedupeResources(resources).length, 3);
  });

  it('handles empty array', () => {
    assert.deepEqual(dedupeResources([]), []);
  });
});

// ── sortResources ─────────────────────────────────────────────────────────────

describe('sortResources', () => {
  it('sorts saved items before unsaved', () => {
    const resources = [
      mockResource({ id: '1', isSaved: false, confidence: 'high' }),
      mockResource({ id: '2', isSaved: true, confidence: 'low' }),
    ];
    const sorted = sortResources(resources);
    assert.equal(sorted[0].id, '2');  // saved first, even if low confidence
    assert.equal(sorted[1].id, '1');
  });

  it('sorts by confidence within non-saved: high before medium before low', () => {
    const resources = [
      mockResource({ id: '1', isSaved: false, confidence: 'low' }),
      mockResource({ id: '2', isSaved: false, confidence: 'high' }),
      mockResource({ id: '3', isSaved: false, confidence: 'medium' }),
    ];
    const sorted = sortResources(resources);
    assert.equal(sorted[0].id, '2');  // high
    assert.equal(sorted[1].id, '3');  // medium
    assert.equal(sorted[2].id, '1');  // low
  });

  it('sorts by confidence within saved items too', () => {
    const resources = [
      mockResource({ id: '1', isSaved: true, confidence: 'low' }),
      mockResource({ id: '2', isSaved: true, confidence: 'high' }),
    ];
    const sorted = sortResources(resources);
    assert.equal(sorted[0].id, '2');  // high confidence saved
    assert.equal(sorted[1].id, '1');  // low confidence saved
  });
});

// ── groupResources ────────────────────────────────────────────────────────────

describe('groupResources', () => {
  it('groups resources by type', () => {
    const resources = [
      mockResource({ resourceType: 'guitar-tabs' }),
      mockResource({ resourceType: 'guitar-chords' }),
      mockResource({ resourceType: 'piano-keys' }),
      mockResource({ resourceType: 'sheet-music' }),
      mockResource({ resourceType: 'tutorial' }),
    ];
    const grouped = groupResources(resources);

    assert.equal(grouped.guitarTabs.length, 1);
    assert.equal(grouped.guitarChords.length, 1);
    assert.equal(grouped.pianoKeys.length, 1);
    assert.equal(grouped.sheetMusic.length, 1);
    assert.equal(grouped.tutorials.length, 1);
  });

  it('places multiple resources of same type in correct group', () => {
    const resources = [
      mockResource({ id: '1', resourceType: 'guitar-tabs' }),
      mockResource({ id: '2', resourceType: 'guitar-tabs' }),
      mockResource({ id: '3', resourceType: 'sheet-music' }),
    ];
    const grouped = groupResources(resources);
    assert.equal(grouped.guitarTabs.length, 2);
    assert.equal(grouped.sheetMusic.length, 1);
    assert.equal(grouped.guitarChords.length, 0);
  });

  it('sorts resources within each group by confidence', () => {
    const resources = [
      mockResource({ id: '1', resourceType: 'guitar-tabs', confidence: 'low', isSaved: false }),
      mockResource({ id: '2', resourceType: 'guitar-tabs', confidence: 'high', isSaved: false }),
    ];
    const grouped = groupResources(resources);
    assert.equal(grouped.guitarTabs[0].id, '2');  // high confidence first
  });
});

// ── inferResourceType ─────────────────────────────────────────────────────────

describe('inferResourceType', () => {
  it('infers guitar-tabs from "tab" in URL (not chord)', () => {
    assert.equal(inferResourceType('Guitar Tab', 'https://ultimate-guitar.com/tab/song'), 'guitar-tabs');
  });

  it('infers sheet-music from "sheet music" in title', () => {
    assert.equal(inferResourceType('Bohemian Rhapsody Sheet Music', 'https://musescore.com/score'), 'sheet-music');
  });

  it('infers sheet-music from "score" in title', () => {
    assert.equal(inferResourceType('Piano Score PDF', 'https://musicnotes.com/page'), 'sheet-music');
  });

  it('infers piano-keys from "piano" in title', () => {
    assert.equal(inferResourceType('Piano Chords Tutorial', 'https://flowkey.com/song'), 'piano-keys');
  });

  it('infers piano-keys from "keyboard" in URL', () => {
    assert.equal(inferResourceType('Song Tutorial', 'https://site.com/keyboard-lesson'), 'piano-keys');
  });

  it('infers tutorial from "tutorial" in title', () => {
    assert.equal(inferResourceType('How to Play Song Guitar Tutorial', 'https://youtube.com/watch?v=abc'), 'tutorial');
  });

  it('infers tutorial from "lesson" in title', () => {
    assert.equal(inferResourceType('Guitar Lesson for Beginners', 'https://justinguitar.com/song'), 'tutorial');
  });

  it('defaults to guitar-chords when no specific type is detected', () => {
    assert.equal(inferResourceType('Song Page', 'https://example.com/song'), 'guitar-chords');
  });

  it('infers sheet-music when "score" appears and no "tab" in combined text', () => {
    // "score" in title, no "tab" anywhere — should be sheet-music
    assert.equal(inferResourceType('Piano Score PDF', 'https://example.com/music'), 'sheet-music');
  });
});

// ── generateSearchQueries ─────────────────────────────────────────────────────

describe('generateSearchQueries', () => {
  it('generates queries for all resource types', () => {
    const track = mockTrack({ title: 'Bohemian Rhapsody', artist: 'Queen' });
    const queries = generateSearchQueries(track);

    assert.ok(queries.has('guitar-tabs'));
    assert.ok(queries.has('guitar-chords'));
    assert.ok(queries.has('piano-keys'));
    assert.ok(queries.has('sheet-music'));
    assert.ok(queries.has('tutorial'));
  });

  it('interpolates title and artist into query templates', () => {
    const track = mockTrack({ title: 'Hey Jude', artist: 'Beatles' });
    const queries = generateSearchQueries(track);
    const guitarTabQueries = queries.get('guitar-tabs') || [];

    assert.ok(guitarTabQueries.some(q => q.includes('Hey Jude')));
    assert.ok(guitarTabQueries.some(q => q.includes('Beatles')));
  });

  it('filters out very short queries', () => {
    const track = mockTrack({ title: '', artist: '' });
    const queries = generateSearchQueries(track);
    for (const [, qs] of queries) {
      for (const q of qs) {
        assert.ok(q.length > 3, `Query too short: "${q}"`);
      }
    }
  });

  it('generates at least 1 query per type for a normal track', () => {
    const track = mockTrack({ title: 'Stairway to Heaven', artist: 'Led Zeppelin' });
    const queries = generateSearchQueries(track);
    for (const [type, qs] of queries) {
      assert.ok(qs.length >= 1, `Expected at least 1 query for ${type}, got ${qs.length}`);
    }
  });
});

// ── generateStaticResources ───────────────────────────────────────────────────

describe('generateStaticResources', () => {
  it('returns resources for all 5 resource types', () => {
    const track = mockTrack({ title: 'Stairway to Heaven', artist: 'Led Zeppelin' });
    const resources = generateStaticResources(track);

    const types = new Set(resources.map(r => r.resourceType));
    assert.ok(types.has('guitar-tabs'), 'should have guitar-tabs');
    assert.ok(types.has('guitar-chords'), 'should have guitar-chords');
    assert.ok(types.has('piano-keys'), 'should have piano-keys');
    assert.ok(types.has('sheet-music'), 'should have sheet-music');
    assert.ok(types.has('tutorial'), 'should have tutorial');
  });

  it('includes trusted providers', () => {
    const track = mockTrack({ title: 'Wonderwall', artist: 'Oasis' });
    const resources = generateStaticResources(track);
    const providers = new Set(resources.map(r => r.provider));

    assert.ok(providers.has('ultimate-guitar.com'), 'should include Ultimate Guitar');
    assert.ok(providers.has('musescore.com'), 'should include MuseScore');
    assert.ok(providers.has('youtube.com'), 'should include YouTube');
  });

  it('returns high or medium confidence for static resources', () => {
    const track = mockTrack({ title: 'Hotel California', artist: 'Eagles' });
    const resources = generateStaticResources(track);
    for (const r of resources) {
      assert.ok(
        r.confidence === 'high' || r.confidence === 'medium',
        `Unexpected confidence "${r.confidence}" for ${r.provider}`,
      );
    }
  });

  it('returns empty array when track has no title', () => {
    const track = mockTrack({ title: '', artist: '' });
    const resources = generateStaticResources(track);
    assert.equal(resources.length, 0);
  });

  it('includes track id in all resources', () => {
    const track = mockTrack({ id: 'my-track-123', title: 'Song', artist: 'Artist' });
    const resources = generateStaticResources(track);
    for (const r of resources) {
      assert.equal(r.trackId, 'my-track-123');
    }
  });

  it('all URLs are valid', () => {
    const track = mockTrack({ title: 'Under Pressure', artist: 'Queen & David Bowie' });
    const resources = generateStaticResources(track);
    for (const r of resources) {
      assert.doesNotThrow(() => new URL(r.url), `Invalid URL: ${r.url}`);
    }
  });

  it('all resources have isSaved = false', () => {
    const track = mockTrack({ title: 'Song', artist: 'Artist' });
    const resources = generateStaticResources(track);
    for (const r of resources) {
      assert.equal(r.isSaved, false);
    }
  });

  it('generates unique URLs (no duplicates)', () => {
    const track = mockTrack({ title: 'Smells Like Teen Spirit', artist: 'Nirvana' });
    const resources = generateStaticResources(track);
    const urls = resources.map(r => r.url);
    const uniqueUrls = new Set(urls);
    assert.equal(urls.length, uniqueUrls.size, 'Expected no duplicate URLs in static resources');
  });

  it('title appears encoded in generated URLs', () => {
    const track = mockTrack({ title: 'Bohemian Rhapsody', artist: 'Queen' });
    const resources = generateStaticResources(track);
    const hasTrackInUrl = resources.some(r =>
      r.url.includes('Bohemian') || r.url.includes('bohemian') || r.url.includes('Bohemian+Rhapsody')
    );
    assert.ok(hasTrackInUrl, 'At least one URL should reference the track title');
  });
});
