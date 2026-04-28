/**
 * AuthProvider - Global Supabase session state management
 *
 * This provider ensures the Supabase session is properly hydrated on app start
 * and keeps track of auth state changes throughout the app lifecycle.
 *
 * IMPORTANT: This fixes the TestFlight "Please sign in to continue" issue where
 * the session was not being restored in production builds.
 *
 * Usage:
 * 1. Wrap your app with <AuthProvider> in _layout.tsx
 * 2. Use const { session, user, loading } = useAuth() in components
 * 3. Before authenticated actions, check: if (!session) { show error; return; }
 */

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  loadSessionFromStorage,
  getSupabaseSession,
  setSupabaseSession,
  refreshSupabaseSession,
  startAutoRefresh,
  stopAutoRefresh,
  isSupabaseConfigured,
} from '../lib/supabase';
import { AppState, type AppStateStatus } from 'react-native';

// ---------------------------------------------------------------------------
// Module-level session-change notifier
// Allows non-React code (e.g. user-store signOut) to push an immediate update
// to AuthProvider without going through a hook or polling delay.
// ---------------------------------------------------------------------------
let _notifySessionChangedFn: (() => void) | null = null;

/** Call this from anywhere (stores, utilities) right after writing or clearing
 *  the Supabase session so AuthProvider re-syncs without waiting for the poll. */
export function notifyAuthSessionChanged(): void {
  _notifySessionChangedFn?.();
}

// Session type matching our Supabase REST client
interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}

// User info extracted from session token (JWT payload)
interface AuthUser {
  id: string;
  email?: string;
}

interface AuthContextType {
  session: SupabaseSession | null;
  user: AuthUser | null;
  loading: boolean;
  /**
   * True only after the full initial session hydration is complete
   * (SecureStore read + any token refresh on launch).
   * AdminGuard should wait for this before validating the session.
   */
  sessionReady: boolean;
  // Methods for components to manually refresh or clear session
  refreshSession: () => Promise<boolean>;
  clearSession: () => void;
  /** Call this immediately after writing a new session (login) or clearing one (logout)
   *  so the context updates synchronously instead of waiting for the 1-second poll. */
  notifySessionChanged: () => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  sessionReady: false,
  refreshSession: async () => false,
  clearSession: () => {},
  notifySessionChanged: () => {},
});

/**
 * Decode JWT payload to extract user info
 * Note: This is a simple decode, not verification (Supabase handles verification)
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Base64Url decode the payload
    const payload = parts[1];
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Extract user info from session
 */
