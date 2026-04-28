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

/**
 * Optional metadata attached to a push send for timing diagnostics.
 * Pass this from each route so logs show lag between event creation and Expo delivery.
 */
export interface PushMeta {
  /** Identifies the push flow, e.g. "chat", "stock_alert", "admin_alert", "claim_approved" */
  eventType?: string;
  /** ID of the record that triggered the push (thread_id, product_id, claim_id, …) */
  eventId?: string;
  /** Date.now() captured at the moment the HTTP request was received by the route handler */
  eventCreatedAt?: number;
}

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

const serviceHeaders = () => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
});

/**
 * Fetch all active push tokens for a given user from Supabase.
 * Queries user_push_tokens first; falls back to profiles.expo_push_token.
 * Uses the service role key to bypass RLS.
 */
async function getPushTokensForUser(userId: string): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[PushSender] Supabase not configured, skipping token fetch");
    return [];
  }

  const t0 = Date.now();
  const result: string[] = [];
  const hdrs = serviceHeaders();

  // ── Step 1: user_push_tokens (multi-device table) ─────────────────────────
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_push_tokens`);
    url.searchParams.set("select", "expo_push_token");
    url.searchParams.set("user_id", `eq.${userId}`);

    const response = await fetch(url.toString(), { headers: hdrs });
    console.log(`[PushSpeed][token] user_push_tokens for user=${userId}: +${Date.now() - t0}ms`);

    if (!response.ok) {
      console.log("[PushSender] Error fetching push tokens:", response.status, await response.text());
    } else {
      const rows = (await response.json()) as Array<{ expo_push_token: string }>;
      for (const r of rows) {
        if (r.expo_push_token?.startsWith("ExponentPushToken[")) result.push(r.expo_push_token);
      }
    }
  } catch (err) {
    console.log("[PushSender] Exception fetching user_push_tokens:", err);
  }

  // ── Step 2: profiles fallback if user has no user_push_tokens row ──────────
  if (result.length === 0) {
    try {
      const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
      url.searchParams.set("select", "expo_push_token");
      url.searchParams.set("id", `eq.${userId}`);
      url.searchParams.set("limit", "1");

      const response = await fetch(url.toString(), { headers: hdrs });
      console.log(`[PushSpeed][token] profiles fallback for user=${userId}: +${Date.now() - t0}ms`);

      if (response.ok) {
        const rows = (await response.json()) as Array<{ expo_push_token: string | null }>;
        const tok = rows[0]?.expo_push_token;
        if (tok?.startsWith("ExponentPushToken[")) {
          result.push(tok);
          console.log(`[PushSender] profiles fallback: found token for user ${userId}`);
        }
      }
    } catch (err) {
      console.log("[PushSender] Exception fetching profiles fallback:", err);
    }
  }

  console.log(`[PushSender] Found ${result.length} token(s) for user ${userId} — +${Date.now() - t0}ms total`);
  return result;
}

/**
 * Fetch push tokens for multiple users at once (single Supabase query per table).
 * Returns a map of userId → token[].
 *
 * Strategy:
 * 1. Query user_push_tokens (the multi-device table written by push-notifications.ts).
 * 2. For any user not found there, fall back to profiles.expo_push_token.
 */
async function getPushTokensForUsers(userIds: string[]): Promise<Map<string, string[]>> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || userIds.length === 0) {
    return new Map();
  }

  const t0 = Date.now();
  const hdrs = serviceHeaders();
  const result = new Map<string, string[]>();

  console.log(`[PushSpeed][tokens] lookup start — ${userIds.length} user(s)`);

  // ── Step 1: query user_push_tokens ──────────────────────────────────────────
  try {
    const idList = userIds.map((id) => `"${id}"`).join(",");
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_push_tokens`);
    url.searchParams.set("select", "user_id,expo_push_token");
    url.searchParams.set("user_id", `in.(${idList})`);

    const response = await fetch(url.toString(), { headers: hdrs });
    console.log(`[PushSpeed][tokens] user_push_tokens responded: +${Date.now() - t0}ms`);

    if (!response.ok) {
      console.log("[PushSender] Error fetching user_push_tokens:", response.status);
    } else {
      const rows = (await response.json()) as Array<{ user_id: string; expo_push_token: string }>;
      for (const row of rows) {
        if (!row.expo_push_token?.startsWith("ExponentPushToken[")) continue;
        const existing = result.get(row.user_id) ?? [];
        existing.push(row.expo_push_token);
        result.set(row.user_id, existing);
      }
      console.log(`[PushSender] user_push_tokens: found tokens for ${result.size}/${userIds.length} user(s)`);
    }
  } catch (err) {
    console.log("[PushSender] Exception fetching user_push_tokens:", err);
  }

  // ── Step 2: fall back to profiles.expo_push_token for any missing users ─────
  const missingIds = userIds.filter((id) => !result.has(id));
  if (missingIds.length > 0) {
    console.log(`[PushSender] Falling back to profiles.expo_push_token for ${missingIds.length} user(s) with no user_push_tokens row`);
    try {
      const idList = missingIds.map((id) => `"${id}"`).join(",");
      const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
      url.searchParams.set("select", "id,expo_push_token");
      url.searchParams.set("id", `in.(${idList})`);

      const response = await fetch(url.toString(), { headers: hdrs });
      console.log(`[PushSpeed][tokens] profiles fallback responded: +${Date.now() - t0}ms`);

      if (!response.ok) {
        console.log("[PushSender] Error fetching profiles fallback:", response.status);
      } else {
        const rows = (await response.json()) as Array<{ id: string; expo_push_token: string | null }>;
        let fallbackCount = 0;
        for (const row of rows) {
          if (!row.expo_push_token?.startsWith("ExponentPushToken[")) continue;
          result.set(row.id, [row.expo_push_token]);
          fallbackCount++;
        }
        if (fallbackCount > 0) {
          console.log(`[PushSender] profiles fallback: found tokens for ${fallbackCount} additional user(s)`);
        } else {
          console.log(`[PushSender] profiles fallback: no tokens found for the remaining ${missingIds.length} user(s)`);
        }
      }
    } catch (err) {
      console.log("[PushSender] Exception fetching profiles fallback:", err);
    }
  }

  console.log(`[PushSpeed][tokens] lookup done — +${Date.now() - t0}ms — ${result.size}/${userIds.length} users with tokens`);
  return result;
}

