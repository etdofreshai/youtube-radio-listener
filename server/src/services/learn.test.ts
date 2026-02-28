/**
 * Tests for the Learning Resources service
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
} from './learn';
import type { LearningResource } from '../types';

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

  it('returns unknown for invalid URLs', () => {
    assert.equal(extractProvider('not-a-url'), 'unknown');
  });
});

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

  it('returns low for generic content', () => {
    const conf = calculateConfidence(
      'https://random-site.com/page',
      'Some random page',
      'test song',
    );
    assert.equal(conf, 'low');
  });
});

describe('filterJunk', () => {
  it('filters out MP3 download results', () => {
    const resources = [
      mockResource({ title: 'Buy MP3 - Test Song', url: 'https://mp3site.com/test' }),
      mockResource({ title: 'Test Song Guitar Tab', url: 'https://tabs.com/test' }),
    ];
    const filtered = filterJunk(resources);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].title, 'Test Song Guitar Tab');
  });

  it('filters out ringtone results', () => {
    const resources = [
      mockResource({ title: 'Test Song - Free Download Ringtone', url: 'https://ringtones.com/test' }),
      mockResource({ title: 'Test Song Chords', url: 'https://chords.com/test' }),
    ];
    const filtered = filterJunk(resources);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].title, 'Test Song Chords');
  });
});

describe('dedupeResources', () => {
  it('removes duplicate URLs', () => {
    const resources = [
      mockResource({ id: '1', url: 'https://example.com/test', title: 'First' }),
      mockResource({ id: '2', url: 'https://example.com/test', title: 'Second' }),
      mockResource({ id: '3', url: 'https://other.com/test', title: 'Third' }),
    ];
    const deduped = dedupeResources(resources);
    assert.equal(deduped.length, 2);
    assert.equal(deduped.find(r => r.url === 'https://example.com/test')?.title, 'First');
  });
});

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
});

describe('inferResourceType', () => {
  it('infers guitar-tabs from tab URLs', () => {
    assert.equal(inferResourceType('Guitar Tab', 'https://ultimate-guitar.com/tab/song'), 'guitar-tabs');
  });

  it('defaults to guitar-chords when no specific type', () => {
    assert.equal(inferResourceType('Song Page', 'https://example.com/song'), 'guitar-chords');
  });
});
