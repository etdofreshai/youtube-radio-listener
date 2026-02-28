/**
 * Tests for tracks routes — create track with auto-fill + YouTube search.
 *
 * These test the route-level logic: URL-only creation, manual override, error
 * handling, and the YouTube search endpoint.
 *
 * Run: node --import tsx --test server/src/routes/tracks.test.ts
 *
 * Note: These tests use the in-memory store (no DATABASE_URL) so they're self-contained.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import tracksRouter from './tracks';

// We need to ensure deps are initialized before routes try to use them
import { checkAll } from '../deps';

let app: express.Express;

async function apiRequest(method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') { server.close(); reject(new Error('bad addr')); return; }
      try {
        const options: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, options);
        const json = await res.json().catch(() => ({}));
        resolve({ status: res.status, body: json });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

async function postTrack(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return apiRequest('POST', '/api/tracks', body);
}

describe('POST /api/tracks', () => {
  beforeEach(async () => {
    // Ensure deps are checked (yt-dlp availability)
    await checkAll();

    app = express();
    app.use(express.json());
    app.use('/api/tracks', tracksRouter);
  });

  it('rejects requests with no youtubeUrl', async () => {
    const { status, body } = await postTrack({ title: 'Test', artist: 'Artist' });
    assert.equal(status, 400);
    assert.ok(body.error.includes('youtubeUrl'));
  });

  it('accepts requests with all fields provided (manual override)', async () => {
    const { status, body } = await postTrack({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'My Custom Title',
      artist: 'My Custom Artist',
    });
    assert.equal(status, 201);
    assert.equal(body.title, 'My Custom Title');
    assert.equal(body.artist, 'My Custom Artist');
    assert.equal(body.youtubeUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('rejects invalid YouTube URL when title/artist are missing', async () => {
    const { status, body } = await postTrack({
      youtubeUrl: 'https://example.com/not-youtube',
    });
    assert.equal(status, 400);
    assert.ok(body.error.toLowerCase().includes('invalid'));
  });

  it('rejects volume outside valid range', async () => {
    const { status, body } = await postTrack({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Test',
      artist: 'Test',
      volume: 300,
    });
    assert.equal(status, 400);
    assert.ok(body.error.includes('volume'));
  });

  it('accepts partial fields — title only, artist auto-detected', async () => {
    // When title is given but artist is not, and URL is valid,
    // the server will attempt yt-dlp fetch. If yt-dlp is unavailable,
    // it should return a 422 with an actionable error.
    const { status, body } = await postTrack({
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'My Title',
    });
    // Either 201 (yt-dlp available and fetch succeeded) or 422 (yt-dlp unavailable)
    assert.ok(status === 201 || status === 422, `Expected 201 or 422, got ${status}`);
    if (status === 201) {
      assert.equal(body.title, 'My Title'); // User override preserved
      assert.ok(body.artist.length > 0);    // Artist auto-filled
    }
  });
});

// ============================================================
// GET /api/tracks/search-youtube
// ============================================================

describe('GET /api/tracks/search-youtube', () => {
  beforeEach(async () => {
    await checkAll();
    app = express();
    app.use(express.json());
    app.use('/api/tracks', tracksRouter);
  });

  it('rejects requests with no query', async () => {
    const { status, body } = await apiRequest('GET', '/api/tracks/search-youtube');
    assert.equal(status, 400);
    assert.ok(body.error.includes('q'));
  });

  it('rejects empty query', async () => {
    const { status, body } = await apiRequest('GET', '/api/tracks/search-youtube?q=');
    assert.equal(status, 400);
    assert.ok(body.error.includes('q'));
  });

  it('rejects query that is too long', async () => {
    const longQuery = 'a'.repeat(201);
    const { status, body } = await apiRequest('GET', `/api/tracks/search-youtube?q=${longQuery}`);
    assert.equal(status, 400);
    assert.ok(body.error.toLowerCase().includes('long'));
  });

  it('returns results for a valid query (if yt-dlp is available)', async () => {
    const { status, body } = await apiRequest('GET', '/api/tracks/search-youtube?q=never+gonna+give+you+up&maxResults=2');
    // Either 200 (yt-dlp available) or 500 (yt-dlp unavailable)
    if (status === 200) {
      assert.ok(Array.isArray(body.results), 'results should be an array');
      assert.equal(body.query, 'never gonna give you up');
      if (body.results.length > 0) {
        const first = body.results[0];
        assert.ok(first.videoId, 'result should have videoId');
        assert.ok(first.title, 'result should have title');
        assert.ok(first.youtubeUrl, 'result should have youtubeUrl');
        assert.ok(first.youtubeUrl.includes('youtube.com/watch'), 'youtubeUrl should be a YouTube URL');
      }
    } else {
      // yt-dlp not available — search returns 500
      assert.equal(status, 500);
      assert.ok(body.error);
    }
  });
});