/**
 * Send push notifications to one or more Expo push tokens.
 * Batches up to 100 messages per request (Expo limit).
 */
async function sendPushMessages(messages: PushMessage[]): Promise<PushTicket[]> {
  if (messages.length === 0) return [];

  const t0 = Date.now();
  const tickets: PushTicket[] = [];

  // Expo allows up to 100 notifications per request
  const BATCH_SIZE = 100;
  const totalBatches = Math.ceil(messages.length / BATCH_SIZE);

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchN = Math.floor(i / BATCH_SIZE) + 1;
    const batchLabel = totalBatches > 1 ? ` [batch ${batchN}/${totalBatches}]` : "";

    console.log(`[PushSpeed][send] expo POST start${batchLabel} — msgs=${batch.length} — ${new Date().toISOString()}`);

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

      console.log(`[PushSpeed][send] expo responded${batchLabel} — status=${response.status} — +${Date.now() - t0}ms`);

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

  console.log(`[PushSpeed][send] all batches done — total +${Date.now() - t0}ms`);
  return tickets;
}

/**
 * Fetch the authoritative push token and email for a user from profiles.
 * Used exclusively for claim-related push notifications.
 */
async function getProfileForClaimPush(
  userId: string
): Promise<{ token: string | null; email: string | null }> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { token: null, email: null };
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
    url.searchParams.set("select", "id,email,expo_push_token");
    url.searchParams.set("id", `eq.${userId}`);
    url.searchParams.set("limit", "1");

    console.log(`[ClaimPush] DB SELECT profiles WHERE id=${userId} — ${url}`);
    const response = await fetch(url.toString(), { headers: serviceHeaders() });

    if (!response.ok) {
      const err = await response.text();
      console.log(`[ClaimPush] ❌ DB SELECT FAILED HTTP ${response.status} — ${err}`);
      return { token: null, email: null };
    }

    const rows = (await response.json()) as Array<{
      id: string;
      email?: string | null;
      expo_push_token: string | null;
    }>;
    if (rows.length === 0) {
      console.log(`[ClaimPush] ❌ DB SELECT: NO profile row found for id=${userId}`);
      return { token: null, email: null };
    }
    const row = rows[0]!;
    const token = row.expo_push_token ?? null;
    const email = row.email ?? null;
    console.log(
      `[ClaimPush] DB SELECT result — id=${row.id} email=${email ?? "NULL"} ` +
      `expo_push_token=${token ? `"${token}"` : "NULL"}`
    );
    return { token, email };
  } catch (err) {
    console.log("[ClaimPush] ❌ DB SELECT EXCEPTION:", err);
    return { token: null, email: null };
  }
}

/**
 * Send a claim-related push notification to EXACTLY ONE user using the
 * authoritative token from profiles.expo_push_token.
 *
 * STRICT — no fallback to user_push_tokens.
 * Used for: request-more-info, deny-claim, approve-claim.
 */
