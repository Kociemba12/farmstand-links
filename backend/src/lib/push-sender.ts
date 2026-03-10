/**
 * Expo Push Notification Sender
 *
 * Sends push notifications to one or more Expo push tokens via
 * the Expo Push API (https://exp.host/--/api/v2/push/send).
 *
 * This runs server-side so we can read push tokens from Supabase
 * using the service role key, then fan out to all of a user's devices.
 */

const EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  priority?: "default" | "normal" | "high";
}

interface PushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Fetch all active push tokens for a given user from Supabase.
 * Uses the service role key to bypass RLS.
 */
async function getPushTokensForUser(userId: string): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[PushSender] Supabase not configured, skipping token fetch");
    return [];
  }

  try {
    // Query user_push_tokens (primary table from push-notifications.ts)
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_push_tokens`);
    url.searchParams.set("select", "expo_push_token");
    url.searchParams.set("user_id", `eq.${userId}`);

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const err = await response.text();
      console.log("[PushSender] Error fetching push tokens:", response.status, err);
      return [];
    }

    const rows = (await response.json()) as Array<{ expo_push_token: string }>;
    const tokens = rows
      .map((r) => r.expo_push_token)
      .filter((t) => t && t.startsWith("ExponentPushToken["));

    console.log(`[PushSender] Found ${tokens.length} token(s) for user ${userId}`);
    return tokens;
  } catch (err) {
    console.log("[PushSender] Exception fetching tokens:", err);
    return [];
  }
}

/**
 * Fetch push tokens for multiple users at once.
 * Returns a map of userId → token[].
 */
async function getPushTokensForUsers(userIds: string[]): Promise<Map<string, string[]>> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || userIds.length === 0) {
    return new Map();
  }

  try {
    const idList = userIds.map((id) => `"${id}"`).join(",");
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_push_tokens`);
    url.searchParams.set("select", "user_id,expo_push_token");
    url.searchParams.set("user_id", `in.(${idList})`);

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.log("[PushSender] Error fetching tokens for users:", response.status);
      return new Map();
    }

    const rows = (await response.json()) as Array<{ user_id: string; expo_push_token: string }>;
    const result = new Map<string, string[]>();

    for (const row of rows) {
      if (!row.expo_push_token?.startsWith("ExponentPushToken[")) continue;
      const existing = result.get(row.user_id) ?? [];
      existing.push(row.expo_push_token);
      result.set(row.user_id, existing);
    }

    return result;
  } catch (err) {
    console.log("[PushSender] Exception fetching tokens for users:", err);
    return new Map();
  }
}

/**
 * Send push notifications to one or more Expo push tokens.
 * Batches up to 100 messages per request (Expo limit).
 */
async function sendPushMessages(messages: PushMessage[]): Promise<PushTicket[]> {
  if (messages.length === 0) return [];

  const tickets: PushTicket[] = [];

  // Expo allows up to 100 notifications per request
  const BATCH_SIZE = 100;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);

    try {
      const response = await fetch(EXPO_PUSH_API, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const err = await response.text();
        console.log("[PushSender] Expo Push API error:", response.status, err);
        continue;
      }

      const result = (await response.json()) as { data: PushTicket[] };
      const batchTickets = result.data ?? [];
      tickets.push(...batchTickets);

      // Log any errors
      for (let j = 0; j < batchTickets.length; j++) {
        const ticket = batchTickets[j];
        if (!ticket) continue;
        if (ticket.status === "error") {
          console.log(
            `[PushSender] Push error for token ${batch[j]?.to?.substring(0, 30)}:`,
            ticket.message,
            ticket.details?.error
          );
        } else {
          console.log(`[PushSender] Push sent OK to ${batch[j]?.to?.substring(0, 30)}`);
        }
      }
    } catch (err) {
      console.log("[PushSender] Exception calling Expo Push API:", err);
    }
  }

  return tickets;
}

/**
 * Send a push notification to a single user on all their devices.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const tokens = await getPushTokensForUser(userId);
  if (tokens.length === 0) {
    console.log(`[PushSender] No push tokens for user ${userId}, skipping`);
    return;
  }

  const messages: PushMessage[] = tokens.map((token) => ({
    to: token,
    title,
    body,
    data: data ?? {},
    sound: "default",
    priority: "high",
  }));

  await sendPushMessages(messages);
}

/**
 * Send a push notification to multiple users (fan-out).
 * Used for saved-stand updates where many users may need to be notified.
 */
export async function sendPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (userIds.length === 0) return;

  const tokenMap = await getPushTokensForUsers(userIds);
  if (tokenMap.size === 0) {
    console.log("[PushSender] No push tokens found for any of the target users");
    return;
  }

  const messages: PushMessage[] = [];
  for (const tokens of tokenMap.values()) {
    for (const token of tokens) {
      messages.push({
        to: token,
        title,
        body,
        data: data ?? {},
        sound: "default",
        priority: "high",
      });
    }
  }

  console.log(`[PushSender] Sending to ${messages.length} device(s) across ${tokenMap.size} user(s)`);
  await sendPushMessages(messages);
}
