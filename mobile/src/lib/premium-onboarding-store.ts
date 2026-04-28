/**
 * Premium Onboarding Store
 *
 * Manages the one-time "Your Farmstand Is Claimed" Premium onboarding screen.
 *
 * Rules:
 * - Show the screen when: claim_status=claimed, premium_status=trial, owner=current user, NOT seen yet
 * - Once the user taps Continue or Compare, mark it as seen
 * - Persisted in AsyncStorage keyed by userId+farmstandId so it survives app restarts
 * - Works across devices if the user logs in on multiple devices (each device tracks independently)
 *
 * Key: 'premium_onboarding_seen_v1:<userId>:<farmstandId>'
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const KEY_PREFIX = 'premium_onboarding_seen_v1:';

function makeKey(userId: string, farmstandId: string): string {
  return `${KEY_PREFIX}${userId}:${farmstandId}`;
}

// ─── AsyncStorage helpers ─────────────────────────────────────────────────────

/**
 * Returns true if the onboarding has already been seen for this user+farmstand combo.
 */
export async function hasPremiumOnboardingBeenSeen(
  userId: string,
  farmstandId: string
): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(makeKey(userId, farmstandId));
    const seen = value === 'true';
    console.log(
      `[PremiumOnboarding] hasSeen userId=${userId} farmstandId=${farmstandId} → ${seen}`
    );
    return seen;
  } catch (err) {
    console.log('[PremiumOnboarding] Error reading seen flag:', err);
    return false; // Default to not seen so onboarding can still show
  }
}

/**
 * Marks the onboarding as seen for this user+farmstand combo.
 */
export async function markPremiumOnboardingAsSeen(
  userId: string,
  farmstandId: string
): Promise<void> {
  try {
    await AsyncStorage.setItem(makeKey(userId, farmstandId), 'true');
    console.log(
      `[PremiumOnboarding] Marked as seen: userId=${userId} farmstandId=${farmstandId}`
    );
  } catch (err) {
    console.log('[PremiumOnboarding] Error writing seen flag:', err);
  }
}

/**
 * Clears the seen flag — for testing / admin reset only.
 */
export async function resetPremiumOnboardingSeen(
  userId: string,
  farmstandId: string
): Promise<void> {
  try {
    await AsyncStorage.removeItem(makeKey(userId, farmstandId));
    console.log(
      `[PremiumOnboarding] Seen flag reset: userId=${userId} farmstandId=${farmstandId}`
    );
  } catch (err) {
    console.log('[PremiumOnboarding] Error clearing seen flag:', err);
  }
}

// ─── Zustand store ────────────────────────────────────────────────────────────

/**
 * In-memory store to coordinate which onboarding screen should be shown.
 *
 * The `pendingFarmstandId` is set when we detect an unseen premium onboarding
 * so any screen (Profile, My Farmstand, app open) can detect it and navigate.
 *
 * Once the user is sent to the onboarding screen, clear this so we don't loop.
 */

interface PremiumOnboardingState {
  /** The farmstand ID that needs onboarding shown, or null if nothing pending */
  pendingFarmstandId: string | null;
  /** Whether we've already checked on this session (to avoid repeated checks) */
  hasCheckedThisSession: boolean;
  /**
   * Whether any code path has already fired the navigation to the onboarding
   * screen this session. Once true, ALL other triggers are blocked regardless
   * of check state — prevents the double-presentation race condition between
   * the app-open trigger (_layout) and the profile-focus trigger (profile tab).
   */
  hasPresentedThisSession: boolean;

  setPendingFarmstandId: (id: string | null) => void;
  setHasCheckedThisSession: (checked: boolean) => void;
  /** Call this BEFORE navigating to the onboarding screen. Returns true if safe
   * to navigate (first call this session), false if already presented. */
  tryMarkPresented: () => boolean;
  reset: () => void;
}

