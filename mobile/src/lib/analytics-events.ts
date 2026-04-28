/**
 * Supabase Analytics Event Logger - CENTRALIZED ANALYTICS HELPER
 *
 * This is the SINGLE source of truth for all analytics events.
 * Use logEvent() or the convenience functions for all analytics tracking.
 *
 * Logs events to the public.analytics_events table in Supabase.
 * Never blocks UX - fails silently with console logging.
 *
 * SUPABASE TABLE SCHEMA (analytics_events):
 * - event_name (text) - the event type
 * - user_id (uuid, nullable) - logged-in user ID
 * - device_id (text, nullable) - persistent device identifier
 * - farmstand_id (uuid, nullable) - TOP-LEVEL for farmstand-related events
 * - screen (text, nullable) - current screen name
 * - properties (jsonb, nullable) - includes platform, app_version, and other metadata
 * - created_at (timestamp, default now())
 *
 * AUTOMATICALLY ATTACHED TO ALL EVENTS:
 * - user_id (if logged in)
 * - platform ("ios" | "android" | "web")
 * - app_version (from Expo constants)
 * - device_id (persistent)
 *
 * PLATFORM/NAVIGATION EVENTS (farmstandId can be null):
 * - app_open, explore_open, map_open, profile_open, search
 *
 * FARMSTAND-RELATED EVENTS (always include farmstand_id):
 * - farmstand_view, save_toggle, directions_tap, call_tap, website_tap
 * - share_tap, message_farmstand, product_click
 * - claim_start, claim_submit
 * - farmstand_create, farmstand_edit, farmstand_delete
 * - review_create, photo_upload_success, photo_upload_fail
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase, isSupabaseConfigured } from './supabase';

// UUID validation helper - only send user_id to Supabase if it's a valid UUID
// This prevents PostgREST cast errors when inserting into analytics_events table
const isUuid = (v?: string | null): boolean =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

// Get platform string for analytics
const getPlatform = (): string => {
  return Platform.OS; // 'ios' | 'android' | 'web'
};

// Get app version from Expo constants
const getAppVersion = (): string | null => {
  return Constants.expoConfig?.version || null;
};

// Event types - keep these exact for consistency
// Platform events: app_open, explore_open, map_open, profile_open, search
// Farmstand events: farmstand_view, save_toggle, directions_tap, call_tap, website_tap,
//                   share_tap, message_farmstand, product_click, claim_start, claim_submit
export type AnalyticsEventType =
  // Platform/Navigation events
  | 'app_open'
  | 'explore_open'
  | 'map_open'
  | 'profile_open'
  | 'screen_view'
  | 'search'
  // User lifecycle
  | 'signup_start'
  | 'signup_complete'
  | 'location_permission_granted'
  | 'location_permission_denied'
  // Search/Filter
  | 'filter_change'
  | 'radius_change'
  | 'product_chip_tap'
  // Farmstand events (always include farmstand_id)
  | 'farmstand_view'
  | 'farmstand_save'
  | 'save_toggle'
  | 'product_click'
  | 'directions_tap'
  | 'call_tap'
  | 'website_tap'
  | 'share_tap'
  | 'message_tap'
  | 'message_farmstand'
  // Claim events (always include farmstand_id)
  | 'claim_request'
  | 'claim_start'
  | 'claim_submit'
  | 'claim_approved'
  | 'claim_denied'
  // Farmstand management
  | 'farmstand_create'
  | 'farmstand_edit'
  | 'farmstand_delete'
  | 'photo_upload_success'
  | 'photo_upload_fail'
  // Reviews & Reports
  | 'review_create'
  | 'report_create'
  | 'report_resolve'
  | 'error_event';

// Keep old type alias for backward compatibility
export type AnalyticsEventName = AnalyticsEventType;

// Internal event type with all rich data
export interface AnalyticsEventInternal {
  event_name: AnalyticsEventType;
  user_id: string | null;
  device_id: string | null;
  farmstand_id: string | null;
  screen: string | null;
  properties: Record<string, unknown> | null;
}

// DB payload type matching Supabase table schema
// Table has: event_name (text), user_id (uuid), device_id (text), farmstand_id (uuid), screen (text), properties (jsonb), created_at
export interface AnalyticsEventDB {
  event_name: string;
  user_id: string | null;
  device_id: string | null;
  farmstand_id: string | null;
  screen: string | null;
  properties: Record<string, unknown> | null;
}

// Convert internal event to DB payload
// IMPORTANT: Only include user_id and farmstand_id if they are valid UUIDs
// to prevent PostgREST cast errors (e.g., "admin-user" cannot be cast to UUID)
function toDbEvent(e: AnalyticsEventInternal): AnalyticsEventDB {
  return {
    event_name: e.event_name,
    // Only send user_id if it's a valid UUID, otherwise null
    user_id: isUuid(e.user_id) ? e.user_id : null,
    device_id: e.device_id ?? null,
    // Only send farmstand_id if it's a valid UUID, otherwise null
    farmstand_id: isUuid(e.farmstand_id) ? e.farmstand_id : null,
    screen: e.screen ?? null,
    properties: e.properties ?? null,
  };
}

// Storage keys
const DEVICE_ID_KEY = 'farmstand_device_id';
const SESSION_ID_KEY = 'farmstand_session_id';
const SESSION_START_KEY = 'farmstand_session_start';

// Session timeout - 30 minutes of inactivity
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

// Generate a UUID-like ID
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Get or create a stable device ID (persists across app installs on same device)
let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = generateId();
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      console.log('[Analytics] Generated new device ID:', deviceId.slice(0, 8));
    }
    cachedDeviceId = deviceId;
    return deviceId;
  } catch (e) {
    console.log('[Analytics] Error getting device ID:', e);
    const fallbackId = generateId();
    cachedDeviceId = fallbackId;
    return fallbackId;
  }
}

// Get or create a session ID (resets after 30 min inactivity or app restart)
let cachedSessionId: string | null = null;
let lastActivityTime: number = Date.now();

export async function getSessionId(): Promise<string> {
  const now = Date.now();

  // Check if session expired
  if (cachedSessionId && now - lastActivityTime > SESSION_TIMEOUT_MS) {
    console.log('[Analytics] Session expired, creating new session');
    cachedSessionId = null;
  }

  if (cachedSessionId) {
    lastActivityTime = now;
    return cachedSessionId;
  }

  try {
    // Check stored session
    const storedSessionId = await AsyncStorage.getItem(SESSION_ID_KEY);
    const storedSessionStart = await AsyncStorage.getItem(SESSION_START_KEY);

    if (storedSessionId && storedSessionStart) {
      const sessionStart = parseInt(storedSessionStart, 10);
      // Only reuse if session is less than 30 minutes old
      if (now - sessionStart < SESSION_TIMEOUT_MS) {
        cachedSessionId = storedSessionId;
        lastActivityTime = now;
        return storedSessionId;
      }
    }

    // Create new session
    const newSessionId = generateId();
    await AsyncStorage.setItem(SESSION_ID_KEY, newSessionId);
    await AsyncStorage.setItem(SESSION_START_KEY, now.toString());
    cachedSessionId = newSessionId;
    lastActivityTime = now;
    console.log('[Analytics] Created new session:', newSessionId.slice(0, 8));
    return newSessionId;
  } catch (e) {
    console.log('[Analytics] Error getting session ID:', e);
    const fallbackId = generateId();
    cachedSessionId = fallbackId;
    return fallbackId;
  }
}

// Reset session (call on app open or logout)
export async function resetSession(): Promise<void> {
  cachedSessionId = null;
  lastActivityTime = Date.now();
  try {
    await AsyncStorage.removeItem(SESSION_ID_KEY);
    await AsyncStorage.removeItem(SESSION_START_KEY);
  } catch (e) {
    console.log('[Analytics] Error resetting session:', e);
  }
}

// Current screen tracking
let currentScreen: string = 'unknown';

export function setCurrentScreen(screen: string): void {
  currentScreen = screen;
}

export function getCurrentScreen(): string {
  return currentScreen;
}

// Pending events queue for offline support
let pendingEvents: AnalyticsEventInternal[] = [];
const PENDING_EVENTS_KEY = 'farmstand_pending_analytics';
const MAX_PENDING_EVENTS = 100;

// Load pending events from storage
async function loadPendingEvents(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_EVENTS_KEY);
    if (stored) {
      const loadedEvents = JSON.parse(stored) as Array<Record<string, unknown>>;
      // Migrate old events: use event_name (or event_type for backward compat)
      pendingEvents = loadedEvents.map((event) => ({
        event_name: (event.event_name || event.event_type) as AnalyticsEventType,
        user_id: (event.user_id as string) || null,
        device_id: (event.device_id as string) || null,
        farmstand_id: (event.farmstand_id as string) || null,
        screen: (event.screen as string) || null,
        properties: (event.properties as Record<string, unknown>) || null,
      }));
      console.log('[Analytics] Loaded', pendingEvents.length, 'pending events');
      // Save sanitized events back
      await savePendingEvents();
    }
  } catch (e) {
    console.log('[Analytics] Error loading pending events:', e);
  }
}

// Save pending events to storage
async function savePendingEvents(): Promise<void> {
  try {
    // Trim to max size
    if (pendingEvents.length > MAX_PENDING_EVENTS) {
      pendingEvents = pendingEvents.slice(-MAX_PENDING_EVENTS);
    }
    await AsyncStorage.setItem(PENDING_EVENTS_KEY, JSON.stringify(pendingEvents));
  } catch (e) {
    console.log('[Analytics] Error saving pending events:', e);
  }
}

// Initialize analytics (call on app start)
export async function initAnalytics(): Promise<void> {
  await getDeviceId();
  await getSessionId();
  await loadPendingEvents();

  // Try to flush any pending events
  flushPendingEvents();
}

// Flush pending events to Supabase
async function flushPendingEvents(): Promise<void> {
  if (pendingEvents.length === 0) return;
  if (!isSupabaseConfigured()) return;

  const eventsToFlush = [...pendingEvents];
  pendingEvents = [];

  // Convert to DB payloads
  const dbEvents = eventsToFlush.map(toDbEvent);

  try {
    const { error } = await supabase
      .from('analytics_events')
      .insert(dbEvents as unknown as Record<string, unknown>[])
      .execute();

    if (error) {
      console.log('[Analytics] Error flushing events:', error.message);
      // Put events back in queue
      pendingEvents = [...eventsToFlush, ...pendingEvents];
      await savePendingEvents();
    } else {
      console.log('[Analytics] Flushed', eventsToFlush.length, 'pending events');
      await savePendingEvents();
    }
  } catch (e) {
    console.log('[Analytics] Network error flushing events:', e);
    // Put events back in queue
    pendingEvents = [...eventsToFlush, ...pendingEvents];
    await savePendingEvents();
  }
}

/**
 * Log an analytics event to Supabase
 * NEVER blocks UX - fails silently with console logging
 *
 * @param eventType - The event type (use AnalyticsEventType)
 * @param options - Optional event data
 */
