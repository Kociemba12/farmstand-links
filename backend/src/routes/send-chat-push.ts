import { Hono } from "hono";
import { z } from "zod";
import { sendPushToUsers } from "../lib/push-sender";
import { insertAlert } from "../lib/alert-inserter";

/**
 * Send Chat Push Route
 *
 * Called by the mobile app when a user sends a chat message,
 * to deliver a push notification to the recipient(s).
 *
 * SECURITY:
 * - Requires a valid user JWT
 * - Sender must be authenticated; recipient user_id is passed in body
 * - Push is only sent to users other than the sender
 *
 * PERF: All recipients' tokens are fetched in a single Supabase query,
 * then all messages are sent in a single Expo batch call.
 */
export const sendChatPushRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const chatPushSchema = z.object({
  // The user IDs of all thread participants who should receive the push
  recipient_user_ids: z.array(z.string()).min(1),
  // The user ID of the sender (excluded from push recipients)
  sender_user_id: z.string(),
  sender_name: z.string(),
  farmstand_name: z.string(),
  message_text: z.string().min(1),
  thread_id: z.string(),
  // Direct message routing fields (used by the client tap handler to open the right conversation)
  farmstand_id: z.string().optional(),
  other_user_id: z.string().optional(),
  // Stable conversation ID from the conversations table — allows the tap handler
  // to route directly to the exact thread without relying on farmstand_id alone.
  conversation_id: z.string().optional(),
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

sendChatPushRouter.post("/", async (c) => {
  // Capture the moment this request arrived — used to measure end-to-end push lag
  const requestReceivedAt = Date.now();
  console.log(
    `[PushDiag] ── chat REQUEST RECEIVED ── ts=${new Date(requestReceivedAt).toISOString()}`
  );

  const authHeader = c.req.header("Authorization");
  const jwtStart = Date.now();
  const { userId, error: authError } = await verifyJwt(authHeader);
  console.log(`[PushDiag] ── chat JWT verified ── +${Date.now() - jwtStart}ms (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)`);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = chatPushSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { recipient_user_ids, sender_user_id, sender_name, farmstand_name, message_text, thread_id, farmstand_id, other_user_id, conversation_id } = parsed.data;

  // Only notify users who are not the sender
  const targets = recipient_user_ids.filter((id) => id !== sender_user_id);

  if (targets.length === 0) {
    console.log("[SendChatPush] No recipients after excluding sender, skipping");
    return c.json({ success: true, sent: 0 });
  }

  const t0 = Date.now();
  console.log(`[PushSpeed][chat] ── START ── ${new Date().toISOString()} thread=${thread_id} recipients=${targets.length}`);
  console.log(
    `[PushDiag] ── chat PUSH START ── thread=${thread_id} recipients=${targets.length}` +
    ` lagSinceRequest=+${t0 - requestReceivedAt}ms ts=${new Date().toISOString()}`
  );

  const title = farmstand_name;
  const body_text = `${sender_name}: ${message_text.length > 80 ? message_text.slice(0, 80) + "…" : message_text}`;

  const pushData: Record<string, string> = {
    type: "message",
    threadId: thread_id,
  };
  if (farmstand_id) pushData.farmstandId = farmstand_id;
  if (other_user_id) pushData.otherUserId = other_user_id;
  if (conversation_id) pushData.conversation_id = conversation_id;

  // Batch: fetch tokens for ALL recipients in one Supabase query,
  // then send all messages in one Expo batch call.
  // This replaces the previous per-recipient Promise.all loop.
  await sendPushToUsers(targets, title, body_text, pushData, {
    eventType: "chat",
    eventId: thread_id,
    eventCreatedAt: requestReceivedAt,
  });

  console.log(`[PushSpeed][chat] ── push done — +${Date.now() - t0}ms`);

  // Insert in-app alerts non-blocking AFTER push is sent (does not delay push)
  for (const recipientId of targets) {
    insertAlert({
      user_id: recipientId,
      title,
      body: body_text,
      action_route: "chat",
      action_params: {
        threadId: thread_id,
        ...(farmstand_id ? { farmstandId: farmstand_id } : {}),
        ...(other_user_id ? { otherUserId: other_user_id } : {}),
        ...(conversation_id ? { conversation_id } : {}),
      },
    }).catch(() => {/* non-fatal */});
  }

  console.log(`[PushSpeed][chat] ── DONE — thread=${thread_id} elapsed=+${Date.now() - t0}ms`);
  return c.json({ success: true, sent: targets.length });
});
