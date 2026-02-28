/**
 * Tests for YouTube live stream support:
 *   1. URL-pattern detection (mightBeLiveStreamUrl)
 *   2. Track creation with isLiveStream flag (in-memory store)
 *   3. Stream route enforcement (non-live → 400, missing track → 404)
 *
 * Run:
 *   node --import tsx --test server/src/services/live-stream.test.ts
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mightBeLiveStreamUrl } from '../utils/youtube-url.js';

// ─── Silence yt-dlp "not found" console noise in tests ────────────────────
let originalConsoleError: typeof console.error;
before(() => { originalConsoleError = console.error; console.error = () => {}; });
after(() => { console.error = originalConsoleError; });

// ─── Helper: create a test Express app ────────────────────────────────────
async function makeApp() {
  const app = express();
  app.use(express.json());

  // We mount routes lazily inside each test via apiRequest
  const tracksRouter = (await import('../routes/tracks.js')).default;
  const streamRouter = (await import('../routes/stream.js')).default;
  app.use('/api/tracks', tracksRouter);
  app.use('/api/stream', streamRouter);
  return app;
}

async function apiRequest(
  app: express.Express,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('bad addr'));
        return;
      }
      try {
        const opts: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json' },
        };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, opts);
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

// ============================================================
// 1. URL Pattern Detection
// ============================================================

describe('mightBeLiveStreamUrl — URL pattern detection', () => {
  it('returns true for youtube.com/live/VIDEO_ID', () => {
    assert.ok(mightBeLiveStreamUrl('https://www.youtube.com/live/jfKfPfyJRdk'));
    assert.ok(mightBeLiveStreamUrl('https://youtube.com/live/jfKfPfyJRdk'));
  });

  it('returns true for live URL with query params', () => {
    assert.ok(mightBeLiveStreamUrl('https://www.youtube.com/live/jfKfPfyJRdk?si=abc123'));
  });

  it('returns false for standard watch URL', () => {
    assert.equal(mightBeLiveStreamUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
  });

  it('returns false for youtu.be short URL', () => {
    assert.equal(mightBeLiveStreamUrl('https://youtu.be/dQw4w9WgXcQ'), false);
  });

  it('returns false for playlist URL', () => {
    assert.equal(mightBeLiveStreamUrl('https://www.youtube.com/playlist?list=PLtest'), false);
  });

  it('returns false for shorts URL', () => {
    assert.equal(mightBeLiveStreamUrl('https://www.youtube.com/shorts/abc123'), false);
  });

  it('returns false for embed URL', () => {
    assert.equal(mightBeLiveStreamUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), false);
  });

  it('returns false for non-YouTube URLs', () => {
    assert.equal(mightBeLiveStreamUrl('https://twitch.tv/live/somestream'), false);
    assert.equal(mightBeLiveStreamUrl('https://example.com/live/abc'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(mightBeLiveStreamUrl(''), false);
  });

  it('returns false for invalid URL', () => {
    assert.equal(mightBeLiveStreamUrl('not-a-url'), false);
  });
});

// ============================================================
// 2. Track creation — live stream flag & audio status
// ============================================================

describe('createTrack — isLiveStream flag', () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await makeApp();
  });

  it('creates a live stream track with isLiveStream: true and audioStatus ready', async () => {
    const { status, body } = await apiRequest(app, 'POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=LiveVideoId1',
      title: 'Test Live Station',
      artist: 'Test Broadcaster',
      isLiveStream: true,
    });

    // 201 created
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.isLiveStream, true, 'isLiveStream should be true');
    // Live streams get audioStatus: ready immediately (no download needed)
    assert.equal(body.audioStatus, 'ready', 'Live stream tracks must start with audioStatus=ready');
    assert.equal(body.audioFilename, null, 'Live stream should have no audioFilename');
  });

  it('creates a normal track with isLiveStream: false (default) and audioStatus pending', async () => {
    const { status, body } = await apiRequest(app, 'POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=NormalVideoId1',
      title: 'Normal Track',
      artist: 'Some Artist',
      isLiveStream: false,
    });

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.isLiveStream, false, 'isLiveStream should be false');
    // Normal tracks start as pending (download is queued)
    assert.ok(
      body.audioStatus === 'pending' || body.audioStatus === 'downloading',
      `Expected pending or downloading, got ${body.audioStatus}`,
    );
  });

  it('creates a track with isLiveStream: true — title + artist preserved', async () => {
    const { status, body } = await apiRequest(app, 'POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/live/SomeLiveStreamId',
      title: 'My Live Radio',
      artist: 'Radio Station',
      isLiveStream: true,
    });

    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.title, 'My Live Radio');
    assert.equal(body.artist, 'Radio Station');
    assert.equal(body.isLiveStream, true);
  });
});

// ============================================================
// 3. Stream route — enforcement
// ============================================================

describe('GET /api/stream/:trackId — route enforcement', () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await makeApp();
  });

  it('returns 404 for non-existent track ID', async () => {
    const { status, body } = await apiRequest(
      app,
      'GET',
      '/api/stream/00000000-0000-0000-0000-000000000000',
    );
    assert.equal(status, 404);
    assert.ok(body.error, 'Should return an error message');
  });

  it('returns 400 when requesting stream for a non-live track', async () => {
    // First create a non-live track
    const create = await apiRequest(app, 'POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=NonLiveVid1',
      title: 'Not A Stream',
      artist: 'Artist',
      isLiveStream: false,
    });
    assert.equal(create.status, 201, `Track creation failed: ${JSON.stringify(create.body)}`);

    const { id } = create.body;

    // Now try to stream it — should get 400 (not a live stream)
    const { status, body } = await apiRequest(app, 'GET', `/api/stream/${id}`);
    assert.equal(status, 400);
    assert.ok(body.error?.toLowerCase().includes('not a live stream') || body.error?.toLowerCase().includes('live stream'), `Expected live stream error, got: ${body.error}`);
  });

  it('GET /api/stream/:trackId/resolve returns 400 for non-live tracks', async () => {
    // Create a non-live track
    const create = await apiRequest(app, 'POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=NonLiveVid2',
      title: 'Downloaded Track',
      artist: 'Artist',
      isLiveStream: false,
    });
    assert.equal(create.status, 201);
    const { id } = create.body;

    const { status } = await apiRequest(app, 'GET', `/api/stream/${id}/resolve`);
    assert.equal(status, 400);
  });
});

// ============================================================
// 4. Download route — blocked for live stream tracks
// ============================================================

describe('POST /api/tracks/:id/download — blocked for live streams', () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await makeApp();
  });

  it('returns 400 when trying to download a live stream track', async () => {
    // Create a live stream track
    const create = await apiRequest(app, 'POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/live/BlockedDownloadId',
      title: 'Live Station',
      artist: 'Broadcaster',
      isLiveStream: true,
    });
    assert.equal(create.status, 201);
    const { id } = create.body;

    const { status, body } = await apiRequest(app, 'POST', `/api/tracks/${id}/download`);
    assert.equal(status, 400);
    assert.ok(body.error?.toLowerCase().includes('live'), `Expected live stream error, got: ${body.error}`);
  });

  it('returns 400 when trying to re-download (refresh) a live stream track', async () => {
    const create = await apiRequest(app, 'POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/live/BlockedRefreshId',
      title: 'Live Station 2',
      artist: 'Broadcaster 2',
      isLiveStream: true,
    });
    assert.equal(create.status, 201);
    const { id } = create.body;

    const { status, body } = await apiRequest(app, 'POST', `/api/tracks/${id}/refresh`);
    assert.equal(status, 400);
    assert.ok(body.error?.toLowerCase().includes('live'), `Expected live stream error, got: ${body.error}`);
  });
});
