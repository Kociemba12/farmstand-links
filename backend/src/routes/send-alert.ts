import { Hono } from "hono";
import { z } from "zod";
import { sendPushToUser } from "../lib/push-sender";

/**
 * Send Alert Route
 *
 * Inserts a row into the `alerts` table using the service role key,
 * bypassing RLS so admins can send alerts to any user.
 * Also fires a push notification to all of the user's registered devices.
 *
 * SECURITY:
 * - Requires a valid user JWT (verified with Supabase auth)
 * - Only inserts — never reads other users' data
 * - user_id in the alert body is taken from the request (admin chooses recipient)
 *   but the caller's identity is verified first
 */
export const sendAlertRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const alertSchema = z.object({
  user_id: z.string().uuid(),
  farmstand_id: z.string().uuid().nullable().optional(),
  type: z.string(),
  title: z.string().min(1),
  body: z.string().min(1),
  action_route: z.string().nullable().optional(),
  action_params: z.record(z.string(), z.string()).nullable().optional(),
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

sendAlertRouter.post("/", async (c) => {
  // Capture the moment this request arrived — used to measure end-to-end push lag
  const requestReceivedAt = Date.now();
  console.log(
    `[PushDiag] ── admin_alert REQUEST RECEIVED ── ts=${new Date(requestReceivedAt).toISOString()}`
  );

  const authHeader = c.req.header("Authorization");
  const jwtStart = Date.now();
  const { userId, error: authError } = await verifyJwt(authHeader);
  console.log(`[PushDiag] ── admin_alert JWT verified ── +${Date.now() - jwtStart}ms (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)`);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = alertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { user_id, farmstand_id, type, title, body: alertBody, action_route, action_params } = parsed.data;

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/inbox_alerts`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      user_id,
      farmstand_id: farmstand_id ?? null,
      type,
      title,
      body: alertBody,
      action_route: action_route ?? null,
      action_params: action_params ?? null,
    }),
  });

  console.log(`[SendAlert] Insert status: ${insertResp.status} for user ${user_id}`);

  if (!insertResp.ok && insertResp.status !== 204) {
    const errText = await insertResp.text();
    console.error("[SendAlert] Insert failed:", insertResp.status, errText);
    return c.json({ success: false, error: "Failed to send alert" }, 500);
  }

  console.log(`[SendAlert] Alert sent successfully to user ${user_id}`);

  // Fire push notification (non-blocking — don't fail the request if push fails)
  console.log(
    `[PushDiag] ── admin_alert PUSH START ──` +
    ` targetUser=${user_id}` +
    ` lagSinceRequest=+${Date.now() - requestReceivedAt}ms` +
    ` ts=${new Date().toISOString()}`
  );
  sendPushToUser(user_id, title, alertBody, {
    type: "alert",
    alertType: type,
    actionRoute: action_route ?? null,
    actionParams: action_params ?? null,
    farmstandId: farmstand_id ?? null,
  }, {
    eventType: "admin_alert",
    eventCreatedAt: requestReceivedAt,
  }).catch((err) => {
    console.log("[SendAlert] Push notification error (non-fatal):", err);
  });

  return c.json({ success: true });
});

