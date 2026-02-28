import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../db/pool';
import { ensureSchema } from '../db/migrate';
import * as store from './index';

const runIfPostgres = process.env.DATABASE_URL ? describe : describe.skip;

async function cleanup() {
  const pool = getPool();
  await pool.query('DELETE FROM track_group_members');
  await pool.query('DELETE FROM track_groups');
  await pool.query('DELETE FROM track_variants');
  await pool.query('DELETE FROM tracks');
}

runIfPostgres('track links CRUD + preferred playback', () => {
  beforeEach(async () => {
    await ensureSchema();
    await cleanup();
  });

  it('links/unlinks tracks and resolves preferred playback source', async () => {
    const a = await store.createTrack({
      youtubeUrl: 'https://www.youtube.com/watch?v=trackLinkA12345',
      title: 'Song A',
      artist: 'Artist A',
      isLiveStream: true,
    });

    const b = await store.createTrack({
      youtubeUrl: 'https://www.youtube.com/watch?v=trackLinkB12345',
      title: 'Song A (Live)',
      artist: 'Artist A',
      isLiveStream: true,
    });

    const group = await store.linkTracks(a.id, b.id, 'Song A variants');
    assert.equal(group.trackIds.length, 2);
    assert.ok(group.trackIds.includes(a.id));
    assert.ok(group.trackIds.includes(b.id));

    const linked = await store.getLinkedTracks(a.id);
    assert.equal(linked.length, 1);
    assert.equal(linked[0].id, b.id);

    const updatedGroup = await store.setPreferredLinkedTrack(a.id, b.id);
    assert.equal(updatedGroup?.canonicalTrackId, b.id);

    const preferred = await store.getPreferredPlaybackTrack(a.id);
    assert.equal(preferred?.id, b.id);

    const removed = await store.unlinkTracks(a.id, b.id);
    assert.equal(removed, true);

    const postGroup = await store.getTrackGroup(a.id);
    assert.equal(postGroup, undefined);
  });
});
