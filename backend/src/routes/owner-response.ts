import { Hono } from "hono";
import { z } from "zod";

/**
 * Owner Response Route
 *
 * Allows authenticated farmstand owners to set/update/delete owner_response
 * on a farmstand_reviews row using the service role key (bypasses RLS).
 *
 * Ownership check order:
 *   1. farmstand_owners table: user_id + farmstand_id match
 *   2. farmstands table: owner_id, owner_user_id, or claimed_by matches
 */
export const ownerResponseRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function serviceHeaders() {
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

/**
 * Verify a Supabase-issued JWT by calling the Supabase auth API.
 * This does not require SUPABASE_JWT_SECRET — the anon key is sufficient.
 */
async function verifyJwt(
  authHeader: string | undefined
): Promise<{ userId: string | null; error: string | null }> {
  if (!authHeader?.startsWith("Bearer ")) {
    console.log("[OwnerResponse:verifyJwt] Missing or malformed Authorization header");
    return { userId: null, error: "Missing Authorization header" };
  }

  const token = authHeader.replace("Bearer ", "").trim();

  console.log(`[OwnerResponse:verifyJwt] Verifying token via Supabase auth API`);
  console.log(`[OwnerResponse:verifyJwt] SUPABASE_URL=${SUPABASE_URL}`);
  console.log(`[OwnerResponse:verifyJwt] ANON_KEY present=${!!SUPABASE_ANON_KEY} length=${SUPABASE_ANON_KEY.length}`);

  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });

    console.log(`[OwnerResponse:verifyJwt] Auth API response status: ${resp.status}`);

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(`[OwnerResponse:verifyJwt] Auth API error body: ${errText}`);
      return { userId: null, error: "Invalid or expired token" };
    }

    const user = (await resp.json()) as { id?: string; email?: string };
    if (!user.id) {
      console.log("[OwnerResponse:verifyJwt] No user ID in auth API response");
      return { userId: null, error: "No user ID in token" };
    }

    console.log(`[OwnerResponse:verifyJwt] Verified — userId=${user.id} email=${user.email}`);
    return { userId: user.id, error: null };
  } catch (e) {
    console.log(`[OwnerResponse:verifyJwt] Exception calling auth API: ${e}`);
    return { userId: null, error: "Failed to verify token" };
  }
}

// Load the review row from DB by id → returns the row (with farmstand_id)
async function loadReview(reviewId: string): Promise<{
  id: string;
  farmstand_id: string;
  owner_response: string | null;
  owner_response_at: string | null;
} | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/farmstand_reviews?id=eq.${encodeURIComponent(reviewId)}&select=id,farmstand_id,owner_response,owner_response_at&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!resp.ok) return null;
  const rows = (await resp.json()) as Array<{
    id: string;
    farmstand_id: string;
    owner_response: string | null;
    owner_response_at: string | null;
  }>;
  return rows?.[0] ?? null;
}

// Check if userId owns the farmstand (farmstand_id is text in farmstand_reviews)
async function isOwner(userId: string, farmstandId: string): Promise<boolean> {
  console.log(`[OwnerResponse] Checking ownership: userId=${userId} farmstandId=${farmstandId}`);

  // 1. farmstand_owners table (user_id text, farmstand_id text)
  //    Skip is_active/is_approved filter — column may not exist; any row means ownership.
  try {
    const foResp = await fetch(
      `${SUPABASE_URL}/rest/v1/farmstand_owners?user_id=eq.${encodeURIComponent(userId)}&farmstand_id=eq.${encodeURIComponent(farmstandId)}&select=user_id&limit=1`,
      { headers: serviceHeaders() }
    );
    if (foResp.ok) {
      const rows = (await foResp.json()) as Array<unknown>;
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`[OwnerResponse] Ownership confirmed via farmstand_owners`);
        return true;
      }
    } else {
      console.log(`[OwnerResponse] farmstand_owners query failed with status ${foResp.status}`);
    }
  } catch (e) {
    console.log(`[OwnerResponse] farmstand_owners lookup exception:`, e);
  }

  // 2. farmstands table — try as UUID (cast) and as text
  //    Columns: owner_id (text), owner_user_id (text), claimed_by (text)
  //    farmstands.id is uuid; farmstand_reviews.farmstand_id is text.
  const columnsToCheck = ["owner_id", "owner_user_id", "claimed_by"];
  for (const col of columnsToCheck) {
    try {
      // Try direct text equality (works if col contains the uuid as text)
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${encodeURIComponent(farmstandId)}&${col}=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
        { headers: serviceHeaders() }
      );
      if (resp.ok) {
        const rows = (await resp.json()) as Array<unknown>;
        if (Array.isArray(rows) && rows.length > 0) {
          console.log(`[OwnerResponse] Ownership confirmed via farmstands.${col}`);
          return true;
        }
      }
    } catch {
      // continue checking other columns
    }
  }

  console.log(`[OwnerResponse] Ownership not confirmed for userId=${userId} farmstandId=${farmstandId}`);
  return false;
}

