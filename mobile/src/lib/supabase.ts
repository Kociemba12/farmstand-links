/**
 * Supabase REST Client
 * Uses fetch-based REST API instead of SDK to avoid native dependencies
 * Sessions are persisted securely using expo-secure-store
 *
 * Environment variables required in Vibecode ENV tab:
 * EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
 * EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
 */

import 'react-native-url-polyfill/auto';
import { AppState, type AppStateStatus } from 'react-native';
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Get Supabase credentials from environment variables
// Check both EXPO_PUBLIC_ prefixed and non-prefixed versions for flexibility
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  '';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

// Session storage key for SecureStore
const SESSION_STORAGE_KEY = 'supabase-session';

// In-memory cache of the session (loaded from SecureStore on init)
// expires_at is REQUIRED and stored as Unix timestamp in seconds
let currentSession: {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in seconds - REQUIRED
} | null = null;

// Flag to track if we've loaded the session from SecureStore
let sessionLoaded = false;

/**
 * Load session from SecureStore (call on app startup)
 * Handles legacy sessions that might not have expires_at.
 * ONE-TIME MIGRATION: if SecureStore is empty but AsyncStorage has a session,
 * copy it into SecureStore and delete the AsyncStorage key.
 */
export async function loadSessionFromStorage(): Promise<void> {
  if (sessionLoaded) return;

  try {
    let stored = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);

    // === ONE-TIME MIGRATION: AsyncStorage → SecureStore ===
    if (!stored) {
      try {
        const asyncRaw = await AsyncStorage.getItem('supabase_session');
        if (asyncRaw) {
          const asyncParsed = JSON.parse(asyncRaw) as { access_token?: string; refresh_token?: string; expires_at?: number };
          if (asyncParsed.access_token && asyncParsed.refresh_token) {
            console.log('[Supabase Auth] Migration: copying session from AsyncStorage → SecureStore');
            await SecureStore.setItemAsync(SESSION_STORAGE_KEY, asyncRaw);
            stored = asyncRaw;
          }
        }
        // Always delete the AsyncStorage key after migration attempt
        await AsyncStorage.removeItem('supabase_session');
        console.log('[Supabase Auth] Migration: AsyncStorage supabase_session key deleted');
      } catch (migErr) {
        console.log('[Supabase Auth] Migration error (non-fatal):', migErr instanceof Error ? migErr.message : String(migErr));
      }
    }
    // ======================================================

    // === BOOT: SESSION LOAD DIAGNOSTIC (TestFlight) ===
    console.log('[BOOT] === loadSessionFromStorage START ===');
    console.log('[BOOT] SecureStore key used:', SESSION_STORAGE_KEY);
    console.log('[BOOT] SecureStore raw exists:', stored !== null);
    console.log('[BOOT] SecureStore raw length:', stored ? stored.length : 0);
    // ===================================================

    if (stored) {
      const parsed = JSON.parse(stored);

      // Ensure we have the required fields
      if (parsed.access_token && parsed.refresh_token) {
        // Handle legacy sessions without expires_at - set to 0 to force refresh
        currentSession = {
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
          expires_at: parsed.expires_at && parsed.expires_at > 0 ? parsed.expires_at : 0,
        };

        const nowSeconds = Math.floor(Date.now() / 1000);
        const hasSession = true;
        const expiresAt = currentSession.expires_at;
        const hasRefreshToken = !!(parsed.refresh_token);
        console.log('[BOOT] loadSessionFromStorage result: hasSession=' + hasSession
          + ', expires_at=' + expiresAt
          + ', refresh_token exists=' + hasRefreshToken
          + ', seconds_until_expiry=' + (expiresAt > 0 ? expiresAt - nowSeconds : 'N/A (will refresh)'));
        console.log('[BOOT] set in-memory session OK');
        console.log('[BOOT] === loadSessionFromStorage END ===');
        console.log('[Supabase Auth] Session loaded from SecureStore, expires_at:', currentSession.expires_at,
          currentSession.expires_at > 0 ? `(in ${currentSession.expires_at - nowSeconds} seconds)` : '(missing - will refresh)');
      } else {
        console.log('[BOOT] loadSessionFromStorage result: hasSession=false, reason=missing_fields'
          + ', access_token exists=' + !!(parsed.access_token)
          + ', refresh_token exists=' + !!(parsed.refresh_token));
        console.log('[BOOT] === loadSessionFromStorage END ===');
        console.log('[Supabase Auth] Stored session missing required fields, ignoring');
        currentSession = null;
      }
    } else {
      console.log('[BOOT] loadSessionFromStorage result: hasSession=false, reason=no_data_in_SecureStore');
      console.log('[BOOT] ACTION REQUIRED: User must sign in — no session in SecureStore key=' + SESSION_STORAGE_KEY);
      console.log('[BOOT] === loadSessionFromStorage END ===');
      console.log('[Supabase Auth] No stored session found');
    }
  } catch (err) {
    console.log('[BOOT] loadSessionFromStorage EXCEPTION:', err instanceof Error ? err.message : String(err));
    console.log('[BOOT] === loadSessionFromStorage END (error) ===');
    console.log('[Supabase Auth] Error loading session from SecureStore:', err instanceof Error ? err.message : 'Unknown');
  }
  sessionLoaded = true;
}

/**
 * Save session to SecureStore ONLY.
 * Stores ONLY minimal fields (access_token, refresh_token, expires_at) to
 * avoid hitting SecureStore size limits with large user/session objects.
 * Returns true if the write was confirmed by a read-back, false otherwise.
 */
async function saveSessionToStorage(session: { access_token: string; refresh_token: string; expires_at: number } | null): Promise<boolean> {
  try {
    if (session) {
      // Store ONLY minimal data — avoids potential size-limit issues in SecureStore
      const minimal = JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      });
      await SecureStore.setItemAsync(SESSION_STORAGE_KEY, minimal);
      console.log('[Supabase Auth] Session saved to SecureStore, expires_at:', session.expires_at, 'length:', minimal.length);

      // Read-back verification — confirm the write actually landed
      const readback = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
      if (!readback) {
        console.log('[Supabase Auth] CRITICAL: SecureStore write appeared to succeed but read-back returned null — keychain access issue?');
        return false;
      }
      console.log('[Supabase Auth] SecureStore write confirmed by read-back, length:', readback.length);
      return true;
    } else {
      await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
      console.log('[Supabase Auth] Session cleared from SecureStore');
      return true;
    }
  } catch (err) {
    console.log('[Supabase Auth] Error saving session to SecureStore:', err instanceof Error ? err.message : 'Unknown');
    return false;
  }
}

// Validation flags - URL must be at least a valid supabase URL format
const hasUrl = Boolean(supabaseUrl && supabaseUrl.includes('supabase.co'));
const hasAnonKey = Boolean(supabaseAnonKey && supabaseAnonKey.length > 20);

// Log configuration status at startup (visible in expo.log / TestFlight logs)
// Shows first 10 chars of key so we can confirm the RIGHT project is baked into the build
console.log('='.repeat(60));
console.log('[Supabase Config]');
console.log('  URL:', supabaseUrl || 'UNDEFINED - MISSING EXPO_PUBLIC_SUPABASE_URL');
console.log('  Anon Key (first 10):', supabaseAnonKey ? supabaseAnonKey.slice(0, 10) + '...' : 'UNDEFINED - MISSING EXPO_PUBLIC_SUPABASE_ANON_KEY');
console.log('  Anon Key length:', supabaseAnonKey ? supabaseAnonKey.length : 0);
console.log('  Status:', hasUrl && hasAnonKey ? 'CONFIGURED' : 'NOT CONFIGURED');
if (!hasUrl || !hasAnonKey) {
  console.log('  ACTION REQUIRED: Add Supabase credentials in eas.json env block or Vibecode ENV tab');
}
console.log('='.repeat(60));

// Check if Supabase is configured
export const isSupabaseConfigured = (): boolean => {
  return hasUrl && hasAnonKey;
};

/**
 * Set the current session (call after successful sign-in)
 * Persists to SecureStore for persistence across app restarts.
 * Stores ONLY minimal fields (access_token, refresh_token, expires_at).
 * Returns true if the SecureStore write was confirmed by a read-back.
 *
 * IMPORTANT: expires_at is computed and ALWAYS set:
 * - If expires_at is provided, use it directly
 * - If expires_in is provided, compute expires_at = nowSeconds + expires_in
 * - If neither, default to 1 hour from now
 */
