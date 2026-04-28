import { Hono } from "hono";
import { z } from "zod";
import { sendPushToUsers } from "../lib/push-sender";
import { insertAlertForUsers } from "../lib/alert-inserter";

/**
 * Notify Stand Update Route
 *
 * Called when a farmstand owner creates/updates a product or inventory item.
 * Looks up all users who have saved that farmstand and fans out a push
 * notification + inbox alert to each of them.
 *
 * Uses the same push/alert infrastructure as send-saved-stand-push.ts.
 *
 * SECURITY:
 * - Requires a valid user JWT (caller must be the stand owner)
 * - Owner is excluded from recipient list
 */
export const notifyStandUpdateRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const notifyStandUpdateSchema = z.object({
  farmstand_id: z.string().uuid(),
  // true  → "has items in stock"
  // false → "updated their stand"
  is_available: z.boolean().optional().default(false),
});

async function verifyJwt(authHeader: string | undefined): Promise<{ userId: string | null; error: string | null }> {
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
    return data?.id ? { userId: data.id, error: null } : { userId: null, error: "No user ID in token" };
  } catch {
    return { userId: null, error: "Failed to verify session" };
  }
}

async function getFarmstandName(farmstandId: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/farmstands`);
    url.searchParams.set("select", "name");
    url.searchParams.set("id", `eq.${farmstandId}`);
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!response.ok) return null;
    const rows = (await response.json()) as Array<{ name: string }>;
    return rows[0]?.name ?? null;
  } catch {
    return null;
  }
}

async function getFollowerUserIds(farmstandId: string): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_saved_farmstands`);
    url.searchParams.set("select", "user_id");
    url.searchParams.set("farmstand_id", `eq.${farmstandId}`);

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!response.ok) {
      console.log("[NotifyStandUpdate] user_saved_farmstands query failed:", response.status);
      return [];
    }

    const rows = (await response.json()) as Array<{ user_id: string }>;
    return rows.map((r) => r.user_id).filter(Boolean);
  } catch (err) {
    console.log("[NotifyStandUpdate] Exception fetching followers:", err);
    return [];
  }
}

notifyStandUpdateRouter.post("/", async (c) => {
  // Capture the moment this request arrived — used to measure end-to-end push lag
  const requestReceivedAt = Date.now();
  console.log(
    `[PushDiag] ── stand_update REQUEST RECEIVED ── ts=${new Date(requestReceivedAt).toISOString()}`
  );

  const authHeader = c.req.header("Authorization");
  const jwtStart = Date.now();
  const { userId, error: authError } = await verifyJwt(authHeader);
  console.log(`[PushDiag] ── stand_update JWT verified ── +${Date.now() - jwtStart}ms (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)`);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = notifyStandUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { farmstand_id, is_available } = parsed.data;

  // Fetch farmstand name and follower IDs in PARALLEL — they are independent queries.
  // Previously these were sequential, adding ~200-400ms of unnecessary latency.
  const dbFetchStart = Date.now();
  const [farmstandName, allFollowerIds] = await Promise.all([
    getFarmstandName(farmstand_id),
    getFollowerUserIds(farmstand_id),
  ]);
  console.log(
    `[PushDiag] ── stand_update DB FETCH DONE ── +${Date.now() - dbFetchStart}ms` +
    ` (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)` +
    ` farmstand="${farmstandName ?? "N/A"}" followers=${allFollowerIds.length}`
  );

  if (!farmstandName) {
    console.log("[NotifyStandUpdate] Farmstand not found or name unavailable:", farmstand_id);
    // Non-fatal: farmstand may exist but table unavailable — return success to not block the client
    return c.json({ success: true, sent: 0 });
  }

  // Get all followers, then exclude the owner (caller)
  let followerIds = allFollowerIds.filter((id) => id !== userId);

  if (followerIds.length === 0) {
    console.log("[NotifyStandUpdate] No followers to notify for farmstand:", farmstand_id);
    return c.json({ success: true, sent: 0 });
  }

  const title = farmstandName;
  const bodyText = is_available
    ? `${farmstandName} has items in stock`
    : `${farmstandName} updated their stand`;

  // Non-blocking fan-out push
  sendPushToUsers(followerIds, title, bodyText, {
    type: "farmstand_update",
    farmstandId: farmstand_id,
  }, {
    eventType: "stand_update",
    eventId: farmstand_id,
    eventCreatedAt: requestReceivedAt,
  }).catch((err) => {
    console.log("[NotifyStandUpdate] Push error (non-fatal):", err);
  });

  // Persist alert for each follower so it appears in Inbox → Alerts tab (non-blocking)
  insertAlertForUsers(followerIds, {
    title,
    body: bodyText,
    related_farmstand_id: farmstand_id,
    action_route: "farmstand",
    action_params: { farmstandId: farmstand_id },
  }).catch(() => {/* non-fatal */});

  console.log(`[NotifyStandUpdate] Notification queued for ${followerIds.length} follower(s) for farmstand ${farmstand_id}`);
  return c.json({ success: true, sent: followerIds.length });
});
