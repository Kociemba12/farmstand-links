import { Hono } from "hono";
import { z } from "zod";

/**
 * Submit Claim Route
 *
 * Handles farmstand claim submissions server-side using the service role key,
 * bypassing RLS and any broken triggers that block the user-level insert.
 *
 * SECURITY:
 * - Requires valid user JWT (verified with Supabase)
 * - Inserts claim_requests row using service role (bypasses RLS/trigger issues)
 * - user_id is always taken from the verified JWT, never from the request body
 */
export const submitClaimRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const claimSchema = z.object({
  farmstand_id: z.string().uuid(),
  requester_name: z.string().min(1),
  requester_email: z.string().email(),
  evidence_urls: z.array(z.string()).default([]),
  notes: z.string().nullable().optional(),
});

async function verifyJwt(authHeader: string | undefined): Promise<{ userId: string | null; error: string | null }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, error: "Missing Authorization header" };
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    // Use anon key as apikey, user token as Bearer — this validates the JWT
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

submitClaimRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const userToken = authHeader!.replace("Bearer ", "");
  void userToken; // kept for JWT verification above; not used for DB calls

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { farmstand_id, requester_name, requester_email, evidence_urls, notes } = parsed.data;

  // Use service role key so the DB trigger (which updates farmstands) runs with
  // sufficient privileges. The user_id is pinned to the verified JWT — not the body.
  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Delete any existing pending claim for this user+farmstand combination
  await fetch(
    `${SUPABASE_URL}/rest/v1/claim_requests?farmstand_id=eq.${farmstand_id}&user_id=eq.${userId}&status=eq.pending`,
    {
      method: "DELETE",
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
    }
  );

  // Insert the new claim request using service role so the trigger can update farmstands
  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/claim_requests`, {
    method: "POST",
    headers: {
      ...serviceHeaders,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      farmstand_id,
      user_id: userId,
      requester_name,
      requester_email: requester_email.toLowerCase(),
      evidence_urls: evidence_urls || [],
      status: "pending",
      notes: notes?.trim() || null,
    }),
  });

  console.log(`[SubmitClaim] Insert status: ${insertResp.status} for farmstand ${farmstand_id}`);

  if (insertResp.ok || insertResp.status === 204) {
    void (async () => {
      try {
        const fResp = await fetch(`${SUPABASE_URL}/rest/v1/farmstands?id=eq.${farmstand_id}&select=name`, {
          headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        });
        const rows = (await fResp.json()) as Array<{ name?: string }>;
        const farmstandName = rows[0]?.name ?? "";
        const hwUrl = `${SUPABASE_URL}/functions/v1/hyper-worker`;
        console.log("[SubmitClaim] hyper-worker firing — type: claim_requested | url:", hwUrl);
        const hwResp = await fetch(hwUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "claim_requested",
            data: {
              farmstand_name: farmstandName,
              farmstand_id: farmstand_id,
              requester_name: requester_name,
              requester_email: requester_email,
              requester_user_id: userId,
              notes: notes || null,
              attachment_info: evidence_urls && evidence_urls.length > 0
                ? `${evidence_urls.length} photo(s) attached`
                : null,
              submitted_at: new Date().toISOString(),
            },
          }),
        });
        const hwBody = await hwResp.text().catch(() => "(unreadable)");
        console.log("[SubmitClaim] hyper-worker response — status:", hwResp.status, "| body:", hwBody);
      } catch (err) {
        console.warn("[SubmitClaim] hyper-worker network error:", err);
      }
    })();
  }

  if (!insertResp.ok && insertResp.status !== 204) {
    const errText = await insertResp.text();
    console.error("[SubmitClaim] Insert failed:", insertResp.status, errText);
    return c.json({ success: false, error: "Failed to save claim request" }, 500);
  }

  // Best-effort: update farmstand claim_status to 'pending' using service role
  fetch(`${SUPABASE_URL}/rest/v1/farmstands?id=eq.${farmstand_id}`, {
    method: "PATCH",
    headers: {
      ...serviceHeaders,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ claim_status: "pending" }),
  }).catch(() => {});

  console.log(`[SubmitClaim] Claim submitted successfully for farmstand ${farmstand_id} by user ${userId}`);
  return c.json({ success: true });
});