export async function sendClaimPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  console.log(`[ClaimPush] ── START ── claimantUserId=${userId}`);

  const { token: profileToken, email } = await getProfileForClaimPush(userId);

  console.log(
    `[ClaimPush] Claimant — userId=${userId} email=${email ?? "NULL"} ` +
    `profiles.expo_push_token=${profileToken ? `"${profileToken}"` : "NULL"}`
  );

  if (!profileToken) {
    console.log(
      `[ClaimPush] ❌ ABORT — profiles.expo_push_token is NULL for userId=${userId}. ` +
      `Token has not been written to the DB. NO push sent.`
    );
    return;
  }

  if (!profileToken.startsWith("ExponentPushToken[")) {
    console.log(
      `[ClaimPush] ❌ ABORT — token is malformed (not an ExponentPushToken). ` +
      `userId=${userId} value="${profileToken}" — NO push sent.`
    );
    return;
  }

  const payload = [
    {
      to: profileToken,
      title,
      body,
      data: data ?? {},
      sound: "default" as const,
      priority: "high" as const,
    },
  ];
  console.log(`[ClaimPush] Expo request payload — ${JSON.stringify(payload)}`);

  try {
    const t0 = Date.now();
    console.log(`[PushSpeed][claim] expo POST start — ${new Date().toISOString()}`);

    const expoResp = await fetch(EXPO_PUSH_API, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const expoStatus = expoResp.status;
    const expoBody = await expoResp.text();
    console.log(`[PushSpeed][claim] expo responded — status=${expoStatus} — +${Date.now() - t0}ms`);
    console.log(`[ClaimPush] Expo HTTP response — status=${expoStatus} body=${expoBody}`);

    if (!expoResp.ok) {
      console.log(`[ClaimPush] ❌ PUSH FAILED — Expo returned HTTP ${expoStatus}. userId=${userId} token="${profileToken}"`);
      return;
    }

    let parsed: { data?: Array<{ status: string; id?: string; message?: string; details?: { error?: string } }> };
    try {
      parsed = JSON.parse(expoBody) as typeof parsed;
    } catch {
      console.log(`[ClaimPush] ❌ Could not parse Expo response JSON: ${expoBody}`);
      return;
    }

    const tickets = parsed.data ?? [];
    const ticket = tickets[0];
    if (ticket?.status === "ok") {
      console.log(
        `[ClaimPush] ✅ PUSH SUCCESS — Expo accepted delivery. ` +
        `userId=${userId} email=${email ?? "NULL"} token="${profileToken}" ticketId=${ticket.id ?? "N/A"}`
      );
    } else {
      console.log(
        `[ClaimPush] ❌ PUSH REJECTED BY EXPO — ` +
        `userId=${userId} email=${email ?? "NULL"} token="${profileToken}" ` +
        `ticket.status=${ticket?.status ?? "N/A"} message="${ticket?.message ?? ""}" ` +
        `details.error="${ticket?.details?.error ?? ""}"`
      );
    }
  } catch (err) {
    console.log(`[ClaimPush] ❌ NETWORK ERROR sending to Expo — userId=${userId}: ${err}`);
  }

  console.log(`[ClaimPush] ── END ── userId=${userId}`);
}

/**
 * Send a push notification to a single user on all their devices.
 * Queries user_push_tokens first; falls back to profiles.expo_push_token.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  meta?: PushMeta
): Promise<void> {
  const t0 = Date.now();
  const lagSinceEvent = meta?.eventCreatedAt != null ? t0 - meta.eventCreatedAt : null;
  console.log(
    `[PushDiag] ── sendPushToUser START ──` +
    ` eventType=${meta?.eventType ?? "unknown"}` +
    ` eventId=${meta?.eventId ?? "N/A"}` +
    ` userId=${userId}` +
    ` lagSinceEvent=${lagSinceEvent !== null ? `+${lagSinceEvent}ms` : "N/A"}` +
    ` ts=${new Date().toISOString()}`
  );
  console.log(`[PushSpeed][user] start — userId=${userId}`);

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
  const totalMs = Date.now() - t0;
  const lagEnd = meta?.eventCreatedAt != null ? Date.now() - meta.eventCreatedAt : null;
  console.log(
    `[PushDiag] ── sendPushToUser DONE ──` +
    ` eventType=${meta?.eventType ?? "unknown"}` +
    ` eventId=${meta?.eventId ?? "N/A"}` +
    ` userId=${userId}` +
    ` elapsed=+${totalMs}ms` +
    ` totalLagSinceEvent=${lagEnd !== null ? `+${lagEnd}ms` : "N/A"}`
  );
  console.log(`[PushSpeed][user] done — userId=${userId} — +${totalMs}ms total`);
}

/**
 * Send a push notification to multiple users (fan-out).
 * Single batch token lookup + single Expo POST per 100 messages.
 * Used for saved-stand updates where many users may need to be notified.
 */