export async function logEvent(
  eventType: AnalyticsEventType,
  options?: {
    userId?: string | null;
    screen?: string;
    farmstandId?: string | null;
    productKey?: string | null;
    properties?: Record<string, unknown>;
  }
): Promise<void> {
  // Never block - run async
  (async () => {
    try {
      const deviceId = await getDeviceId();

      // Build properties object with all context
      // Extract screen and farmstand_id as top-level fields
      const screen = options?.screen || currentScreen;
      const farmstandId = options?.farmstandId || null;

      // Build properties object with additional context (exclude farmstand_id since it's top-level now)
      // Always include platform and app_version for analytics
      const properties: Record<string, unknown> = {
        ...(options?.properties || {}),
        ...(options?.productKey ? { product_key: options.productKey } : {}),
        platform: getPlatform(),
        app_version: getAppVersion(),
      };

      // Create internal event with all rich data
      const event: AnalyticsEventInternal = {
        event_name: eventType,
        user_id: options?.userId || null,
        device_id: deviceId,
        farmstand_id: farmstandId,
        screen: screen,
        properties: Object.keys(properties).length > 0 ? properties : null,
      };

      console.log('[Analytics] Logging event:', eventType, options?.screen || currentScreen);

      if (!isSupabaseConfigured()) {
        console.log('[Analytics] Supabase not configured, queueing event');
        pendingEvents.push(event);
        await savePendingEvents();
        return;
      }

      // Convert to DB payload and insert
      const dbEvent = toDbEvent(event);
      const { error } = await supabase
        .from('analytics_events')
        .insert([dbEvent as unknown as Record<string, unknown>])
        .execute();

      if (error) {
        console.log('[Analytics] Insert error:', error.message);
        // Queue for later
        pendingEvents.push(event);
        await savePendingEvents();
      }
    } catch (e) {
      console.log('[Analytics] Unexpected error logging event:', e);
    }
  })();
}

