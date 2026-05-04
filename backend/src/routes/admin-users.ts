import { Hono } from "hono";
import { z } from "zod";
import { sendPushToUsers } from "../lib/push-sender";

/**
 * Admin Users Route
 *
 * GET  /api/admin/users          — List all users with profiles + farmstand counts
 * POST /api/admin/broadcast-alert — Send persistent alert + push to selected users
 * PATCH /api/admin/users/:id/role   — Update user role
 * PATCH /api/admin/users/:id/status — Update user status
 *
 * SECURITY:
 * - Requires valid user JWT
 * - Verifies caller email against hardcoded ADMIN_EMAILS list
 * - Uses service role key for all DB reads/writes (bypasses RLS)
 * - Never exposes full user list to non-admins
 */

export const adminUsersRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const ADMIN_EMAILS = ["contact@farmstand.online"];

interface SupabaseAuthUser {
  id: string;
  email?: string;
  created_at: string;
  raw_user_meta_data?: {
    full_name?: string;
    role?: string;
  };
}

interface ProfileRow {
  uid: string;
  full_name?: string | null;
  role?: string | null;
  status?: string | null;
  avatar_url?: string | null;
  created_at?: string;
}

interface FarmstandRow {
  owner_id: string | null;
  claimed_by?: string | null;
  premium_status?: string | null;
  premium_trial_expires_at?: string | null;
  deleted_at?: string | null; // included so we can gate farmer-count on non-deleted rows
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

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
    const data = (await resp.json()) as { id?: string; email?: string };
    if (!data?.id) return { userId: null, email: null, error: "No user ID in token" };
    return { userId: data.id, email: data.email ?? null, error: null };
  } catch {
    return { userId: null, email: null, error: "Failed to verify session" };
  }
}

function isAdminEmail(email: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase().trim());
}

const serviceHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

// ── GET /api/admin/users ──────────────────────────────────────────────────────

