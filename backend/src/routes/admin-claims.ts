import { Hono } from "hono";
import { sendClaimPushToUser } from "../lib/push-sender";

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
  admin_message: string | null;
  request_more_info: string | null;
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

  // Step 2: Fetch the farmstand_id AND user_id for this claim so we can reset claim_status and send alert
  let farmstand_id: string | null = null;
  let claim_user_id: string | null = null;
  try {
    const fetchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/claim_requests?id=eq.${encodeURIComponent(claim_id)}&select=farmstand_id,user_id`,
      { headers: serviceHeaders }
    );
    if (fetchResp.ok) {
      const rows = await fetchResp.json() as Array<{ farmstand_id: string; user_id: string }>;
      farmstand_id = rows?.[0]?.farmstand_id ?? null;
      claim_user_id = rows?.[0]?.user_id ?? null;
    }
  } catch {
    // Non-fatal — we already denied the claim, farmstand reset and alert are best-effort
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

  // Step 4: Insert inbox_alert + push for the claimant (non-blocking)
  if (claim_user_id) {
    const denyMessage = admin_message?.trim() || "Please review your information and try again.";
    // Insert inbox_alert
    fetch(`${SUPABASE_URL}/rest/v1/inbox_alerts`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({
        user_id: claim_user_id,
        related_farmstand_id: farmstand_id ?? null,
        type: "claim_denied",
        title: "Farmstand Claim Denied",
        body: denyMessage,
        action_route: null,
        action_params: { claim_id },
      }),
    }).then(async (r) => {
      if (!r.ok) {
        const t = await r.text();
        console.log(`[AdminClaims] deny inbox_alert insert failed (non-fatal): ${r.status} ${t}`);
      } else {
        console.log(`[AdminClaims] deny inbox_alert inserted for user ${claim_user_id}`);
      }
    }).catch((err) => console.log("[AdminClaims] deny inbox_alert exception (non-fatal):", err));

    // Send push notification (include claimId so mobile can open the resubmit flow directly)
    sendClaimPushToUser(
      claim_user_id,
      "Farmstand Claim Denied",
      denyMessage,
      { type: "claim_denied", farmstandId: farmstand_id ?? "", claimId: claim_id }
    ).catch((err: unknown) => console.log("[AdminClaims] deny push error (non-fatal):", err));
  }

  return c.json({ success: true, claim_id, farmstand_id });
});

// POST /api/admin/request-more-info
adminClaimsRouter.post("/request-more-info", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyAdminJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  if (!email || !ADMIN_EMAILS.includes(email)) {
    console.log(`[AdminClaims] request-more-info rejected non-admin: userId=${userId} email=${email}`);
    return c.json({ success: false, error: "Forbidden: admin access required" }, 403);
  }

  let body: { claim_id?: string; admin_message?: string };
  try {
    body = await c.req.json() as { claim_id?: string; admin_message?: string };
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { claim_id, admin_message } = body;
  if (!claim_id) return c.json({ success: false, error: "claim_id is required" }, 400);
  if (!admin_message?.trim()) return c.json({ success: false, error: "admin_message is required" }, 400);

  console.log(`[AdminClaims] request-more-info: claim_id=${claim_id} admin=${email} message_len=${admin_message.trim().length}`);

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "return=minimal",
  };

  const now = new Date().toISOString();

  // Step 1: Update claim_requests — keep status as 'pending', store admin message in existing columns
  // DO NOT change status. The frontend derives "needs info" state from admin_message being present.
  const claimUrl = `${SUPABASE_URL}/rest/v1/claim_requests?id=eq.${encodeURIComponent(claim_id)}`;
  const trimmedMessage = admin_message.trim();
  const patchPayload = {
    admin_message: trimmedMessage,
    request_more_info: trimmedMessage,
    reviewed_at: now,
    updated_at: now,
    reviewed_by_admin_id: userId,
  };
  try {
    console.log(`[AdminClaims] request-more-info: PATCH payload=`, JSON.stringify(patchPayload), `for claim_id=${claim_id}`);
    const resp = await fetch(claimUrl, {
      method: "PATCH",
      headers: serviceHeaders,
      body: JSON.stringify(patchPayload),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error(`[AdminClaims] request-more-info update FAILED: status=${resp.status} body=${t}`);
      return c.json({ success: false, error: `Failed to update claim: ${resp.status} — ${t}` }, 500);
    }
    console.log(`[AdminClaims] request-more-info: claim_requests updated (admin_note set) for ${claim_id}`);
  } catch (err) {
    console.error("[AdminClaims] request-more-info exception updating claim_requests:", err);
    return c.json({ success: false, error: "Database update failed" }, 500);
  }

  // Step 2: Fetch user_id + farmstand_id for the claim
  let claim_user_id: string | null = null;
  let farmstand_id: string | null = null;
  try {
    const fetchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/claim_requests?id=eq.${encodeURIComponent(claim_id)}&select=user_id,farmstand_id`,
      { headers: serviceHeaders }
    );
    if (fetchResp.ok) {
      const rows = await fetchResp.json() as Array<{ user_id: string; farmstand_id: string }>;
      claim_user_id = rows?.[0]?.user_id ?? null;
      farmstand_id = rows?.[0]?.farmstand_id ?? null;
    }
  } catch {
    // Non-fatal
  }

  // Step 3: Insert inbox_alert + send push notification (non-blocking)
  // Push failure must NOT fail the overall request-more-info flow.
  if (claim_user_id) {
    const alertTitle = "More information needed";
    const alertBody = "The Farmstand team requested additional information for your ownership claim.";

    console.log(`[AdminClaims] request-more-info inbox_alert payload: user=${claim_user_id} claim=${claim_id} farmstand=${farmstand_id} message_len=${trimmedMessage.length}`);

    // Inbox alert insert — try with type first, fall back without if the live DB
    // doesn't have 'claim_more_info' in its CHECK constraint yet.
    const insertAlert = async () => {
      const basePayload = {
        user_id: claim_user_id,
        title: alertTitle,
        body: alertBody,
        message: trimmedMessage,
        related_farmstand_id: farmstand_id ?? null,
      };

      // First attempt: with type
      const r1 = await fetch(`${SUPABASE_URL}/rest/v1/inbox_alerts`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify({ ...basePayload, type: "claim_more_info" }),
      });
      if (r1.ok) {
        console.log(`[AdminClaims] inbox_alert inserted OK (with type) for user ${claim_user_id}`);
        return;
      }
      const t1 = await r1.text();
      console.log(`[AdminClaims] inbox_alert insert with type failed (${r1.status}): ${t1} — retrying without type`);

      // Second attempt: without type (live DB constraint may not include claim_more_info yet)
      const r2 = await fetch(`${SUPABASE_URL}/rest/v1/inbox_alerts`, {
        method: "POST",
        headers: serviceHeaders,
        body: JSON.stringify(basePayload),
      });
      if (r2.ok) {
        console.log(`[AdminClaims] inbox_alert inserted OK (without type) for user ${claim_user_id}`);
      } else {
        const t2 = await r2.text();
        console.log(`[AdminClaims] inbox_alert insert without type also failed (${r2.status}): ${t2}`);
      }
    };

    // Non-blocking — failure must NOT fail the overall request-more-info flow
    insertAlert().catch((err) => console.log("[AdminClaims] inbox_alert exception (non-fatal):", err));

    // Push notification (non-blocking — failure must not break the flow)
    sendClaimPushToUser(
      claim_user_id,
      alertTitle,
      alertBody,
      { farmstandId: farmstand_id ?? "", claim_id }
    ).then(() => {
      console.log(`[AdminClaims] request-more-info push sent OK for user ${claim_user_id}`);
    }).catch((err: unknown) => console.log("[AdminClaims] request-more-info push error (non-fatal):", err));
  } else {
    console.log(`[AdminClaims] request-more-info: no claim_user_id found for claim ${claim_id} — skipping alert/push`);
  }

  console.log(`[AdminClaims] request-more-info complete: claim_id=${claim_id} admin_note_set=true farmstand_id=${farmstand_id}`);
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

  // Query: claim_requests WHERE status IN ('pending', 'needs_more_info')
  // (submit-claim.ts always inserts into claim_requests with status='pending')
  // Using PostgREST embedded resource syntax: select=*,farmstands(name,city,state)
  const statusFilter = 'status=in.(pending,needs_more_info)';
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
    admin_message: row.admin_message || row.request_more_info || null,
    created_at: row.created_at,
    farmstand_name: row.farmstands?.name || null,
    farmstand_city: row.farmstands?.city || null,
    farmstand_state: row.farmstands?.state || null,
  }));

  return c.json({ success: true, claims });
});