export const setSupabaseSession = async (session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
} | null): Promise<boolean> => {
  if (session) {
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Compute expires_at - ALWAYS ensure it's set
    let expiresAt: number;
    if (session.expires_at && session.expires_at > 0) {
      expiresAt = session.expires_at;
    } else if (session.expires_in && session.expires_in > 0) {
      expiresAt = nowSeconds + session.expires_in;
    } else {
      // Default to 1 hour from now if nothing provided
      expiresAt = nowSeconds + 3600;
      console.log('[Supabase] Warning: No expiry info provided, defaulting to 1 hour');
    }

    currentSession = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: expiresAt,
    };

    console.log('[Supabase] Session set, expires_at:', expiresAt, '(in', expiresAt - nowSeconds, 'seconds)');
  } else {
    currentSession = null;
    console.log('[Supabase] Session cleared');
  }

  // Persist to SecureStore — AWAIT to guarantee write completes before returning
  const writeSuccess = await saveSessionToStorage(currentSession);
  if (!writeSuccess && currentSession !== null) {
    console.log('[Supabase] WARN: SecureStore write failed — session is in memory only, will not survive restart');
  }
  return writeSuccess;
};

/**
 * Get the current session (synchronous, from memory)
 * Note: Use getValidSession() for authenticated operations as it handles refresh
 */
export const getSupabaseSession = (): { access_token: string; refresh_token: string; expires_at: number } | null => {
  return currentSession;
};

/**
 * Check if the current session is expired or about to expire (within given seconds)
 * Uses seconds-to-seconds comparison (expires_at is Unix timestamp in seconds)
 *
 * @param bufferSeconds - Consider expired if within this many seconds of expiration (default 60)
 * @returns true if expired, expiring soon, or expires_at is missing/invalid
 */
const isSessionExpired = (bufferSeconds: number = 60): boolean => {
  // If no session or no expires_at, treat as expired
  if (!currentSession?.expires_at || currentSession.expires_at <= 0) {
    return true;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds >= (currentSession.expires_at - bufferSeconds);
};

/**
 * Get the current live session, loading from SecureStore if not yet in memory.
 * Returns null if no session exists OR if the token is hard-expired and refresh fails.
 *
 * @returns Valid session or null if not authenticated / session expired
 */
export async function getValidSession(): Promise<{ access_token: string; refresh_token: string; expires_at: number } | null> {
  // Load from SecureStore only if not already loaded into memory
  if (!sessionLoaded) {
    await loadSessionFromStorage();
  }

  if (!currentSession?.access_token || !currentSession?.refresh_token) {
    console.log('[getValidSession] No session found in SecureStore');
    return null;
  }

  // If the token is hard-expired, attempt a refresh before returning
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isHardExpired = currentSession.expires_at > 0 && nowSeconds >= currentSession.expires_at;
  if (isHardExpired) {
    console.log('[getValidSession] Token hard-expired, attempting refresh...');
    const refreshed = await refreshSupabaseSession();
    if (!refreshed || !currentSession?.access_token) {
      // Do NOT delete from SecureStore here — refreshSupabaseSession already handles
      // clearing on invalid_grant. For transient failures keep the session so the
      // user isn't logged out due to a network hiccup.
      console.log('[getValidSession] Refresh failed — returning null (session kept in SecureStore for retry)');
      return null;
    }
    console.log('[getValidSession] Token refreshed successfully');
  }

  console.log('[getValidSession] Session found, expires_at:', currentSession.expires_at);
  return currentSession;
}

/**
 * Refresh the current session using the refresh token
 * Returns true if refresh was successful, false otherwise
 *
 * Supabase returns either expires_at (Unix timestamp) or expires_in (seconds from now)
 * We normalize to expires_at in setSupabaseSession
 */
export async function refreshSupabaseSession(): Promise<boolean> {
  if (!currentSession?.refresh_token) {
    console.log('[Supabase Auth] No refresh token available');
    return false;
  }

  if (!isSupabaseConfigured()) {
    console.log('[Supabase Auth] Supabase not configured');
    return false;
  }

  const url = `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`;

  console.log('[Supabase Auth] Attempting token refresh...');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: currentSession.refresh_token,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.log('[Supabase Auth] Token refresh FAILED:');
      console.log('  HTTP status:', response.status);
      console.log('  Response body:', JSON.stringify(responseData));
      // Only clear the session if the server explicitly rejects the refresh token
      // (invalid_grant = token revoked/rotated). For all other failures (5xx, network
      // errors routed through catch, etc.) keep the session so the user stays logged in
      // and the next action can retry.
      const errorCode = responseData?.error;
      if (response.status === 400 && (errorCode === 'invalid_grant' || errorCode === 'refresh_token_not_found')) {
        console.log('[Supabase Auth] Refresh token is invalid/expired — clearing session, user must sign in');
        currentSession = null;
        await saveSessionToStorage(null);
      } else {
        console.log('[Supabase Auth] Transient refresh failure (status ' + response.status + ') — keeping session for retry');
      }
      return false;
    }

    // Update the session with new tokens
    // Pass both expires_at and expires_in - setSupabaseSession will handle normalization
    await setSupabaseSession({
      access_token: responseData.access_token,
      refresh_token: responseData.refresh_token,
      expires_at: responseData.expires_at,
      expires_in: responseData.expires_in,
    });

    console.log('[Supabase Auth] Token refresh successful');
    return true;
  } catch (err) {
    console.log('[Supabase Auth] Token refresh network error:', err instanceof Error ? err.message : 'Unknown');
    return false;
  }
}

/**
 * Get public auth key — always returns the anon key.
 * Use this for read-only public queries (list farmstands, get farmstand by id, explore).
 * These endpoints have RLS policies that allow anon reads.
 */
function getPublicAuthKey(): { key: string; keyType: 'session' | 'anon' } {
  return { key: supabaseAnonKey, keyType: 'anon' };
}

/**
 * Get a valid auth key, refreshing the session if needed.
 * ALWAYS returns the user's access_token — never falls back to anon key.
 * Throws AUTH_REQUIRED if no valid session exists.
 * Use this for write operations (insert/update/delete/rpc) that require authentication.
 */
async function getValidAuthKey(): Promise<{ key: string; keyType: 'session' | 'anon' }> {
  // If in-memory session is missing, always re-read from SecureStore.
  // Do NOT gate on sessionLoaded — in TestFlight the flag can be true while
  // currentSession is null (e.g. expired + cleared during boot, or module
  // re-evaluated in production bundle).
  if (!currentSession?.access_token) {
    console.log('[Supabase Auth] getValidAuthKey: in-memory session null, loading from storage...');
    sessionLoaded = false; // Force a fresh SecureStore read
    await loadSessionFromStorage();
  }

  if (!currentSession?.access_token) {
    // Never fall back to anon key — callers must have an authenticated session.
    // Returning anon key would cause Supabase to log role:"anon" and reject
    // admin RPC calls with a 401.
    console.log('[Supabase Auth] getValidAuthKey: no session after SecureStore load — throwing AUTH_REQUIRED');
    throw new Error('AUTH_REQUIRED');
  }

  // Check if session is expired and try to refresh (using 60 second buffer)
  if (isSessionExpired(60)) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[Supabase Auth] Refreshing session…');
    const refreshed = await refreshSupabaseSession();
    if (!refreshed) {
      // Session existed but is expired and refresh failed — throw so callers
      // surface AUTH_REQUIRED instead of silently sending an anon-key request
      // that Supabase will reject with AUTH_REQUIRED anyway.
      console.log('[Supabase Auth] Refresh failed — throwing AUTH_REQUIRED');
      throw new Error('AUTH_REQUIRED');
    }
  }

  return { key: currentSession!.access_token, keyType: 'session' };
}

/**
 * Check if there's an active session
 */
export const hasActiveSession = (): boolean => {
  return currentSession !== null && Boolean(currentSession.access_token);
};

/**
 * Ensure session is ready before performing authenticated actions.
 * Handles the race condition where session may not be loaded from SecureStore yet
 * (e.g., on cold start or returning from background).
 *
 * @param maxRetries - Number of retry attempts (default: 3)
 * @param delayMs - Delay between retries in milliseconds (default: 250)
 * @returns The session if found, null otherwise
 */
