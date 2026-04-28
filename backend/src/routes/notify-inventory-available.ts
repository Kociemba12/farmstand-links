import { Hono } from "hono";
import { z } from "zod";
import { sendPushToUsers } from "../lib/push-sender";

/**
 * Notify Inventory Available Push Route
 *
 * Called by the farmstand owner's app after an inventory item becomes available
 * (quantity transitions from 0 to > 0, or a new item is created with qty > 0).
 *
 * Logic:
 * - Only sends a push if previous_quantity <= 0 AND new_quantity > 0
 * - Notifies all users who saved/favorited the farmstand (user_saved_farmstands)
 * - Excludes the owner (JWT user) from the recipients
 * - Logs who was targeted and whether delivery succeeded
 */

export const notifyInventoryAvailableRouter = new Hono();

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const schema = z.object({
  farmstand_id: z.string().uuid(),
  farmstand_name: z.string().min(1),
  inventory_item_id: z.string(),
  item_name: z.string().min(1),
  /** Quantity before the edit (0 for brand-new items) */
  previous_quantity: z.number(),
  /** Quantity after the edit */
  new_quantity: z.number(),
  /** True when this is a brand-new inventory row, false when editing existing */
  is_new_item: z.boolean(),
});

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

/** Look up all user_ids who have saved/favorited this farmstand */
async function getFollowerUserIds(farmstandId: string): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/user_saved_farmstands`);
    url.searchParams.set("select", "user_id");
    url.searchParams.set("farmstand_id", `eq.${farmstandId}`);

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!response.ok) {
      console.log(
        "[InventoryPush] user_saved_farmstands query failed:",
        response.status
      );
      return [];
    }

    const rows = (await response.json()) as Array<{ user_id: string }>;
    const ids = rows.map((r) => r.user_id).filter(Boolean);
    console.log(
      `[InventoryPush] Found ${ids.length} follower(s) for farmstand ${farmstandId}`
    );
    return ids;
  } catch (err) {
    console.log("[InventoryPush] Exception fetching followers:", err);
    return [];
  }
}

notifyInventoryAvailableRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: parsed.error.issues[0]?.message || "Invalid request",
      },
      400
    );
  }

  const {
    farmstand_id,
    farmstand_name,
    inventory_item_id,
    item_name,
    previous_quantity,
    new_quantity,
    is_new_item,
  } = parsed.data;

  // Gate: only notify on 0 → positive quantity transitions
  const wasUnavailable = previous_quantity <= 0;
  const isNowAvailable = new_quantity > 0;

  if (!wasUnavailable || !isNowAvailable) {
    console.log(
      `[InventoryPush] Skipping notification for item "${item_name}" (${inventory_item_id}): ` +
        `previous_qty=${previous_quantity}, new_qty=${new_quantity}, is_new=${is_new_item} — no availability transition`
    );
    return c.json({ success: true, sent: 0, reason: "no_transition" });
  }

  // Fetch followers, exclude the owner
  const followerIds = await getFollowerUserIds(farmstand_id);
  const targetIds = followerIds.filter((id) => id !== userId);

  console.log(
    `[InventoryPush] Item "${item_name}" (${inventory_item_id}) at "${farmstand_name}" (${farmstand_id}) ` +
      `became available (prev=${previous_quantity} → new=${new_quantity}, is_new=${is_new_item}). ` +
      `Owner=${userId}, total_followers=${followerIds.length}, notifying=${targetIds.length} user(s): [${targetIds.join(", ")}]`
  );

  if (targetIds.length === 0) {
    console.log(
      "[InventoryPush] No followers to notify (either none or all excluded as owner)."
    );
    return c.json({ success: true, sent: 0, reason: "no_followers" });
  }

  // Craft message: "now available" for new items, "back in stock" for restocks
  const notifTitle = farmstand_name;
  const notifBody = is_new_item
    ? `${item_name} is now available at ${farmstand_name}`
    : `${item_name} is back in stock at ${farmstand_name}`;

  console.log(
    `[InventoryPush] Sending push: title="${notifTitle}", body="${notifBody}"`
  );

  // Non-blocking fan-out — push failure must not block the inventory save
  sendPushToUsers(targetIds, notifTitle, notifBody, {
    type: "inventory_available",
    farmstandId: farmstand_id,
    inventoryItemId: inventory_item_id,
  })
    .then(() => {
      console.log(
        `[InventoryPush] Push delivery complete for "${item_name}" to ${targetIds.length} user(s)`
      );
    })
    .catch((err) => {
      console.log("[InventoryPush] Push delivery error (non-fatal):", err);
    });

  return c.json({ success: true, sent: targetIds.length });
});
