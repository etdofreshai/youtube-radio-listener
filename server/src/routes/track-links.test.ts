import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import tracksRouter from './tracks';
import { ensureSchema } from '../db/migrate';
import { getPool } from '../db/pool';
import * as store from '../store';

const runIfPostgres = process.env.DATABASE_URL ? describe : describe.skip;

async function cleanup() {
  const pool = getPool();
  await pool.query('DELETE FROM track_group_members');
  await pool.query('DELETE FROM track_groups');
  await pool.query('DELETE FROM track_variants');
  await pool.query('DELETE FROM tracks');
}

async function apiRequest(method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const app = express();
  app.use(express.json());
  app.use('/api/tracks', tracksRouter);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('bad addr'));
          return;
        }
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
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

runIfPostgres('track dedupe consults track links/groups', () => {
  beforeEach(async () => {
    await ensureSchema();
    await cleanup();
  });

  it('returns one dedupe suggestion for an already-linked duplicate cluster', async () => {
    const t1 = await store.createTrack({
      youtubeUrl: 'https://www.youtube.com/watch?v=dedupeOne12345',
      title: 'Cluster Song',
      artist: 'Cluster Artist',
      isLiveStream: true,
    });

    const t2 = await store.createTrack({
      youtubeUrl: 'https://www.youtube.com/watch?v=dedupeTwo12345',
      title: 'Cluster Song',
      artist: 'Cluster Artist',
      isLiveStream: true,
    });

    await store.linkTracks(t1.id, t2.id, 'cluster');

    const response = await apiRequest('POST', '/api/tracks', {
      youtubeUrl: 'https://www.youtube.com/watch?v=dedupeThree12345',
      title: 'Cluster Song',
      artist: 'Cluster Artist',
      isLiveStream: true,
    });

    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.potentialMatches));
    assert.equal(response.body.potentialMatches.length, 1);
    assert.ok(response.body.potentialMatches[0].trackGroupId);
  });
});
