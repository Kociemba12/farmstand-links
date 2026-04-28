import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { useAdminStatusStore, AdminStatus } from '@/lib/admin-status-store';
import { getValidSession, getSupabaseSession, getAdminAuthDebugInfo, debugSecureStore, forceReloadSession, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import Constants from 'expo-constants';

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * AdminGuard - Protects admin routes
 *
 * PRIMARY SOURCE OF TRUTH: useAuth() session (hydrated from SecureStore by AuthProvider).
 * The user-store isLoggedIn flag is NOT used to gate the session check because it can
 * lag behind the Supabase session hydration, causing false "Session Expired" screens.
 *
 * Access flow:
 * 1. Wait for AuthProvider to finish reading SecureStore (authLoading = false)
 * 2. Derive admin email from authUser (JWT-decoded, instant) OR user-store user (fallback)
 * 3. If admin email confirmed, call getValidSession() — auto-refreshes if token is stale
 * 4. If still no session, attempt one explicit refresh before showing "Session Expired"
 * 5. Only show "Session Expired" after all refresh attempts are exhausted
 */
export function AdminGuard({ children }: AdminGuardProps) {
  const router = useRouter();

  // User store — may lag behind Supabase session hydration on cold start
  const userStoreUser = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);

  // AuthProvider — primary source of truth: session is read from SecureStore on mount.
  // authUser.email is decoded directly from the JWT so it is available as soon as
  // authLoading becomes false, even if the user-store hasn't synced yet.
  const { loading: authLoading, session: authSession, user: authUser, refreshSession, sessionReady } = useAuth();

  const adminStatus = useAdminStatusStore((s) => s.status);
  const checkAdminStatus = useAdminStatusStore((s) => s.checkAdminStatus);
  const lastCheckedEmail = useAdminStatusStore((s) => s.lastCheckedEmail);

  // Session validation state
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(false);
  // Track whether we have already attempted a forced refresh this mount cycle
  const [refreshAttempted, setRefreshAttempted] = useState(false);

  // Derive email from BOTH sources. authUser is available the moment authLoading = false
  // (decoded from JWT); userStoreUser may not be set yet on cold start.
  const userEmail = userStoreUser?.email ?? authUser?.email;
  const isAdmin = isAdminEmail(userEmail);

  // Log on mount so we know when the admin screen opened
  useEffect(() => {
    // Build/EAS diagnostics — shows in TestFlight Xcode console
    const easProjectId: string =
      (Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.eas
        ? ((Constants.expoConfig?.extra as { eas?: { projectId?: string } }).eas?.projectId ?? 'NOT_SET')
        : 'NOT_SET';
    console.log('[ADMIN_ACCESS][MOUNT] === ADMIN GUARD MOUNT ===');
    console.log('[ADMIN_ACCESS][MOUNT] EAS project ID   :', easProjectId);
    console.log('[ADMIN_ACCESS][MOUNT] App slug         :', Constants.expoConfig?.slug ?? 'UNKNOWN');
    console.log('[ADMIN_ACCESS][MOUNT] App version      :', Constants.expoConfig?.version ?? 'UNKNOWN');
    console.log('[ADMIN_ACCESS][MOUNT] __DEV__          :', __DEV__);
    console.log('[ADMIN_ACCESS][MOUNT] Backend URL      :', process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || process.env.EXPO_PUBLIC_BACKEND_URL || 'NOT_SET');
    console.log('[ADMIN_ACCESS][MOUNT] authLoading      :', authLoading);
    console.log('[ADMIN_ACCESS][MOUNT] sessionReady     :', sessionReady);
    console.log('[ADMIN_ACCESS][MOUNT] authUser.email   :', authUser?.email ?? 'NONE');
    console.log('[ADMIN_ACCESS][MOUNT] authUser.id      :', authUser?.id ?? 'NONE');
    console.log('[ADMIN_ACCESS][MOUNT] userStore.email  :', userStoreUser?.email ?? 'NONE');
    console.log('[ADMIN_ACCESS][MOUNT] isAdmin          :', isAdminEmail(authUser?.email ?? userStoreUser?.email));
  }, []);

  // Verify Supabase session — runs once AuthProvider hydration is complete.
  // IMPORTANT: do NOT gate this on isLoggedIn — that flag can lag behind the real session.
  useEffect(() => {
    if (authLoading) return; // Hold until SecureStore has been read

    let mounted = true;

    const checkSession = async () => {
      setSessionChecked(false);

      // --- Debug logging ---
      console.log('[ADMIN_ACCESS][CHECK_START] ── checkSession START ──');

      // 1. Log auth state values
      console.log('[ADMIN_ACCESS][AUTH_STATE]'
        + ' authUser.email=' + (authUser?.email ?? 'NONE')
        + ', authUser.id=' + (authUser?.id ?? 'NONE')
        + ', isAdmin=' + isAdmin
        + ', authLoading=' + authLoading
        + ', sessionReady=' + sessionReady
        + ', isLoggedIn(store)=' + isLoggedIn
        + ', refreshAttempted=' + refreshAttempted);

      // 2. Synchronous in-memory snapshot BEFORE any async call
      const memSession = getSupabaseSession();
      const nowSeconds = Math.floor(Date.now() / 1000);
      console.log('[ADMIN_ACCESS][MEM_SESSION]'
        + ' getSupabaseSession()='
        + (memSession ? 'EXISTS' : 'NULL')
        + ', expires_at=' + (memSession?.expires_at ?? 'N/A')
        + ', now=' + nowSeconds
        + ', secondsLeft=' + (memSession?.expires_at ? memSession.expires_at - nowSeconds : 'N/A')
        + ', refresh_token=' + (memSession?.refresh_token ? 'EXISTS' : 'NONE')
        + ', access_token_prefix=' + (memSession?.access_token ? memSession.access_token.slice(0, 12) + '…' : 'NONE'));

      if (!memSession) {
        console.log('[ADMIN_ACCESS][SESSION_NULL_AT_ADMIN_CHECK] In-memory session is NULL before any async check');
      } else if (memSession.expires_at && nowSeconds >= memSession.expires_at) {
        console.log('[ADMIN_ACCESS][SESSION_EXPIRED_AT_ADMIN_CHECK]'
          + ' Token expired — expires_at=' + memSession.expires_at
          + ', now=' + nowSeconds
          + ', overdue_by=' + (nowSeconds - memSession.expires_at) + 's');
      }

      // Also log the AuthProvider authSession for comparison
      console.log('[ADMIN_ACCESS][AUTH_PROVIDER_SESSION]'
        + ' authSession exists=' + !!(authSession?.access_token)
        + ', authUser.email=' + (authUser?.email ?? 'NONE')
        + ', authUser.id=' + (authUser?.id ?? 'NONE')
        + ', userStoreUser.email=' + (userStoreUser?.email ?? 'NONE'));

      if (!isSupabaseConfigured()) {
        console.log('[ADMIN_ACCESS] Supabase not configured — bypassing session check');
        if (mounted) { setHasValidSession(true); setSessionChecked(true); }
        return;
      }

      // FAST PATH: AuthProvider already has a valid, non-expired session in React state.
      // AuthProvider is the canonical source of truth: it read SecureStore during initSession
      // and stays in sync via 1-second polling + notifySessionChanged().
      // If authSession is present and not expired, trust it directly — no async round-trip needed.
      if (authSession?.access_token) {
        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAt = authSession.expires_at ?? 0;
        const isExpired = expiresAt > 0 && nowSec >= expiresAt;
        if (!isExpired) {
          console.log('[ADMIN_ACCESS][FAST_PATH] authSession is valid (email='
            + (authUser?.email ?? 'NONE')
            + ', expires_in=' + (expiresAt > 0 ? expiresAt - nowSec : 'N/A') + 's)'
            + ' — granting admin access without getValidSession()');
          if (mounted) { setHasValidSession(true); setSessionChecked(true); }
          return;
        }
        console.log('[ADMIN_ACCESS][FAST_PATH] authSession exists but token is expired'
          + ' (expires_at=' + expiresAt + ', now=' + nowSec + ', overdue_by=' + (nowSec - expiresAt) + 's)'
          + ' — falling through to refresh path');
      } else {
        console.log('[ADMIN_ACCESS][FAST_PATH] authSession is null — proceeding with getValidSession() recovery');
      }

      // 3. Call getValidSession() (async — auto-refreshes if needed)
      let session = await getValidSession();

      console.log('[ADMIN_ACCESS][GET_VALID_SESSION]'
        + ' hasSession=' + !!(session?.access_token)
        + ', expires_at=' + (session?.expires_at ?? 'N/A')
        + ', refresh_token=' + (session?.refresh_token ? 'EXISTS' : 'NONE'));

      if (!session) {
        console.log('[ADMIN_ACCESS][SESSION_NULL_AT_ADMIN_CHECK] getValidSession() returned NULL after async check');
      }

      // RECOVERY STEP: If session is null but authUser exists, the in-memory session was
      // likely cleared by invalid_grant while SecureStore may still hold a valid token.
      // Force-reload from SecureStore before attempting a network refresh.
      if (!session?.access_token && authUser?.email) {
        console.log('[ADMIN_ACCESS][RECOVERY] authUser exists but session is null — attempting forceReloadSession()...');
        session = await forceReloadSession();
        if (session?.access_token) {
          console.log('[ADMIN_ACCESS][RECOVERY_SUCCESS] Session recovered from SecureStore — proceeding normally');
        } else {
          console.log('[ADMIN_ACCESS][RECOVERY_FAILED] SecureStore also empty — will try AuthProvider refresh next');
        }
      }

      // 4. If no valid session, attempt one explicit refresh before giving up
      if (!session?.access_token && !refreshAttempted) {
        console.log('[ADMIN_ACCESS][REFRESH_ATTEMPT] No valid session — attempting AuthProvider.refreshSession()...');
        if (mounted) setRefreshAttempted(true);
        const refreshed = await refreshSession();
        console.log('[ADMIN_ACCESS][REFRESH_RESULT] AuthProvider.refreshSession()=' + refreshed);
        if (refreshed) {
          session = await getValidSession();
          console.log('[ADMIN_ACCESS][POST_REFRESH]'
            + ' hasSession=' + !!(session?.access_token)
            + ', expires_at=' + (session?.expires_at ?? 'N/A'));
        } else {
          console.log('[ADMIN_ACCESS][REFRESH_FAILED] Refresh returned false — possible invalid_grant or no stored token');
        }
      }

      // 5. Run full debug dump (SecureStore + memory + expiry) — logs internally
      console.log('[ADMIN_ACCESS][DEBUG_DUMP_START] Running getAdminAuthDebugInfo...');
      await getAdminAuthDebugInfo();

      console.log('[ADMIN_ACCESS][SECURE_STORE_CHECK] Running debugSecureStore...');
      await debugSecureStore();

      const valid = !!(session?.access_token);
      console.log('[ADMIN_ACCESS][FINAL_DECISION]'
        + ' isAdmin=' + isAdmin
        + ', hasValidSession=' + valid
        + ', admin_access_granted=' + (isAdmin && valid));

      if (!valid) {
        console.log('[ADMIN_ACCESS][ACCESS_DENIED]'
          + ' Reason: no valid session after all refresh attempts'
          + ' — isAdmin=' + isAdmin
          + ', refreshAttempted=' + refreshAttempted
          + ', memSession_was_null=' + !memSession
          + ' → will show "Session Expired" screen');
      }

      if (mounted) {
        setHasValidSession(valid);
        setSessionChecked(true);
      }
    };

    if (isAdmin) {
      // Admin email confirmed — check session regardless of user-store isLoggedIn state.
      // Synchronously reset state BEFORE calling async checkSession() to prevent a single
      // render frame where isAdmin=true, sessionChecked=true (from the previous not-admin
      // run), hasValidSession=false — which would flash "Session Expired" incorrectly.
      setSessionChecked(false);
      setHasValidSession(false);
      console.log('[ADMIN_ACCESS][AUTH_READY] authLoading just became false — starting session check'
        + ', sessionReady=' + sessionReady
        + ', isAdmin=' + isAdmin
        + ', email=' + (userEmail ?? 'NONE'));
      checkSession();
    } else {
      // Not the admin email — skip session check
      console.log(
        '[AUTH_DEBUG][AdminGuard] Not admin — skipping session check'
          + ', userEmail=' + (userEmail ?? 'NONE')
          + ', authUser.email=' + (authUser?.email ?? 'NONE')
          + ', userStoreUser.email=' + (userStoreUser?.email ?? 'NONE')
          + ', sessionReady=' + sessionReady
          + ', isAdmin=' + isAdmin,
      );
      setSessionChecked(true);
      setHasValidSession(false);
    }

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin, userEmail, authSession]);
  // NOTE: refreshAttempted intentionally excluded — it is only a one-shot guard within
  // a single mount cycle. Including it would cause a re-run loop.
  // NOTE: authSession is included so the fast path fires when AuthProvider sets the session
  // after the effect first ran with a null session (race condition on cold start).

  // Keep admin-status-store in sync when email changes
  useEffect(() => {
    const email = userEmail?.toLowerCase().trim() ?? null;
    if (email && email !== lastCheckedEmail) {
      checkAdminStatus(userEmail);
    } else if (!userEmail && adminStatus === 'loading') {
      checkAdminStatus(null);
    }
  }, [userEmail, lastCheckedEmail, checkAdminStatus, adminStatus]);

  // Redirect non-admin logged-in users to profile
  useEffect(() => {
    if (isLoggedIn && userStoreUser && !isAdmin && adminStatus === 'not_admin') {
      console.log('[AdminGuard] Non-admin user accessing admin route — redirecting to profile');
      router.replace('/(tabs)/profile');
    }
  }, [isLoggedIn, userStoreUser, isAdmin, adminStatus, router]);

  // --- Render logic ---

  // Wait for AuthProvider to finish reading SecureStore
  if (authLoading) {
    console.log('[AUTH_DEBUG][AdminGuard] RENDER: "Loading session..." — authLoading=true, sessionReady=' + sessionReady);
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-sm text-gray-500 mt-4">Loading session...</Text>
      </View>
    );
  }

  // Not the admin email AND not logged in — show login prompt
  if (!isAdmin && (!isLoggedIn || !userStoreUser)) {
    console.log('[AUTH_DEBUG][AdminGuard] RENDER: "Login Required"'
      + ' — isAdmin=' + isAdmin
      + ', isLoggedIn=' + isLoggedIn
      + ', userStoreUser=' + (userStoreUser ? userStoreUser.email : 'NULL')
      + ', authUser.email=' + (authUser?.email ?? 'NULL')
      + ', sessionReady=' + sessionReady);
    return (
      <View className="flex-1 items-center justify-center bg-white p-6">
        <Text className="text-lg font-semibold text-gray-900 text-center">
          Login Required
        </Text>
        <Text className="text-sm text-gray-500 text-center mt-2">
          Please log in to access the Admin Dashboard.
        </Text>
        <Pressable
          onPress={() => router.replace('/auth/login')}
          className="mt-6 bg-green-700 px-8 py-3 rounded-xl"
        >
          <Text className="text-white font-semibold text-base">Go to Sign In</Text>
        </Pressable>
      </View>
    );
  }

  // Admin email confirmed — await session validation
  if (isAdmin) {
    // Still verifying session
    if (!sessionChecked) {
      console.log('[AUTH_DEBUG][AdminGuard] RENDER: "Verifying session..." — isAdmin=true, sessionChecked=false, sessionReady=' + sessionReady);
      return (
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator size="large" color="#16a34a" />
          <Text className="text-sm text-gray-500 mt-4">Verifying session...</Text>
        </View>
      );
    }

    // Admin email confirmed but session is missing / expired after refresh attempt
    if (!hasValidSession) {
      console.log('[AUTH_DEBUG][AdminGuard] RENDER: *** SESSION EXPIRED SCREEN ***'
        + ' — isAdmin=true, sessionChecked=true, hasValidSession=false'
        + ', sessionReady=' + sessionReady
        + ', authSession exists=' + !!(authSession?.access_token)
        + ', authUser.email=' + (authUser?.email ?? 'NULL')
        + ', refreshAttempted=' + refreshAttempted
        + ' ← READ LOGS ABOVE TO SEE WHICH getValidSession() PATH RETURNED NULL');
      return (
        <View className="flex-1 items-center justify-center bg-white p-6">
          <Text className="text-lg font-semibold text-gray-900 text-center">
            Session Expired
          </Text>
          <Text className="text-sm text-gray-500 text-center mt-2">
            Your admin session has expired or is missing from this device.{'\n'}
            Please sign in again to continue.
          </Text>
          <Pressable
            onPress={() => router.replace('/auth/login')}
            className="mt-6 bg-green-700 px-8 py-3 rounded-xl"
          >
            <Text className="text-white font-semibold text-base">Sign In Again</Text>
          </Pressable>
        </View>
      );
    }

    // Valid session confirmed — render admin content
    console.log('[AUTH_DEBUG][AdminGuard] RENDER: admin content — session valid');
    return <>{children}</>;
  }

  // Still resolving admin status
  if (adminStatus === 'loading') {
    console.log('[AUTH_DEBUG][AdminGuard] RENDER: "Checking access..." — adminStatus=loading, isAdmin=' + isAdmin);
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-sm text-gray-500 mt-4">Checking access...</Text>
      </View>
    );
  }

  // Logged-in user who is not the admin email
  return (
    <View className="flex-1 items-center justify-center bg-white p-6">
      <Text className="text-lg font-semibold text-gray-900 text-center">
        Not Authorized
      </Text>
      <Text className="text-sm text-gray-500 text-center mt-2">
        Admin access is restricted to contact@farmstand.online
      </Text>
    </View>
  );
}

/**
 * Helper hook to get admin status
 * ONLY checks email === "contact@farmstand.online"
 */
export function useIsAdmin(): { status: AdminStatus; isAdmin: boolean; isLoading: boolean } {
  const status = useAdminStatusStore((s) => s.status);
  const user = useUserStore((s) => s.user);

  // Admin is determined ONLY by email
  const isAdmin = isAdminEmail(user?.email);

  return {
    status: isAdmin ? 'admin' : status,
    isAdmin,
    isLoading: !isAdmin && status === 'loading',
  };
}
