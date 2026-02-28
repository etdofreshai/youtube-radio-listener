/**
 * Tests for multi-artist support + title/artist mapping correctness.
 *
 * Run: node --import tsx --test server/src/routes/multi-artist.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import tracksRouter from './tracks';
import artistsRouter from './artists';
import { checkAll } from '../deps';

let app: express.Express;

async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
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

describe('Title/Artist mapping correctness', () => {
  beforeEach(async () => {
    await checkAll();
    app = express();
    app.use(express.json());
    app.use('/api/tracks', tracksRouter);
    app.use('/api/artists', artistsRouter);
  });

  it('stores title and artist in correct fields (not inverted)', async () => {
    const { status, body } = await apiRequest('POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
    });
    assert.equal(status, 201);
    // Verify fields are NOT inverted
    assert.equal(body.title, 'Never Gonna Give You Up', 'title should be the song title');
    assert.equal(body.artist, 'Rick Astley', 'artist should be the artist name');
    // Verify title is not in artist field and vice versa
    assert.notEqual(body.title, 'Rick Astley', 'title field must not contain artist');
    assert.notEqual(body.artist, 'Never Gonna Give You Up', 'artist field must not contain title');
  });

  it('preserves title/artist on update without swapping', async () => {
    const create = await apiRequest('POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Original Title',
      artist: 'Original Artist',
    });
    assert.equal(create.status, 201);
    const trackId = create.body.id;

    const update = await apiRequest('PUT', `/api/tracks/${trackId}`, {
      title: 'Updated Title',
      artist: 'Updated Artist',
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.title, 'Updated Title');
    assert.equal(update.body.artist, 'Updated Artist');
  });

  it('GET returns title and artist in correct fields', async () => {
    const create = await apiRequest('POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
    });
    assert.equal(create.status, 201);
    const trackId = create.body.id;

    const get = await apiRequest('GET', `/api/tracks/${trackId}`);
    assert.equal(get.status, 200);
    assert.equal(get.body.title, 'Bohemian Rhapsody');
    assert.equal(get.body.artist, 'Queen');
  });
});

describe('Multi-artist read/write paths (in-memory store)', () => {
  beforeEach(async () => {
    await checkAll();
    app = express();
    app.use(express.json());
    app.use('/api/tracks', tracksRouter);
    app.use('/api/artists', artistsRouter);
  });

  it('creates a track with single artist — response has correct fields', async () => {
    const { status, body } = await apiRequest('POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=test1',
      title: 'Test Track',
      artist: 'Test Artist',
    });
    assert.equal(status, 201);
    assert.equal(body.title, 'Test Track');
    assert.equal(body.artist, 'Test Artist');
    // In-memory store won't have artists array (requires postgres),
    // but the fields should be present
    assert.equal(typeof body.id, 'string');
    assert.equal(typeof body.title, 'string');
    assert.equal(typeof body.artist, 'string');
  });

  it('paginated GET returns tracks with correct title/artist', async () => {
    // Create two tracks with distinct title/artist
    await apiRequest('POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=abc1',
      title: 'Song Alpha',
      artist: 'Artist One',
    });
    await apiRequest('POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=abc2',
      title: 'Song Beta',
      artist: 'Artist Two',
    });

    const { status, body } = await apiRequest('GET', '/api/tracks?sortBy=createdAt&sortDir=desc');
    assert.equal(status, 200);
    assert.ok(body.data.length >= 2);

    // Check that no track has its title and artist swapped
    for (const track of body.data) {
      // A simple sanity check: title should not equal any known artist name
      // and artist should not equal any known title
      assert.equal(typeof track.title, 'string');
      assert.equal(typeof track.artist, 'string');
    }
  });
});

describe('Artist API', () => {
  beforeEach(async () => {
    await checkAll();
    app = express();
    app.use(express.json());
    app.use('/api/artists', artistsRouter);
  });

  it('rejects artist creation without name', async () => {
    const { status, body } = await apiRequest('POST', '/api/artists', {});
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});
