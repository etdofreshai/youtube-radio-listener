/**
 * AuthContext — manages password gate state and active user identity.
 *
 * Password gate:
 *   - On load, checks /api/auth/status. If requiresPassword=false (no APP_PASSWORD set),
 *     gate is bypassed automatically (dev-friendly).
 *   - If requiresPassword=true, shows PasswordGate modal until a valid password is entered.
 *   - Verified state is stored in sessionStorage so refreshes within the same tab don't
 *     re-prompt (intentional UX — a full browser restart will re-prompt).
 *
 * User identity:
 *   - After password is accepted, user must select their identity from the user list.
 *   - Selection is persisted in localStorage (key: nightwave_user_id).
 *   - The X-User-Id header is attached to all API requests (see api.ts).
 *
 * Dev bypass:
 *   - Set APP_PASSWORD="" or omit it on the server side to skip the gate entirely.
 *   - The /api/auth/status endpoint returns { requiresPassword: false } in that case.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { User } from '../api';
import { getActiveUserId, setActiveUserId } from '../api';

const SESSION_KEY = 'nightwave_auth_verified';

export interface AuthState {
  /** True once the password gate has been passed (or bypassed in dev mode) */
  passwordVerified: boolean;
  /** True while the initial auth status check is in-flight */
  loading: boolean;
  /** True if the server requires a password (APP_PASSWORD is set) */
  requiresPassword: boolean;
  /** The currently selected user, or null if none selected yet */
  currentUser: User | null;
  /** Set the password-verified flag (called after successful /api/auth/verify) */
  setPasswordVerified: (v: boolean) => void;
  /** Select the active user; persists to localStorage */
  setCurrentUser: (user: User | null) => void;
  /** Clear user and password state (logout) */
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  passwordVerified: false,
  loading: true,
  requiresPassword: false,
  currentUser: null,
  setPasswordVerified: () => {},
  setCurrentUser: () => {},
  logout: () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [loading, setLoading] = useState(true);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [passwordVerified, setPasswordVerifiedState] = useState<boolean>(() => {
    // Restore from sessionStorage so same-tab refreshes don't re-prompt
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [currentUser, setCurrentUserState] = useState<User | null>(null);
  const [activeUserId] = useState<string | null>(getActiveUserId);

  // Impersonation state — restored from sessionStorage on mount
  const [impersonatedUserId, setImpersonatedUserIdState] = useState<string | null>(
    () => getImpersonatedUserId()
  );
  const [originalUserId, setOriginalUserIdState] = useState<string | null>(
    () => getOriginalUserId()
  );
  const [impersonatedUser, setImpersonatedUser] = useState<User | null>(null);

  // Fetch the impersonated user object when impersonatedUserId changes
  useEffect(() => {
    if (!impersonatedUserId) {
      setImpersonatedUser(null);
      return;
    }
    fetch(`/api/users/${impersonatedUserId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((user: User) => setImpersonatedUser(user))
      .catch(() => {
        // Invalid impersonated user — clear
        clearImpersonation();
        setImpersonatedUserIdState(null);
        setOriginalUserIdState(null);
        setImpersonatedUser(null);
      });
  }, [impersonatedUserId]);

  // On mount, check whether the server requires a password
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((data: { requiresPassword: boolean }) => {
        if (cancelled) return;
        setRequiresPassword(data.requiresPassword);
        if (!data.requiresPassword) {
          // No password configured — bypass gate automatically
          setPasswordVerifiedState(true);
          try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Can't reach server — show gate to prevent blind access
          setRequiresPassword(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Restore currentUser from the server when we know the active user ID
  useEffect(() => {
    if (!activeUserId) return;
    fetch(`/api/users/${activeUserId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found');
        return r.json();
      })
      .then((user: User) => setCurrentUserState(user))
      .catch(() => {
        // Stale ID — clear it
        setActiveUserId(null);
      });
  }, [activeUserId]);

  const setPasswordVerified = useCallback((v: boolean) => {
    setPasswordVerifiedState(v);
    try {
      if (v) {
        sessionStorage.setItem(SESSION_KEY, '1');
      } else {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const setCurrentUser = useCallback((user: User | null) => {
    setCurrentUserState(user);
    setActiveUserId(user?.id ?? null);
  }, []);

  const logout = useCallback(() => {
    setPasswordVerified(false);
    setCurrentUser(null);
    // Also clear impersonation on logout
    clearImpersonation();
    setImpersonatedUserIdState(null);
    setOriginalUserIdState(null);
    setImpersonatedUser(null);
  }, [setPasswordVerified, setCurrentUser]);

  const impersonateUser = useCallback((userId: string) => {
    if (!currentUser) return;
    // Store the original admin user ID and set the impersonated user
    const origId = originalUserId ?? currentUser.id;
    setImpersonation(origId, userId);
    setOriginalUserIdState(origId);
    setImpersonatedUserIdState(userId);
  }, [currentUser, originalUserId]);

  const returnToOriginalUser = useCallback(() => {
    clearImpersonation();
    setImpersonatedUserIdState(null);
    setOriginalUserIdState(null);
    setImpersonatedUser(null);
  }, []);

  const isImpersonating = impersonatedUserId !== null;

  return (
    <AuthContext.Provider
      value={{
        passwordVerified,
        loading,
        requiresPassword,
        currentUser,
        setPasswordVerified,
        setCurrentUser,
        logout,
        impersonatedUserId,
        impersonatedUser,
        originalUserId,
        impersonateUser,
        returnToOriginalUser,
        isImpersonating,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
