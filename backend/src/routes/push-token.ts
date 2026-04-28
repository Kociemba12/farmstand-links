import { Hono } from "hono";
import { sendClaimPushToUser } from "../lib/push-sender";

/**
 * POST /api/push/sync-token
 *
 * Called by the mobile app whenever a user's Expo push token is obtained.
 * Uses the service role key to atomically:
 *  1. Set profiles.expo_push_token = token   for the calling user's row  (filter: id = userId)
 *  2. Clear profiles.expo_push_token = NULL  for ALL OTHER users who have the same token
 *  3. Delete rows from user_push_tokens      for ALL OTHER users who have the same token
 *
 * profiles.id is the primary key (uuid, equals auth.users.id) — NOT uid.
 *
 * Requires: Authorization: Bearer <valid user JWT>
 * Body:     { token: string }
 */

export const pushTokenRouter = new Hono();

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// Log at startup whether keys are configured
console.log(
  `[SyncToken] Config — SUPABASE_URL=${SUPABASE_URL ? SUPABASE_URL.substring(0, 40) + "…" : "(MISSING)"}`
);
console.log(
  `[SyncToken] Config — SERVICE_ROLE_KEY length=${SUPABASE_SERVICE_ROLE_KEY.length} ANON_KEY length=${SUPABASE_ANON_KEY.length}`
);

// ── JWT helpers ────────────────────────────────────────────────────────────────

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
        apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.log(`[SyncToken] verifyJwt FAIL — HTTP ${resp.status}: ${body}`);
      return { userId: null, email: null, error: "Invalid session" };
    }
    const data = (await resp.json()) as { id?: string; email?: string };
    if (!data?.id) return { userId: null, email: null, error: "No user ID in token" };
    return { userId: data.id, email: data.email ?? null, error: null };
  } catch (err) {
    console.log(`[SyncToken] verifyJwt EXCEPTION:`, err);
    return { userId: null, email: null, error: "Failed to verify session" };
  }
}

const serviceHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  Prefer: "return=representation",
};

// ── Route ──────────────────────────────────────────────────────────────────────

