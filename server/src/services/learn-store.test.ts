/**
 * Integration tests for Learning Resources store functions (PostgreSQL only).
 *
 * These tests are skipped when DATABASE_URL is not set.
 * Run with: DATABASE_URL=postgres://... npm test
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

  // ── Create / List ────────────────────────────────────────────────────────────

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
    assert.equal(resources[0].resourceType, 'guitar-tabs');
    assert.equal(resources[0].title, 'Test Tab');
    assert.equal(resources[0].confidence, 'high');
    assert.equal(resources[0].isSaved, false);

    const loaded = await store.getLearningResources(testTrackId);
    assert.ok(loaded.some(r => r.id === resources[0].id), 'Resource should appear in list');
  });

  it('creates multiple resources in a batch', async () => {
    const resources = await store.createLearningResources(
      testTrackId,
      [
        {
          resourceType: 'guitar-tabs',
          title: 'Tab 1',
          provider: 'a.com',
          url: 'https://a.com/tab',
          snippet: null,
          confidence: 'high',
          isSaved: false,
        },
        {
          resourceType: 'guitar-chords',
          title: 'Chords 1',
          provider: 'b.com',
          url: 'https://b.com/chords',
          snippet: 'Chord chart',
          confidence: 'medium',
          isSaved: false,
        },
        {
          resourceType: 'tutorial',
          title: 'Tutorial 1',
          provider: 'youtube.com',
          url: 'https://youtube.com/watch?v=abc',
          snippet: 'Video tutorial',
          confidence: 'high',
          isSaved: false,
        },
      ],
      'batch test query',
    );

    assert.equal(resources.length, 3);
    const types = resources.map(r => r.resourceType);
    assert.ok(types.includes('guitar-tabs'));
    assert.ok(types.includes('guitar-chords'));
    assert.ok(types.includes('tutorial'));
  });

  // ── Single Resource Create ────────────────────────────────────────────────────

  it('creates a single learning resource manually', async () => {
    const resource = await store.createLearningResource(testTrackId, {
      resourceType: 'sheet-music',
      title: 'Manual Sheet Music',
      provider: 'musicnotes.com',
      url: 'https://musicnotes.com/test',
      snippet: 'Manually added sheet music',
      confidence: 'high',
    });

    assert.equal(resource.trackId, testTrackId);
    assert.equal(resource.resourceType, 'sheet-music');
    assert.equal(resource.provider, 'musicnotes.com');
    assert.equal(resource.isSaved, false);
    assert.ok(resource.id, 'Resource should have an ID');
  });

  // ── Save / Unsave ─────────────────────────────────────────────────────────────

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

    assert.equal(resource.isSaved, false, 'Should start unsaved');

    const saved = await store.saveLearningResource(testTrackId, resource.id);
    assert.equal(saved?.isSaved, true, 'Should be saved after save');
    assert.equal(saved?.id, resource.id);

    const unsaved = await store.unsaveLearningResource(testTrackId, resource.id);
    assert.equal(unsaved?.isSaved, false, 'Should be unsaved after unsave');
    assert.equal(unsaved?.id, resource.id);
  });

  it('returns null when saving a non-existent resource', async () => {
    const result = await store.saveLearningResource(testTrackId, '00000000-0000-0000-0000-000000000099');
    assert.equal(result, null);
  });

  it('returns null when unsaving a non-existent resource', async () => {
    const result = await store.unsaveLearningResource(testTrackId, '00000000-0000-0000-0000-000000000099');
    assert.equal(result, null);
  });

  // ── Saved resources list ──────────────────────────────────────────────────────

  it('getSavedLearningResources returns only saved resources', async () => {
    await store.createLearningResources(
      testTrackId,
      [
        {
          resourceType: 'guitar-tabs',
          title: 'Unsaved Tab',
          provider: 'a.com',
          url: 'https://a.com/tab',
          snippet: null,
          confidence: 'medium',
          isSaved: false,
        },
        {
          resourceType: 'tutorial',
          title: 'Saved Tutorial',
          provider: 'youtube.com',
          url: 'https://youtube.com/watch?v=saved',
          snippet: null,
          confidence: 'high',
          isSaved: false,
        },
      ],
      'test query',
    );

    const all = await store.getLearningResources(testTrackId);
    const tutorialId = all.find(r => r.title === 'Saved Tutorial')!.id;

    await store.saveLearningResource(testTrackId, tutorialId);

    const savedList = await store.getSavedLearningResources(testTrackId);
    assert.equal(savedList.length, 1);
    assert.equal(savedList[0].title, 'Saved Tutorial');
    assert.equal(savedList[0].isSaved, true);
  });

  // ── Delete ────────────────────────────────────────────────────────────────────

  it('deletes a learning resource', async () => {
    const [resource] = await store.createLearningResources(
      testTrackId,
      [
        {
          resourceType: 'piano-keys',
          title: 'Piano Resource To Delete',
          provider: 'flowkey.com',
          url: 'https://flowkey.com/test',
          snippet: null,
          confidence: 'low',
          isSaved: false,
        },
      ],
      'test query',
    );

    const before = await store.getLearningResources(testTrackId);
    assert.ok(before.some(r => r.id === resource.id), 'Resource exists before delete');

    const deleted = await store.deleteLearningResource(testTrackId, resource.id);
    assert.equal(deleted, true, 'deleteLearningResource should return true on success');

    const after = await store.getLearningResources(testTrackId);
    assert.ok(!after.some(r => r.id === resource.id), 'Resource should be gone after delete');
  });

  it('returns false when deleting a non-existent resource', async () => {
    const result = await store.deleteLearningResource(testTrackId, '00000000-0000-0000-0000-000000000099');
    assert.equal(result, false);
  });

  // ── Cache management ──────────────────────────────────────────────────────────

  it('getCachedLearningResources returns only unsaved resources', async () => {
    const [r1, r2] = await store.createLearningResources(
      testTrackId,
      [
        {
          resourceType: 'guitar-tabs',
          title: 'Cached Tab',
          provider: 'a.com',
          url: 'https://a.com/cached-tab',
          snippet: null,
          confidence: 'medium',
          isSaved: false,
        },
        {
          resourceType: 'guitar-chords',
          title: 'Will Be Saved',
          provider: 'b.com',
          url: 'https://b.com/chords',
          snippet: null,
          confidence: 'high',
          isSaved: false,
        },
      ],
      'cache test query',
    );

    await store.saveLearningResource(testTrackId, r2.id);

    const cached = await store.getCachedLearningResources(testTrackId);
    assert.ok(cached.some(r => r.id === r1.id), 'Unsaved resource should appear in cache');
    assert.ok(!cached.some(r => r.id === r2.id), 'Saved resource should NOT appear in cache');
  });

  it('clearCachedLearningResources removes unsaved resources but keeps saved ones', async () => {
    const [r1, r2] = await store.createLearningResources(
      testTrackId,
      [
        {
          resourceType: 'guitar-tabs',
          title: 'Auto-found Tab',
          provider: 'a.com',
          url: 'https://a.com/auto-tab',
          snippet: null,
          confidence: 'medium',
          isSaved: false,
        },
        {
          resourceType: 'tutorial',
          title: 'Bookmarked Tutorial',
          provider: 'youtube.com',
          url: 'https://youtube.com/watch?v=bookmarked',
          snippet: null,
          confidence: 'high',
          isSaved: false,
        },
      ],
      'cache clear test',
    );

    // Save r2
    await store.saveLearningResource(testTrackId, r2.id);

    // Clear cache (removes unsaved)
    await store.clearCachedLearningResources(testTrackId);

    const remaining = await store.getLearningResources(testTrackId);
    assert.ok(!remaining.some(r => r.id === r1.id), 'Unsaved auto-found tab should be cleared');
    assert.ok(remaining.some(r => r.id === r2.id), 'Saved bookmark should survive cache clear');
  });

  // ── Isolation between tracks ──────────────────────────────────────────────────

  it('resources are isolated per track', async () => {
    const track2 = await store.createTrack({
      youtubeUrl: `https://youtube.com/watch?v=other-${Date.now()}`,
      title: 'Other Track',
      artist: 'Other Artist',
      isLiveStream: true,
    });

    await store.createLearningResources(
      testTrackId,
      [{ resourceType: 'guitar-tabs', title: 'Track1 Tab', provider: 'a.com', url: 'https://a.com/t1', snippet: null, confidence: 'high', isSaved: false }],
      'q1',
    );

    await store.createLearningResources(
      track2.id,
      [{ resourceType: 'guitar-chords', title: 'Track2 Chords', provider: 'b.com', url: 'https://b.com/t2', snippet: null, confidence: 'medium', isSaved: false }],
      'q2',
    );

    const resources1 = await store.getLearningResources(testTrackId);
    const resources2 = await store.getLearningResources(track2.id);

    assert.ok(resources1.every(r => r.trackId === testTrackId), 'Track1 resources should only belong to track1');
    assert.ok(resources2.every(r => r.trackId === track2.id), 'Track2 resources should only belong to track2');
    assert.equal(resources1.length, 1);
    assert.equal(resources2.length, 1);
  });
});