export async function ensureSessionReady(
  maxRetries: number = 3,
  delayMs: number = 250
): Promise<{ access_token: string; refresh_token: string; expires_at: number } | null> {
  // First, ensure session is loaded from SecureStore
  if (!sessionLoaded) {
    console.log('[Supabase Auth] ensureSessionReady: Loading session from storage...');
    await loadSessionFromStorage();
  }

  // Check if session exists after loading
  if (hasActiveSession()) {
    console.log('[Supabase Auth] ensureSessionReady: Session found immediately');
    return currentSession;
  }

  // Retry logic for race conditions
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[Supabase Auth] ensureSessionReady: Attempt ${attempt}/${maxRetries}, waiting ${delayMs}ms...`);

    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Try to load from SecureStore again (in case it was saved during the delay)
    try {
      const stored = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.access_token && parsed.refresh_token) {
          currentSession = {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
            expires_at: parsed.expires_at && parsed.expires_at > 0 ? parsed.expires_at : 0,
          };
          sessionLoaded = true;
          console.log('[Supabase Auth] ensureSessionReady: Session found on retry');
          return currentSession;
        }
      }
    } catch (err) {
      console.log('[Supabase Auth] ensureSessionReady: Error reading from SecureStore:', err instanceof Error ? err.message : 'Unknown');
    }

    // Also try refreshing the session if we have a refresh token
    if (currentSession?.refresh_token) {
      console.log('[Supabase Auth] ensureSessionReady: Attempting token refresh...');
      const refreshed = await refreshSupabaseSession();
      if (refreshed && hasActiveSession()) {
        console.log('[Supabase Auth] ensureSessionReady: Session refreshed successfully');
        return currentSession;
      }
    }
  }

  console.log('[Supabase Auth] ensureSessionReady: No session found after all retries');
  return null;
}

// Export URL for debugging
export const getSupabaseUrl = (): string => supabaseUrl;

/**
 * Probe SecureStore to diagnose session persistence in production builds.
 * Reads the session key, writes a test key, reads it back.
 * Safe to call from any screen — no tokens are exposed in the return value.
 */
export async function debugSecureStore(): Promise<{
  hasSessionKey: boolean;
  sessionLength: number | null;
  testWriteWorked: boolean;
  testValue: string | null;
}> {
  const TEST_KEY = 'fs-debug-test';
  let hasSessionKey = false;
  let sessionLength: number | null = null;
  let testWriteWorked = false;
  let testValue: string | null = null;

  try {
    const sessionRaw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
    hasSessionKey = sessionRaw !== null;
    sessionLength = sessionRaw !== null ? sessionRaw.length : null;
    console.log('[debugSecureStore] session key present:', hasSessionKey, 'length:', sessionLength);
  } catch (e) {
    console.log('[debugSecureStore] error reading session key:', e instanceof Error ? e.message : String(e));
  }

  try {
    const writeValue = String(Date.now());
    await SecureStore.setItemAsync(TEST_KEY, writeValue);
    const readback = await SecureStore.getItemAsync(TEST_KEY);
    testWriteWorked = readback === writeValue;
    testValue = readback;
    console.log('[debugSecureStore] test write value:', writeValue, 'readback:', readback, 'match:', testWriteWorked);
  } catch (e) {
    console.log('[debugSecureStore] error on test write/read:', e instanceof Error ? e.message : String(e));
  }

  return { hasSessionKey, sessionLength, testWriteWorked, testValue };
}

/**
 * Get detailed Supabase configuration status for debugging
 */
export const getSupabaseConfigStatus = (): {
  configured: boolean;
  hasUrl: boolean;
  hasAnonKey: boolean;
  hasServiceRole: boolean;
  projectRef: string;
  errorMessage: string | null;
} => {
  const projectRef = getSupabaseProjectRef();
  return {
    configured: hasUrl && hasAnonKey,
    hasUrl,
    hasAnonKey,
    hasServiceRole: false, // No longer using service role key
    projectRef,
    errorMessage: !hasUrl || !hasAnonKey
      ? 'Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in Vibecode ENV tab'
      : null,
  };
};

/**
 * Get the Supabase project reference (first 12 chars of subdomain)
 * Useful for debugging which project we're connected to
 */
export const getSupabaseProjectRef = (): string => {
  if (!supabaseUrl) return 'no-url';
  if (supabaseUrl.length < 10) return 'invalid';
  try {
    const url = new URL(supabaseUrl);
    const subdomain = url.hostname.split('.')[0];
    return subdomain.slice(0, 12);
  } catch {
    return 'invalid-url';
  }
};

/**
 * Extended error type for Supabase errors with details
 */
export interface SupabaseError extends Error {
  status?: number;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * Parse Supabase error response into structured error
 */
function parseSupabaseError(status: number, errorText: string): SupabaseError {
  const error = new Error() as SupabaseError;
  error.status = status;

  try {
    const parsed = JSON.parse(errorText);
    error.message = parsed.message || parsed.error || errorText;
    error.code = parsed.code;
    error.details = parsed.details;
    error.hint = parsed.hint;
  } catch {
    error.message = errorText || `HTTP ${status}`;
  }

  // Add common RLS error hints
  if (status === 403 || error.code === '42501') {
    error.hint = error.hint || 'Row Level Security (RLS) policy is blocking this operation. Check your Supabase RLS policies.';
  }

  return error;
}

/**
 * Make a request to the Supabase REST API
 */
async function supabaseRequest<T>(
  table: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    params?: Record<string, string>;
    body?: unknown;
    select?: string;
    allowAnon?: boolean; // If true, use anon key (for public read-only queries)
  }
): Promise<{ data: T | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured - using local data');
    return { data: null, error: new Error('Supabase not configured') };
  }

  const { method = 'GET', params = {}, body, select, allowAnon = false } = options;

  // Build URL with query params
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);

  // Add select param if provided
  if (select) {
    url.searchParams.set('select', select);
  }

  // Add other params
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  try {
    // For public read queries (allowAnon=true), always use the anon key so unauthenticated
    // users can browse farmstands. For writes or admin reads, require a session.
    const { key: authKey, keyType } = allowAnon ? getPublicAuthKey() : await getValidAuthKey();
    console.log(`[Supabase] ${method} ${table} — keyType: ${keyType} (allowAnon=${allowAnon})`);

    const response = await fetch(url.toString(), {
      method,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${authKey}`,
        'Content-Type': 'application/json',
        Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`[Supabase] ${method} ${table} HTTP ${response.status} ERROR:`, errorText.slice(0, 200));
      throw new Error(`Supabase error: ${response.status} - ${errorText}`);
    }

    // For DELETE or when no content expected
    if (response.status === 204 || method === 'DELETE') {
      return { data: null, error: null };
    }

    const data = await response.json();
    const rowCount = Array.isArray(data) ? data.length : 1;
    console.log(`[Supabase] ${method} ${table} SUCCESS — ${rowCount} row(s)`);
    return { data: data as T, error: null };
  } catch (error) {
    // Use console.log instead of console.error to avoid red error display
    // for expected errors like RLS permission issues
    console.log('Supabase request error:', error);
    return { data: null, error: error as Error };
  }
}

/**
 * Supabase-like query builder for REST API
 */
export class SupabaseQueryBuilder<T> {
  private table: string;
  private params: Record<string, string> = {};
  private selectFields: string = '*';
  private updateData: Record<string, unknown> | null = null;
  private insertData: Record<string, unknown>[] | null = null;
  private isDeleteOperation: boolean = false;
  private allowAnonFlag: boolean = false;

  constructor(table: string) {
    this.table = table;
  }

  select(fields: string = '*'): this {
    this.selectFields = fields;
    return this;
  }

  eq(column: string, value: string | number | boolean): this {
    this.params[column] = `eq.${value}`;
    return this;
  }

  ilike(column: string, value: string): this {
    this.params[column] = `ilike.${value}`;
    return this;
  }

  neq(column: string, value: string | number | boolean): this {
    this.params[column] = `neq.${value}`;
    return this;
  }

  is(column: string, value: 'null' | 'true' | 'false'): this {
    this.params[column] = `is.${value}`;
    return this;
  }

  in(column: string, values: (string | number)[]): this {
    this.params[column] = `in.(${values.join(',')})`;
    return this;
  }

  not(column: string, operator: string, value: string): this {
    this.params[column] = `not.${operator}.${value}`;
    return this;
  }

  or(filters: string): this {
    this.params['or'] = `(${filters})`;
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const direction = options?.ascending === false ? 'desc' : 'asc';
    this.params['order'] = `${column}.${direction}`;
    return this;
  }

  limit(count: number): this {
    this.params['limit'] = count.toString();
    return this;
  }

  /**
   * Set data for an update operation
   */
  update(data: Record<string, unknown>): this {
    this.updateData = data;
    return this;
  }

