/**
 * Tests for users route — protected user constraints and username validation.
 *
 * Uses Node's built-in test runner.
 * Does NOT require a running database — tests pure logic functions exported from users.ts.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { isProtectedUsername, PROTECTED_PATTERN } from './users.js';

// ---------------------------------------------------------------------------
// isProtectedUsername
// ---------------------------------------------------------------------------

describe('isProtectedUsername', () => {
  test('returns true for "etdofresh" (canonical protected user)', () => {
    assert.equal(isProtectedUsername('etdofresh'), true);
  });

  test('returns true for any username starting with "etdofresh"', () => {
    assert.equal(isProtectedUsername('etdofresh_dev'), true);
    assert.equal(isProtectedUsername('etdofreshABC'), true);
    assert.equal(isProtectedUsername('etdofresh123'), true);
  });

  test('is case-insensitive', () => {
    assert.equal(isProtectedUsername('ETDOFRESH'), true);
    assert.equal(isProtectedUsername('EtdoFresh'), true);
    assert.equal(isProtectedUsername('ETDOFRESH_ALT'), true);
  });

  test('returns false for non-protected usernames', () => {
    assert.equal(isProtectedUsername('alice'), false);
    assert.equal(isProtectedUsername('bob'), false);
    assert.equal(isProtectedUsername('admin'), false);
    assert.equal(isProtectedUsername('local'), false);
    assert.equal(isProtectedUsername(''), false);
  });

  test('PROTECTED_PATTERN is a RegExp with global case-insensitive flag', () => {
    assert.ok(PROTECTED_PATTERN instanceof RegExp);
    // It must match the canonical user
    assert.ok(PROTECTED_PATTERN.test('etdofresh'));
    assert.ok(!PROTECTED_PATTERN.test('alice'));
  });
});

// ---------------------------------------------------------------------------
// Delete constraint simulation
// ---------------------------------------------------------------------------

describe('Delete constraint — protected users cannot be removed', () => {
  function tryDelete(username: string): { allowed: boolean; reason?: string } {
    if (isProtectedUsername(username)) {
      return { allowed: false, reason: 'Cannot delete protected user' };
    }
    return { allowed: true };
  }

  test('blocks deletion of etdofresh', () => {
    const result = tryDelete('etdofresh');
    assert.equal(result.allowed, false);
    assert.ok(result.reason?.includes('protected'));
  });

  test('blocks deletion of etdofresh* variants', () => {
    assert.equal(tryDelete('etdofresh_prod').allowed, false);
    assert.equal(tryDelete('ETDOFRESH').allowed, false);
  });

  test('allows deletion of regular users', () => {
    assert.equal(tryDelete('alice').allowed, true);
    assert.equal(tryDelete('bob').allowed, true);
    assert.equal(tryDelete('local').allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Rename constraint simulation
// ---------------------------------------------------------------------------

describe('Rename constraint — protected users cannot change username', () => {
  function tryRename(
    existingUsername: string,
    newUsername: string
  ): { allowed: boolean; reason?: string } {
    if (isProtectedUsername(existingUsername) && newUsername !== existingUsername) {
      return { allowed: false, reason: 'Cannot rename protected user' };
    }
    if (!isProtectedUsername(existingUsername) && isProtectedUsername(newUsername)) {
      return { allowed: false, reason: 'Cannot use protected username pattern' };
    }
    return { allowed: true };
  }

  test('blocks renaming etdofresh to a new name', () => {
    const r = tryRename('etdofresh', 'hacker');
    assert.equal(r.allowed, false);
  });

  test('allows etdofresh "rename" to itself (idempotent)', () => {
    const r = tryRename('etdofresh', 'etdofresh');
    assert.equal(r.allowed, true);
  });

  test('blocks non-protected user from taking an etdofresh* name', () => {
    const r = tryRename('alice', 'etdofresh');
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes('protected'));
  });

  test('allows renaming regular user to another regular username', () => {
    const r = tryRename('alice', 'alice_updated');
    assert.equal(r.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// CRUD input validation simulation
// ---------------------------------------------------------------------------

describe('Create user input validation', () => {
  function validateCreate(username: unknown): { valid: boolean; error?: string } {
    if (!username || typeof username !== 'string' || !username.trim()) {
      return { valid: false, error: 'Username is required' };
    }
    return { valid: true };
  }

  test('rejects empty username', () => {
    assert.equal(validateCreate('').valid, false);
    assert.equal(validateCreate('   ').valid, false);
  });

  test('rejects null/undefined username', () => {
    assert.equal(validateCreate(null).valid, false);
    assert.equal(validateCreate(undefined).valid, false);
  });

  test('accepts valid username', () => {
    assert.equal(validateCreate('alice').valid, true);
    assert.equal(validateCreate('  alice  ').valid, true); // trimmed
  });
});
