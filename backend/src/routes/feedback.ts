import { Hono } from "hono";
import { z } from "zod";
import { getOriginalFetch } from "@vibecodeapp/proxy";
import { insertAlert } from "../lib/alert-inserter";
import { sendPushToUser } from "../lib/push-sender";
import { insertMessage, getMessagesByTicketId, deleteMessagesByTicketId, checkLocalTicketExists, upsertLocalTicket } from "../lib/support-db";

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

// Use the un-proxied fetch for all Supabase calls so the Vibecode proxy
// (which may dynamically add supabase.co to its domain list) does not intercept them.
// Same pattern as upload.ts.
const supabaseFetch = getOriginalFetch();

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
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await supabaseFetch(`${SUPABASE_URL}/auth/v1/user`, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    console.log("[feedback/verifyJwt] Supabase auth responded in", Date.now() - t0, "ms — status:", resp.status);
    if (!resp.ok) return { userId: null, email: null, error: "Invalid session" };
    const data = (await resp.json()) as SupabaseUserResponse;
    if (!data?.id) return { userId: null, email: null, error: "No user ID in token" };
    return { userId: data.id, email: data.email ?? null, error: null };
  } catch (err) {
    console.warn("[feedback/verifyJwt] Auth fetch failed in", Date.now() - t0, "ms —", err instanceof Error ? err.message : String(err));
    return { userId: null, email: null, error: "Failed to verify session" };
  } finally {
    clearTimeout(timer);
  }
}

const feedbackSchema = z.object({
  user_email: z.string().email(),
  user_name: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  category: z.string().min(1),
  message: z.string().min(1),
  source_screen: z.string().optional().default("rate-us"),
  screenshot_urls: z.array(z.string().min(1)).max(5).nullable().optional(),
});