function getUserFromSession(session: SupabaseSession | null): AuthUser | null {
  if (!session?.access_token) return null;

  const payload = decodeJwtPayload(session.access_token);
  if (!payload) return null;

  return {
    id: payload.sub as string,
    email: payload.email as string | undefined,
  };
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<SupabaseSession | null>(null);
  const [loading, setLoading] = useState(true);
  // sessionReady becomes true only after the full initial hydration is complete.
  // This is a stricter signal than `loading === false` for consumers like AdminGuard.
  const [sessionReady, setSessionReady] = useState(false);

  // Imperatively sync session from global state — call this right after login or logout
  // to avoid the 1-second polling gap that causes AdminGuard to see a stale session.
  const notifySessionChanged = useCallback(() => {
    const current = getSupabaseSession();
    console.log('[AUTH_DEBUG][AuthProvider] notifySessionChanged — hasSession=' + !!(current?.access_token)
      + ', email=' + (current ? '(will decode from JWT)' : 'none'));
    setSession(current);
  }, []);

  // Register the module-level notifier so non-React code (e.g. user-store) can trigger it.
  useEffect(() => {
    _notifySessionChangedFn = notifySessionChanged;
    return () => { _notifySessionChangedFn = null; };
  }, [notifySessionChanged]);

  // Initialize session from SecureStore on mount
  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      const t0 = Date.now();
      console.log('[AUTH_DEBUG][AuthProvider] ── initSession START ──');
      console.log('[AUTH_DEBUG][AuthProvider] initial state: authLoading=true, sessionReady=false, session=null');

      if (!isSupabaseConfigured()) {
        console.log('[AUTH_DEBUG][AuthProvider] Supabase NOT configured — skipping session init');
        if (mounted) { setLoading(false); setSessionReady(true); }
        return;
      }

      try {
        // Load session from SecureStore
        console.log('[AUTH_DEBUG][AuthProvider] calling loadSessionFromStorage...');
        await loadSessionFromStorage();
        console.log('[AUTH_DEBUG][AuthProvider] loadSessionFromStorage done (' + (Date.now() - t0) + 'ms)');

        // Get the loaded session
        const storedSession = getSupabaseSession();
        console.log('[AUTH_DEBUG][AuthProvider] getSupabaseSession() after load:'
          + ' hasSession=' + !!(storedSession?.access_token)
          + ', expires_at=' + (storedSession?.expires_at ?? 'N/A')
          + ', refresh_token exists=' + !!(storedSession?.refresh_token));

        if (mounted) {
          if (storedSession) {
            const nowSeconds = Math.floor(Date.now() / 1000);
            const isHardExpired = storedSession.expires_at > 0 && nowSeconds >= storedSession.expires_at;
            console.log('[AUTH_DEBUG][AuthProvider] storedSession isHardExpired=' + isHardExpired
              + ', expires_at=' + storedSession.expires_at
              + ', nowSeconds=' + nowSeconds
              + ', delta=' + (storedSession.expires_at - nowSeconds) + 's');

            if (isHardExpired) {
              console.log('[AUTH_DEBUG][AuthProvider] Token expired — attempting refresh...');
              const refreshed = await refreshSupabaseSession();
              // CRITICAL: always read the live in-memory state AFTER the refresh attempt.
              // If invalid_grant fired, refreshSupabaseSession() already set currentSession = null
              // AND cleared SecureStore. We must NOT set React state back to storedSession here —
              // that would create a divergence where authUser exists but getValidSession() returns null.
              const sessionAfterRefresh = getSupabaseSession();
              console.log('[AUTH_DEBUG][AuthProvider] refresh result=' + refreshed
                + ', in-memory session after refresh: hasSession=' + !!(sessionAfterRefresh?.access_token)
                + ' (' + (Date.now() - t0) + 'ms)');

              if (sessionAfterRefresh?.access_token) {
                // Refresh succeeded OR was a transient failure (in-memory session still intact)
                console.log('[AUTH_DEBUG][AuthProvider] BRANCH: post-refresh session exists → setSession(sessionAfterRefresh)');
                setSession(sessionAfterRefresh);
                startAutoRefresh();
              } else {
                // In-memory session is null: invalid_grant cleared it.
                // Force React state to null so authUser is also null — no half-logged-in state.
                console.log('[AUTH_DEBUG][AuthProvider] BRANCH: in-memory session NULL after refresh'
                  + ' (likely invalid_grant) → setSession(null), user must re-login');
                setSession(null);
                // Do NOT call startAutoRefresh — nothing to refresh
              }
            } else {
              console.log('[AUTH_DEBUG][AuthProvider] BRANCH: token valid — setSession(storedSession)');
              setSession(storedSession);
              startAutoRefresh();
            }
          } else {
            console.log('[AUTH_DEBUG][AuthProvider] BRANCH: no stored session → setSession(null)');
            setSession(null);
          }

          // All three setters batched in one synchronous block — React 18 will commit them together.
          console.log('[AUTH_DEBUG][AuthProvider] About to commit: setLoading(false) + setSessionReady(true)');
          setLoading(false);
          setSessionReady(true);
          console.log('[AUTH_DEBUG][AuthProvider] ── initSession END (' + (Date.now() - t0) + 'ms) ──');
          console.log('[AUTH_DEBUG][AuthProvider] After commit: authLoading=false, sessionReady=true');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log('[AUTH_DEBUG][AuthProvider] EXCEPTION in initSession: ' + msg);
        if (mounted) {
          setSession(null);
          setLoading(false);
          setSessionReady(true);
          console.log('[AUTH_DEBUG][AuthProvider] Exception path: session=null, authLoading=false, sessionReady=true');
        }
      }
    };

    initSession();

    return () => {
      mounted = false;
    };
  }, []);

  // Listen for app state changes to manage auto-refresh
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App became active - refresh session and restart auto-refresh
        console.log('[AuthProvider] App active - syncing session');
        const currentSession = getSupabaseSession();
        setSession(currentSession);
        if (currentSession) {
          startAutoRefresh();
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        // App went to background - stop auto-refresh to save battery
        stopAutoRefresh();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Sync local state when the global session changes (e.g., after sign in/out)
  // This polls the global session state to catch external changes
  useEffect(() => {
    const interval = setInterval(() => {
      const currentSession = getSupabaseSession();
      // Only update if session changed
      if (JSON.stringify(currentSession) !== JSON.stringify(session)) {
        console.log('[AUTH_DEBUG][AuthProvider] Poll detected session change:'
          + ' prev hasSession=' + !!(session?.access_token)
          + ' → new hasSession=' + !!(currentSession?.access_token));
        setSession(currentSession);
      }
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, [session]);

  // Manual refresh method for components
  const refreshSession = useCallback(async (): Promise<boolean> => {
    console.log('[AuthProvider] Manual refresh requested');
    const success = await refreshSupabaseSession();
    if (success) {
      const newSession = getSupabaseSession();
      setSession(newSession);
    }
    return success;
  }, []);

  // Clear session method
  const clearSession = useCallback(() => {
    console.log('[AuthProvider] Clearing session');
    void setSupabaseSession(null);
    setSession(null);
    stopAutoRefresh();
  }, []);

  // Derive user from session
  const user = useMemo(() => getUserFromSession(session), [session]);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<AuthContextType>(() => ({
    session,
    user,
    loading,
    sessionReady,
    refreshSession,
    clearSession,
    notifySessionChanged,
  }), [session, user, loading, sessionReady, refreshSession, clearSession, notifySessionChanged]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth state
 *
 * Usage:
 * const { session, user, loading } = useAuth();
 *
 * if (loading) return <LoadingSpinner />;
 * if (!session) return <LoginPrompt />;
 */
export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}

/**
 * Hook to ensure session is ready before performing authenticated actions
 * Returns the session if available, null otherwise
 *
 * Usage:
 * const session = useAuthSession();
 * if (!session) {
 *   showToast('Please sign in to continue', 'error');
 *   return;
 * }
 */
export function useAuthSession(): SupabaseSession | null {
  const { session, loading } = useAuth();

  // If still loading, return null to prevent premature actions
  if (loading) return null;

  return session;
}
