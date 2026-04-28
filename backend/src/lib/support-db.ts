/**
 * Support Messages — local SQLite store (bun:sqlite)
 *
 * Stores the full message thread for each support ticket.
 * Ticket metadata lives in Supabase (feedback table).
 * Messages live here so both admin and customer read from one source of truth.
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DB_PATH = path.join(__dirname, "..", "..", "data", "support.db");

const db = new Database(DB_PATH);

// support_tickets must exist before support_messages (which has a FK reference to it)
db.exec(`
  CREATE TABLE IF NOT EXISTS support_tickets (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    user_email      TEXT NOT NULL DEFAULT '',
    subject         TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'general',
    message         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'open',
    rating          INTEGER,
    screenshot_urls TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS support_messages (
    id                  TEXT    PRIMARY KEY,
    ticket_id           TEXT    NOT NULL,
    sender_role         TEXT    NOT NULL DEFAULT 'farmer',
    sender_user_id      TEXT    NOT NULL DEFAULT '',
    sender_email        TEXT    NOT NULL DEFAULT '',
    message_text        TEXT    NOT NULL,
    created_at          TEXT    NOT NULL,
    is_visible_to_farmer INTEGER NOT NULL DEFAULT 1
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_ticket_id ON support_messages(ticket_id)`);

// Add is_read_by_user column if it doesn't exist yet (idempotent migration)
try {
  db.exec(`ALTER TABLE support_messages ADD COLUMN is_read_by_user INTEGER NOT NULL DEFAULT 0`);
  console.log("[SupportDB] Added is_read_by_user column to support_messages");
} catch {
  // Column already exists — that's fine
}

// Add attachment_urls column if it doesn't exist yet (idempotent migration)
// Stored as a JSON string, e.g. '["https://cdn.example.com/img1.jpg"]'
try {
  db.exec(`ALTER TABLE support_messages ADD COLUMN attachment_urls TEXT`);
  console.log("[SupportDB] Added attachment_urls column to support_messages");
} catch {
  // Column already exists — that's fine
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_role: "farmer" | "admin";
  sender_user_id: string;
  sender_email: string;
  message_text: string;
  created_at: string;
  is_visible_to_farmer: number;
  /** JSON-encoded string array of image URLs, e.g. '["https://..."]'. Null when no attachments. */
  attachment_urls: string | null;
}

export interface LocalTicket {
  id: string;
  user_id: string;
  user_email: string;
  subject: string;
  category: string;
  message: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Return true if a ticket row exists in the local SQLite support_tickets table. */
export function checkLocalTicketExists(ticketId: string): boolean {
  const row = db.prepare(`SELECT id FROM support_tickets WHERE id = ?`).get(ticketId) as { id: string } | undefined;
  return !!row;
}

/** Insert a minimal ticket row into local SQLite (INSERT OR IGNORE — safe to call multiple times). */
export function upsertLocalTicket(ticket: LocalTicket): void {
  db.prepare(
    `INSERT OR IGNORE INTO support_tickets
       (id, user_id, user_email, subject, category, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ticket.id,
    ticket.user_id,
    ticket.user_email,
    ticket.subject,
    ticket.category,
    ticket.message,
    ticket.status,
    ticket.created_at,
    ticket.updated_at,
  );
  console.log(`[SupportDB] Upserted local ticket ${ticket.id} (category: ${ticket.category})`);
}

/** Insert a new message into the thread. */
export function insertMessage(msg: SupportMessage): void {
  try {
    db.prepare(
      `INSERT OR IGNORE INTO support_messages
         (id, ticket_id, sender_role, sender_user_id, sender_email, message_text, created_at, is_visible_to_farmer, is_read_by_user, attachment_urls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      msg.id,
      msg.ticket_id,
      msg.sender_role,
      msg.sender_user_id,
      msg.sender_email,
      msg.message_text,
      msg.created_at,
      msg.is_visible_to_farmer,
      msg.sender_role === "farmer" ? 1 : 0,
      msg.attachment_urls ?? null,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // If optional columns (is_read_by_user, attachment_urls) were never migrated,
    // fall back to the base columns that are guaranteed to exist.
    if (errMsg.includes("no column named")) {
      console.warn(`[SupportDB] Full INSERT failed (${errMsg}) — retrying with base columns only`);
      db.prepare(
        `INSERT OR IGNORE INTO support_messages
           (id, ticket_id, sender_role, sender_user_id, sender_email, message_text, created_at, is_visible_to_farmer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        msg.id,
        msg.ticket_id,
        msg.sender_role,
        msg.sender_user_id,
        msg.sender_email,
        msg.message_text,
        msg.created_at,
        msg.is_visible_to_farmer,
      );
      console.log(`[SupportDB] Inserted message ${msg.id} via base columns (ticket: ${msg.ticket_id}, role: ${msg.sender_role})`);
      return;
    }
    throw err;
  }
  console.log(`[SupportDB] Inserted message ${msg.id} for ticket ${msg.ticket_id} (${msg.sender_role})`);
}

/** Return all messages for a ticket, oldest first. */
export function getMessagesByTicketId(ticketId: string): SupportMessage[] {
  return db
    .prepare(
      `SELECT id, ticket_id, sender_role, sender_user_id, sender_email, message_text, created_at, is_visible_to_farmer, attachment_urls
         FROM support_messages
        WHERE ticket_id = ?
        ORDER BY created_at ASC`
    )
    .all(ticketId) as SupportMessage[];
}

/** Return count of unread admin messages across a list of ticket IDs. */
export function getUnreadAdminReplyCount(ticketIds: string[]): number {
  if (ticketIds.length === 0) return 0;
  // UUIDs from our own Supabase — safe to interpolate directly
  const inClause = ticketIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM support_messages
        WHERE ticket_id IN (${inClause})
          AND sender_role = 'admin'
          AND is_read_by_user = 0`
    )
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

/** Mark all admin messages in a ticket as read by the user. */
export function markTicketMessagesRead(ticketId: string): void {
  db.prepare(
    `UPDATE support_messages SET is_read_by_user = 1
      WHERE ticket_id = ? AND sender_role = 'admin' AND is_read_by_user = 0`
  ).run(ticketId);
  console.log(`[SupportDB] Marked admin messages read for ticket ${ticketId}`);
}

/** Delete all messages for a ticket (called when deleting a ticket). */
export function deleteMessagesByTicketId(ticketId: string): void {
  db.prepare(`DELETE FROM support_messages WHERE ticket_id = ?`).run(ticketId);
  console.log(`[SupportDB] Deleted all messages for ticket ${ticketId}`);
}
