/**
 * Stand Update Notifier
 *
 * Fire-and-forget utility that pings the backend to notify a farmstand's
 * followers whenever a product or inventory item is created or updated.
 *
 * The backend handles:
 *  - Looking up the farmstand name
 *  - Finding all followers (user_saved_farmstands)
 *  - Excluding the owner from recipients
 *  - Sending push notifications + inserting inbox_alerts
 *
 * Callers should invoke this AFTER a successful write so followers are
 * only notified when the change actually persisted.
 */

import { getValidSession } from './supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

/**
 * Notify followers of a farmstand about a product or inventory change.
 *
 * @param farmstand_id - The UUID of the farmstand that changed
 * @param is_available - true  → "[Name] has items in stock"
 *                       false → "[Name] updated their stand"
 *
 * This is intentionally non-blocking: errors are logged but never thrown.
 */
export function notifyStandUpdate(farmstand_id: string, is_available = false): void {
  // Log when this event is triggered on the mobile side so we can measure
  // the lag between the mobile trigger and when the backend receives it.
  const triggeredAt = Date.now();
  console.log(
    `[PushDiag][mobile] ── notifyStandUpdate TRIGGERED ──` +
    ` farmstand=${farmstand_id} is_available=${is_available}` +
    ` ts=${new Date(triggeredAt).toISOString()}`
  );

  (async () => {
    try {
      if (!BACKEND_URL) {
        console.log('[StandUpdateNotifier] BACKEND_URL not configured, skipping');
        return;
      }

      const sessionStart = Date.now();
      const session = await getValidSession();
      console.log(`[PushDiag][mobile] ── notifyStandUpdate SESSION ── +${Date.now() - sessionStart}ms (lagSinceTrigger=+${Date.now() - triggeredAt}ms)`);
      const token = session?.access_token;
      if (!token) {
        console.log('[StandUpdateNotifier] No active session, skipping notification');
        return;
      }

      const fetchStart = Date.now();
      console.log(
        `[PushDiag][mobile] ── notifyStandUpdate HTTP START ──` +
        ` lagSinceTrigger=+${fetchStart - triggeredAt}ms ts=${new Date(fetchStart).toISOString()}`
      );
      const response = await fetch(`${BACKEND_URL}/api/notify-stand-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ farmstand_id, is_available }),
      });
      console.log(`[PushDiag][mobile] ── notifyStandUpdate HTTP DONE ── status=${response.status} +${Date.now() - fetchStart}ms (lagSinceTrigger=+${Date.now() - triggeredAt}ms)`);

      if (!response.ok) {
        console.log('[StandUpdateNotifier] Backend responded with', response.status);
      } else {
        const sct = response.headers.get('content-type') ?? '';
        if (!sct.includes('application/json')) {
          console.log('[StandUpdateNotifier] Non-JSON response from notify-stand-update (HTTP', response.status, '), content-type:', sct);
        } else {
          const result = await response.json() as { success: boolean; sent?: number };
          console.log(`[StandUpdateNotifier] Notified ${result.sent ?? 0} follower(s) for farmstand ${farmstand_id}`);
        }
      }
    } catch (err) {
      // Non-fatal — never let notification errors surface to the user
      console.log('[StandUpdateNotifier] Error (non-fatal):', err);
    }
  })();
}
