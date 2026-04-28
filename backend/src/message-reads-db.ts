/**
 * Message Reads — local SQLite store (bun:sqlite)
 *
 * Tracks the last time each user read a conversation thread, allowing
 * the unread-count endpoint to return accurate badge counts without
 * requiring an is_read column in the Supabase messages table.
 *
 * A conversation is identified by (user_id, farmstand_id, other_user_id).
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DB_PATH = path.join(__dirname, "..", "message_reads.db");

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS message_reads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       TEXT    NOT NULL,
    farmstand_id  TEXT    NOT NULL,
    other_user_id TEXT    NOT NULL,
    last_read_at  TEXT    NOT NULL,
    UNIQUE(user_id, farmstand_id, other_user_id)
  )
`);

export interface MessageRead {
  user_id: string;
  farmstand_id: string;
  other_user_id: string;
  last_read_at: string;
}

/** Mark a conversation as fully read for a given user (upsert). */
export function markConversationRead(
  userId: string,
  farmstandId: string,
  otherUserId: string
): void {
  db.prepare(
    `INSERT OR REPLACE INTO message_reads
       (user_id, farmstand_id, other_user_id, last_read_at)
     VALUES (?, ?, ?, ?)`
  ).run(userId, farmstandId, otherUserId, new Date().toISOString());
  console.log(
    `[MessageReads] marked read: userId=${userId} farmstandId=${farmstandId} otherUserId=${otherUserId}`
  );
}

/** Return all read records for a given user. */
export function getAllReadsForUser(userId: string): MessageRead[] {
  return db
    .prepare(
      `SELECT user_id, farmstand_id, other_user_id, last_read_at
         FROM message_reads
        WHERE user_id = ?`
    )
    .all(userId) as MessageRead[];
}
