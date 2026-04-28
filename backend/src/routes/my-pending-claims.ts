import { Hono } from "hono";

/**
 * My Pending Claims Route
 *
 * Returns all pending claim_requests for the authenticated user.
 * Used by the Profile screen to show a "Claim Pending Approval" card.
 *
 * GET /api/my-pending-claims
 * Authorization: Bearer <user_jwt>
 */
export const myPendingClaimsRouter = new Hono();

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

myPendingClaimsRouter.get("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const url =
    `${SUPABASE_URL}/rest/v1/claim_requests` +
    `?user_id=eq.${userId}&status=in.(pending,needs_more_info)` +
    `&select=id,farmstand_id,status,created_at` +
    `&order=created_at.desc`;

  console.log("[MyPendingClaims] Fetching pending claims for userId:", userId);

  const resp = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("[MyPendingClaims] Supabase fetch failed:", resp.status, t);
    return c.json({ success: false, error: "Failed to fetch claims" }, 500);
  }

  const rows = (await resp.json()) as Array<{
    id: string;
    farmstand_id: string;
    status: string;
    created_at: string;
  }>;

  console.log("[MyPendingClaims] Found", rows.length, "pending claim(s) for userId:", userId);
  return c.json({ success: true, claims: rows ?? [] });
});
