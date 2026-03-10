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
import { Platform, AppState, type AppStateStatus } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
 * Get the Expo project ID for push token registration
 */
function getProjectId(): string | undefined {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ??
    Constants?.easConfig?.projectId
  );
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
  if (!isPushNotificationsSupported()) {
    return null;
  }

  const projectId = getProjectId();
  if (!projectId) {
    console.log('[PushNotifications] No project ID available');
    return null;
  }

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    console.log('[PushNotifications] Got push token:', tokenResponse.data.substring(0, 30) + '...');
    return tokenResponse.data;
  } catch (error) {
    console.log('[PushNotifications] Error getting push token:', error);
    return null;
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
export async function initializePushNotifications(userId: string): Promise<{
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

  // Request permissions
  const permissionStatus = await requestNotificationPermissions();

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
      Notifications.removeNotificationSubscription(notificationReceivedSubscription);
      notificationReceivedSubscription = null;
    }
    if (notificationResponseSubscription) {
      Notifications.removeNotificationSubscription(notificationResponseSubscription);
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