  /**
   * Set data for an insert operation (single or multiple rows)
   */
  insert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.insertData = Array.isArray(data) ? data : [data];
    return this;
  }

  /**
   * Mark this as a delete operation
   */
  delete(): this {
    this.isDeleteOperation = true;
    return this;
  }

  /**
   * Allow anon key as fallback for insert operations.
   * Use for publicly-accessible tables where unauthenticated inserts are permitted by RLS.
   */
  allowAnon(): this {
    this.allowAnonFlag = true;
    return this;
  }

  async execute(): Promise<{ data: T[] | null; error: Error | null }> {
    // If delete operation, perform DELETE request
    if (this.isDeleteOperation) {
      return this.executeDelete();
    }
    // If insertData is set, perform a POST request
    if (this.insertData !== null) {
      return this.executeInsert();
    }
    // If updateData is set, perform a PATCH request
    if (this.updateData !== null) {
      return this.executeUpdate();
    }
    return supabaseRequest<T[]>(this.table, {
      method: 'GET',
      params: this.params,
      select: this.selectFields,
      allowAnon: true, // Public reads: always use anon key so unauthenticated users can browse
    });
  }

  /**
   * Execute an INSERT (POST) request
   * Uses session token if available; falls back to anon key if allowAnonFlag is set.
   */
  private async executeInsert(): Promise<{ data: T[] | null; error: SupabaseError | null }> {
    if (!isSupabaseConfigured()) {
      console.warn('Supabase not configured - cannot insert');
      return { data: null, error: new Error('Supabase not configured') as SupabaseError };
    }

    const url = new URL(`${supabaseUrl}/rest/v1/${this.table}`);

    // Use session token if available; fall back to anon key for public tables when allowed
    let authKey: string;
    let keyType: 'session' | 'anon';
    try {
      const result = await getValidAuthKey();
      authKey = result.key;
      keyType = result.keyType;
    } catch (err) {
      if (this.allowAnonFlag && err instanceof Error && err.message === 'AUTH_REQUIRED') {
        console.log('[Supabase Insert] No session — using anon key (allowAnon=true)');
        ({ key: authKey, keyType } = getPublicAuthKey());
      } else {
        throw err;
      }
    }

    console.log('[Supabase Insert] URL:', url.toString());
    console.log('[Supabase Insert] Using key type:', keyType);
    console.log('[Supabase Insert] Row count:', this.insertData?.length ?? 0);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${authKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(this.insertData),
      });

      console.log('[Supabase Insert] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        // Use console.log for expected errors (409 duplicate) to avoid red error noise
        if (response.status === 409) {
          console.log('[Supabase Insert] Duplicate key (409):', errorText);
        } else {
          console.log('[Supabase Insert Error]', response.status, errorText);
        }
        const error = parseSupabaseError(response.status, errorText);
        if (error.status === 403 || error.status === 401) {
          error.hint = `${error.hint || ''}\nUsing ${keyType} key. ${keyType === 'anon' ? 'Session may be expired - please sign in again.' : ''}`.trim();
        }
        return { data: null, error };
      }

      const contentLength = response.headers.get('content-length');
      if (response.status === 204 || contentLength === '0') {
        console.log('[Supabase Insert] Success with no content returned');
        return { data: [], error: null };
      }

      const data = await response.json();
      console.log('[Supabase Insert] Success, rows inserted:', Array.isArray(data) ? data.length : 1);
      return { data: data as T[], error: null };
    } catch (error) {
      console.error('[Supabase Insert] Unexpected error:', error);
      const supabaseError = error as SupabaseError;
      supabaseError.details = supabaseError.details || 'Network error or unexpected failure';
      return { data: null, error: supabaseError };
    }
  }

  /**
   * Execute an UPDATE (PATCH) request
   * Uses session token if available for authenticated operations
   */
  private async executeUpdate(): Promise<{ data: T[] | null; error: SupabaseError | null }> {
    if (!isSupabaseConfigured()) {
      console.warn('Supabase not configured - using local data');
      return { data: null, error: new Error('Supabase not configured') as SupabaseError };
    }

    // Build URL with query params for the WHERE clause
    const url = new URL(`${supabaseUrl}/rest/v1/${this.table}`);

    // Add filter params (the WHERE clause)
    for (const [key, value] of Object.entries(this.params)) {
      url.searchParams.set(key, value);
    }

    // Use session token if available (with auto-refresh), otherwise use anon key
    const { key: authKey, keyType } = await getValidAuthKey();

    console.log('[Supabase Update] URL:', url.toString());
    console.log('[Supabase Update] Using key type:', keyType);
    console.log('[Supabase Update] Data:', JSON.stringify(this.updateData, null, 2));

    try {
      const response = await fetch(url.toString(), {
        method: 'PATCH',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${authKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(this.updateData),
      });

      console.log('[Supabase Update] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        // Use console.log (not console.error) to avoid triggering React Native's red error
        // overlay for expected/non-fatal errors (409 conflicts, 400 DB constraint errors, etc.)
        console.log('[Supabase Update Error]', response.status, errorText);
        const error = parseSupabaseError(response.status, errorText);
        if (error.status === 403 || error.status === 401) {
          error.hint = `${error.hint || ''}\nUsing ${keyType} key. ${keyType === 'anon' ? 'Session may be expired - please sign in again.' : ''}`.trim();
        }
        return { data: null, error };
      }

      // Check if response has content
      const contentLength = response.headers.get('content-length');
      if (response.status === 204 || contentLength === '0') {
        console.log('[Supabase Update] Success with no content returned');
        return { data: [], error: null };
      }

      const data = await response.json();
      console.log('[Supabase Update] Success, rows returned:', Array.isArray(data) ? data.length : 1);
      return { data: data as T[], error: null };
    } catch (error) {
      console.error('[Supabase Update] Unexpected error:', error);
      const supabaseError = error as SupabaseError;
      supabaseError.details = supabaseError.details || 'Network error or unexpected failure';
      return { data: null, error: supabaseError };
    }
  }

  /**
   * Execute a DELETE request
   * Uses session token if available for authenticated operations
   */
  private async executeDelete(): Promise<{ data: T[] | null; error: SupabaseError | null }> {
    if (!isSupabaseConfigured()) {
      console.warn('Supabase not configured - cannot delete');
      return { data: null, error: new Error('Supabase not configured') as SupabaseError };
    }

    // Build URL with query params for the WHERE clause
    const url = new URL(`${supabaseUrl}/rest/v1/${this.table}`);

    // Add filter params (the WHERE clause)
    for (const [key, value] of Object.entries(this.params)) {
      url.searchParams.set(key, value);
    }

    // Use session token if available (with auto-refresh), otherwise use anon key
    const { key: authKey, keyType } = await getValidAuthKey();

    console.log('[Supabase Delete] URL:', url.toString());
    console.log('[Supabase Delete] Using key type:', keyType);

    try {
      const response = await fetch(url.toString(), {
        method: 'DELETE',
        headers: {
          apikey: supabaseAnonKey, // apikey header always uses anon key
          Authorization: `Bearer ${authKey}`, // Auth header uses service role if available
          'Content-Type': 'application/json',
        },
      });

      console.log('[Supabase Delete] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Supabase Delete Error]', response.status, errorText);
        const error = parseSupabaseError(response.status, errorText);
        if (error.status === 403 || error.status === 401) {
          error.hint = `${error.hint || ''}\nUsing ${keyType} key. ${keyType === 'anon' ? 'Consider adding EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY or updating RLS policies.' : ''}`.trim();
        }
        return { data: null, error };
      }

      console.log('[Supabase Delete] Success');
      return { data: [], error: null };
    } catch (error) {
      console.error('[Supabase Delete] Unexpected error:', error);
      const supabaseError = error as SupabaseError;
      supabaseError.details = supabaseError.details || 'Network error or unexpected failure';
      return { data: null, error: supabaseError };
    }
  }
}

/**
 * Call a Supabase RPC (stored procedure/function)
 * Uses service role key if available for admin operations
 */
async function supabaseRpc<T>(
  functionName: string,
  params?: Record<string, unknown>
): Promise<{ data: T | null; error: SupabaseError | null }> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured - cannot call RPC');
    return { data: null, error: new Error('Supabase not configured') as SupabaseError };
  }

  const url = `${supabaseUrl}/rest/v1/rpc/${functionName}`;

  // Use session token if available (with auto-refresh), otherwise use anon key
  const { key: authKey, keyType } = await getValidAuthKey();

  console.log('[Supabase RPC] Function:', functionName);
  console.log('[Supabase RPC] Using key type:', keyType);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${authKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: params ? JSON.stringify(params) : '{}',
    });

    console.log('[Supabase RPC] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Supabase RPC Error]', response.status, errorText);
      const error = parseSupabaseError(response.status, errorText);
      if (error.status === 403 || error.status === 401) {
        error.hint = `${error.hint || ''}\nUsing ${keyType} key. ${keyType === 'anon' ? 'Session may be expired - please sign in again.' : ''}`.trim();
      }
      return { data: null, error };
    }

    // Check if response has content
    const contentLength = response.headers.get('content-length');
    if (response.status === 204 || contentLength === '0') {
      console.log('[Supabase RPC] Success with no content returned');
      return { data: null, error: null };
    }

    const data = await response.json();
    console.log('[Supabase RPC] Success, result:', JSON.stringify(data));
    return { data: data as T, error: null };
  } catch (error) {
    console.error('[Supabase RPC] Unexpected error:', error);
    const supabaseError = error as SupabaseError;
    supabaseError.details = supabaseError.details || 'Network error or unexpected failure';
    return { data: null, error: supabaseError };
  }
}

