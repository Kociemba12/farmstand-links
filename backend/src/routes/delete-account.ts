import { Hono } from "hono";
import { z } from "zod";

/**
 * Account Deletion Routes
 *
 * Provides secure, immediate account deletion.
 * Deletes auth user and cleans up related database rows.
 *
 * SECURITY:
 * - Requires valid JWT authorization
 * - Uses service role key for admin operations
 * - Only deletes the authenticated user (no other users)
 */
export const deleteAccountRouter = new Hono();

// Request schema
const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE"), // User must type "DELETE" to confirm
});

// Get Supabase config from environment
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * Verify JWT and extract user ID
 */
async function verifyJwtAndGetUserId(authHeader: string | undefined): Promise<{ userId: string | null; error: string | null }> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { userId: null, error: "Missing or invalid Authorization header" };
  }

  const token = authHeader.replace("Bearer ", "");

  // Verify the JWT with Supabase
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[DeleteAccount] JWT verification failed:", response.status, errorText);
      return { userId: null, error: "Invalid or expired session" };
    }

    const userData = (await response.json()) as { id?: string };
    if (!userData?.id) {
      return { userId: null, error: "Could not extract user ID from session" };
    }

    return { userId: userData.id, error: null };
  } catch (err) {
    console.error("[DeleteAccount] JWT verification error:", err);
    return { userId: null, error: "Failed to verify session" };
  }
}

/**
 * Delete user's related data from database
 */
async function deleteUserData(userId: string): Promise<{ success: boolean; error: string | null }> {
  console.log(`[DeleteAccount] Cleaning up data for user ${userId}`);

  try {
    // 1. Update farmstands owned by user - set owner_user_id to null and mark as unclaimed
    const farmstandsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/farmstands?owner_user_id=eq.${userId}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          owner_user_id: null,
          claimed_by: null,
          claimed_at: null,
          deleted_at: new Date().toISOString(),
        }),
      }
    );

    if (!farmstandsResponse.ok) {
      console.error("[DeleteAccount] Failed to update farmstands:", await farmstandsResponse.text());
      // Continue with other deletions even if this fails
    } else {
      console.log("[DeleteAccount] Farmstands updated (owner_user_id cleared)");
    }

    // 2. Delete user's reviews
    const reviewsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/reviews?user_id=eq.${userId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "return=minimal",
        },
      }
    );

    if (!reviewsResponse.ok) {
      console.error("[DeleteAccount] Failed to delete reviews:", await reviewsResponse.text());
    } else {
      console.log("[DeleteAccount] User reviews deleted");
    }

    // 3. Delete user's favorites/saves
    const favoritesResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/favorites?user_id=eq.${userId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "return=minimal",
        },
      }
    );

    if (!favoritesResponse.ok) {
      console.error("[DeleteAccount] Failed to delete favorites:", await favoritesResponse.text());
    } else {
      console.log("[DeleteAccount] User favorites deleted");
    }

    // 4. Delete user profile from profiles table (if exists)
    const profilesResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "return=minimal",
        },
      }
    );

    if (!profilesResponse.ok) {
      console.error("[DeleteAccount] Failed to delete profile:", await profilesResponse.text());
    } else {
      console.log("[DeleteAccount] User profile deleted");
    }

    // 5. Delete claim requests made by this user
    const claimRequestsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/claim_requests?user_id=eq.${userId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: "return=minimal",
        },
      }
    );

    if (!claimRequestsResponse.ok) {
      console.error("[DeleteAccount] Failed to delete claim requests:", await claimRequestsResponse.text());
    } else {
      console.log("[DeleteAccount] User claim requests deleted");
    }

    console.log("[DeleteAccount] User data cleanup complete");
    return { success: true, error: null };
  } catch (err) {
    console.error("[DeleteAccount] Error cleaning up user data:", err);
    return { success: false, error: "Failed to clean up user data" };
  }
}

/**
 * Delete user from Supabase Auth
 */
async function deleteAuthUser(userId: string): Promise<{ success: boolean; error: string | null }> {
  console.log(`[DeleteAccount] Deleting auth user ${userId}`);

  try {
    // Use Supabase Admin API to delete the user
    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
      {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[DeleteAccount] Failed to delete auth user:", response.status, errorText);
      return { success: false, error: `Failed to delete auth user: ${errorText}` };
    }

    console.log("[DeleteAccount] Auth user deleted successfully");
    return { success: true, error: null };
  } catch (err) {
    console.error("[DeleteAccount] Error deleting auth user:", err);
    return { success: false, error: "Failed to delete auth user" };
  }
}

/**
 * Delete account endpoint
 * POST /api/delete-account
 *
 * Headers:
 *   Authorization: Bearer <access_token>
 *
 * Body:
 *   { "confirmation": "DELETE" }
 *
 * Returns:
 *   { "success": true, "message": "Account deleted." }
 */
deleteAccountRouter.post("/", async (c) => {
  console.log("[DeleteAccount] Account deletion request received");

  // Check if Supabase is configured
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[DeleteAccount] Supabase not configured");
    return c.json({ success: false, error: "Server configuration error" }, 500);
  }

  // Verify JWT and get user ID
  const authHeader = c.req.header("Authorization");
  const { userId, error: authError } = await verifyJwtAndGetUserId(authHeader);

  if (authError || !userId) {
    console.error("[DeleteAccount] Auth error:", authError);
    return c.json({ success: false, error: authError || "Unauthorized" }, 401);
  }

  console.log(`[DeleteAccount] Verified user: ${userId}`);

  // Validate request body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid request body" }, 400);
  }

  const parseResult = deleteAccountSchema.safeParse(body);
  if (!parseResult.success) {
    console.error("[DeleteAccount] Invalid confirmation:", body);
    return c.json({
      success: false,
      error: "Please confirm deletion by sending { \"confirmation\": \"DELETE\" }"
    }, 400);
  }

  console.log("[DeleteAccount] Confirmation verified, proceeding with deletion");

  // Step 1: Clean up user data in database
  const dataResult = await deleteUserData(userId);
  if (!dataResult.success) {
    console.error("[DeleteAccount] Data cleanup failed:", dataResult.error);
    // Continue to delete auth user even if data cleanup fails
  }

  // Step 2: Delete auth user
  const authResult = await deleteAuthUser(userId);
  if (!authResult.success) {
    return c.json({
      success: false,
      error: authResult.error || "Failed to delete account"
    }, 500);
  }

  console.log("[DeleteAccount] Account deletion complete");

  return c.json({
    success: true,
    message: "Account deleted.",
  });
});

/**
 * Health check for delete-account service
 * GET /api/delete-account/health
 */
deleteAccountRouter.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "delete-account",
    hasSupabaseUrl: !!SUPABASE_URL,
    hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
  });
});
