import { Hono } from "hono";
import {
  markConversationRead as markConvRead,
  getAllReadsForUser,
} from "../message-reads-db";
import {
  hideThread as localHideThread,
  getHiddenThreadsForUser as getLocalHiddenThreads,
  unhideThread as localUnhideThread,
} from "../hidden-threads-db";

/**
 * Messages Route
 *
 * Uses the Supabase SERVICE ROLE KEY to bypass RLS so both the sender
 * and receiver can read messages in a thread.
 *
 * Endpoints:
 *   GET /api/messages/thread?farmstand_id=X&other_user_id=Y
 *     Returns all messages between the authenticated user and other_user
 *     for the given farmstand, ordered created_at ASC.
 *
 *   GET /api/messages/inbox
 *     Returns grouped conversation summaries for the authenticated user
 *     (one entry per (farmstand_id, other_user_id)), filtered by hidden threads.
 *
 *   POST /api/messages/hide-thread
 *     Marks a thread as hidden for the current user only.
 *     Body: { farmstand_id, other_user_id }
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

// ─── JWT verification ─────────────────────────────────────────────────────────

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
        apikey: SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!resp.ok) return { userId: null, error: "Invalid session" };
    const data = (await resp.json()) as { id?: string };
    return data?.id
      ? { userId: data.id, error: null }
      : { userId: null, error: "No user ID in token" };
  } catch {
    return { userId: null, error: "Failed to verify session" };
  }
}

// ─── Supabase fetch helper (service role) ────────────────────────────────────

async function supabaseFetch(path: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

async function supabasePost(path: string, body: unknown, prefer?: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function supabaseDelete(path: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
}

// ─── Hidden-thread helpers ────────────────────────────────────────────────────
// Thread key format: `${farmstand_id}__${other_user_id}` (per-user perspective).
// All hides are written to both SQLite (for orphaned threads with no conversations
// row) and Supabase (for threads that have a conversations row). On read, both
// sources are merged so deleted farmstand threads stay hidden even after app
// reinstall / AsyncStorage clear.

type HiddenEntry = { hiddenAt: string; conversationId: string };

async function getHiddenThreadMap(userId: string): Promise<Map<string, HiddenEntry>> {
  const result = new Map<string, HiddenEntry>();

  // Layer 1: SQLite — always-available, covers orphaned threads with no conversations row.
  // This is the source of truth for threads deleted from the inbox.
  try {
    const localHidden = getLocalHiddenThreads(userId);
    console.log(`[HiddenThreads] SQLite: ${localHidden.length} hidden thread(s) for userId=${userId}`);
    for (const h of localHidden) {
      const key = `${h.farmstand_id}__${h.other_user_id}`;
      result.set(key, { hiddenAt: h.hidden_at, conversationId: "" });
      console.log(`[HiddenThreads] SQLite entry: key=${key} hiddenAt=${h.hidden_at}`);
    }
  } catch (err) {
    console.log("[HiddenThreads] SQLite read error:", err);
  }

  // Layer 2: Supabase hidden_threads — for threads that also have a conversations row.
  // Merge with SQLite results; prefer the earlier (more conservative) hiddenAt.
  try {
    const hiddenRes = await supabaseFetch(
      `hidden_threads?user_id=eq.${userId}&select=thread_id,created_at`
    );
    if (!hiddenRes.ok) return result;
    type HiddenRow = { thread_id: string; created_at: string };
    const hiddenRows = (await hiddenRes.json()) as HiddenRow[];
    if (hiddenRows.length > 0) {
      const threadIds = hiddenRows.map((h) => h.thread_id).join(",");
      const convRes = await supabaseFetch(
        `conversations?id=in.(${threadIds})&select=id,farmstand_id,customer_id,owner_id`
      );
      if (convRes.ok) {
        type ConvRow = { id: string; farmstand_id: string; customer_id: string; owner_id: string };
        const convRows = (await convRes.json()) as ConvRow[];
        const hiddenAtMap = new Map(hiddenRows.map((h) => [h.thread_id, h.created_at]));
        for (const conv of convRows) {
          const otherUserId = conv.customer_id === userId ? conv.owner_id : conv.customer_id;
          const key = `${conv.farmstand_id}__${otherUserId}`;
          const hiddenAt = hiddenAtMap.get(conv.id) ?? new Date().toISOString();
          const existing = result.get(key);
          if (!existing || new Date(hiddenAt).getTime() < new Date(existing.hiddenAt).getTime()) {
            result.set(key, { hiddenAt, conversationId: conv.id });
            console.log(`[HiddenThreads] Supabase entry: key=${key} hiddenAt=${hiddenAt} conversationId=${conv.id}`);
          }
        }
      }
    }
  } catch (err) {
    console.log("[HiddenThreads] Supabase read error:", err);
  }

  return result;
}

// Persist a hide to both SQLite (always) and Supabase (if a conversations row exists).
// SQLite guarantees the hide survives even for orphaned threads that have no conversations row.
async function persistHideThread(userId: string, farmstandId: string, otherUserId: string): Promise<void> {
  // Always write to SQLite first — this is the durable fallback for orphaned threads.
  localHideThread(userId, farmstandId, otherUserId);
  console.log(`[HiddenThreads] persisted to SQLite: userId=${userId} farmstandId=${farmstandId} otherUserId=${otherUserId}`);

  // Also try Supabase — requires a conversations row.
  const orFilter = encodeURIComponent(
    `(and(customer_id.eq.${userId},owner_id.eq.${otherUserId}),and(customer_id.eq.${otherUserId},owner_id.eq.${userId}))`
  );
  const convRes = await supabaseFetch(
    `conversations?farmstand_id=eq.${farmstandId}&or=${orFilter}&select=id,owner_id,customer_id&limit=1`
  );
  if (!convRes.ok) {
    console.log(`[HiddenThreads] Supabase conv lookup failed for farmstand=${farmstandId} — SQLite-only hide`);
    return;
  }
  type ConvLookupRow = { id: string; owner_id: string; customer_id: string };
  const rows = (await convRes.json()) as Array<ConvLookupRow>;
  const conv = rows[0];
  const conversationId = conv?.id;
  if (!conversationId) {
    console.log(`[HiddenThreads] no conversations row for farmstand=${farmstandId} userId=${userId} otherUserId=${otherUserId} — SQLite-only hide (orphaned thread)`);
    return;
  }

  // Insert into hidden_threads (for backward-compat unread-count filter)
  const res = await supabasePost(
    "hidden_threads",
    { user_id: userId, thread_id: conversationId },
    "resolution=ignore-duplicates"
  );
  if (!res.ok) {
    const text = await res.text();
    console.log(`[HiddenThreads] Supabase hidden_threads insert error ${res.status}:`, text.slice(0, 200));
  } else {
    console.log(`[HiddenThreads] persisted to Supabase hidden_threads: userId=${userId} conversationId=${conversationId}`);
  }

  // Also soft-delete the conversations row so deletion persists through reinstall.
  // Determine if userId is owner or customer, then set the correct column.
  const isOwner = conv.owner_id === userId;
  const patchCol = isOwner ? "deleted_by_owner_at" : "deleted_by_customer_at";
  const deletedAt = new Date().toISOString();
  console.log(`[HiddenThreads] setting ${patchCol} on conversations row: userId=${userId} conversationId=${conversationId} role=${isOwner ? "owner" : "customer"} deletedAt=${deletedAt}`);
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/conversations?id=eq.${conversationId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ [patchCol]: deletedAt }),
  });
  if (!patchRes.ok) {
    const text = await patchRes.text();
    console.log(`[HiddenThreads] conversations PATCH failed ${patchRes.status}:`, text.slice(0, 200));
  } else {
    console.log(`[HiddenThreads] ${patchCol} set for conversationId=${conversationId}`);
  }
}

// Clear a hide from both SQLite and Supabase (used for auto-unhide on new message).
// farmstandId + otherUserId identify the SQLite record; conversationId identifies the Supabase record.
async function clearHiddenThread(
  userId: string,
  farmstandId: string,
  otherUserId: string,
  conversationId?: string
): Promise<void> {
  try {
    localUnhideThread(userId, farmstandId, otherUserId);
    if (conversationId) {
      await supabaseDelete(`hidden_threads?user_id=eq.${userId}&thread_id=eq.${conversationId}`);
      console.log(`[HiddenThreads] cleared from Supabase: userId=${userId} conversationId=${conversationId}`);
    }
    console.log(`[HiddenThreads] cleared hide: userId=${userId} farmstandId=${farmstandId} otherUserId=${otherUserId}`);
  } catch (err) {
    console.log("[HiddenThreads] clearHiddenThread error:", err);
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const messagesRouter = new Hono();

// GET /api/messages/thread?farmstand_id=X&other_user_id=Y
messagesRouter.get("/thread", async (c) => {
  const { userId, error } = await verifyJwt(c.req.header("Authorization"));
  if (!userId || error) return c.json({ error: error ?? "Unauthorized" }, 401);

  const farmstand_id = c.req.query("farmstand_id");
  const other_user_id = c.req.query("other_user_id");

  if (!farmstand_id || !other_user_id) {
    return c.json({ error: "farmstand_id and other_user_id are required" }, 400);
  }

  console.log(
    `[messages/thread] currentUserId=${userId} otherUserId=${other_user_id} farmstandId=${farmstand_id}`
  );

  // Bidirectional filter: messages sent by currentUser to other OR other to currentUser
  const orFilter = encodeURIComponent(
    `(and(sender_id.eq.${userId},receiver_id.eq.${other_user_id}),and(sender_id.eq.${other_user_id},receiver_id.eq.${userId}))`
  );
  const res = await supabaseFetch(
    `messages?farmstand_id=eq.${farmstand_id}&or=${orFilter}&order=created_at.asc&select=*`
  );

  if (!res.ok) {
    const text = await res.text();
    console.log(`[messages/thread] Supabase error ${res.status}:`, text.slice(0, 300));
    return c.json({ error: "Failed to fetch messages" }, 500);
  }

  const messages = await res.json();
  console.log(`[messages/thread] returned ${(messages as unknown[]).length} messages`);
  return c.json({ messages });
});

// GET /api/messages/inbox
messagesRouter.get("/inbox", async (c) => {
  const { userId, error } = await verifyJwt(c.req.header("Authorization"));
  if (!userId || error) return c.json({ error: error ?? "Unauthorized" }, 401);

  console.log(`[messages/inbox] loading for userId=${userId}`);

  // All messages where user is sender or receiver, newest first
  const orFilter = encodeURIComponent(
    `(sender_id.eq.${userId},receiver_id.eq.${userId})`
  );
  const res = await supabaseFetch(
    `messages?or=${orFilter}&order=created_at.desc&select=*`
  );

  if (!res.ok) {
    const text = await res.text();
    console.log(`[messages/inbox] Supabase error ${res.status}:`, text.slice(0, 300));
    return c.json({ error: "Failed to fetch inbox" }, 500);
  }

  type MsgRow = {
    id: string;
    sender_id: string;
    receiver_id: string;
    farmstand_id: string;
    body: string;
    created_at: string;
  };

  const allMessages = (await res.json()) as MsgRow[];
  console.log(`[messages/inbox] userId=${userId} totalMessages=${allMessages.length}`);

  // Group by (farmstand_id, other_user_id) — keep first (latest) entry per pair
  const seenConversations = new Set<string>();
  const summaries: Array<{
    farmstand_id: string;
    other_user_id: string;
    last_message_text: string;
    last_message_at: string;
    farmstand_name?: string;
    farmstand_photo_url?: string | null;
    farmstand_deleted?: boolean;
    other_user_name?: string | null;
    other_user_avatar_url?: string | null;
    viewer_is_owner: boolean;
  }> = [];

  for (const msg of allMessages) {
    const otherUserId = msg.sender_id === userId ? msg.receiver_id : msg.sender_id;
    const convKey = `${msg.farmstand_id}__${otherUserId}`;
    if (!seenConversations.has(convKey)) {
      seenConversations.add(convKey);
      summaries.push({
        farmstand_id: msg.farmstand_id,
        other_user_id: otherUserId,
        last_message_text: msg.body,
        last_message_at: msg.created_at,
        viewer_is_owner: false,
      });
      // [LOG] thread source: all inbox threads are derived from messages (no conversations table used)
      console.log(`[messages/inbox] thread derived-from-messages: threadKey=${convKey} lastMsgAt=${msg.created_at}`);
    }
  }

  // ── Filter hidden threads ─────────────────────────────────────────────────
  const hiddenEntryMap = await getHiddenThreadMap(userId);
  console.log(`[messages/inbox] userId=${userId} has ${hiddenEntryMap.size} hidden thread(s)`);

  // Pre-fetch deleted_at for farmstands involved in hidden threads.
  const deletedFarmstandIds = new Set<string>();
  const hiddenFarmstandIds = [...new Set([...hiddenEntryMap.keys()].map((k) => k.split("__")[0]).filter((id): id is string => !!id))];
  if (hiddenFarmstandIds.length > 0) {
    try {
      const delRes = await supabaseFetch(
        `farmstands?id=in.(${hiddenFarmstandIds.join(",")})&select=id,deleted_at`
      );
      if (delRes.ok) {
        type DelRow = { id: string; deleted_at: string | null };
        const rows = (await delRes.json()) as DelRow[];
        const foundIds = new Set(rows.map((r) => r.id));
        for (const row of rows) {
          if (row.deleted_at) deletedFarmstandIds.add(row.id);
        }
        for (const fid of hiddenFarmstandIds) {
          if (!foundIds.has(fid)) deletedFarmstandIds.add(fid);
        }
      }
      console.log(
        `[messages/inbox] deletedFarmstandIds among hidden: ${[...deletedFarmstandIds].join(", ") || "none"}`
      );
    } catch {
      for (const fid of hiddenFarmstandIds) deletedFarmstandIds.add(fid);
    }
  }

  const visibleSummaries = summaries.filter((s) => {
    const key = `${s.farmstand_id}__${s.other_user_id}`;
    const entry = hiddenEntryMap.get(key);
    const isHidden = !!entry;
    console.log(`[messages/inbox] filter threadKey=${key} isHidden=${isHidden} hiddenAt=${entry?.hiddenAt ?? "n/a"} conversationId=${entry?.conversationId || "none(orphaned)"}`);

    if (!entry) {
      // Not hidden — include in inbox
      return true;
    }

    // Deleted-farmstand threads are permanently hidden — never auto-unhide
    if (deletedFarmstandIds.has(s.farmstand_id)) {
      console.log(
        `[messages/inbox] FILTER-OUT permanently hidden (deleted farmstand) threadKey=${key}`
      );
      return false;
    }

    // Auto-unhide: if a new message arrived after the thread was hidden, surface it
    if (new Date(s.last_message_at).getTime() > new Date(entry.hiddenAt).getTime()) {
      console.log(
        `[messages/inbox] FILTER-IN auto-unhiding threadKey=${key} reason=new-message-after-hidden lastMsgAt=${s.last_message_at} hiddenAt=${entry.hiddenAt}`
      );
      void clearHiddenThread(userId, s.farmstand_id, s.other_user_id, entry.conversationId || undefined);
      return true;
    }

    console.log(`[messages/inbox] FILTER-OUT threadKey=${key} reason=user-deleted hiddenAt=${entry.hiddenAt}`);
    return false;
  });

  // Determine which farmstands the current user owns (via farmstand_owners table)
  if (visibleSummaries.length > 0) {
    const farmstandIds = [...new Set(visibleSummaries.map((s) => s.farmstand_id))].join(",");
    try {
      const ownerRes = await supabaseFetch(
        `farmstand_owners?user_id=eq.${userId}&farmstand_id=in.(${farmstandIds})&select=farmstand_id`
      );
      if (ownerRes.ok) {
        type OwnerRow = { farmstand_id: string };
        const rows = (await ownerRes.json()) as OwnerRow[];
        const ownedIds = new Set(rows.map((r) => r.farmstand_id));
        for (const s of visibleSummaries) {
          s.viewer_is_owner = ownedIds.has(s.farmstand_id);
        }
      }
    } catch {
      // non-fatal — viewer_is_owner stays false
    }
  }

  // Enrich summaries with farmstand name + photo
  if (visibleSummaries.length > 0) {
    const ids = visibleSummaries.map((s) => s.farmstand_id).join(",");
    try {
      const fsRes = await supabaseFetch(
        `farmstands?id=in.(${ids})&select=id,name,photos,photo_url,deleted_at`
      );
      if (fsRes.ok) {
        type FsRow = { id: string; name: string; photos?: string[] | null; photo_url?: string | null; deleted_at?: string | null };
        const farmstands = (await fsRes.json()) as FsRow[];
        const fsMap = new Map(farmstands.map((f) => [f.id, f]));
        for (const s of visibleSummaries) {
          const fs = fsMap.get(s.farmstand_id);
          if (fs) {
            s.farmstand_name = fs.name;
            s.farmstand_photo_url = fs.photos?.[0] ?? fs.photo_url ?? null;
            s.farmstand_deleted = !!fs.deleted_at;
          } else {
            // Farmstand row missing entirely — treat as deleted
            s.farmstand_deleted = true;
          }
        }
      }
    } catch {
      // non-fatal — summaries still returned without farmstand details
    }
  }

  // Enrich summaries with other user's profile (name + avatar)
  if (visibleSummaries.length > 0) {
    const otherUserIds = [...new Set(visibleSummaries.map((s) => s.other_user_id))].join(",");
    try {
      const profilesRes = await supabaseFetch(
        `profiles?uid=in.(${otherUserIds})&select=uid,full_name,avatar_url`
      );
      if (profilesRes.ok) {
        type ProfileRow = { uid: string; full_name: string | null; avatar_url: string | null };
        const profiles = (await profilesRes.json()) as ProfileRow[];
        const profileMap = new Map(profiles.map((p) => [p.uid, p]));
        for (const s of visibleSummaries) {
          const profile = profileMap.get(s.other_user_id);
          if (profile) {
            s.other_user_name = profile.full_name;
            s.other_user_avatar_url = profile.avatar_url;
          }
        }
      }
    } catch {
      // non-fatal — summaries still returned without other user profile
    }
  }

  console.log(
    `[messages/inbox] found ${visibleSummaries.length} conversation(s) for userId=${userId}`
  );

  // ── Compute per-conversation unread counts ────────────────────────────────
  // Use message_reads.db (same source of truth as unread-count endpoint) to
  // determine which conversations have unread messages for this user.
  const reads = getAllReadsForUser(userId);
  const readMap = new Map(
    reads.map((r) => [`${r.farmstand_id}__${r.other_user_id}`, r.last_read_at])
  );

  const conversationsWithUnread = visibleSummaries.map((s) => {
    const lastReadAt = readMap.get(`${s.farmstand_id}__${s.other_user_id}`) ?? null;
    const readTime = lastReadAt ? new Date(lastReadAt).getTime() : 0;
    // Count received messages newer than last_read_at for this conversation.
    // Use Date comparison — Supabase timestamps use "+00:00" with microseconds,
    // SQLite stores "Z" with milliseconds; string comparison is unreliable.
    const unread_count = allMessages.filter(
      (msg) =>
        msg.farmstand_id === s.farmstand_id &&
        msg.sender_id === s.other_user_id &&
        msg.receiver_id === userId &&
        new Date(msg.created_at).getTime() > readTime
    ).length;
    console.log(
      `[messages/inbox] conv farmstandId=${s.farmstand_id} otherUserId=${s.other_user_id}` +
      ` lastReadAt=${lastReadAt ?? "never"} unread_count=${unread_count}`
    );
    return { ...s, unread_count };
  });

  return c.json({ conversations: conversationsWithUnread });
});

// POST /api/messages/hide-thread
// Body: { farmstand_id: string; other_user_id: string }
messagesRouter.post("/hide-thread", async (c) => {
  const { userId, error } = await verifyJwt(c.req.header("Authorization"));
  if (!userId || error) return c.json({ error: error ?? "Unauthorized" }, 401);

  let body: { farmstand_id?: string; other_user_id?: string };
  try {
    body = await c.req.json() as { farmstand_id?: string; other_user_id?: string };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { farmstand_id, other_user_id } = body;
  if (!farmstand_id || !other_user_id) {
    return c.json({ error: "farmstand_id and other_user_id are required" }, 400);
  }

  console.log(
    `[messages/hide-thread] currentUserId=${userId} farmstandId=${farmstand_id} otherUserId=${other_user_id}`
  );

  await persistHideThread(userId, farmstand_id, other_user_id);

  console.log(`[messages/hide-thread] hidden row inserted successfully for userId=${userId}`);

  return c.json({ success: true });
});

// GET /api/messages/unread-count
// Returns number of UNREAD CONVERSATIONS for the authenticated user.
// A conversation is unread if any received message has created_at newer than
// last_read_at for that (farmstand_id, other_user_id) pair in message_reads.db.
// Hidden threads are excluded so the badge matches the visible inbox.
// Badge = number of unread conversations, NOT total unread message rows.
messagesRouter.get("/unread-count", async (c) => {
  const { userId, error } = await verifyJwt(c.req.header("Authorization"));
  if (!userId || error) return c.json({ error: error ?? "Unauthorized" }, 401);

  let unreadMessageRows = 0;
  let unreadCount = 0;

  try {
    // Fetch all messages received by this user (sender_id != userId guaranteed
    // by receiver_id filter since you can't message yourself)
    const res = await supabaseFetch(
      `messages?receiver_id=eq.${userId}&select=id,sender_id,farmstand_id,created_at&order=created_at.asc`
    );
    if (res.ok) {
      type MsgRow = { id: string; sender_id: string; farmstand_id: string; created_at: string };
      const messages = (await res.json()) as MsgRow[];

      // Build a set of hidden thread keys (farmstand_id__other_user_id) to exclude.
      const hiddenThreadMap = await getHiddenThreadMap(userId);
      const hiddenKeys = new Set<string>(hiddenThreadMap.keys());

      // Auto-unhide: if any received message arrived after the thread was hidden, resurface it.
      const latestReceivedAt = new Map<string, string>();
      for (const msg of messages) {
        const key = `${msg.farmstand_id}__${msg.sender_id}`;
        const existing = latestReceivedAt.get(key);
        if (!existing || msg.created_at > existing) latestReceivedAt.set(key, msg.created_at);
      }
      const autoUnhiddenKeys = new Set<string>();
      for (const [key, entry] of hiddenThreadMap) {
        const latest = latestReceivedAt.get(key);
        if (latest && new Date(latest).getTime() > new Date(entry.hiddenAt).getTime()) {
          const [fsId, otherUid] = key.split("__");
          void clearHiddenThread(userId, fsId ?? "", otherUid ?? "", entry.conversationId || undefined);
          autoUnhiddenKeys.add(key);
          console.log(`[messages/unread-count] auto-unhiding key=${key}`);
        }
      }
      const effectiveHiddenKeys = autoUnhiddenKeys.size > 0
        ? new Set([...hiddenKeys].filter(k => !autoUnhiddenKeys.has(k)))
        : hiddenKeys;

      // Build a map of last-read timestamps per conversation
      const reads = getAllReadsForUser(userId);
      const readMap = new Map(
        reads.map((r) => [`${r.farmstand_id}__${r.other_user_id}`, r.last_read_at])
      );

      // Identify unread conversations (unique farmstand+sender pairs with ≥1 unread message)
      // Exclude hidden threads so badge matches visible inbox.
      const unreadConversationKeys = new Set<string>();
      for (const msg of messages) {
        const key = `${msg.farmstand_id}__${msg.sender_id}`;
        // Skip messages from threads the user has hidden
        if (effectiveHiddenKeys.has(key)) continue;
        const lastReadAt = readMap.get(key) ?? null;
        // Use proper Date comparison — Supabase timestamps are "+00:00" format with
        // microseconds while SQLite stores "Z" format with milliseconds. String
        // comparison is unreliable between these two formats.
        const msgTime = new Date(msg.created_at).getTime();
        const readTime = lastReadAt ? new Date(lastReadAt).getTime() : 0;
        if (msgTime > readTime) {
          unreadMessageRows++;
          unreadConversationKeys.add(key);
        }
      }

      // Badge = number of unread conversations, not individual message rows
      unreadCount = unreadConversationKeys.size;

      console.log(
        `[messages/unread-count] userId=${userId}` +
        ` unreadMessageRows=${unreadMessageRows}` +
        ` unreadConversations=${unreadCount}` +
        ` totalMessagesReceived=${messages.length}` +
        ` hiddenThreads=${hiddenKeys.size}`
      );
    }
  } catch (err) {
    console.log("[messages/unread-count] error:", err);
  }

  return c.json({ unreadCount });
});

// POST /api/messages/send
// Backend-gated message send — validates farmstand is not deleted before inserting.
// Body: { farmstand_id: string; receiver_id: string; message_body: string }
messagesRouter.post("/send", async (c) => {
  const { userId, error } = await verifyJwt(c.req.header("Authorization"));
  if (!userId || error) return c.json({ error: error ?? "Unauthorized" }, 401);

  let body: { farmstand_id?: string; receiver_id?: string; message_body?: string };
  try {
    body = (await c.req.json()) as { farmstand_id?: string; receiver_id?: string; message_body?: string };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { farmstand_id, receiver_id, message_body } = body;
  if (!farmstand_id || !receiver_id || !message_body?.trim()) {
    return c.json({ error: "farmstand_id, receiver_id, and message_body are required" }, 400);
  }

  // ── Guard: block messages to deleted farmstands ──────────────────────────
  const fsCheckRes = await supabaseFetch(
    `farmstands?id=eq.${farmstand_id}&select=id,deleted_at&limit=1`
  );
  if (!fsCheckRes.ok) {
    console.log(`[messages/send] farmstand lookup failed status=${fsCheckRes.status}`);
    return c.json({ error: "Failed to verify farmstand status" }, 500);
  }
  type FsCheck = { id: string; deleted_at: string | null };
  const fsRows = (await fsCheckRes.json()) as FsCheck[];
  const farmstand = fsRows[0];
  if (!farmstand) {
    console.log(`[messages/send] farmstand not found id=${farmstand_id}`);
    return c.json({ error: "Farmstand not found" }, 404);
  }
  if (farmstand.deleted_at) {
    console.log(`[messages/send] BLOCKED — farmstand deleted id=${farmstand_id} deleted_at=${farmstand.deleted_at}`);
    return c.json({ error: "This Farmstand has been deleted. Messages can no longer be sent.", farmstand_deleted: true }, 403);
  }

  // ── Insert message via service role ──────────────────────────────────────
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      sender_id: userId,
      receiver_id,
      farmstand_id,
      body: message_body.trim(),
      created_at: new Date().toISOString(),
    }),
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    console.log(`[messages/send] Supabase insert failed status=${insertRes.status}:`, errText.slice(0, 300));
    return c.json({ error: "Failed to send message" }, 500);
  }

  type MsgRow = { id: string; sender_id: string; receiver_id: string; farmstand_id: string; body: string; created_at: string };
  const rows = (await insertRes.json()) as MsgRow[];
  const inserted = rows[0] ?? null;

  // Auto-unhide: if the sender previously hid this thread, remove the hidden row now
  // so the thread reappears in their inbox and unread-count is immediately accurate.
  try {
    const orFilter = encodeURIComponent(
      `(and(customer_id.eq.${userId},owner_id.eq.${receiver_id}),and(customer_id.eq.${receiver_id},owner_id.eq.${userId}))`
    );
    const convRes = await supabaseFetch(
      `conversations?farmstand_id=eq.${farmstand_id}&or=${orFilter}&select=id&limit=1`
    );
    if (convRes.ok) {
      const convRows = (await convRes.json()) as Array<{ id: string }>;
      const convId = convRows[0]?.id;
      await clearHiddenThread(userId, farmstand_id, receiver_id, convId || undefined);
    }
  } catch { /* non-fatal */ }

  console.log(`[messages/send] SUCCESS id=${inserted?.id} sender=${userId} receiver=${receiver_id} farmstand=${farmstand_id}`);
  return c.json({ message: inserted }, 201);
});

// POST /api/messages/mark-read
// Marks all messages in a conversation as read for the authenticated user.
// Body: { farmstand_id: string; other_user_id: string }
messagesRouter.post("/mark-read", async (c) => {
  const { userId, error } = await verifyJwt(c.req.header("Authorization"));
  if (!userId || error) return c.json({ error: error ?? "Unauthorized" }, 401);

  let body: { farmstand_id?: string; other_user_id?: string };
  try {
    body = (await c.req.json()) as { farmstand_id?: string; other_user_id?: string };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { farmstand_id, other_user_id } = body;
  if (!farmstand_id || !other_user_id) {
    return c.json({ error: "farmstand_id and other_user_id are required" }, 400);
  }

  markConvRead(userId, farmstand_id, other_user_id);

  console.log(
    `[messages/mark-read] userId=${userId} farmstandId=${farmstand_id} otherUserId=${other_user_id}`
  );
  return c.json({ success: true });
});
