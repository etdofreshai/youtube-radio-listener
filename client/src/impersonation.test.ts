/**
 * Tests for the impersonation feature.
 *
 * Uses Node's built-in test runner (no DOM required).
 * Covers:
 *   1. Impersonation session state machine (set/get/clear)
 *   2. getEffectiveUserId returns impersonated ID when active
 *   3. Permission checks (admin-only guard)
 *   4. Banner display logic (show/hide)
 *   5. Exit impersonation flow
 */

import assert from 'node:assert/strict';
import { test, describe, beforeEach } from 'node:test';

// ---------------------------------------------------------------------------
// Shim sessionStorage and localStorage for Node
// ---------------------------------------------------------------------------
function createStorageMock(): Storage & { _store: Record<string, string> } {
  const _store: Record<string, string> = {};
  return {
    _store,
    getItem: (key: string) => _store[key] ?? null,
    setItem: (key: string, value: string) => { _store[key] = value; },
    removeItem: (key: string) => { delete _store[key]; },
    clear: () => { for (const k in _store) delete _store[k]; },
    get length() { return Object.keys(_store).length; },
    key: (index: number) => Object.keys(_store)[index] ?? null,
  };
}

const sessionStorageMock = createStorageMock();
const localStorageMock = createStorageMock();

// @ts-ignore
globalThis.sessionStorage = sessionStorageMock;
// @ts-ignore
globalThis.localStorage = localStorageMock;

// ---------------------------------------------------------------------------
// Import after shimming globals
// ---------------------------------------------------------------------------
import {
  getActiveUserId,
  setActiveUserId,
  getEffectiveUserId,
  getImpersonatedUserId,
  getOriginalUserId,
  setImpersonation,
  clearImpersonation,
  IMPERSONATION_USER_KEY,
  IMPERSONATION_ORIGINAL_KEY,
} from './utils/userAccess.js';

// ---------------------------------------------------------------------------
// 1. Impersonation session state machine
// ---------------------------------------------------------------------------

describe('Impersonation session state machine', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    localStorageMock.clear();
  });

  test('initially no impersonation is active', () => {
    assert.equal(getImpersonatedUserId(), null);
    assert.equal(getOriginalUserId(), null);
  });

  test('setImpersonation stores both original and impersonated IDs', () => {
    setImpersonation('admin-001', 'user-123');
    assert.equal(getImpersonatedUserId(), 'user-123');
    assert.equal(getOriginalUserId(), 'admin-001');
    assert.equal(sessionStorageMock.getItem(IMPERSONATION_USER_KEY), 'user-123');
    assert.equal(sessionStorageMock.getItem(IMPERSONATION_ORIGINAL_KEY), 'admin-001');
  });

  test('clearImpersonation removes both keys', () => {
    setImpersonation('admin-001', 'user-123');
    clearImpersonation();
    assert.equal(getImpersonatedUserId(), null);
    assert.equal(getOriginalUserId(), null);
    assert.equal(sessionStorageMock.getItem(IMPERSONATION_USER_KEY), null);
    assert.equal(sessionStorageMock.getItem(IMPERSONATION_ORIGINAL_KEY), null);
  });

  test('impersonation survives within same session (simulated reload)', () => {
    setImpersonation('admin-001', 'user-456');
    // Simulate reading values fresh (like after page refresh in same tab)
    assert.equal(getImpersonatedUserId(), 'user-456');
    assert.equal(getOriginalUserId(), 'admin-001');
  });

  test('switching impersonation targets replaces the previous', () => {
    setImpersonation('admin-001', 'user-123');
    setImpersonation('admin-001', 'user-789');
    assert.equal(getImpersonatedUserId(), 'user-789');
    assert.equal(getOriginalUserId(), 'admin-001');
  });
});

// ---------------------------------------------------------------------------
// 2. getEffectiveUserId returns impersonated ID when active
// ---------------------------------------------------------------------------

describe('getEffectiveUserId', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    localStorageMock.clear();
  });

  test('returns active user ID when not impersonating', () => {
    setActiveUserId('admin-001');
    assert.equal(getEffectiveUserId(), 'admin-001');
  });

  test('returns impersonated user ID when impersonating', () => {
    setActiveUserId('admin-001');
    setImpersonation('admin-001', 'user-123');
    assert.equal(getEffectiveUserId(), 'user-123');
  });

  test('returns active user ID after clearing impersonation', () => {
    setActiveUserId('admin-001');
    setImpersonation('admin-001', 'user-123');
    clearImpersonation();
    assert.equal(getEffectiveUserId(), 'admin-001');
  });

  test('returns null when no user and no impersonation', () => {
    assert.equal(getEffectiveUserId(), null);
  });
});

