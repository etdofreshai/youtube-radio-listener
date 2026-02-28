/**
 * Tests for /api/playback/state endpoints.
 * Uses Node built-in test runner.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001'; // default local user

async function api<T>(path: string, opts?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': TEST_USER_ID,
      ...(opts?.headers as Record<string, string> | undefined),
    },
  });
  const body = await res.json() as T;
  return { status: res.status, body };
}

describe('Playback State API', () => {
  it('GET /api/playback/state returns default empty state', async () => {
    const { status, body } = await api<any>('/api/playback/state');
    assert.equal(status, 200);
    assert.equal(body.userId, TEST_USER_ID);
    assert.equal(body.isPlaying, false);
    assert.equal(body.positionSec, 0);
    assert.ok(Array.isArray(body.queue));
    assert.ok(Array.isArray(body.playHistory));
  });

  it('POST /api/playback/state creates/updates state', async () => {
    const { status, body } = await api<any>('/api/playback/state', {
      method: 'POST',
      body: JSON.stringify({
        isPlaying: true,
        positionSec: 42.5,
        queue: ['track-a', 'track-b', 'track-c'],
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.userId, TEST_USER_ID);
    assert.equal(body.isPlaying, true);
    assert.equal(body.positionSec, 42.5);
    assert.deepEqual(body.queue, ['track-a', 'track-b', 'track-c']);
  });

  it('GET /api/playback/state returns previously set state', async () => {
    const { status, body } = await api<any>('/api/playback/state');
    assert.equal(status, 200);
    assert.equal(body.isPlaying, true);
    assert.equal(body.positionSec, 42.5);
    assert.deepEqual(body.queue, ['track-a', 'track-b', 'track-c']);
  });

  it('POST /api/playback/state with addToHistory prepends entry', async () => {
    const { status, body } = await api<any>('/api/playback/state', {
      method: 'POST',
      body: JSON.stringify({
        addToHistory: 'track-a',
        isPlaying: false,
      }),
    });
    assert.equal(status, 200);
    assert.equal(body.isPlaying, false);
    assert.ok(Array.isArray(body.playHistory));
    assert.ok(body.playHistory.length > 0);
    assert.equal(body.playHistory[0].trackId, 'track-a');
    assert.ok(body.playHistory[0].playedAt); // ISO timestamp
  });

  it('POST /api/playback/state partial update preserves other fields', async () => {
    // First set queue and isPlaying
    await api('/api/playback/state', {
      method: 'POST',
      body: JSON.stringify({
        isPlaying: true,
        queue: ['x', 'y'],
      }),
    });

    // Now update only positionSec
    const { body } = await api<any>('/api/playback/state', {
      method: 'POST',
      body: JSON.stringify({
        positionSec: 99.9,
      }),
    });

    assert.equal(body.positionSec, 99.9);
    assert.equal(body.isPlaying, true); // preserved from previous call
    assert.deepEqual(body.queue, ['x', 'y']); // preserved
  });
});
