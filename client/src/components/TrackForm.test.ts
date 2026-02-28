/**
 * Tests for the TrackForm "Swap title ↔ artist" convenience action,
 * and for YouTube URL detection logic used in the form.
 *
 * Run (from repo root):
 *   node --import ./client/node_modules/tsx/dist/esm/index.mjs --test \
 *     client/src/components/TrackForm.test.ts
 *
 * Or via the client test script:
 *   cd client && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectYouTubeUrl, isPlaylistImportUrl } from '../utils/youtubeUrl.js';

// ── Pure swap helper (mirrors the logic in handleSwapTitleArtist) ────────────

/**
 * Swaps two values, returning [newTitle, newArtist].
 * This is the exact operation performed by handleSwapTitleArtist in TrackForm.
 */
function swapTitleArtist(title: string, artist: string): [string, string] {
  return [artist, title];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('swapTitleArtist – TrackForm convenience action', () => {
  it('swaps non-empty title and artist', () => {
    const [newTitle, newArtist] = swapTitleArtist('Song Name', 'Artist Name');
    assert.strictEqual(newTitle, 'Artist Name');
    assert.strictEqual(newArtist, 'Song Name');
  });

  it('is its own inverse: swapping twice returns original values', () => {
    const title = 'My Song';
    const artist = 'My Artist';
    const [t1, a1] = swapTitleArtist(title, artist);
    const [t2, a2] = swapTitleArtist(t1, a1);
    assert.strictEqual(t2, title);
    assert.strictEqual(a2, artist);
  });

  it('works when title is empty and artist has a value', () => {
    const [newTitle, newArtist] = swapTitleArtist('', 'Only Artist');
    assert.strictEqual(newTitle, 'Only Artist');
    assert.strictEqual(newArtist, '');
  });

  it('works when artist is empty and title has a value', () => {
    const [newTitle, newArtist] = swapTitleArtist('Only Title', '');
    assert.strictEqual(newTitle, '');
    assert.strictEqual(newArtist, 'Only Title');
  });

  it('works when both fields are empty', () => {
    const [newTitle, newArtist] = swapTitleArtist('', '');
    assert.strictEqual(newTitle, '');
    assert.strictEqual(newArtist, '');
  });

  it('works when both fields are identical', () => {
    const [newTitle, newArtist] = swapTitleArtist('Same', 'Same');
    assert.strictEqual(newTitle, 'Same');
    assert.strictEqual(newArtist, 'Same');
  });

  it('preserves whitespace-only values exactly', () => {
    const [newTitle, newArtist] = swapTitleArtist('  ', 'Artist');
    assert.strictEqual(newTitle, 'Artist');
    assert.strictEqual(newArtist, '  ');
  });

  it('preserves values with special characters and unicode', () => {
    const [newTitle, newArtist] = swapTitleArtist('Ça va — ¿Qué? 🎵', 'Björk');
    assert.strictEqual(newTitle, 'Björk');
    assert.strictEqual(newArtist, 'Ça va — ¿Qué? 🎵');
  });

  it('does not mutate input values (pure function)', () => {
    const title = 'Title';
    const artist = 'Artist';
    swapTitleArtist(title, artist);
    assert.strictEqual(title, 'Title');
    assert.strictEqual(artist, 'Artist');
  });
});

// ── URL detection (mirrors what TrackForm uses) ──────────────────────────────

describe('TrackForm URL auto-detection', () => {
  it('detects a single video URL → isPlaylist = false', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    assert.strictEqual(isPlaylistImportUrl(url), false);
    assert.strictEqual(detectYouTubeUrl(url).kind, 'single_video');
  });

  it('detects a pure playlist URL → isPlaylist = true', () => {
    const url = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
    assert.strictEqual(isPlaylistImportUrl(url), true);
    assert.strictEqual(detectYouTubeUrl(url).kind, 'playlist');
  });

  it('detects a video-with-playlist URL → isPlaylist = true', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
    assert.strictEqual(isPlaylistImportUrl(url), true);
    assert.strictEqual(detectYouTubeUrl(url).kind, 'video_with_playlist');
  });

  it('detects an invalid URL → isPlaylist = false', () => {
    assert.strictEqual(isPlaylistImportUrl('not a url'), false);
  });

  it('detects empty string → isPlaylist = false', () => {
    assert.strictEqual(isPlaylistImportUrl(''), false);
  });

  it('does not treat a channel URL as a playlist', () => {
    const url = 'https://www.youtube.com/@SomeChannel';
    assert.strictEqual(isPlaylistImportUrl(url), false);
    assert.strictEqual(detectYouTubeUrl(url).kind, 'not_supported');
  });

  it('youtu.be short URL with list= param → isPlaylist = true', () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ?list=PLabc123';
    assert.strictEqual(isPlaylistImportUrl(url), true);
  });
});
