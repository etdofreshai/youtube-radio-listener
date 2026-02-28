/**
 * Integration tests for Learning Resources store functions (PostgreSQL only).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../store';

const runIfPostgres = process.env.DATABASE_URL ? describe : describe.skip;

runIfPostgres('Learning Resources Store (PostgreSQL)', () => {
  let testTrackId = '';

  before(async () => {
    assert.equal(store.isPostgres(), true, 'These tests require PostgreSQL');
  });

  beforeEach(async () => {
    const track = await store.createTrack({
      youtubeUrl: `https://youtube.com/watch?v=learn-${Date.now()}`,
      title: 'Learn Test Track',
      artist: 'Test Artist',
      isLiveStream: true,
    });
    testTrackId = track.id;
  });

  it('creates and lists learning resources', async () => {
    const resources = await store.createLearningResources(
      testTrackId,
      [
        {
          resourceType: 'guitar-tabs',
          title: 'Test Tab',
          provider: 'test.com',
          url: 'https://test.com/tab',
          snippet: 'A test tab',
          confidence: 'high',
          isSaved: false,
        },
      ],
      'test query',
    );

    assert.equal(resources.length, 1);
    assert.equal(resources[0].trackId, testTrackId);

    const loaded = await store.getLearningResources(testTrackId);
    assert.ok(loaded.some(r => r.id === resources[0].id));
  });

  it('saves and unsaves a resource', async () => {
    const [resource] = await store.createLearningResources(
      testTrackId,
      [
        {
          resourceType: 'guitar-chords',
          title: 'Test Chords',
          provider: 'test.com',
          url: 'https://test.com/chords',
          snippet: null,
          confidence: 'medium',
          isSaved: false,
        },
      ],
      'test query',
    );

    const saved = await store.saveLearningResource(testTrackId, resource.id);
    assert.equal(saved?.isSaved, true);

    const unsaved = await store.unsaveLearningResource(testTrackId, resource.id);
    assert.equal(unsaved?.isSaved, false);
  });
});
