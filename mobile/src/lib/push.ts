// src/lib/push.ts
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import * as Application from "expo-application";
import { supabase, isSupabaseConfigured } from "./supabase";

function getProjectId(): string | undefined {
  // Works for modern Expo + EAS builds
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ||
    (Constants as any)?.easConfig?.projectId
  );
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
  try {
    // First check if record exists for this user_id + device_id combination
    const { data: existing } = await supabase
      .from<{ id: string; user_id: string; expo_push_token: string; device_id: string | null }>("push_tokens")
      .select("*")
      .eq("user_id", userId)
      .execute();

    if (existing && existing.length > 0) {
      // Update existing record
      const { error } = await supabase
        .from("push_tokens")
        .update({
          expo_push_token: expoPushToken,
          platform: platform,
          device_id: deviceId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .execute();

      if (error) {
        console.log("[Push] Error updating push_tokens:", error.message);
      } else {
        console.log("[Push] Updated push_tokens for user:", userId);
      }
    } else {
      // Insert new record
      const { error } = await supabase
        .from("push_tokens")
        .insert({
          user_id: userId,
          expo_push_token: expoPushToken,
          platform: platform,
          device_id: deviceId,
        })
        .execute();

      if (error) {
        console.log("[Push] Error inserting push_tokens:", error.message);
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

    // iOS needs a real device for push tokens
    const isPhysicalDevice = (Constants as any)?.isDevice ?? true;
    if (!isPhysicalDevice) {
      console.log("[Push] Not a physical device, skipping");
      return;
    }

    // Ask permission
    const perm = await Notifications.getPermissionsAsync();
    let finalStatus = perm.status;

    if (finalStatus !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      finalStatus = req.status;
    }

    if (finalStatus !== "granted") {
      console.log("[Push] Permission not granted");
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
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    const expoPushToken = tokenResponse.data;

    if (!expoPushToken) {
      console.log("[Push] No token received");
      return;
    }

    // Get stable device ID
    const deviceId = await getDeviceId();
    const platform = Platform.OS;

    // Save to push_tokens table (as requested)
    await upsertToPushTokens(userId, expoPushToken, platform, deviceId);

    // Also save to device_push_tokens table (existing behavior)
    const { data: existingTokens } = await supabase
      .from<{ id: string; user_id: string; expo_push_token: string }>("device_push_tokens")
      .select("*")
      .eq("user_id", userId)
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
        .eq("user_id", userId)
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
          user_id: userId,
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
