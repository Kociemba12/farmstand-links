// src/lib/push.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as Application from "expo-application";
import { supabase, isSupabaseConfigured, getValidSession } from "./supabase";

function getProjectId(): string | undefined {
  // EAS sets easConfig.projectId at build time — always correct in TestFlight builds
  const easProjectId = (Constants as { easConfig?: { projectId?: string } })?.easConfig?.projectId;

  // app.json value — skip if it's still the template placeholder
  const appJsonProjectId = (Constants as any)?.expoConfig?.extra?.eas?.projectId as string | undefined;
  const validAppJsonId =
    appJsonProjectId && !appJsonProjectId.startsWith('YOUR_') && !appJsonProjectId.includes('_PROJECT_ID')
      ? appJsonProjectId
      : undefined;

  return easProjectId ?? validAppJsonId;
}

/**
 * Get a stable device ID for this device
 * Uses native device identifiers when available
 */
async function getDeviceId(): Promise<string | null> {
  try {
    if (Platform.OS === "ios") {
      // iOS: Use identifierForVendor (stable per vendor)
      return Application.getIosIdForVendorAsync();
    } else if (Platform.OS === "android") {
      // Android: Use androidId (stable across app installs)
      return Application.getAndroidId();
    }
    return null;
  } catch (e) {
    console.log("[Push] Error getting device ID:", e);
    return null;
  }
}

/**
 * Register push token to public.push_tokens table
 * Uses upsert to create or update the token
 */
