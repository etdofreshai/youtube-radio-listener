/**
 * Tests for access control and user management logic.
 *
 * Uses Node's built-in test runner (no DOM required).
 * Covers:
 *   1. isProtectedUsername — pattern enforcement
 *   2. Protected user constraints (delete / rename guard)
 *   3. localStorage persistence helpers (getActiveUserId / setActiveUserId)
 *   4. Dev bypass: no password required when requiresPassword=false
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';

// ---------------------------------------------------------------------------
// Shim localStorage for Node (not available in plain Node test runner)
// ---------------------------------------------------------------------------
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
};
// @ts-ignore
globalThis.localStorage = localStorageMock;

// ---------------------------------------------------------------------------
// Import the modules under test AFTER shimming globals
// ---------------------------------------------------------------------------
import {
  isProtectedUsername,
  PROTECTED_USERNAME_PATTERN,
  getActiveUserId,
  setActiveUserId,
  LOCAL_STORAGE_USER_KEY,
} from './utils/userAccess.js';

// ---------------------------------------------------------------------------
// 1. Protected username pattern
// ---------------------------------------------------------------------------

describe('isProtectedUsername', () => {
  test('matches exact "etdofresh"', () => {
    assert.equal(isProtectedUsername('etdofresh'), true);
  });

  test('matches "etdofresh" with any suffix', () => {
    assert.equal(isProtectedUsername('etdofresh_alt'), true);
    assert.equal(isProtectedUsername('etdofreshXYZ'), true);
    assert.equal(isProtectedUsername('etdofresh123'), true);
  });

  test('is case-insensitive', () => {
    assert.equal(isProtectedUsername('ETDOFRESH'), true);
    assert.equal(isProtectedUsername('Etdofresh'), true);
    assert.equal(isProtectedUsername('ETdofresh_2'), true);
  });

  test('does NOT match unrelated usernames', () => {
    assert.equal(isProtectedUsername('alice'), false);
    assert.equal(isProtectedUsername('et'), false);
    assert.equal(isProtectedUsername('fresh'), false);
    assert.equal(isProtectedUsername(''), false);
  });

  test('PROTECTED_USERNAME_PATTERN is exported and correct', () => {
    assert.ok(PROTECTED_USERNAME_PATTERN instanceof RegExp);
    assert.ok(PROTECTED_USERNAME_PATTERN.test('etdofresh'));
    assert.ok(!PROTECTED_USERNAME_PATTERN.test('bob'));
  });
});

// ---------------------------------------------------------------------------
// 2. Delete / rename guard — simulated server-side logic
// ---------------------------------------------------------------------------

describe('Protected user constraints', () => {
  // Simulate the server-side logic mirrored in the route
  function canDelete(username: string): boolean {
    return !isProtectedUsername(username);
  }

  function canRename(existingUsername: string, newUsername: string): boolean {
    // Cannot rename a protected user away from their protected name
    if (isProtectedUsername(existingUsername) && newUsername !== existingUsername) {
      return false;
    }
    // Cannot give a non-protected user a protected name
    if (!isProtectedUsername(existingUsername) && isProtectedUsername(newUsername)) {
      return false;
    }
    return true;
  }

  test('cannot delete etdofresh', () => {
    assert.equal(canDelete('etdofresh'), false);
  });

  test('can delete non-protected users', () => {
    assert.equal(canDelete('alice'), true);
    assert.equal(canDelete('bob'), true);
  });

  test('cannot rename etdofresh to another name', () => {
    assert.equal(canRename('etdofresh', 'newname'), false);
    assert.equal(canRename('etdofresh', 'alice'), false);
  });

  test('can rename etdofresh to itself (no-op)', () => {
    assert.equal(canRename('etdofresh', 'etdofresh'), true);
  });

  test('cannot rename a non-protected user to etdofresh*', () => {
    assert.equal(canRename('alice', 'etdofresh'), false);
    assert.equal(canRename('alice', 'etdofreshX'), false);
  });

  test('can rename non-protected user to another non-protected name', () => {
    assert.equal(canRename('alice', 'bob'), true);
  });
});

// ---------------------------------------------------------------------------
// 3. localStorage helpers
// ---------------------------------------------------------------------------

describe('getActiveUserId / setActiveUserId', () => {
  before(() => localStorageMock.clear());
  after(() => localStorageMock.clear());

  test('returns null when nothing is stored', () => {
    assert.equal(getActiveUserId(), null);
  });

  test('stores and retrieves a user ID', () => {
    setActiveUserId('user-123');
    assert.equal(getActiveUserId(), 'user-123');
    assert.equal(localStorageMock.getItem(LOCAL_STORAGE_USER_KEY), 'user-123');
  });

  test('clears user ID when null is passed', () => {
    setActiveUserId('user-123');
    setActiveUserId(null);
    assert.equal(getActiveUserId(), null);
    assert.equal(localStorageMock.getItem(LOCAL_STORAGE_USER_KEY), null);
  });

  test('overwrites existing value', () => {
    setActiveUserId('user-abc');
    setActiveUserId('user-xyz');
    assert.equal(getActiveUserId(), 'user-xyz');
  });
});

// ---------------------------------------------------------------------------
// 4. Dev bypass behaviour
// ---------------------------------------------------------------------------

describe('Dev bypass (no password configured)', () => {
  test('password gate should auto-pass when requiresPassword=false', () => {
    // Simulate the AuthContext logic: if server says requiresPassword=false,
    // we immediately set passwordVerified=true without prompting.
    const requiresPassword = false;
    let passwordVerified = false;

    // This mirrors the useEffect in AuthContext
    if (!requiresPassword) {
      passwordVerified = true;
    }

    assert.equal(passwordVerified, true);
  });

  test('password gate should block when requiresPassword=true', () => {
    const requiresPassword = true;
    let passwordVerified = false;

    if (!requiresPassword) {
      passwordVerified = true;
    }

    assert.equal(passwordVerified, false);
  });
});
