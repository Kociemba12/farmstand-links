import { Hono } from "hono";
import { z } from "zod";
import { insertAlertForUsers } from "../lib/alert-inserter";

/**
 * Manual Stock Alert Route
 *
 * Owner-initiated push notification to all users who saved a specific farmstand.
 * Sends to all devices per user (multi-device support) with detailed stats.
 *
 * POST /api/manual-stock-alert
 * Body: { farmstand_id: string }
 * Returns: { success, sent, usersFound, tokensFound, pushesSent, pushesFailed, reason? }
 *
 * PERF: getFarmstandName + getSavedUserIds run in parallel.
 *       Both queries inside getSavedUserIds run in parallel.
 *       Token lookup is a single batched Supabase query.
 */
export const manualStockAlertRouter = new Hono();

const EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send";
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

/** In-memory per-farmstand rate limit: block re-sends within this window (ms) */
const COOLDOWN_MS = 15_000; // 15 seconds
const lastSentAt = new Map<string, number>();

const schema = z.object({
  farmstand_id: z.string().uuid(),
  alert_type: z.enum(['in_stock', 'out_of_stock']).optional().default('in_stock'),
});

// ── Auth ─────────────────────────────────────────────────────────────────────

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

// ── Farmstand lookup ──────────────────────────────────────────────────────────

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
    if (!resp.ok) {
      console.log(`[ManualStockAlert] getFarmstandName HTTP ${resp.status}`);
      return null;
    }
    const rows = (await resp.json()) as Array<{ name: string }>;
    return rows[0]?.name ?? null;
  } catch (err) {
    console.log("[ManualStockAlert] getFarmstandName exception:", err);
    return null;
  }
}

// ── Saved users (two queries in parallel) ─────────────────────────────────────

async function getSavedUserIds(farmstandId: string): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Run both table queries in parallel — they are independent
  const [savedRows, userSavedRows] = await Promise.all([
    // Primary: saved_farmstands (written by /api/favorites/toggle)
    (async (): Promise<Array<{ user_id: string }>> => {
      try {
        const url = new URL(`${SUPABASE_URL}/rest/v1/saved_farmstands`);
        url.searchParams.set("select", "user_id");
        url.searchParams.set("farmstand_id", `eq.${farmstandId}`);
        const resp = await fetch(url.toString(), { headers });
        if (resp.ok) {
          const rows = (await resp.json()) as Array<{ user_id: string }>;
          console.log(`[ManualStockAlert] saved_farmstands: ${rows.length} row(s) for farmstand ${farmstandId}`);
          return rows;
        }
        console.log(`[ManualStockAlert] saved_farmstands HTTP ${resp.status}`);
        return [];
      } catch (err) {
        console.log("[ManualStockAlert] saved_farmstands exception:", err);
        return [];
      }
    })(),
    // Fallback: user_saved_farmstands (push-notifications schema)
    (async (): Promise<Array<{ user_id: string }>> => {
      try {
        const url = new URL(`${SUPABASE_URL}/rest/v1/user_saved_farmstands`);
        url.searchParams.set("select", "user_id");
        url.searchParams.set("farmstand_id", `eq.${farmstandId}`);
        const resp = await fetch(url.toString(), { headers });
        if (resp.ok) {
          const rows = (await resp.json()) as Array<{ user_id: string }>;
          console.log(`[ManualStockAlert] user_saved_farmstands: ${rows.length} row(s) for farmstand ${farmstandId}`);
          return rows;
        }
        console.log(`[ManualStockAlert] user_saved_farmstands HTTP ${resp.status} (non-fatal)`);
        return [];
      } catch (err) {
        console.log("[ManualStockAlert] user_saved_farmstands exception (non-fatal):", err);
        return [];
      }
    })(),
  ]);

  const allIds = new Set<string>();
  for (const r of savedRows) if (r.user_id) allIds.add(r.user_id);
  for (const r of userSavedRows) if (r.user_id) allIds.add(r.user_id);

  const ids = Array.from(allIds);
  console.log(`[ManualStockAlert] saved users total: ${ids.length} (deduplicated across both tables)`);
  return ids;
}

// ── Token fetch (multi-device) ────────────────────────────────────────────────

