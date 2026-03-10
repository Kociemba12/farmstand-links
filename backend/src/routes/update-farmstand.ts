import { Hono } from "hono";
import { z } from "zod";

/**
 * Update Farmstand Route (owner + admin use)
 *
 * Allows authenticated farmstand owners OR admins to update a farmstand's
 * content fields server-side, bypassing the missing RLS UPDATE policy.
 *
 * SECURITY:
 * - Requires valid user JWT (verified with Supabase auth)
 * - Admins (ADMIN_EMAILS) can update any farmstand — ownership check skipped
 * - Non-admins: verifies caller owns or claimed the farmstand
 * - Only allows a safe allowlist of editable fields
 * - Ownership/admin fields (claimed_by, owner_id, etc.) are never accepted
 */
export const updateFarmstandRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const ADMIN_EMAILS = ["contact@farmstand.online", "joekociemba@gmail.com"];

async function verifyJwt(
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
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!resp.ok) return { userId: null, email: null, error: "Invalid session" };
    const data = (await resp.json()) as { id?: string; email?: string };
    if (!data?.id) return { userId: null, email: null, error: "No user ID in token" };
    return { userId: data.id, email: data.email ?? null, error: null };
  } catch {
    return { userId: null, email: null, error: "Failed to verify session" };
  }
}

// Allowlist of editable fields (snake_case, matches Supabase columns)
const EDITABLE_FIELDS = new Set([
  "name", "description", "street_address", "address_line2", "city", "state",
  "zip", "full_address", "cross_street1", "cross_street2", "latitude", "longitude",
  "email", "phone", "offerings", "other_products", "payment_options", "categories",
  "hours", "is_open_24_7", "hero_photo_url", "ai_photo_url", "hero_image_url",
  "photos", "photo_url", "image_url", "updated_at",
]);

const updateSchema = z.object({
  farmstand_id: z.string().uuid(),
  updates: z.record(z.string(), z.unknown()),
});

updateFarmstandRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const isAdmin = !!email && ADMIN_EMAILS.includes(email);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || "Invalid request" }, 400);
  }

  const { farmstand_id, updates } = parsed.data;

  // Admins skip the ownership check — they can update any farmstand
  if (!isAdmin) {
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
      console.warn(`[UpdateFarmstand] User ${userId} tried to update farmstand ${farmstand_id} they don't own (owner: ${farmstand.owner_id}, claimed_by: ${farmstand.claimed_by})`);
      return c.json({ success: false, error: "You do not own this farmstand" }, 403);
    }
  } else {
    console.log(`[UpdateFarmstand] Admin ${email} updating farmstand ${farmstand_id} — ownership check skipped`);
  }

  // Filter to only allowed fields
  const safeUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (EDITABLE_FIELDS.has(key)) {
      safeUpdates[key] = value;
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return c.json({ success: false, error: "No valid fields to update" }, 400);
  }

  const userToken = authHeader!.replace("Bearer ", "");

  // Admins use service role key for the DB write — guaranteed RLS bypass, no RPC needed
  if (isAdmin) {
    const patchResp = await fetch(
      `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${farmstand_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY || userToken}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(safeUpdates),
      }
    );
    if (!patchResp.ok && patchResp.status !== 204) {
      const patchErr = await patchResp.text();
      console.error(`[UpdateFarmstand] Admin PATCH failed: ${patchResp.status} ${patchErr}`);
      return c.json({ success: false, error: `Failed to update farmstand: ${patchErr}` }, 500);
    }
    console.log(`[UpdateFarmstand] Admin ${email} updated farmstand ${farmstand_id} successfully`);
    return c.json({ success: true });
  }

  // Owner path: try SECURITY DEFINER RPC first, fall back to direct PATCH
  const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_farmstand_owner`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_farmstand_id: farmstand_id,
      p_updates: safeUpdates,
    }),
  });

  console.log(`[UpdateFarmstand] RPC status: ${rpcResp.status} for farmstand ${farmstand_id}`);

  if (!rpcResp.ok) {
    const errText = await rpcResp.text();
    console.error("[UpdateFarmstand] RPC failed:", rpcResp.status, errText);

    if (rpcResp.status === 404 || errText.includes("PGRST202")) {
      // RPC not deployed yet — fall back to direct PATCH
      // Use service role key if available (bypasses RLS); otherwise user token
      const patchAuthKey = SUPABASE_SERVICE_ROLE_KEY || userToken;
      console.log(`[UpdateFarmstand] RPC not found, falling back to direct PATCH (using ${SUPABASE_SERVICE_ROLE_KEY ? "service role" : "user"} key)`);
      const patchApiKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      const patchResp = await fetch(
        `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${farmstand_id}`,
        {
          method: "PATCH",
          headers: {
            apikey: patchApiKey,
            Authorization: `Bearer ${patchAuthKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ ...safeUpdates, updated_at: new Date().toISOString() }),
        }
      );
      if (!patchResp.ok && patchResp.status !== 204) {
        const patchErr = await patchResp.text();
        console.error("[UpdateFarmstand] Fallback PATCH failed:", patchResp.status, patchErr);
        return c.json({ success: false, error: "Failed to update farmstand" }, 500);
      }
      console.log(`[UpdateFarmstand] Fallback PATCH succeeded for farmstand ${farmstand_id}`);
      return c.json({ success: true });
    }

    return c.json({ success: false, error: "Failed to update farmstand" }, 500);
  }

  const rpcData = await rpcResp.json() as { success?: boolean; error?: string };
  if (rpcData?.success === false) {
    console.error("[UpdateFarmstand] RPC returned failure:", rpcData.error);
    return c.json({ success: false, error: rpcData.error || "Failed to update farmstand" }, 500);
  }

  console.log(`[UpdateFarmstand] Updated farmstand ${farmstand_id} by user ${userId}`);
  return c.json({ success: true });
});