adminUsersRouter.get("/users", async (c) => {
  console.log("[AdminUsers] GET /users — request received");

  try {
    // Auth — inside try so any network error from verifyAdminJwt is caught and returns JSON
    const { userId, email, error } = await verifyAdminJwt(c.req.header("Authorization"));
    if (error || !userId) {
      console.log("[AdminUsers] Auth failed:", error);
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    if (!isAdminEmail(email)) {
      console.log("[AdminUsers] Non-admin access attempt:", email);
      return c.json({ success: false, error: "Admin access required" }, 403);
    }
    console.log("[AdminUsers] Auth verified — adminId:", userId);

    // 1. Fetch all auth users via Supabase Admin API (service role required)
    //    Pagination: up to 1000 users per page — sufficient for most apps.
    //    For very large userbases, add pagination support later.
    const authUrl = new URL(`${SUPABASE_URL}/auth/v1/admin/users`);
    authUrl.searchParams.set("page", "1");
    authUrl.searchParams.set("per_page", "1000");

    const authResp = await fetch(authUrl.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    console.log("[AdminUsers] auth.users fetch — status:", authResp.status);
    if (!authResp.ok) {
      const errText = await authResp.text();
      console.error("[AdminUsers] Auth users fetch failed:", authResp.status, errText);
      return c.json({ success: false, error: "Failed to fetch users from auth" }, 500);
    }

    const authData = (await authResp.json()) as {
      users?: SupabaseAuthUser[];
      aud?: string;
    };
    const authUsers: SupabaseAuthUser[] = authData?.users ?? [];
    console.log(`[AdminUsers] auth.users — fetched ${authUsers.length} users`);

    // 2. Fetch all profiles (role, status, avatar, name)
    const profilesUrl = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
    profilesUrl.searchParams.set("select", "uid,full_name,role,status,avatar_url,created_at");

    const profilesResp = await fetch(profilesUrl.toString(), {
      headers: serviceHeaders,
    });

    console.log("[AdminUsers] profiles fetch — status:", profilesResp.status);
    if (!profilesResp.ok) {
      const profErrText = await profilesResp.text();
      console.error("[AdminUsers] Profiles fetch failed:", profilesResp.status, profErrText);
    }

    const profiles: ProfileRow[] = profilesResp.ok
      ? ((await profilesResp.json()) as ProfileRow[])
      : [];
    console.log(`[AdminUsers] profiles — fetched ${profiles.length} rows`);

    const profileMap = new Map<string, ProfileRow>(profiles.map((p) => [p.uid, p]));

    // 3. Fetch farmstands — owner_id, claimed_by, premium fields, and deleted_at.
    //    IMPORTANT: NO deleted_at filter here. Premium trials on soft-deleted farmstands
    //    are still valid — the trial belongs to the user, not the farmstand's live state.
    //    We include deleted_at so we can still gate the farmer COUNT on active rows only.
    const fsUrl = new URL(`${SUPABASE_URL}/rest/v1/farmstands`);
    fsUrl.searchParams.set(
      "select",
      "owner_id,claimed_by,premium_status,premium_trial_expires_at,deleted_at"
    );

    const fsResp = await fetch(fsUrl.toString(), { headers: serviceHeaders });
    console.log("[AdminUsers] farmstands fetch — status:", fsResp.status);
    if (!fsResp.ok) {
      const fsErrText = await fsResp.text();
      console.error("[AdminUsers] Farmstands fetch failed:", fsResp.status, fsErrText);
    }
    const farmstands: FarmstandRow[] = fsResp.ok
      ? ((await fsResp.json()) as FarmstandRow[])
      : [];
    console.log(`[AdminUsers] farmstands — fetched ${farmstands.length} rows`);

    // Per-user farmstand count (farmer detection: owner_id only, unchanged)
    const farmstandCounts = new Map<string, number>();
    // Per-user premium flag: any farmstand with active premium linked to them
    const premiumUserIds = new Set<string>();
    const nowIso = new Date().toISOString();

    for (const fs of farmstands) {
      const isDeleted = fs.deleted_at != null;

      // Farmer count — only active (non-deleted) farmstands count
      if (!isDeleted && fs.owner_id) {
        farmstandCounts.set(fs.owner_id, (farmstandCounts.get(fs.owner_id) ?? 0) + 1);
      }

      // Premium detection — ONLY for active (non-deleted) farmstands that still
      // have a current owner. A farmstand that was deleted or had its ownership
      // removed should NOT continue to grant premium to the former owner.
      // Premium is claim-based: it only applies while the user actively owns the stand.
      const hasCurrentOwner = fs.owner_id != null || fs.claimed_by != null;
      const isPremiumFs =
        !isDeleted &&
        hasCurrentOwner &&
        (
          fs.premium_status === "active" ||
          fs.premium_status === "trial" ||
          (fs.premium_trial_expires_at != null && fs.premium_trial_expires_at > nowIso)
        );

      if (isPremiumFs) {
        const ownerLabel = fs.owner_id ?? fs.claimed_by ?? "unknown";
        console.log(
          `[AdminUsers] PREMIUM farmstand owner=${ownerLabel} ` +
          `status=${fs.premium_status ?? "null"} trial_expires=${fs.premium_trial_expires_at ?? "null"} ` +
          `deleted=${isDeleted}`
        );
        if (fs.owner_id) premiumUserIds.add(fs.owner_id);
        if (fs.claimed_by) premiumUserIds.add(fs.claimed_by);
      }
    }
    console.log(`[AdminUsers] Premium user IDs found: ${premiumUserIds.size > 0 ? [...premiumUserIds].join(", ") : "none"}`);

    // 4. Merge: auth data + profiles + farmstand counts
    const users = authUsers.map((u) => {
      const profile = profileMap.get(u.id);
      const metaName = u.raw_user_meta_data?.full_name;
      const metaRole = u.raw_user_meta_data?.role;

      // Derive display name: profile.full_name > metadata name > email prefix
      const fullName =
        profile?.full_name ||
        metaName ||
        (u.email ? u.email.split("@")[0] : "Unknown User");

      // Derive role: profile.role > metadata role > default 'consumer'
      // Normalize to lowercase so "Farmer", "FARMER", etc. all resolve correctly
      const validRoles = ["admin", "farmer", "consumer"] as const;
      type Role = (typeof validRoles)[number];
      const roleRaw = ((profile?.role || metaRole || "consumer") as string).toLowerCase();
      const role: Role = validRoles.includes(roleRaw as Role)
        ? (roleRaw as Role)
        : "consumer";

      const status = profile?.status === "suspended" ? "suspended" : "active";

      return {
        id: u.id,
        email: u.email ?? "",
        full_name: fullName,
        role,
        status,
        avatar_url: profile?.avatar_url ?? null,
        created_at: u.created_at,
        farmstand_count: farmstandCounts.get(u.id) ?? 0,
        is_premium: premiumUserIds.has(u.id),
      };
    });

    // Exclude every admin-email account — they must never appear in the managed-users list
    const managedUsers = users.filter((u) => !isAdminEmail(u.email));
    console.log(
      `[AdminUsers] Returning ${managedUsers.length} non-admin users` +
      ` (excluded ${users.length - managedUsers.length} admin accounts)`
    );

    return c.json({ success: true, users: managedUsers });
  } catch (err) {
    console.error("[AdminUsers] Unexpected error:", err);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

// ── POST /api/admin/broadcast-alert ──────────────────────────────────────────

const broadcastSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1, "At least one user required"),
  type: z.string().default("platform_announcement"),
  title: z.string().min(1, "title is required"),
  message: z.string().min(1, "message is required"),
  deep_link: z.string().nullable().optional(),
});

adminUsersRouter.post("/broadcast-alert", async (c) => {
  const { userId, email, error } = await verifyAdminJwt(c.req.header("Authorization"));
  if (error || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);
  if (!isAdminEmail(email)) return c.json({ success: false, error: "Admin access required" }, 403);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const parsed = broadcastSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" },
      400
    );
  }

  const { user_ids, type, title, message, deep_link } = parsed.data;

  // Validate trimmed non-empty strings (belt-and-suspenders beyond Zod min(1))
  if (!title.trim()) {
    return c.json({ success: false, error: "title is required" }, 400);
  }
  if (!message.trim()) {
    return c.json({ success: false, error: "message is required" }, 400);
  }

  // Build alert rows using the correct inbox_alerts column names.
  // - type: required for correct icon/display in the inbox
  // - body: the notification text (maps to the body column)
  // - action_route: optional deep-link route when the alert is tapped
  const alertRows = user_ids.map((uid) => ({
    user_id: uid,
    type: type || "platform_announcement",
    title: title.trim(),
    body: message.trim(),
    action_route: deep_link?.trim() || null,
  }));

  console.log(`[AdminAlert] Sending "${title}" to ${user_ids.length} user(s) — type=${type || "platform_announcement"}`);
  console.log("[AdminAlert] Insert payload sample:", JSON.stringify(alertRows[0] ?? {}));

  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/inbox_alerts`, {
    method: "POST",
    headers: {
      ...serviceHeaders,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(alertRows),
  });

  const insertOk =
    insertResp.ok ||
    insertResp.status === 201 ||
    insertResp.status === 204;

  if (!insertOk) {
    const errText = await insertResp.text();
    console.error("[AdminAlert] Insert failed — status:", insertResp.status, "error:", errText);
    // Surface the real Supabase error to the caller
    let supabaseMessage = "Failed to insert alerts";
    try {
      const parsed = JSON.parse(errText) as { message?: string; details?: string; hint?: string };
      supabaseMessage = parsed.message ?? parsed.details ?? errText;
    } catch {
      supabaseMessage = errText || supabaseMessage;
    }
    return c.json({ success: false, error: supabaseMessage }, 500);
  }

  console.log(`[AdminAlert] ✅ Inserted ${user_ids.length} alert row(s) into inbox_alerts`);

  // Send push notifications to all target users.
  // Uses user_push_tokens with a fallback to profiles.expo_push_token so every
  // active device gets the notification even if the multi-device table is empty.
  // Non-blocking — in-app alerts are already persisted above.
  sendPushToUsers(user_ids, title.trim(), message.trim(), {
    type: "alert",
    alertType: type || "platform_announcement",
    actionRoute: deep_link?.trim() ?? null,
    screen: "Inbox",
  }).catch((err) => {
    console.log("[AdminAlert] Push error (non-fatal):", err);
  });

  return c.json({ success: true, sent_count: user_ids.length });
});

// ── PATCH /api/admin/users/:id/role ──────────────────────────────────────────

adminUsersRouter.patch("/users/:id/role", async (c) => {
  const { userId, email, error } = await verifyAdminJwt(c.req.header("Authorization"));
  if (error || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);
  if (!isAdminEmail(email)) return c.json({ success: false, error: "Admin access required" }, 403);

  const targetId = c.req.param("id");

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid body" }, 400);
  }

  const parsed = z
    .object({ role: z.enum(["admin", "farmer", "consumer"]) })
    .safeParse(rawBody);
  if (!parsed.success) return c.json({ success: false, error: "Invalid role" }, 400);

  const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set("uid", `eq.${targetId}`);

  const resp = await fetch(url.toString(), {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ role: parsed.data.role, updated_at: new Date().toISOString() }),
  });

  if (!resp.ok && resp.status !== 204) {
    const err = await resp.text();
    console.error("[AdminUsers] Role update failed:", resp.status, err);
    return c.json({ success: false, error: "Failed to update role" }, 500);
  }

  console.log(`[AdminUsers] Updated role for ${targetId} → ${parsed.data.role}`);
  return c.json({ success: true });
});

// ── PATCH /api/admin/users/:id/status ────────────────────────────────────────

adminUsersRouter.patch("/users/:id/status", async (c) => {
  const { userId, email, error } = await verifyAdminJwt(c.req.header("Authorization"));
  if (error || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);
  if (!isAdminEmail(email)) return c.json({ success: false, error: "Admin access required" }, 403);

  const targetId = c.req.param("id");

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid body" }, 400);
  }

  const parsed = z
    .object({ status: z.enum(["active", "suspended"]) })
    .safeParse(rawBody);
  if (!parsed.success) return c.json({ success: false, error: "Invalid status" }, 400);

  const url = new URL(`${SUPABASE_URL}/rest/v1/profiles`);
  url.searchParams.set("uid", `eq.${targetId}`);

  const resp = await fetch(url.toString(), {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ status: parsed.data.status, updated_at: new Date().toISOString() }),
  });

  if (!resp.ok && resp.status !== 204) {
    const err = await resp.text();
    console.error("[AdminUsers] Status update failed:", resp.status, err);
    return c.json({ success: false, error: "Failed to update status" }, 500);
  }

  console.log(`[AdminUsers] Updated status for ${targetId} → ${parsed.data.status}`);
  return c.json({ success: true });
});

// ── DELETE /api/admin/users/:id ───────────────────────────────────────────────

adminUsersRouter.delete("/users/:id", async (c) => {
  // FIRST line — before any auth, any try — confirms the route is reached
  console.log("[DELETE USER] route hit");

  try {
    // Auth
    const { userId, email, error } = await verifyAdminJwt(c.req.header("Authorization"));
    if (error || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);
    if (!isAdminEmail(email)) return c.json({ success: false, error: "Admin access required" }, 403);

    const targetId = c.req.param("id");
    console.log("[DELETE USER] adminUserId:", userId);
    console.log("[DELETE USER] targetUserId:", targetId);

    // RPC — clean up public.* table data first
    const rpcResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_delete_user_data`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({ p_admin_user_id: userId, p_user_id: targetId }),
    });

    const rawBody = await rpcResp.text();
    console.log("[DELETE USER] rpc raw body:", rawBody);

    if (!rawBody) {
      console.error("[DELETE USER] EMPTY RPC RESPONSE");
    }

    interface RpcParsed { message?: string; details?: string; hint?: string; code?: string; success?: boolean; error?: string; }
    let parsed: RpcParsed | null = null;
    if (rawBody.trim()) {
      try { parsed = JSON.parse(rawBody) as RpcParsed; } catch { /* non-JSON treated as raw error text */ }
    }
    console.log("[DELETE USER] parsed:", parsed);

    if (!rpcResp.ok || (parsed !== null && parsed.success === false)) {
      console.error("[DELETE USER ERROR]", {
        message: parsed?.message,
        details: parsed?.details,
        hint: parsed?.hint,
        code: parsed?.code,
      });
      return c.json({
        success: false,
        error: parsed?.message || rawBody || "NO ERROR RETURNED",
        details: parsed?.details,
        hint: parsed?.hint,
        code: parsed?.code,
      }, 500);
    }

    // Delete auth.users row (cascades to profiles)
    const authDeleteResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetId}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    console.log("[DELETE USER] auth delete status:", authDeleteResp.status);
    if (!authDeleteResp.ok && authDeleteResp.status !== 404) {
      const authErr = await authDeleteResp.text();
      console.error("[DELETE USER] auth delete failed:", authDeleteResp.status, authErr);
      return c.json({
        success: false,
        error: `Auth delete failed (${authDeleteResp.status}): ${authErr || "NO ERROR RETURNED"}`,
      }, 500);
    }

    console.log("[DELETE USER] success — user:", targetId, "deleted by admin:", userId);
    return c.json({ success: true });

  } catch (e) {
    console.error("[DELETE USER FATAL]", e);
    return c.json({
      success: false,
      error: (e as Error).message || "Fatal backend error",
    }, 500);
  }
});
