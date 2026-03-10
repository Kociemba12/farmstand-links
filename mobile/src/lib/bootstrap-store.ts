/**
 * Bootstrap Store
 *
 * Manages app initialization state and coordinates preloading of core data.
 * Ensures consistent behavior between TestFlight and VibeCode environments.
 *
 * Bootstrap sequence:
 * 1. Restore/refresh Supabase session
 * 2. Load user profile from store
 * 3. In parallel: fetch user's farmstands, analytics, chat data
 * 4. Set appReady = true
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSessionFromStorage, getSupabaseSession, refreshSupabaseSession, isSupabaseConfigured, hasActiveSession, getValidSession, getSupabaseProjectRef } from './supabase';
import { useUserStore, UserProfile } from './user-store';
import { useAdminStore } from './admin-store';
import { useAnalyticsStore } from './analytics-store';
import { useChatStore } from './chat-store';
import { Farmstand } from './farmer-store';
import { supabase } from './supabase';

export type BootstrapStatus = 'idle' | 'bootstrapping' | 'ready' | 'error';
export type UserFarmstandsStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface BootstrapState {
  status: BootstrapStatus;
  appReady: boolean;
  error: string | null;

  // Track the last user we loaded farmstands for — used to detect account switches
  // and avoid showing one user's farmstand cards to a different user.
  lastLoadedUserId: string | null;

  // Status of user farmstands fetch — used by UI to gate rendering.
  // 'idle'    = never fetched, but cached data may be pre-populated
  // 'loading' = background refresh in flight; cached data is still shown
  // 'loaded'  = fetch complete; userFarmstands is authoritative
  // 'error'   = fetch failed; userFarmstands retains cached data if any
  userFarmstandsStatus: UserFarmstandsStatus;
  userFarmstandsError: string | null;

  // @deprecated — kept for backwards compat, mirrors (userFarmstandsStatus === 'loading')
  userFarmstandsLoading: boolean;

  // Preloaded data references (stored in respective stores, but tracked here)
  userFarmstands: Farmstand[];
  analyticsSummary: {
    totalViews7d: number;
    totalSaves7d: number;
    totalDirections7d: number;
  } | null;

  // Debug info for Profile screen diagnostic panel
  profileDebugInfo: {
    authUid: string | null;
    supabaseProjectRef: string;
    farmstandCount: number;
    farmstandIds: string[];
    dataSource: string; // e.g. 'farmstands.owner_id=<uid>'
    lastFetchAt: string | null;
    fetchError: string | null;
  };

  // Actions
  bootstrap: () => Promise<void>;
  /** Refresh the user's owned farmstands from Supabase.
   *  @param accessToken - Optional: provide the AuthProvider session token to bypass
   *                       getValidSession(). Use this when calling from a screen that
   *                       already has a confirmed valid session from AuthProvider. */
  refreshUserFarmstands: (accessToken?: string) => Promise<void>;
  reset: () => void;
}


// In-flight guard: prevents concurrent refreshUserFarmstands calls.
// A module-level variable is safe here because the app is single-user single-process.
// This guard is specifically for the refresh path (focus/AppState triggers can overlap).
let _refreshInFlight = false;

/** Returns true if a refreshUserFarmstands call is currently in flight. */
export function isRefreshInFlight(): boolean {
  return _refreshInFlight;
}

// Safety reset: if a refresh was interrupted (e.g. hot reload, component unmount mid-flight),
// the flag stays true forever. Reset it after 15s max so subsequent calls are never blocked.
let _refreshInFlightTimer: ReturnType<typeof setTimeout> | null = null;
function setRefreshInFlight(value: boolean) {
  _refreshInFlight = value;
  if (_refreshInFlightTimer) {
    clearTimeout(_refreshInFlightTimer);
    _refreshInFlightTimer = null;
  }
  if (value) {
    _refreshInFlightTimer = setTimeout(() => {
      if (_refreshInFlight) {
        console.log('[Bootstrap] _refreshInFlight safety reset after 15s timeout');
        _refreshInFlight = false;
      }
    }, 15000);
  }
}

// ---------------------------------------------------------------------------
// Per-user farmstand cache (AsyncStorage)
// Keyed by user ID so account switches never show the wrong user's data.
// ---------------------------------------------------------------------------
const CACHE_PREFIX = 'profile_my_farmstand_v1:';

/** Minimal cached shape — only what the card needs to render instantly. */
interface CachedFarmstandCard {
  id: string;
  name: string;
  city: string;
  state: string;
  photos: string[];
}

