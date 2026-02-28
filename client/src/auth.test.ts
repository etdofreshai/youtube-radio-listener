/**
 * Tests for access control and user management logic.
 *
 * Uses Node's built-in test runner (no DOM required).
 * Covers:
 *   1. isProtectedUsername — pattern enforcement
 *   2. Protected user constraints (delete / rename guard)
 *   3. localStorage persistence helpers (getActiveUserId / setActiveUserId)
 *   4. Dev bypass: no password required when requiresPassword=false
 *   5. Impersonation — session-scoped user switching
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
// Shim sessionStorage for Node (not available in plain Node test runner)
// ---------------------------------------------------------------------------
const sessionStore: Record<string, string> = {};
const sessionStorageMock = {
  getItem: (key: string) => sessionStore[key] ?? null,
  setItem: (key: string, value: string) => { sessionStore[key] = value; },
  removeItem: (key: string) => { delete sessionStore[key]; },
  clear: () => { for (const k in sessionStore) delete sessionStore[k]; },
};
// @ts-ignore
globalThis.sessionStorage = sessionStorageMock;

// ---------------------------------------------------------------------------
// Import the modules under test AFTER shimming globals
// ---------------------------------------------------------------------------
import {
  isProtectedUsername,
  PROTECTED_USERNAME_PATTERN,
  getActiveUserId,
  setActiveUserId,
  LOCAL_STORAGE_USER_KEY,
  getEffectiveUserId,
  getImpersonatedUserId,
  getOriginalUserId,
  setImpersonation,
  clearImpersonation,
  IMPERSONATION_USER_KEY,
  IMPERSONATION_ORIGINAL_KEY,
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

// ---------------------------------------------------------------------------
// 5. Impersonation — session-scoped user switching
// ---------------------------------------------------------------------------

describe('Impersonation', () => {
  before(() => {
    localStorageMock.clear();
    sessionStorageMock.clear();
  });
  after(() => {
    localStorageMock.clear();
    sessionStorageMock.clear();
  });

  describe('setImpersonation / getImpersonatedUserId / getOriginalUserId', () => {
    before(() => sessionStorageMock.clear());
    after(() => sessionStorageMock.clear());

    test('returns null when no impersonation is active', () => {
      assert.equal(getImpersonatedUserId(), null);
      assert.equal(getOriginalUserId(), null);
    });

    test('stores impersonated and original user IDs in sessionStorage', () => {
      setImpersonation('admin-001', 'user-002');
      assert.equal(getImpersonatedUserId(), 'user-002');
      assert.equal(getOriginalUserId(), 'admin-001');
      assert.equal(sessionStorageMock.getItem(IMPERSONATION_USER_KEY), 'user-002');
      assert.equal(sessionStorageMock.getItem(IMPERSONATION_ORIGINAL_KEY), 'admin-001');
    });

    test('clearImpersonation removes both keys', () => {
      setImpersonation('admin-001', 'user-002');
      clearImpersonation();
      assert.equal(getImpersonatedUserId(), null);
      assert.equal(getOriginalUserId(), null);
      assert.equal(sessionStorageMock.getItem(IMPERSONATION_USER_KEY), null);
      assert.equal(sessionStorageMock.getItem(IMPERSONATION_ORIGINAL_KEY), null);
    });
  });

  describe('getEffectiveUserId — header injection', () => {
    before(() => {
      localStorageMock.clear();
      sessionStorageMock.clear();
    });
    after(() => {
      localStorageMock.clear();
      sessionStorageMock.clear();
    });

    test('returns active user ID when not impersonating', () => {
      setActiveUserId('user-abc');
      assert.equal(getEffectiveUserId(), 'user-abc');
    });

    test('returns impersonated user ID when impersonating', () => {
      setActiveUserId('admin-001');
      setImpersonation('admin-001', 'user-xyz');
      assert.equal(getEffectiveUserId(), 'user-xyz');
    });

    test('returns active user ID after clearing impersonation', () => {
      setActiveUserId('admin-001');
      setImpersonation('admin-001', 'user-xyz');
      clearImpersonation();
      assert.equal(getEffectiveUserId(), 'admin-001');
    });
  });

  describe('Self-impersonate guard (UI logic)', () => {
    test('impersonate button should be disabled for self', () => {
      const currentUserId = 'admin-001';
      const targetUserId = 'admin-001';
      const isDisabled = targetUserId === currentUserId;
      assert.equal(isDisabled, true);
    });

    test('impersonate button should be enabled for other users', () => {
      const currentUserId = 'admin-001';
      const targetUserId = 'user-002';
      const isDisabled = targetUserId === currentUserId;
      assert.equal(isDisabled, false);
    });
  });

  describe('Session persistence', () => {
    before(() => sessionStorageMock.clear());
    after(() => sessionStorageMock.clear());

    test('impersonation state persists across reads (simulating page refresh)', () => {
      setImpersonation('admin-001', 'user-002');
      // "Fresh" reads — simulating component remount after refresh
      const freshImpersonated = getImpersonatedUserId();
      const freshOriginal = getOriginalUserId();
      assert.equal(freshImpersonated, 'user-002');
      assert.equal(freshOriginal, 'admin-001');
    });

    test('impersonation uses sessionStorage not localStorage', () => {
      setImpersonation('admin-001', 'user-002');
      assert.equal(sessionStorageMock.getItem(IMPERSONATION_USER_KEY), 'user-002');
      assert.equal(localStorageMock.getItem(IMPERSONATION_USER_KEY), null);
      assert.equal(localStorageMock.getItem(IMPERSONATION_ORIGINAL_KEY), null);
      sessionStorageMock.clear();
    });
  });
});
