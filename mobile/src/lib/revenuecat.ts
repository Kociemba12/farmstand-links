/**
 * RevenueCat initialization and helpers.
 *
 * Called once on app startup from _layout.tsx.
 * The iOS SDK key is read from EXPO_PUBLIC_REVENUECAT_API_KEY.
 *
 * All callers must check isRevenueCatReady() before calling any Purchases method.
 * This prevents crashes when the native module is not configured or not linked
 * (e.g. Expo Go preview, missing API key, or non-native environments).
 */

import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { Platform } from 'react-native';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

// Tracks whether configure() succeeded and it is safe to call Purchases methods.
let _rcReady = false;

/** Returns true only if RevenueCat was successfully configured this session. */
export function isRevenueCatReady(): boolean {
  return _rcReady;
}

/** Initialize RevenueCat SDK. Call once on app startup. Safe to call multiple times. */
export function initRevenueCat(): void {
  // Guard: only run on native iOS/Android — skip silently on web/other
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.log('[RevenueCat] Skipping init — non-native platform:', Platform.OS);
    return;
  }

  // Guard: native module must actually exist (not available in Expo Go)
  try {
    if (!Purchases || typeof Purchases.configure !== 'function') {
      console.warn('[RevenueCat] Native module not available (Expo Go or not linked)');
      return;
    }
  } catch (e) {
    console.warn('[RevenueCat] Native module check threw — not available:', e);
    return;
  }

  if (!IOS_KEY) {
    console.warn('[RevenueCat] EXPO_PUBLIC_REVENUECAT_API_KEY is not set — purchases unavailable');
    return;
  }

  // Install a custom log handler so RevenueCat SDK messages never reach console.error.
  // Done here (inside initRevenueCat) rather than at module level so it never runs
  // before native modules are ready — avoids a potential SIGABRT on first launch.
  try {
    Purchases.setLogHandler((level, message) => {
      if (level === LOG_LEVEL.ERROR || level === LOG_LEVEL.WARN) {
        console.warn('[RevenueCat]', message);
      } else if (level === LOG_LEVEL.INFO) {
        console.log('[RevenueCat]', message);
      }
      // DEBUG / VERBOSE — suppress entirely to keep logs clean
    });
  } catch {
    // setLogHandler not available (e.g. native module not linked) — safe to ignore
  }

  try {
    Purchases.configure({ apiKey: IOS_KEY });
    _rcReady = true;
    console.log('[RevenueCat] Initialized successfully');
  } catch (e) {
    console.warn('[RevenueCat] configure() threw — purchases unavailable:', e);
  }
}

/**
 * Prepares RevenueCat for a purchase attempt on this device.
 *
 * - On web / non-native: returns { ok: false, reason: 'non-native' }.
 * - On native iOS/Android: performs a lazy init if RC was not yet ready,
 *   then returns { ok: true } if ready, or { ok: false, reason: 'rc-not-initialized' }
 *   if configure() failed (e.g. missing API key or native module issue).
 *
 * Call this at the start of every purchase / restore flow instead of checking
 * isRevenueCatReady() directly. It handles the lazy-init recovery case so that
 * transient startup failures do not permanently block purchases.
 */
export function prepareForPurchase(): { ok: boolean; reason?: 'non-native' | 'rc-not-initialized' } {
  console.log('[RC:prepareForPurchase] Platform.OS:', Platform.OS, '| rcReady:', _rcReady);
  console.log('[RC:prepareForPurchase] isNativeIOS:', Platform.OS === 'ios');

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.log('[RC:prepareForPurchase] Non-native platform — purchases not supported in this environment');
    return { ok: false, reason: 'non-native' };
  }

  // On native: attempt a lazy re-init if startup init was skipped or threw.
  if (!_rcReady) {
    console.log('[RC:prepareForPurchase] RC not ready at tap time — attempting lazy init');
    initRevenueCat();
    console.log('[RC:prepareForPurchase] RC ready after lazy init:', _rcReady);
  }

  if (!_rcReady) {
    console.warn(
      '[RC:prepareForPurchase] RC still not ready after lazy init.',
      'EXPO_PUBLIC_REVENUECAT_API_KEY may be missing or Purchases.configure() threw.',
      'IOS_KEY set:', !!IOS_KEY,
    );
    return { ok: false, reason: 'rc-not-initialized' };
  }

  console.log('[RC:prepareForPurchase] Ready — proceeding with purchase on native iOS');
  return { ok: true };
}

/** Identify the logged-in user with RevenueCat. No-op if not ready. */
export async function identifyRevenueCatUser(userId: string): Promise<void> {
  if (!_rcReady) return;
  try {
    await Purchases.logIn(userId);
    console.log('[RevenueCat] User identified:', userId);
  } catch (e) {
    console.warn('[RevenueCat] Failed to identify user:', e);
  }
}

/** Log out the RevenueCat user (call on sign out). No-op if not ready. */
export async function logOutRevenueCatUser(): Promise<void> {
  if (!_rcReady) return;
  try {
    await Purchases.logOut();
    console.log('[RevenueCat] User logged out');
  } catch (e) {
    console.warn('[RevenueCat] Failed to log out user:', e);
  }
}
