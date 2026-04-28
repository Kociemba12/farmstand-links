import { Hono } from "hono";

/**
 * POST /api/activate-premium
 *
 * Activates a 3-month free trial for a claimed farmstand.
 * Called by the mobile app after a successful RevenueCat purchase/trial start.
 *
 * Security:
 * - Requires a valid Supabase JWT (user must be logged in)
 * - Verifies the user owns the farmstand (owner_id or claimed_by matches userId)
 * - Farmstand must have claim_status='claimed' and not be deleted
 * - Idempotent: if premium is already active, returns success without overwriting
 */

export const activatePremiumRouter = new Hono();

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!resp.ok) return { userId: null, error: "Invalid session" };
    const data = (await resp.json()) as { id?: string };
    if (!data?.id) return { userId: null, error: "No user ID in token" };
    return { userId: data.id, error: null };
  } catch {
    return { userId: null, error: "Failed to verify session" };
  }
}

activatePremiumRouter.post("/", async (c) => {
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwt(authHeader);

  if (authError || !userId) {
    console.log("[ActivatePremium] Auth failed:", authError);
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: { farmstand_id?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const { farmstand_id } = body;
  if (!farmstand_id) {
    return c.json({ success: false, error: "farmstand_id is required" }, 400);
  }

  console.log(
    `[ActivatePremium] Request — userId=${userId} farmstandId=${farmstand_id}`
  );

  // Fetch the farmstand to verify ownership
  const checkResp = await fetch(
    `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${encodeURIComponent(farmstand_id)}&select=id,owner_id,claimed_by,claim_status,premium_status,deleted_at`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!checkResp.ok) {
    console.error(
      "[ActivatePremium] Failed to fetch farmstand:",
      checkResp.status
    );
    return c.json(
      { success: false, error: "Failed to verify farmstand ownership" },
      500
    );
  }

  const farmstands = (await checkResp.json()) as Array<{
    id: string;
    owner_id: string | null;
    claimed_by: string | null;
    claim_status: string;
    premium_status: string;
    deleted_at: string | null;
  }>;

  if (!farmstands.length || !farmstands[0]) {
    return c.json({ success: false, error: "Farmstand not found" }, 404);
  }

  const farmstand = farmstands[0];

  if (farmstand.deleted_at) {
    return c.json({ success: false, error: "Farmstand has been deleted" }, 404);
  }

  const isOwner =
    farmstand.owner_id === userId || farmstand.claimed_by === userId;
  if (!isOwner) {
    console.log(
      `[ActivatePremium] Rejected: userId=${userId} does not own farmstand=${farmstand_id}`
    );
    return c.json(
      { success: false, error: "Forbidden: you do not own this farmstand" },
      403
    );
  }

  if (farmstand.claim_status !== "claimed") {
    return c.json(
      { success: false, error: "Farmstand is not in claimed status" },
      400
    );
  }

  // Idempotent: if premium is already active, return success without overwriting
  if (
    farmstand.premium_status === "trial" ||
    farmstand.premium_status === "active"
  ) {
    console.log(
      `[ActivatePremium] Already premium — farmstandId=${farmstand_id} status=${farmstand.premium_status}`
    );
    return c.json({ success: true, alreadyActive: true });
  }

  // Activate the 3-month free trial
  const now = new Date();
  const trialExpires = new Date(now);
  trialExpires.setMonth(trialExpires.getMonth() + 3);

  const updateResp = await fetch(
    `${SUPABASE_URL}/rest/v1/farmstands?id=eq.${encodeURIComponent(farmstand_id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        premium_status: "trial",
        premium_trial_started_at: now.toISOString(),
        premium_trial_expires_at: trialExpires.toISOString(),
        updated_at: now.toISOString(),
      }),
    }
  );

  if (!updateResp.ok) {
    const errText = await updateResp.text();
    console.error(
      "[ActivatePremium] Failed to update premium status:",
      updateResp.status,
      errText
    );
    return c.json({ success: false, error: "Failed to activate premium" }, 500);
  }

  console.log(
    `[ActivatePremium] Trial activated — userId=${userId} farmstandId=${farmstand_id} expires=${trialExpires.toISOString()}`
  );

  return c.json({
    success: true,
    premiumStatus: "trial",
    premiumTrialStartedAt: now.toISOString(),
    premiumTrialExpiresAt: trialExpires.toISOString(),
  });
});
