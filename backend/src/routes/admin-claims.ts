import { Hono } from "hono";

/**
 * Admin Claims Route
 *
 * GET /api/admin/pending-claims
 *
 * Returns all pending claim_requests joined with farmstand name.
 * Uses service role key to bypass RLS entirely — no JWT email claim issues.
 *
 * SECURITY:
 * - Requires valid user JWT
 * - Verifies caller email against hardcoded admin list via auth.users lookup
 * - Uses service role key only for the DB read (not exposed to client)
 */
export const adminClaimsRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

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
    const email = data.email ?? null;
    return { userId: data.id, email, error: null };
  } catch {
    return { userId: null, email: null, error: "Failed to verify session" };
  }
}

interface ClaimRow {
  id: string;
  farmstand_id: string;
  user_id: string;
  requester_email: string;
  requester_name: string | null;
  notes: string | null;
  message: string | null;
  evidence_urls: string[] | null;
  status: string;
  reviewed_at: string | null;
  created_at: string;
  farmstands: {
    name: string | null;
    city: string | null;
    state: string | null;
  } | null;
}

// POST /api/admin/deny-claim
adminClaimsRouter.post("/deny-claim", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyAdminJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  if (!email || !ADMIN_EMAILS.includes(email)) {
    console.log(`[AdminClaims] deny-claim rejected non-admin: userId=${userId} email=${email}`);
    return c.json({ success: false, error: "Forbidden: admin access required" }, 403);
  }

  let body: { claim_id?: string; admin_message?: string };
  try {
    body = await c.req.json() as { claim_id?: string; admin_message?: string };
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { claim_id, admin_message } = body;
  if (!claim_id) {
    return c.json({ success: false, error: "claim_id is required" }, 400);
  }

  console.log(`[AdminClaims] deny-claim: claim_id=${claim_id} admin=${email} has_message=${!!admin_message}`);

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "return=minimal",
  };

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: "denied",
    reviewed_at: now,
    reviewed_by: userId,
  };
  if (admin_message?.trim()) {
    updatePayload.admin_message = admin_message.trim();
  }

  // Step 1: Update claim_requests status to 'denied'
  const claimUrl = `${SUPABASE_URL}/rest/v1/claim_requests?id=eq.${encodeURIComponent(claim_id)}`;
  try {
    const resp = await fetch(claimUrl, {
      method: "PATCH",
      headers: serviceHeaders,
      body: JSON.stringify(updatePayload),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[AdminClaims] deny-claim update claim_requests failed: ${resp.status} ${body}`);
      return c.json({ success: false, error: `Failed to update claim: ${resp.status}` }, 500);
    }
    console.log(`[AdminClaims] deny-claim: claim_requests updated status=denied for claim_id=${claim_id}`);
  } catch (err) {
    console.error("[AdminClaims] deny-claim exception updating claim_requests:", err);
    return c.json({ success: false, error: "Database update failed" }, 500);
  }

  // Step 2: Fetch the farmstand_id for this claim so we can reset claim_status
  let farmstand_id: string | null = null;
  try {
    const fetchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/claim_requests?id=eq.${encodeURIComponent(claim_id)}&select=farmstand_id`,
      { headers: serviceHeaders }
    );
    if (fetchResp.ok) {
      const rows = await fetchResp.json() as Array<{ farmstand_id: string }>;
      farmstand_id = rows?.[0]?.farmstand_id ?? null;
    }
  } catch {
    // Non-fatal — we already denied the claim, farmstand reset is best-effort
  }

  // Step 3: Reset farmstand claim_status to 'unclaimed' AND clear owner fields
  // IMPORTANT: must clear owner_id and claimed_by — if left set, every client
  // that reads owner_id will still derive claimStatus='claimed' after denial.
  if (farmstand_id) {
    try {
      const fsUrl = `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${encodeURIComponent(farmstand_id)}`;
      const fsResp = await fetch(fsUrl, {
        method: "PATCH",
        headers: serviceHeaders,
        body: JSON.stringify({
          claim_status: "unclaimed",
          owner_id: null,
          claimed_by: null,
          claimed_at: null,
          updated_at: now,
        }),
      });
      if (!fsResp.ok) {
        const fsBody = await fsResp.text();
        console.error(`[AdminClaims] deny-claim update farmstands failed: ${fsResp.status} ${fsBody}`);
        // Non-fatal — claim is already denied
      } else {
        console.log(`[AdminClaims] deny-claim: farmstand ${farmstand_id} claim_status=unclaimed, owner_id/claimed_by cleared`);
      }
    } catch (err) {
      console.error("[AdminClaims] deny-claim exception updating farmstands:", err);
      // Non-fatal
    }
  }

  return c.json({ success: true, claim_id, farmstand_id });
});

// GET /api/admin/pending-claims
adminClaimsRouter.get("/pending-claims", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyAdminJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  if (!email || !ADMIN_EMAILS.includes(email)) {
    console.log(`[AdminClaims] Rejected non-admin: userId=${userId} email=${email}`);
    return c.json({ success: false, error: "Forbidden: admin access required" }, 403);
  }

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Query: claim_requests WHERE status = 'pending'
  // (submit-claim.ts always inserts into claim_requests with status='pending')
  // Using PostgREST embedded resource syntax: select=*,farmstands(name,city,state)
  const statusFilter = 'status=eq.pending';
  const url = `${SUPABASE_URL}/rest/v1/claim_requests?select=*,farmstands(name,city,state)&${statusFilter}&order=created_at.desc`;

  console.log(`[AdminClaims] Fetching pending claims for admin: ${email}`);

  let rawRows: ClaimRow[];
  try {
    const resp = await fetch(url, { headers: serviceHeaders });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[AdminClaims] Supabase error: ${resp.status} ${body}`);
      return c.json({ success: false, error: `Database error: ${resp.status}` }, 500);
    }
    rawRows = (await resp.json()) as ClaimRow[];
  } catch (err) {
    console.error("[AdminClaims] Fetch exception:", err);
    return c.json({ success: false, error: "Database fetch failed" }, 500);
  }

  console.log(`[AdminClaims] Found ${rawRows.length} awaiting-review claims`);
  rawRows.forEach((r) => {
    console.log(`[AdminClaims] claim id=${r.id} farmstand_id=${r.farmstand_id} status=${r.status} farmstand_name=${r.farmstands?.name ?? 'n/a'}`);
  });

  const claims = rawRows.map((row) => ({
    id: row.id,
    farmstand_id: row.farmstand_id,
    user_id: row.user_id,
    requester_id: row.user_id,
    requester_email: row.requester_email || "",
    requester_name: row.requester_name || "",
    notes: row.notes || row.message || null,
    evidence_urls: row.evidence_urls || [],
    status: row.status || "pending",
    reviewed_at: row.reviewed_at || null,
    reviewed_by: null,
    created_at: row.created_at,
    farmstand_name: row.farmstands?.name || null,
    farmstand_city: row.farmstands?.city || null,
    farmstand_state: row.farmstands?.state || null,
  }));

  return c.json({ success: true, claims });
});