/**
 * Main Supabase client object with from() and rpc() methods
 */
export const supabase = {
  from: <T>(table: string): SupabaseQueryBuilder<T> => {
    return new SupabaseQueryBuilder<T>(table);
  },
  rpc: <T>(functionName: string, params?: Record<string, unknown>): Promise<{ data: T | null; error: SupabaseError | null }> => {
    return supabaseRpc<T>(functionName, params);
  },
};

/**
 * Supabase Auth - Sign Up
 * Creates a new user using Supabase Auth API
 * Returns the user data including the auto-generated UUID
 */
export async function supabaseAuthSignUp(
  email: string,
  password: string,
  metadata?: { full_name?: string }
): Promise<{
  data: { user: { id: string; email: string } | null; session: unknown | null } | null;
  error: SupabaseError | null;
}> {
  if (!isSupabaseConfigured()) {
    return {
      data: null,
      error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError,
    };
  }

  const url = `${supabaseUrl}/auth/v1/signup`;

  console.log('[Supabase Auth] Signing up user:', email);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        data: metadata || {},
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      // Use console.log instead of console.error to avoid React Native treating this as an exception
      // Rate limit errors (429) are expected and handled gracefully in the UI
      console.log('[Supabase Auth] Signup response:', response.status, responseData?.error_code || responseData?.code);
      const error = parseSupabaseError(response.status, JSON.stringify(responseData));
      return { data: null, error };
    }

    console.log('[Supabase Auth] Signup success, user ID:', responseData.user?.id);

    // CRITICAL: Store the session so subsequent requests use the authenticated token
    if (responseData.session?.access_token) {
      await setSupabaseSession({
        access_token: responseData.session.access_token,
        refresh_token: responseData.session.refresh_token,
        expires_at: responseData.session.expires_at,
        expires_in: responseData.session.expires_in,
      });
      console.log('[Supabase Auth] Session stored after signup');
    } else {
      console.log('[Supabase Auth] No session returned - user may need to confirm email');
    }

    return {
      data: {
        user: responseData.user ? { id: responseData.user.id, email: responseData.user.email } : null,
        session: responseData.session,
      },
      error: null,
    };
  } catch (err) {
    console.log('[Supabase Auth] Signup network error:', err instanceof Error ? err.message : 'Unknown');
    return {
      data: null,
      error: {
        name: 'Error',
        message: err instanceof Error ? err.message : 'Network error',
      } as SupabaseError,
    };
  }
}

/**
 * Supabase Auth - Sign In
 * Signs in an existing user using Supabase Auth API
 */
export async function supabaseAuthSignIn(
  email: string,
  password: string
): Promise<{
  data: { user: { id: string; email: string; user_metadata?: { full_name?: string } } | null; session: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number } | null } | null;
  error: SupabaseError | null;
}> {
  if (!isSupabaseConfigured()) {
    return {
      data: null,
      error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError,
    };
  }

  const url = `${supabaseUrl}/auth/v1/token?grant_type=password`;

  // Normalize inputs: trim + lowercase email, guard password against null/undefined
  const emailToSend = (email ?? '').trim().toLowerCase();
  const passwordToSend = password ?? '';

  // Pre-send diagnostics — catch hidden whitespace / empty values in TestFlight
  const emailParts = emailToSend.split('@');
  const maskedEmail = emailParts.length === 2
    ? `${emailParts[0].slice(0, 3)}***@${emailParts[1]}`
    : `${emailToSend.slice(0, 3)}***`;
  console.log('[Supabase Auth] Signing in user (masked):', maskedEmail);
  console.log('[Supabase Auth] Email length:', emailToSend.length);
  console.log('[Supabase Auth] Password length:', passwordToSend.length);
  console.log('[Supabase Auth] Password length > 0:', passwordToSend.length > 0);
  console.log('[Supabase Auth] Using URL:', supabaseUrl || 'UNDEFINED');
  console.log('[Supabase Auth] Anon key prefix:', supabaseAnonKey ? supabaseAnonKey.slice(0, 10) + '...' : 'UNDEFINED');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: emailToSend,
        password: passwordToSend,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      // Log full response body so we can diagnose the exact Supabase error in TestFlight
      console.log('[Supabase Auth] Signin FAILED:');
      console.log('  HTTP status:', response.status);
      console.log('  URL used:', url);
      console.log('  Anon key prefix:', supabaseAnonKey ? supabaseAnonKey.slice(0, 10) + '...' : 'UNDEFINED');
      console.log('  Response body:', JSON.stringify(responseData));
      const error = parseSupabaseError(response.status, JSON.stringify(responseData));
      return { data: null, error };
    }

    console.log('[Supabase Auth] Signin success, user ID:', responseData.user?.id);

    // CRITICAL: Store the session so subsequent requests use the authenticated token
    if (responseData.access_token) {
      await setSupabaseSession({
        access_token: responseData.access_token,
        refresh_token: responseData.refresh_token,
        expires_at: responseData.expires_at,
        expires_in: responseData.expires_in,
      });

      // === SIGNIN: SESSION PERSISTENCE PROOF (TestFlight) ===
      try {
        console.log('[SIGNIN] === SESSION PERSISTENCE PROOF ===');

        // 1. What was set in memory
        const memSession = getSupabaseSession();
        console.log('[SIGNIN] session exists?', !!(memSession?.access_token),
          '| user.id:', responseData.user?.id ?? 'MISSING',
          '| expires_at:', memSession?.expires_at ?? 'MISSING',
          '| refresh_token exists?', !!(memSession?.refresh_token));

        // 2. Verify SecureStore write succeeded (readback)
        const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
        if (raw) {
          const rawParsed = JSON.parse(raw) as { refresh_token?: string; expires_at?: number; access_token?: string };
          console.log('[SIGNIN] wrote SecureStore supabase-session OK'
            + ' | length=' + raw.length
            + ' | refresh_token exists?' + !!(rawParsed.refresh_token)
            + ' | expires_at=' + (rawParsed.expires_at ?? 'MISSING'));
          console.log('[SIGNIN] readback SecureStore ok');
        } else {
          console.log('[SIGNIN] CRITICAL: wrote SecureStore but readback is EMPTY — possible keychain access issue');
        }

        console.log('[SIGNIN] === END PERSISTENCE PROOF ===');
      } catch (dbgErr) {
        console.log('[SIGNIN] Persistence proof FAILED:', dbgErr instanceof Error ? dbgErr.message : String(dbgErr));
      }
      // =====================================================
    }

    return {
      data: {
        user: responseData.user ? {
          id: responseData.user.id,
          email: responseData.user.email,
          user_metadata: responseData.user.user_metadata,
        } : null,
        session: {
          access_token: responseData.access_token,
          refresh_token: responseData.refresh_token,
          expires_at: responseData.expires_at,
          expires_in: responseData.expires_in,
        },
      },
      error: null,
    };
  } catch (err) {
    console.log('[Supabase Auth] Signin network error:', err instanceof Error ? err.message : 'Unknown');
    return {
      data: null,
      error: {
        name: 'Error',
        message: err instanceof Error ? err.message : 'Network error',
      } as SupabaseError,
    };
  }
}

/**
 * Supabase Auth - Resend Confirmation Email
 * Resends the confirmation email to the user
 */
export async function supabaseResendConfirmation(
  email: string
): Promise<{
  error: SupabaseError | null;
}> {
  if (!isSupabaseConfigured()) {
    return {
      error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError,
    };
  }

  const url = `${supabaseUrl}/auth/v1/resend`;

  console.log('[Supabase Auth] Resending confirmation to:', email);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'signup',
        email,
      }),
    });

    if (!response.ok) {
      const responseData = await response.json();
      console.log('[Supabase Auth] Resend response:', response.status, responseData?.error_code || responseData?.code);
      const error = parseSupabaseError(response.status, JSON.stringify(responseData));
      return { error };
    }

    console.log('[Supabase Auth] Resend confirmation success');
    return { error: null };
  } catch (err) {
    console.log('[Supabase Auth] Resend network error:', err instanceof Error ? err.message : 'Unknown');
    return {
      error: {
        name: 'Error',
        message: err instanceof Error ? err.message : 'Network error',
      } as SupabaseError,
    };
  }
}

/**
 * Supabase Storage - Upload a file
 * Uploads a file to Supabase Storage bucket
 * @param bucket - The storage bucket name (e.g., 'claim-evidence')
 * @param path - The file path within the bucket (e.g., 'user123/photo1.jpg')
 * @param file - The file to upload (base64 string or Blob)
 * @param contentType - The MIME type of the file (e.g., 'image/jpeg')
 * @returns The public URL of the uploaded file or error
 */
