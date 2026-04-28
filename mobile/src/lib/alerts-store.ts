/**
 * Alerts Store
 * Manages system alerts/notifications from Supabase
 */

import { create } from 'zustand';
import { supabase, isSupabaseConfigured, getValidSession, getSupabaseUrl, getSupabaseConfigStatus } from './supabase';

// Decode user ID from a JWT access token (no network call)
function getUserIdFromAccessToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

// Alert types matching the database schema
export type AlertType =
  | 'claim_request'
  | 'claim_approved'
  | 'claim_denied'
  | 'claim_more_info'
  | 'review_new'
  | 'review_reply'
  | 'listing_flagged'
  | 'listing_attention'
  | 'listing_hidden'
  | 'platform_announcement'
  | 'premium_approved'
  | 'premium_expired'
  | 'premium_downgraded'
  | 'report_received'
  | 'report_resolved'
  | 'app_notice'
  | 'message'
  | 'farmstand_update'
  | 'info'
  | 'action_required'
  | 'premium_trial_reminder';

// Maps an alert type to one of three display categories
export type AlertCategory = 'info' | 'action_required' | 'message';

export function getAlertCategory(type: AlertType | null): AlertCategory {
  switch (type) {
    case 'message':
      return 'message';
    case 'claim_denied':
    case 'claim_more_info':
    case 'listing_flagged':
    case 'listing_attention':
    case 'listing_hidden':
    case 'premium_expired':
    case 'premium_downgraded':
    case 'premium_trial_reminder':
    case 'report_received':
    case 'claim_request':
    case 'action_required':
    case 'review_new':
    case 'review_reply':
      return 'action_required';
    case 'info':
    default:
      return 'info';
  }
}

export interface Alert {
  id: string;
  user_id: string;
  farmstand_id: string | null;
  type: AlertType | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  deleted_at: string | null;
  action_route: string | null;
  action_params: Record<string, string> | null;
  message: string | null;
  related_farmstand_id: string | null;
}

interface AlertsStore {
  alerts: Alert[];
  isLoading: boolean;
  error: string | null;
  // Debug info populated on each loadAlerts call
  debugInfo: {
    // Key names being read (so TestFlight can confirm the right vars are set)
    urlKeyName: string;
    anonKeyName: string;
    // Lengths instead of full values (safe to display)
    urlLength: number;
    anonKeyLength: number;
    // Session user id from JWT
    authUid: string | null;
    alertCount: number;
    firstAlert: { type: string | null; created_at: string } | null;
    lastLoadAt: string | null;
    // Legacy field kept for backward compat
    supabaseUrl: string;
  };

  // Actions
  loadAlerts: (userId?: string) => Promise<void>;
  getUnreadCount: () => number;
  markAsRead: (alertId: string) => Promise<void>;
  markAllAsRead: (userId?: string) => Promise<void>;
  deleteAlert: (alertId: string) => Promise<void>;
  clearAlerts: () => void;
}