export const usePremiumOnboardingStore = create<PremiumOnboardingState>((set, get) => ({
  pendingFarmstandId: null,
  hasCheckedThisSession: false,
  hasPresentedThisSession: false,

  setPendingFarmstandId: (id) => {
    console.log('[PremiumOnboarding] setPendingFarmstandId →', id);
    set({ pendingFarmstandId: id });
  },

  setHasCheckedThisSession: (checked) => {
    set({ hasCheckedThisSession: checked });
  },

  tryMarkPresented: () => {
    if (get().hasPresentedThisSession) {
      console.log('[PremiumOnboarding] tryMarkPresented → BLOCKED (already presented this session)');
      return false;
    }
    console.log('[PremiumOnboarding] tryMarkPresented → ALLOWED (first presentation this session)');
    set({ hasPresentedThisSession: true });
    return true;
  },

  reset: () => {
    set({ pendingFarmstandId: null, hasCheckedThisSession: false, hasPresentedThisSession: false });
  },
}));

// ─── Claim Approved Modal (Explore screen one-time modal) ────────────────────

const CLAIM_APPROVED_KEY_PREFIX = 'claimApprovedSeen:';

function makeClaimApprovedKey(userId: string): string {
  return `${CLAIM_APPROVED_KEY_PREFIX}${userId}`;
}

/**
 * Returns true if the user has already seen the "Claim Approved" modal
 * that appears on the Explore screen.
 */
export async function hasClaimApprovedModalBeenSeen(userId: string): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(makeClaimApprovedKey(userId));
    return value === 'true';
  } catch {
    return false;
  }
}

/**
 * Marks the "Claim Approved" Explore modal as seen for this user.
 */
export async function markClaimApprovedModalAsSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(makeClaimApprovedKey(userId), 'true');
    console.log('[ClaimApprovedModal] Marked as seen for userId=' + userId);
  } catch (err) {
    console.log('[ClaimApprovedModal] Error writing seen flag:', err);
  }
}

// ─── Core check logic ─────────────────────────────────────────────────────────

/**
 * Check if any of the user's farmstands needs the premium upsell onboarding shown.
 *
 * Conditions:
 * - farmstand.claimStatus === 'claimed'   (user owns it)
 * - farmstand.premiumStatus === 'free'    (trial not yet started — do NOT show if already trial/active)
 * - farmstand has NOT been seen yet (checked in AsyncStorage)
 *
 * Claiming a farmstand does NOT automatically grant premium. The user must
 * explicitly start the free trial. This check fires the upsell modal for
 * claimed-but-not-yet-premium farmstands only.
 *
 * If found, sets pendingFarmstandId in the store so navigation can happen.
 *
 * Returns the farmstand ID that needs onboarding, or null.
 */
export async function checkForPendingPremiumOnboarding(
  userId: string,
  farmstands: Array<{ id: string; claimStatus: string; premiumStatus: string }>
): Promise<string | null> {
  console.log(
    `[PremiumOnboarding] checkForPending: userId=${userId}, farmstands=${farmstands.length}`
  );

  for (const farmstand of farmstands) {
    console.log(
      `[PremiumOnboarding] Checking farmstand id=${farmstand.id} claimStatus=${farmstand.claimStatus} premiumStatus=${farmstand.premiumStatus}`
    );

    if (farmstand.claimStatus !== 'claimed') {
      console.log(`[PremiumOnboarding] Skipping: claimStatus=${farmstand.claimStatus} (not claimed)`);
      continue;
    }
    // Only show the upsell for farmstands that are claimed but still on the free plan.
    // If premium is already active (trial/active), do not show the upsell again.
    if (farmstand.premiumStatus !== 'free') {
      console.log(`[PremiumOnboarding] Skipping: premiumStatus=${farmstand.premiumStatus} (premium already active or expired)`);
      continue;
    }

    const seen = await hasPremiumOnboardingBeenSeen(userId, farmstand.id);
    if (!seen) {
      console.log(
        `[PremiumOnboarding] TRIGGER: farmstand ${farmstand.id} is claimed+free, needs upsell onboarding (not seen yet)`
      );
      usePremiumOnboardingStore.getState().setPendingFarmstandId(farmstand.id);
      return farmstand.id;
    } else {
      console.log(`[PremiumOnboarding] Already seen for farmstand ${farmstand.id}`);
    }
  }

  console.log('[PremiumOnboarding] No pending onboarding found');
  usePremiumOnboardingStore.getState().setPendingFarmstandId(null);
  return null;
}