export async function uploadToSupabaseStorage(
  bucket: string,
  path: string,
  fileUri: string,
  contentType: string = 'image/jpeg'
): Promise<{ url: string | null; error: SupabaseError | null }> {
  if (!isSupabaseConfigured()) {
    return {
      url: null,
      error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError,
    };
  }

  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;

  // Always require an authenticated session for storage uploads — never fall
  // back to the anon key (getValidAuthKey() now throws AUTH_REQUIRED if no session).
  const { key: authKey, keyType } = await getValidAuthKey();

  // DEBUG: confirm the JWT being used is from an authenticated session
  const uploadSession = currentSession;
  console.log('UPLOAD SESSION?', !!uploadSession, uploadSession?.access_token?.slice(0, 12) ?? 'none', `(keyType=${keyType})`);

  console.log('[Supabase Storage] Uploading to:', uploadUrl);
  console.log('[Supabase Storage] Using key type:', keyType);

  try {
    // Read the file and convert to blob
    const response = await fetch(fileUri);
    const blob = await response.blob();

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${authKey}`,
        'Content-Type': contentType,
        'x-upsert': 'true', // Overwrite if exists
      },
      body: blob,
    });

    console.log('[Supabase Storage] Response status:', uploadResponse.status);

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('[Supabase Storage Error]', uploadResponse.status, errorText);
      const error = parseSupabaseError(uploadResponse.status, errorText);
      return { url: null, error };
    }

    // Construct the public URL
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
    console.log('[Supabase Storage] Upload success, public URL:', publicUrl);

    return { url: publicUrl, error: null };
  } catch (err) {
    console.error('[Supabase Storage] Upload error:', err);
    return {
      url: null,
      error: {
        name: 'Error',
        message: err instanceof Error ? err.message : 'Upload failed',
      } as SupabaseError,
    };
  }
}

/**
 * Auto-refresh interval management
 * Refreshes the session token periodically while the app is active
 */
let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;

// Refresh interval - 4 minutes (tokens typically expire in 1 hour, but we refresh early)
const AUTO_REFRESH_INTERVAL_MS = 4 * 60 * 1000;

/**
 * Start auto-refreshing the session token
 * This should be called when the app becomes active
 */
export function startAutoRefresh(): void {
  // Don't start if already running
  if (autoRefreshInterval) {
    console.log('[Supabase Auth] Auto-refresh already running');
    return;
  }

  // Don't start if no session
  if (!currentSession?.refresh_token) {
    console.log('[Supabase Auth] No session to auto-refresh');
    return;
  }

  console.log('[Supabase Auth] Starting auto-refresh');

  // Immediately check if we need to refresh
  if (isSessionExpired()) {
    refreshSupabaseSession();
  }

  // Set up periodic refresh
  autoRefreshInterval = setInterval(() => {
    if (currentSession?.refresh_token) {
      console.log('[Supabase Auth] Auto-refresh tick - checking session');
      if (isSessionExpired()) {
        refreshSupabaseSession();
      }
    } else {
      console.log('[Supabase Auth] Auto-refresh tick - no session, stopping');
      stopAutoRefresh();
    }
  }, AUTO_REFRESH_INTERVAL_MS);
}

/**
 * Stop auto-refreshing the session token
 * This should be called when the app goes to background
 */
export function stopAutoRefresh(): void {
  if (autoRefreshInterval) {
    console.log('[Supabase Auth] Stopping auto-refresh');
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

/**
 * Supabase Auth - Update User Metadata
 * Updates the current user's metadata (like full_name) in Supabase Auth
 * This is critical for name changes to persist across logout/login
 */
export async function supabaseAuthUpdateUser(
  metadata: { full_name?: string; [key: string]: unknown }
): Promise<{ error: SupabaseError | null }> {
  if (!isSupabaseConfigured()) {
    return {
      error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError,
    };
  }

  if (!currentSession?.access_token) {
    console.log('[Supabase Auth] No session - cannot update user');
    return {
      error: { name: 'Error', message: 'Not authenticated' } as SupabaseError,
    };
  }

  const url = `${supabaseUrl}/auth/v1/user`;

  console.log('[Supabase Auth] Updating user metadata:', JSON.stringify(metadata));

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${currentSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: metadata,
      }),
    });

    if (!response.ok) {
      const responseData = await response.json();
      console.log('[Supabase Auth] Update user response:', response.status, responseData?.error_code || responseData?.code);
      const error = parseSupabaseError(response.status, JSON.stringify(responseData));
      return { error };
    }

    console.log('[Supabase Auth] User metadata updated successfully');
    return { error: null };
  } catch (err) {
    console.log('[Supabase Auth] Update user network error:', err instanceof Error ? err.message : 'Unknown');
    return {
      error: {
        name: 'Error',
        message: err instanceof Error ? err.message : 'Network error',
      } as SupabaseError,
    };
  }
}

/**
 * Supabase Auth - Reset Password
 * Sends a password reset email to the user
 * Always uses farmstand://auth/callback as the redirect URL
 * @param email - The user's email address
 */
export async function supabaseResetPassword(
  email: string
): Promise<{ error: SupabaseError | null }> {
  if (!isSupabaseConfigured()) {
    return {
      error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError,
    };
  }

  const url = `${supabaseUrl}/auth/v1/recover`;

  console.log('[Supabase Auth] Sending password reset to:', email);

  try {
    // ALWAYS use the deep link scheme - never use https://farmstand.online or anything else
    const redirectTo = 'farmstand://auth/callback';

    console.log('[Supabase Auth] Password reset redirectTo:', redirectTo);
    console.log('[Supabase Auth] Password reset request URL:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.trim(),
        redirect_to: redirectTo,
      }),
    });

    if (!response.ok) {
      const responseData = await response.json();
      console.log('[Supabase Auth] Password reset failed:', response.status, responseData?.error_code || responseData?.code);
      const error = parseSupabaseError(response.status, JSON.stringify(responseData));
      return { error };
    }

    console.log('[Supabase Auth] Password reset email sent successfully');
    console.log('[Supabase Auth] Email link will redirect to:', redirectTo);
    return { error: null };
  } catch (err) {
    console.log('[Supabase Auth] Password reset network error:', err instanceof Error ? err.message : 'Unknown');
    return {
      error: {
        name: 'Error',
        message: err instanceof Error ? err.message : 'Network error',
      } as SupabaseError,
    };
  }
}

/**
 * Supabase Auth - Set Session from Recovery Tokens
 * Sets the user session using access_token and refresh_token from a recovery deep link
 * This is called after the user clicks the password reset link in their email
 *
 * SUPABASE DASHBOARD CONFIGURATION REQUIRED:
 * Go to Supabase Dashboard → Authentication → URL Configuration
 * Add "farmstand://auth/callback" to Additional Redirect URLs
 */
export async function supabaseSetSessionFromTokens(
  accessToken: string,
  refreshToken: string
): Promise<{ error: SupabaseError | null }> {
  if (!isSupabaseConfigured()) {
    return {
      error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError,
    };
  }

  console.log('[Supabase Auth] Setting session from recovery tokens');

  try {
    // Verify the tokens by refreshing the session
    const url = `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.log('[Supabase Auth] Session set failed:', response.status, responseData?.error_code || responseData?.code);
      const error = parseSupabaseError(response.status, JSON.stringify(responseData));
      return { error };
    }

    // Store the new session
    await setSupabaseSession({
      access_token: responseData.access_token,
      refresh_token: responseData.refresh_token,
      expires_at: responseData.expires_at,
      expires_in: responseData.expires_in,
    });

    console.log('[Supabase Auth] Session set successfully from recovery tokens');
    return { error: null };
  } catch (err) {
    console.log('[Supabase Auth] Session set network error:', err instanceof Error ? err.message : 'Unknown');
    return {
      error: {
        name: 'Error',
        message: err instanceof Error ? err.message : 'Network error',
      } as SupabaseError,
    };
  }
}

/**
 * Supabase Auth - Update User Password
 * Updates the current authenticated user's password
 * Requires an active session (user must be authenticated)
 */
export async function supabaseUpdatePassword(
  newPassword: string
): Promise<{ error: SupabaseError | null }> {
  if (!isSupabaseConfigured()) {
    return {
      error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError,
    };
  }

  if (!currentSession?.access_token) {
    console.log('[Supabase Auth] No session - cannot update password');
    return {
      error: { name: 'Error', message: 'Not authenticated. Please try the reset link again.' } as SupabaseError,
    };
  }

  const url = `${supabaseUrl}/auth/v1/user`;

  console.log('[Supabase Auth] Updating user password');

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${currentSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password: newPassword,
      }),
    });

    if (!response.ok) {
      const responseData = await response.json();
      console.log('[Supabase Auth] Password update response:', response.status, responseData?.error_code || responseData?.code);
      const error = parseSupabaseError(response.status, JSON.stringify(responseData));
      return { error };
    }

    console.log('[Supabase Auth] Password updated successfully');
    return { error: null };
  } catch (err) {
    console.log('[Supabase Auth] Password update network error:', err instanceof Error ? err.message : 'Unknown');
    return {
      error: {
        name: 'Error',
        message: err instanceof Error ? err.message : 'Network error',
      } as SupabaseError,
    };
  }
}

