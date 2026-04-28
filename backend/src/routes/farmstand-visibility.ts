/**
 * Farmstand Visibility Route
 *
 * GET  /api/farmstand-visibility          — returns all explicit overrides
 * POST /api/farmstand-visibility          — sets visibility for a farmstand (owner/admin auth)
 */

import { Hono } from "hono";
import { z } from "zod";
import { readVisibilityMap, setFarmstandVisibility } from "../lib/visibility-store";

export const farmstandVisibilityRouter = new Hono();

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
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!resp.ok) return { userId: null, email: null, error: "Invalid session" };
    const data = (await resp.json()) as { id?: string; email?: string };
    if (!data?.id) return { userId: null, email: null, error: "No user ID in token" };
    return { userId: data.id, email: data.email ?? null, error: null };
  } catch {
    return { userId: null, email: null, error: "Failed to verify session" };
  }
}

/**
 * GET /api/farmstand-visibility
 * Returns all explicit visibility overrides: { [farmstandId]: boolean }
 * No auth required — this is public metadata (values are just true/false).
 */
farmstandVisibilityRouter.get("/", (c) => {
  const map = readVisibilityMap();
  console.log(`[Visibility] GET — ${Object.keys(map).length} explicit override(s)`);
  return c.json({ success: true, visibility: map });
});

const postSchema = z.object({
  farmstand_id: z.string().uuid("farmstand_id must be a UUID"),
  show_on_map: z.boolean(),
});

/**
 * POST /api/farmstand-visibility
 * Body: { farmstand_id: string, show_on_map: boolean }
 * Auth: owner or admin required
 */
farmstandVisibilityRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyJwt(authHeader);
  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const { farmstand_id, show_on_map } = parsed.data;
  const isAdmin = !!email && ADMIN_EMAILS.includes(email);

  // Ownership check for non-admins
  if (!isAdmin) {
    const readKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    const ownerResp = await fetch(
      `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${farmstand_id}&select=id,owner_id,claimed_by`,
      { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` } }
    );
    if (!ownerResp.ok) {
      return c.json({ success: false, error: "Failed to verify ownership" }, 500);
    }
    const rows = (await ownerResp.json()) as Array<{ owner_id: string | null; claimed_by: string | null }>;
    const farm = rows[0];
    if (!farm) return c.json({ success: false, error: "Farmstand not found" }, 404);
    const isOwner = farm.owner_id === userId || farm.claimed_by === userId;
    if (!isOwner) return c.json({ success: false, error: "You do not own this farmstand" }, 403);
  }

  setFarmstandVisibility(farmstand_id, show_on_map);
  console.log(`[Visibility] POST — farmstand=${farmstand_id} showOnMap=${show_on_map} by ${isAdmin ? `admin ${email}` : `owner ${userId}`}`);
  return c.json({ success: true, farmstand_id, show_on_map });
});
