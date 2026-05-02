/**
 * Push Notifications Service
 *
 * Handles:
 * - Requesting notification permissions
 * - Getting Expo push tokens
 * - Registering tokens to Supabase (user_push_tokens table)
 * - Syncing notification preferences to Supabase (user_notification_prefs table)
 *
 * IMPORTANT: Push notifications only work in dev builds and TestFlight, NOT in Expo Go.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured, getValidSession } from './supabase';

/**
 * Set the global notification handler.
 *
 * MUST be called inside a React useEffect (after native modules are ready),
 * never at module scope — calling it before native init causes SIGABRT on
 * first-install iOS cold launch.
 */
export function initNotificationHandler(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    if (__DEV__) console.log('[Startup] push init done');
  } catch (e) {
    if (__DEV__) console.log('[Startup] push init fail (non-fatal):', e instanceof Error ? e.message : String(e));
  }
}

// Types for Supabase tables
export interface UserPushToken {
  id?: string;
  user_id: string;
  expo_push_token: string;
  device_os: 'ios' | 'android' | 'web';
  last_seen_at: string;
  created_at?: string;
}

export interface UserNotificationPrefs {
  id?: string;
  user_id: string;
  messages: boolean;
  new_farmstands: boolean;
  seasonal_products: boolean;
  saved_farm_updates: boolean;
  promotions: boolean;
  app_updates: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Get the Expo project ID for push token registration.
 *
 * Priority order:
 * 1. Constants.easConfig.projectId  — set by EAS CLI at build time (correct in TestFlight)
 * 2. Constants.expoConfig.extra.eas.projectId — from app.json, only if it's not the placeholder
 */
function getProjectId(): string | undefined {
  // EAS sets this at build time — always correct in TestFlight / production builds
  const easProjectId = (Constants as { easConfig?: { projectId?: string } })?.easConfig?.projectId;

  // app.json value — skip if it's still the template placeholder
  const appJsonProjectId = Constants?.expoConfig?.extra?.eas?.projectId as string | undefined;
  const validAppJsonId =
    appJsonProjectId && !appJsonProjectId.startsWith('YOUR_') && !appJsonProjectId.includes('_PROJECT_ID')
      ? appJsonProjectId
      : undefined;

  const resolved = easProjectId ?? validAppJsonId;
  console.log(
    `[PushDebug] getProjectId — easConfig=${easProjectId ?? '(not set)'} appJson=${appJsonProjectId ?? '(not set)'} resolved=${resolved ?? '(undefined)'}`
  );
  return resolved;
}

/**
 * Check if push notifications are supported on this device/environment
 * Returns false for simulators, Expo Go, and web
 */
export function isPushNotificationsSupported(): boolean {
  // Must be a physical device
  if (!Device.isDevice) {
    console.log('[PushNotifications] Not supported: not a physical device');
    return false;
  }

  // Check for project ID (required for Expo push tokens)
  const projectId = getProjectId();
  if (!projectId) {
    console.log('[PushNotifications] Not supported: no project ID (likely Expo Go)');
    return false;
  }

  return true;
}

/**
 * Request notification permissions from the user
 * Returns the permission status
 */
export async function requestNotificationPermissions(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();

    if (existingStatus === 'granted') {
      console.log('[PushNotifications] Permission already granted');
      return 'granted';
    }

    const { status } = await Notifications.requestPermissionsAsync();
    console.log('[PushNotifications] Permission request result:', status);
    return status;
  } catch (error) {
    console.log('[PushNotifications] Error requesting permissions:', error);
    return 'denied';
  }
}

/**
 * Get the Expo push token for this device
 * Returns null if not supported or permission denied
 */