// Convenience functions for common events
export const logScreenView = (screen: string, userId?: string | null): void => {
  setCurrentScreen(screen);
  logEvent('screen_view', { screen, userId });
};

export const logAppOpen = (userId?: string | null): void => {
  logEvent('app_open', { userId, screen: 'app_open' });
};

export const logSearch = (
  query: string,
  resultCount: number,
  userId?: string | null
): void => {
  logEvent('search', {
    userId,
    properties: { query, result_count: resultCount },
  });
};

export const logFilterChange = (
  filterType: string,
  filterValue: string | string[],
  userId?: string | null
): void => {
  logEvent('filter_change', {
    userId,
    properties: { filter_type: filterType, filter_value: filterValue },
  });
};

export const logRadiusChange = (
  radiusMiles: number,
  userId?: string | null
): void => {
  logEvent('radius_change', {
    userId,
    properties: { radius_miles: radiusMiles },
  });
};

export const logProductChipTap = (
  productKey: string,
  userId?: string | null
): void => {
  logEvent('product_chip_tap', {
    userId,
    productKey,
    properties: { product: productKey },
  });
};

export const logFarmstandView = (
  farmstandId: string,
  farmstandName: string,
  userId?: string | null
): void => {
  logEvent('farmstand_view', {
    userId,
    farmstandId,
    properties: { farmstand_name: farmstandName },
  });
};

