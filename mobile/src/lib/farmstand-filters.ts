/**
 * Farmstand Filtering Utilities
 *
 * Single source of truth for filtering out demo/seeded farmstands.
 * Used by all farmstand queries to ensure consistency across:
 * - Explore list
 * - Map pins
 * - Category lists
 * - Search results
 * - Nearby results
 */

import { Farmstand } from './farmer-store';

/**
 * Filter criteria for public-facing farmstand views:
 * - status must be "active"
 * - approvalStatus must be "approved"
 * - is NOT a seeded/demo listing (seededListing = false OR null)
 * - importSource is NOT 'seed', 'demo', or 'template'
 * - visibility is 'public' (not 'admin_only' or 'hidden')
 */

// Sources that indicate demo/seeded data (NOT user-imported records)
// IMPORTANT: Do NOT include 'csv_import' here as that may be user-imported data
// Only include sources that are explicitly for demo/testing purposes
const DEMO_SOURCES = ['seed', 'demo', 'template', 'manual_admin_seed'] as const;

/**
 * Check if a farmstand is a demo/seeded listing
 * IMPORTANT: This should NOT filter out user-imported records
 */
export function isDemoFarmstand(farmstand: Farmstand): boolean {
  // Check seededListing flag - explicit marker for demo data
  if (farmstand.seededListing === true) {
    return true;
  }

  // Check importSource - only filter specific demo sources
  if (farmstand.importSource && DEMO_SOURCES.includes(farmstand.importSource as typeof DEMO_SOURCES[number])) {
    return true;
  }

  // Check if created by system with role 'system' - this is demo data
  if (farmstand.createdByRole === 'system') {
    return true;
  }

  // Check if ownerUserId is 'system' (legacy demo indicator)
  if (farmstand.ownerUserId === 'system') {
    return true;
  }

  return false;
}

/**
 * Check if a farmstand should be visible to public users
 *
 * IMPORTANT: This filter should be PERMISSIVE for user-imported records.
 * - Status can be 'active', null, empty, or 'pending'
 * - ApprovalStatus can be 'approved', null, or empty
 * - Visibility can be 'public', null, or empty
 * - But we ALWAYS exclude demo/seeded/template listings
 */
export function isPublicFarmstand(farmstand: Farmstand): boolean {
  // Must NOT be a demo/seeded listing - this is the ONLY hard filter
  if (isDemoFarmstand(farmstand)) {
    return false;
  }

  // Status filtering: show if active, pending, null, or empty
  // FarmstandStatus = 'draft' | 'pending' | 'active' | 'hidden'
  // Only hide if status is explicitly 'hidden' or 'draft'
  const status = farmstand.status;
  if (status === 'hidden' || status === 'draft') {
    return false;
  }

  // ApprovalStatus filtering: show if approved, pending, null, or empty
  // Only hide if explicitly rejected
  const approvalStatus = farmstand.approvalStatus;
  if (approvalStatus === 'rejected') {
    return false;
  }

  // Visibility filtering: show if public, null, or empty
  // Only hide if explicitly set to admin_only or hidden
  const visibility = farmstand.visibility;
  if (visibility === 'admin_only' || visibility === 'hidden') {
    return false;
  }

  return true;
}

/**
 * Filter farmstands for public display
 * This is the main filter to use in all public-facing views
 */
export function filterPublicFarmstands(farmstands: Farmstand[]): Farmstand[] {
  return farmstands.filter(isPublicFarmstand);
}

/**
 * Filter farmstands for map display
 * Same as public filter but also requires valid coordinates
 * NOTE: showOnMap check is relaxed - we show farmstands even if showOnMap is null/undefined
 */
export function filterMapFarmstands(farmstands: Farmstand[]): Farmstand[] {
  return farmstands.filter((f) => {
    // Must pass public filter
    if (!isPublicFarmstand(f)) {
      return false;
    }

    // Must have valid coordinates
    if (f.latitude == null || f.longitude == null) {
      return false;
    }

    // Only exclude from map if showOnMap is explicitly false
    // Allow null/undefined to show on map by default
    if (f.showOnMap === false) {
      return false;
    }

    return true;
  });
}

/**
 * Build Supabase query filters for fetching approved, non-demo farmstands
 * Returns an object with filter parameters for the REST API
 */
export function getSupabasePublicFilters(): Record<string, string> {
  return {
    status: 'eq.active',
    approval_status: 'eq.approved',
    visibility: 'eq.public',
    // Exclude seeded listings
    seeded_listing: 'is.false',
  };
}

/**
 * Supabase filter string for excluding demo/seeded data
 * Use with .or() or in WHERE clause
 */
export const SUPABASE_NON_DEMO_FILTER = 'seeded_listing.is.false,seeded_listing.is.null';

/**
 * Full Supabase filter for public farmstands as query string
 */
export function buildSupabasePublicQuery(): string {
  const filters = [
    'status=eq.active',
    'approval_status=eq.approved',
    'visibility=eq.public',
    'or=(seeded_listing.is.false,seeded_listing.is.null)',
  ];
  return filters.join('&');
}
