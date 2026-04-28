import { Hono } from "hono";

/**
 * My Claim Route
 *
 * Returns the authenticated user's current claim_request for a given farmstand.
 * Uses the service role key so it bypasses RLS — no risk of returning 0 rows
 * due to missing policies.
 *
 * GET /api/my-claim?farmstand_id=<uuid>
 * Authorization: Bearer <user_jwt>
 *
 * Returns the full claim row needed to prefill the Update Claim form:
 *   id, requester_name, requester_email, notes, evidence_urls,
 *   admin_message, request_more_info, status
 */
export const myClaimRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

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

myClaimRouter.get("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const farmstand_id = c.req.query("farmstand_id");
  if (!farmstand_id) {
    return c.json({ success: false, error: "farmstand_id is required" }, 400);
  }

  // Optional: specific claim_id from denial push — fetch by ID directly if provided
  const claim_id = c.req.query("claim_id");

  // Fetch via service role — bypasses any RLS issues on claim_requests
  // Include both 'pending' and 'denied' so the Update Claim form can prefill from denied claims
  const baseFilter = claim_id
    ? `id=eq.${claim_id}&user_id=eq.${userId}`
    : `farmstand_id=eq.${farmstand_id}&user_id=eq.${userId}&status=in.(pending,denied)`;

  const url =
    `${SUPABASE_URL}/rest/v1/claim_requests` +
    `?${baseFilter}` +
    `&select=id,requester_name,requester_email,notes,message,evidence_urls,admin_message,request_more_info,status` +
    `&order=created_at.desc&limit=1`;

  console.log("[MyClaim] fetching claim — userId:", userId, "farmstand_id:", farmstand_id, "claim_id:", claim_id ?? "(not provided)");

  const resp = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("[MyClaim] Supabase fetch failed:", resp.status, t);
    return c.json({ success: false, error: "Failed to fetch claim" }, 500);
  }

  const rows = (await resp.json()) as Array<Record<string, unknown>>;
  if (!rows || rows.length === 0) {
    console.log("[MyClaim] No pending claim found for user", userId, "farmstand", farmstand_id);
    return c.json({ success: true, claim: null });
  }

  const row = rows[0];
  if (!row) {
    return c.json({ success: true, claim: null });
  }

  // Prefer 'notes' (initial submission column) then 'message' (resubmit column) for the notes field
  const userNotes = (row.notes as string | null) || (row.message as string | null) || null;

  const claim = {
    id: row.id as string,
    requester_name: (row.requester_name as string) || null,
    requester_email: (row.requester_email as string) || null,
    notes: userNotes,
    evidence_urls: Array.isArray(row.evidence_urls) ? (row.evidence_urls as string[]) : [],
    admin_message: (row.admin_message as string | null) || null,
    request_more_info: (row.request_more_info as string | null) || null,
    status: row.status as string,
  };

  console.log("[MyClaim] Returning claim", claim.id, "for farmstand", farmstand_id, "— photos:", claim.evidence_urls.length, "name:", claim.requester_name);
  return c.json({ success: true, claim });
});