/**
 * Supabase Auth - Sign Out
 * Signs out the current user and clears the session
 */
export async function supabaseSignOut(): Promise<{ error: SupabaseError | null }> {
  if (!isSupabaseConfigured()) {
    // Still clear local session even if Supabase isn't configured
    await setSupabaseSession(null);
    return { error: null };
  }

  console.log('[Supabase Auth] Signing out');

  try {
    if (currentSession?.access_token) {
      const url = `${supabaseUrl}/auth/v1/logout`;

      await fetch(url, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${currentSession.access_token}`,
          'Content-Type': 'application/json',
        },
      });
    }

    // Clear local session regardless of API response
    await setSupabaseSession(null);
    console.log('[Supabase Auth] Signed out successfully');
    return { error: null };
  } catch (err) {
    // Still clear local session even on error
    setSupabaseSession(null);
    console.log('[Supabase Auth] Sign out error (session cleared anyway):', err instanceof Error ? err.message : 'Unknown');
    return { error: null };
  }
}

/**
 * React hook to track auth state and readiness
 * Returns { ready, session } - use this to conditionally show UI based on auth state
 *
 * Example usage:
 * ```
 * const { ready, session } = useAuthReady();
 * if (!ready) return <ActivityIndicator />;
 * if (!session) return <SignInBanner />;
 * ```
 */
export function useAuthReady(): { ready: boolean; session: { access_token: string; refresh_token: string; expires_at: number } | null } {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<{ access_token: string; refresh_token: string; expires_at: number } | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      // Load session from storage if not already loaded
      await loadSessionFromStorage();

      if (!mounted) return;

      const currentSess = getSupabaseSession();
      setSession(currentSess);
      setReady(true);

      console.log('[useAuthReady] Initial session loaded:', !!currentSess);
    })();

    // Set up a listener for session changes via AppState
    // When app comes to foreground, re-check session
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && mounted) {
        const currentSess = getSupabaseSession();
        setSession(currentSess);
        console.log('[useAuthReady] App active, session check:', !!currentSess);
      }
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return { ready, session };
}

/**
 * React hook to manage Supabase session auto-refresh based on app state
 * Use this in your root layout component to keep sessions alive
 * Also loads the session from SecureStore on app startup
 *
 * Uses getValidSession() to silently refresh tokens so users stay signed in.
 *
 * Example usage in _layout.tsx:
 * ```
 * import { useSupabaseAutoRefresh } from '@/lib/supabase';
 *
 * function RootLayoutNav() {
 *   useSupabaseAutoRefresh();
 *   // ... rest of your component
 * }
 * ```
 */
export function useSupabaseAutoRefresh(): void {
  useEffect(() => {
    // On mount, call getValidSession() to load and potentially refresh the session
    console.log('[useSupabaseAutoRefresh] Initializing session on mount...');
    getValidSession().then((session) => {
      console.log('[useSupabaseAutoRefresh] Initial session check:', session ? 'valid' : 'none');
      // Start periodic auto-refresh if we have a session
      if (session) {
        startAutoRefresh();
      }
    });

    // Listen for app state changes
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[Supabase Auth] App became active, refreshing session...');
        // When app becomes active, use getValidSession() to ensure fresh tokens
        const session = await getValidSession();
        console.log('[Supabase Auth] Session after becoming active:', session ? 'valid' : 'none');
        if (session) {
          startAutoRefresh();
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        console.log('[Supabase Auth] App went to background, stopping auto-refresh');
        stopAutoRefresh();
      }
    });

    // Cleanup on unmount
    return () => {
      subscription.remove();
      stopAutoRefresh();
    };
  }, []);
}

/**
 * Collect auth debug info for the Admin Auth Debug button.
 * Safe to show in an Alert — never prints full tokens.
 */
export async function getAdminAuthDebugInfo(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Always force a fresh read from SecureStore
  sessionLoaded = false;
  await loadSessionFromStorage();

  const sess = currentSession;
  const storageKey = SESSION_STORAGE_KEY;

  // Check SecureStore directly
  let storedRaw: string | null = null;
  try {
    storedRaw = await SecureStore.getItemAsync(storageKey);
  } catch {
    storedRaw = null;
  }

  const sessionInStorage = storedRaw !== null;
  const sessionInMemory = sess !== null;
  const expiresAt = sess?.expires_at ?? 0;
  const secondsUntilExpiry = expiresAt > 0 ? expiresAt - nowSeconds : null;
  const isExpired = expiresAt > 0 ? nowSeconds >= expiresAt : true;

  // Decode user id from JWT (no network call needed)
  let userId = 'n/a';
  if (sess?.access_token) {
    try {
      const parts = sess.access_token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        userId = (payload.sub as string) ?? 'n/a';
      }
    } catch { /* ignore */ }
  }

  const tokenPreview = sess?.access_token ? sess.access_token.slice(0, 12) + '…' : 'none';

  const lines = [
    `user_id: ${userId}`,
    `session_in_memory: ${sessionInMemory}`,
    `session_in_storage: ${sessionInStorage}`,
    `storage_key: ${storageKey}`,
    `expires_at: ${expiresAt}`,
    `now: ${nowSeconds}`,
    `seconds_until_expiry: ${secondsUntilExpiry ?? 'n/a'}`,
    `is_expired: ${isExpired}`,
    `access_token_prefix: ${tokenPreview}`,
    `refresh_token_exists: ${!!sess?.refresh_token}`,
  ];

  const info = lines.join('\n');
  console.log('[AdminAuthDebug]\n' + info);
  return info;
}

/**
 * Safe approve farmstand - ensures session is fresh before making the request
 * This is a drop-in helper for admin actions that need authenticated Supabase calls
 *
 * @param farmstandId - The ID of the farmstand to approve
 * @returns true on success, throws Error on failure
 * @throws Error with message "AUTH_REQUIRED" if no valid session
 */
export async function safeApproveFarmstand(farmstandId: string): Promise<boolean> {
  // Use getValidSession() for bulletproof session handling
  const session = await getValidSession();

  // === ADMIN ACTION: session diagnostic ===
  const nowSeconds = Math.floor(Date.now() / 1000);
  console.log('[ADMIN ACTION] safeApproveFarmstand getValidSession result:'
    + ' hasSession=' + !!(session?.access_token)
    + ', expires_at=' + (session?.expires_at ?? 'N/A')
    + ', refresh_token exists=' + !!(session?.refresh_token)
    + ', seconds_until_expiry=' + (session?.expires_at && session.expires_at > 0 ? session.expires_at - nowSeconds : 'N/A'));
  // =========================================

  if (!session?.access_token) {
    console.log('[safeApproveFarmstand] No valid session available');
    throw new Error('AUTH_REQUIRED');
  }

  console.log('[safeApproveFarmstand] Session ready, calling RPC approve_farmstand:', farmstandId);
  // DEBUG: confirm the token is authenticated, not the anon key
  console.log('APPROVE SESSION?', !!session, session?.access_token?.slice(0, 12) ?? 'none');

  // Call the approve_farmstand RPC function
  const { error } = await supabase.rpc('approve_farmstand', { p_farmstand_id: farmstandId });

  if (error) {
    console.log('[safeApproveFarmstand] RPC error:', error.message);
    throw new Error(error.message || 'Failed to approve farmstand');
  }

  console.log('[safeApproveFarmstand] Success');
  return true;
}

/**
 * Safe deny farmstand - ensures session is fresh before making the request
 * This is a drop-in helper for admin actions that need authenticated Supabase calls
 *
 * @param farmstandId - The ID of the farmstand to deny
 * @returns true on success, throws Error on failure
 * @throws Error with message "AUTH_REQUIRED" if no valid session
 */
export async function safeDenyFarmstand(farmstandId: string): Promise<boolean> {
  // Use getValidSession() for bulletproof session handling
  const session = await getValidSession();

  if (!session?.access_token) {
    console.log('[safeDenyFarmstand] No valid session available');
    throw new Error('AUTH_REQUIRED');
  }

  console.log('[safeDenyFarmstand] Session ready, calling RPC deny_farmstand:', farmstandId);

  // Call the deny_farmstand RPC function
  const { error } = await supabase.rpc('deny_farmstand', { p_farmstand_id: farmstandId });

  if (error) {
    console.log('[safeDenyFarmstand] RPC error:', error.message);
    throw new Error(error.message || 'Failed to deny farmstand');
  }

  console.log('[safeDenyFarmstand] Success');
  return true;
}

/**
 * Safe deny farmstand AND send inbox alert - ensures session is fresh before making the request.
 * This calls the admin_deny_farmstand_and_alert RPC which atomically denies the farmstand
 * and creates an inbox alert for the owner.
 *
 * @param farmstandId - The ID of the farmstand to deny
 * @param reason - Optional reason for denial
 * @returns true on success, throws Error on failure
 * @throws Error with message "AUTH_REQUIRED" if no valid session
 */
export async function safeDenyFarmstandAndAlert(farmstandId: string, reason: string | null): Promise<boolean> {
  // Force a fresh session check — never rely on stale in-memory state
  const session = await getValidSession();

  // === ADMIN ACTION: session diagnostic ===
  const nowSeconds = Math.floor(Date.now() / 1000);
  console.log('[ADMIN ACTION] safeDenyFarmstandAndAlert getValidSession result:'
    + ' hasSession=' + !!(session?.access_token)
    + ', expires_at=' + (session?.expires_at ?? 'N/A')
    + ', refresh_token exists=' + !!(session?.refresh_token)
    + ', seconds_until_expiry=' + (session?.expires_at && session.expires_at > 0 ? session.expires_at - nowSeconds : 'N/A'));
  // =========================================

  if (!session?.access_token) {
    console.log('[safeDenyFarmstandAndAlert] No valid session. sessionLoaded:', sessionLoaded,
      'currentSession:', currentSession ? `{expires_at: ${currentSession.expires_at}}` : 'null');
    throw new Error('AUTH_REQUIRED');
  }

  // DEBUG: confirm the token being used is an authenticated JWT, not the anon key
  console.log('DENY SESSION?', !!session, session?.access_token?.slice(0, 12) ?? 'none');

  console.log('[safeDenyFarmstandAndAlert] Session ready, calling RPC admin_deny_farmstand_and_alert:', farmstandId);

  const { error } = await supabase.rpc('admin_deny_farmstand_and_alert', {
    p_farmstand_id: farmstandId,
    p_reason: reason,
  });

  if (error) {
    console.log('[safeDenyFarmstandAndAlert] RPC error:', error.message);
    throw new Error(error.message || 'Failed to deny farmstand');
  }

  console.log('[safeDenyFarmstandAndAlert] Success');
  return true;
}

/**
 * Safe approve claim request - ensures session is fresh before making the request
 *
 * @param claimId - The ID of the claim request to approve
 * @returns true on success, throws Error on failure
 * @throws Error with message "AUTH_REQUIRED" if no valid session
 */
export async function safeApproveClaimRequest(claimId: string): Promise<boolean> {
  // Use getValidSession() for bulletproof session handling
  const session = await getValidSession();

  if (!session?.access_token) {
    // Extra diagnostic: log the raw in-memory state so TestFlight logs show what happened
    console.log('[safeApproveClaimRequest] No valid session. sessionLoaded:', sessionLoaded,
      'currentSession:', currentSession ? `{access_token: ..., expires_at: ${currentSession.expires_at}}` : 'null');
    throw new Error('AUTH_REQUIRED');
  }

  console.log('[safeApproveClaimRequest] Session ready, calling RPC approve_claim:', claimId);

  // Call the approve_claim RPC function
  const { error } = await supabase.rpc('approve_claim', { p_claim_id: claimId });

  if (error) {
    console.log('[safeApproveClaimRequest] RPC error:', error.message);
    throw new Error(error.message || 'Failed to approve claim');
  }

  console.log('[safeApproveClaimRequest] Success');
  return true;
}

/**
 * Safe hard-delete farmstand - permanently removes farmstand from DB
 * Uses direct table delete (not RPC) so the row is truly gone.
 *
 * @param farmstandId - The ID of the farmstand to delete
 * @returns true on success, throws Error on failure
 * @throws Error with message "AUTH_REQUIRED" if no valid session
 */
export async function safeDeleteFarmstand(farmstandId: string): Promise<boolean> {
  const session = await getValidSession();

  if (!session?.access_token) {
    console.log('[safeDeleteFarmstand] No valid session available');
    throw new Error('AUTH_REQUIRED');
  }

  console.log('[safeDeleteFarmstand] Deleting farmstand:', farmstandId);

  const { error } = await supabase
    .from('farmstands')
    .delete()
    .eq('id', farmstandId)
    .execute();

  if (error) {
    console.log('[safeDeleteFarmstand] Delete error:', error.message);
    throw new Error(error.message || 'Failed to delete farmstand');
  }

  console.log('[safeDeleteFarmstand] Success');
  return true;
}

/**
 * Upload an avatar image to Supabase Storage and persist the URL in profiles.avatar_url
 *
 * @param userId  - The authenticated user's Supabase UUID
 * @param fileUri - The local file URI from expo-image-picker
 * @returns The permanent public URL on success, null on failure
 */
export async function uploadAvatarAndPersist(
  userId: string,
  fileUri: string
): Promise<{ url: string | null; error: SupabaseError | null }> {
  if (!isSupabaseConfigured()) {
    return { url: null, error: { name: 'Error', message: 'Supabase not configured' } as SupabaseError };
  }

  // 1. Upload to storage bucket 'avatars'
  const path = `${userId}/${Date.now()}.jpg`;
  console.log('[Avatar] Uploading to avatars bucket, path:', path);
  const { url: publicUrl, error: uploadError } = await uploadToSupabaseStorage('avatars', path, fileUri, 'image/jpeg');

  if (uploadError || !publicUrl) {
    console.log('[Avatar] Storage upload failed:', uploadError?.message);
    return { url: null, error: uploadError };
  }

  console.log('[Avatar] Upload success, URL:', publicUrl);

  // 2. Update the profiles row with avatar_url using uid column
  const url = new URL(`${supabaseUrl}/rest/v1/profiles`);
  url.searchParams.set('uid', `eq.${userId}`);
  try {
    const { key: authKey } = await getValidAuthKey();
    const response = await fetch(url.toString(), {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${authKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ avatar_url: publicUrl }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log('[Avatar] profiles upsert failed:', response.status, errorText);
      const err = parseSupabaseError(response.status, errorText);
      // Return the URL even if the DB write fails — user still uploaded the image.
      // Caller should surface the error so it can be investigated (likely RLS).
      return { url: publicUrl, error: err };
    }

    console.log('[Avatar] profiles.avatar_url updated successfully');
    return { url: publicUrl, error: null };
  } catch (err) {
    console.log('[Avatar] profiles upsert exception:', err instanceof Error ? err.message : String(err));
    return {
      url: publicUrl,
      error: { name: 'Error', message: err instanceof Error ? err.message : 'DB update failed' } as SupabaseError,
    };
  }
}

/**
 * Fetch avatar_url from profiles for a given user ID.
 * Returns null if the row doesn't exist or avatar_url is not set.
 */
export async function fetchProfileAvatarUrl(userId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { key: authKey } = await getValidAuthKey();
    const url = new URL(`${supabaseUrl}/rest/v1/profiles`);
    url.searchParams.set('uid', `eq.${userId}`);
    url.searchParams.set('select', 'avatar_url');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${authKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log('[Avatar] fetchProfileAvatarUrl failed:', response.status, errorText);
      return null;
    }

    const data = await response.json() as Array<{ avatar_url: string | null }>;
    const avatarUrl = data?.[0]?.avatar_url ?? null;
    console.log('[Avatar] fetchProfileAvatarUrl result:', avatarUrl ? 'found' : 'null');
    return avatarUrl;
  } catch (err) {
    console.log('[Avatar] fetchProfileAvatarUrl exception:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Safe deny claim request - ensures session is fresh before making the request
 *
 * @param claimId - The ID of the claim request to deny
 * @returns true on success, throws Error on failure
 * @throws Error with message "AUTH_REQUIRED" if no valid session
 */
export async function safeDenyClaimRequest(claimId: string): Promise<boolean> {
  // Use getValidSession() for bulletproof session handling
  const session = await getValidSession();

  if (!session?.access_token) {
    console.log('[safeDenyClaimRequest] No valid session. sessionLoaded:', sessionLoaded,
      'currentSession:', currentSession ? `{access_token: ..., expires_at: ${currentSession.expires_at}}` : 'null');
    throw new Error('AUTH_REQUIRED');
  }

  console.log('[safeDenyClaimRequest] Session ready, calling RPC deny_claim:', claimId);

  // Call the deny_claim RPC function
  const { error } = await supabase.rpc('deny_claim', { p_claim_id: claimId });

  if (error) {
    console.log('[safeDenyClaimRequest] RPC error:', error.message);
    throw new Error(error.message || 'Failed to deny claim');
  }

  console.log('[safeDenyClaimRequest] Success');
  return true;
}
