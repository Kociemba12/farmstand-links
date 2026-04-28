import { Farmstand, GoldVerifiedSource, OwnershipDisputeStatus } from './farmer-store';

// Configuration constants
export const MIN_REVIEWS_FOR_GOLD = 7; // Allowed range: 5-10, configurable by admin
export const MIN_DAYS_ACTIVE = 90;
export const MIN_RATING_FOR_GOLD = 4.0;

export interface GoldVerificationResult {
  eligible: boolean;
  goldVerified: boolean;
  goldVerifiedSource: GoldVerifiedSource;
  reasons: string[];
}

/**
 * Evaluates whether a farmstand should be Gold Verified automatically.
 *
 * Conditions for auto Gold Verified:
 * 1. daysSinceCreated >= 90
 * 2. avgRating >= 4.0
 * 3. reviewCount >= MIN_REVIEWS_FOR_GOLD (default 7)
 * 4. ownershipDisputeStatus != "open"
 *
 * Admin overrides are never touched by this function.
 */
export function evaluateGoldVerification(farmstand: Farmstand): GoldVerificationResult {
  const reasons: string[] = [];

  // If admin has manually set the verification, don't override
  if (farmstand.goldVerifiedSource === 'admin') {
    return {
      eligible: farmstand.goldVerified,
      goldVerified: farmstand.goldVerified,
      goldVerifiedSource: 'admin',
      reasons: ['Admin override - manual control'],
    };
  }

  // Check all conditions
  const createdAt = new Date(farmstand.createdAt);
  const now = new Date();
  const daysSinceCreated = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

  const conditions = {
    hasMinDays: daysSinceCreated >= MIN_DAYS_ACTIVE,
    hasMinRating: farmstand.avgRating >= MIN_RATING_FOR_GOLD,
    hasMinReviews: farmstand.reviewCount >= MIN_REVIEWS_FOR_GOLD,
    noOpenDispute: farmstand.ownershipDisputeStatus !== 'open',
  };

  // Collect reasons for eligibility or ineligibility
  if (!conditions.hasMinDays) {
    reasons.push(`Listing active for ${daysSinceCreated} days (requires ${MIN_DAYS_ACTIVE})`);
  }
  if (!conditions.hasMinRating) {
    reasons.push(`Average rating ${farmstand.avgRating.toFixed(1)} (requires ${MIN_RATING_FOR_GOLD})`);
  }
  if (!conditions.hasMinReviews) {
    reasons.push(`${farmstand.reviewCount} reviews (requires ${MIN_REVIEWS_FOR_GOLD})`);
  }
  if (!conditions.noOpenDispute) {
    reasons.push('Has open ownership dispute');
  }

  const eligible = conditions.hasMinDays && conditions.hasMinRating && conditions.hasMinReviews && conditions.noOpenDispute;

  if (eligible) {
    reasons.unshift('Meets all Gold Verified criteria');
  }

  return {
    eligible,
    goldVerified: eligible,
    goldVerifiedSource: eligible ? 'auto' : 'none',
    reasons,
  };
}

/**
 * Gets the display status for Gold Verification
 */
export function getGoldVerificationStatus(farmstand: Farmstand): {
  isGoldVerified: boolean;
  source: GoldVerifiedSource;
  tooltipText: string;
} {
  return {
    isGoldVerified: farmstand.goldVerified,
    source: farmstand.goldVerifiedSource,
    tooltipText: farmstand.goldVerified
      ? 'Gold Verified Farmstand — Trusted by the Farmstand community over time.'
      : '',
  };
}

/**
 * Admin action: Set Gold Verified manually
 */
export function setGoldVerifiedManually(
  farmstand: Farmstand,
  goldVerified: boolean
): Partial<Farmstand> {
  return {
    goldVerified,
    goldVerifiedSource: 'admin',
  };
}

/**
 * Admin action: Return to automatic evaluation
 */
export function returnToAutomatic(farmstand: Farmstand): Partial<Farmstand> {
  // First set source to none, then re-evaluate
  const result = evaluateGoldVerification({
    ...farmstand,
    goldVerifiedSource: 'none',
  });

  return {
    goldVerified: result.goldVerified,
    goldVerifiedSource: result.goldVerifiedSource,
  };
}

/**
 * Handle ownership dispute status change
 * If a dispute is opened and not admin-controlled, remove the badge
 */
export function handleDisputeStatusChange(
  farmstand: Farmstand,
  newStatus: OwnershipDisputeStatus
): Partial<Farmstand> {
  // If dispute is being opened and not admin-controlled
  if (newStatus === 'open' && farmstand.goldVerifiedSource !== 'admin') {
    return {
      ownershipDisputeStatus: newStatus,
      goldVerified: false,
      goldVerifiedSource: 'none',
    };
  }

  // If dispute is being resolved, re-evaluate
  if (newStatus === 'resolved' && farmstand.goldVerifiedSource !== 'admin') {
    const result = evaluateGoldVerification({
      ...farmstand,
      ownershipDisputeStatus: newStatus,
    });

    return {
      ownershipDisputeStatus: newStatus,
      goldVerified: result.goldVerified,
      goldVerifiedSource: result.goldVerifiedSource,
    };
  }

  // Just update the status
  return {
    ownershipDisputeStatus: newStatus,
  };
}
