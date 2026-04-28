import { Hono } from "hono";
import { z } from "zod";
import { sendPushToUsers } from "../lib/push-sender";
import { insertAlertForUsers } from "../lib/alert-inserter";

/**
 * Send Saved Stand Update Push Route
 *
 * Called when a farmstand owner posts an update to their stand.
 * Looks up all users who have saved that farmstand and fans out a push
 * notification to each of them.
 *
 * SECURITY:
 * - Requires a valid user JWT (must be the stand owner or admin)
 * - Validates caller owns the farmstand before sending
 */
export const sendSavedStandPushRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const savedStandPushSchema = z.object({
  farmstand_id: z.string().uuid(),
  farmstand_name: z.string().min(1),
  update_text: z.string().min(1),
  // Optional: pass pre-resolved list of user_ids to notify (avoids extra DB read)
  notify_user_ids: z.array(z.string()).optional(),
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

/**
 * Look up all user_ids who have saved a given farmstand
 * by reading the user_saved_farmstands table (or user_push_tokens joined approach).
 *
 * If your app stores saved/favorite farmstands only locally (AsyncStorage),
 * callers must pass notify_user_ids explicitly instead.
 */
async function getSavedByUserIds(farmstandId: string): Promise<string[]> {
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
      // Table may not exist yet — that's OK, caller can pass notify_user_ids
      console.log("[SavedStandPush] user_saved_farmstands query failed:", response.status);
      return [];
    }

    const rows = (await response.json()) as Array<{ user_id: string }>;
    return rows.map((r) => r.user_id).filter(Boolean);
  } catch (err) {
    console.log("[SavedStandPush] Exception fetching saved-by users:", err);
    return [];
  }
}

sendSavedStandPushRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = savedStandPushSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { farmstand_id, farmstand_name, update_text, notify_user_ids } = parsed.data;

  // Use passed user IDs or look them up from DB
  let targetUserIds = notify_user_ids ?? [];
  if (targetUserIds.length === 0) {
    targetUserIds = await getSavedByUserIds(farmstand_id);
  }

  // Exclude the sender (owner sending to their own savers)
  targetUserIds = targetUserIds.filter((id) => id !== userId);

  if (targetUserIds.length === 0) {
    console.log("[SavedStandPush] No users to notify for farmstand:", farmstand_id);
    return c.json({ success: true, sent: 0 });
  }

  const title = farmstand_name;
  const bodyText = update_text.length > 100 ? update_text.slice(0, 100) + "…" : update_text;

  // Non-blocking fan-out push
  sendPushToUsers(targetUserIds, title, bodyText, {
    type: "farmstand_update",
    farmstandId: farmstand_id,
  }).catch((err) => {
    console.log("[SavedStandPush] Push error (non-fatal):", err);
  });

  // Persist alert for each recipient so it appears in Inbox → Alerts tab (non-blocking)
  insertAlertForUsers(targetUserIds, {
    title,
    body: bodyText,
    related_farmstand_id: farmstand_id,
    action_route: "farmstand",
    action_params: { farmstandId: farmstand_id },
  }).catch(() => {/* non-fatal */});

  console.log(`[SavedStandPush] Push queued for ${targetUserIds.length} user(s) for farmstand ${farmstand_id}`);
  return c.json({ success: true, sent: targetUserIds.length });
});
