import { Hono } from "hono";
import { sendClaimPushToUser } from "../lib/push-sender";

/**
 * TEMPORARY debug routes for claim push visibility.
 * Admin-only. Do NOT ship to production permanently.
 *
 * GET  /api/admin/claim-push-debug?user_id=...
 *   Returns current profile token + user_push_tokens rows + latest inbox_alert — no push sent.
 *
 * POST /api/admin/claim-push-debug/test-push
 *   Sends a real test push to the specified claim user (not the admin).
 *   Body: { user_id: string; claim_id?: string }
 */
export const claimPushDebugRouter = new Hono();

const EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_EMAILS = ["contact@farmstand.online", "joekociemba@gmail.com"];

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

async function readProfileRow(
  userId: string
): Promise<{ token: string | null; email: string | null }> {
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
    url.searchParams.set("select", "id,email,expo_push_token");
    url.searchParams.set("id", `eq.${userId}`);
    url.searchParams.set("limit", "1");
    const resp = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) return { token: null, email: null };
    const rows = (await resp.json()) as Array<{
      expo_push_token: string | null;
      email?: string | null;
    }>;
    return {
      token: rows[0]?.expo_push_token ?? null,
      email: rows[0]?.email ?? null,
    };
  } catch {
    return { token: null, email: null };
  }
}

async function readUserPushTokens(userId: string): Promise<string[]> {
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_push_tokens`);
    url.searchParams.set("select", "expo_push_token,device_os,last_seen_at");
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

async function readLatestAlert(
  userId: string,
  farmstandId?: string | null
): Promise<{ found: boolean; alertId: string | null; type: string | null; createdAt: string | null }> {
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/inbox_alerts`);
    url.searchParams.set("select", "id,type,created_at");
    url.searchParams.set("user_id", `eq.${userId}`);
    if (farmstandId) {
      url.searchParams.set("related_farmstand_id", `eq.${farmstandId}`);
    }
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", "1");
    const resp = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) return { found: false, alertId: null, type: null, createdAt: null };
    const rows = (await resp.json()) as Array<{
      id: string;
      type: string;
      created_at: string;
    }>;
    if (rows.length === 0) return { found: false, alertId: null, type: null, createdAt: null };
    return {
      found: true,
      alertId: rows[0]!.id,
      type: rows[0]!.type,
      createdAt: rows[0]!.created_at,
    };
  } catch {
    return { found: false, alertId: null, type: null, createdAt: null };
  }
}

// ── GET /api/admin/claim-push-debug ────────────────────────────────────────
// Reads current DB state and returns debug snapshot — does NOT send a push.
claimPushDebugRouter.get("/", async (c) => {
  const { userId: adminUserId, email, error: authError } = await verifyAdminJwt(
    c.req.header("Authorization")
  );
  if (authError || !adminUserId || !email || !ADMIN_EMAILS.includes(email)) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  const userId = c.req.query("user_id");
  const farmstandId = c.req.query("farmstand_id") ?? null;

  if (!userId) {
    return c.json({ success: false, error: "user_id query param required" }, 400);
  }

  console.log(`[ClaimPushDebug] Refresh snapshot for userId=${userId} farmstandId=${farmstandId ?? "N/A"}`);

  const [profileData, userTokens, latestAlert] = await Promise.all([
    readProfileRow(userId),
    readUserPushTokens(userId),
    readLatestAlert(userId, farmstandId),
  ]);

  return c.json({
    success: true,
    snapshot: {
      userId,
      profileToken: profileData.token,
      profileEmail: profileData.email,
      userPushTokensCount: userTokens.length,
      userPushTokenValues: userTokens,
      latestAlert,
      timestamp: new Date().toISOString(),
    },
  });
});

// ── POST /api/admin/claim-push-debug/test-push ─────────────────────────────
// Sends a real test push to a specific claim user using the claim push path.
// Body: { user_id: string; farmstand_id?: string }
claimPushDebugRouter.post("/test-push", async (c) => {
  const { userId: adminUserId, email, error: authError } = await verifyAdminJwt(
    c.req.header("Authorization")
  );
  if (authError || !adminUserId || !email || !ADMIN_EMAILS.includes(email)) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  let body: { user_id?: string; farmstand_id?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ success: false, error: "Invalid JSON" }, 400);
  }

  const { user_id, farmstand_id } = body;
  if (!user_id) {
    return c.json({ success: false, error: "user_id required" }, 400);
  }

  console.log(
    `[ClaimPushDebug] Admin ${adminUserId} triggering test push for claimant=${user_id}`
  );

  // Read profile token for debug info
  const profileData = await readProfileRow(user_id);
  const userTokens = await readUserPushTokens(user_id);

  if (!profileData.token) {
    return c.json({
      success: false,
      error: "No profile token found — cannot send test push",
      debug: {
        profileToken: null,
        userPushTokensCount: userTokens.length,
        userPushTokenValues: userTokens,
        pushResult: "skipped",
        pushError: "profiles.expo_push_token is NULL",
        timestamp: new Date().toISOString(),
      },
    });
  }

  // Send via the same claim path
  const pushTitle = "Test Push (Admin Debug)";
  const pushBody = "This is a test push from the admin claim debug panel.";
  const pushData = {
    type: "debug_test_push",
    farmstandId: farmstand_id ?? null,
    source: "admin_claim_debug_panel",
  };

  let pushResult: "success" | "failed" | "skipped" = "failed";
  let expoResponse: { status: number; body: string } | null = null;
  let pushError: string | null = null;

  try {
    const payload = [
      {
        to: profileData.token,
        title: pushTitle,
        body: pushBody,
        data: pushData,
        sound: "default" as const,
        priority: "high" as const,
      },
    ];

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
    expoResponse = { status: expoStatus, body: expoBody };

    if (!expoResp.ok) {
      pushResult = "failed";
      pushError = `Expo HTTP ${expoStatus}: ${expoBody}`;
    } else {
      const parsed = JSON.parse(expoBody) as {
        data?: Array<{ status: string; message?: string; details?: { error?: string } }>;
      };
      const ticket = parsed.data?.[0];
      if (ticket?.status === "ok") {
        pushResult = "success";
      } else {
        pushResult = "failed";
        pushError = `Expo rejected: ${ticket?.message ?? ""} ${ticket?.details?.error ?? ""}`.trim();
      }
    }
  } catch (err) {
    pushResult = "failed";
    pushError = err instanceof Error ? err.message : String(err);
  }

  console.log(`[ClaimPushDebug] Test push result — pushResult=${pushResult} for userId=${user_id}`);

  return c.json({
    success: true,
    debug: {
      profileToken: profileData.token,
      userPushTokensCount: userTokens.length,
      userPushTokenValues: userTokens,
      pushPayload: { title: pushTitle, body: pushBody, data: pushData },
      pushResult,
      expoResponse,
      pushError,
      timestamp: new Date().toISOString(),
    },
  });
});
