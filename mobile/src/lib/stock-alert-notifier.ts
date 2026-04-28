/**
 * Stock Alert Notifier
 *
 * Fire-and-forget utility that pings the backend whenever a farmstand product
 * transitions from out-of-stock → in-stock.
 *
 * The backend:
 *  - Validates the transition (previous_is_in_stock=false → new_is_in_stock=true)
 *  - Queries saved_farmstands to find all users who saved this farmstand
 *  - Excludes the owner from recipients
 *  - Inserts inbox_alerts for each saved user
 *  - Sends push notifications to each saved user's registered devices
 *
 * Callers should invoke this AFTER a successful write so followers are
 * only notified when the change has actually persisted.
 */

import { getValidSession } from './supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

interface StockAlertParams {
  farmstand_id: string;
  product_id: string;
  product_name: string;
  farmstand_name: string;
  /** Stock status before the edit */
  previous_is_in_stock: boolean;
  /** Stock status after the edit */
  new_is_in_stock: boolean;
}

/**
 * Notify saved users that a product is back in stock.
 *
 * Only actually sends when previous_is_in_stock=false AND new_is_in_stock=true.
 * The backend also enforces this check as a safety net.
 *
 * This is intentionally non-blocking: errors are logged but never thrown.
 */
export function notifyStockAlert(params: StockAlertParams): void {
  // Quick client-side gate to avoid unnecessary network calls
  if (params.previous_is_in_stock || !params.new_is_in_stock) {
    return;
  }

  // Log when this event is triggered on the mobile side so we can measure
  // the lag between the mobile trigger and when the backend receives it.
  const triggeredAt = Date.now();
  console.log(
    `[PushDiag][mobile] ── notifyStockAlert TRIGGERED ──` +
    ` farmstand=${params.farmstand_id} product="${params.product_name}"` +
    ` ts=${new Date(triggeredAt).toISOString()}`
  );

  (async () => {
    try {
      if (!BACKEND_URL) {
        console.log('[StockAlertNotifier] BACKEND_URL not configured, skipping');
        return;
      }

      const sessionStart = Date.now();
      const session = await getValidSession();
      console.log(`[PushDiag][mobile] ── notifyStockAlert SESSION ── +${Date.now() - sessionStart}ms (lagSinceTrigger=+${Date.now() - triggeredAt}ms)`);
      const token = session?.access_token;
      if (!token) {
        console.log('[StockAlertNotifier] No active session, skipping stock alert');
        return;
      }

      const fetchStart = Date.now();
      console.log(
        `[PushDiag][mobile] ── notifyStockAlert HTTP START ──` +
        ` lagSinceTrigger=+${fetchStart - triggeredAt}ms ts=${new Date(fetchStart).toISOString()}`
      );
      const response = await fetch(`${BACKEND_URL}/api/stock-alert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      console.log(`[PushDiag][mobile] ── notifyStockAlert HTTP DONE ── status=${response.status} +${Date.now() - fetchStart}ms (lagSinceTrigger=+${Date.now() - triggeredAt}ms)`);

      if (!response.ok) {
        console.log('[StockAlertNotifier] Backend responded with', response.status);
      } else {
        const sact = response.headers.get('content-type') ?? '';
        if (!sact.includes('application/json')) {
          console.log('[StockAlertNotifier] Non-JSON response from stock-alert (HTTP', response.status, '), content-type:', sact);
        } else {
          const result = await response.json() as { success: boolean; sent?: number; reason?: string };
          if (result.reason === 'no_transition') {
            console.log('[StockAlertNotifier] Backend: no transition detected, skipped');
          } else {
            console.log(
              `[StockAlertNotifier] Stock alert sent to ${result.sent ?? 0} follower(s) ` +
              `for product "${params.product_name}" at farmstand ${params.farmstand_id}`
            );
          }
        }
      }
    } catch (err) {
      // Non-fatal — never surface notification errors to the user
      console.log('[StockAlertNotifier] Error (non-fatal):', err);
    }
  })();
}

/**
 * Notify saved users when multiple products became in-stock at once
 * (e.g., after "Mark All In Stock" bulk action).
 *
 * Sends one alert per product that transitioned, but caps at 3 individual
 * notifications then sends a consolidated one to avoid spam.
 */
export function notifyBulkStockAlert(
  farmstand_id: string,
  farmstand_name: string,
  restockedProducts: Array<{ id: string; name: string }>
): void {
  if (restockedProducts.length === 0) return;

  if (restockedProducts.length === 1) {
    // Single product — use the normal per-product path
    const p = restockedProducts[0]!;
    notifyStockAlert({
      farmstand_id,
      product_name: p.name,
      product_id: p.id,
      farmstand_name,
      previous_is_in_stock: false,
      new_is_in_stock: true,
    });
    return;
  }

  // Multiple products — send one consolidated notification using the first product
  // as the anchor so the backend can look up saved users and route correctly.
  // We override the push body via the product_name to convey the bulk nature.
  const firstProduct = restockedProducts[0]!;
  const count = restockedProducts.length;
  notifyStockAlert({
    farmstand_id,
    // Use a descriptive synthetic name so the backend builds the right message
    product_name: `${count} items`,
    product_id: firstProduct.id,
    farmstand_name,
    previous_is_in_stock: false,
    new_is_in_stock: true,
  });
}