export async function sendPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
  meta?: PushMeta
): Promise<void> {
  if (userIds.length === 0) return;

  const t0 = Date.now();
  const lagSinceEvent = meta?.eventCreatedAt != null ? t0 - meta.eventCreatedAt : null;
  console.log(
    `[PushDiag] ── sendPushToUsers START ──` +
    ` eventType=${meta?.eventType ?? "unknown"}` +
    ` eventId=${meta?.eventId ?? "N/A"}` +
    ` recipients=${userIds.length}` +
    ` lagSinceEvent=${lagSinceEvent !== null ? `+${lagSinceEvent}ms` : "N/A"}` +
    ` ts=${new Date().toISOString()}`
  );
  console.log(`[PushSpeed][users] start — ${userIds.length} target user(s) — ${new Date().toISOString()}`);

  const tokenMap = await getPushTokensForUsers(userIds);
  if (tokenMap.size === 0) {
    console.log(`[PushSender] No push tokens found for any of the ${userIds.length} target user(s) — push skipped`);
    return;
  }

  const messages: PushMessage[] = [];
  for (const [userId, tokens] of tokenMap.entries()) {
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
    console.log(`[PushSender] user ${userId}: ${tokens.length} device token(s)`);
  }

  console.log(`[PushSpeed][users] tokens loaded, building batch — ${messages.length} message(s) to ${tokenMap.size} user(s) — +${Date.now() - t0}ms`);
  console.log(
    `[PushDiag] ── sendPushToUsers TOKENS LOADED ──` +
    ` eventType=${meta?.eventType ?? "unknown"}` +
    ` recipients=${userIds.length} usersWithTokens=${tokenMap.size}` +
    ` tokenCount=${messages.length} +${Date.now() - t0}ms`
  );
  await sendPushMessages(messages);
  const totalMs = Date.now() - t0;
  const lagEnd = meta?.eventCreatedAt != null ? Date.now() - meta.eventCreatedAt : null;
  console.log(
    `[PushDiag] ── sendPushToUsers DONE ──` +
    ` eventType=${meta?.eventType ?? "unknown"}` +
    ` eventId=${meta?.eventId ?? "N/A"}` +
    ` recipients=${userIds.length} tokens=${messages.length}` +
    ` elapsed=+${totalMs}ms` +
    ` totalLagSinceEvent=${lagEnd !== null ? `+${lagEnd}ms` : "N/A"}`
  );
  console.log(`[PushSpeed][users] done — +${totalMs}ms total`);
}

/**
 * Debug variant of sendClaimPushToUser that returns structured info.
 * Used by approve-claim-push for admin diagnostics.
 */
export async function sendClaimPushWithDebug(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<{
  tokenFound: boolean;
  token: string | null;
  email: string | null;
  expoStatus: number | null;
  expoBody: string | null;
  ticketStatus: string | null;
  ticketId: string | null;
  error: string | null;
}> {
  const debug = {
    tokenFound: false,
    token: null as string | null,
    email: null as string | null,
    expoStatus: null as number | null,
    expoBody: null as string | null,
    ticketStatus: null as string | null,
    ticketId: null as string | null,
    error: null as string | null,
  };

  try {
    const { token: profileToken, email } = await getProfileForClaimPush(userId);
    debug.email = email;
    debug.token = profileToken;

    if (!profileToken || !profileToken.startsWith("ExponentPushToken[")) {
      debug.error = profileToken ? "malformed token" : "no token in profiles";
      return debug;
    }

    debug.tokenFound = true;

    const payload = [{ to: profileToken, title, body, data: data ?? {}, sound: "default" as const, priority: "high" as const }];

    const t0 = Date.now();
    console.log(`[PushSpeed][claim-debug] expo POST start — ${new Date().toISOString()}`);

    const expoResp = await fetch(EXPO_PUSH_API, {
      method: "POST",
      headers: { Accept: "application/json", "Accept-Encoding": "gzip, deflate", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    debug.expoStatus = expoResp.status;
    debug.expoBody = await expoResp.text();
    console.log(`[PushSpeed][claim-debug] expo responded — status=${debug.expoStatus} — +${Date.now() - t0}ms`);

    if (expoResp.ok) {
      try {
        const parsed = JSON.parse(debug.expoBody) as { data?: Array<{ status: string; id?: string }> };
        const ticket = parsed.data?.[0];
        debug.ticketStatus = ticket?.status ?? null;
        debug.ticketId = ticket?.id ?? null;
      } catch { /* ignore parse error */ }
    }
  } catch (err) {
    debug.error = err instanceof Error ? err.message : String(err);
  }

  return debug;
}