export const logFarmstandSave = (
  farmstandId: string,
  farmstandName: string,
  userId?: string | null
): void => {
  logEvent('farmstand_save', {
    userId,
    farmstandId,
    properties: { farmstand_name: farmstandName },
  });
};

export const logShareTap = (
  farmstandId: string,
  userId?: string | null
): void => {
  logEvent('share_tap', { userId, farmstandId });
};

export const logDirectionsTap = (
  farmstandId: string,
  userId?: string | null
): void => {
  logEvent('directions_tap', { userId, farmstandId });
};

export const logCallTap = (
  farmstandId: string,
  userId?: string | null
): void => {
  logEvent('call_tap', { userId, farmstandId });
};

export const logWebsiteTap = (
  farmstandId: string,
  userId?: string | null
): void => {
  logEvent('website_tap', { userId, farmstandId });
};

export const logMessageTap = (
  farmstandId: string,
  userId?: string | null
): void => {
  logEvent('message_tap', { userId, farmstandId });
};

// Alias for message_tap (alternative event name)
export const logMessageFarmstand = (
  farmstandId: string,
  userId?: string | null
): void => {
  logEvent('message_farmstand', { userId, farmstandId });
};

// Save toggle (alternative to farmstand_save for toggle behavior)
export const logSaveToggle = (
  farmstandId: string,
  saved: boolean,
  userId?: string | null
): void => {
  logEvent('save_toggle', {
    userId,
    farmstandId,
    properties: { saved },
  });
};

