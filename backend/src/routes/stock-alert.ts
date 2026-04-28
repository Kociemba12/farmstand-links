import { Hono } from "hono";
import { z } from "zod";
import { sendPushToUsers } from "../lib/push-sender";
import { insertAlertForUsers } from "../lib/alert-inserter";

/**
 * Stock Alert Route
 *
 * Called by the farmstand owner's app after a product's is_in_stock status
 * transitions from false → true (i.e., a product comes back in stock).
 *
 * Logic:
 * - Requires a valid owner JWT
 * - Skips if this is NOT an actual out-of-stock → in-stock transition
 * - Queries saved_farmstands (primary) + user_saved_farmstands (fallback) to find
 *   all users who have saved this farmstand
 * - Excludes the farmstand owner from recipients
 * - Inserts an in-app alert in inbox_alerts for each saved user
 * - Sends a push notification to each saved user's registered devices
 */
export const stockAlertRouter = new Hono();

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const schema = z.object({
  farmstand_id: z.string().uuid(),
  product_id: z.string().min(1),
  product_name: z.string().min(1),
  /** Stock status before the edit */
  previous_is_in_stock: z.boolean(),
  /** Stock status after the edit */
  new_is_in_stock: z.boolean(),
});

async function verifyJwt(
  authHeader: string | undefined
): Promise<{ userId: string | null; error: string | null }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, error: "Missing Authorization header" };
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!resp.ok) return { userId: null, error: "Invalid session" };
    const data = (await resp.json()) as { id?: string };
    return data?.id
      ? { userId: data.id, error: null }
      : { userId: null, error: "No user ID in token" };
  } catch {
    return { userId: null, error: "Failed to verify session" };
  }
}

