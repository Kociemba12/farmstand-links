import { Hono } from "hono";

/**
 * POST /api/admin/approve-claim-push
 *
 * Called after a claim is approved to send a push notification to the owner.
 * Requires admin JWT.
 *
 * Body: { user_id: string; farmstand_id: string; farmstand_name?: string; claim_id?: string; claim_status_before?: string }
 * Returns: { success: boolean; debug: ClaimPushDebugInfo }
 */
export const approveClaimPushRouter = new Hono();

const EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_EMAILS = ["contact@farmstand.online", "joekociemba@gmail.com"];

export interface ClaimPushDebugInfo {
  claimId: string | null;
  farmstandId: string | null;
  claimUserId: string | null;
  adminUserId: string | null;
  claimStatusBefore: string | null;
  claimStatusAfter: string;
  pushTargetUserId: string | null;
  /** Token found in profiles.expo_push_token */
  profileToken: string | null;
  /** Rows found in user_push_tokens table */
  userPushTokensCount: number;
  userPushTokenValues: string[];
  pushPayload: { title: string; body: string; data: Record<string, unknown> } | null;
  pushResult: "not_started" | "sending" | "success" | "failed" | "skipped";
  expoResponse: { status: number; body: string } | null;
  pushError: string | null;
  alertCreated: boolean;
  alertError: string | null;
  timestamp: string;
}

interface SupabaseUserResponse {
  id?: string;
  email?: string;
}

async function verifyAdminJwt(
  authHeader: string | undefined
): Promise<{ userId: string | null; email: string | null; error: string | null }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, email: null, error: "Missing Authorization header" };
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!resp.ok) return { userId: null, email: null, error: "Invalid session" };
    const data = (await resp.json()) as SupabaseUserResponse;
    if (!data?.id) return { userId: null, email: null, error: "No user ID in token" };
    return { userId: data.id, email: data.email ?? null, error: null };
  } catch {
    return { userId: null, email: null, error: "Failed to verify session" };
  }
}

/** Read profiles.expo_push_token for a specific user (the authoritative claim token source). */
async function readProfileToken(userId: string): Promise<string | null> {
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
    url.searchParams.set("select", "id,expo_push_token");
    url.searchParams.set("id", `eq.${userId}`);
    url.searchParams.set("limit", "1");
    const resp = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) return null;
    const rows = (await resp.json()) as Array<{ expo_push_token: string | null }>;
    return rows[0]?.expo_push_token ?? null;
  } catch {
    return null;
  }
}