pushTokenRouter.post("/sync-token", async (c) => {
  console.log(`[SyncToken] ROUTE HIT — ${new Date().toISOString()}`);

  const { userId, email, error: authError } = await verifyJwt(
    c.req.header("Authorization")
  );
  if (authError || !userId) {
    console.log(`[SyncToken] AUTH FAIL — ${authError}`);
    return c.json({ success: false, error: authError ?? "Unauthorized" }, 401);
  }
  console.log(`[SyncToken] Auth OK — userId=${userId} email=${email ?? "unknown"}`);

  let body: { token?: string };
  try {
    body = (await c.req.json()) as { token?: string };
  } catch {
    console.log(`[SyncToken] FAIL — invalid JSON body`);
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { token } = body;
  console.log(
    `[SyncToken] token in body = ${token ? token.substring(0, 40) + "…" : "(missing or empty)"}`
  );

  if (!token?.startsWith("ExponentPushToken[")) {
    console.log(
      `[SyncToken] FAIL — token is not a valid ExponentPushToken (value="${token}")`
    );
    return c.json(
      { success: false, error: "token must be a valid ExponentPushToken" },
      400
    );
  }

  const tag = `[SyncToken] userId=${userId} email=${email ?? "unknown"}`;
  console.log(`${tag} START — token=${token.substring(0, 30)}…`);
  console.log(`${tag} Target — Supabase host: ${new URL(SUPABASE_URL).hostname}`);

  // ── 0. Pre-check: confirm profile row exists and email matches ─────────────
  // This catches row-not-found and project mismatches BEFORE attempting the write.
  const preCheckUrl = `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,expo_push_token`;
  console.log(`${tag} PRE-CHECK SELECT ${preCheckUrl}`);
  try {
    const pc = await fetch(preCheckUrl, { headers: serviceHeaders });
    if (!pc.ok) {
      const t = await pc.text();
      console.log(`${tag} ❌ PRE-CHECK FAILED status=${pc.status} body=${t}`);
    } else {
      const rows = (await pc.json()) as Array<{ id: string; email?: string; expo_push_token?: string | null }>;
      const row = rows[0];
      if (!row) {
        console.log(
          `${tag} ❌ PRE-CHECK: NO PROFILE ROW found for id=${userId}. ` +
          `Auth says email=${email ?? "unknown"}. The profile row is missing — cannot write token.`
        );
        return c.json({ success: false, error: "No profile row found for authenticated user" }, 500);
      }
      const emailMatch = row.email === email;
      console.log(
        `${tag} PRE-CHECK OK — profile row found: id=${row.id} email=${row.email ?? "?"} ` +
        `current_token=${row.expo_push_token ? row.expo_push_token.substring(0, 30) + "…" : "NULL"} ` +
        `emailMatchesAuth=${emailMatch}`
      );
      if (!emailMatch) {
        console.log(
          `${tag} ⚠️ EMAIL MISMATCH: auth email="${email}" but profiles row email="${row.email}" — ` +
          `proceeding with PATCH by id (id is authoritative)`
        );
      }
    }
  } catch (err) {
    console.log(`${tag} ❌ PRE-CHECK EXCEPTION:`, err);
  }

  // ── 1. Write token to this user's profile row ──────────────────────────────
  // Filter by profiles.id (primary key = auth.users.id), NOT uid.
  // Use return=representation so we can count how many rows were actually updated.
  let rowsUpdated = 0;
  const patchUrl = `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`;
  console.log(`${tag} PATCH ${patchUrl} — setting expo_push_token`);

  try {
    const r = await fetch(patchUrl, {
      method: "PATCH",
      headers: serviceHeaders,
      body: JSON.stringify({ expo_push_token: token }),
    });
    console.log(`${tag} profiles PATCH response status=${r.status}`);

    if (r.ok) {
      const rows = (await r.json().catch(() => [])) as unknown[];
      rowsUpdated = Array.isArray(rows) ? rows.length : 0;
      if (rowsUpdated > 0) {
        console.log(`${tag} ✅ profiles PATCH wrote ${rowsUpdated} row(s)`);
      } else {
        console.log(
          `${tag} ❌ ERROR: profiles PATCH returned 0 rows — id=${userId} not found in profiles. ` +
          `Response body: ${JSON.stringify(rows)}`
        );
      }
    } else {
      const t = await r.text();
      console.log(`${tag} ❌ profiles PATCH FAILED status=${r.status} body=${t}`);
    }
  } catch (err) {
    console.log(`${tag} ❌ profiles PATCH EXCEPTION:`, err);
  }

  // ── 1b. Verification SELECT — confirm the value is now in the DB ───────────
  try {
    const verifyUrl = `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,expo_push_token`;
    console.log(`${tag} VERIFY SELECT ${verifyUrl}`);
    const vr = await fetch(verifyUrl, { headers: serviceHeaders });
    if (vr.ok) {
      const rows = (await vr.json()) as Array<{
        id: string;
        email?: string;
        expo_push_token?: string | null;
      }>;
      const row = rows[0];
      if (!row) {
        console.log(`${tag} ❌ VERIFY: no profile row found for id=${userId}`);
      } else {
        const stored = row.expo_push_token;
        if (stored === token) {
          console.log(
            `${tag} ✅ VERIFY: profiles.expo_push_token confirmed written — id=${row.id} email=${row.email ?? "?"} token=${stored.substring(0, 30)}…`
          );
        } else {
          console.log(
            `${tag} ❌ VERIFY MISMATCH: stored="${stored ?? "NULL"}" expected="${token.substring(0, 30)}…" — write did not persist`
          );
        }
      }
    } else {
      const t = await vr.text();
      console.log(`${tag} ❌ VERIFY SELECT FAILED status=${vr.status} body=${t}`);
    }
  } catch (err) {
    console.log(`${tag} ❌ VERIFY SELECT EXCEPTION:`, err);
  }

  // ── 2. Evict this token from all OTHER users' profiles ─────────────────────
  // Filter stale rows by expo_push_token = this token AND id != this user.
  let evictedProfileCount = 0;
  try {
    const findUrl = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
    findUrl.searchParams.set("select", "id");
    findUrl.searchParams.set("expo_push_token", `eq.${token}`);
    findUrl.searchParams.set("id", `neq.${userId}`);

    console.log(`${tag} Evict: scanning for stale profiles — ${findUrl}`);
    const findResp = await fetch(findUrl.toString(), { headers: serviceHeaders });

    if (findResp.ok) {
      const staleProfiles = (await findResp.json()) as Array<{ id: string }>;
      if (staleProfiles.length > 0) {
        console.log(
          `${tag} Evict: found ${staleProfiles.length} stale profile(s): ` +
          staleProfiles.map((p) => p.id).join(", ")
        );
        for (const p of staleProfiles) {
          const clearResp = await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`,
            {
              method: "PATCH",
              headers: serviceHeaders,
              body: JSON.stringify({ expo_push_token: null }),
            }
          );
          if (clearResp.ok) {
            console.log(`${tag} Evict: cleared token from profile id=${p.id}`);
            evictedProfileCount++;
          } else {
            const t = await clearResp.text();
            console.log(
              `${tag} WARN: failed to clear stale profile id=${p.id}: ${clearResp.status} ${t}`
            );
          }
        }
      } else {
        console.log(`${tag} Evict: no stale profile rows for this token`);
      }
    } else {
      const t = await findResp.text();
      console.log(`${tag} WARN: stale-profile scan failed: ${findResp.status} ${t}`);
    }
  } catch (err) {
    console.log(`${tag} WARN: stale profile eviction exception:`, err);
  }

  // ── 3. Evict this token from all OTHER users' user_push_tokens rows ─────────
  let evictedTokenRowCount = 0;
  try {
    const findUrl = new URL(`${SUPABASE_URL}/rest/v1/user_push_tokens`);
    findUrl.searchParams.set("select", "id,user_id");
    findUrl.searchParams.set("expo_push_token", `eq.${token}`);
    findUrl.searchParams.set("user_id", `neq.${userId}`);

    console.log(`${tag} Evict: scanning for stale user_push_tokens — ${findUrl}`);
    const findResp = await fetch(findUrl.toString(), { headers: serviceHeaders });

    if (findResp.ok) {
      const staleRows = (await findResp.json()) as Array<{
        id: string;
        user_id: string;
      }>;
      if (staleRows.length > 0) {
        console.log(
          `${tag} Evict: found ${staleRows.length} stale user_push_tokens row(s): ` +
          staleRows.map((r) => `user_id=${r.user_id}`).join(", ")
        );
        for (const row of staleRows) {
          const delResp = await fetch(
            `${SUPABASE_URL}/rest/v1/user_push_tokens?id=eq.${encodeURIComponent(row.id)}`,
            { method: "DELETE", headers: serviceHeaders }
          );
          if (delResp.ok) {
            console.log(
              `${tag} Evict: deleted user_push_tokens row id=${row.id} user_id=${row.user_id}`
            );
            evictedTokenRowCount++;
          } else {
            const t = await delResp.text();
            console.log(
              `${tag} WARN: failed to delete stale row id=${row.id}: ${delResp.status} ${t}`
            );
          }
        }
      } else {
        console.log(`${tag} Evict: no stale user_push_tokens rows for this token`);
      }
    } else {
      const t = await findResp.text();
      console.log(`${tag} WARN: stale user_push_tokens scan failed: ${findResp.status} ${t}`);
    }
  } catch (err) {
    console.log(`${tag} WARN: stale user_push_tokens eviction exception:`, err);
  }

  console.log(
    `${tag} DONE — rowsUpdated=${rowsUpdated} evictedProfiles=${evictedProfileCount} evictedTokenRows=${evictedTokenRowCount}`
  );

  return c.json({
    success: true,
    rowsUpdated,
    evictedProfileCount,
    evictedTokenRowCount,
  });
});

// ── Test push endpoint ──────────────────────────────────────────────────────
// POST /api/push/test-push
// Sends a test claim-path push to the currently authenticated user.
// Reads profiles.expo_push_token, logs everything, returns DB token + Expo result.

pushTokenRouter.post("/test-push", async (c) => {
  console.log(`[TestPush] ROUTE HIT — ${new Date().toISOString()}`);

  const { userId, email, error: authError } = await verifyJwt(
    c.req.header("Authorization")
  );
  if (authError || !userId) {
    console.log(`[TestPush] AUTH FAIL — ${authError}`);
    return c.json({ success: false, error: authError ?? "Unauthorized" }, 401);
  }
  console.log(`[TestPush] Auth OK — userId=${userId} email=${email ?? "unknown"}`);

  // 1. Read the profile row directly so we can report the token state
  const profileUrl = `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,expo_push_token`;
  console.log(`[TestPush] SELECT ${profileUrl}`);

  let tokenInDB: string | null = null;
  let profileEmail: string | null = null;

  try {
    const pr = await fetch(profileUrl, { headers: serviceHeaders });
    if (!pr.ok) {
      const t = await pr.text();
      console.log(`[TestPush] ❌ Profile SELECT failed status=${pr.status} body=${t}`);
      return c.json({ success: false, error: `Profile SELECT failed: ${pr.status}` }, 500);
    }
    const rows = (await pr.json()) as Array<{ id: string; email?: string | null; expo_push_token?: string | null }>;
    const row = rows[0];
    if (!row) {
      console.log(`[TestPush] ❌ No profile row for userId=${userId}`);
      return c.json({ success: false, error: "No profile row found", tokenInDB: null }, 404);
    }
    tokenInDB = row.expo_push_token ?? null;
    profileEmail = row.email ?? null;
    console.log(
      `[TestPush] Profile row — id=${row.id} email=${profileEmail ?? "NULL"} ` +
      `expo_push_token=${tokenInDB ? `"${tokenInDB}"` : "NULL"}`
    );
  } catch (err) {
    console.log(`[TestPush] ❌ Profile SELECT EXCEPTION:`, err);
    return c.json({ success: false, error: "Exception reading profile" }, 500);
  }

  if (!tokenInDB) {
    console.log(
      `[TestPush] ❌ CANNOT SEND — profiles.expo_push_token is NULL for userId=${userId}. ` +
      `The mobile app has not synced an Expo token to this profile row yet.`
    );
    return c.json({
      success: false,
      error: "profiles.expo_push_token is NULL — token not yet synced from the app",
      tokenInDB: null,
      userId,
      email: profileEmail,
    }, 400);
  }

  // 2. Send the test push via the exact same path as real claim pushes
  console.log(`[TestPush] Sending test push via sendClaimPushToUser — userId=${userId}`);
  try {
    await sendClaimPushToUser(
      userId,
      "Test Push (claim path)",
      "If you see this, the claim push path is working end-to-end.",
      { type: "test_push", source: "test-push-endpoint" }
    );
  } catch (err) {
    console.log(`[TestPush] ❌ sendClaimPushToUser threw:`, err);
    return c.json({
      success: false,
      error: `sendClaimPushToUser threw: ${err}`,
      tokenInDB,
      userId,
      email: profileEmail,
    }, 500);
  }

  console.log(`[TestPush] DONE — check server logs above for Expo response details`);
  return c.json({
    success: true,
    message: "Test push sent via claim path — check server logs for Expo response",
    tokenInDB,
    userId,
    email: profileEmail,
  });
});
