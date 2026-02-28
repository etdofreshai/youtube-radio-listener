/**
 * Tests for the playlist import service.
 *
 * Covers:
 *  - Deduplication (skipped_existing)
 *  - Partial-failure handling (failed with reasons/titles)
 *  - Structured summary shape (added / skipped_existing / failed)
 *  - Truncation metadata pass-through
 *
 * Run from repo root:
 *   cd server && npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importPlaylistTracks } from './playlist-import.js';
import type { PlaylistImportDeps } from './playlist-import.js';
import type { YouTubePlaylistInfo } from './youtube-metadata.js';
import type { Track } from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlaylistInfo(overrides: Partial<YouTubePlaylistInfo> = {}): YouTubePlaylistInfo {
  return {
    sourceUrl: 'https://www.youtube.com/playlist?list=PLabc',
    playlistId: 'PLabc',
    playlistTitle: 'Test Playlist',
    totalAvailable: 3,
    truncated: false,
    limit: 100,
    items: [
      { videoId: 'vid1', youtubeUrl: 'https://www.youtube.com/watch?v=vid1', title: 'Song 1', channel: 'Artist A', position: 0 },
      { videoId: 'vid2', youtubeUrl: 'https://www.youtube.com/watch?v=vid2', title: 'Song 2', channel: 'Artist B', position: 1 },
      { videoId: 'vid3', youtubeUrl: 'https://www.youtube.com/watch?v=vid3', title: 'Song 3', channel: 'Artist C', position: 2 },
    ],
    ...overrides,
  };
}

function makeTrack(videoId: string, title: string): Track {
  return {
    id: `track-${videoId}`,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    artist: 'Test Artist',
    audioStatus: 'pending',
    videoStatus: 'none',
    isLiveStream: false,
    volume: 100,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    enrichmentStatus: 'none',
    enrichmentAttempts: 0,
    enrichmentError: null,
    nextEnrichAt: null,
    stageACompletedAt: null,
    stageBCompletedAt: null,
    metadataSource: null,
    metadataConfidence: null,
    fieldConfidences: [],
    lastEnrichedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startTimeSec: null,
    endTimeSec: null,
    duration: null,
    notes: null,
    audioFilename: null,
    audioError: null,
    lastDownloadAt: null,
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
    artistId: null,
    albumId: null,
    albumName: null,
    albumSlug: null,
    artists: [],
    lyrics: null,
    lyricsSource: null,
    trackGroupId: null,
    linkedTracks: [],
    variants: [],
    videoError: null,
    videoFilename: null,
    lastVideoDownloadAt: null,
  } as unknown as Track;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('importPlaylistTracks – structured summary', () => {
  it('adds all items when none exist and none fail', async () => {
    const deps: PlaylistImportDeps = {
      findExistingByVideoId: async () => undefined,
      createTrackForItem: async (item) => makeTrack(item.videoId, item.title),
    };

    const result = await importPlaylistTracks(makePlaylistInfo(), deps);

    assert.strictEqual(result.added.length, 3);
    assert.strictEqual(result.skipped_existing.length, 0);
    assert.strictEqual(result.failed.length, 0);
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.playlistTitle, 'Test Playlist');
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.limit, 100);
  });

  it('skips already-existing items into skipped_existing', async () => {
    const deps: PlaylistImportDeps = {
      // vid1 already exists, vid2 and vid3 do not
      findExistingByVideoId: async (videoId) => {
        if (videoId === 'vid1') return { trackId: 'existing-track-1' };
        return undefined;
      },
      createTrackForItem: async (item) => makeTrack(item.videoId, item.title),
    };

    const result = await importPlaylistTracks(makePlaylistInfo(), deps);

    assert.strictEqual(result.added.length, 2);
    assert.strictEqual(result.skipped_existing.length, 1);
    assert.strictEqual(result.failed.length, 0);

    const skipped = result.skipped_existing[0];
    assert.strictEqual(skipped.videoId, 'vid1');
    assert.strictEqual(skipped.title, 'Song 1');
    assert.strictEqual(skipped.existingTrackId, 'existing-track-1');
  });

  it('records failed items with reason and title, continues on partial failure', async () => {
    const deps: PlaylistImportDeps = {
      findExistingByVideoId: async () => undefined,
      createTrackForItem: async (item) => {
        if (item.videoId === 'vid2') throw new Error('yt-dlp timeout');
        return makeTrack(item.videoId, item.title);
      },
    };

    const result = await importPlaylistTracks(makePlaylistInfo(), deps);

    assert.strictEqual(result.added.length, 2);
    assert.strictEqual(result.skipped_existing.length, 0);
    assert.strictEqual(result.failed.length, 1);

    const fail = result.failed[0];
    assert.strictEqual(fail.videoId, 'vid2');
    assert.strictEqual(fail.title, 'Song 2');
    assert.match(fail.reason, /yt-dlp timeout/);
  });

  it('handles all three outcomes in one run', async () => {
    const deps: PlaylistImportDeps = {
      findExistingByVideoId: async (videoId) => {
        if (videoId === 'vid1') return { trackId: 'existing-1' };
        return undefined;
      },
      createTrackForItem: async (item) => {
        if (item.videoId === 'vid3') throw new Error('Network error');
        return makeTrack(item.videoId, item.title);
      },
    };

    const result = await importPlaylistTracks(makePlaylistInfo(), deps);

    // vid1 → skipped_existing, vid2 → added, vid3 → failed
    assert.strictEqual(result.added.length, 1);
    assert.strictEqual(result.added[0].id, 'track-vid2');
    assert.strictEqual(result.skipped_existing.length, 1);
    assert.strictEqual(result.skipped_existing[0].videoId, 'vid1');
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(result.failed[0].videoId, 'vid3');
    assert.match(result.failed[0].reason, /Network error/);
  });

  it('passes truncated=true and limit from playlistInfo', async () => {
    const deps: PlaylistImportDeps = {
      findExistingByVideoId: async () => undefined,
      createTrackForItem: async (item) => makeTrack(item.videoId, item.title),
    };

    const result = await importPlaylistTracks(
      makePlaylistInfo({ truncated: true, limit: 100, totalAvailable: 250 }),
      deps,
    );

    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.limit, 100);
  });

  it('handles empty playlist gracefully', async () => {
    const deps: PlaylistImportDeps = {
      findExistingByVideoId: async () => undefined,
      createTrackForItem: async (item) => makeTrack(item.videoId, item.title),
    };

    const result = await importPlaylistTracks(
      makePlaylistInfo({ items: [], totalAvailable: 0, total: 0 } as any),
      deps,
    );

    assert.strictEqual(result.added.length, 0);
    assert.strictEqual(result.skipped_existing.length, 0);
    assert.strictEqual(result.failed.length, 0);
    assert.strictEqual(result.total, 0);
  });

  it('skipped_existing items do not call createTrackForItem', async () => {
    let createCalled = 0;
    const deps: PlaylistImportDeps = {
      findExistingByVideoId: async () => ({ trackId: 'existing-track' }),
      createTrackForItem: async (item) => { createCalled++; return makeTrack(item.videoId, item.title); },
    };

    await importPlaylistTracks(makePlaylistInfo(), deps);

    assert.strictEqual(createCalled, 0, 'createTrackForItem should not be called for existing items');
  });

  it('provides null title in failed item when item has no title', async () => {
    const infoWithNoTitle: YouTubePlaylistInfo = makePlaylistInfo({
      items: [
        { videoId: 'vid-nt', youtubeUrl: 'https://www.youtube.com/watch?v=vid-nt', title: '', channel: null, position: 0 },
      ],
    });

    const deps: PlaylistImportDeps = {
      findExistingByVideoId: async () => undefined,
      createTrackForItem: async () => { throw new Error('fail'); },
    };

    const result = await importPlaylistTracks(infoWithNoTitle, deps);
    assert.strictEqual(result.failed[0].title, null);
  });
});
