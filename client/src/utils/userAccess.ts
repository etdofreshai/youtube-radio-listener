/**
 * userAccess.ts — pure, testable helpers for user identity and access control.
 *
 * Deliberately has NO imports so it can run in both browser and Node test environments.
 * (No import.meta.env, no React, no fetch.)
 */

/** LocalStorage key for persisting the active user ID */
export const LOCAL_STORAGE_USER_KEY = 'nightwave_user_id';

/**
 * Username pattern for protected users.
 * Any username starting with 'etdofresh' (case-insensitive) is protected.
 * Protected users cannot be deleted or renamed via the API or UI.
 */
export const PROTECTED_USERNAME_PATTERN = /^etdofresh/i;

/** Returns true if the given username matches the protected pattern */
export function isProtectedUsername(username: string): boolean {
  return PROTECTED_USERNAME_PATTERN.test(username);
}

/** Read the active user ID from localStorage (returns null in non-browser envs) */
export function getActiveUserId(): string | null {
  try {
    return (
      (typeof localStorage !== 'undefined' &&
        localStorage.getItem(LOCAL_STORAGE_USER_KEY)) ||
      null
    );
  } catch {
    return null;
  }
}

/** Persist the active user ID to localStorage */
export function setActiveUserId(id: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (id) {
      localStorage.setItem(LOCAL_STORAGE_USER_KEY, id);
    } else {
      localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
    }
  } catch { /* ignore SSR / private-mode errors */ }
}
