import { Hono } from "hono";
import { z } from "zod";

/**
 * Favorites Route
 *
 * Handles save/unsave for a user's favorite farmstands.
 * Uses the service role key to bypass the Supabase RLS/FK permission issue
 * that causes a 403 when the authenticated role tries to INSERT into
 * saved_farmstands (the FK constraint check on `farmstands` fails because
 * the authenticated role has no SELECT on that table).
 *
 * SECURITY:
 * - Verifies caller's Supabase JWT before any write
 * - Extracts user_id from the verified JWT (never trusts client-supplied user_id)
 * - Service role key stays server-side only
 */

export const favoritesRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function verifyJwt(
  authHeader: string | undefined
): Promise<{ userId: string | null; error: string | null }> {
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
    if (!data?.id) return { userId: null, error: "No user ID in token" };
    return { userId: data.id, error: null };
  } catch {
    return { userId: null, error: "Failed to verify session" };
  }
}

const toggleSchema = z.object({
  farmstand_id: z.string().min(1),
  action: z.enum(["save", "unsave"]),
});

/**
 * POST /api/favorites/toggle
 * Body: { farmstand_id: string, action: "save" | "unsave" }
 * Authorization: Bearer <supabase_access_token>
 *
 * Returns: { success: boolean, favorites: string[], error?: string }
 */
favoritesRouter.post("/toggle", async (c) => {
  const reqTs = Date.now();
  const body = await c.req.json().catch(() => null);
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, favorites: [], error: "Invalid request body" }, 400);
  }
  const { farmstand_id, action } = parsed.data;
  const authHeader = c.req.header("Authorization");

  console.log(`[FavoritesAPIStart] ts=${reqTs} farmstandId=${farmstand_id} action=${action}`);

  // Verify JWT and extract real user id from the token (never trust client-supplied user_id)
  const { userId, error: jwtError } = await verifyJwt(authHeader);
  if (jwtError || !userId) {
    console.log(`[Favorites API] JWT verification failed: ${jwtError}`);
    return c.json({ success: false, favorites: [], error: jwtError ?? "Unauthorized" }, 401);
  }

  console.log(`[Favorites API] verified user_id=${userId}`);

  const serviceHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  // ── DB-STATE TRUE TOGGLE ─────────────────────────────────────────────────
  // Do NOT trust the client's `action` param — it can be stale.
  // Check the actual DB state and do the opposite.
  const checkUrl = new URL(`${SUPABASE_URL}/rest/v1/saved_farmstands`);
  checkUrl.searchParams.set("user_id", `eq.${userId}`);
  checkUrl.searchParams.set("farmstand_id", `eq.${farmstand_id}`);
  checkUrl.searchParams.set("select", "farmstand_id");

  const checkResp = await fetch(checkUrl.toString(), {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  let alreadyExists = false;
  if (checkResp.ok) {
    const rows = (await checkResp.json()) as { farmstand_id: string }[];
    alreadyExists = rows.length > 0;
  } else {
    const errText = await checkResp.text();
    console.log(`[Favorites API] existence check failed: ${checkResp.status} ${errText}`);
    return c.json({ success: false, favorites: [], error: "Could not check existing state" }, 500);
  }

  const trueAction = alreadyExists ? "unsave" : "save";
  console.log(`[Favorites API] existing favorite found=${alreadyExists} → performing ${trueAction} (client sent action=${action})`);

  if (trueAction === "save") {
    console.log(`[Favorites API] INSERT { user_id: ${userId}, farmstand_id: ${farmstand_id} }`);
    const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/saved_farmstands`, {
      method: "POST",
      headers: {
        ...serviceHeaders,
        // resolution=ignore-duplicates silently skips if the row already exists
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify({ user_id: userId, farmstand_id }),
    });

    if (!insertResp.ok) {
      const errText = await insertResp.text();
      // 409 duplicate = already saved, treat as success
      if (insertResp.status !== 409) {
        console.log(`[Favorites API] INSERT failed: ${insertResp.status} ${errText}`);
        return c.json({ success: false, favorites: [], error: `Insert failed: ${insertResp.status}` }, 500);
      }
      console.log(`[Favorites API] INSERT 409 duplicate — already saved, treating as success`);
    } else {
      console.log(`[Favorites API] INSERT success`);
    }
  } else {
    // unsave — DELETE
    const deleteUrl = new URL(`${SUPABASE_URL}/rest/v1/saved_farmstands`);
    deleteUrl.searchParams.set("user_id", `eq.${userId}`);
    deleteUrl.searchParams.set("farmstand_id", `eq.${farmstand_id}`);

    console.log(`[Favorites API] DELETE user_id=${userId} farmstand_id=${farmstand_id}`);
    const deleteResp = await fetch(deleteUrl.toString(), { method: "DELETE", headers: serviceHeaders });

    if (!deleteResp.ok) {
      const errText = await deleteResp.text();
      console.log(`[Favorites API] DELETE failed: ${deleteResp.status} ${errText}`);
      return c.json({ success: false, favorites: [], error: `Delete failed: ${deleteResp.status}` }, 500);
    }
    console.log(`[Favorites API] DELETE success`);
  }

  // Re-fetch the current favorites for this user so the client can sync exactly
  const fetchUrl = new URL(`${SUPABASE_URL}/rest/v1/saved_farmstands`);
  fetchUrl.searchParams.set("user_id", `eq.${userId}`);
  fetchUrl.searchParams.set("select", "farmstand_id");

  const fetchResp = await fetch(fetchUrl.toString(), {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  let favorites: string[] = [];
  if (fetchResp.ok) {
    const rows = (await fetchResp.json()) as { farmstand_id: string }[];
    favorites = rows.map((r) => r.farmstand_id);
    console.log(`[Favorites API] refreshed favorites for user: [${favorites.join(", ")}]`);
    console.log(`[Favorites API] action=${trueAction} returned ids=[${favorites.join(", ")}]`);
    // Post-write validation
    const includedAfter = favorites.includes(farmstand_id);
    if (trueAction === "save" && !includedAfter) {
      console.log(`[Favorites API] ERROR: SAVE succeeded but farmstand_id=${farmstand_id} is NOT in returned ids — DB write may not have committed`);
    }
    if (trueAction === "unsave" && includedAfter) {
      console.log(`[Favorites API] ERROR: UNSAVE succeeded but farmstand_id=${farmstand_id} is STILL in returned ids — DELETE may not have matched any rows`);
    }
    console.log(`[FavoritesAPIEnd] ts=${Date.now()} action=${trueAction} farmstandId=${farmstand_id} userId=${userId} returnedIds=[${favorites.join(", ")}]`);
  } else {
    console.log(`[Favorites API] re-fetch failed: ${fetchResp.status} — returning empty list`);
  }

  return c.json({ success: true, favorites });
});
