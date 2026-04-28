/**
 * Hidden Message Threads — local SQLite store (bun:sqlite)
 *
 * Persists per-user "hidden" inbox threads so that deleting a thread from
 * the Inbox hides it only for that user, without touching public.messages.
 *
 * Auto-unhide logic lives in the inbox route: if a new message arrives after
 * hidden_at, the hidden row is deleted and the thread resurfaces.
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DB_PATH = path.join(__dirname, "..", "hidden_threads.db");

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS hidden_message_threads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,
    farmstand_id TEXT   NOT NULL,
    other_user_id TEXT  NOT NULL,
    hidden_at   TEXT    NOT NULL,
    UNIQUE(user_id, farmstand_id, other_user_id)
  )
`);

export interface HiddenThread {
  user_id: string;
  farmstand_id: string;
  other_user_id: string;
  hidden_at: string;
}

/** Insert or replace a hidden-thread row for this user. */
export function hideThread(
  userId: string,
  farmstandId: string,
  otherUserId: string
): void {
  db.prepare(
    `INSERT OR REPLACE INTO hidden_message_threads
       (user_id, farmstand_id, other_user_id, hidden_at)
     VALUES (?, ?, ?, ?)`
  ).run(userId, farmstandId, otherUserId, new Date().toISOString());
  console.log(
    `[HiddenThreads] hid thread: userId=${userId} farmstandId=${farmstandId} otherUserId=${otherUserId}`
  );
}

/** Return all hidden threads for a given user. */
export function getHiddenThreadsForUser(userId: string): HiddenThread[] {
  return db
    .prepare(
      `SELECT user_id, farmstand_id, other_user_id, hidden_at
         FROM hidden_message_threads
        WHERE user_id = ?`
    )
    .all(userId) as HiddenThread[];
}

/** Remove the hidden-thread row (auto-unhide when a new message arrives). */
export function unhideThread(
  userId: string,
  farmstandId: string,
  otherUserId: string
): void {
  db.prepare(
    `DELETE FROM hidden_message_threads
      WHERE user_id = ? AND farmstand_id = ? AND other_user_id = ?`
  ).run(userId, farmstandId, otherUserId);
  console.log(
    `[HiddenThreads] auto-unhid thread: userId=${userId} farmstandId=${farmstandId} otherUserId=${otherUserId}`
  );
}