// ─── POST /api/admin/remove-ownership ──────────────────────────────────────
// Admin action: removes a user's ownership of a specific farmstand.
// - Clears owner_id, claimed_by, claimed_at on the farmstand
// - Sets claim_status back to 'unclaimed'
// - Sends an inbox alert to the affected user
// - Does NOT delete the farmstand or the user

adminClaimsRouter.post("/remove-ownership", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyAdminJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  if (!email || !ADMIN_EMAILS.includes(email)) {
    console.log(`[AdminClaims] remove-ownership rejected non-admin: userId=${userId} email=${email}`);
    return c.json({ success: false, error: "Forbidden: admin access required" }, 403);
  }

  let body: { farmstand_id?: string; user_id?: string; farmstand_name?: string };
  try {
    body = await c.req.json() as { farmstand_id?: string; user_id?: string; farmstand_name?: string };
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { farmstand_id, user_id, farmstand_name } = body;
  if (!farmstand_id || !user_id) {
    return c.json({ success: false, error: "farmstand_id and user_id are required" }, 400);
  }

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Prefer: "return=minimal",
  };

  const now = new Date().toISOString();

  // Step 1: Clear ownership fields AND reset premium fields on the farmstand.
  // When admin removes ownership, the claim-based premium trial ends immediately.
  // The trial was granted because the user owned this stand — without ownership there
  // is no basis for premium. This prevents stale premium badges in Manage Users.
  const fsUrl = `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${encodeURIComponent(farmstand_id)}`;
  try {
    const resp = await fetch(fsUrl, {
      method: "PATCH",
      headers: serviceHeaders,
      body: JSON.stringify({
        owner_id: null,
        claimed_by: null,
        claimed_at: null,
        claim_status: "unclaimed",
        premium_status: "free",
        premium_trial_expires_at: null,
        premium_trial_started_at: null,
        updated_at: now,
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(`[AdminClaims] remove-ownership farmstand PATCH failed: ${resp.status} ${errBody}`);
      return c.json({ success: false, error: `Failed to update farmstand: ${resp.status}` }, 500);
    }
  } catch (err) {
    console.error("[AdminClaims] remove-ownership exception updating farmstand:", err);
    return c.json({ success: false, error: "Database update failed" }, 500);
  }

  // Step 2: Soft-delete the farmstand so it disappears from ALL app queries.
  // This ensures the farmstand no longer appears on the user's profile, My Farmstand,
  // map/explore results, or any other screen that filters deleted_at IS NULL.
  console.log(`[ManageUsersRemoveFarmstand] starting soft-delete for farmstandId=${farmstand_id} / userId=${user_id}`);
  try {
    const delResp = await fetch(fsUrl, {
      method: "PATCH",
      headers: serviceHeaders,
      body: JSON.stringify({
        deleted_at: now,
        deleted_by: userId,
        updated_at: now,
      }),
    });
    if (!delResp.ok) {
      const errBody = await delResp.text();
      console.error(`[ManageUsersRemoveFarmstand] soft-delete PATCH failed: ${delResp.status} ${errBody}`);
      return c.json({ success: false, error: `Failed to delete farmstand: ${delResp.status}` }, 500);
    }
    console.log(`[ManageUsersRemoveFarmstand] backend delete success — farmstandId=${farmstand_id}`);
  } catch (err) {
    console.error("[ManageUsersRemoveFarmstand] exception during soft-delete:", err);
    return c.json({ success: false, error: "Database delete failed" }, 500);
  }

  // Step 3: Remove farmstand_owners rows so profile join queries don't resurface this farmstand.
  // Fire-and-forget — failure is non-fatal because deleted_at IS NULL filter is defense-in-depth.
  fetch(`${SUPABASE_URL}/rest/v1/farmstand_owners?farmstand_id=eq.${encodeURIComponent(farmstand_id)}`, {
    method: "DELETE",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
  }).then(r => {
    if (r.ok) {
      console.log(`[ManageUsersRemoveFarmstand] ownership links cleared — farmstand_owners rows deleted for farmstand=${farmstand_id}`);
    } else {
      r.text().then(t => console.log(`[ManageUsersRemoveFarmstand] farmstand_owners delete non-fatal: ${r.status} ${t.slice(0, 100)}`));
    }
  }).catch(err => console.log("[ManageUsersRemoveFarmstand] farmstand_owners delete exception (non-fatal):", err));

  // Step 4: Send inbox alert to the affected user (non-blocking)
  const fsDisplayName = farmstand_name?.trim() || "your farmstand";
  fetch(`${SUPABASE_URL}/rest/v1/inbox_alerts`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify({
      user_id,
      related_farmstand_id: farmstand_id,
      type: "platform_announcement",
      title: "Farmstand Ownership Removed",
      body: `Your ownership of ${fsDisplayName} has been removed by an admin. The farmstand remains active on the app. Please contact support if you have questions.`,
      action_route: null,
      action_params: null,
    }),
  }).catch(err => {
    console.log("[AdminClaims] remove-ownership alert (non-fatal):", err);
  });

  console.log(`[ManageUsersRemoveFarmstand] claims cleaned — inbox alert sent (non-blocking) for farmstand=${farmstand_id} / user=${user_id}`);
  console.log(`[ManageUsersRemoveFarmstand] admin=${email} fully removed farmstand=${farmstand_id} from user=${user_id} — soft-deleted + ownership links cleared`);
  return c.json({ success: true });
});