export async function getExpoPushToken(): Promise<string | null> {
  const tag = '[GetExpoPushToken]';
  const isDevice = Device.isDevice;
  const projectId = getProjectId();

  console.log(`[PushDebug] isDevice: ${isDevice}`);
  console.log(`[PushDebug] projectId: ${projectId ?? '(undefined)'}`);
  console.log(`${tag} isDevice=${isDevice} projectId=${projectId ?? '(none)'}`);

  if (!isDevice) {
    console.log(`[PushDebug] SKIP — Device.isDevice is false (simulator or Expo Go)`);
    console.log(`${tag} SKIP — Device.isDevice is false (simulator or Expo Go)`);
    return null;
  }

  if (!projectId) {
    console.log(`[PushDebug] SKIP — projectId is undefined (Expo Go or missing EAS config)`);
    console.log(`${tag} SKIP — no projectId (Expo Go or missing EAS config)`);
    return null;
  }

  try {
    console.log(`${tag} calling Notifications.getExpoPushTokenAsync with projectId=${projectId}`);
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResponse.data;
    console.log(`[PushDebug] TOKEN SUCCESS: ${token}`);
    console.log(`${tag} SUCCESS — token=${token}`);
    return token;
  } catch (e) {
    console.log(`[PushDebug] TOKEN ERROR: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`${tag} ERROR — getExpoPushTokenAsync threw:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Sync the current Expo push token into profiles.expo_push_token.
 *
 * This is the authoritative single-token source for claim-related push
 * notifications. Call this on app start, login, and app foreground so the
 * backend always finds the exact claimant's current device token.
 *
 * Does nothing (gracefully) if:
 *  - Supabase is not configured
 *  - User is not authenticated
 *  - Device doesn't support push notifications
 *  - Notification permission is denied
 */
export async function syncProfilePushToken(userId: string, userEmail?: string): Promise<void> {
  const tag = '[ProfilePushSync]';
  console.log(`${tag} START — userId=${userId} email=${userEmail ?? '(unknown)'}`);

  if (!isSupabaseConfigured()) {
    console.log(`${tag} SKIP — Supabase not configured`);
    return;
  }

  // Permission check — get existing, then request if not already granted
  let existingStatus: string;
  let finalStatus: string;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    existingStatus = status;
    console.log(`[PushDebug] existing permission: ${existingStatus}`);
    console.log(`${tag} notification permission (existing)=${existingStatus}`);

    if (existingStatus !== 'granted') {
      const { status: requested } = await Notifications.requestPermissionsAsync();
      finalStatus = requested;
    } else {
      finalStatus = existingStatus;
    }
    console.log(`[PushDebug] final permission: ${finalStatus}`);
    console.log(`${tag} notification permission (final)=${finalStatus}`);
  } catch (err) {
    console.log(`${tag} SKIP — could not read permission: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (finalStatus !== 'granted') {
    console.log(`${tag} SKIP — permission not granted (finalStatus=${finalStatus})`);
    return;
  }

  // Get Expo push token
  let token: string | null = null;
  try {
    token = await getExpoPushToken();
    console.log(`${tag} expo push token = ${token ?? 'null'}`);
  } catch (err) {
    console.log(`${tag} SKIP — getExpoPushToken error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!token) {
    console.log(`[PushDebug] SKIP — no push token returned (simulator or Expo Go)`);
    console.log(`${tag} SKIP — no push token returned (simulator or Expo Go)`);
    return;
  }

  // Get session for auth header
  let accessToken: string | null = null;
  try {
    const session = await getValidSession();
    accessToken = session?.access_token ?? null;
  } catch {
    // ignore
  }

  if (!accessToken) {
    console.log(`${tag} SKIP — no valid session`);
    return;
  }

  // POST to backend /api/push/sync-token — uses service role to write profiles.expo_push_token
  // and evict the same physical token from all other users' profiles + user_push_tokens rows.
  const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
  const syncUrl = `${backendUrl}/api/push/sync-token`;
  console.log(`[PushDebug] sending token to backend: ${token}`);
  console.log(`${tag} POST ${syncUrl} — backendUrl="${backendUrl || '(EMPTY — will fail)'}"`);
  if (!backendUrl) {
    console.log(`${tag} ABORT — EXPO_PUBLIC_VIBECODE_BACKEND_URL is not set`);
    return;
  }
  try {
    const res = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });
    console.log(`[PushDebug] backend response: ${res.status}`);
    console.log(`${tag} backend responded HTTP ${res.status}`);
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { evictedProfileCount?: number; evictedTokenRowCount?: number; rowsUpdated?: number };
      console.log(
        `${tag} SUCCESS — backend synced token for userId=${userId}` +
        ` evictedProfiles=${json.evictedProfileCount ?? 0}` +
        ` evictedTokenRows=${json.evictedTokenRowCount ?? 0}` +
        ` rowsUpdated=${json.rowsUpdated ?? '(not reported)'}`
      );
    } else {
      const body = await res.text().catch(() => '');
      console.log(`${tag} FAIL — backend HTTP ${res.status}: ${body}`);
    }
  } catch (err) {
    console.log(`${tag} EXCEPTION — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * @internal helper — write a known token directly to profiles without re-fetching it.
 * Called from registerPushToken after a successful user_push_tokens upsert.
 */
async function syncPushTokenToProfile(userId: string, pushToken: string): Promise<void> {
  const tag = '[ProfilePushSync]';
  if (!isSupabaseConfigured()) return;
  let accessToken: string | null = null;
  try {
    const session = await getValidSession();
    accessToken = session?.access_token ?? null;
  } catch { /* ignore */ }
  if (!accessToken) return;

  const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
  try {
    const res = await fetch(`${backendUrl}/api/push/sync-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: pushToken }),
    });
    if (res.ok) {
      console.log(`${tag} profiles.expo_push_token synced (from registerPushToken) for userId=${userId}`);
    } else {
      const body = await res.text().catch(() => '');
      console.log(`${tag} profiles sync failed HTTP ${res.status}: ${body}`);
    }
  } catch (err) {
    console.log(`${tag} profiles sync exception: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Register the push token to Supabase for a user
 * Creates or updates the user_push_tokens record
 */
export async function registerPushToken(userId: string, pushToken: string): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    console.log('[PushNotifications] Supabase not configured, skipping token registration');
    return false;
  }

  const deviceOs = Platform.OS as 'ios' | 'android' | 'web';
  const now = new Date().toISOString();

  try {
    // First, try to find existing token for this user+device
    const { data: existing, error: fetchError } = await supabase
      .from<UserPushToken>('user_push_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('device_os', deviceOs)
      .execute();

    if (fetchError) {
      console.log('[PushNotifications] Error checking existing token:', fetchError);
    }

    if (existing && existing.length > 0) {
      // Update existing record
      const { error: updateError } = await supabase
        .from<UserPushToken>('user_push_tokens')
        .update({
          expo_push_token: pushToken,
          last_seen_at: now,
        })
        .eq('user_id', userId)
        .eq('device_os', deviceOs)
        .execute();

      if (updateError) {
        console.log('[PushNotifications] Error updating push token:', updateError);
        return false;
      }

      console.log('[PushNotifications] Updated push token in Supabase');
      await syncPushTokenToProfile(userId, pushToken);
      return true;
    } else {
      // Insert new record
      const { error: insertError } = await supabase
        .from<UserPushToken>('user_push_tokens')
        .insert({
          user_id: userId,
          expo_push_token: pushToken,
          device_os: deviceOs,
          last_seen_at: now,
        })
        .execute();

      if (insertError) {
        console.log('[PushNotifications] Error inserting push token:', insertError);
        return false;
      }

      console.log('[PushNotifications] Registered push token in Supabase');
      await syncPushTokenToProfile(userId, pushToken);
      return true;
    }
  } catch (error) {
    console.log('[PushNotifications] Error registering push token:', error);
    return false;
  }
}

/**
 * Ensure default notification preferences exist for a user
 * Creates the record if it doesn't exist with default values (messages=true)
 */
export async function ensureNotificationPrefs(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    console.log('[PushNotifications] Supabase not configured, skipping prefs check');
    return false;
  }

  try {
    // Check if prefs already exist
    const { data: existing, error: fetchError } = await supabase
      .from<UserNotificationPrefs>('user_notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .execute();

    if (fetchError) {
      console.log('[PushNotifications] Error checking existing prefs:', fetchError);
    }

    if (existing && existing.length > 0) {
      console.log('[PushNotifications] Notification prefs already exist');
      return true;
    }

    // Insert default prefs - messages enabled by default
    const { error: insertError } = await supabase
      .from<UserNotificationPrefs>('user_notification_prefs')
      .insert({
        user_id: userId,
        messages: true,
        new_farmstands: true,
        seasonal_products: true,
        saved_farm_updates: true,
        promotions: false,
        app_updates: true,
      })
      .execute();

    if (insertError) {
      console.log('[PushNotifications] Error inserting default prefs:', insertError);
      return false;
    }

    console.log('[PushNotifications] Created default notification prefs');
    return true;
  } catch (error) {
    console.log('[PushNotifications] Error ensuring notification prefs:', error);
    return false;
  }
}

/**
 * Update notification preferences in Supabase
 */
export async function updateNotificationPrefs(
  userId: string,
  prefs: Partial<Omit<UserNotificationPrefs, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    console.log('[PushNotifications] Supabase not configured, skipping prefs update');
    return false;
  }

  try {
    const { error } = await supabase
      .from<UserNotificationPrefs>('user_notification_prefs')
      .update({
        ...prefs,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .execute();

    if (error) {
      console.log('[PushNotifications] Error updating notification prefs:', error);
      return false;
    }

    console.log('[PushNotifications] Updated notification prefs in Supabase');
    return true;
  } catch (error) {
    console.log('[PushNotifications] Error updating notification prefs:', error);
    return false;
  }
}

/**
 * Get notification preferences from Supabase
 */
export async function getNotificationPrefs(userId: string): Promise<UserNotificationPrefs | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from<UserNotificationPrefs>('user_notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .execute();

    if (error) {
      console.log('[PushNotifications] Error fetching notification prefs:', error);
      return null;
    }

    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.log('[PushNotifications] Error fetching notification prefs:', error);
    return null;
  }
}

/**
 * Main initialization function - call this after user session is available
 * Handles the full flow:
 * 1. Request permissions (if not already granted)
 * 2. Get push token
 * 3. Register token to Supabase
 * 4. Ensure notification prefs exist
 *
 * Safe to call multiple times - will only request permissions once
 */
export async function initializePushNotifications(userId: string, opts?: { promptIfNeeded?: boolean }): Promise<{
  success: boolean;
  token: string | null;
  permissionStatus: 'granted' | 'denied' | 'undetermined';
}> {
  console.log('[PushNotifications] Initializing for user:', userId);

  // Check if supported (physical device with project ID)
  if (!isPushNotificationsSupported()) {
    console.log('[PushNotifications] Not supported on this device/environment');
    return {
      success: false,
      token: null,
      permissionStatus: 'undetermined',
    };
  }

  // Only show the iOS permission prompt when explicitly requested.
  // On all other call sites (app start, login, foreground sync), check current
  // status only — the Explore screen is the sole prompt entry point.
  let permissionStatus: 'granted' | 'denied' | 'undetermined';
  if (opts?.promptIfNeeded) {
    permissionStatus = await requestNotificationPermissions();
  } else {
    const { status } = await Notifications.getPermissionsAsync();
    permissionStatus = status as 'granted' | 'denied' | 'undetermined';
  }

  if (permissionStatus !== 'granted') {
    console.log('[PushNotifications] Permission not granted, skipping token registration');
    // Still ensure prefs exist even if permission denied (user can enable later)
    await ensureNotificationPrefs(userId);
    return {
      success: false,
      token: null,
      permissionStatus,
    };
  }

  // Get push token
  const token = await getExpoPushToken();

  if (!token) {
    console.log('[PushNotifications] Could not get push token');
    await ensureNotificationPrefs(userId);
    return {
      success: false,
      token: null,
      permissionStatus,
    };
  }

  // Register token and ensure prefs exist (in parallel)
  const [tokenRegistered, prefsCreated] = await Promise.all([
    registerPushToken(userId, token),
    ensureNotificationPrefs(userId),
  ]);

  console.log('[PushNotifications] Initialization complete:', {
    tokenRegistered,
    prefsCreated,
    token: token.substring(0, 30) + '...',
  });

  return {
    success: tokenRegistered && prefsCreated,
    token,
    permissionStatus,
  };
}

/**
 * Update last_seen_at timestamp for the user's push token
 * Call this periodically when app is active to keep token fresh
 */
export async function updatePushTokenLastSeen(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const deviceOs = Platform.OS as 'ios' | 'android' | 'web';

  try {
    await supabase
      .from<UserPushToken>('user_push_tokens')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('device_os', deviceOs)
      .execute();
  } catch (error) {
    // Silently fail - this is not critical
    console.log('[PushNotifications] Error updating last_seen_at:', error);
  }
}

/**
 * Remove push token for a user (call on sign out)
 */
export async function removePushToken(userId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const deviceOs = Platform.OS as 'ios' | 'android' | 'web';

  try {
    await supabase
      .from<UserPushToken>('user_push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('device_os', deviceOs)
      .execute();

    console.log('[PushNotifications] Removed push token for user');
  } catch (error) {
    console.log('[PushNotifications] Error removing push token:', error);
  }
}

// Notification response listeners (for handling notification taps)
let notificationResponseSubscription: Notifications.EventSubscription | null = null;
let notificationReceivedSubscription: Notifications.EventSubscription | null = null;

/**
 * Set up notification listeners
 * Returns cleanup function to remove listeners
 */
export function setupNotificationListeners(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationResponse?: (response: Notifications.NotificationResponse) => void
): () => void {
  // Handle notifications received while app is in foreground
  if (onNotificationReceived) {
    notificationReceivedSubscription = Notifications.addNotificationReceivedListener(
      onNotificationReceived
    );
  }

  // Handle notification tap (user interacted with notification)
  if (onNotificationResponse) {
    notificationResponseSubscription = Notifications.addNotificationResponseReceivedListener(
      onNotificationResponse
    );
  }

  // Cleanup function
  return () => {
    if (notificationReceivedSubscription) {
      if (typeof notificationReceivedSubscription.remove === 'function') notificationReceivedSubscription.remove();
      notificationReceivedSubscription = null;
    }
    if (notificationResponseSubscription) {
      if (typeof notificationResponseSubscription.remove === 'function') notificationResponseSubscription.remove();
      notificationResponseSubscription = null;
    }
  };
}

/**
 * Get the last notification response (for deep linking on app open from notification)
 */
export async function getLastNotificationResponse(): Promise<Notifications.NotificationResponse | null> {
  return await Notifications.getLastNotificationResponseAsync();
}
