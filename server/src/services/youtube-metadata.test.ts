/**
 * Tests for YouTube metadata service — parseArtistTitle and isValidYouTubeUrl.
 *
 * Run: node --import tsx --test server/src/services/youtube-metadata.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArtistTitle, isValidYouTubeUrl } from './youtube-metadata';

// ============================================================
// parseArtistTitle
// ============================================================

describe('parseArtistTitle', () => {
  it('parses "Artist - Title" format', () => {
    const result = parseArtistTitle('Radiohead - Creep', 'RadioheadVEVO');
    assert.equal(result.artist, 'Radiohead');
    assert.equal(result.title, 'Creep');
  });

  it('parses "Artist — Title" (em-dash) format', () => {
    const result = parseArtistTitle('Daft Punk — Get Lucky', 'DaftPunkVEVO');
    assert.equal(result.artist, 'Daft Punk');
    assert.equal(result.title, 'Get Lucky');
  });

  it('parses "Artist – Title" (en-dash) format', () => {
    const result = parseArtistTitle('Björk – Hyperballad', 'Björk');
    assert.equal(result.artist, 'Björk');
    assert.equal(result.title, 'Hyperballad');
  });

  it('strips "(Official Video)" noise', () => {
    const result = parseArtistTitle('Nirvana - Smells Like Teen Spirit (Official Video)', 'NirvanaVEVO');
    assert.equal(result.artist, 'Nirvana');
    assert.equal(result.title, 'Smells Like Teen Spirit');
  });

  it('strips "[Official Audio]" noise', () => {
    const result = parseArtistTitle('Tyler, The Creator - EARFQUAKE [Official Audio]', 'Tyler');
    assert.equal(result.artist, 'Tyler, The Creator');
    assert.equal(result.title, 'EARFQUAKE');
  });

  it('strips "(Official Music Video)" noise', () => {
    const result = parseArtistTitle('Kendrick Lamar - HUMBLE. (Official Music Video)', 'KendrickVEVO');
    assert.equal(result.artist, 'Kendrick Lamar');
    assert.equal(result.title, 'HUMBLE.');
  });

  it('falls back to channel as artist when no separator', () => {
    const result = parseArtistTitle('Bohemian Rhapsody', 'Queen Official');
    assert.equal(result.artist, 'Queen Official');
    assert.equal(result.title, 'Bohemian Rhapsody');
  });

  it('falls back to "Unknown Artist" when no separator and no channel', () => {
    const result = parseArtistTitle('Some Random Track', null);
    assert.equal(result.artist, 'Unknown Artist');
    assert.equal(result.title, 'Some Random Track');
  });

  it('handles "Artist: Title" pattern', () => {
    const result = parseArtistTitle('Led Zeppelin: Stairway to Heaven', 'ClassicRock');
    assert.equal(result.artist, 'Led Zeppelin');
    assert.equal(result.title, 'Stairway to Heaven');
  });

  it('prefers user-provided values (manual override path tested at route level)', () => {
    // This test validates the parser itself — manual override is handled in the route
    const result = parseArtistTitle('', 'SomeChannel');
    assert.equal(result.artist, 'SomeChannel');
    assert.equal(result.title, '');
  });
});

// ============================================================
// isValidYouTubeUrl
// ============================================================

describe('isValidYouTubeUrl', () => {
  it('accepts standard youtube.com watch URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  });

  it('accepts youtu.be short URLs', () => {
    assert.equal(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
  });

  it('accepts music.youtube.com URLs', () => {
    assert.equal(isValidYouTubeUrl('https://music.youtube.com/watch?v=abc123'), true);
  });

  it('accepts m.youtube.com URLs', () => {
    assert.equal(isValidYouTubeUrl('https://m.youtube.com/watch?v=abc123'), true);
  });

  it('rejects non-YouTube URLs', () => {
    assert.equal(isValidYouTubeUrl('https://example.com/watch?v=abc'), false);
  });

  it('rejects malformed URLs', () => {
    assert.equal(isValidYouTubeUrl('not a url at all'), false);
  });

  it('rejects empty string', () => {
    assert.equal(isValidYouTubeUrl(''), false);
  });
});
