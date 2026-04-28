import { Hono } from "hono";
import { z } from "zod";
import { sendSupportTicketEmail } from "../lib/admin-email";
import { insertMessage, getMessagesByTicketId, getUnreadAdminReplyCount, markTicketMessagesRead, type SupportMessage as DbMessage } from "../lib/support-db";

/**
 * Support Tickets Route — Supabase-backed via feedback table
 *
 * Tickets ARE feedback rows where source_screen = 'support'.
 * Soft-delete sets source_screen = 'support_dismissed'.
 * Thread messages are stored as JSON in the admin_notes column.
 *
 * Status mapping (feedback.status → SupportTicket.status):
 *   'new'      → 'open'
 *   'read'     → 'waiting_on_admin'
 *   'resolved' → 'resolved'
 *
 * POST   /api/support-tickets            — create ticket
 * GET    /api/support-tickets            — list user's active tickets
 * GET    /api/support-tickets/:id        — single ticket
 * DELETE /api/support-tickets/:id        — soft delete
 * GET    /api/support-tickets/:id/messages  — thread messages
 * POST   /api/support-tickets/:id/messages  — send reply
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// ── Auth ───────────────────────────────────────────────────────────────────
interface SupabaseUser { id?: string; email?: string; }

async function verifyJwt(authHeader: string | undefined): Promise<{ userId: string | null; email: string | null; error: string | null }> {
  if (!authHeader?.startsWith("Bearer ")) {
    return { userId: null, email: null, error: "Missing Authorization header" };
  }
  const token = authHeader.replace("Bearer ", "");
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!resp.ok) return { userId: null, email: null, error: "Invalid session" };
    const data = (await resp.json()) as SupabaseUser;
    if (!data?.id) return { userId: null, email: null, error: "No user ID in token" };
    return { userId: data.id, email: data.email ?? null, error: null };
  } catch {
    return { userId: null, email: null, error: "Failed to verify session" };
  }
}

// ── Supabase REST helpers ──────────────────────────────────────────────────
const sbHeaders = (extra?: Record<string, string>) => ({
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  apikey: SUPABASE_SERVICE_KEY,
  "Content-Type": "application/json",
  ...extra,
});

async function sbSelect(filter: string): Promise<{ rows: FeedbackRow[] | null; error: string | null }> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/feedback?${filter}`, {
    headers: sbHeaders(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("[support] SELECT error:", resp.status, text);
    if (text.includes("does not exist") || text.includes("schema cache")) {
      return { rows: null, error: "feedback_table_missing" };
    }
    return { rows: null, error: `Supabase error ${resp.status}` };
  }
  const rows = (await resp.json()) as FeedbackRow[];
  return { rows, error: null };
}

async function sbInsert(row: Record<string, unknown>): Promise<{ row: FeedbackRow | null; error: string | null }> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("[support] INSERT error:", resp.status, text);
    if (text.includes("does not exist") || text.includes("schema cache")) {
      return { row: null, error: "feedback_table_missing" };
    }
    return { row: null, error: `Supabase insert failed (${resp.status})` };
  }
  const rows = (await resp.json()) as FeedbackRow[];
  return { row: rows[0] ?? null, error: null };
}

async function sbPatch(filter: string, update: Record<string, unknown>): Promise<{ ok: boolean; error: string | null }> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/feedback?${filter}`, {
    method: "PATCH",
    headers: sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(update),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("[support] PATCH error:", resp.status, text);
    return { ok: false, error: `Supabase patch failed (${resp.status})` };
  }
  return { ok: true, error: null };
}

// ── Types ──────────────────────────────────────────────────────────────────
interface FeedbackRow {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  rating: number | null;
  category: string;
  message: string;
  status: string;
  source_screen: string;
  screenshot_urls: string[] | null;
  handled_by: string | null;
  handled_at: string | null;
  admin_notes: string | null;
  created_at: string;
}

const STATUS_MAP: Record<string, string> = {
  new: "open",
  read: "waiting_on_admin",
  resolved: "resolved",
};

function toTicket(row: FeedbackRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    user_email: row.user_email,
    subject: row.category ? `${row.category} Support` : "Support Request",
    category: row.category,
    message: row.message,
    status: STATUS_MAP[row.status] ?? "open",
    rating: row.rating ?? null,
    screenshot_urls: row.screenshot_urls ? JSON.stringify(row.screenshot_urls) : null,
    created_at: row.created_at,
    updated_at: row.handled_at ?? row.created_at,
    deleted_at: null,
  };
}

// ── Router ─────────────────────────────────────────────────────────────────
export const supportRouter = new Hono();

// POST /api/support-tickets
supportRouter.post("/", async (c) => {
  const { userId, email, error: authError } = await verifyJwt(c.req.header("Authorization"));
  if (authError || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);

  console.log(`[support] POST /api/support-tickets hit — userId=${userId}`);

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: "Invalid JSON" }, 400); }

  const schema = z.object({
    subject: z.string().min(1).max(200).optional(),
    category: z.string().min(1),
    message: z.string().min(1),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    screenshot_urls: z.array(z.string()).max(5).nullable().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: parsed.error.issues[0]?.message ?? "Invalid data" }, 400);

  const { category, message, rating, screenshot_urls } = parsed.data;

  const { row, error } = await sbInsert({
    user_id: userId,
    user_email: email ?? "",
    category,
    message,
    status: "new",
    source_screen: "support",
    rating: rating ?? null,
    screenshot_urls: screenshot_urls ?? null,
  });

  if (error || !row) {
    if (error === "feedback_table_missing") {
      return c.json({ success: false, error: "feedback_table_missing" }, 503);
    }
    return c.json({ success: false, error: error ?? "Failed to create ticket" }, 500);
  }

  // Insert the initial message into SQLite support_messages
  try {
    insertMessage({
      id: `${row.id}-0`,
      ticket_id: row.id,
      sender_role: "farmer",
      sender_user_id: userId,
      sender_email: email ?? "",
      message_text: message,
      created_at: row.created_at,
      is_visible_to_farmer: 1,
      // Persist any uploaded screenshot URLs alongside the initial message
      attachment_urls: screenshot_urls && screenshot_urls.length > 0
        ? JSON.stringify(screenshot_urls)
        : null,
    });
  } catch (dbErr) {
    console.error("[support] Failed to insert initial message into SQLite:", dbErr);
  }

  console.log(`[support] Created ticket ${row.id} for user ${userId} (Supabase feedback table)`);
  void sendSupportTicketEmail({
    ticketId: row.id,
    category: row.category ?? null,
    message: row.message ?? null,
    userEmail: email ?? null,
    userId,
    screenshotUrls: row.screenshot_urls ?? null,
    submittedAt: row.created_at ?? null,
  });
  return c.json({ success: true, data: toTicket(row) });
});

// GET /api/support-tickets
supportRouter.get("/", async (c) => {
  const { userId, error: authError } = await verifyJwt(c.req.header("Authorization"));
  if (authError || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);

  const filter = `user_id=eq.${encodeURIComponent(userId)}&source_screen=eq.support&order=created_at.desc&limit=100`;
  const { rows, error } = await sbSelect(filter);

  if (error || !rows) {
    return c.json({ success: false, error: error ?? "Failed to fetch tickets" }, 500);
  }

  console.log(`[support] Fetched ${rows.length} ticket(s) for user ${userId} from Supabase:`, rows.map(r => r.id));
  return c.json({ success: true, data: rows.map(toTicket) });
});

// GET /api/support-tickets/unread-count — count of unread admin replies for the user
// IMPORTANT: Must be registered BEFORE /:id or Hono will match "unread-count" as an id param
supportRouter.get("/unread-count", async (c) => {
  const { userId, error: authError } = await verifyJwt(c.req.header("Authorization"));
  if (authError || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);

  // Fetch the user's active ticket IDs from Supabase
  const { rows, error } = await sbSelect(
    `user_id=eq.${encodeURIComponent(userId)}&source_screen=eq.support&select=id`
  );
  if (error) return c.json({ success: false, error }, 500);

  const ticketIds = (rows ?? []).map((r) => r.id);
  const count = getUnreadAdminReplyCount(ticketIds);

  console.log(`[support/unread-count] userId=${userId} ticketIds=${ticketIds.length} unread=${count}`);
  return c.json({ success: true, count });
});

// GET /api/support-tickets/:id
supportRouter.get("/:id", async (c) => {
  const { userId, error: authError } = await verifyJwt(c.req.header("Authorization"));
  if (authError || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const filter = `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&source_screen=eq.support`;
  const { rows, error } = await sbSelect(filter);

  if (error) return c.json({ success: false, error }, 500);
  if (!rows || rows.length === 0) return c.json({ success: false, error: "Ticket not found" }, 404);

  return c.json({ success: true, data: toTicket(rows[0]!) });
});

// DELETE /api/support-tickets/:id — soft delete via source_screen change
supportRouter.delete("/:id", async (c) => {
  const { userId, error: authError } = await verifyJwt(c.req.header("Authorization"));
  if (authError || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  // Verify ownership
  const { rows } = await sbSelect(
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&source_screen=eq.support`
  );
  if (!rows || rows.length === 0) {
    console.warn(`[support] Delete failed — ticket ${id} not found for user ${userId}`);
    return c.json({ success: false, error: "Ticket not found or not authorized" }, 404);
  }

  const { ok, error } = await sbPatch(
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { source_screen: "support_dismissed" }
  );

  if (!ok) return c.json({ success: false, error: error ?? "Failed to delete ticket" }, 500);

  console.log(`[support] Soft-deleted ticket ${id} for user ${userId} in Supabase`);
  return c.json({ success: true });
});

// GET /api/support-tickets/:id/messages
supportRouter.get("/:id/messages", async (c) => {
  const { userId, error: authError } = await verifyJwt(c.req.header("Authorization"));
  if (authError || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  // Verify ticket belongs to user
  const { rows, error } = await sbSelect(
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&source_screen=eq.support`
  );

  if (error) return c.json({ success: false, error }, 500);
  if (!rows || rows.length === 0) return c.json({ success: false, error: "Ticket not found" }, 404);

  // Read messages from SQLite
  const messages = getMessagesByTicketId(id);

  // If no messages in SQLite yet (e.g. ticket created before migration), fall back to the original message
  if (messages.length === 0) {
    const row = rows[0]!;
    const fallback: DbMessage = {
      id: `${row.id}-0`,
      ticket_id: row.id,
      sender_role: "farmer",
      sender_user_id: row.user_id,
      sender_email: row.user_email,
      message_text: row.message,
      created_at: row.created_at,
      is_visible_to_farmer: 1,
      // Include any screenshots stored on the original ticket
      attachment_urls: row.screenshot_urls && row.screenshot_urls.length > 0
        ? JSON.stringify(row.screenshot_urls)
        : null,
    };
    console.log(`[support/messages] ticket_id=${id} userId=${userId} → fallback to original message`);
    return c.json({ success: true, data: [{ ...fallback, attachment_urls: row.screenshot_urls ?? null }] });
  }

  console.log(`[support/messages] ticket_id=${id} userId=${userId} → ${messages.length} message(s) from SQLite`);
  // Parse attachment_urls JSON string back to array before sending to client
  const parsed = messages.map(m => ({
    ...m,
    attachment_urls: m.attachment_urls ? (JSON.parse(m.attachment_urls) as string[]) : null,
  }));
  return c.json({ success: true, data: parsed });
});

// POST /api/support-tickets/:id/messages — farmer reply
supportRouter.post("/:id/messages", async (c) => {
  const { userId, email, error: authError } = await verifyJwt(c.req.header("Authorization"));
  if (authError || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);

  const id = c.req.param("id");
  const { rows, error } = await sbSelect(
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&source_screen=eq.support`
  );

  if (error) return c.json({ success: false, error }, 500);
  if (!rows || rows.length === 0) return c.json({ success: false, error: "Ticket not found" }, 404);

  const row = rows[0]!;

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: "Invalid JSON" }, 400); }

  const schema = z.object({
    message_text: z.string().optional().default(""),
    attachment_urls: z.array(z.string()).max(5).nullable().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: "Invalid message data" }, 400);

  const { message_text, attachment_urls } = parsed.data;
  const hasText = message_text.trim().length > 0;
  const hasImages = Array.isArray(attachment_urls) && attachment_urls.length > 0;
  if (!hasText && !hasImages) {
    return c.json({ success: false, error: "Message text or at least one photo is required" }, 400);
  }

  const now = new Date().toISOString();
  const msgId = `${id}-${Date.now()}`;

  const newMessage: DbMessage = {
    id: msgId,
    ticket_id: id,
    sender_role: "farmer",
    sender_user_id: userId,
    sender_email: email ?? "",
    message_text: message_text,
    created_at: now,
    is_visible_to_farmer: 1,
    attachment_urls: hasImages ? JSON.stringify(attachment_urls) : null,
  };

  // Insert into SQLite
  try {
    insertMessage(newMessage);
  } catch (dbErr) {
    console.error("[support] Failed to insert farmer reply into SQLite:", dbErr);
    return c.json({ success: false, error: "Failed to save message" }, 500);
  }

  // Update ticket status in Supabase (reopen if resolved, else mark waiting on admin)
  const newStatus = row.status === "resolved" ? "new" : "read";
  const { ok, error: patchError } = await sbPatch(
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`,
    { handled_at: now, status: newStatus }
  );

  if (!ok) return c.json({ success: false, error: patchError ?? "Failed to update ticket" }, 500);

  console.log(`[support] Farmer reply saved for ticket ${id} by user ${userId} → SQLite`);
  return c.json({
    success: true,
    data: {
      ...newMessage,
      attachment_urls: hasImages ? attachment_urls : null,
    },
  });
});

// POST /api/support-tickets/:id/mark-read — mark all admin messages in ticket as read
supportRouter.post("/:id/mark-read", async (c) => {
  const { userId, error: authError } = await verifyJwt(c.req.header("Authorization"));
  if (authError || !userId) return c.json({ success: false, error: "Unauthorized" }, 401);

  const id = c.req.param("id");

  // Verify ticket belongs to user
  const { rows, error } = await sbSelect(
    `id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&source_screen=eq.support`
  );
  if (error) return c.json({ success: false, error }, 500);
  if (!rows || rows.length === 0) return c.json({ success: false, error: "Ticket not found" }, 404);

  markTicketMessagesRead(id);
  return c.json({ success: true });
});