interface FarmstandCardCache {
  userId: string;
  farmstands: CachedFarmstandCard[];
  savedAt: number; // epoch ms
}

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId}`;
}

async function readFarmstandCache(userId: string): Promise<CachedFarmstandCard[] | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed: FarmstandCardCache = JSON.parse(raw);
    // Sanity check — must be for the same user
    if (parsed.userId !== userId) return null;
    return parsed.farmstands;
  } catch {
    return null;
  }
}

async function writeFarmstandCache(userId: string, farmstands: Farmstand[]): Promise<void> {
  try {
    // Never cache soft-deleted farmstands — filter them out before writing
    const activeFarmstands = farmstands.filter((f) => f.deletedAt == null);
    const payload: FarmstandCardCache = {
      userId,
      farmstands: activeFarmstands.map((f) => ({
        id: f.id,
        name: f.name,
        city: f.city ?? '',
        state: f.state ?? '',
        photos: f.photos ?? [],
      })),
      savedAt: Date.now(),
    };
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(payload));
  } catch {
    // Non-fatal — cache write failure must never break the app
  }
}

async function clearFarmstandCache(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(userId));
  } catch {
    // Non-fatal
  }
}

/** Build a minimal Farmstand shell from cached card data.
 *  All required fields are filled with safe defaults — only id/name/city/state/photos
 *  are meaningful. The full object is replaced by the Supabase fetch immediately after. */
function cachedCardToFarmstand(c: CachedFarmstandCard): Farmstand {
  const now = new Date().toISOString();
  return {
    id: c.id,
    name: c.name,
    city: c.city,
    state: c.state,
    photos: c.photos,
    ownerUserId: '',
    shortDescription: '',
    description: '',
    categories: [],
    mainPhotoIndex: 0,
    phone: null,
    email: null,
    socialLinks: [],
    isActive: true,
    status: 'active',
    operationalStatus: 'active',
    showOnMap: true,
    addressLine1: null,
    addressLine2: null,
    zip: null,
    fullAddress: null,
    latitude: null,
    longitude: null,
    hours: null,
    isOpen24_7: false,
    seasonalNotes: null,
    seasonalDates: null,
    offerings: [],
    paymentOptions: [],
    honorSystem: false,
    selfServe: false,
    directionsNotes: null,
    parkingNotes: null,
    todaysNote: null,
    adminNotes: null,
    updatedAt: now,
    createdAt: now,
    claimStatus: 'unclaimed',
    verificationCode: null,
    claimedAt: null,
    goldVerified: false,
    goldVerifiedSource: 'none',
    ownershipDisputeStatus: 'none',
    lastActivityAt: now,
    reviewCount: 0,
    avgRating: 0,
    verificationStatus: 'PENDING_VERIFICATION',
    visibilityStatus: 'PUBLIC',
    createdByUserId: null,
    claimedByUserId: null,
    verifiedByAdminId: null,
    verifiedAt: null,
    rejectionReason: null,
    submissionAdminNotes: null,
    lastReviewedAt: null,
    promoActive: false,
    promoExploreCategories: [],
    promoMapBoost: false,
    promoPriority: 0,
    promoStartAt: null,
    promoEndAt: null,
    promoRotationWeight: 1,
    promoStatus: 'none',
    clicks30d: 0,
    saves30d: 0,
    messages30d: 0,
    popularityScore: 0,
    isPaidPromotion: false,
    promotionTier: 'none',
    seededListing: false,
    importSource: null,
    confidenceLevel: 'medium',
    approvalStatus: 'approved',
    visibility: 'public',
    claimingDisabled: false,
    reviewsEnabled: true,
    messagingEnabled: true,
    showStatusBanner: false,
    statusBannerText: null,
    statusBannerType: 'neutral',
    createdByRole: 'farmer',
    locationMode: 'exact_address',
    areaType: null,
    crossStreet1: null,
    crossStreet2: null,
    genericAreaText: null,
    nearestCityState: null,
    pinSource: null,
    useApproximateLocation: false,
    approxLocationText: null,
    optionalNearestCityState: null,
    locationPrecision: 'exact',
    geocodeProvider: null,
    geocodeConfidence: null,
    pinAdjustedByUser: false,
    adminReviewReason: null,
    heroPhotoUrl: null,
    aiPhotoUrl: null,
    heroImageUrl: null,
    heroImageTheme: null,
    heroImageSeed: null,
    heroImageGeneratedAt: null,
    mainProduct: null,
    aiImageUrl: null,
    aiImageSeed: null,
    aiImageUpdatedAt: null,
    primaryImageMode: 'uploaded',
    fallbackImageKey: null,
    deletedAt: null,
  };
}

// Helper to fetch user's farmstands from Supabase via farmstand_owners table.
//
// AUTHORITATIVE: a user owns a farmstand iff they have a row in farmstand_owners
// with is_active IS NULL or is_active = true.
//
// farmstands.owner_id and farmstands.claimed_by are NEVER used for ownership determination.
// There is NO fallback to owner_id queries — if farmstand_owners returns 0 rows, the user
// owns 0 farmstands. Period.
//
// @param userId      - The authenticated user's ID
// @param accessToken - Optional: pass a known-valid access token (e.g. from AuthProvider)
//                      to bypass getValidSession(). If omitted, getValidSession() is called.
// @returns { farmstands, noSession, debugMeta }
//   noSession=true means the fetch was skipped due to no valid session — callers should
//   NOT treat this as "0 owned farmstands"; instead they should retry once auth is ready.
async function fetchUserFarmstandsFromSupabase(userId: string, accessToken?: string): Promise<{
  farmstands: Farmstand[];
  noSession: boolean;
  debugMeta: { dataSource: string; fetchError: string | null };
}> {
  if (!isSupabaseConfigured()) {
    console.log('[Bootstrap] Supabase not configured, skipping farmstand fetch');
    return { farmstands: [], noSession: false, debugMeta: { dataSource: 'supabase not configured', fetchError: null } };
  }

  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
    const projectRef = getSupabaseProjectRef();
    console.log('[Bootstrap] fetchUserFarmstandsFromSupabase — userId:', userId, '| project:', projectRef, '| url:', supabaseUrl.slice(0, 40), '| hasProvidedToken:', !!accessToken);

    // Use the provided token if available, otherwise try getValidSession()
    let resolvedToken = accessToken;
    if (!resolvedToken) {
      const session = await getValidSession();
      resolvedToken = session?.access_token;
    }

    if (!resolvedToken) {
      console.log('[Bootstrap] No valid session — skipping farmstand fetch (will retry when auth is ready)');
      return { farmstands: [], noSession: true, debugMeta: { dataSource: 'no session', fetchError: 'no valid session' } };
    }

    // Query farmstand_owners JOIN farmstands — SOLE authoritative ownership check.
    // Filter: is_active is NULL or true (active ownership rows only).
    // CRITICAL: also filter farmstands.deleted_at IS NULL so soft-deleted farmstands
    // are never returned even if the farmstand_owners row was not cleaned up.
    const url = new URL(`${supabaseUrl}/rest/v1/farmstand_owners`);
    url.searchParams.set('select', 'farmstand_id,is_active,farmstands!inner(*)');
    url.searchParams.set('user_id', `eq.${userId}`);
    url.searchParams.set('or', '(is_active.is.null,is_active.eq.true)');
    url.searchParams.set('farmstands.deleted_at', 'is.null');

    console.log('[Bootstrap] Fetching farmstand_owners for user:', userId, '| filter: deleted_at IS NULL applied on join');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${resolvedToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      // 42703 = column does not exist (is_active missing from farmstand_owners).
      // Retry without the is_active filter so builds work even if the column is absent.
      if (errorText.includes('42703') && errorText.includes('is_active')) {
        console.log('[Bootstrap] is_active column missing (42703) — retrying without is_active filter');
        const fallbackUrl = new URL(`${supabaseUrl}/rest/v1/farmstand_owners`);
        fallbackUrl.searchParams.set('select', 'farmstand_id,farmstands!inner(*)');
        fallbackUrl.searchParams.set('user_id', `eq.${userId}`);
        fallbackUrl.searchParams.set('farmstands.deleted_at', 'is.null');

        const fallbackResponse = await fetch(fallbackUrl.toString(), {
          method: 'GET',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${resolvedToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (fallbackResponse.ok) {
          type FallbackRow = { farmstand_id: string; farmstands: Record<string, unknown> | null };
          const fallbackData: FallbackRow[] = await fallbackResponse.json();
          const allFallback: Farmstand[] = (fallbackData || [])
            .filter((row) => row.farmstands != null)
            .map((row) => mapSupabaseFarmstand(row.farmstands as Record<string, unknown>));
          // Filter out soft-deleted farmstands
          const farmstands = allFallback.filter((f) => {
            if (f.deletedAt != null) {
              console.log('[Bootstrap] Fallback: filtered soft-deleted farmstand:', f.id);
              return false;
            }
            return true;
          });
          console.log('[Bootstrap] Fallback (no is_active) returned', farmstands.length, 'farmstands (deleted filter applied)');
          return {
            farmstands,
            noSession: false,
            debugMeta: { dataSource: `farmstand_owners.user_id=${userId} (no is_active, deleted_at IS NULL)`, fetchError: null },
          };
        }
        // fallback also failed — fall through to the standard error return below
      }

      // NO FALLBACK regardless of error code. If the table is missing that is a
      // deployment problem, not something we paper over in production builds.
      console.log('[Bootstrap] farmstand_owners query failed — returning [] (no fallback):', response.status, errorText.slice(0, 200));
      return {
        farmstands: [],
        noSession: false,
        debugMeta: {
          dataSource: `farmstand_owners.user_id=${userId}`,
          fetchError: `HTTP ${response.status}: ${errorText.slice(0, 100)}`,
        },
      };
    }

    type OwnerRow = { farmstand_id: string; is_active: boolean | null; farmstands: Record<string, unknown> | null };
    const data: OwnerRow[] = await response.json();

    if (!data || data.length === 0) {
      console.log('[Bootstrap] No farmstand_owners rows found for user:', userId, '— user owns 0 farmstands');
      return { farmstands: [], noSession: false, debugMeta: { dataSource: `farmstand_owners.user_id=${userId}`, fetchError: null } };
    }

    console.log('[Bootstrap] Found', data.length, 'farmstand_owners rows for user');
    // Log deleted_at value for each returned row to aid debugging
    data.forEach((row) => {
      const deletedAt = row.farmstands ? (row.farmstands as Record<string, unknown>)['deleted_at'] : 'no farmstand';
      console.log('[Bootstrap] Row farmstand_id:', row.farmstand_id, '| deleted_at:', deletedAt ?? 'null');
    });

    // Extract and map the joined farmstand rows.
    // Skip null farmstand data AND any soft-deleted rows (deleted_at != null) as a
    // defense-in-depth guard even though the query already filters with !inner join.
    const rawFarmstands: Farmstand[] = data
      .filter((row) => row.farmstands != null)
      .map((row) => mapSupabaseFarmstand(row.farmstands as Record<string, unknown>));

    const farmstands = rawFarmstands.filter((f) => {
      const isDeleted = f.deletedAt != null;
      if (isDeleted) {
        console.log('[Bootstrap] Filtered out soft-deleted farmstand:', f.id, '| deleted_at:', f.deletedAt);
      }
      return !isDeleted;
    });

    console.log('[Bootstrap] Query filter: deleted_at IS NULL | raw rows:', rawFarmstands.length, '| after delete filter:', farmstands.length, '| ids:', farmstands.map((f) => f.id).join(', ') || 'none');

    return { farmstands, noSession: false, debugMeta: { dataSource: `farmstand_owners.user_id=${userId} (deleted_at IS NULL)`, fetchError: null } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // NO FALLBACK on exception either. Log and return [].
    console.log('[Bootstrap] farmstand_owners fetch exception — returning [] (no fallback):', msg);
    return { farmstands: [], noSession: false, debugMeta: { dataSource: `farmstand_owners.user_id=${userId}`, fetchError: msg } };
  }
}

// Map Supabase row to Farmstand (simplified version of admin-store mapper)
function mapSupabaseFarmstand(row: Record<string, unknown>): Farmstand {
  const now = new Date().toISOString();

  const get = <T>(snakeKey: string, camelKey: string, defaultValue: T): T => {
    if (row[snakeKey] !== undefined && row[snakeKey] !== null) return row[snakeKey] as T;
    if (row[camelKey] !== undefined && row[camelKey] !== null) return row[camelKey] as T;
    return defaultValue;
  };

  const ownerId = (row['owner_id'] ?? null) as string | null;
  const claimedBy = (row['claimed_by'] ?? row['claimedByUserId'] ?? null) as string | null;
  const effectiveOwnerId = ownerId ?? claimedBy;

  return {
    id: get('id', 'id', ''),
    ownerUserId: (ownerId ?? get('owner_user_id', 'ownerUserId', '') ?? '') as string,
    name: get('name', 'name', ''),
    shortDescription: get('short_description', 'shortDescription', ''),
    description: get('description', 'description', ''),
    categories: get('categories', 'categories', []),
    photos: get('photos', 'photos', []),
    mainPhotoIndex: get('main_photo_index', 'mainPhotoIndex', 0),
    phone: get('phone', 'phone', null),
    email: get('email', 'email', null),
    socialLinks: get('social_links', 'socialLinks', []),
    isActive: get('is_active', 'isActive', true),
    status: get('status', 'status', 'active'),
    operationalStatus: get('operational_status', 'operationalStatus', 'active'),
    showOnMap: get('show_on_map', 'showOnMap', true),
    addressLine1: get('street_address', 'addressLine1', null),
    addressLine2: get('address_line2', 'addressLine2', null),
    city: get('city', 'city', null),
    state: get('state', 'state', null),
    zip: get('zip', 'zip', null),
    fullAddress: get('full_address', 'fullAddress', null),
    latitude: get('latitude', 'latitude', null),
    longitude: get('longitude', 'longitude', null),
    hours: get('hours', 'hours', null),
    isOpen24_7: get('is_open_24_7', 'isOpen24_7', false),
    seasonalNotes: get('seasonal_notes', 'seasonalNotes', null),
    seasonalDates: get('seasonal_dates', 'seasonalDates', null),
    offerings: get('offerings', 'offerings', []),
    otherProducts: get('other_products', 'otherProducts', []),
    paymentOptions: get('payment_options', 'paymentOptions', ['cash']),
    honorSystem: get('honor_system', 'honorSystem', false),
    selfServe: get('self_serve', 'selfServe', false),
    directionsNotes: get('directions_notes', 'directionsNotes', null),
    parkingNotes: get('parking_notes', 'parkingNotes', null),
    todaysNote: get('todays_note', 'todaysNote', null),
    adminNotes: get('admin_notes', 'adminNotes', null),
    updatedAt: get('updated_at', 'updatedAt', now),
    createdAt: get('created_at', 'createdAt', now),
    claimStatus: effectiveOwnerId
      ? 'claimed'
      : (row['claim_status'] === 'pending' ? 'pending' : 'unclaimed'),
    verificationCode: get('verification_code', 'verificationCode', null),
    claimedAt: get('claimed_at', 'claimedAt', null),
    goldVerified: get('gold_verified', 'goldVerified', false),
    goldVerifiedSource: get('gold_verified_source', 'goldVerifiedSource', 'none'),
    ownershipDisputeStatus: get('ownership_dispute_status', 'ownershipDisputeStatus', 'none'),
    lastActivityAt: get('last_activity_at', 'lastActivityAt', now),
    reviewCount: get('review_count', 'reviewCount', 0),
    avgRating: get('avg_rating', 'avgRating', 0),
    verificationStatus: get('verification_status', 'verificationStatus', 'VERIFIED'),
    visibilityStatus: get('visibility_status', 'visibilityStatus', 'PUBLIC'),
    createdByUserId: get('created_by_user_id', 'createdByUserId', null),
    claimedByUserId: effectiveOwnerId,
    verifiedByAdminId: get('verified_by_admin_id', 'verifiedByAdminId', null),
    verifiedAt: get('verified_at', 'verifiedAt', null),
    rejectionReason: get('rejection_reason', 'rejectionReason', null),
    submissionAdminNotes: get('submission_admin_notes', 'submissionAdminNotes', null),
    lastReviewedAt: get('last_reviewed_at', 'lastReviewedAt', null),
    promoActive: get('promo_active', 'promoActive', false),
    promoExploreCategories: get('promo_explore_categories', 'promoExploreCategories', []),
    promoMapBoost: get('promo_map_boost', 'promoMapBoost', false),
    promoPriority: get('promo_priority', 'promoPriority', 50),
    promoStartAt: get('promo_start_at', 'promoStartAt', null),
    promoEndAt: get('promo_end_at', 'promoEndAt', null),
    promoRotationWeight: get('promo_rotation_weight', 'promoRotationWeight', 1),
    promoStatus: get('promo_status', 'promoStatus', 'none'),
    clicks30d: get('clicks_30d', 'clicks30d', 0),
    saves30d: get('saves_30d', 'saves30d', 0),
    messages30d: get('messages_30d', 'messages30d', 0),
    popularityScore: get('popularity_score', 'popularityScore', 0),
    isPaidPromotion: get('is_paid_promotion', 'isPaidPromotion', false),
    promotionTier: get('promotion_tier', 'promotionTier', 'none'),
    seededListing: get('seeded_listing', 'seededListing', false),
    importSource: get('import_source', 'importSource', null),
    confidenceLevel: get('confidence_level', 'confidenceLevel', 'high'),
    approvalStatus: get('approval_status', 'approvalStatus', 'approved'),
    visibility: get('visibility', 'visibility', 'public'),
    claimingDisabled: get('claiming_disabled', 'claimingDisabled', false),
    reviewsEnabled: get('reviews_enabled', 'reviewsEnabled', true),
    messagingEnabled: get('messaging_enabled', 'messagingEnabled', true),
    showStatusBanner: get('show_status_banner', 'showStatusBanner', false),
    statusBannerText: get('status_banner_text', 'statusBannerText', null),
    statusBannerType: get('status_banner_type', 'statusBannerType', 'neutral'),
    createdByRole: get('created_by_role', 'createdByRole', 'farmer'),
    locationMode: get('location_mode', 'locationMode', 'exact_address'),
    areaType: get('area_type', 'areaType', null),
    crossStreet1: get('cross_street1', 'crossStreet1', null),
    crossStreet2: get('cross_street2', 'crossStreet2', null),
    genericAreaText: get('generic_area_text', 'genericAreaText', null),
    nearestCityState: get('nearest_city_state', 'nearestCityState', null),
    pinSource: get('pin_source', 'pinSource', null),
    useApproximateLocation: get('use_approximate_location', 'useApproximateLocation', false),
    approxLocationText: get('approx_location_text', 'approxLocationText', null),
    optionalNearestCityState: get('optional_nearest_city_state', 'optionalNearestCityState', null),
    locationPrecision: get('location_precision', 'locationPrecision', 'exact'),
    geocodeProvider: get('geocode_provider', 'geocodeProvider', null),
    geocodeConfidence: get('geocode_confidence', 'geocodeConfidence', null),
    pinAdjustedByUser: get('pin_adjusted_by_user', 'pinAdjustedByUser', false),
    adminReviewReason: get('admin_review_reason', 'adminReviewReason', null),
    heroPhotoUrl: get('hero_photo_url', 'heroPhotoUrl', null),
    aiPhotoUrl: get('ai_photo_url', 'aiPhotoUrl', null),
    heroImageUrl: get('hero_image_url', 'heroImageUrl', null),
    heroImageTheme: get('hero_image_theme', 'heroImageTheme', null),
    heroImageSeed: get('hero_image_seed', 'heroImageSeed', null),
    heroImageGeneratedAt: get('hero_image_generated_at', 'heroImageGeneratedAt', null),
    mainProduct: get('main_product', 'mainProduct', null),
    aiImageUrl: get('ai_image_url', 'aiImageUrl', null),
    aiImageSeed: get('ai_image_seed', 'aiImageSeed', null),
    aiImageUpdatedAt: get('ai_image_updated_at', 'aiImageUpdatedAt', null),
    photoUrl: get('photo_url', 'photoUrl', null),
    imageUrl: get('image_url', 'imageUrl', null),
    primaryImageMode: get('primary_image_mode', 'primaryImageMode', 'ai_fallback'),
    fallbackImageKey: get('fallback_image_key', 'fallbackImageKey', null),
    deletedAt: get('deleted_at', 'deletedAt', null),
  } as Farmstand;
}

// Compute analytics summary for farmstand IDs
function computeAnalyticsSummary(
  farmstandIds: string[],
  analyticsStore: ReturnType<typeof useAnalyticsStore.getState>
): { totalViews7d: number; totalSaves7d: number; totalDirections7d: number } {
  let totalViews7d = 0;
  let totalSaves7d = 0;
  let totalDirections7d = 0;

  for (const farmstandId of farmstandIds) {
    const stats = analyticsStore.getFarmstandStats7Days(farmstandId);
    totalViews7d += stats.views;
    totalSaves7d += stats.saves;
    totalDirections7d += stats.directions;
  }

  return { totalViews7d, totalSaves7d, totalDirections7d };
}

export const useBootstrapStore = create<BootstrapState>((set, get) => ({
  status: 'idle',
  appReady: false,
  error: null,
  lastLoadedUserId: null,
  // Start as 'idle' (not yet fetched). Profile UI must not render farmstand sections
  // until this transitions to 'loaded'.
  userFarmstandsStatus: 'idle',
  userFarmstandsError: null,
  userFarmstandsLoading: false, // false until bootstrap/refresh actually starts
  userFarmstands: [],
  analyticsSummary: null,
  profileDebugInfo: {
    authUid: null,
    supabaseProjectRef: '',
    farmstandCount: 0,
    farmstandIds: [],
    dataSource: 'not yet fetched',
    lastFetchAt: null,
    fetchError: null,
  },

  bootstrap: async () => {
    const currentStatus = get().status;

    // Prevent duplicate bootstrap calls
    if (currentStatus === 'bootstrapping' || currentStatus === 'ready') {
      console.log('[Bootstrap] Already', currentStatus, '- skipping');
      return;
    }

    console.log('[Bootstrap] Starting app bootstrap...');
    set({ status: 'bootstrapping', error: null });

    try {
      // Step 1: Restore Supabase session from SecureStore (SecureStore is the single source of truth)
      console.log('[Bootstrap] Step 1: Restoring Supabase session from SecureStore...');
      await loadSessionFromStorage();
      const restoredSession = getSupabaseSession();
      console.log('[Bootstrap] Session restored:', restoredSession ? 'found' : 'none');

      if (restoredSession) {
        // Try to refresh if configured
        if (isSupabaseConfigured() && hasActiveSession()) {
          const refreshed = await refreshSupabaseSession();
          console.log('[Bootstrap] Session refresh:', refreshed ? 'success' : 'skipped/failed');
        }
      } else {
        console.log('[Bootstrap] No stored session found');
      }

      // Step 2: Load user from store
      console.log('[Bootstrap] Step 2: Loading user...');
      const userStore = useUserStore.getState();
      await userStore.loadUser();
      const user = useUserStore.getState().user;
      console.log('[Bootstrap] User loaded:', user?.id || 'none');

      // If no user or guest, we're done - app is ready
      if (!user || user.id === 'guest') {
        console.log('[Bootstrap] No authenticated user - completing bootstrap');
        set({
          status: 'ready',
          appReady: true,
          userFarmstandsStatus: 'loaded',
          userFarmstandsError: null,
          userFarmstandsLoading: false,
          userFarmstands: [],
          analyticsSummary: null,
        });
        return;
      }

      // Step 3: Parallel fetch of user data
      console.log('[Bootstrap] Step 3: Parallel data fetch for user:', user.id);

      const [fetchResult, _, __] = await Promise.all([
        // Fetch user's claimed farmstands (skip if no user ID)
        user.id ? fetchUserFarmstandsFromSupabase(user.id) : Promise.resolve({ farmstands: [] as Farmstand[], noSession: false, debugMeta: { dataSource: 'no user id', fetchError: null } }),

        // Load analytics (populates store)
        useAnalyticsStore.getState().loadAnalytics(),

        // Load chat data
        useChatStore.getState().loadChatData(user.id ?? undefined),
      ]);

      const userFarmstands = fetchResult.farmstands;
      const fetchDebugMeta = fetchResult.debugMeta;
      const fetchSkippedNoSession = fetchResult.noSession;
      console.log('[Bootstrap] User farmstands loaded:', userFarmstands.length, '| skipped (no session):', fetchSkippedNoSession);

      // Step 4: Compute analytics summary for user's farmstands
      let analyticsSummary = null;
      if (userFarmstands.length > 0) {
        const farmstandIds = userFarmstands.map((f: Farmstand) => f.id);

        // Seed analytics for farmstands that don't have data yet
        const analyticsStore = useAnalyticsStore.getState();
        for (const farmstandId of farmstandIds) {
          const existingStats = analyticsStore.getFarmstandTotalStats(farmstandId);
          if (!existingStats) {
            console.log('[Bootstrap] Seeding analytics for farmstand:', farmstandId);
            await analyticsStore.seedAnalyticsForFarmstand(farmstandId);
          }
        }

        // Now compute summary
        analyticsSummary = computeAnalyticsSummary(farmstandIds, useAnalyticsStore.getState());
        console.log('[Bootstrap] Analytics summary:', analyticsSummary);
      }

      // Step 5: Update admin store with user's farmstands (merge into allFarmstands)
      // This ensures my-farmstand screen can find them immediately
      const adminStore = useAdminStore.getState();
      const existingFarmstands = adminStore.allFarmstands;

      // Merge: replace existing farmstands with fresh data, add new ones
      const farmstandMap = new Map(existingFarmstands.map((f) => [f.id, f]));
      for (const farmstand of userFarmstands) {
        farmstandMap.set(farmstand.id, farmstand);
      }
      const mergedFarmstands = Array.from(farmstandMap.values());

      // Update admin store directly (bypass loadAdminData to avoid full refetch)
      useAdminStore.setState({ allFarmstands: mergedFarmstands });
      console.log('[Bootstrap] Updated admin store with', mergedFarmstands.length, 'total farmstands');

      // Complete bootstrap.
      // CRITICAL: if the farmstand fetch was skipped because getValidSession() returned null
      // (token expired, refresh failed at cold-launch time), set status='idle' — NOT 'loaded'.
      // 'idle' signals screens that a fetch hasn't run yet and they should retry once
      // AuthProvider has a valid session. Setting 'loaded' with 0 farmstands would cause
      // MyFarmstand to show "No Farmstand" even though the user has one.
      const farmstandsStatus = fetchSkippedNoSession ? 'idle' : 'loaded';
      console.log('[Bootstrap] Bootstrap complete! farmstandsStatus:', farmstandsStatus);
      set({
        status: 'ready',
        appReady: true,
        userFarmstandsStatus: farmstandsStatus,
        userFarmstandsError: null,
        userFarmstandsLoading: false,
        userFarmstands,
        analyticsSummary,
        profileDebugInfo: {
          authUid: user.id ?? null,
          supabaseProjectRef: getSupabaseProjectRef(),
          farmstandCount: userFarmstands.length,
          farmstandIds: userFarmstands.map((f: Farmstand) => f.id),
          dataSource: fetchSkippedNoSession ? 'skipped — no session at bootstrap' : fetchDebugMeta.dataSource,
          lastFetchAt: new Date().toISOString(),
          fetchError: fetchDebugMeta.fetchError,
        },
      });
    } catch (error) {
      console.error('[Bootstrap] Bootstrap error:', error);
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        appReady: true, // Still mark as ready so app doesn't hang
        userFarmstandsStatus: 'error',
        userFarmstandsError: error instanceof Error ? error.message : 'Unknown error',
        userFarmstandsLoading: false,
        userFarmstands: [],
      });
    }
  },

  // Refresh user's farmstands from Supabase (stale-while-revalidate).
  // Cached data is kept visible during the fetch — the card never disappears.
  // Call this on profile focus, app foreground, or after a claim change.
  refreshUserFarmstands: async (accessToken?: string) => {
    const user = useUserStore.getState().user;
    if (!user?.id) {
      console.log('[Bootstrap] refreshUserFarmstands — no user, skipping');
      return;
    }

    // In-flight guard: useFocusEffect + AppState can both fire close together
    if (_refreshInFlight) {
      console.log('[Bootstrap] refreshUserFarmstands already in flight — skipping');
      return;
    }
    setRefreshInFlight(true);

    const userId = user.id;
    const currentState = useBootstrapStore.getState();
    console.log('[Bootstrap] refreshUserFarmstands START — userId:', userId, '| project:', getSupabaseProjectRef(), '| currentStatus:', currentState.userFarmstandsStatus, '| inMemory:', currentState.userFarmstands.length);

    try {
      // -----------------------------------------------------------------------
      // Account switch detection: if this is a different user than last load,
      // clear the in-memory store so we never flash the previous user's cards.
      // Then immediately populate from the new user's AsyncStorage cache.
      // -----------------------------------------------------------------------
      const isUserSwitch = currentState.lastLoadedUserId !== null && currentState.lastLoadedUserId !== userId;

      if (isUserSwitch) {
        console.log('[Bootstrap] User switch detected — clearing previous user farmstands');
        set({
          userFarmstands: [],
          userFarmstandsStatus: 'loading',
          userFarmstandsLoading: true,
          lastLoadedUserId: userId,
        });
      }

      // Load from AsyncStorage cache for this user so the card appears instantly.
      // Only populate if we don't already have in-memory data for this user.
      // EXCEPTION: if the status is already 'loaded' (e.g. set by purgeDeletedFarmstandFromBootstrap
      // after a delete), do NOT restore from cache — the in-memory state is already authoritative.
      // Restoring from cache here would flash the deleted farmstand before the fresh Supabase fetch.
      const alreadyLoadedEmpty = currentState.userFarmstandsStatus === 'loaded' && currentState.userFarmstands.length === 0;
      const hasInMemoryData = !isUserSwitch && (currentState.userFarmstands.length > 0 || alreadyLoadedEmpty);
      if (!hasInMemoryData) {
        const cached = await readFarmstandCache(userId);
        if (cached && cached.length > 0) {
          console.log('[Bootstrap] Restored', cached.length, 'farmstand(s) from cache for user', userId, '(status will be loading until Supabase confirms)');
          // Build minimal Farmstand objects from cache for immediate display.
          // These will be replaced by the full Supabase result below.
          const cachedFarmstands = cached.map((c) => cachedCardToFarmstand(c));
          set({
            userFarmstands: cachedFarmstands,
            userFarmstandsStatus: 'loading', // still fetching fresh data
            userFarmstandsLoading: true,
            lastLoadedUserId: userId,
          });
        } else {
          // No cache — set loading so skeleton shows instead of empty state
          set({
            userFarmstands: [],
            userFarmstandsStatus: 'loading',
            userFarmstandsLoading: true,
            lastLoadedUserId: userId,
          });
        }
      } else {
        // We already have data in memory (or status=loaded/empty after delete) —
        // mark as loading for the background fetch but keep the existing state.
        // If alreadyLoadedEmpty, keep userFarmstands=[] (do NOT restore from cache).
        set({
          userFarmstandsStatus: 'loading',
          userFarmstandsLoading: true,
          lastLoadedUserId: userId,
        });
      }

      // Background fetch from Supabase — pass through the caller-provided token if any
      const { farmstands: freshFarmstands, noSession, debugMeta } = await fetchUserFarmstandsFromSupabase(userId, accessToken);
      console.log('[Bootstrap] refreshUserFarmstands DONE — userId:', userId, '| farmstands:', freshFarmstands.length, '| noSession:', noSession, '| ids:', freshFarmstands.map((f) => f.id).join(', ') || 'none', '| error:', debugMeta.fetchError || 'none');

      // If the fetch was skipped because there's still no valid session, keep status='idle'
      // so the screen knows to retry. Don't overwrite any cached data.
      if (noSession) {
        console.log('[Bootstrap] refreshUserFarmstands — still no session, leaving status as idle');
        set({ userFarmstandsStatus: 'idle', userFarmstandsLoading: false });
        return;
      }

      // Persist fresh result to AsyncStorage cache for next app launch
      await writeFarmstandCache(userId, freshFarmstands);

      // Update store with authoritative data
      set({
        userFarmstandsStatus: 'loaded',
        userFarmstandsError: null,
        userFarmstandsLoading: false,
        userFarmstands: freshFarmstands,
        lastLoadedUserId: userId,
        profileDebugInfo: {
          authUid: userId,
          supabaseProjectRef: getSupabaseProjectRef(),
          farmstandCount: freshFarmstands.length,
          farmstandIds: freshFarmstands.map((f) => f.id),
          dataSource: debugMeta.dataSource,
          lastFetchAt: new Date().toISOString(),
          fetchError: debugMeta.fetchError,
        },
      });

      // Sync into admin store: replace the user's farmstands but keep all others
      const adminStore = useAdminStore.getState();
      const otherFarmstands = adminStore.allFarmstands.filter(
        (f) => f.ownerUserId !== userId && f.claimedByUserId !== userId
      );
      useAdminStore.setState({ allFarmstands: [...otherFarmstands, ...freshFarmstands] });
    } catch (refreshErr) {
      console.log('[Bootstrap] refreshUserFarmstands error:', refreshErr);
      // On error, keep whatever data we already have visible (don't clear the card).
      // Mark as loaded so the UI doesn't stay in a permanent loading state.
      const existingFarmstands = useBootstrapStore.getState().userFarmstands;
      set({
        userFarmstandsStatus: existingFarmstands.length > 0 ? 'loaded' : 'error',
        userFarmstandsError: refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
        userFarmstandsLoading: false,
        // Keep existing farmstands — don't wipe them on a transient error
      });
    } finally {
      setRefreshInFlight(false);
    }
  },

  reset: () => {
    set({
      status: 'idle',
      appReady: false,
      error: null,
      lastLoadedUserId: null,
      userFarmstandsStatus: 'idle',
      userFarmstandsError: null,
      userFarmstandsLoading: false,
      userFarmstands: [],
      analyticsSummary: null,
      profileDebugInfo: {
        authUid: null,
        supabaseProjectRef: '',
        farmstandCount: 0,
        farmstandIds: [],
        dataSource: 'not yet fetched',
        lastFetchAt: null,
        fetchError: null,
      },
    });
  },
}));

// Selector for appReady state
export const selectAppReady = (state: BootstrapState) => state.appReady;
export const selectBootstrapStatus = (state: BootstrapState) => state.status;
export const selectUserFarmstands = (state: BootstrapState) => state.userFarmstands;
export const selectUserFarmstandsLoading = (state: BootstrapState) => state.userFarmstandsLoading;
export const selectUserFarmstandsStatus = (state: BootstrapState) => state.userFarmstandsStatus;
export const selectAnalyticsSummary = (state: BootstrapState) => state.analyticsSummary;

/**
 * Immediately remove a deleted farmstand from bootstrap store state and
 * clear it from the per-user AsyncStorage cache.
 *
 * Call this after any delete action (admin or owner) so Profile and
 * My-Farmstand screens instantly reflect the deletion without waiting for
 * the next focus-triggered refresh.
 */
export async function purgeDeletedFarmstandFromBootstrap(farmstandId: string): Promise<void> {
  const state = useBootstrapStore.getState();

  // Remove from in-memory list
  const updated = state.userFarmstands.filter((f) => f.id !== farmstandId);
  const changed = updated.length !== state.userFarmstands.length;

  if (changed) {
    useBootstrapStore.setState({
      userFarmstands: updated,
      // Keep status as 'loaded' so Profile shows the (now empty) authoritative result
      userFarmstandsStatus: 'loaded',
      userFarmstandsLoading: false,
    });
    console.log('[Bootstrap] purgeDeletedFarmstandFromBootstrap — removed', farmstandId, '| remaining:', updated.length, '| status set to loaded');
    console.log('[Bootstrap] LOCAL STATE CLEAR COMPLETE — userFarmstands:', updated.length, '| userFarmstandsStatus: loaded');
  } else {
    console.log('[Bootstrap] purgeDeletedFarmstandFromBootstrap — farmstand', farmstandId, 'was not in in-memory state (already cleared or never loaded)');
  }

  // Also clear AsyncStorage cache for all users (we don't know which user
  // owns this farmstand from the admin context, so scan all cache keys).
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((k) => k.startsWith(CACHE_PREFIX));
    let cacheCleared = false;
    for (const key of cacheKeys) {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed: FarmstandCardCache = JSON.parse(raw);
        const hadFarmstand = parsed.farmstands.some((f) => f.id === farmstandId);
        if (hadFarmstand) {
          parsed.farmstands = parsed.farmstands.filter((f) => f.id !== farmstandId);
          await AsyncStorage.setItem(key, JSON.stringify(parsed));
          console.log('[Bootstrap] purgeDeletedFarmstandFromBootstrap — cleared from cache key:', key);
          cacheCleared = true;
        }
      } catch {
        // Non-fatal — corrupt cache entry
      }
    }
    console.log('[Bootstrap] QUERY INVALIDATION COMPLETE — cache cleared:', cacheCleared, '| farmstandId:', farmstandId);
  } catch {
    // Non-fatal — AsyncStorage scan failure must never break the app
  }
}