/** Fetch the farmstand name from Supabase. Returns null if not found. */
async function getFarmstandName(farmstandId: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/farmstands`);
    url.searchParams.set("select", "name");
    url.searchParams.set("id", `eq.${farmstandId}`);
    url.searchParams.set("limit", "1");

    const resp = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{ name: string }>;
    return rows[0]?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch all user IDs who have saved a given farmstand.
 *
 * Queries saved_farmstands (the table written by the favorites toggle) first.
 * Falls back to user_saved_farmstands (the push-notification SQL schema table).
 * Merges and deduplicates results so delivery works regardless of which table
 * has rows for a given user.
 */
async function getSavedUserIds(farmstandId: string): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  const allIds = new Set<string>();

  // ── Primary: saved_farmstands (written by /api/favorites/toggle) ────────
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/saved_farmstands`);
    url.searchParams.set("select", "user_id");
    url.searchParams.set("farmstand_id", `eq.${farmstandId}`);

    const resp = await fetch(url.toString(), { headers: serviceHeaders });
    if (resp.ok) {
      const rows = (await resp.json()) as Array<{ user_id: string }>;
      rows.forEach((r) => r.user_id && allIds.add(r.user_id));
      console.log(
        `[StockAlert] saved_farmstands: ${rows.length} row(s) for farmstand ${farmstandId}`
      );
    } else {
      const errText = await resp.text();
      console.log(
        `[StockAlert] saved_farmstands query failed: ${resp.status} ${errText}`
      );
    }
  } catch (err) {
    console.log("[StockAlert] Exception querying saved_farmstands:", err);
  }

  // ── Fallback: user_saved_farmstands (push-notifications schema table) ───
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_saved_farmstands`);
    url.searchParams.set("select", "user_id");
    url.searchParams.set("farmstand_id", `eq.${farmstandId}`);

    const resp = await fetch(url.toString(), { headers: serviceHeaders });
    if (resp.ok) {
      const rows = (await resp.json()) as Array<{ user_id: string }>;
      rows.forEach((r) => r.user_id && allIds.add(r.user_id));
      console.log(
        `[StockAlert] user_saved_farmstands: ${rows.length} row(s) for farmstand ${farmstandId}`
      );
    } else {
      // Table may not exist — non-fatal
      console.log(
        `[StockAlert] user_saved_farmstands query returned ${resp.status} (non-fatal)`
      );
    }
  } catch (err) {
    console.log(
      "[StockAlert] Exception querying user_saved_farmstands (non-fatal):",
      err
    );
  }

  const ids = Array.from(allIds);
  console.log(
    `[StockAlert] saved users found: ${ids.length} (combined, deduplicated)`
  );
  return ids;
}

stockAlertRouter.post("/", async (c) => {
  // Capture the moment this request arrived — used to measure end-to-end push lag
  const requestReceivedAt = Date.now();
  console.log(
    `[PushDiag] ── stock_alert REQUEST RECEIVED ── ts=${new Date(requestReceivedAt).toISOString()}`
  );

  const authHeader = c.req.header("Authorization");
  const jwtStart = Date.now();
  const { userId, error: authError } = await verifyJwt(authHeader);
  console.log(`[PushDiag] ── stock_alert JWT verified ── +${Date.now() - jwtStart}ms (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)`);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid request",
      },
      400
    );
  }

  const {
    farmstand_id,
    product_id,
    product_name,
    previous_is_in_stock,
    new_is_in_stock,
  } = parsed.data;

  console.log(
    `[StockAlert] checking stock transition for farmstandId=${farmstand_id} productId=${product_id} ` +
      `productName="${product_name}" previous=${previous_is_in_stock} new=${new_is_in_stock}`
  );

  // Gate: only fire on an actual out-of-stock → in-stock transition
  if (previous_is_in_stock || !new_is_in_stock) {
    console.log(
      `[StockAlert] skipped - no actual restock transition ` +
        `(previous_is_in_stock=${previous_is_in_stock}, new_is_in_stock=${new_is_in_stock})`
    );
    return c.json({ success: true, sent: 0, reason: "no_transition" });
  }

  // Fetch farmstand name and saved user IDs in PARALLEL — they are independent queries.
  // Previously these were sequential, adding ~200-400ms of unnecessary latency.
  const dbFetchStart = Date.now();
  const [farmstandNameRaw, savedUserIds] = await Promise.all([
    getFarmstandName(farmstand_id),
    getSavedUserIds(farmstand_id),
  ]);
  const farmstandName = farmstandNameRaw ?? "Farmstand";
  console.log(
    `[PushDiag] ── stock_alert DB FETCH DONE ── +${Date.now() - dbFetchStart}ms` +
    ` (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)` +
    ` farmstand="${farmstandName}" savedUsers=${savedUserIds.length}`
  );
  const targetIds = savedUserIds.filter((id) => id !== userId);

  if (targetIds.length === 0) {
    console.log(
      `[StockAlert] no saved users to notify (total=${savedUserIds.length}, owner excluded)`
    );
    return c.json({ success: true, sent: 0, reason: "no_saved_users" });
  }

  console.log(
    `[StockAlert] saved users found: ${savedUserIds.length}, notifying: ${targetIds.length} (owner=${userId} excluded)`
  );

  const pushTitle = "Farmstand Update";
  const pushBody = `${product_name} is back in stock at ${farmstandName}.`;

  const pushData = {
    type: "stock_alert",
    farmstandId: farmstand_id,
    productId: product_id,
    productName: product_name,
    farmstandName: farmstandName,
  };

  // Non-blocking: send push notifications
  sendPushToUsers(targetIds, pushTitle, pushBody, pushData, {
    eventType: "stock_alert",
    eventId: product_id,
    eventCreatedAt: requestReceivedAt,
  })
    .then(() => {
      console.log(
        `[StockAlert] push sent successfully to ${targetIds.length} user(s) for "${product_name}"`
      );
    })
    .catch((err) => {
      console.log("[StockAlert] failed:", err);
    });

  // Non-blocking: insert in-app alerts
  insertAlertForUsers(targetIds, {
    title: pushTitle,
    body: pushBody,
    related_farmstand_id: farmstand_id,
    action_route: "farmstand",
    action_params: {
      farmstandId: farmstand_id,
      productId: product_id,
    },
  })
    .then(() => {
      console.log(
        `[StockAlert] alerts inserted: ${targetIds.length} for "${product_name}"`
      );
    })
    .catch(() => {/* non-fatal */});

  return c.json({ success: true, sent: targetIds.length });
});