// POST /api/feedback — submit new feedback
feedbackRouter.post("/", async (c) => {
  const t0 = Date.now();
  console.log("[feedback] POST /api/feedback — route hit");
  const authHeader = c.req.header("Authorization");

  const { userId, error: authError } = await verifyJwt(authHeader);
  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  console.log("[feedback/create] auth verified in", Date.now() - t0, "ms — userId:", userId);

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

  const row: Record<string, unknown> = {
    user_id: userId,
    user_email: data.user_email,
    user_name: data.user_name ?? null,
    rating: data.rating ?? null,
    category: data.category,
    message: data.message,
    status: "new",
    source_screen: data.source_screen,
    screenshot_urls: data.screenshot_urls && data.screenshot_urls.length > 0 ? data.screenshot_urls : [],
  };

  console.log("[feedback/create] inserting ticket — category:", data.category, "| photos:", (row.screenshot_urls as string[]).length);

  // Insert with timeout — use getOriginalFetch() to bypass Vibecode proxy (same as upload.ts)
  const insertCtrl = new AbortController();
  const insertTimer = setTimeout(() => insertCtrl.abort(), 8000);
  let resp: Response;
  try {
    resp = await supabaseFetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: "POST",
      signal: insertCtrl.signal,
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
  } finally {
    clearTimeout(insertTimer);
  }
  console.log("[feedback/create] Supabase INSERT responded in", Date.now() - t0, "ms — status:", resp.status);

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("[feedback/create] Supabase insert failed:", resp.status, errText);
    const isTableMissing =
      resp.status === 404 ||
      (errText.includes("does not exist") && !errText.includes("column")) ||
      errText.includes('"code":"PGRST200"') ||
      errText.includes("'PGRST200'");
    if (isTableMissing) {
      return c.json({
        success: false,
        error: "feedback_table_missing",
        hint: "The feedback table has not been created yet. Please run the migration SQL in your Supabase dashboard.",
      }, 503);
    }
    // PGRST204 = screenshot_urls column missing — retry without it
    const isColumnMissing =
      errText.includes('"code":"PGRST204"') ||
      errText.includes("'PGRST204'") ||
      (errText.includes("screenshot_urls") && errText.includes("does not exist"));
    if (isColumnMissing) {
      console.warn("[feedback/create] screenshot_urls column missing — retrying without it");
      const rowWithout = { ...row };
      delete rowWithout.screenshot_urls;
      const retryCtrl = new AbortController();
      const retryTimer = setTimeout(() => retryCtrl.abort(), 8000);
      let retryResp: Response;
      try {
        retryResp = await supabaseFetch(`${SUPABASE_URL}/rest/v1/feedback`, {
          method: "POST",
          signal: retryCtrl.signal,
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify(rowWithout),
        });
      } finally {
        clearTimeout(retryTimer);
      }
      if (!retryResp.ok) {
        const retryErrText = await retryResp.text();
        console.error("[feedback/create] Retry insert also failed:", retryResp.status, retryErrText);
        return c.json({ success: false, error: "Failed to save feedback" }, 500);
      }
      let retryTicketId: string | undefined;
      let retryCreatedAt: string | undefined;
      try {
        const retryRows = (await retryResp.json()) as Array<{ id?: string; created_at?: string }>;
        retryTicketId = retryRows[0]?.id;
        retryCreatedAt = retryRows[0]?.created_at;
      } catch { /* non-fatal */ }
      console.log("[feedback/create] retry ticket inserted:", retryTicketId, "in", Date.now() - t0, "ms");
      // Background: SQLite seed
      if (retryTicketId) {
        const retryTicketIdFinal = retryTicketId;
        const retryCreatedAtFinal = retryCreatedAt;
        queueMicrotask(() => {
          try {
            insertMessage({
              id: `${retryTicketIdFinal}-0`,
              ticket_id: retryTicketIdFinal,
              sender_role: "farmer",
              sender_user_id: userId,
              sender_email: data.user_email,
              message_text: data.message,
              created_at: retryCreatedAtFinal ?? new Date().toISOString(),
              is_visible_to_farmer: 1,
              attachment_urls: data.screenshot_urls && data.screenshot_urls.length > 0
                ? JSON.stringify(data.screenshot_urls)
                : null,
            });
            console.log("[feedback/create] retry SQLite seeded for ticket:", retryTicketIdFinal);
          } catch (dbErr) {
            console.warn("[feedback/create] SQLite seed failed (retry path):", dbErr);
          }
        });
      }
      console.log("[feedback/create] response sent (retry path) in", Date.now() - t0, "ms");
      return c.json({ success: true, id: retryTicketId });
    }
    return c.json({ success: false, error: "Failed to save feedback" }, 500);
  }

  let ticketId: string | undefined;
  let ticketCreatedAt: string | undefined;
  try {
    const rows = (await resp.json()) as Array<{ id?: string; created_at?: string; screenshot_urls?: string[] }>;
    ticketId = rows[0]?.id;
    ticketCreatedAt = rows[0]?.created_at;
    console.log("[feedback/create] ticket inserted — id:", ticketId, "| total so far:", Date.now() - t0, "ms");
  } catch {
    // Non-fatal
  }

  // Background: SQLite seed + hyper-worker — do not block the response
  if (ticketId) {
    const ticketIdFinal = ticketId;
    const ticketCreatedAtFinal = ticketCreatedAt;
    queueMicrotask(() => {
      // SQLite seed (synchronous, microseconds)
      try {
        const attachmentUrls = data.screenshot_urls && data.screenshot_urls.length > 0
          ? JSON.stringify(data.screenshot_urls)
          : null;
        insertMessage({
          id: `${ticketIdFinal}-0`,
          ticket_id: ticketIdFinal,
          sender_role: "farmer",
          sender_user_id: userId,
          sender_email: data.user_email,
          message_text: data.message,
          created_at: ticketCreatedAtFinal ?? new Date().toISOString(),
          is_visible_to_farmer: 1,
          attachment_urls: attachmentUrls,
        });
        console.log("[feedback/create] SQLite seeded for ticket:", ticketIdFinal, "| photos:", data.screenshot_urls?.length ?? 0);
      } catch (dbErr) {
        console.warn("[feedback/create] SQLite seed failed:", dbErr);
      }

      // Admin email via hyper-worker (fire-and-forget)
      const emailSubject = data.category || 'No subject provided.';
      const attachmentInfo = data.screenshot_urls && data.screenshot_urls.length > 0
        ? `${data.screenshot_urls.length} photo(s) attached`
        : null;
      const hwUrl = `${SUPABASE_URL}/functions/v1/hyper-worker`;
      console.log('[feedback/create] hyper-worker start — ticket:', ticketIdFinal);
      fetch(hwUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'support_ticket_submitted',
          data: {
            ticket_id: ticketIdFinal,
            subject: emailSubject,
            source_screen: data.source_screen || null,
            message: data.message || 'No message provided.',
            user_id: userId,
            user_email: data.user_email || 'Unknown user.',
            attachment_info: attachmentInfo,
            submitted_at: ticketCreatedAtFinal ?? new Date().toISOString(),
          },
        }),
      }).then(async (r) => {
        const body = await r.text().catch(() => '(unreadable)');
        console.log('[feedback/create] hyper-worker response — status:', r.status, '| body:', body);
      }).catch((err: unknown) => console.warn('[feedback/create] hyper-worker network error:', err));
    });
  }

  console.log("[feedback/create] response sent in", Date.now() - t0, "ms — ticket:", ticketId);
  return c.json({ success: true, id: ticketId });
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

