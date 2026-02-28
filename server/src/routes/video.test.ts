/**
 * Tests for the video route and video pipeline fields.
 *
 * Run:
 *   node --import tsx --test src/routes/video.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import * as store from '../store';

function createTestApp() {
  const app = express();
  app.use(express.json());

  // Minimal tracks route subset for testing
  app.post('/api/tracks', async (req, res) => {
    const track = await store.createTrack(req.body);
    res.status(201).json(track);
  });

  app.get('/api/tracks/:id', async (req, res) => {
    const track = await store.getTrack(req.params.id as string);
    if (!track) { res.status(404).json({ error: 'not found' }); return; }
    res.json(track);
  });

  app.post('/api/tracks/:id/download-video', async (req, res) => {
    const track = await store.getTrack(req.params.id as string);
    if (!track) { res.status(404).json({ error: 'not found' }); return; }
    // Simulate video download start
    await store.updateTrackVideo(req.params.id as string, {
      videoStatus: 'downloading',
      videoError: null,
    });
    res.json(await store.getTrack(req.params.id as string));
  });

  return app;
}

function fetch(url: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: opts?.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...opts?.headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        resolve({ status: res.statusCode!, json: () => Promise.resolve(JSON.parse(data)) });
      });
    });
    req.on('error', reject);
    if (opts?.body) req.write(opts.body);
    req.end();
  });
}

describe('Video pipeline fields', () => {
  let server: http.Server;
  let base: string;

  it('setup server', async () => {
    const app = createTestApp();
    server = app.listen(0);
    const addr = server.address() as { port: number };
    base = `http://localhost:${addr.port}`;
  });

  it('new track has videoStatus "none" by default', async () => {
    const res = await fetch(`${base}/api/tracks`, {
      method: 'POST',
      body: JSON.stringify({ youtubeUrl: 'https://www.youtube.com/watch?v=testvid1', title: 'Video Test', artist: 'Test' }),
    });
    assert.equal(res.status, 201);
    const track = await res.json();
    assert.equal(track.videoStatus, 'none');
    assert.equal(track.videoError, null);
    assert.equal(track.videoFilename, null);
  });

  it('download-video sets videoStatus to downloading', async () => {
    // Create a track first
    const createRes = await fetch(`${base}/api/tracks`, {
      method: 'POST',
      body: JSON.stringify({ youtubeUrl: 'https://www.youtube.com/watch?v=testvid2', title: 'DL Test', artist: 'Test' }),
    });
    const created = await createRes.json();

    // Start video download
    const dlRes = await fetch(`${base}/api/tracks/${created.id}/download-video`, { method: 'POST' });
    assert.equal(dlRes.status, 200);
    const updated = await dlRes.json();
    assert.equal(updated.videoStatus, 'downloading');
  });

  it('updateTrackVideo can set ready status', async () => {
    const createRes = await fetch(`${base}/api/tracks`, {
      method: 'POST',
      body: JSON.stringify({ youtubeUrl: 'https://www.youtube.com/watch?v=testvid3', title: 'Ready Test', artist: 'Test' }),
    });
    const created = await createRes.json();

    await store.updateTrackVideo(created.id, {
      videoStatus: 'ready',
      videoFilename: `${created.id}.mp4`,
      videoError: null,
    });

    const getRes = await fetch(`${base}/api/tracks/${created.id}`);
    const track = await getRes.json();
    assert.equal(track.videoStatus, 'ready');
    assert.equal(track.videoFilename, `${created.id}.mp4`);
  });

  it('updateTrackVideo can set error status', async () => {
    const createRes = await fetch(`${base}/api/tracks`, {
      method: 'POST',
      body: JSON.stringify({ youtubeUrl: 'https://www.youtube.com/watch?v=testvid4', title: 'Error Test', artist: 'Test' }),
    });
    const created = await createRes.json();

    await store.updateTrackVideo(created.id, {
      videoStatus: 'error',
      videoError: 'something went wrong',
    });

    const getRes = await fetch(`${base}/api/tracks/${created.id}`);
    const track = await getRes.json();
    assert.equal(track.videoStatus, 'error');
    assert.equal(track.videoError, 'something went wrong');
  });

  it('cleanup', () => {
    server?.close();
  });
});
