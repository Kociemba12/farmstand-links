import { Hono } from "hono";
import { z } from "zod";

/**
 * Delete Farmstand Route (owner use)
 *
 * Allows authenticated farmstand owners to soft-delete their own farmstand,
 * bypassing the missing RLS DELETE policy on the farmstands table.
 *
 * SECURITY:
 * - Requires valid user JWT (verified with Supabase auth)
 * - Verifies the user owns the farmstand before deleting
 * - Uses service role key so the operation bypasses RLS
 */
export const deleteFarmstandRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function verifyJwt(authHeader: string | undefined): Promise<{ userId: string | null; error: string | null }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, error: "Missing Authorization header" };
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!resp.ok) return { userId: null, error: "Invalid session" };
    const data = (await resp.json()) as { id?: string };
    return data?.id ? { userId: data.id, error: null } : { userId: null, error: "No user ID in token" };
  } catch {
    return { userId: null, error: "Failed to verify session" };
  }
}

const deleteSchema = z.object({
  farmstand_id: z.string().uuid(),
});

deleteFarmstandRouter.post("/", async (c) => {
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

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { farmstand_id } = parsed.data;

  // Verify ownership using service role key so RLS doesn't block the SELECT
  const readKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const ownerCheckResp = await fetch(
    `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${farmstand_id}&select=id,owner_id,claimed_by`,
    {
      headers: {
        apikey: readKey,
        Authorization: `Bearer ${readKey}`,
      },
    }
  );

  if (!ownerCheckResp.ok) {
    return c.json({ success: false, error: "Failed to verify ownership" }, 500);
  }

  const rows = await ownerCheckResp.json() as Array<{ id: string; owner_id: string | null; claimed_by: string | null }>;
  if (!rows || rows.length === 0) {
    return c.json({ success: false, error: "Farmstand not found" }, 404);
  }

  const farmstand = rows[0];
  if (!farmstand) {
    return c.json({ success: false, error: "Farmstand not found" }, 404);
  }

  const isOwner = farmstand.owner_id === userId || farmstand.claimed_by === userId;
  if (!isOwner) {
    console.warn(`[DeleteFarmstand] User ${userId} tried to delete farmstand ${farmstand_id} they don't own (owner: ${farmstand.owner_id}, claimed_by: ${farmstand.claimed_by})`);
    return c.json({ success: false, error: "You do not own this farmstand" }, 403);
  }

  // Soft-delete using service role key to bypass RLS
  const now = new Date().toISOString();
  const deleteKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const deleteResp = await fetch(
    `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${farmstand_id}`,
    {
      method: "PATCH",
      headers: {
        apikey: deleteKey,
        Authorization: `Bearer ${deleteKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        deleted_at: now,
        deleted_by: userId,
        updated_at: now,
      }),
    }
  );

  if (!deleteResp.ok && deleteResp.status !== 204) {
    const errText = await deleteResp.text();
    console.error("[DeleteFarmstand] Soft-delete failed:", deleteResp.status, errText);
    return c.json({ success: false, error: "Failed to delete farmstand" }, 500);
  }

  console.log(`[DeleteFarmstand] Soft-deleted farmstand ${farmstand_id} by user ${userId}`);
  return c.json({ success: true });
});