// Product click event (for clicking on product items)
export const logProductClick = (
  farmstandId: string,
  productKey: string,
  userId?: string | null
): void => {
  logEvent('product_click', {
    userId,
    farmstandId,
    productKey,
    properties: { product: productKey },
  });
};

// Claim start (when user begins claim process)
export const logClaimStart = (
  farmstandId: string,
  userId?: string | null
): void => {
  logEvent('claim_start', { userId, farmstandId });
};

// Claim submit (when user submits claim form)
export const logClaimSubmit = (
  farmstandId: string,
  userId: string
): void => {
  logEvent('claim_submit', { userId, farmstandId });
};

export const logSignupStart = (): void => {
  logEvent('signup_start', { screen: 'signup' });
};

export const logSignupComplete = (userId: string): void => {
  logEvent('signup_complete', { userId, screen: 'signup' });
};

export const logLocationPermission = (
  granted: boolean,
  userId?: string | null
): void => {
  logEvent(granted ? 'location_permission_granted' : 'location_permission_denied', {
    userId,
  });
};

export const logClaimRequest = (
  farmstandId: string,
  userId: string
): void => {
  logEvent('claim_request', { userId, farmstandId });
};

export const logClaimApproved = (
  farmstandId: string,
  userId: string
): void => {
  logEvent('claim_approved', { userId, farmstandId });
};

export const logClaimDenied = (
  farmstandId: string,
  userId: string
): void => {
  logEvent('claim_denied', { userId, farmstandId });
};

export const logFarmstandCreate = (
  farmstandId: string,
  farmstandName: string,
  userId?: string | null
): void => {
  logEvent('farmstand_create', {
    userId,
    farmstandId,
    properties: { farmstand_name: farmstandName },
  });
};

export const logFarmstandEdit = (
  farmstandId: string,
  fieldsEdited: string[],
  userId?: string | null
): void => {
  logEvent('farmstand_edit', {
    userId,
    farmstandId,
    properties: { fields_edited: fieldsEdited },
  });
};

export const logFarmstandDelete = (
  farmstandId: string,
  userId?: string | null
): void => {
  logEvent('farmstand_delete', { userId, farmstandId });
};

export const logPhotoUpload = (
  success: boolean,
  farmstandId?: string | null,
  errorMessage?: string,
  userId?: string | null
): void => {
  logEvent(success ? 'photo_upload_success' : 'photo_upload_fail', {
    userId,
    farmstandId,
    properties: success ? undefined : { error: errorMessage },
  });
};

export const logReviewCreate = (
  farmstandId: string,
  rating: number,
  userId: string | null
): void => {
  logEvent('review_create', {
    userId,
    farmstandId,
    properties: { rating },
  });
};

export const logReportCreate = (
  targetType: 'review' | 'farmstand',
  targetId: string,
  reason: string,
  userId?: string | null,
  farmstandId?: string | null
): void => {
  logEvent('report_create', {
    userId,
    farmstandId: targetType === 'farmstand' ? targetId : farmstandId,
    properties: { target_type: targetType, target_id: targetId, reason },
  });
};

export const logReportResolve = (
  reportId: string,
  resolution: 'resolved' | 'dismissed',
  userId?: string | null
): void => {
  logEvent('report_resolve', {
    userId,
    properties: { report_id: reportId, resolution },
  });
};

export const logError = (
  errorMessage: string,
  errorType?: string,
  screen?: string,
  userId?: string | null
): void => {
  logEvent('error_event', {
    userId,
    screen: screen || currentScreen,
    properties: { error: errorMessage, error_type: errorType },
  });
};

// ============================================
// Tab/Screen Open Events (Platform navigation)
// ============================================

export const logExploreOpen = (userId?: string | null): void => {
  logEvent('explore_open', { userId, screen: 'explore' });
};

export const logMapOpen = (userId?: string | null): void => {
  logEvent('map_open', { userId, screen: 'map' });
};

export const logProfileOpen = (userId?: string | null): void => {
  logEvent('profile_open', { userId, screen: 'profile' });
};
