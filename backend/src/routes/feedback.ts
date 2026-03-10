import { Hono } from "hono";
import { z } from "zod";

/**
 * Feedback Route
 *
 * POST /api/feedback  — Submit user feedback (rate-us screen)
 * GET  /api/feedback  — Admin: fetch all feedback rows (requires admin JWT)
 *
 * SECURITY:
 * - POST: Requires valid user JWT, user_id taken from verified JWT
 * - GET:  Requires admin JWT (email in ADMIN_EMAILS list)
 * - Service role key used for all DB operations (bypasses RLS)
 */
export const feedbackRouter = new Hono();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const ADMIN_EMAILS = ["contact@farmstand.online", "joekociemba@gmail.com"];

interface SupabaseUserResponse {
  id?: string;
  email?: string;
}

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
    if (!resp.ok) return { userId: null, email: null, error: "Invalid session" };
    const data = (await resp.json()) as SupabaseUserResponse;
    if (!data?.id) return { userId: null, email: null, error: "No user ID in token" };
    return { userId: data.id, email: data.email ?? null, error: null };
  } catch {
    return { userId: null, email: null, error: "Failed to verify session" };
  }
}

const feedbackSchema = z.object({
  user_email: z.string().email(),
  user_name: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  category: z.string().min(1),
  message: z.string().min(1),
  source_screen: z.string().optional().default("rate-us"),
});

// POST /api/feedback — submit new feedback
feedbackRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid data" }, 400);
  }

  const data = parsed.data;

  const row = {
    user_id: userId,
    user_email: data.user_email,
    user_name: data.user_name ?? null,
    rating: data.rating ?? null,
    category: data.category,
    message: data.message,
    status: "new",
    source_screen: data.source_screen,
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[feedback] Insert failed:", resp.status, errText);
    // Check if table doesn't exist
    if (resp.status === 404 || errText.includes("does not exist") || errText.includes("schema cache")) {
      return c.json({
        success: false,
        error: "feedback_table_missing",
        hint: "The feedback table has not been created yet. Please run the migration SQL in your Supabase dashboard.",
      }, 503);
    }
    return c.json({ success: false, error: "Failed to save feedback" }, 500);
  }

  console.log("[feedback] Saved feedback from user:", userId);
  return c.json({ success: true });
});

// GET /api/feedback — admin fetch all feedback
feedbackRouter.get("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  if (!email || !ADMIN_EMAILS.includes(email)) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  const statusFilter = c.req.query("status");
  let url = `${SUPABASE_URL}/rest/v1/feedback?order=created_at.desc&limit=200`;
  if (statusFilter && statusFilter !== "all") {
    url += `&status=eq.${encodeURIComponent(statusFilter)}`;
  }

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[feedback] Fetch failed:", resp.status, errText);
    if (resp.status === 404 || errText.includes("schema cache")) {
      return c.json({ success: false, error: "feedback_table_missing" }, 503);
    }
    return c.json({ success: false, error: "Failed to fetch feedback" }, 500);
  }

  const rows = (await resp.json()) as Record<string, unknown>[];
  return c.json({ success: true, data: rows });
});

// PATCH /api/feedback/:id — admin update status/notes
feedbackRouter.patch("/:id", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON" }, 400);
  }

  const updateSchema = z.object({
    status: z.enum(["new", "read", "resolved"]).optional(),
    admin_notes: z.string().nullable().optional(),
  });

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid data" }, 400);
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status && parsed.data.status !== "new") {
    updateData.handled_by = email;
    updateData.handled_at = new Date().toISOString();
  }

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/feedback?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(updateData),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[feedback] Update failed:", resp.status, errText);
    return c.json({ success: false, error: "Failed to update feedback" }, 500);
  }

  return c.json({ success: true });
});