/** Read all user_push_tokens rows for a user (for comparison / debug only). */
async function readUserPushTokens(userId: string): Promise<string[]> {
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_push_tokens`);
    url.searchParams.set("select", "expo_push_token");
    url.searchParams.set("user_id", `eq.${userId}`);
    const resp = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) return [];
    const rows = (await resp.json()) as Array<{ expo_push_token: string }>;
    return rows.map((r) => r.expo_push_token).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Send claim push to user and return full debug data.
 * This is the debug-aware version of sendClaimPushToUser — same logic, full structured output.
 */
async function sendClaimPushWithDebug(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<Pick<ClaimPushDebugInfo, "profileToken" | "userPushTokensCount" | "userPushTokenValues" | "pushPayload" | "pushResult" | "expoResponse" | "pushError">> {
  const debug = {
    profileToken: null as string | null,
    userPushTokensCount: 0,
    userPushTokenValues: [] as string[],
    pushPayload: { title, body, data } as ClaimPushDebugInfo["pushPayload"],
    pushResult: "not_started" as ClaimPushDebugInfo["pushResult"],
    expoResponse: null as ClaimPushDebugInfo["expoResponse"],
    pushError: null as string | null,
  };

  console.log(`[ApproveClaimPushDebug] Reading tokens for userId=${userId}`);

  // Read both token sources in parallel
  const [profileToken, userTokens] = await Promise.all([
    readProfileToken(userId),
    readUserPushTokens(userId),
  ]);

  debug.profileToken = profileToken;
  debug.userPushTokensCount = userTokens.length;
  debug.userPushTokenValues = userTokens;

  console.log(
    `[ApproveClaimPushDebug] profileToken=${profileToken ?? "NULL"} userPushTokens=${userTokens.length}`
  );

  if (!profileToken) {
    debug.pushResult = "skipped";
    debug.pushError = "profiles.expo_push_token is NULL — no push sent";
    console.log(`[ApproveClaimPushDebug] ❌ SKIP — no profile token for ${userId}`);
    return debug;
  }

  if (!profileToken.startsWith("ExponentPushToken[")) {
    debug.pushResult = "skipped";
    debug.pushError = `Token malformed (not ExponentPushToken): "${profileToken}"`;
    console.log(`[ApproveClaimPushDebug] ❌ SKIP — malformed token for ${userId}`);
    return debug;
  }

  const payload = [
    {
      to: profileToken,
      title,
      body,
      data,
      sound: "default" as const,
      priority: "high" as const,
    },
  ];

  console.log(`[ApproveClaimPushDebug] Sending to Expo — payload=${JSON.stringify(payload)}`);
  debug.pushResult = "sending";

  try {
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
    debug.expoResponse = { status: expoStatus, body: expoBody };
    console.log(`[ApproveClaimPushDebug] Expo response — status=${expoStatus} body=${expoBody}`);

    if (!expoResp.ok) {
      debug.pushResult = "failed";
      debug.pushError = `Expo returned HTTP ${expoStatus}: ${expoBody}`;
      return debug;
    }

    let parsed: { data?: Array<{ status: string; id?: string; message?: string; details?: { error?: string } }> };
    try {
      parsed = JSON.parse(expoBody) as typeof parsed;
    } catch {
      debug.pushResult = "failed";
      debug.pushError = `Could not parse Expo response JSON: ${expoBody}`;
      return debug;
    }

    const ticket = parsed.data?.[0];
    if (ticket?.status === "ok") {
      debug.pushResult = "success";
      console.log(`[ApproveClaimPushDebug] ✅ Push accepted by Expo — ticketId=${ticket.id ?? "N/A"}`);
    } else {
      debug.pushResult = "failed";
      const msg = [ticket?.message, ticket?.details?.error].filter(Boolean).join(" | ");
      debug.pushError = `Expo rejected ticket: status=${ticket?.status ?? "?"} ${msg}`.trim();
      console.log(`[ApproveClaimPushDebug] ❌ Expo rejected — ${debug.pushError}`);
    }
  } catch (err) {
    debug.pushResult = "failed";
    debug.pushError = `Network error calling Expo: ${err instanceof Error ? err.message : String(err)}`;
    console.log(`[ApproveClaimPushDebug] ❌ Network error — ${debug.pushError}`);
  }

  return debug;
}

approveClaimPushRouter.post("/", async (c) => {
  // Capture the moment this request arrived — used to measure end-to-end push lag
  const requestReceivedAt = Date.now();
  console.log(
    `[PushDiag] ── claim_approved REQUEST RECEIVED ── ts=${new Date(requestReceivedAt).toISOString()}`
  );

  const authHeader = c.req.header("Authorization");
  const jwtStart = Date.now();
  const { userId: adminUserId, email, error: authError } = await verifyAdminJwt(authHeader);
  console.log(`[PushDiag] ── claim_approved JWT verified ── +${Date.now() - jwtStart}ms (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)`);

  if (authError || !adminUserId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  if (!email || !ADMIN_EMAILS.includes(email)) {
    console.log(`[ApproveClaimPush] Rejected non-admin: userId=${adminUserId} email=${email}`);
    return c.json({ success: false, error: "Forbidden: admin access required" }, 403);
  }

  let body: {
    user_id?: string;
    farmstand_id?: string;
    farmstand_name?: string;
    claim_id?: string;
    claim_status_before?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { user_id, farmstand_id, farmstand_name, claim_id, claim_status_before } = body;

  if (!user_id || !farmstand_id) {
    return c.json({ success: false, error: "user_id and farmstand_id are required" }, 400);
  }

  console.log(
    `[ApproveClaimPush] Processing: claim_id=${claim_id ?? "N/A"} user_id=${user_id} farmstand_id=${farmstand_id} farmstand_name=${farmstand_name ?? "(unknown)"}`
  );

  const debugInfo: ClaimPushDebugInfo = {
    claimId: claim_id ?? null,
    farmstandId: farmstand_id,
    claimUserId: user_id,
    adminUserId,
    claimStatusBefore: claim_status_before ?? "pending",
    claimStatusAfter: "approved",
    pushTargetUserId: user_id,
    profileToken: null,
    userPushTokensCount: 0,
    userPushTokenValues: [],
    pushPayload: null,
    pushResult: "not_started",
    expoResponse: null,
    pushError: null,
    alertCreated: false,
    alertError: null,
    timestamp: new Date().toISOString(),
  };

  // 0. Ensure farmstand_owners row exists for the new owner.
  // bootstrap-store.ts queries farmstand_owners exclusively for My Farmstand —
  // it never reads farmstands.owner_id. The approve_claim RPC should insert this
  // row, but we upsert here too as a belt-and-suspenders using the service role key.
  try {
    const ownerUpsertResp = await fetch(`${SUPABASE_URL}/rest/v1/farmstand_owners`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id, farmstand_id }),
    });
    if (ownerUpsertResp.ok || ownerUpsertResp.status === 409) {
      console.log(`[ApproveClaimPush] farmstand_owners row ensured for user=${user_id} farmstand=${farmstand_id}`);
    } else {
      const errText = await ownerUpsertResp.text();
      console.log(`[ApproveClaimPush] farmstand_owners upsert non-fatal: ${ownerUpsertResp.status} ${errText.slice(0, 120)}`);
    }
  } catch (ownerErr) {
    console.log(`[ApproveClaimPush] farmstand_owners upsert exception (non-fatal):`, ownerErr);
  }

  // 1. Insert inbox_alert — only columns that exist in the live table
  // NOTE: This DB write happens BEFORE the push send. If it is slow, it delays delivery.
  const alertInsertStart = Date.now();
  try {
    const alertInsertResp = await fetch(`${SUPABASE_URL}/rest/v1/inbox_alerts`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id,
        related_farmstand_id: farmstand_id ?? null,
        type: "claim_approved",
        title: "Farmstand Claim Approved",
        body: `Your claim for ${farmstand_name ?? "this farmstand"} has been approved. Tap to start your 3-month free trial.`,
        action_route: "owner/my-farmstand",
        action_params: farmstand_id ? { farmstandId: farmstand_id } : null,
      }),
    });
    if (!alertInsertResp.ok) {
      const errText = await alertInsertResp.text();
      debugInfo.alertCreated = false;
      debugInfo.alertError = `HTTP ${alertInsertResp.status}: ${errText}`;
      console.log(`[ApproveClaimPush] inbox_alert insert failed: ${alertInsertResp.status} ${errText}`);
    } else {
      debugInfo.alertCreated = true;
      console.log(`[ApproveClaimPush] inbox_alert inserted for user ${user_id}`);
    }
  } catch (alertErr) {
    debugInfo.alertCreated = false;
    debugInfo.alertError = alertErr instanceof Error ? alertErr.message : String(alertErr);
  }
  console.log(
    `[PushDiag] ── claim_approved ALERT INSERT DONE ── +${Date.now() - alertInsertStart}ms` +
    ` (lagSinceRequest=+${Date.now() - requestReceivedAt}ms)` +
    ` alertCreated=${debugInfo.alertCreated}`
  );

  // 2. Send push notification (debug-aware version)
  console.log(
    `[PushDiag] ── claim_approved PUSH START ──` +
    ` targetUser=${user_id}` +
    ` lagSinceRequest=+${Date.now() - requestReceivedAt}ms` +
    ` ts=${new Date().toISOString()}`
  );
  try {
    const pushTitle = "Farmstand Claim Approved";
    const pushBody = `Your claim for ${farmstand_name ?? "this farmstand"} has been approved. Tap to start your free trial.`;
    const pushData = {
      type: "claim_approved",
      farmstandId: farmstand_id,
      actionRoute: "PremiumOnboarding",
      actionParams: { farmstandId: farmstand_id },
    };

    const pushDebug = await sendClaimPushWithDebug(user_id, pushTitle, pushBody, pushData);
    Object.assign(debugInfo, pushDebug);
  } catch (err) {
    debugInfo.pushResult = "failed";
    debugInfo.pushError = err instanceof Error ? err.message : String(err);
    console.error("[ApproveClaimPush] sendClaimPushWithDebug threw:", err);
  }

  console.log(
    `[ApproveClaimPush] Done — pushResult=${debugInfo.pushResult} alertCreated=${debugInfo.alertCreated} profileToken=${debugInfo.profileToken ?? "NULL"}`
  );
  console.log(
    `[PushDiag] ── claim_approved DONE ──` +
    ` pushResult=${debugInfo.pushResult}` +
    ` alertCreated=${debugInfo.alertCreated}` +
    ` totalLagSinceRequest=+${Date.now() - requestReceivedAt}ms`
  );

  return c.json({ success: true, debug: debugInfo });
});
