import { Hono } from "hono";
import { z } from "zod";

/**
 * Resubmit Claim Route
 *
 * Called when a user updates their claim after an admin "Request More Info".
 * Finds the existing pending claim for this user+farmstand and PATCHes it:
 *   - Updates evidence_urls and notes with fresh data
 *   - Clears review fields so admin sees it as a fresh pending submission
 *
 * SECURITY:
 * - Requires valid user JWT
 * - user_id is always taken from the verified JWT, never the request body
 */
export const resubmitClaimRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const resubmitSchema = z.object({
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

resubmitClaimRouter.post("/", async (c) => {
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

  const parsed = resubmitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { farmstand_id, requester_name, requester_email, evidence_urls, notes } = parsed.data;

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  // Find the existing claim (pending or denied) for this user+farmstand
  // Denied claims must also be updatable so users can resubmit after rejection
  const findResp = await fetch(
    `${SUPABASE_URL}/rest/v1/claim_requests?farmstand_id=eq.${farmstand_id}&user_id=eq.${userId}&status=in.(pending,denied)&select=id,status&order=created_at.desc&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );

  if (!findResp.ok) {
    const t = await findResp.text();
    console.error("[ResubmitClaim] Failed to find existing claim:", findResp.status, t);
    return c.json({ success: false, error: "Could not find existing claim" }, 500);
  }

  const rows = (await findResp.json()) as Array<{ id: string; status: string }>;
  if (!rows || rows.length === 0) {
    console.warn("[ResubmitClaim] No pending/denied claim found for user", userId, "farmstand", farmstand_id);
    return c.json({ success: false, error: "We couldn't find your previous claim. Please start a new claim." }, 404);
  }

  const claimId = rows[0]?.id;
  if (!claimId) {
    return c.json({ success: false, error: "We couldn't find your previous claim. Please start a new claim." }, 404);
  }
  console.log("[ResubmitClaim] Found claim", claimId, "with status", rows[0]?.status, "for farmstand", farmstand_id);
  const now = new Date().toISOString();

  // PATCH the existing claim: update evidence, clear all review fields
  const patchPayload = {
    evidence_urls: evidence_urls || [],
    notes: notes?.trim() || null,      // save to 'notes' — same column as the initial submission
    requester_name: requester_name.trim(),
    requester_email: requester_email.trim().toLowerCase(),
    // Reset review state so admin sees it as a fresh pending submission
    status: "pending",
    admin_message: null,
    request_more_info: null,
    reviewed_at: null,
    reviewed_by_admin_id: null,
    updated_at: now,
  };

  console.log("[ResubmitClaim] Patching claim", claimId, "for farmstand", farmstand_id);

  const patchResp = await fetch(
    `${SUPABASE_URL}/rest/v1/claim_requests?id=eq.${claimId}`,
    { method: "PATCH", headers: serviceHeaders, body: JSON.stringify(patchPayload) }
  );

  if (!patchResp.ok) {
    const t = await patchResp.text();
    console.error("[ResubmitClaim] PATCH failed:", patchResp.status, t);
    return c.json({ success: false, error: `Failed to update claim: ${patchResp.status} — ${t}` }, 500);
  }

  console.log("[ResubmitClaim] Claim resubmitted successfully:", claimId);
  return c.json({ success: true, claim_id: claimId });
});
