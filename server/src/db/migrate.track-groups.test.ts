import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from './pool';
import { ensureSchema } from './migrate';
import * as store from '../store';

const runIfPostgres = process.env.DATABASE_URL ? describe : describe.skip;

async function cleanup() {
  const pool = getPool();
  await pool.query('DELETE FROM track_group_members');
  await pool.query('DELETE FROM track_groups');
  await pool.query('DELETE FROM track_variants');
  await pool.query('DELETE FROM tracks');
}

runIfPostgres('track-group migration/backfill', () => {
  beforeEach(async () => {
    await ensureSchema();
    await cleanup();
  });

  it('creates track_groups and track_group_members tables', async () => {
    const pool = getPool();
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('track_groups', 'track_group_members')
      ORDER BY table_name
    `);

    const names = result.rows.map((r: any) => r.table_name);
    assert.deepEqual(names, ['track_group_members', 'track_groups']);
  });

  it('backfills only high-confidence duplicates (same video id)', async () => {
    const t1 = await store.createTrack({
      youtubeUrl: 'https://www.youtube.com/watch?v=backfillSameVideo123',
      title: 'Same Song',
      artist: 'Same Artist',
      isLiveStream: true,
    });

    const t2 = await store.createTrack({
      youtubeUrl: 'https://youtu.be/backfillSameVideo123?t=10',
      title: 'Same Song',
      artist: 'Same Artist',
      isLiveStream: true,
    });

    await ensureSchema();

    const pool = getPool();
    const memberships = await pool.query(
      `SELECT track_group_id, track_id FROM track_group_members WHERE track_id = ANY($1::uuid[]) ORDER BY track_id`,
      [[t1.id, t2.id]],
    );

    assert.equal(memberships.rows.length, 2);
    assert.equal(memberships.rows[0].track_group_id, memberships.rows[1].track_group_id);
  });
});