export const useAlertsStore = create<AlertsStore>((set, get) => ({
  alerts: [],
  isLoading: false,
  error: null,
  debugInfo: {
    urlKeyName: 'EXPO_PUBLIC_SUPABASE_URL',
    anonKeyName: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    urlLength: 0,
    anonKeyLength: 0,
    supabaseUrl: '',
    authUid: null,
    alertCount: 0,
    firstAlert: null,
    lastLoadAt: null,
  },

  loadAlerts: async (_userId?: string) => {
    // inFlight guard: skip only if a fetch started within the last 3 seconds.
    // A longer window was preventing re-loads after returning from the detail screen.
    const { isLoading, debugInfo } = get();
    if (isLoading) {
      const lastLoad = debugInfo.lastLoadAt ? Date.now() - new Date(debugInfo.lastLoadAt).getTime() : Infinity;
      if (lastLoad < 3000) {
        console.log('[Alerts] loadAlerts skipped — already in flight (<3s ago)');
        return;
      }
    }

    // Use module-level singleton constants (read once at import time from process.env).
    // Do NOT re-read process.env here — in bundled/TestFlight builds the module-level
    // values are what was baked in at build time; calling process.env again at runtime
    // can return empty strings in some Metro bundler configurations.
    const configStatus = getSupabaseConfigStatus();
    const resolvedUrl = getSupabaseUrl();

    if (!isSupabaseConfigured()) {
      console.log('[Alerts] Supabase not configured — hasUrl:', configStatus.hasUrl, 'hasKey:', configStatus.hasAnonKey, 'projectRef:', configStatus.projectRef);
      set({
        debugInfo: {
          urlKeyName: 'EXPO_PUBLIC_SUPABASE_URL',
          anonKeyName: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
          urlLength: resolvedUrl.length,
          anonKeyLength: 0,
          supabaseUrl: resolvedUrl,
          authUid: null,
          alertCount: 0,
          firstAlert: null,
          lastLoadAt: new Date().toISOString(),
        },
      });
      return;
    }

    // Get session from SecureStore via the shared singleton (same path used by all other screens)
    const session = await getValidSession();
    if (!session?.access_token) {
      console.log('[Alerts] No valid session, skipping load');
      set({
        alerts: [],
        isLoading: false,
        debugInfo: {
          ...get().debugInfo,
          urlLength: resolvedUrl.length,
          supabaseUrl: resolvedUrl,
          authUid: null,
          lastLoadAt: new Date().toISOString(),
        },
      });
      return;
    }

    const authUid = getUserIdFromAccessToken(session.access_token);
    if (!authUid) {
      console.log('[Alerts] Could not decode user ID from session, skipping load');
      set({ alerts: [], isLoading: false });
      return;
    }

    console.log('[Alerts] Loading for uid:', authUid, '| project:', configStatus.projectRef);

    set({ isLoading: true, error: null });

    try {
      // Build query using the shared supabase client's from() builder.
      // We still need to pass the session JWT manually because the custom client
      // uses allowAnon=true by default, so we use a raw fetch with the session token.
      const url = new URL(`${resolvedUrl}/rest/v1/inbox_alerts`);
      url.searchParams.set('select', '*');
      url.searchParams.set('user_id', `eq.${authUid}`);
      url.searchParams.set('deleted_at', 'is.null');
      url.searchParams.set('order', 'created_at.desc');

      // Read anonKey from the supabase module's config status (same module-level constant)
      // We access it through the raw process.env but only as a fallback for the header —
      // the real guard is isSupabaseConfigured() which already passed above.
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

      console.log('[Alerts] Fetching | project:', configStatus.projectRef, '| uid:', authUid);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('[Alerts] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log('[Alerts] Error loading alerts:', response.status, errorText);
        set({ error: `HTTP ${response.status}: ${errorText}`, isLoading: false });
        return;
      }

      const data: Alert[] = await response.json();
      console.log('[Alerts] Loaded', data?.length ?? 0, 'alerts for uid:', authUid);
      if (data && data.length > 0) {
        console.log('[Alerts] First alert:', data[0].type, data[0].created_at);
      }
      set({
        alerts: data ?? [],
        isLoading: false,
        debugInfo: {
          urlKeyName: 'EXPO_PUBLIC_SUPABASE_URL',
          anonKeyName: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
          urlLength: resolvedUrl.length,
          anonKeyLength: anonKey.length,
          supabaseUrl: resolvedUrl,
          authUid,
          alertCount: data?.length ?? 0,
          firstAlert: data && data.length > 0
            ? { type: data[0].type, created_at: data[0].created_at }
            : null,
          lastLoadAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.log('[Alerts] Exception loading alerts:', message);
      set({ error: message, isLoading: false });
    }
  },

  getUnreadCount: () => {
    const { alerts } = get();
    return alerts.filter(a => a.read_at === null).length;
  },

  markAsRead: async (alertId: string) => {
    if (!isSupabaseConfigured()) return;

    const { alerts } = get();
    const alert = alerts.find(a => a.id === alertId);
    if (!alert || alert.read_at !== null) return;

    // Optimistic update
    const now = new Date().toISOString();
    set({
      alerts: alerts.map(a =>
        a.id === alertId ? { ...a, read_at: now } : a
      ),
    });

    try {
      const { error } = await supabase
        .from<Alert>('inbox_alerts')
        .update({ read_at: now })
        .eq('id', alertId)
        .execute();

      if (error) {
        console.log('[Alerts] Error marking alert as read:', error.message);
        // Revert optimistic update
        set({ alerts });
      }
    } catch (err) {
      console.log('[Alerts] Exception marking alert as read:', err);
      // Revert optimistic update
      set({ alerts });
    }
  },

  markAllAsRead: async (_userId?: string) => {
    if (!isSupabaseConfigured()) return;

    const session = await getValidSession();
    if (!session?.access_token) return;
    const authUid = getUserIdFromAccessToken(session.access_token);
    if (!authUid) return;

    const { alerts } = get();
    const now = new Date().toISOString();

    // Optimistic update
    set({
      alerts: alerts.map(a =>
        a.read_at === null ? { ...a, read_at: now } : a
      ),
    });

    try {
      const { error } = await supabase
        .from<Alert>('inbox_alerts')
        .update({ read_at: now })
        .eq('user_id', authUid)
        .is('read_at', 'null')
        .execute();

      if (error) {
        console.log('[Alerts] Error marking all alerts as read:', error.message);
        // Revert optimistic update
        set({ alerts });
      }
    } catch (err) {
      console.log('[Alerts] Exception marking all alerts as read:', err);
      // Revert optimistic update
      set({ alerts });
    }
  },

  clearAlerts: () => {
    set({ alerts: [], isLoading: false, error: null });
  },

  deleteAlert: async (alertId: string) => {
    if (!isSupabaseConfigured()) return;

    const { alerts } = get();
    const snapshot = alerts;

    // Optimistic remove from UI
    set({ alerts: alerts.filter(a => a.id !== alertId) });

    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from<Alert>('inbox_alerts')
        .update({ deleted_at: now })
        .eq('id', alertId)
        .execute();

      if (error) {
        console.log('[Alerts] Error soft-deleting alert:', error.message);
        set({ alerts: snapshot });
      }
    } catch (err) {
      console.log('[Alerts] Exception soft-deleting alert:', err);
      set({ alerts: snapshot });
    }
  },
}));

// Helper function to get alert icon based on type
export function getAlertIcon(type: AlertType | null): string {
  switch (type) {
    case 'claim_request':    return 'hand-raised';
    case 'claim_approved':   return 'check-circle';
    case 'claim_denied':     return 'x-circle';
    case 'review_new':       return 'star';
    case 'review_reply':     return 'message-square';
    case 'listing_flagged':  return 'flag';
    case 'listing_attention':return 'alert-triangle';
    case 'listing_hidden':   return 'eye-off';
    case 'platform_announcement': return 'megaphone';
    case 'premium_approved': return 'award';
    case 'premium_expired':  return 'clock';
    case 'premium_downgraded': return 'trending-down';
    case 'report_received':  return 'shield-alert';
    case 'report_resolved':  return 'shield-check';
    case 'app_notice':       return 'info';
    case 'message':          return 'message-circle';
    case 'farmstand_update': return 'store';
    default:                 return 'bell';
  }
}

// Helper function to get alert color based on type
export function getAlertColor(type: AlertType | null): string {
  switch (type) {
    case 'claim_request':    return '#F59E0B'; // amber
    case 'claim_approved':   return '#10B981'; // green
    case 'claim_denied':     return '#EF4444'; // red
    case 'review_new':       return '#8B5CF6'; // purple
    case 'review_reply':     return '#D4943A'; // harvest gold
    case 'listing_flagged':  return '#EF4444'; // red
    case 'listing_attention':return '#F59E0B'; // amber
    case 'listing_hidden':   return '#EF4444'; // red
    case 'platform_announcement': return '#3B82F6'; // blue
    case 'premium_approved': return '#10B981'; // green
    case 'premium_expired':  return '#EF4444'; // red
    case 'premium_downgraded': return '#F59E0B'; // amber
    case 'report_received':  return '#F59E0B'; // amber
    case 'report_resolved':  return '#10B981'; // green
    case 'app_notice':       return '#3B82F6'; // blue
    case 'message':          return '#2D5A3D'; // forest green
    case 'farmstand_update': return '#A8906E'; // tan/warm brown
    default:                 return '#6B7280'; // gray
  }
}

// Create an alert for a user (used by admin actions, claim workflows, etc.)
// Routes through the backend using the service role key to bypass RLS —
// admins need to insert alerts for other users which direct client inserts block.
export async function createAlert(params: {
  user_id: string;
  farmstand_id?: string | null;
  type: AlertType;
  title: string;
  body: string;
  action_route?: string | null;
  action_params?: Record<string, string> | null;
}): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    console.log('[Alerts] Supabase not configured, skipping alert creation');
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const session = await getValidSession();
    if (!session?.access_token) {
      console.log('[Alerts] No valid session, cannot create alert');
      return { success: false, error: 'Not authenticated' };
    }

    const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
    const resp = await fetch(`${backendUrl}/api/send-alert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        user_id: params.user_id,
        farmstand_id: params.farmstand_id ?? null,
        type: params.type,
        title: params.title,
        body: params.body,
        action_route: params.action_route ?? null,
        action_params: params.action_params ?? null,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log('[Alerts] Backend send-alert failed:', resp.status, errText);
      return { success: false, error: `Failed to send alert (${resp.status})` };
    }

    console.log('[Alerts] Alert created successfully for user:', params.user_id);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log('[Alerts] Exception creating alert:', message);
    return { success: false, error: message };
  }
}

/**
 * Send a push notification to all users who have saved a given farmstand.
 * Call this when a farmstand owner posts an update to their stand.
 *
 * @param farmstandId - UUID of the farmstand
 * @param farmstandName - Display name shown as push title
 * @param updateText - The update message shown as push body
 * @param notifyUserIds - Optional pre-resolved list of user IDs to notify.
 *   If omitted, the backend will attempt to look them up from user_saved_farmstands.
 */
export async function sendSavedStandUpdatePush(params: {
  farmstandId: string;
  farmstandName: string;
  updateText: string;
  notifyUserIds?: string[];
}): Promise<{ success: boolean; sent?: number; error?: string }> {
  try {
    const session = await getValidSession();
    if (!session?.access_token) {
      console.log('[Alerts] sendSavedStandUpdatePush: no valid session');
      return { success: false, error: 'Not authenticated' };
    }

    const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
    const resp = await fetch(`${backendUrl}/api/send-saved-stand-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        farmstand_id: params.farmstandId,
        farmstand_name: params.farmstandName,
        update_text: params.updateText,
        notify_user_ids: params.notifyUserIds ?? [],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log('[Alerts] sendSavedStandUpdatePush failed:', resp.status, errText);
      return { success: false, error: `Failed to send push (${resp.status})` };
    }

    const result = (await resp.json()) as { success: boolean; sent?: number };
    console.log('[Alerts] sendSavedStandUpdatePush sent to', result.sent ?? 0, 'user(s)');
    return { success: true, sent: result.sent ?? 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.log('[Alerts] sendSavedStandUpdatePush exception:', message);
    return { success: false, error: message };
  }
}

// Format alert timestamp
export function formatAlertTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
