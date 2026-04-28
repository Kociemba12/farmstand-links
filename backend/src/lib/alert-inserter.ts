/**
 * Alert Inserter
 *
 * Shared utility for inserting rows into the inbox_alerts table via
 * the Supabase service role key (bypasses RLS so any route can insert
 * alerts for any user).
 *
 * Real inbox_alerts columns used:
 *   user_id, title, body, related_farmstand_id, action_route,
 *   action_params, created_at
 *
 * NOT used: type (CHECK constraint would reject unknown values)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export interface AlertInsertParams {
  user_id: string;
  title: string;
  body: string;
  /** Maps to the related_farmstand_id column */
  related_farmstand_id?: string | null;
  action_route?: string | null;
  action_params?: Record<string, unknown> | null;
}

/**
 * Insert a single alert into inbox_alerts.
 * Non-throwing — logs on failure but never propagates so push routes
 * are not blocked by a DB write error.
 */
export async function insertAlert(params: AlertInsertParams): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log("[AlertInserter] Supabase not configured, skipping alert insert");
    return;
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/inbox_alerts`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        user_id: params.user_id,
        title: params.title,
        body: params.body,
        related_farmstand_id: params.related_farmstand_id ?? null,
        action_route: params.action_route ?? null,
        action_params: params.action_params ?? null,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(
        `[AlertInserter] Failed to insert alert for user ${params.user_id}: ${resp.status} ${errText}`
      );
    } else {
      console.log(`[AlertInserter] Alert inserted for user ${params.user_id} title="${params.title}"`);
    }
  } catch (err) {
    console.log("[AlertInserter] Exception inserting alert (non-fatal):", err);
  }
}

/**
 * Insert alerts for multiple users at once (fan-out).
 * All inserts run in parallel — non-blocking, non-throwing.
 */
export async function insertAlertForUsers(
  userIds: string[],
  params: Omit<AlertInsertParams, "user_id">
): Promise<void> {
  if (userIds.length === 0) return;
  await Promise.all(
    userIds.map((uid) => insertAlert({ ...params, user_id: uid }))
  );
}