async function getTokensForUsers(
  userIds: string[]
): Promise<Map<string, string[]>> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || userIds.length === 0) {
    return new Map();
  }

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  const result = new Map<string, string[]>();
  const idList = userIds.map((id) => `"${id}"`).join(",");

  // Step 1: user_push_tokens (one row per user per device OS — multi-device)
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_push_tokens`);
    url.searchParams.set("select", "user_id,expo_push_token");
    url.searchParams.set("user_id", `in.(${idList})`);

    const resp = await fetch(url.toString(), { headers });
    if (resp.ok) {
      const rows = (await resp.json()) as Array<{
        user_id: string;
        expo_push_token: string;
      }>;
      let validCount = 0;
      for (const row of rows) {
        if (!row.expo_push_token?.startsWith("ExponentPushToken[")) continue;
        const existing = result.get(row.user_id) ?? [];
        existing.push(row.expo_push_token);
        result.set(row.user_id, existing);
        validCount++;
      }
      console.log(
        `[ManualStockAlert] user_push_tokens: ${validCount} valid token(s) across ${result.size}/${userIds.length} user(s)`
      );
    } else {
      console.log(`[ManualStockAlert] user_push_tokens HTTP ${resp.status}`);
    }
  } catch (err) {
    console.log("[ManualStockAlert] user_push_tokens exception:", err);
  }

  // Step 2: profiles.expo_push_token fallback for users with no user_push_tokens row
  const missingIds = userIds.filter((id) => !result.has(id));
  if (missingIds.length > 0) {
    console.log(
      `[ManualStockAlert] profiles fallback for ${missingIds.length} user(s) not in user_push_tokens`
    );
    try {
      const missingList = missingIds.map((id) => `"${id}"`).join(",");
      const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
      url.searchParams.set("select", "id,expo_push_token");
      url.searchParams.set("id", `in.(${missingList})`);

      const resp = await fetch(url.toString(), { headers });
      if (resp.ok) {
        const rows = (await resp.json()) as Array<{
          id: string;
          expo_push_token: string | null;
        }>;
        let fallbackCount = 0;
        for (const row of rows) {
          if (!row.expo_push_token?.startsWith("ExponentPushToken[")) continue;
          result.set(row.id, [row.expo_push_token]);
          fallbackCount++;
        }
        console.log(
          `[ManualStockAlert] profiles fallback: found ${fallbackCount} additional token(s)`
        );
      } else {
        console.log(`[ManualStockAlert] profiles fallback HTTP ${resp.status}`);
      }
    } catch (err) {
      console.log("[ManualStockAlert] profiles fallback exception:", err);
    }
  }

  const totalTokens = Array.from(result.values()).reduce(
    (sum, toks) => sum + toks.length,
    0
  );
  console.log(
    `[ManualStockAlert] token fetch complete: ${totalTokens} token(s) for ${result.size}/${userIds.length} user(s)`
  );
  return result;
}

// ── Push sender with per-token stats ─────────────────────────────────────────

interface PushStats {
  pushesSent: number;
  pushesFailed: number;
}

async function sendStockAlertPushes(
  tokenMap: Map<string, string[]>,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<PushStats> {
  const messages: Array<{
    to: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    sound: string;
    priority: string;
    channelId?: string;
  }> = [];

  for (const [userId, tokens] of tokenMap.entries()) {
    for (const token of tokens) {
      messages.push({
        to: token,
        title,
        body,
        data,
        sound: "default",
        priority: "high",
        channelId: "default", // Required for Android background delivery
      });
    }
    console.log(
      `[ManualStockAlert] queued ${tokens.length} push(es) for user ${userId}`
    );
  }

  console.log(
    `[ManualStockAlert] sending ${messages.length} push message(s) to ${tokenMap.size} user(s)`
  );

  let pushesSent = 0;
  let pushesFailed = 0;

  // Expo allows up to 100 per request
  const BATCH_SIZE = 100;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const t0 = Date.now();
    console.log(`[PushSpeed][stock-send] expo POST start — msgs=${batch.length} — ${new Date().toISOString()}`);
    try {
      const resp = await fetch(EXPO_PUSH_API, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      console.log(`[PushSpeed][stock-send] expo responded — status=${resp.status} — +${Date.now() - t0}ms`);

      if (!resp.ok) {
        const errText = await resp.text();
        console.log(
          `[ManualStockAlert] Expo HTTP error: ${resp.status} — ${errText}`
        );
        pushesFailed += batch.length;
        continue; // Don't crash — continue with next batch
      }

      const result = (await resp.json()) as {
        data: Array<{
          status: "ok" | "error";
          id?: string;
          message?: string;
          details?: { error?: string };
        }>;
      };

      for (let j = 0; j < (result.data ?? []).length; j++) {
        const ticket = result.data[j];
        const token = batch[j]?.to?.substring(0, 40) ?? "unknown";
        if (ticket?.status === "ok") {
          pushesSent++;
          console.log(
            `[ManualStockAlert] ✅ push OK — token: ${token}… ticketId: ${ticket.id ?? "N/A"}`
          );
        } else {
          pushesFailed++;
          console.log(
            `[ManualStockAlert] ❌ push REJECTED — token: ${token}… status: ${ticket?.status} ` +
              `message: "${ticket?.message ?? ""}" error: "${ticket?.details?.error ?? ""}"`
          );
        }
      }
    } catch (err) {
      console.log(`[ManualStockAlert] Expo batch exception (non-fatal):`, err);
      pushesFailed += batch.length; // Assume all failed in this batch
    }
  }

  console.log(
    `[ManualStockAlert] push results: sent=${pushesSent} failed=${pushesFailed}`
  );
  return { pushesSent, pushesFailed };
}

// ── Route handler ─────────────────────────────────────────────────────────────

manualStockAlertRouter.post("/", async (c) => {
  // Capture the moment this request arrived — used to measure end-to-end push lag
  const requestReceivedAt = Date.now();
  console.log(
    `[PushDiag] ── manual_stock_alert REQUEST RECEIVED ── ts=${new Date(requestReceivedAt).toISOString()}`
  );

  const authHeader = c.req.header("Authorization");
  const jwtStart = Date.now();
  const { userId, error: authError } = await verifyJwt(authHeader);
  console.log(`[PushDiag] ── manual_stock_alert JWT verified ── +${Date.now() - jwtStart}ms (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)`);

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
        error: parsed.error.issues[0]?.message || "Invalid farmstand_id",
      },
      400
    );
  }

  const { farmstand_id, alert_type } = parsed.data;

  const t0 = Date.now();
  console.log(
    `[PushSpeed][stock] ── START ── ${new Date().toISOString()} owner=${userId} farmstand=${farmstand_id}`
  );

  // ── Rate limit: prevent rapid re-sends ──────────────────────────────────────
  const rateKey = `${userId}:${farmstand_id}`;
  const last = lastSentAt.get(rateKey) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < COOLDOWN_MS) {
    const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    console.log(
      `[ManualStockAlert] Rate limit hit for ${rateKey} — ${waitSec}s remaining`
    );
    return c.json(
      {
        success: false,
        error: `Please wait ${waitSec} second${waitSec === 1 ? "" : "s"} before sending again`,
      },
      429
    );
  }

  // ── Parallel: fetch farmstand name AND saved user IDs at the same time ───────
  const [farmstandName, savedUserIds] = await Promise.all([
    getFarmstandName(farmstand_id),
    getSavedUserIds(farmstand_id),
  ]);

  console.log(
    `[PushSpeed][stock] farmstand+users loaded: +${Date.now() - t0}ms — name="${farmstandName}" savedUsers=${savedUserIds.length}`
  );

  if (!farmstandName) {
    console.log(`[ManualStockAlert] Farmstand ${farmstand_id} not found or has no name`);
    return c.json({ success: false, error: "Farmstand not found" }, 404);
  }

  console.log(`[ManualStockAlert] Farmstand validated: "${farmstandName}"`);

  // ── Filter out owner, deduplicate ────────────────────────────────────────────
  const targetIds = savedUserIds.filter((id) => id !== userId);
  const usersFound = targetIds.length;

  console.log(
    `[ManualStockAlert] saved users: ${savedUserIds.length} total | ${usersFound} after excluding owner`
  );

  if (usersFound === 0) {
    return c.json({
      success: true,
      sent: 0,
      usersFound: 0,
      tokensFound: 0,
      pushesSent: 0,
      pushesFailed: 0,
      reason: "no_saved_users",
    });
  }

  // ── Fetch push tokens (multi-device: user_push_tokens + profiles fallback) ───
  console.log(`[PushSpeed][stock] token fetch start — +${Date.now() - t0}ms`);
  const tokenMap = await getTokensForUsers(targetIds);
  const tokensFound = Array.from(tokenMap.values()).reduce(
    (sum, toks) => sum + toks.length,
    0
  );

  console.log(
    `[PushSpeed][stock] tokens loaded: +${Date.now() - t0}ms — ${tokensFound} token(s) across ${tokenMap.size}/${usersFound} user(s)`
  );

  if (tokensFound === 0) {
    console.log("[ManualStockAlert] No push tokens found — skipping push send");
    // Still insert in-app alerts even if no push tokens
    const noTokenTitle = alert_type === 'out_of_stock'
      ? `${farmstandName} is out of stock`
      : `${farmstandName} is stocked`;
    const noTokenBody = alert_type === 'out_of_stock'
      ? "They've marked the stand as currently out of stock. Tap to view."
      : "They've stocked the stand. Tap to view.";

    insertAlertForUsers(targetIds, {
      title: noTokenTitle,
      body: noTokenBody,
      related_farmstand_id: farmstand_id,
      action_route: "farm",
      action_params: { farmstandId: farmstand_id },
    }).catch(() => {/* non-fatal */});

    lastSentAt.set(rateKey, Date.now());

    return c.json({
      success: true,
      sent: 0,
      usersFound,
      tokensFound: 0,
      pushesSent: 0,
      pushesFailed: 0,
      reason: "no_push_tokens",
    });
  }

  // ── Build push payload ───────────────────────────────────────────────────────
  const pushTitle = alert_type === 'out_of_stock'
    ? `${farmstandName} is out of stock`
    : `${farmstandName} is stocked`;
  const pushBody = alert_type === 'out_of_stock'
    ? "They've marked the stand as currently out of stock. Tap to view."
    : "They've stocked the stand. Tap to view.";

  /**
   * Deep link data — handled by _layout.tsx addNotificationResponseReceivedListener.
   * Works on cold start: Expo stores the tapped notification and fires the listener
   * once the app is ready. The handler does: router.push(`/farm/${data.farmstandId}`)
   */
  const pushData: Record<string, unknown> = {
    type: "manual_stock_alert",
    farmstandId: farmstand_id,
    farmstandName,
    screen: "farmstand",
  };

  // ── Send pushes ──────────────────────────────────────────────────────────────
  console.log(`[PushSpeed][stock] expo send start — +${Date.now() - t0}ms`);
  console.log(
    `[PushDiag] ── manual_stock_alert PUSH START ──` +
    ` farmstand=${farmstand_id} recipients=${usersFound} tokens=${tokensFound}` +
    ` lagSinceRequest=+${Date.now() - requestReceivedAt}ms ts=${new Date().toISOString()}`
  );
  const { pushesSent, pushesFailed } = await sendStockAlertPushes(
    tokenMap,
    pushTitle,
    pushBody,
    pushData
  );
  console.log(`[PushSpeed][stock] expo responded — +${Date.now() - t0}ms`);

  // ── Insert in-app alerts (non-blocking — don't hold up the response) ─────────
  insertAlertForUsers(targetIds, {
    title: pushTitle,
    body: pushBody,
    related_farmstand_id: farmstand_id,
    action_route: "farm",
    action_params: { farmstandId: farmstand_id },
  })
    .then(() => {
      console.log(
        `[ManualStockAlert] in-app alerts inserted for ${targetIds.length} user(s)`
      );
    })
    .catch(() => {/* non-fatal */});

  // ── Record send time for rate limiting ───────────────────────────────────────
  lastSentAt.set(rateKey, Date.now());

  console.log(
    `[PushSpeed][stock] ── DONE ── +${Date.now() - t0}ms total | farmstand="${farmstandName}" ` +
      `usersFound=${usersFound} tokensFound=${tokensFound} ` +
      `pushesSent=${pushesSent} pushesFailed=${pushesFailed}`
  );
  console.log(
    `[PushDiag] ── manual_stock_alert DONE ──` +
    ` farmstand="${farmstandName}" usersFound=${usersFound} tokens=${tokensFound}` +
    ` pushesSent=${pushesSent} pushesFailed=${pushesFailed}` +
    ` totalLagSinceRequest=+${Date.now() - requestReceivedAt}ms`
  );

  return c.json({
    success: true,
    sent: pushesSent,
    usersFound,
    tokensFound,
    pushesSent,
    pushesFailed,
  });
});
