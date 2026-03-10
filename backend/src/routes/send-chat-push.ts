import { Hono } from "hono";
import { z } from "zod";
import { sendPushToUser } from "../lib/push-sender";

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

  const parsed = chatPushSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { recipient_user_ids, sender_user_id, sender_name, farmstand_name, message_text, thread_id } = parsed.data;

  // Only notify users who are not the sender
  const targets = recipient_user_ids.filter((id) => id !== sender_user_id);

  if (targets.length === 0) {
    console.log("[SendChatPush] No recipients after excluding sender, skipping");
    return c.json({ success: true, sent: 0 });
  }

  const title = farmstand_name;
  const body_text = `${sender_name}: ${message_text.length > 80 ? message_text.slice(0, 80) + "…" : message_text}`;

  const pushData = {
    type: "message",
    threadId: thread_id,
  };

  // Fan out to all recipients (non-blocking)
  let sent = 0;
  await Promise.all(
    targets.map(async (recipientId) => {
      try {
        await sendPushToUser(recipientId, title, body_text, pushData);
        sent++;
      } catch (err) {
        console.log(`[SendChatPush] Push failed for user ${recipientId}:`, err);
      }
    })
  );

  console.log(`[SendChatPush] Sent push to ${sent}/${targets.length} recipient(s) for thread ${thread_id}`);
  return c.json({ success: true, sent });
});
