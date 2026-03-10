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

  // Imperatively sync session from global state — call this right after login or logout
  // to avoid the 1-second polling gap that causes AdminGuard to see a stale session.
  const notifySessionChanged = useCallback(() => {
    const current = getSupabaseSession();
    console.log('[AuthProvider] notifySessionChanged — hasSession=' + !!(current?.access_token));
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
      console.log('[AuthProvider] Initializing session...');

      if (!isSupabaseConfigured()) {
        console.log('[AuthProvider] Supabase not configured, skipping session init');
        if (mounted) setLoading(false);
        return;
      }

      try {
        // Load session from SecureStore
        await loadSessionFromStorage();

        // Get the loaded session
        const storedSession = getSupabaseSession();

        if (mounted) {
          if (storedSession) {
            const nowSeconds = Math.floor(Date.now() / 1000);
            const isHardExpired = storedSession.expires_at > 0 && nowSeconds >= storedSession.expires_at;

            if (isHardExpired) {
              // Token is expired — attempt a refresh before treating user as logged in.
              // IMPORTANT: If refresh fails (e.g. network timeout on TestFlight cold start),
              // do NOT wipe SecureStore. Keep the session in memory so the user remains
              // logged in. Individual API calls will retry the refresh. Only a deliberate
              // sign-out or a server-side 401 should clear the session.
              console.log('[AuthProvider] Stored session is expired, attempting refresh...');
              const refreshed = await refreshSupabaseSession();
              if (refreshed) {
                const freshSession = getSupabaseSession();
                console.log('[AuthProvider] Session refreshed on launch');
                setSession(freshSession);
                startAutoRefresh();
              } else {
                // Refresh failed (likely a transient network issue on cold start).
                // Keep the expired session in memory and SecureStore — do NOT clear it.
                // The user stays logged in; getValidAuthKey will retry refresh on the
                // next authenticated action.
                console.log('[AuthProvider] Refresh failed on launch (transient) — keeping session, will retry on next action');
                setSession(storedSession);
                startAutoRefresh();
              }
            } else {
              console.log('[AuthProvider] Session loaded from storage, valid');
              setSession(storedSession);
              // Start auto-refresh for token maintenance
              startAutoRefresh();
            }
          } else {
            console.log('[AuthProvider] No stored session found');
            setSession(null);
          }
          setLoading(false);
        }
      } catch (err) {
        console.log('[AuthProvider] Error loading session:', err instanceof Error ? err.message : 'Unknown');
        if (mounted) {
          setSession(null);
          setLoading(false);
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
        console.log('[AuthProvider] Session state changed, updating...');
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
    refreshSession,
    clearSession,
    notifySessionChanged,
  }), [session, user, loading, refreshSession, clearSession, notifySessionChanged]);

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