// GET /api/feedback/:id/messages — admin fetch thread messages
feedbackRouter.get("/:id/messages", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  const id = c.req.param("id");

  // Fetch the ticket to verify it exists and get original message for fallback
  const fetchResp = await fetch(
    `${SUPABASE_URL}/rest/v1/feedback?id=eq.${encodeURIComponent(id)}&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    }
  );
  if (!fetchResp.ok) {
    return c.json({ success: false, error: "Failed to fetch ticket" }, 500);
  }
  const rows = (await fetchResp.json()) as Record<string, unknown>[];
  if (!rows[0]) {
    return c.json({ success: false, error: "Ticket not found" }, 404);
  }
  const ticket = rows[0];

  // Supabase screenshot_urls is the source of truth for the initial farmer message's photos
  const screenshotUrls = ticket.screenshot_urls as string[] | null | undefined;
  const attachmentUrlsJson = Array.isArray(screenshotUrls) && screenshotUrls.length > 0
    ? JSON.stringify(screenshotUrls)
    : null;
  console.log(`[feedback/messages] ticket_id=${id} | Supabase screenshot_urls:`, screenshotUrls, "| attachment_urls_json:", attachmentUrlsJson);

  // Read messages from SQLite
  const messages = getMessagesByTicketId(id);

  // Fallback: if no SQLite messages yet, synthesise from Supabase ticket row
  if (messages.length === 0) {
    const fallback = {
      id: `${id}-0`,
      ticket_id: id,
      sender_role: "farmer" as const,
      sender_user_id: (ticket.user_id as string) ?? "",
      sender_email: (ticket.user_email as string) ?? "",
      message_text: (ticket.message as string) ?? "",
      created_at: (ticket.created_at as string) ?? new Date().toISOString(),
      is_visible_to_farmer: 1,
      attachment_urls: attachmentUrlsJson,
    };
    console.log(`[feedback/messages] fallback — attachment_urls:`, fallback.attachment_urls);
    return c.json({ success: true, data: [fallback] });
  }

  // For SQLite messages: override the first farmer message's attachment_urls with Supabase
  // screenshot_urls as the canonical source of truth (SQLite may lag or be missing)
  const enriched = messages.map((m, idx) => {
    if (idx === 0 && m.sender_role === "farmer") {
      // Prefer Supabase data; fall back to whatever SQLite has
      const canonical = attachmentUrlsJson ?? m.attachment_urls ?? null;
      console.log(`[feedback/messages] msg[0] farmer | attachment_urls (canonical):`, canonical);
      return { ...m, attachment_urls: canonical };
    }
    return m;
  });

  console.log(`[feedback/messages] admin fetch ticket_id=${id} → ${enriched.length} message(s) from SQLite`);
  return c.json({ success: true, data: enriched });
});

// POST /api/feedback/:id/reply — admin send reply to user
feedbackRouter.post("/:id/reply", async (c) => {
  const t0 = Date.now();
  const authHeader = c.req.header("Authorization");
  const ticketId = c.req.param("id");
  console.log("[feedback/reply] route hit — ticket_id:", ticketId, "| auth_header_present:", !!authHeader);

  const { userId, email, error: authError } = await verifyJwt(authHeader);
  console.log("[feedback/reply] verifyJwt — userId:", userId, "| email:", email, "| authError:", authError, "| elapsed:", Date.now() - t0, "ms");

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  const id = ticketId;
  console.log("[feedback/reply] auth ok — ticket_id:", id, "| admin_user_id:", userId, "| admin_email:", email);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON" }, 400);
  }

  const replySchema = z.object({ reply_text: z.string().min(1) });
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "reply_text is required" }, 400);
  }
  console.log("[feedback/reply] reply_text length:", parsed.data.reply_text.length, "| ticket_id:", id);

  // Fetch the feedback row — use supabaseFetch to bypass Vibecode proxy
  const ticketEndpointUrl = `${SUPABASE_URL}/rest/v1/feedback?id=eq.${encodeURIComponent(id)}&limit=1`;
  console.log("[feedback/reply] fetching ticket from:", ticketEndpointUrl);
  const fetchCtrl = new AbortController();
  const fetchTimer = setTimeout(() => fetchCtrl.abort(), 8000);
  let ticket: Record<string, unknown>;
  try {
    const fetchResp = await supabaseFetch(ticketEndpointUrl, {
      signal: fetchCtrl.signal,
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    console.log("[feedback/reply] ticket fetch status:", fetchResp.status, "| elapsed:", Date.now() - t0, "ms");
    if (!fetchResp.ok) {
      const errBody = await fetchResp.text();
      console.warn("[feedback/reply] ticket fetch failed — status:", fetchResp.status, "| body:", errBody);
      return c.json({ success: false, error: "Failed to fetch ticket" }, 500);
    }
    const rows = (await fetchResp.json()) as Record<string, unknown>[];
    if (!rows[0]) {
      console.warn("[feedback/reply] ticket not found — id:", id);
      return c.json({ success: false, error: "Ticket not found" }, 404);
    }
    ticket = rows[0];
  } catch (err) {
    console.warn("[feedback/reply] ticket fetch threw — ticket_id:", id, "| error:", err instanceof Error ? err.message : String(err));
    return c.json({ success: false, error: "Failed to fetch ticket" }, 500);
  } finally {
    clearTimeout(fetchTimer);
  }

  const ticketUserId = ticket.user_id as string | null;

  const now = new Date().toISOString();

  // Ensure ticket exists in local SQLite before inserting messages (FK constraint on support_messages)
  const localTicketExists = checkLocalTicketExists(id);
  console.log("[feedback/reply] local ticket exists:", localTicketExists, "| ticket_id:", id);
  if (!localTicketExists) {
    try {
      upsertLocalTicket({
        id,
        user_id: ticketUserId ?? "",
        user_email: (ticket.user_email as string) ?? "",
        subject: `${(ticket.category as string) ?? "general"} Support`,
        category: (ticket.category as string) ?? "general",
        message: (ticket.message as string) ?? "",
        status: (ticket.status as string) ?? "open",
        created_at: (ticket.created_at as string) ?? now,
        updated_at: now,
      });
      console.log("[feedback/reply] local ticket upserted — ticket_id:", id);
    } catch (upsertErr) {
      console.warn("[feedback/reply] local ticket upsert failed (non-fatal) — ticket_id:", id, "| error:", upsertErr instanceof Error ? upsertErr.message : String(upsertErr));
    }
  }

  const adminMessage = {
    id: `${Date.now()}-admin`,
    ticket_id: id,
    sender_role: "admin" as const,
    sender_user_id: userId,
    sender_email: email,
    message_text: parsed.data.reply_text,
    created_at: now,
    is_visible_to_farmer: 1,
    attachment_urls: null,
  };

  // Save to SQLite — this is the primary store; success here means the reply is confirmed
  try {
    const existing = getMessagesByTicketId(id);
    if (existing.length === 0) {
      const originalMessage = ticket.message as string | null;
      const originalCreatedAt = ticket.created_at as string | null;
      if (originalMessage && originalCreatedAt) {
        insertMessage({
          id: `${id}-0`,
          ticket_id: id,
          sender_role: "farmer",
          sender_user_id: ticketUserId ?? "",
          sender_email: (ticket.user_email as string) ?? "",
          message_text: originalMessage,
          created_at: originalCreatedAt,
          is_visible_to_farmer: 1,
          attachment_urls: (ticket.screenshot_urls as string[] | null)?.length
            ? JSON.stringify(ticket.screenshot_urls)
            : null,
        });
        console.log("[feedback/reply] seeded original farmer message — ticket_id:", id);
      }
    }
    insertMessage(adminMessage);
    console.log("[feedback/reply] admin message saved to SQLite — id:", adminMessage.id, "| ticket_id:", id, "| elapsed:", Date.now() - t0, "ms");
  } catch (dbErr) {
    const dbErrMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.warn("[feedback/reply] SQLite insert failed — ticket_id:", id, "| db_error:", dbErrMsg);
    return c.json({ success: false, error: "Failed to save reply", detail: dbErrMsg }, 500);
  }

  // Background: patch ticket status + send notifications — non-blocking so reply is confirmed instantly
  queueMicrotask(() => {
    const patchCtrl = new AbortController();
    const patchTimer = setTimeout(() => patchCtrl.abort(), 8000);
    supabaseFetch(
      `${SUPABASE_URL}/rest/v1/feedback?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        signal: patchCtrl.signal,
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ status: "read", handled_by: email, handled_at: now }),
      }
    ).then(async (patchResp) => {
      clearTimeout(patchTimer);
      if (!patchResp.ok) {
        const errText = await patchResp.text();
        console.warn("[feedback/reply] status patch failed (non-fatal) — ticket_id:", id, "| status:", patchResp.status, "| body:", errText);
      } else {
        console.log("[feedback/reply] status patched to 'read' — ticket_id:", id);
      }
    }).catch((err: unknown) => {
      clearTimeout(patchTimer);
      console.warn("[feedback/reply] status patch threw (non-fatal) — ticket_id:", id, "| error:", err instanceof Error ? err.message : String(err));
    });

    if (ticketUserId) {
      void insertAlert({
        user_id: ticketUserId,
        title: "Support Team Replied",
        body: parsed.data.reply_text,
        action_route: null,
        action_params: null,
      });
      void sendPushToUser(ticketUserId, "Support Team Replied", parsed.data.reply_text);
    }
  });

  console.log("[feedback/reply] Success — ticket_id:", id, "| admin_user_id:", userId, "| message_id:", adminMessage.id, "| total elapsed:", Date.now() - t0, "ms");
  return c.json({ success: true, adminMessage });
});

// DELETE /api/feedback/:id — admin permanently delete a ticket + its messages
feedbackRouter.delete("/:id", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, email, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }

  const id = c.req.param("id");

  // Delete from Supabase
  const deleteResp = await fetch(
    `${SUPABASE_URL}/rest/v1/feedback?id=eq.${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Prefer: "return=minimal",
      },
    }
  );

  if (!deleteResp.ok) {
    const errText = await deleteResp.text();
    console.error("[feedback] Delete failed:", deleteResp.status, errText);
    return c.json({ success: false, error: "Failed to delete ticket" }, 500);
  }

  // Delete all associated messages from SQLite
  try {
    deleteMessagesByTicketId(id);
  } catch (dbErr) {
    console.error("[feedback] Failed to delete SQLite messages for ticket:", id, dbErr);
    // Non-fatal — ticket is already gone from Supabase
  }

  console.log("[feedback] Deleted ticket:", id, "by admin:", email);
  return c.json({ success: true });
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