async function upsertToPushTokens(
  userId: string,
  expoPushToken: string,
  platform: string,
  deviceId: string | null
): Promise<void> {
  const payload = {
    user_id: userId,
    expo_push_token: expoPushToken,
    platform,
    device_id: deviceId,
    updated_at: new Date().toISOString(),
  };
  console.log("[PushDebug][upsertToPushTokens] upsert payload:", JSON.stringify(payload));

  try {
    // Check for existing row first
    const { data: existing, error: selectError } = await supabase
      .from<{ id: string; user_id: string; expo_push_token: string; device_id: string | null }>("push_tokens")
      .requireAuth()
      .select("*")
      .eq("user_id", userId)
      .execute();

    console.log("[PushDebug][upsertToPushTokens] existing rows:", existing?.length ?? 0, "selectError:", selectError ? JSON.stringify(selectError) : "none");

    if (existing && existing.length > 0) {
      const { data: updateData, error: updateError } = await supabase
        .from("push_tokens")
        .requireAuth()
        .update({
          expo_push_token: expoPushToken,
          platform: platform,
          device_id: deviceId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .execute();

      console.log("[PushDebug][upsertToPushTokens] UPDATE result — data:", JSON.stringify(updateData), "error:", updateError ? JSON.stringify(updateError) : "none");
      if (updateError) {
        console.log("[Push] Error updating push_tokens:", updateError.message ?? JSON.stringify(updateError));
      } else {
        console.log("[Push] Updated push_tokens for user:", userId);
      }
    } else {
      const { data: insertData, error: insertError } = await supabase
        .from("push_tokens")
        .requireAuth()
        .insert({
          user_id: userId,
          expo_push_token: expoPushToken,
          platform: platform,
          device_id: deviceId,
        })
        .execute();

      console.log("[PushDebug][upsertToPushTokens] INSERT result — data:", JSON.stringify(insertData), "error:", insertError ? JSON.stringify(insertError) : "none");
      if (insertError) {
        console.log("[Push] Error inserting push_tokens:", insertError.message ?? JSON.stringify(insertError));
      } else {
        console.log("[Push] Inserted push_tokens for user:", userId);
      }
    }
  } catch (e) {
    console.log("[Push] Error upserting to push_tokens:", e);
  }
}

/**
 * Register push token for current user
 * Call this after user session becomes active
 * Saves to both device_push_tokens and push_tokens tables
 * @param userId - The authenticated user's ID
 */
export async function registerPushTokenForCurrentUser(userId?: string): Promise<void> {
  try {
    if (!userId) {
      console.log("[Push] No user ID provided, skipping");
      return;
    }

    if (!isSupabaseConfigured()) {
      console.log("[Push] Supabase not configured, skipping");
      return;
    }

    // Verify the live authenticated user ID from the active session
    let liveUserId = userId;
    try {
      const session = await getValidSession();
      if (session?.access_token) {
        // Decode JWT payload to get sub (user ID)
        const parts = session.access_token.split('.');
        if (parts.length === 3) {
          const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
          const jwtPayload = JSON.parse(payloadJson) as { sub?: string };
          if (jwtPayload.sub) {
            if (jwtPayload.sub !== userId) {
              console.log("[PushDebug] JWT user ID differs from passed userId — using JWT sub:", jwtPayload.sub, "passed:", userId);
            } else {
              console.log("[PushDebug] JWT user ID matches passed userId:", jwtPayload.sub);
            }
            liveUserId = jwtPayload.sub;
          }
        }
      } else {
        console.log("[PushDebug] No valid session found — cannot verify live user ID, using passed userId:", userId);
      }
    } catch (jwtErr) {
      console.log("[PushDebug] Could not decode JWT to verify user ID:", jwtErr);
    }
    console.log("[PushDebug] registerPushTokenForCurrentUser — liveUserId:", liveUserId);

    // iOS needs a real device for push tokens
    const isPhysicalDevice = (Constants as any)?.isDevice ?? true;
    if (!isPhysicalDevice) {
      console.log("[Push] Not a physical device, skipping");
      return;
    }

    // Check/request permission
    const perm = await Notifications.getPermissionsAsync();
    let finalStatus = perm.status;
    console.log("[PushDebug] permission status (initial):", finalStatus);

    if (finalStatus !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      finalStatus = req.status;
      console.log("[PushDebug] permission status (after request):", finalStatus);
    }

    if (finalStatus !== "granted") {
      console.log("[Push] Permission not granted — status:", finalStatus);
      return;
    }

    // Android channel (safe no-op on iOS)
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // Get Expo push token
    const projectId = getProjectId();
    console.log("[PushDebug] projectId:", projectId ?? "(not set)");
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    const expoPushToken = tokenResponse.data;
    console.log("[PushDebug] expoPushToken:", expoPushToken ? expoPushToken.substring(0, 40) + "..." : "(null)");

    if (!expoPushToken) {
      console.log("[Push] No token received");
      return;
    }

    // Get stable device ID
    const deviceId = await getDeviceId();
    const platform = Platform.OS;

    // Save to push_tokens table using live auth user ID
    await upsertToPushTokens(liveUserId, expoPushToken, platform, deviceId);

    // Also save to device_push_tokens table (existing behavior)
    const { data: existingTokens } = await supabase
      .from<{ id: string; user_id: string; expo_push_token: string }>("device_push_tokens")
      .requireAuth()
      .select("*")
      .eq("user_id", liveUserId)
      .eq("expo_push_token", expoPushToken)
      .execute();

    if (existingTokens && existingTokens.length > 0) {
      // Update existing token
      const { error } = await supabase
        .from("device_push_tokens")
        .update({
          platform: platform,
          is_enabled: true,
          last_seen_at: new Date().toISOString(),
        })
        .eq("user_id", liveUserId)
        .eq("expo_push_token", expoPushToken)
        .execute();

      if (error) {
        console.log("[Push] Error updating device_push_tokens:", error.message);
        return;
      }
      console.log("[Push] Updated device_push_tokens:", expoPushToken.substring(0, 30) + "...");
    } else {
      // Insert new token
      const { error } = await supabase
        .from("device_push_tokens")
        .insert({
          user_id: liveUserId,
          expo_push_token: expoPushToken,
          platform: platform,
          is_enabled: true,
          last_seen_at: new Date().toISOString(),
        })
        .execute();

      if (error) {
        console.log("[Push] Error saving device_push_tokens:", error.message);
        return;
      }
      console.log("[Push] Saved device_push_tokens:", expoPushToken.substring(0, 30) + "...");
    }
  } catch (e) {
    // keep silent; don't crash app
    console.log("[Push] registerPushTokenForCurrentUser error:", e);
  }
}
