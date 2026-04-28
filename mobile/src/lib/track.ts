/**
 * PostHog analytics helper — safe fire-and-forget wrapper.
 *
 * Usage:
 *   import { trackEvent } from '@/lib/track';
 *   trackEvent('farmstand_card_tapped', { farmstand_id: id, source: 'explore' });
 *
 * Rules:
 * - Never throws or rejects — wraps posthog.capture in try/catch.
 * - Strips undefined/null values from properties before sending.
 * - Never include passwords, message text, ticket text, claim notes, or full phone/email.
 */

import { posthog } from '@/lib/posthog';
import type { PostHogEventProperties } from '@posthog/core';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const APP_VERSION: string =
  (Constants.expoConfig?.version as string | undefined) ?? 'unknown';

const PLATFORM: string = Platform.OS;

export function trackEvent(
  eventName: string,
  properties?: Record<string, string | number | boolean | null | undefined>
): void {
  try {
    const payload: PostHogEventProperties = {
      platform: PLATFORM,
      app_version: APP_VERSION,
    };
    if (properties) {
      for (const [k, v] of Object.entries(properties)) {
        if (v !== undefined && v !== null) payload[k] = v;
      }
    }
    posthog.capture(eventName, payload);
  } catch {
    // Never crash the app for analytics
  }
}