const upsertSchema = z.object({
  review_id: z.string().uuid("review_id must be a UUID"),
  owner_response: z.string().min(1, "owner_response cannot be empty"),
});

const deleteSchema = z.object({
  review_id: z.string().uuid("review_id must be a UUID"),
});

// POST /api/owner-response — set or update owner_response
ownerResponseRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);
  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const { review_id, owner_response } = parsed.data;

  console.log(`[OwnerResponse] POST — userId=${userId} reviewId=${review_id}`);
  console.log(`[OwnerResponse] reply text: "${owner_response}"`);

  // Load the review row to get the authoritative farmstand_id
  const reviewRow = await loadReview(review_id);
  if (!reviewRow) {
    console.log(`[OwnerResponse] Review ${review_id} not found`);
    return c.json({ success: false, error: "Review not found" }, 404);
  }

  const { farmstand_id } = reviewRow;
  console.log(`[OwnerResponse] farmstand_id from DB: ${farmstand_id}`);

  // Confirm ownership
  const owned = await isOwner(userId, farmstand_id);
  if (!owned) {
    console.log(`[OwnerResponse] Permission denied — userId=${userId} does not own farmstand_id=${farmstand_id}`);
    return c.json({ success: false, error: "permission_denied", message: "You do not own this farmstand" }, 403);
  }

  // Write owner_response using service role key
  const owner_response_at = new Date().toISOString();
  console.log(`[OwnerResponse] Writing owner_response to DB...`);

  const updateResp = await fetch(
    `${SUPABASE_URL}/rest/v1/farmstand_reviews?id=eq.${encodeURIComponent(review_id)}`,
    {
      method: "PATCH",
      headers: {
        ...serviceHeaders(),
        Prefer: "return=representation",
      },
      body: JSON.stringify({ owner_response, owner_response_at }),
    }
  );

  console.log(`[OwnerResponse] PATCH status: ${updateResp.status}`);

  if (!updateResp.ok) {
    const errText = await updateResp.text();
    console.error(`[OwnerResponse] PATCH error: ${errText}`);
    return c.json({ success: false, error: "Database write failed" }, 500);
  }

  const updatedRows = (await updateResp.json()) as Array<{
    id: string;
    farmstand_id: string;
    owner_response: string | null;
    owner_response_at: string | null;
  }>;

  const updated = updatedRows?.[0];
  console.log(`[OwnerResponse] owner_response in DB after write: "${updated?.owner_response}"`);

  if (!updated?.owner_response) {
    console.error(`[OwnerResponse] PATCH returned no rows — review_id may not match`);
    return c.json({ success: false, error: "Write succeeded but no row returned" }, 500);
  }

  return c.json({
    success: true,
    owner_response: updated.owner_response,
    owner_response_at: updated.owner_response_at,
  });
});

// DELETE /api/owner-response — clear owner_response
ownerResponseRouter.delete("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);
  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const { review_id } = parsed.data;

  const reviewRow = await loadReview(review_id);
  if (!reviewRow) {
    return c.json({ success: false, error: "Review not found" }, 404);
  }

  const owned = await isOwner(userId, reviewRow.farmstand_id);
  if (!owned) {
    console.log(`[OwnerResponse] DELETE permission denied — userId=${userId} does not own farmstand_id=${reviewRow.farmstand_id}`);
    return c.json({ success: false, error: "permission_denied", message: "You do not own this farmstand" }, 403);
  }

  const updateResp = await fetch(
    `${SUPABASE_URL}/rest/v1/farmstand_reviews?id=eq.${encodeURIComponent(review_id)}`,
    {
      method: "PATCH",
      headers: { ...serviceHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({ owner_response: null, owner_response_at: null }),
    }
  );

  if (!updateResp.ok) {
    const errText = await updateResp.text();
    console.error(`[OwnerResponse] DELETE PATCH error: ${errText}`);
    return c.json({ success: false, error: "Database write failed" }, 500);
  }

  return c.json({ success: true });
});