// ---------------------------------------------------------------------------
// 3. Permission checks (admin-only access)
// ---------------------------------------------------------------------------

describe('Permission checks for impersonation', () => {
  interface MockUser {
    id: string;
    role: string;
    username: string;
    displayName: string | null;
  }

  /** Simulates the canImpersonate logic from UsersPage */
  function canImpersonate(
    currentUser: MockUser | null,
    targetUser: MockUser,
    isImpersonating: boolean,
    originalUserId: string | null,
  ): boolean {
    if (!currentUser) return false;
    if (currentUser.role !== 'admin') return false;
    const realUserId = isImpersonating ? originalUserId : currentUser.id;
    if (targetUser.id === realUserId) return false;
    if (targetUser.role === 'admin') return false;
    return true;
  }

  const admin: MockUser = { id: 'admin-001', role: 'admin', username: 'etdofresh', displayName: 'ET' };
  const user1: MockUser = { id: 'user-123', role: 'user', username: 'alice', displayName: 'Alice' };
  const user2: MockUser = { id: 'user-456', role: 'user', username: 'bob', displayName: 'Bob' };
  const admin2: MockUser = { id: 'admin-002', role: 'admin', username: 'admin2', displayName: 'Admin 2' };

  test('admin can impersonate a regular user', () => {
    assert.equal(canImpersonate(admin, user1, false, null), true);
  });

  test('admin cannot impersonate themselves', () => {
    assert.equal(canImpersonate(admin, admin, false, null), false);
  });

  test('admin cannot impersonate another admin', () => {
    assert.equal(canImpersonate(admin, admin2, false, null), false);
  });

  test('regular user cannot impersonate anyone', () => {
    assert.equal(canImpersonate(user1, user2, false, null), false);
  });

  test('null current user cannot impersonate', () => {
    assert.equal(canImpersonate(null, user1, false, null), false);
  });

  test('admin cannot impersonate self even while already impersonating', () => {
    // When impersonating, realUserId is the original admin ID
    assert.equal(canImpersonate(admin, admin, true, 'admin-001'), false);
  });

  test('admin can impersonate a different user while already impersonating someone', () => {
    // While impersonating user1, can switch to user2
    assert.equal(canImpersonate(admin, user2, true, 'admin-001'), true);
  });
});

// ---------------------------------------------------------------------------
// 4. Banner display logic
// ---------------------------------------------------------------------------

describe('Banner display logic', () => {
  /** Simulates the ImpersonationBanner show/hide logic */
  function shouldShowBanner(
    isImpersonating: boolean,
    impersonatedUser: { displayName: string | null; username: string } | null,
  ): boolean {
    return isImpersonating && impersonatedUser !== null;
  }

  test('banner hidden when not impersonating', () => {
    assert.equal(shouldShowBanner(false, null), false);
  });

  test('banner hidden when impersonating flag set but no user object', () => {
    assert.equal(shouldShowBanner(true, null), false);
  });

  test('banner shown when impersonating with valid user', () => {
    assert.equal(
      shouldShowBanner(true, { displayName: 'Alice', username: 'alice' }),
      true,
    );
  });

  test('banner text uses displayName when available', () => {
    const user = { displayName: 'Alice', username: 'alice' };
    const name = user.displayName ?? user.username;
    assert.equal(name, 'Alice');
  });

  test('banner text falls back to username when no displayName', () => {
    const user = { displayName: null, username: 'bob' };
    const name = user.displayName ?? user.username;
    assert.equal(name, 'bob');
  });
});

// ---------------------------------------------------------------------------
// 5. Exit impersonation flow
// ---------------------------------------------------------------------------

describe('Exit impersonation flow', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    localStorageMock.clear();
  });

  test('full flow: start -> verify -> exit -> verify cleared', () => {
    // 1. Set active admin user
    setActiveUserId('admin-001');
    assert.equal(getEffectiveUserId(), 'admin-001');

    // 2. Start impersonation
    setImpersonation('admin-001', 'user-123');
    assert.equal(getEffectiveUserId(), 'user-123');
    assert.equal(getImpersonatedUserId(), 'user-123');
    assert.equal(getOriginalUserId(), 'admin-001');

    // 3. Exit impersonation
    clearImpersonation();
    assert.equal(getEffectiveUserId(), 'admin-001');
    assert.equal(getImpersonatedUserId(), null);
    assert.equal(getOriginalUserId(), null);
  });

  test('exit preserves the original active user ID in localStorage', () => {
    setActiveUserId('admin-001');
    setImpersonation('admin-001', 'user-123');
    clearImpersonation();
    // localStorage (active user) should be untouched
    assert.equal(getActiveUserId(), 'admin-001');
  });
});
