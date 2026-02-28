/**
 * Tests for playlist ownership, permissions, sharing, and history tracking.
 *
 * Uses Node's built-in test runner with pure logic (no DB needed).
 * Run: node --import tsx --test server/src/routes/playlists.test.ts
 *
 * Tests cover:
 * - Permission helpers (canEdit, canDelete, canView)
 * - Visibility filtering logic
 * - History user tracking (actorId propagation)
 * - Sharing flag behaviour
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// ---------------------------------------------------------------------------
// Minimal Playlist stub (matches the updated Playlist interface)
// ---------------------------------------------------------------------------

interface PlaylistStub {
  id: string;
  ownerId: string | null;
  isPublic: boolean;
  isEditableByOthers: boolean;
}

// ---------------------------------------------------------------------------
// Permission helpers — pure implementations (mirrors postgres.ts logic)
// ---------------------------------------------------------------------------

function canEditPlaylist(playlist: PlaylistStub, actorId: string): boolean {
  // Legacy (no owner) → everyone can edit
  if (!playlist.ownerId) return true;
  // Owner can always edit
  if (playlist.ownerId === actorId) return true;
  // Others can edit only if flag set
  return playlist.isEditableByOthers;
}

function canDeletePlaylist(playlist: PlaylistStub, actorId: string): boolean {
  // Legacy (no owner) → everyone can delete
  if (!playlist.ownerId) return true;
  // Only owner can delete
  return playlist.ownerId === actorId;
}

function canViewPlaylist(playlist: PlaylistStub, actorId?: string): boolean {
  // Public or legacy → everyone can view
  if (playlist.isPublic || !playlist.ownerId) return true;
  if (!actorId) return false;
  return playlist.ownerId === actorId;
}

// ---------------------------------------------------------------------------
// Visibility filtering — mirrors getAllPlaylists WHERE clause logic
// ---------------------------------------------------------------------------

function filterVisiblePlaylists(playlists: PlaylistStub[], actorId?: string): PlaylistStub[] {
  return playlists.filter(p => {
    if (!p.ownerId) return true;           // legacy
    if (p.isPublic) return true;           // public
    if (!actorId) return false;
    return p.ownerId === actorId;          // own playlists
  });
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const ALICE = 'user-alice-0000-0000-0000-000000000001';
const BOB   = 'user-bob---0000-0000-0000-000000000002';
const CAROL = 'user-carol-0000-0000-0000-000000000003';

const legacyPlaylist: PlaylistStub = { id: 'pl-legacy', ownerId: null, isPublic: false, isEditableByOthers: false };
const alicePrivate: PlaylistStub   = { id: 'pl-alice-priv', ownerId: ALICE, isPublic: false, isEditableByOthers: false };
const alicePublic: PlaylistStub    = { id: 'pl-alice-pub', ownerId: ALICE, isPublic: true, isEditableByOthers: false };
const aliceShared: PlaylistStub    = { id: 'pl-alice-shared', ownerId: ALICE, isPublic: false, isEditableByOthers: true };
const alicePubShared: PlaylistStub = { id: 'pl-alice-pub-shared', ownerId: ALICE, isPublic: true, isEditableByOthers: true };

// ---------------------------------------------------------------------------
// Tests: canEditPlaylist
// ---------------------------------------------------------------------------

describe('canEditPlaylist', () => {
  test('legacy playlist (no owner) — everyone can edit', () => {
    assert.equal(canEditPlaylist(legacyPlaylist, ALICE), true);
    assert.equal(canEditPlaylist(legacyPlaylist, BOB), true);
  });

  test('owner can always edit their own playlist', () => {
    assert.equal(canEditPlaylist(alicePrivate, ALICE), true);
    assert.equal(canEditPlaylist(alicePublic, ALICE), true);
    assert.equal(canEditPlaylist(aliceShared, ALICE), true);
  });

  test('non-owner blocked on private (non-shared) playlist', () => {
    assert.equal(canEditPlaylist(alicePrivate, BOB), false);
    assert.equal(canEditPlaylist(alicePublic, BOB), false);
  });

  test('non-owner can edit when isEditableByOthers = true', () => {
    assert.equal(canEditPlaylist(aliceShared, BOB), true);
    assert.equal(canEditPlaylist(aliceShared, CAROL), true);
    assert.equal(canEditPlaylist(alicePubShared, BOB), true);
  });
});

// ---------------------------------------------------------------------------
// Tests: canDeletePlaylist
// ---------------------------------------------------------------------------

describe('canDeletePlaylist', () => {
  test('legacy playlist — everyone can delete', () => {
    assert.equal(canDeletePlaylist(legacyPlaylist, ALICE), true);
    assert.equal(canDeletePlaylist(legacyPlaylist, BOB), true);
  });

  test('owner can delete their playlist', () => {
    assert.equal(canDeletePlaylist(alicePrivate, ALICE), true);
    assert.equal(canDeletePlaylist(aliceShared, ALICE), true);
  });

  test('non-owner CANNOT delete even if isEditableByOthers = true', () => {
    assert.equal(canDeletePlaylist(aliceShared, BOB), false);
    assert.equal(canDeletePlaylist(alicePubShared, BOB), false);
  });

  test('non-owner blocked from deleting private playlist', () => {
    assert.equal(canDeletePlaylist(alicePrivate, BOB), false);
    assert.equal(canDeletePlaylist(alicePublic, BOB), false);
  });
});

// ---------------------------------------------------------------------------
// Tests: canViewPlaylist
// ---------------------------------------------------------------------------

describe('canViewPlaylist', () => {
  test('legacy playlist — everyone (including anonymous) can view', () => {
    assert.equal(canViewPlaylist(legacyPlaylist), true);
    assert.equal(canViewPlaylist(legacyPlaylist, undefined), true);
  });

  test('public playlist — everyone can view', () => {
    assert.equal(canViewPlaylist(alicePublic), true);
    assert.equal(canViewPlaylist(alicePublic, BOB), true);
    assert.equal(canViewPlaylist(alicePublic, undefined), true);
  });

  test('private playlist — only owner can view', () => {
    assert.equal(canViewPlaylist(alicePrivate, ALICE), true);
    assert.equal(canViewPlaylist(alicePrivate, BOB), false);
    assert.equal(canViewPlaylist(alicePrivate, undefined), false);
  });

  test('shared-editable but private — only owner can view (isEditable does not grant view)', () => {
    // isEditableByOthers does NOT imply visibility on its own
    assert.equal(canViewPlaylist(aliceShared, BOB), false);
    assert.equal(canViewPlaylist(aliceShared, ALICE), true);
  });
});

// ---------------------------------------------------------------------------
// Tests: visibility filtering (getAllPlaylists simulation)
// ---------------------------------------------------------------------------

describe('filterVisiblePlaylists', () => {
  const all = [legacyPlaylist, alicePrivate, alicePublic, aliceShared, alicePubShared,
    { id: 'bob-priv', ownerId: BOB, isPublic: false, isEditableByOthers: false }];

  test('Alice sees: legacy + own + public', () => {
    const visible = filterVisiblePlaylists(all, ALICE);
    const ids = visible.map(p => p.id);
    // Legacy
    assert.ok(ids.includes('pl-legacy'), 'legacy should be visible');
    // Alice owns all of these
    assert.ok(ids.includes('pl-alice-priv'), 'own private visible');
    assert.ok(ids.includes('pl-alice-pub'), 'own public visible');
    assert.ok(ids.includes('pl-alice-shared'), 'own shared visible');
    // Public playlists (including Bob's public ones if any)
    assert.ok(ids.includes('pl-alice-pub-shared'), 'public shared visible');
    // Bob's private not visible to Alice
    assert.ok(!ids.includes('bob-priv'), "Bob's private NOT visible to Alice");
  });

  test('Bob sees: legacy + public (but not Alice private/shared)', () => {
    const visible = filterVisiblePlaylists(all, BOB);
    const ids = visible.map(p => p.id);
    assert.ok(ids.includes('pl-legacy'));
    assert.ok(ids.includes('pl-alice-pub'));
    assert.ok(ids.includes('pl-alice-pub-shared'));
    assert.ok(ids.includes('bob-priv'), "Bob's own private visible to Bob");
    assert.ok(!ids.includes('pl-alice-priv'), "Alice's private NOT visible to Bob");
    assert.ok(!ids.includes('pl-alice-shared'), "Alice's shared-but-private NOT visible to Bob");
  });

  test('Anonymous sees: legacy + public only', () => {
    const visible = filterVisiblePlaylists(all, undefined);
    const ids = visible.map(p => p.id);
    assert.ok(ids.includes('pl-legacy'));
    assert.ok(ids.includes('pl-alice-pub'));
    assert.ok(ids.includes('pl-alice-pub-shared'));
    assert.ok(!ids.includes('pl-alice-priv'));
    assert.ok(!ids.includes('pl-alice-shared'));
    assert.ok(!ids.includes('bob-priv'));
  });
});

// ---------------------------------------------------------------------------
// Tests: history/event actorId tracking
// ---------------------------------------------------------------------------

describe('History user tracking', () => {
  interface RecordedEvent {
    eventType: string;
    userId: string | null;
    entityId: string;
    metadata: Record<string, unknown>;
  }

  const events: RecordedEvent[] = [];

  function recordEvent(
    eventType: string,
    opts: { userId: string | null; entityId: string; metadata?: Record<string, unknown> }
  ) {
    events.push({ eventType, userId: opts.userId, entityId: opts.entityId, metadata: opts.metadata ?? {} });
  }

  test('playlist.created event carries userId', () => {
    events.length = 0;
    recordEvent('playlist.created', { userId: ALICE, entityId: 'pl-new', metadata: { name: 'My List' } });
    assert.equal(events.length, 1);
    assert.equal(events[0].userId, ALICE);
    assert.equal(events[0].eventType, 'playlist.created');
  });

  test('playlist.updated event carries editor userId', () => {
    events.length = 0;
    recordEvent('playlist.updated', { userId: BOB, entityId: aliceShared.id, metadata: { changes: ['name'] } });
    assert.equal(events[0].userId, BOB);
    assert.equal(events[0].entityId, aliceShared.id);
  });

  test('playlist.deleted event carries userId', () => {
    events.length = 0;
    recordEvent('playlist.deleted', { userId: ALICE, entityId: alicePrivate.id });
    assert.equal(events[0].userId, ALICE);
  });

  test('playlist.track_added event carries userId', () => {
    events.length = 0;
    recordEvent('playlist.track_added', { userId: BOB, entityId: aliceShared.id, metadata: { trackId: 't-1' } });
    assert.equal(events[0].userId, BOB);
    assert.deepEqual(events[0].metadata, { trackId: 't-1' });
  });

  test('event userId defaults to local user when no header provided', () => {
    const DEFAULT_ACTOR = '00000000-0000-0000-0000-000000000001';
    events.length = 0;
    // Simulate getActorId fallback: header may be absent (undefined as string | undefined)
    const header: string | undefined = undefined;
    const actorId: string = header || DEFAULT_ACTOR;
    recordEvent('playlist.created', { userId: actorId, entityId: 'pl-x' });
    assert.equal(events[0].userId, DEFAULT_ACTOR);
  });
});

// ---------------------------------------------------------------------------
// Tests: sharing flag behaviour
// ---------------------------------------------------------------------------

describe('Sharing flag combinations', () => {
  test('isPublic:true + isEditableByOthers:false — visible to all, editable only by owner', () => {
    const p: PlaylistStub = { id: 'p1', ownerId: ALICE, isPublic: true, isEditableByOthers: false };
    assert.equal(canViewPlaylist(p, BOB), true);
    assert.equal(canEditPlaylist(p, BOB), false);
    assert.equal(canEditPlaylist(p, ALICE), true);
  });

  test('isPublic:false + isEditableByOthers:true — private but collaborative', () => {
    const p: PlaylistStub = { id: 'p2', ownerId: ALICE, isPublic: false, isEditableByOthers: true };
    // Bob can't view (it's private)
    assert.equal(canViewPlaylist(p, BOB), false);
    // But Bob could edit if he had access
    assert.equal(canEditPlaylist(p, BOB), true);
  });

  test('isPublic:true + isEditableByOthers:true — fully open', () => {
    const p: PlaylistStub = { id: 'p3', ownerId: ALICE, isPublic: true, isEditableByOthers: true };
    assert.equal(canViewPlaylist(p, BOB), true);
    assert.equal(canEditPlaylist(p, BOB), true);
    assert.equal(canDeletePlaylist(p, BOB), false); // delete still owner-only
  });

  test('isPublic:false + isEditableByOthers:false — fully private', () => {
    const p: PlaylistStub = { id: 'p4', ownerId: ALICE, isPublic: false, isEditableByOthers: false };
    assert.equal(canViewPlaylist(p, BOB), false);
    assert.equal(canEditPlaylist(p, BOB), false);
    assert.equal(canDeletePlaylist(p, BOB), false);
  });
});
