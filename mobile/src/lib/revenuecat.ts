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

// Diagnostic kill-switch. When false, the automatic app-startup configure() call
// is skipped entirely. RevenueCat still lazy-initialises the first time the user
// opens the paywall. Set to false to prevent StoreKit from touching native modules
// during the first few seconds of launch (SIGABRT isolation).
// Flip to true once the startup crash is resolved.
const REVENUECAT_STARTUP_ENABLED = false;

// Tracks whether configure() succeeded and it is safe to call Purchases methods.
let _rcReady = false;
// Idempotent guard — prevents re-running configure() on every hot-reload or double-call.
let _rcInitAttempted = false;

/** Returns true only if RevenueCat was successfully configured this session. */
export function isRevenueCatReady(): boolean {
  return _rcReady;
}

/**
 * Initialize RevenueCat SDK.
 *
 * @param source - 'startup' (default, called by _layout.tsx on boot) or
 *                 'paywall' (called by prepareForPurchase when the user opens
 *                 the paywall). Startup calls are skipped when
 *                 STARTUP_REVENUECAT_ENABLED is false.
 *
 * Safe to call multiple times (idempotent). Never throws.
 */
export function initRevenueCat(source: 'startup' | 'paywall' = 'startup'): void {
  try {
    // Startup guard: skip configure() on app launch to prevent StoreKit from
    // sending network requests before the user explicitly opens the paywall.
    if (source === 'startup' && !REVENUECAT_STARTUP_ENABLED) {
      console.log('[Startup] skipping RevenueCat startup for diagnostic build');
      return;
    }

    // Idempotent: only configure once per process lifetime.
    if (_rcInitAttempted) {
      console.log('[BOOT] RevenueCat: init skipped (already attempted)');
      return;
    }
    _rcInitAttempted = true;

    console.log('[BOOT] RevenueCat: starting init, Platform.OS:', Platform.OS);

    // Guard: only run on native iOS/Android — skip silently on web/other.
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      console.log('[BOOT] RevenueCat: skipping — non-native platform:', Platform.OS);
      return;
    }

    // Guard: API key must be set.
    if (!IOS_KEY) {
      console.warn('[BOOT] RevenueCat: EXPO_PUBLIC_REVENUECAT_API_KEY not set — purchases unavailable');
      return;
    }

    // Guard: native module must actually exist (not available in Expo Go or if not linked).
    try {
      if (!Purchases || typeof Purchases.configure !== 'function') {
        console.warn('[BOOT] RevenueCat: native module not available (Expo Go or not linked)');
        return;
      }
    } catch (e) {
      console.warn('[BOOT] RevenueCat: native module check threw — not available:', e instanceof Error ? e.message : String(e));
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
      // setLogHandler not available — safe to ignore
    }

    console.log('[BOOT] RevenueCat: calling Purchases.configure()');
    try {
      Purchases.configure({ apiKey: IOS_KEY });
      _rcReady = true;
      console.log('[BOOT] RevenueCat: configure() succeeded, _rcReady=true');
    } catch (e) {
      console.warn('[BOOT] RevenueCat: configure() threw — purchases unavailable:', e instanceof Error ? e.message : String(e));
    }

  } catch (e) {
    // Outer catch: something unexpected escaped all inner guards.
    console.error('[BOOT] RevenueCat: unexpected error during init:', e instanceof Error ? e.message : String(e), e);
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

  // On native: attempt a lazy init using the 'paywall' source so the startup
  // guard does not block it, even when STARTUP_REVENUECAT_ENABLED is false.
  if (!_rcReady) {
    console.log('[RC] paywall-triggered init starting');
    initRevenueCat('paywall');
    console.log('[RC] paywall-triggered init complete, rcReady:', _rcReady);
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
