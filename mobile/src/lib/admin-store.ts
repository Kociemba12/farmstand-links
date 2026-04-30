import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Farmstand, FarmstandStatus, GoldVerifiedSource, OwnershipDisputeStatus, PremiumStatus, OperatingStatus } from './farmer-store';
import { evaluateGoldVerification, setGoldVerifiedManually, returnToAutomatic, handleDisputeStatusChange } from './gold-verification';
import { supabase, isSupabaseConfigured, hasActiveSession, refreshSupabaseSession, ensureSessionReady, getValidSession, forceReloadSession, getSupabaseUrl } from './supabase';
import { createAlert } from './alerts-store';
import { readCache, writeCache, CACHE_KEYS, setFetchInFlight, isFetchInFlight } from './farmstand-cache';

// UUID validation helper - only call Supabase RPCs or updates if ID is a valid UUID
const isUuid = (v?: string | null): boolean =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

// Generate a random 6-character verification code
export function generateVerificationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Map Supabase snake_case response to camelCase Farmstand type
 * Handles both snake_case from DB and existing camelCase
 */
const mapSupabaseFarmstand = (row: Record<string, unknown>): Farmstand => {
  const now = new Date().toISOString();

  // Helper to get value from either snake_case or camelCase key
  // Returns defaultValue if the value is undefined OR null
  const get = <T>(snakeKey: string, camelKey: string, defaultValue: T): T => {
    if (row[snakeKey] !== undefined && row[snakeKey] !== null) return row[snakeKey] as T;
    if (row[camelKey] !== undefined && row[camelKey] !== null) return row[camelKey] as T;
    return defaultValue;
  };

  // owner_id is the authoritative ownership column (set when claim is approved)
  // claimed_by is a legacy/secondary field - fall back to it if owner_id is missing
  const ownerId = (row['owner_id'] ?? null) as string | null;
  const claimedBy = (row['claimed_by'] ?? row['claimedByUserId'] ?? null) as string | null;
  // The effective owner is owner_id first, then claimed_by as fallback
  const effectiveOwnerId = ownerId ?? claimedBy;

  return {
    id: get('id', 'id', ''),
    // ownerUserId maps from owner_id column (authoritative) or owner_user_id (legacy)
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
    status: get('status', 'status', 'active') as FarmstandStatus,
    operationalStatus: get('operational_status', 'operationalStatus', 'active'),
    operatingStatus: get('operating_status', 'operatingStatus', 'open') as OperatingStatus,
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
    // claimStatus: owner_id is the authoritative ownership field.
    // If owner_id is set => 'claimed'. Fall back to DB claim_status, then claimed_by.
    claimStatus: effectiveOwnerId
      ? 'claimed'
      : (row['claim_status'] === 'pending' ? 'pending' : 'unclaimed'),
    verificationCode: get('verification_code', 'verificationCode', null),
    claimedAt: get('claimed_at', 'claimedAt', null),
    goldVerified: get('gold_verified', 'goldVerified', false),
    goldVerifiedSource: get('gold_verified_source', 'goldVerifiedSource', 'none'),
    ownershipDisputeStatus: get('ownership_dispute_status', 'ownershipDisputeStatus', 'none'),
    lastActivityAt: get('last_activity_at', 'lastActivityAt', null),
    reviewCount: get('review_count', 'reviewCount', 0),
    avgRating: get('avg_rating', 'avgRating', 0),
    verificationStatus: get('verification_status', 'verificationStatus', 'VERIFIED'),
    visibilityStatus: get('visibility_status', 'visibilityStatus', 'PUBLIC'),
    createdByUserId: get('created_by_user_id', 'createdByUserId', null),
    // claimedByUserId uses effectiveOwnerId (owner_id ?? claimed_by)
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
    // Hero image fields
    heroPhotoUrl: get('hero_photo_url', 'heroPhotoUrl', null),
    aiPhotoUrl: get('ai_photo_url', 'aiPhotoUrl', null),
    heroImageUrl: get('hero_image_url', 'heroImageUrl', null),
    heroImageTheme: get('hero_image_theme', 'heroImageTheme', null),
    heroImageSeed: get('hero_image_seed', 'heroImageSeed', null),
    heroImageGeneratedAt: get('hero_image_generated_at', 'heroImageGeneratedAt', null),
    // Main product AI image fields
    mainProduct: get('main_product', 'mainProduct', null),
    aiImageUrl: get('ai_image_url', 'aiImageUrl', null),
    aiImageSeed: get('ai_image_seed', 'aiImageSeed', null),
    aiImageUpdatedAt: get('ai_image_updated_at', 'aiImageUpdatedAt', null),
    // Legacy photo columns
    photoUrl: get('photo_url', 'photoUrl', null),
    imageUrl: get('image_url', 'imageUrl', null),
    // Smart card image fields
    primaryImageMode: get('primary_image_mode', 'primaryImageMode', 'ai_fallback'),
    fallbackImageKey: get('fallback_image_key', 'fallbackImageKey', null),
    // Soft delete field
    deletedAt: get('deleted_at', 'deletedAt', null),
    slug: get('slug', 'slug', null),
    // Premium fields
    premiumStatus: get('premium_status', 'premiumStatus', 'free') as PremiumStatus,
    premiumTrialStartedAt: get('premium_trial_started_at', 'premiumTrialStartedAt', null),
    premiumTrialExpiresAt: get('premium_trial_expires_at', 'premiumTrialExpiresAt', null),
    isSeasonal: get('is_seasonal', 'isSeasonal', false),
    // Video fields (premium feature)
    videoUrl: get('video_url', 'videoUrl', null),
    videoPath: get('video_path', 'videoPath', null),
    videoDurationSeconds: get('video_duration_seconds', 'videoDurationSeconds', null),
    // Internal contact fields (admin-only, never shown publicly)
    internalContactPhone: (row['internal_contact_phone'] ?? row['internalContactPhone'] ?? null) as string | null,
    internalContactEmail: (row['internal_contact_email'] ?? row['internalContactEmail'] ?? null) as string | null,
    // ── Raw snake_case sort fields — preserved directly from DB columns ──
    // The camelCase aliases (clicks30d/saves30d) map wrong DB columns; use real column names here.
    avg_rating: (row['avg_rating'] as number | null) ?? 0,
    review_count: (row['review_count'] as number | null) ?? 0,
    view_count: (row['view_count'] as number | null) ?? 0,
    saved_count: (row['saved_count'] as number | null) ?? 0,
    updated_at: (row['updated_at'] as string | null) ?? null,
    last_activity_at: (row['last_activity_at'] as string | null) ?? null,
  };
};

export type UserStatus = 'active' | 'suspended';

/**
 * BackendUser — shape returned by GET /api/admin/users.
 * Admin accounts are already excluded by the backend; this list contains
 * only farmers, premium users, and consumers.
 * Shared between the Admin Dashboard tile count and the Manage Users screen.
 */
export interface BackendUser {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'farmer' | 'consumer';
  status: 'active' | 'suspended';
  avatar_url: string | null;
  created_at: string;
  farmstand_count: number;
  is_premium: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'farmer' | 'consumer';
  status: UserStatus;
  createdAt: string;
  farmstandCount: number;
}

export interface FarmstandRequest {
  id: string;
  farmstandId: string;
  farmstandName: string;
  ownerName: string;
  ownerEmail: string;
  requestType: 'new' | 'update';
  submittedAt: string;
  status: 'pending' | 'approved' | 'denied';
  notes?: string;
}

export type ReportType = 'inappropriate' | 'spam' | 'inaccurate' | 'offensive' | 'other';

export interface FlaggedContent {
  id: string;
  type: 'review' | 'farmstand';
  contentId: string;
  contentPreview: string; // Preview of the reported content
  farmstandId: string; // The farmstand associated with this content
  farmstandName: string;
  reason: ReportType;
  details: string | null; // Additional details provided by reporter
  reportedBy: string | null; // User ID (null when not signed in)
  reportedByName: string; // User name for display
  createdAt: string;
  status: 'pending' | 'resolved' | 'dismissed';
  resolvedAt: string | null;
  resolvedBy: string | null;
  adminNote: string | null;
}

// New unified type for all reports and flags
export type SubmissionType = 'review' | 'report';
export type ReportedItemType = 'app' | 'farmstand' | 'user';
export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';

export interface ReportAndFlag {
  id: string;
  submissionType: SubmissionType;
  reportedItemType: ReportedItemType;
  reportedItemId: string | null;
  reportedItemName: string;
  rating: number | null; // For reviews only
  reason: string;
  comments: string;
  submittedByUserId: string | null; // null when user not signed in
  submittedByUserEmail: string;
  status: ReportStatus;
  createdAt: string;
  sourceScreen: string;
  // Admin fields
  reviewedAt: string | null;
  reviewedBy: string | null;
  adminNote: string | null;
}

export type ClaimRequestStatus = 'pending' | 'approved' | 'denied' | 'needs_more_info';
export type RequesterRole = 'owner' | 'manager';

// Support Ticket System Types
export type TicketStatus = 'pending' | 'open' | 'waiting_on_farmer' | 'waiting_on_admin' | 'resolved' | 'reopened';
export type SenderRole = 'farmer' | 'admin';

export interface SupportTicket {
  ticketId: string;
  reportId: string; // links to ReportsAndFlags.id
  createdAt: string;
  updatedAt: string;
  status: TicketStatus;
  farmerUserId: string | null; // null when user not signed in
  farmerEmail: string;
  subject: string;
  category: string;
  rating: number | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  assignedAdminId: string | null;
  assignedAdminEmail: string | null;
}

export interface SupportMessage {
  messageId: string;
  ticketId: string; // links to SupportTickets.ticketId
  senderRole: SenderRole;
  senderUserId: string | null; // null when user not signed in
  senderEmail: string;
  messageText: string;
  createdAt: string;
  editedAt: string | null;
  isEdited: boolean;
  isVisibleToFarmer: boolean;
  attachmentUrl: string | null;
}

export interface ClaimRequest {
  id: string;
  farmstand_id: string;
  requester_id: string | null; // UUID of requester (renamed from requester_user_id)
  requester_name: string;
  requester_email: string;
  notes: string | null;
  evidence_urls: string[];
  status: ClaimRequestStatus;
  reviewed_at: string | null;
  reviewed_by: string | null; // UUID of admin who reviewed (actual column name)
  admin_message?: string | null; // Message written by admin when denying or requesting more info
  created_at: string;
  farmstand_name?: string | null; // Populated by get_pending_claims_for_admin RPC
}

// SINGLE SOURCE OF TRUTH: Status filters for pending approvals
// Used by both Dashboard and Pending Approvals screens
export const PENDING_FARMSTAND_STATUS = 'pending' as const;

/**
 * Get all farmstands that need approval review
 * Single source of truth used by Dashboard and Pending Approvals screens
 *
 * IMPORTANT: Only farmstands with status='pending' AND deleted_at IS NULL are shown.
 * - status='pending' = waiting for approval (show in Pending Approvals)
 * - status='approved'/'active' = visible in Manage Farmstands + app
 * - status='denied' = hidden everywhere (never appears in any list)
 * - deleted_at IS NOT NULL = soft-deleted, hidden everywhere
 */
export function getPendingFarmstands(allFarmstands: Farmstand[]): Farmstand[] {
  // ONLY show farmstands where status = 'pending' AND deleted_at IS NULL
  // Denied or soft-deleted farmstands should NEVER appear here
  return allFarmstands.filter((f) => f.status === PENDING_FARMSTAND_STATUS && !f.deletedAt);
}

/**
 * Get count of pending approvals
 * Single source of truth used by Dashboard tile and Pending Approvals header
 */
export function getPendingApprovalsCount(allFarmstands: Farmstand[]): number {
  return getPendingFarmstands(allFarmstands).length;
}

// Analytics state for dashboard counts - fetched directly from Supabase
export interface AdminAnalytics {
  totalFarmstands: number;
  pendingApprovals: number;
  approvedFarmstands: number;
  mappableFarmstands: number;
  isLoading: boolean;
  lastFetchedAt: string | null;
}

interface AdminState {
  allFarmstands: Farmstand[];
  users: AdminUser[];
  farmstandRequests: FarmstandRequest[];
  flaggedContent: FlaggedContent[];
  reportsAndFlags: ReportAndFlag[]; // NEW: Unified reports and flags
  claimRequests: ClaimRequest[];
  supportTickets: SupportTicket[]; // Support conversation tickets
  supportMessages: SupportMessage[]; // Support conversation messages
  isLoading: boolean;

  // Cache metadata for stale-while-revalidate
  farmstandsSource: 'empty' | 'cache' | 'network'; // where current allFarmstands came from
  farmstandsFetchedAt: string | null; // ISO timestamp of last network fetch
  farmstandsCacheAgeMs: number; // ms since last fetch (updated on load)

  // Analytics state - separate from allFarmstands to prevent flicker
  analytics: AdminAnalytics;
  _analyticsRequestId: number; // Internal: for stale-request guard

  // Optimistic claim overrides — keyed by farmstandId
  // Applied instantly on submit/deny so UI never shows stale state
  claimOverrides: Record<string, {
    claimStatus: 'unclaimed' | 'pending' | 'claimed';
    ownerId: string | null;
    claimedBy: string | null;
    claimedAt: string | null;
    userClaimRequestStatus: 'none' | 'pending' | 'approved' | 'denied';
  }>;

  // Actions
  loadAdminData: () => Promise<void>;
  loadAnalytics: () => Promise<void>; // NEW: Dedicated analytics fetch
  getAllFarmstands: () => Farmstand[];
  getFarmstandById: (id: string) => Farmstand | undefined;
  getFarmstandsByStatus: (status: FarmstandStatus) => Farmstand[];
  searchFarmstands: (query: string) => Farmstand[];

  // Claim overlay helpers — for instant optimistic UI
  applyClaimOverride: (farmstandId: string, override: AdminState['claimOverrides'][string]) => void;
  clearClaimOverride: (farmstandId: string) => void;

  // Farmstand Mutations
  updateFarmstandStatus: (id: string, status: FarmstandStatus) => Promise<void>;
  updateFarmstand: (id: string, updates: Partial<Farmstand>) => Promise<void>;
  refreshSingleFarmstand: (id: string) => Promise<Farmstand | null>; // Re-fetch one farmstand from Supabase and update store
  deleteFarmstand: (id: string) => Promise<void>;
  ownerDeleteFarmstand: (farmstandId: string, userId: string) => Promise<{ success: boolean; error?: string }>;
  duplicateFarmstand: (id: string) => Promise<string>;
  createFarmstand: (farmstand: Omit<Farmstand, 'id' | 'updatedAt'> & { id?: string }) => Promise<string>;
  importFarmstands: () => Promise<{ success: boolean; importedCount: number; error?: string }>;

  // User Mutations
  updateUserRole: (id: string, role: 'admin' | 'farmer' | 'consumer') => Promise<void>;
  updateUserStatus: (id: string, status: UserStatus) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;

  // ── Managed Users — single shared source of truth ──────────────────────────
  // Both the Admin Dashboard tile count and the Manage Users screen read from here.
  // Populated by loadManagedUsers(); backend already strips admin accounts.
  managedUsers: BackendUser[];
  loadManagedUsers: () => Promise<{ error?: string }>;
  setManagedUsers: (users: BackendUser[]) => void;
  // Optimistic mutations for managedUsers
  patchManagedUserRole: (id: string, role: BackendUser['role']) => void;
  patchManagedUserStatus: (id: string, status: BackendUser['status']) => void;
  removeManagedUser: (id: string) => void;
  // Optimistically clears ownership fields on a farmstand after admin removes ownership
  clearFarmstandOwnership: (farmstandId: string) => void;
  // Fully purges a farmstand from all local stores after admin delete (remove from profile, map, manage users)
  purgeFarmstandAfterAdminRemove: (farmstandId: string) => Promise<void>;

  // Request Mutations
  approveRequest: (requestId: string) => Promise<void>;
  denyRequest: (requestId: string, reason?: string) => Promise<void>;

  // Claim Mutations (legacy with verification code)
  claimFarmstand: (farmstandId: string, userId: string, verificationCode: string) => Promise<{ success: boolean; error?: string }>;

  // Instant Claim - auto-assigns to logged-in user (no verification code needed)
  claimFarmstandInstantly: (farmstandId: string, userId: string) => Promise<{ success: boolean; error?: string }>;

  // Claim Request Mutations (new workflow)
  submitClaimRequest: (request: Omit<ClaimRequest, 'id' | 'created_at' | 'status' | 'reviewed_at' | 'reviewed_by'>) => Promise<{ success: boolean; error?: string }>;
  getPendingClaimRequests: () => ClaimRequest[];
  approveClaimRequest: (requestId: string, adminId: string) => Promise<{ success: boolean; error?: string }>;
  denyClaimRequest: (requestId: string, adminId: string, message?: string) => Promise<{ success: boolean; error?: string }>;
  requestMoreInfo: (requestId: string, adminId: string, note: string) => Promise<{ success: boolean; error?: string }>;
  getClaimRequestsForFarmstand: (farmstandId: string) => ClaimRequest[];

  // Flagged Content / Reports Mutations (LEGACY - kept for backward compatibility)
  submitReport: (report: Omit<FlaggedContent, 'id' | 'createdAt' | 'status' | 'resolvedAt' | 'resolvedBy' | 'adminNote'>) => Promise<{ success: boolean; error?: string }>;
  getPendingReports: () => FlaggedContent[];
  getAllReports: () => FlaggedContent[];
  resolveReport: (reportId: string, adminId: string, adminNote?: string) => Promise<{ success: boolean; error?: string }>;
  dismissReport: (reportId: string, adminId: string, adminNote?: string) => Promise<{ success: boolean; error?: string }>;

  // NEW: Reports & Flags Methods (unified system)
  submitReportOrReview: (submission: Omit<ReportAndFlag, 'id' | 'createdAt' | 'status' | 'reviewedAt' | 'reviewedBy' | 'adminNote'>) => Promise<{ success: boolean; error?: string }>;
  getAllReportsAndFlags: () => ReportAndFlag[];
  getReportsAndFlagsByStatus: (status: ReportStatus) => ReportAndFlag[];
  markReportAsReviewed: (reportId: string, adminId: string, adminNote?: string) => Promise<{ success: boolean; error?: string }>;
  resolveReportAndFlag: (reportId: string, adminId: string, adminNote?: string) => Promise<{ success: boolean; error?: string }>;
  dismissReportAndFlag: (reportId: string, adminId: string, adminNote?: string) => Promise<{ success: boolean; error?: string }>;

  // Support Ticket System Methods
  createSupportTicket: (reportId: string, farmerUserId: string | null, farmerEmail: string, subject: string, category: string, rating: number | null, initialMessage: string) => Promise<{ success: boolean; ticketId?: string; error?: string }>;
  getTicketByReportId: (reportId: string) => SupportTicket | undefined;
  getTicketById: (ticketId: string) => SupportTicket | undefined;
  getAllSupportTickets: () => SupportTicket[];
  getTicketsByFarmerUserId: (farmerUserId: string) => SupportTicket[];
  /** Returns only support/admin tickets for a user — review notifications excluded at the data level. */
  getSupportTicketsByFarmerUserId: (farmerUserId: string) => SupportTicket[];
  getTicketsByStatus: (status: TicketStatus) => SupportTicket[];
  updateTicketStatus: (ticketId: string, status: TicketStatus) => Promise<{ success: boolean; error?: string }>;
  resolveTicket: (ticketId: string, adminId: string) => Promise<{ success: boolean; error?: string }>;
  reopenTicket: (ticketId: string, adminId: string) => Promise<{ success: boolean; error?: string }>;

  // Support Message Methods
  getMessagesByTicketId: (ticketId: string) => SupportMessage[];
  sendAdminMessage: (ticketId: string, adminUserId: string, adminEmail: string, messageText: string) => Promise<{ success: boolean; error?: string }>;
  sendFarmerMessage: (ticketId: string, farmerUserId: string, farmerEmail: string, messageText: string) => Promise<{ success: boolean; error?: string }>;
  editAdminMessage: (messageId: string, newText: string) => Promise<{ success: boolean; error?: string }>;

  // Gold Verification Methods
  evaluateGoldVerificationForFarmstand: (farmstandId: string) => Promise<{ success: boolean; error?: string }>;
  evaluateAllFarmstandsGoldVerification: () => Promise<void>;
  setGoldVerifiedAdmin: (farmstandId: string, goldVerified: boolean, adminId: string) => Promise<{ success: boolean; error?: string }>;
  returnToAutomaticGoldVerification: (farmstandId: string, adminId: string) => Promise<{ success: boolean; error?: string }>;
  updateFarmstandDisputeStatus: (farmstandId: string, status: OwnershipDisputeStatus, adminId: string) => Promise<{ success: boolean; error?: string }>;
  updateFarmstandReviewStats: (farmstandId: string, reviewCount: number, avgRating: number) => Promise<void>;
  logGoldVerificationAction: (farmstandId: string, adminId: string, action: string) => Promise<void>;

  // Verification Workflow Methods
  verifyFarmstandSubmission: (farmstandId: string, adminId: string) => Promise<{ success: boolean; error?: string }>;
  rejectFarmstandSubmission: (farmstandId: string, adminId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  requestMoreInfoForSubmission: (farmstandId: string, adminId: string, note: string) => Promise<{ success: boolean; error?: string }>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  allFarmstands: [],
  users: [],
  managedUsers: [],          // non-admin users; shared by Dashboard tile + Manage Users screen
  farmstandRequests: [],
  flaggedContent: [],
  reportsAndFlags: [],
  claimRequests: [],
  supportTickets: [],
  supportMessages: [],
  isLoading: false,

  // Cache metadata
  farmstandsSource: 'empty',
  farmstandsFetchedAt: null,
  farmstandsCacheAgeMs: Infinity,

  // Optimistic claim overrides — start empty
  claimOverrides: {},

  // Analytics state - separate counts to prevent flicker
  analytics: {
    totalFarmstands: 0,
    pendingApprovals: 0,
    approvedFarmstands: 0,
    mappableFarmstands: 0,
    isLoading: false,
    lastFetchedAt: null,
  },
  _analyticsRequestId: 0,

  // Dedicated analytics fetch with stale-request guard
  loadAnalytics: async () => {
    const currentRequestId = get()._analyticsRequestId + 1;
    set((state) => ({
      _analyticsRequestId: currentRequestId,
      analytics: { ...state.analytics, isLoading: true },
    }));

    console.log('[Analytics] Fetch start - requestId:', currentRequestId);

    try {
      if (!isSupabaseConfigured()) {
        console.log('[Analytics] Supabase not configured, using local counts');
        const farmstands = get().allFarmstands;

        // Stale-request guard
        if (get()._analyticsRequestId !== currentRequestId) {
          console.log('[Analytics] Stale request, ignoring results');
          return;
        }

        // Exclude denied AND soft-deleted farmstands from total count
        const nonDeniedFarmstands = farmstands.filter((f) => f.status !== 'denied' && !f.deletedAt);

        const counts = {
          totalFarmstands: nonDeniedFarmstands.length,
          pendingApprovals: farmstands.filter((f) => f.status === 'pending' && !f.deletedAt).length,
          approvedFarmstands: farmstands.filter((f) => f.status === 'active' && !f.deletedAt).length,
          mappableFarmstands: farmstands.filter((f) => f.status === 'active' && !f.deletedAt && f.latitude != null && f.longitude != null).length,
          isLoading: false,
          lastFetchedAt: new Date().toISOString(),
        };

        console.log('[Analytics] Local counts:', counts);
        set({ analytics: counts });
        return;
      }

      // Fetch counts directly from Supabase with specific queries
      console.log('[Analytics] Fetching from Supabase farmstands table...');

      // Total: count all NON-denied AND non-deleted farmstands
      // Query farmstands TABLE directly for consistent filtering
      const { data: totalData, error: totalError } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .select('id')
        .neq('status', 'denied')
        .is('deleted_at', 'null')
        .execute();

      // Pending: status = 'pending' AND deleted_at IS NULL
      const { data: pendingData, error: pendingError } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .select('id')
        .eq('status', 'pending')
        .is('deleted_at', 'null')
        .execute();

      // Approved: status = 'active' AND deleted_at IS NULL
      const { data: approvedData, error: approvedError } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .select('id')
        .eq('status', 'active')
        .is('deleted_at', 'null')
        .execute();

      // Mappable: status = 'active' AND lat/lng not null AND deleted_at IS NULL
      const { data: activeData, error: activeError } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .select('id,latitude,longitude')
        .eq('status', 'active')
        .is('deleted_at', 'null')
        .execute();

      // Filter mappable (has valid coordinates) locally
      const mappableCount = activeData?.filter(
        (f) => f.latitude != null && f.longitude != null
      ).length ?? 0;

      // Stale-request guard: only apply results if this is still the latest request
      if (get()._analyticsRequestId !== currentRequestId) {
        console.log('[Analytics] Stale request after fetch, ignoring results - currentRequestId:', currentRequestId, 'latestRequestId:', get()._analyticsRequestId);
        return;
      }

      const counts = {
        totalFarmstands: totalError ? 0 : (totalData?.length ?? 0),
        pendingApprovals: pendingError ? 0 : (pendingData?.length ?? 0),
        approvedFarmstands: approvedError ? 0 : (approvedData?.length ?? 0),
        mappableFarmstands: activeError ? 0 : mappableCount,
        isLoading: false,
        lastFetchedAt: new Date().toISOString(),
      };

      console.log('[Analytics] Fetch end - counts:', {
        total: counts.totalFarmstands,
        pending: counts.pendingApprovals,
        approved: counts.approvedFarmstands,
        mappable: counts.mappableFarmstands,
      });

      if (totalError) console.error('[Analytics] Total query error:', totalError);
      if (pendingError) console.error('[Analytics] Pending query error:', pendingError);
      if (approvedError) console.error('[Analytics] Approved query error:', approvedError);
      if (activeError) console.error('[Analytics] Active/Mappable query error:', activeError);

      set({ analytics: counts });
    } catch (error) {
      console.error('[Analytics] Fetch error:', error);

      // Stale-request guard
      if (get()._analyticsRequestId !== currentRequestId) return;

      set((state) => ({
        analytics: { ...state.analytics, isLoading: false },
      }));
    }
  },

  loadAdminData: async () => {
    // ── STALE-WHILE-REVALIDATE ─────────────────────────────────────────────
    // 1. Load cached farmstands immediately so the UI renders without waiting
    // 2. Kick off a background network fetch
    // 3. On success: replace cached data + update cache
    // 4. On failure: keep cached data visible, do NOT blank the UI
    // ──────────────────────────────────────────────────────────────────────

    const queryKey = CACHE_KEYS.EXPLORE; // shared key for the full farmstand list

    // In-flight guard: skip if a fetch is already running for this key
    if (isFetchInFlight(queryKey)) {
      console.log('[AdminStore] loadAdminData skipped (inFlight guard)');
      return;
    }

    // ── Step 1: Serve cached data immediately (no loading spinner) ──
    const cached = await readCache(queryKey);
    if (cached.data.length > 0) {
      // Only restore cache if the store has never loaded real data (source === 'empty').
      // IMPORTANT: do NOT use allFarmstands.length > 0 as the guard — the bootstrap
      // process may have injected only the user's own farmstand(s) into allFarmstands
      // before loadAdminData runs, making length > 0 even though we have no real cached
      // or network data yet. farmstandsSource stays 'empty' until we explicitly set it,
      // so it correctly identifies a store that has never been loaded by this function.
      const currentSource = get().farmstandsSource;
      if (currentSource === 'empty') {
        console.log(`[AdminStore] Serving ${cached.data.length} cached farmstands instantly (age: ${Math.round(cached.cacheAgeMs / 1000)}s)`);
        // Upsert: merge cached list with anything bootstrap may have injected (e.g. user's
        // own farmstand with fresh data from farmstand_owners JOIN). This way the cache
        // never downgrades a fresh bootstrap record to a stale cached one.
        const bootstrapped = get().allFarmstands;
        if (bootstrapped.length > 0) {
          const mergeMap = new Map(cached.data.map((f) => [f.id, f]));
          for (const f of bootstrapped) {
            mergeMap.set(f.id, f); // bootstrap record wins over stale cache
          }
          set({
            allFarmstands: Array.from(mergeMap.values()),
            farmstandsSource: 'cache',
            farmstandsFetchedAt: cached.fetchedAt,
            farmstandsCacheAgeMs: cached.cacheAgeMs,
          });
        } else {
          set({
            allFarmstands: cached.data,
            farmstandsSource: 'cache',
            farmstandsFetchedAt: cached.fetchedAt,
            farmstandsCacheAgeMs: cached.cacheAgeMs,
          });
        }
      }
    }

    // ── Step 2: Background network fetch ──
    // Only show isLoading=true when there is truly no data yet
    const hasData = get().allFarmstands.length > 0;
    if (!hasData) {
      set({ isLoading: true });
    }

    setFetchInFlight(queryKey, true);

    try {
      let farmstands: Farmstand[] = [];
      let networkSuccess = false;

      // Supabase is the ONLY source of truth for farmstands
      if (isSupabaseConfigured()) {
        console.log('[AdminStore] FETCH START loadAdminData — querying farmstands table with anon key (public read)');
        const fetchStart = Date.now();
        try {
          // Query the farmstands TABLE directly (not the view) for admin operations
          // Filter out soft-deleted farmstands (deleted_at IS NULL)
          const { data, error } = await supabase
            .from<Record<string, unknown>>('farmstands')
            .select('*')
            .is('deleted_at', 'null')
            .neq('status', 'denied')
            .order('created_at', { ascending: false })
            .execute();

          const fetchDuration = Date.now() - fetchStart;

          if (error) {
            console.log('[AdminStore] FETCH ERROR loadAdminData:', error.message, '| code:', (error as { code?: string }).code);
            console.log('[AdminStore] This may mean AUTH_REQUIRED blocked a public read — check getPublicAuthKey() is used for SELECT');
          } else if (data) {
            console.log(`[AdminStore] FETCH SUCCESS loadAdminData: got ${data.length} farmstands from Supabase in ${fetchDuration}ms`);
            // Map Supabase snake_case to camelCase
            farmstands = data.map(mapSupabaseFarmstand);

            // ── Enrich with real review aggregates (avg_rating, review_count) ──
            // The avg_rating / review_count columns on the farmstands table may be
            // stale (0) if the DB trigger hasn't run. Re-aggregate from farmstand_reviews
            // here so sort-by-rating has real data immediately without a second round-trip.
            try {
              const { data: reviewRows, error: reviewErr } = await supabase
                .from<{ farmstand_id: string; rating: number }>('farmstand_reviews')
                .select('farmstand_id,rating')
                .execute();

              if (!reviewErr && reviewRows && reviewRows.length > 0) {
                const statsByFarm: Record<string, { count: number; sum: number }> = {};
                for (const row of reviewRows) {
                  if (!statsByFarm[row.farmstand_id]) statsByFarm[row.farmstand_id] = { count: 0, sum: 0 };
                  statsByFarm[row.farmstand_id].count++;
                  statsByFarm[row.farmstand_id].sum += row.rating;
                }
                for (const farm of farmstands) {
                  const stats = statsByFarm[farm.id];
                  if (stats) {
                    const avg = Math.round((stats.sum / stats.count) * 10) / 10;
                    farm.reviewCount = stats.count;
                    farm.avgRating = avg;
                    // Keep snake_case sort fields in sync
                    farm.avg_rating = avg;
                    farm.review_count = stats.count;
                  }
                }
                console.log(`[AdminStore] Enriched ${Object.keys(statsByFarm).length} farmstands with live review stats`);
              } else if (reviewErr) {
                console.log('[AdminStore] Review enrichment query failed:', reviewErr.message);
              } else {
                console.log('[AdminStore] No reviews found — avg_rating will be 0 for all farmstands');
              }
            } catch (enrichErr) {
              console.log('[AdminStore] Review enrichment exception:', enrichErr);
            }

            // ── Log first 10 farmstands with all sort-relevant fields ──
            const sortPreview = farmstands.slice(0, 10).map((f) =>
              `  ${f.id.slice(0, 8)} "${f.name}" | avg_rating=${f.avgRating ?? 0} review_count=${f.reviewCount ?? 0} clicks30d=${f.clicks30d ?? 0} saves30d=${f.saves30d ?? 0} updated_at=${f.updatedAt ?? 'null'} last_activity_at=${f.lastActivityAt ?? 'null'}`
            );
            console.log(`[AdminStore] Sort fields (first 10):\n${sortPreview.join('\n')}`);

            networkSuccess = true;
          } else {
            console.log('[AdminStore] FETCH EMPTY loadAdminData: no farmstands returned (empty table or RLS blocked all rows)');
          }
        } catch (fetchError) {
          console.log('[AdminStore] FETCH EXCEPTION loadAdminData:', fetchError);
        }
      } else {
        console.log('[AdminStore] Supabase not configured - showing empty state');
      }

      // ── Step 3: On success, update store + cache ──
      // On failure, keep existing cached data visible (do NOT blank the UI)
      if (networkSuccess && farmstands.length > 0) {
        // Persist to cache for next app open
        await writeCache(queryKey, farmstands);

        // Upsert: the network list is authoritative, but any records that bootstrap
        // injected via farmstand_owners JOIN may be fresher (owner-specific fields).
        // Merge: network record wins unless bootstrap already has the same ID.
        const bootstrapped = get().allFarmstands;
        const networkMap = new Map(farmstands.map((f) => [f.id, f]));
        for (const f of bootstrapped) {
          // Only keep bootstrap record if it came from a network source (farmstand_owners
          // JOIN) — identified by having a non-empty ownerUserId. The plain farmstands
          // table query also returns ownerUserId, so both are equally authoritative;
          // we just prefer the one already in the store to avoid a flash.
          if (networkMap.has(f.id)) {
            networkMap.set(f.id, f); // in-store record (may be fresher bootstrap data)
          }
        }

        set({
          allFarmstands: Array.from(networkMap.values()),
          farmstandsSource: 'network',
          farmstandsFetchedAt: new Date().toISOString(),
          farmstandsCacheAgeMs: 0,
        });
      } else if (!networkSuccess) {
        // Network failed — keep cached data, update cache age
        const nowCached = await readCache(queryKey);
        set({
          farmstandsCacheAgeMs: nowCached.cacheAgeMs,
        });
        console.log('[AdminStore] Network failed — keeping cached data visible');
      }

      // Load other data from cache
      const storedUsers = await AsyncStorage.getItem('admin_users');
      const storedRequests = await AsyncStorage.getItem('admin_requests');
      let storedClaimRequests = await AsyncStorage.getItem('admin_claim_requests');
      const storedFlaggedContent = await AsyncStorage.getItem('admin_flagged_content');
      const storedReportsAndFlags = await AsyncStorage.getItem('admin_reports_and_flags');

      // Try to fetch claim requests from Supabase (for admins)
      let claimRequestsFromSupabase: ClaimRequest[] | null = null;
      if (isSupabaseConfigured()) {
        try {
          // claim_requests is the canonical table (submit-claim.ts writes here)
          const { data: claimData, error: claimError } = await supabase
            .from<Record<string, unknown>>('claim_requests')
            .select('id, farmstand_id, user_id, requester_email, requester_name, status, reviewed_at, reviewed_by_admin_id, created_at')
            .order('created_at', { ascending: false })
            .execute();

          if (claimError) {
            console.log('[AdminStore] Could not fetch claim requests from Supabase (may need admin access):', claimError.message);
          } else {
            const totalCount = claimData?.length ?? 0;
            const pendingCount = claimData?.filter(r => r.status === 'pending').length ?? 0;
            console.log(`[AdminStore] loadAdminData claim_requests — total rows: ${totalCount} | pending: ${pendingCount}`);
            if (claimData && totalCount > 0) {
              const statusList = claimData.slice(0, 10).map(r => r.status).join(', ');
              console.log('[AdminStore] loadAdminData claim_requests statuses (first 10):', statusList);
            }
          }
          if (claimData && claimData.length > 0) {
            console.log(`[AdminStore] Fetched ${claimData.length} claim requests from Supabase`);
            claimRequestsFromSupabase = claimData.map((row): ClaimRequest => ({
              id: row.id as string,
              farmstand_id: row.farmstand_id as string,
              requester_id: (row.user_id as string | null) || null,
              requester_email: (row.requester_email as string) || '',
              requester_name: (row.requester_name as string) || '',
              notes: (row.notes as string | null) || null,
              evidence_urls: (row.evidence_urls as string[]) || [],
              status: (row.status as ClaimRequestStatus) || 'pending',
              reviewed_at: row.reviewed_at as string | null,
              reviewed_by: (row.reviewed_by_admin_id as string | null) || null,
              created_at: row.created_at as string,
            }));
          }
        } catch (err) {
          console.log('[AdminStore] Claim requests fetch error:', err);
        }
      }

      // Users are now loaded directly from the backend in the admin/users.tsx screen.
      // Keep the store's users array empty here — the screen manages its own fetch.
      let users: AdminUser[] = storedUsers ? JSON.parse(storedUsers) : [];

      // Load stored requests or initialize with sample pending requests
      let requests: FarmstandRequest[];
      if (storedRequests) {
        requests = JSON.parse(storedRequests);
      } else {
        // Create sample pending requests from pending farmstands
        const pendingFarmstands = farmstands.filter(f => f.status === 'pending');
        requests = pendingFarmstands.map((f, i) => ({
          id: `req-${Date.now()}-${i}`,
          farmstandId: f.id,
          farmstandName: f.name,
          ownerName: 'Pending Owner',
          ownerEmail: 'owner@example.com',
          requestType: 'new' as const,
          submittedAt: f.createdAt,
          status: 'pending' as const,
        }));
        await AsyncStorage.setItem('admin_requests', JSON.stringify(requests));
      }

      // Merge claim requests: prefer Supabase data, fallback to local cache
      let claimRequests: ClaimRequest[] = [];
      if (claimRequestsFromSupabase && claimRequestsFromSupabase.length > 0) {
        claimRequests = claimRequestsFromSupabase;
        // Also update local cache with Supabase data
        await AsyncStorage.setItem('admin_claim_requests', JSON.stringify(claimRequestsFromSupabase));
      } else if (storedClaimRequests) {
        claimRequests = JSON.parse(storedClaimRequests);
      }

      set({
        // Do NOT overwrite allFarmstands here — it was already set above
        // based on whether the network succeeded or cache was used.
        users,
        farmstandRequests: requests,
        claimRequests,
        flaggedContent: storedFlaggedContent ? JSON.parse(storedFlaggedContent) : [],
        reportsAndFlags: storedReportsAndFlags ? JSON.parse(storedReportsAndFlags) : [],
        supportTickets: await AsyncStorage.getItem('support_tickets').then(d => d ? JSON.parse(d) : []),
        supportMessages: await AsyncStorage.getItem('support_messages').then(d => d ? JSON.parse(d) : []),
        isLoading: false,
      });
    } catch (error) {
      console.error('Error loading admin data:', error);
      // On error: clear loading spinner but keep any cached farmstands visible
      set({ isLoading: false });
    } finally {
      setFetchInFlight(CACHE_KEYS.EXPLORE, false);
    }
  },

  getAllFarmstands: () => get().allFarmstands,

  getFarmstandById: (id: string) => {
    return get().allFarmstands.find(f => f.id === id);
  },

  getFarmstandsByStatus: (status: FarmstandStatus) => {
    return get().allFarmstands.filter(f => f.status === status);
  },

  searchFarmstands: (query: string) => {
    const lowerQuery = query.toLowerCase();
    return get().allFarmstands.filter(f =>
      f.name.toLowerCase().includes(lowerQuery) ||
      f.city?.toLowerCase().includes(lowerQuery) ||
      f.zip?.includes(query) ||
      f.offerings.some(o => o.toLowerCase().includes(lowerQuery))
    );
  },

  applyClaimOverride: (farmstandId, override) => {
    console.log('[claim] optimistic override applied', farmstandId, override);
    set((state) => ({
      claimOverrides: { ...state.claimOverrides, [farmstandId]: override },
    }));
  },

  clearClaimOverride: (farmstandId) => {
    console.log('[claim] claim override cleared', farmstandId);
    set((state) => {
      const next = { ...state.claimOverrides };
      delete next[farmstandId];
      return { claimOverrides: next };
    });
  },

  updateFarmstandStatus: async (id: string, status: FarmstandStatus) => {
    const farmstands = get().allFarmstands.map(f =>
      f.id === id ? { ...f, status, isActive: status === 'active', updatedAt: new Date().toISOString() } : f
    );
    set({ allFarmstands: farmstands });
  },

  refreshSingleFarmstand: async (id: string): Promise<Farmstand | null> => {
    if (!isSupabaseConfigured()) {
      console.log('[AdminStore] Supabase not configured, cannot refresh farmstand');
      return null;
    }

    console.log('[AdminStore] FETCH START refreshSingleFarmstand id:', id);
    try {
      const { data, error } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .select('*')
        .eq('id', id)
        .execute();

      if (error) {
        console.log('[AdminStore] FETCH ERROR refreshSingleFarmstand:', error.message, '| code:', (error as { code?: string }).code, '| id:', id);
        return null;
      }

      if (!data || data.length === 0) {
        console.log('[AdminStore] FETCH EMPTY refreshSingleFarmstand: no row found for id:', id, '(genuine not-found or RLS blocked)');
        return null;
      }

      // Map to app format (take first result)
      const refreshedFarmstand = mapSupabaseFarmstand(data[0]);
      console.log('[AdminStore] FETCH SUCCESS refreshSingleFarmstand:', refreshedFarmstand.name, '| id:', id, '| showOnMap (Supabase):', refreshedFarmstand.showOnMap);

      // Apply visibility override from backend storage.
      // The show_on_map column doesn't exist in Supabase yet so it always returns true.
      // The backend JSON store holds the real user-set value.
      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL ?? '';
      if (backendUrl) {
        try {
          const visResp = await fetch(`${backendUrl}/api/farmstand-visibility`);
          const ct = visResp.headers.get('content-type') ?? '';
          if (visResp.ok && ct.includes('application/json')) {
            const { visibility } = await visResp.json() as { visibility: Record<string, boolean> };
            if (id in visibility) {
              const override = visibility[id];
              console.log(`[AdminStore][Visibility] refreshSingleFarmstand ${id}: showOnMap override=${override}`);
              refreshedFarmstand.showOnMap = override as boolean;
            }
          }
        } catch (visErr) {
          console.log('[AdminStore][Visibility] Failed to fetch visibility:', visErr);
        }
      }

      // Update in store - replace existing or add if not found
      const currentFarmstands = get().allFarmstands;
      const existingIndex = currentFarmstands.findIndex(f => f.id === id);

      let updatedFarmstands: Farmstand[];
      if (existingIndex >= 0) {
        updatedFarmstands = [...currentFarmstands];
        updatedFarmstands[existingIndex] = refreshedFarmstand;
      } else {
        updatedFarmstands = [...currentFarmstands, refreshedFarmstand];
      }

      set({ allFarmstands: updatedFarmstands });
      console.log('[AdminStore] Store updated with refreshed farmstand');

      return refreshedFarmstand;
    } catch (err) {
      console.error('[AdminStore] Failed to refresh farmstand:', err);
      return null;
    }
  },

  updateFarmstand: async (id: string, updates: Partial<Farmstand>) => {
    const now = new Date().toISOString();

    if (!isSupabaseConfigured()) {
      // No Supabase — only update local state (non-production fallback)
      const farmstands = get().allFarmstands.map(f =>
        f.id === id ? { ...f, ...updates, updatedAt: now } : f
      );
      set({ allFarmstands: farmstands });
      return;
    }

    // ── Build snake_case update payload ───────────────────────────────────────
    // ALLOWLIST: only content fields the edit screen touches.
    // Never include ownership/claim/verification columns.
    const validFieldMappings: Record<string, string> = {
      name:               'name',
      description:        'description',
      operationalStatus:  'operational_status',
      operatingStatus:    'operating_status',
      addressLine1:       'street_address',
      addressLine2:       'address_line2',
      city:               'city',
      state:              'state',
      zip:                'zip',
      latitude:           'latitude',
      longitude:          'longitude',
      email:              'email',
      phone:              'phone',
      offerings:          'offerings',
      otherProducts:      'other_products',
      paymentOptions:     'payment_options',
      categories:         'categories',
      hours:              'hours',
      isOpen24_7:         'is_open_24_7',
      heroPhotoUrl:       'hero_photo_url',
      aiPhotoUrl:         'ai_photo_url',
      heroImageUrl:       'hero_image_url',
      aiImageUrl:         'ai_image_url',
      photos:             'photos',
      photoUrl:           'photo_url',
      imageUrl:           'image_url',
      showOnMap:          'show_on_map',
      videoUrl:           'video_url',
      videoPath:          'video_path',
      videoDurationSeconds: 'video_duration_seconds',
    };

    const snakeCaseUpdates: Record<string, unknown> = {};

    for (const [camelKey, snakeKey] of Object.entries(validFieldMappings)) {
      if (camelKey in updates) {
        snakeCaseUpdates[snakeKey] = (updates as Record<string, unknown>)[camelKey];
      }
    }

    // status: only 'pending' and 'active' are valid Supabase values
    if ('status' in updates) {
      const appStatus = updates.status;
      if (appStatus === 'pending' || appStatus === 'active') {
        snakeCaseUpdates['status'] = appStatus;
      }
    }

    // cross streets (not in main validFieldMappings)
    if ('crossStreet1' in updates) snakeCaseUpdates['cross_street1'] = updates.crossStreet1 || null;
    if ('crossStreet2' in updates) snakeCaseUpdates['cross_street2'] = updates.crossStreet2 || null;

    // Recompute full_address when any address part changes
    if (['addressLine1', 'city', 'state', 'zip'].some((k) => k in updates)) {
      const cur = get().allFarmstands.find((f) => f.id === id);
      const parts = [
        updates.addressLine1 ?? cur?.addressLine1,
        updates.city         ?? cur?.city,
        updates.state        ?? cur?.state,
        updates.zip          ?? cur?.zip,
      ].filter(Boolean);
      snakeCaseUpdates['full_address'] = parts.length ? parts.join(', ') : null;
    }

    // Clear stale AI image when products change
    if ('offerings' in updates || 'categories' in updates) {
      snakeCaseUpdates['ai_image_url'] = null;
      if (__DEV__) console.log('[AdminStore] offerings/categories changed — clearing ai_image_url');
    }

    if (__DEV__) console.log('[AdminStore] updateFarmstand — farmstandId:', id, '| RPC payload:', JSON.stringify(snakeCaseUpdates));

    // If nothing mapped (e.g. analytics-only fields like clicks30d/popularityScore
    // that aren't in the DB allowlist), skip the RPC entirely and just update
    // local state. This prevents spurious permission errors for public viewers.
    if (Object.keys(snakeCaseUpdates).length === 0) {
      if (__DEV__) console.log('[AdminStore] updateFarmstand — no DB-mapped fields in payload, updating local state only');
      set({
        allFarmstands: get().allFarmstands.map(f =>
          f.id === id ? { ...f, ...updates, updatedAt: now } : f
        ),
      });
      return;
    }

    // ── Try owner path first (works for any authenticated owner/claimer) ──────
    // Falls back to admin path if the caller isn't the owner (i.e. admin editing
    // a farmstand they don't own).
    const { data: ownerResult, error: ownerRpcError } = await supabase.rpc<{ success: boolean; error?: string }>(
      'owner_update_farmstand',
      { p_farmstand_id: id, p_updates: snakeCaseUpdates },
    );

    const ownerOk = !ownerRpcError && (ownerResult as { success: boolean } | null)?.success === true;

    if (__DEV__) console.log('[AdminStore] owner_update_farmstand result:', JSON.stringify(ownerResult), '| rpcError:', ownerRpcError?.message ?? null, '| ok:', ownerOk);

    if (ownerOk) {
      // Owner path succeeded — patch local state and done
      set({
        allFarmstands: get().allFarmstands.map(f =>
          f.id === id ? { ...f, ...updates, updatedAt: now } : f
        ),
      });
      return;
    }

    // ── Owner path failed — try admin path ────────────────────────────────────
    // Expected when an admin edits a farmstand they don't own.
    if (__DEV__) console.log('[AdminStore] owner path did not succeed — trying admin_update_farmstand');

    const { data: adminResult, error: adminRpcError } = await supabase.rpc<{ success: boolean; error?: string }>(
      'admin_update_farmstand',
      { p_farmstand_id: id, p_updates: snakeCaseUpdates },
    );

    if (__DEV__) console.log('[AdminStore] admin_update_farmstand result:', JSON.stringify(adminResult), '| rpcError:', adminRpcError?.message ?? null);

    const adminOk = !adminRpcError && (adminResult as { success: boolean } | null)?.success === true;

    if (adminOk) {
      set({
        allFarmstands: get().allFarmstands.map(f =>
          f.id === id ? { ...f, ...updates, updatedAt: now } : f
        ),
      });
      return;
    }

    // ── Both paths failed — surface the most useful error ────────────────────
    const errMsg =
      (ownerResult as { error?: string } | null)?.error
      ?? (adminResult as { error?: string } | null)?.error
      ?? adminRpcError?.message
      ?? ownerRpcError?.message
      ?? 'Failed to save farmstand';
    if (__DEV__) console.warn('[AdminStore] updateFarmstand — both owner and admin paths failed:', errMsg);
    throw new Error(errMsg);
  },

  deleteFarmstand: async (id: string) => {
    if (__DEV__) console.log('[AdminStore] deleteFarmstand — farmstandId:', id, '| calling RPC admin_soft_delete_farmstand');

    // Use admin_soft_delete_farmstand RPC (SECURITY DEFINER, bypasses RLS)
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('admin_soft_delete_farmstand', { p_farmstand_id: id });

    if (__DEV__) console.log('[AdminStore] deleteFarmstand — RPC result:', JSON.stringify(rpcData), '| error:', rpcError?.message ?? null);

    if (rpcError) {
      // RPC call itself failed (network error, function not found, etc.) — fall back to backend
      console.log('[AdminStore] deleteFarmstand — RPC error, falling back to backend. error:', rpcError.message);
      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      const session = await getValidSession();
      if (!session?.access_token) throw new Error('Session expired. Please sign in again.');

      const backendResp = await fetch(`${backendUrl}/api/delete-farmstand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ farmstand_id: id }),
      });
      const bct4 = backendResp.headers.get('content-type') ?? '';
      if (!bct4.includes('application/json')) {
        console.log('[AdminStore] delete-farmstand non-JSON response (HTTP', backendResp.status, '), content-type:', bct4);
        throw new Error(`Unexpected response from server (HTTP ${backendResp.status})`);
      }
      const backendData = await backendResp.json() as { success: boolean; error?: string };
      if (!backendResp.ok || !backendData.success) {
        const errMsg = backendData.error || 'Failed to delete farmstand';
        console.error('[AdminStore] Backend delete failed:', backendResp.status, errMsg);
        throw new Error(errMsg);
      }
      console.log('[AdminStore] Backend delete (fallback) success — id:', id);
    } else {
      // RPC returned — check success flag from the function's return value
      const result = rpcData as { success: boolean; error?: string } | null;
      if (result && result.success === false) {
        throw new Error(result.error || 'Failed to delete farmstand');
      }
      if (__DEV__) console.log('[AdminStore] deleteFarmstand — RPC success, farmstandId:', id);
    }

    // Remove from local state immediately and clear premium for former owners
    const deletedFarmstand = get().allFarmstands.find(f => f.id === id);
    const remainingFarmstands = get().allFarmstands.filter(f => f.id !== id);
    set({ allFarmstands: remainingFarmstands });

    // If the deleted farmstand had an owner, recompute their premium status.
    // The backend already excludes deleted farmstands from premium (fix in admin-users.ts),
    // but we also update managedUsers locally so the UI is immediately accurate.
    if (deletedFarmstand && (deletedFarmstand.ownerUserId || deletedFarmstand.claimedByUserId)) {
      const nowStr = new Date().toISOString();
      set(s => ({
        managedUsers: s.managedUsers.map(u => {
          const ownedDeleted =
            deletedFarmstand.ownerUserId === u.id ||
            deletedFarmstand.claimedByUserId === u.id;
          if (!ownedDeleted) return u;
          // Still premium if they own another active stand with active premium
          const stillPremium = remainingFarmstands.some(
            f =>
              !f.deletedAt &&
              (f.ownerUserId === u.id || f.claimedByUserId === u.id) &&
              (
                f.premiumStatus === 'active' ||
                f.premiumStatus === 'trial' ||
                (f.premiumTrialExpiresAt != null && f.premiumTrialExpiresAt > nowStr)
              )
          );
          return { ...u, is_premium: stillPremium };
        }),
      }));
    }

    // Refresh admin UI counts/list and managed users premium status
    await get().loadAnalytics();
    await get().loadAdminData();
    // Refresh managed users so is_premium reflects the deleted farmstand
    get().loadManagedUsers().catch(err => console.log('[AdminStore] loadManagedUsers after delete (non-fatal):', err));

    // Purge from bootstrap store so Profile/My-Farmstand immediately reflects deletion.
    // Lazy require avoids a circular import (bootstrap-store imports admin-store).
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { purgeDeletedFarmstandFromBootstrap } = require('./bootstrap-store') as { purgeDeletedFarmstandFromBootstrap: (id: string) => Promise<void> };
      await purgeDeletedFarmstandFromBootstrap(id);
    } catch (purgeErr) {
      console.log('[AdminStore] purgeDeletedFarmstandFromBootstrap error (non-fatal):', purgeErr);
    }

    // Also clean up any favorites referencing this farmstand
    try {
      const storedFavorites = await AsyncStorage.getItem('farmstand-favorites');
      if (storedFavorites) {
        const parsed = JSON.parse(storedFavorites) as string[];
        const cleaned = parsed.filter(favId => favId !== id);
        if (cleaned.length !== parsed.length) {
          await AsyncStorage.setItem('farmstand-favorites', JSON.stringify(cleaned));
          console.log('[AdminStore] Cleaned up deleted farmstand from favorites');
        }
      }
    } catch (error) {
      console.error('[AdminStore] Error cleaning favorites:', error);
    }
  },

  ownerDeleteFarmstand: async (farmstandId: string, userId: string) => {
    console.log('[AdminStore] ownerDeleteFarmstand called - farmstandId:', farmstandId, 'userId:', userId);

    // Verify the farmstand exists and user is the owner.
    // If not found in local state, it may have already been deleted by an admin.
    // Treat this as a stale-state cleanup — purge and return success silently.
    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) {
      console.log('[AdminStore] ownerDeleteFarmstand: Farmstand not found in local state — already deleted, purging stale state');
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { purgeDeletedFarmstandFromBootstrap } = require('./bootstrap-store') as { purgeDeletedFarmstandFromBootstrap: (id: string) => Promise<void> };
        await purgeDeletedFarmstandFromBootstrap(farmstandId);
      } catch (purgeErr) {
        console.log('[AdminStore] purgeDeletedFarmstandFromBootstrap error (non-fatal):', purgeErr);
      }
      return { success: true };
    }

    // Check ownership - must be claimed by this user
    if (farmstand.claimStatus !== 'claimed' ||
        (farmstand.ownerUserId !== userId && farmstand.claimedByUserId !== userId)) {
      console.log('[AdminStore] ownerDeleteFarmstand: Ownership check failed - claimStatus:', farmstand.claimStatus, 'ownerUserId:', farmstand.ownerUserId, 'claimedByUserId:', farmstand.claimedByUserId);
      return { success: false, error: 'You can only delete farmstands you own' };
    }

    // If Supabase is configured, update the database
    if (isSupabaseConfigured()) {
      // Use ensureSessionReady to handle race conditions on cold start
      console.log('[AdminStore] ownerDeleteFarmstand: Checking session...');
      const session = await ensureSessionReady();
      console.log('[AdminStore] ownerDeleteFarmstand: Session check result - hasSession:', !!session, 'hasAccessToken:', !!session?.access_token);

      if (!session) {
        console.log('[AdminStore] ownerDeleteFarmstand: No session, returning error');
        return { success: false, error: 'Please sign in to continue.' };
      }

      console.log('[AdminStore] Owner soft-deleting farmstand via backend:', farmstandId);

      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      const backendResp = await fetch(`${backendUrl}/api/delete-farmstand`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ farmstand_id: farmstandId }),
      });

      const bct5 = backendResp.headers.get('content-type') ?? '';
      if (!bct5.includes('application/json')) {
        console.log('[AdminStore] ownerDeleteFarmstand non-JSON response (HTTP', backendResp.status, '), content-type:', bct5);
        return { success: false, error: `Unexpected response from server (HTTP ${backendResp.status})` };
      }
      const backendData = await backendResp.json() as { success: boolean; error?: string };
      if (!backendResp.ok || !backendData.success) {
        console.log('[AdminStore] ownerDeleteFarmstand backend error:', backendData.error, 'status:', backendResp.status);
        return { success: false, error: backendData.error || 'Failed to delete farmstand' };
      }

      console.log('[AdminStore] ownerDeleteFarmstand: Backend soft-delete successful');

      // CRITICAL: Also remove the farmstand_owners row so subsequent
      // fetchUserFarmstandsFromSupabase queries don't return this farmstand via the join.
      // This is fire-and-forget — failure is non-fatal (deleted_at filter is defense-in-depth).
      try {
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
        const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
        const deleteOwnerResp = await fetch(
          `${supabaseUrl}/rest/v1/farmstand_owners?farmstand_id=eq.${farmstandId}&user_id=eq.${userId}`,
          {
            method: 'DELETE',
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
          }
        );
        if (deleteOwnerResp.ok) {
          console.log('[AdminStore] ownerDeleteFarmstand: farmstand_owners row removed for farmstand:', farmstandId, '| userId:', userId);
        } else {
          const errText = await deleteOwnerResp.text();
          console.log('[AdminStore] ownerDeleteFarmstand: farmstand_owners delete non-fatal error:', deleteOwnerResp.status, errText.slice(0, 100));
        }
      } catch (ownerRowErr) {
        console.log('[AdminStore] ownerDeleteFarmstand: farmstand_owners delete exception (non-fatal):', ownerRowErr);
      }
    }

    // Remove from local state
    const farmstands = get().allFarmstands.filter(f => f.id !== farmstandId);
    set({ allFarmstands: farmstands });

    // Purge from bootstrap store so Profile/My-Farmstand immediately reflects deletion.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { purgeDeletedFarmstandFromBootstrap } = require('./bootstrap-store') as { purgeDeletedFarmstandFromBootstrap: (id: string) => Promise<void> };
      await purgeDeletedFarmstandFromBootstrap(farmstandId);
      console.log('[AdminStore] ownerDeleteFarmstand: purgeDeletedFarmstandFromBootstrap complete — selectedFarmstandId cleared');
    } catch (purgeErr) {
      console.log('[AdminStore] purgeDeletedFarmstandFromBootstrap error (non-fatal):', purgeErr);
    }

    // Clean up any favorites referencing this farmstand
    try {
      const storedFavorites = await AsyncStorage.getItem('farmstand-favorites');
      if (storedFavorites) {
        const parsed = JSON.parse(storedFavorites) as string[];
        const cleaned = parsed.filter(favId => favId !== farmstandId);
        if (cleaned.length !== parsed.length) {
          await AsyncStorage.setItem('farmstand-favorites', JSON.stringify(cleaned));
          console.log('[AdminStore] Cleaned up deleted farmstand from favorites');
        }
      }
    } catch (err) {
      console.error('[AdminStore] Error cleaning favorites:', err);
    }

    return { success: true };
  },

  duplicateFarmstand: async (id: string) => {
    const original = get().allFarmstands.find(f => f.id === id);
    if (!original) throw new Error('Farmstand not found');

    const newId = `farm-${Date.now()}`;
    const duplicate: Farmstand = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      status: 'draft',
      isActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const farmstands = [...get().allFarmstands, duplicate];
    set({ allFarmstands: farmstands });
    return newId;
  },

  createFarmstand: async (farmstand: Omit<Farmstand, 'id' | 'updatedAt'> & { id?: string }) => {
    const now = new Date().toISOString();

    // Build full_address from address components
    const fullAddress = [
      farmstand.addressLine1,
      farmstand.city,
      farmstand.state,
      farmstand.zip,
    ]
      .filter(Boolean)
      .join(', ');

    // Validate required location fields
    if (!Number.isFinite(farmstand.latitude) || !Number.isFinite(farmstand.longitude)) {
      throw new Error('GPS coordinates are required. Use Locate on Map or drag the pin.');
    }
    if (!farmstand.name?.trim()) {
      throw new Error('Farmstand name is required.');
    }
    if (!farmstand.city?.trim()) {
      throw new Error('City is required. Please complete the location details.');
    }
    if (!farmstand.state?.trim()) {
      throw new Error('State is required. Please complete the location details.');
    }

    // Build the Supabase payload with columns that exist in the DB schema
    // DO NOT include 'id' - Supabase will auto-generate the UUID
    // Note: Some columns like is_active, show_on_map do NOT exist in Supabase
    const supabasePayload: Record<string, unknown> = {
      // Basic info
      name: farmstand.name,
      description: farmstand.description || '',

      // Contact info
      email: farmstand.email || null,
      phone: farmstand.phone || null,

      // Address fields
      street_address: farmstand.addressLine1 || null,
      address_line2: farmstand.addressLine2 || null,
      city: farmstand.city || null,
      state: farmstand.state || null,
      zip: farmstand.zip || null,
      full_address: fullAddress || null,

      // Cross streets (optional helper for location)
      cross_street1: farmstand.crossStreet1 || null,
      cross_street2: farmstand.crossStreet2 || null,

      // GPS coordinates
      latitude: farmstand.latitude,
      longitude: farmstand.longitude,

      // Status
      status: 'pending', // Always create as pending

      // Offerings and payment options (stored as arrays)
      offerings: farmstand.offerings || [],
      other_products: farmstand.otherProducts || [],
      payment_options: farmstand.paymentOptions || [],

      // Timestamps
      created_at: now,
      updated_at: now,

      // Photo URL fields - included if present so no separate UPDATE is needed
      // CRITICAL: Only include valid Storage URLs (https://...), never local file:// URIs
      ...(farmstand.heroPhotoUrl && farmstand.heroPhotoUrl.startsWith('https://') ? { hero_photo_url: farmstand.heroPhotoUrl } : {}),
      ...(farmstand.heroImageUrl && farmstand.heroImageUrl.startsWith('https://') ? { hero_image_url: farmstand.heroImageUrl } : {}),
      ...(farmstand.aiPhotoUrl && farmstand.aiPhotoUrl.startsWith('https://') ? { ai_photo_url: farmstand.aiPhotoUrl } : {}),
      ...(farmstand.photoUrl && farmstand.photoUrl.startsWith('https://') ? { photo_url: farmstand.photoUrl } : {}),
      ...(farmstand.imageUrl && farmstand.imageUrl.startsWith('https://') ? { image_url: farmstand.imageUrl } : {}),
      ...(farmstand.photos && farmstand.photos.length > 0 ? { photos: farmstand.photos } : {}),

      // Internal contact fields (admin-only, not shown publicly)
      internal_contact_phone: farmstand.internalContactPhone ?? null,
      internal_contact_email: farmstand.internalContactEmail ?? null,
    };

    console.log('[AddFarmstand] submit payload internal_contact_phone:', supabasePayload.internal_contact_phone ?? 'null');
    console.log('[AddFarmstand] submit payload internal_contact_email:', supabasePayload.internal_contact_email ?? 'null');

    // Insert into Supabase
    if (isSupabaseConfigured()) {
      console.log('[AdminStore] Creating farmstand in Supabase (UUID auto-generated)');

      const { data, error: supabaseError } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .insert(supabasePayload)
        .allowAnon()
        .select('id')
        .execute();

      if (supabaseError) {
        console.error('[AdminStore] Supabase insert error:', supabaseError);
        throw new Error(supabaseError.message);
      }

      // Get the UUID that Supabase generated
      const newId = data?.[0]?.id as string;
      console.log('[AddFarmstand] created farmstand id:', newId);

      // Best-effort admin email notification — does not block submission
      const _notifyUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      if (_notifyUrl) {
        fetch(`${_notifyUrl}/api/notify-new-farmstand`, { method: 'POST' }).catch(() => {});
      }
      const hwUrl = `${getSupabaseUrl()}/functions/v1/hyper-worker`;
      console.log('[AddFarmstand] hyper-worker firing — type: farmstand_submitted | url:', hwUrl);
      fetch(hwUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
        },
        body: JSON.stringify({
          type: 'farmstand_submitted',
          data: {
            name: farmstand.name,
            id: newId || null,
            address: fullAddress || null,
            submitter_email: farmstand.internalContactEmail || null,
            products: farmstand.offerings && farmstand.offerings.length > 0
              ? farmstand.offerings.join(', ')
              : null,
            photos: farmstand.photos && farmstand.photos.length > 0
              ? `${farmstand.photos.length} photo(s) included`
              : null,
            submitted_at: now,
          },
        }),
      }).then(async (r) => {
        const body = await r.text().catch(() => '(unreadable)');
        console.log('[AddFarmstand] hyper-worker response — status:', r.status, '| body:', body);
      }).catch((err: unknown) => console.warn('[AddFarmstand] hyper-worker network error:', err));
      console.log('[AddFarmstand] saved internal_contact_phone:', supabasePayload.internal_contact_phone ?? 'null');
      console.log('[AddFarmstand] saved internal_contact_email:', supabasePayload.internal_contact_email ?? 'null');

      // Reload from Supabase to get the latest data
      await get().loadAdminData();

      return newId || '';
    } else {
      // If Supabase is not configured, generate a local ID
      const localId = `farm-${Date.now()}`;
      const newFarmstand: Farmstand = {
        ...farmstand,
        id: localId,
        status: 'pending',
        updatedAt: now,
      };
      const farmstands = [...get().allFarmstands, newFarmstand];
      set({ allFarmstands: farmstands });
      return localId;
    }
  },

  // Import farmstands - disabled, Supabase is now the only source of truth
  importFarmstands: async () => {
    console.log('[AdminStore] importFarmstands is disabled - Supabase is the only source of truth');
    return { success: true, importedCount: 0 };
  },

  // User Management
  updateUserRole: async (id: string, role: 'admin' | 'farmer' | 'consumer') => {
    const users = get().users.map(u =>
      u.id === id ? { ...u, role } : u
    );
    await AsyncStorage.setItem('admin_users', JSON.stringify(users));
    set({ users });
  },

  updateUserStatus: async (id: string, status: UserStatus) => {
    const users = get().users.map(u =>
      u.id === id ? { ...u, status } : u
    );
    await AsyncStorage.setItem('admin_users', JSON.stringify(users));
    set({ users });
  },

  deleteUser: async (id: string) => {
    const users = get().users.filter(u => u.id !== id);
    await AsyncStorage.setItem('admin_users', JSON.stringify(users));
    set({ users });
  },

  // ── Managed Users — shared source of truth for Dashboard + Manage Users screen ──

  setManagedUsers: (managedUsers: BackendUser[]) => {
    set({ managedUsers });
    AsyncStorage.setItem('managed_users_cache', JSON.stringify(managedUsers)).catch(() => {});
  },

  loadManagedUsers: async () => {
    const ADMIN_EMAIL_GUARD = 'contact@farmstand.online';
    const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
    try {
      const session = await getValidSession();
      if (!session?.access_token) return { error: 'Session expired. Please sign in again.' };

      if (__DEV__) console.log('[AdminStore] loadManagedUsers — backend URL:', backendUrl ? `${backendUrl}/api/admin/users` : '(EXPO_PUBLIC_VIBECODE_BACKEND_URL not configured)');

      const resp = await fetch(`${backendUrl}/api/admin/users`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        const text = await resp.text();
        let msg = `Server error ${resp.status}`;
        try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* ignore */ }
        return { error: msg };
      }

      const bct6 = resp.headers.get('content-type') ?? '';
      if (!bct6.includes('application/json')) {
        console.log('[AdminStore] loadManagedUsers non-JSON response (HTTP', resp.status, '), content-type:', bct6);
        return { error: `Unexpected response from server (HTTP ${resp.status})` };
      }
      const data = await resp.json() as { success: boolean; users?: BackendUser[]; error?: string };
      if (!data.success || !data.users) return { error: data.error ?? 'Unexpected response from server.' };

      // Defense-in-depth: strip any admin that slipped through the backend filter
      const filtered = data.users.filter(
        u => (u.email ?? '').toLowerCase().trim() !== ADMIN_EMAIL_GUARD
      );

      get().setManagedUsers(filtered);
      return {};
    } catch (err) {
      if (__DEV__) console.warn('[AdminStore] loadManagedUsers error:', err);
      return { error: 'Network error. Please try again.' };
    }
  },

  patchManagedUserRole: (id: string, role: BackendUser['role']) => {
    set(s => ({ managedUsers: s.managedUsers.map(u => u.id === id ? { ...u, role } : u) }));
  },

  patchManagedUserStatus: (id: string, status: BackendUser['status']) => {
    set(s => ({ managedUsers: s.managedUsers.map(u => u.id === id ? { ...u, status } : u) }));
  },

  removeManagedUser: (id: string) => {
    set(s => ({ managedUsers: s.managedUsers.filter(u => u.id !== id) }));
  },

  clearFarmstandOwnership: (farmstandId: string) => {
    set(s => {
      // Update the farmstand: clear owner fields AND reset premium fields.
      // Removing ownership ends the claim-based premium trial immediately.
      const updatedFarmstands = s.allFarmstands.map(f =>
        f.id === farmstandId
          ? {
              ...f,
              ownerUserId: '',
              claimedByUserId: '',
              claimStatus: 'unclaimed' as const,
              premiumStatus: 'free' as PremiumStatus,
              premiumTrialExpiresAt: null,
              premiumTrialStartedAt: null,
            }
          : f
      );

      // Recompute is_premium for any user who owned the cleared farmstand.
      // They keep premium only if they still own ANOTHER active stand with premium.
      const nowStr = new Date().toISOString();
      const updatedUsers = s.managedUsers.map(u => {
        const ownedCleared = s.allFarmstands.some(
          f => f.id === farmstandId && (f.ownerUserId === u.id || f.claimedByUserId === u.id)
        );
        if (!ownedCleared) return u;

        // Check remaining farmstands (excluding the cleared one)
        const stillPremium = updatedFarmstands.some(
          f =>
            f.id !== farmstandId &&
            !f.deletedAt &&
            (f.ownerUserId === u.id || f.claimedByUserId === u.id) &&
            (
              f.premiumStatus === 'active' ||
              f.premiumStatus === 'trial' ||
              (f.premiumTrialExpiresAt != null && f.premiumTrialExpiresAt > nowStr)
            )
        );

        return {
          ...u,
          farmstand_count: Math.max(0, (u.farmstand_count ?? 1) - 1),
          is_premium: stillPremium,
        };
      });

      return { allFarmstands: updatedFarmstands, managedUsers: updatedUsers };
    });
  },

  purgeFarmstandAfterAdminRemove: async (farmstandId: string) => {
    console.log('[ManageUsersRemoveFarmstand] purging farmstand from all local stores — farmstandId:', farmstandId);
    const deleted = get().allFarmstands.find(f => f.id === farmstandId);
    const remaining = get().allFarmstands.filter(f => f.id !== farmstandId);
    const nowStr = new Date().toISOString();

    // Recompute managedUsers premium/count for any user who owned this farmstand
    const updatedUsers = get().managedUsers.map(u => {
      const ownedDeleted = deleted && (deleted.ownerUserId === u.id || deleted.claimedByUserId === u.id);
      if (!ownedDeleted) return u;
      const stillPremium = remaining.some(
        f =>
          !f.deletedAt &&
          (f.ownerUserId === u.id || f.claimedByUserId === u.id) &&
          (
            f.premiumStatus === 'active' ||
            f.premiumStatus === 'trial' ||
            (f.premiumTrialExpiresAt != null && f.premiumTrialExpiresAt > nowStr)
          )
      );
      return {
        ...u,
        farmstand_count: Math.max(0, (u.farmstand_count ?? 1) - 1),
        is_premium: stillPremium,
      };
    });

    set({ allFarmstands: remaining, managedUsers: updatedUsers });

    // Purge from bootstrap store so Profile/My-Farmstand immediately reflects deletion
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { purgeDeletedFarmstandFromBootstrap } = require('./bootstrap-store') as { purgeDeletedFarmstandFromBootstrap: (id: string) => Promise<void> };
      await purgeDeletedFarmstandFromBootstrap(farmstandId);
      console.log('[ManageUsersRemoveFarmstand] refetch complete — purged from bootstrap store, farmstandId:', farmstandId);
    } catch (purgeErr) {
      console.log('[ManageUsersRemoveFarmstand] purgeDeletedFarmstandFromBootstrap error (non-fatal):', purgeErr);
    }

    // Reload managed users from backend to ensure counts/badges are accurate
    get().loadManagedUsers().catch(err => console.log('[ManageUsersRemoveFarmstand] loadManagedUsers after purge (non-fatal):', err));
  },

  // Request Management
  approveRequest: async (requestId: string) => {
    const request = get().farmstandRequests.find(r => r.id === requestId);
    if (!request) return;

    // Update request status
    const requests = get().farmstandRequests.map(r =>
      r.id === requestId ? { ...r, status: 'approved' as const } : r
    );
    await AsyncStorage.setItem('admin_requests', JSON.stringify(requests));

    // Update farmstand status to active
    const farmstands = get().allFarmstands.map(f =>
      f.id === request.farmstandId ? { ...f, status: 'active' as FarmstandStatus, isActive: true, showOnMap: true, updatedAt: new Date().toISOString() } : f
    );

    set({ farmstandRequests: requests, allFarmstands: farmstands });
  },

  denyRequest: async (requestId: string, reason?: string) => {
    const request = get().farmstandRequests.find(r => r.id === requestId);
    if (!request) return;

    // Update request status with optional reason
    const requests = get().farmstandRequests.map(r =>
      r.id === requestId ? { ...r, status: 'denied' as const, notes: reason } : r
    );
    await AsyncStorage.setItem('admin_requests', JSON.stringify(requests));

    // Update farmstand status to hidden (denied)
    const farmstands = get().allFarmstands.map(f =>
      f.id === request.farmstandId ? { ...f, status: 'hidden' as FarmstandStatus, isActive: false, showOnMap: false, updatedAt: new Date().toISOString() } : f
    );

    set({ farmstandRequests: requests, allFarmstands: farmstands });
  },

  claimFarmstand: async (farmstandId: string, userId: string, verificationCode: string) => {
    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);

    if (!farmstand) {
      return { success: false, error: 'Farmstand not found' };
    }

    if (farmstand.claimStatus === 'claimed') {
      return { success: false, error: 'This farmstand has already been claimed' };
    }

    // Check verification code
    if (farmstand.verificationCode !== verificationCode.toUpperCase()) {
      return { success: false, error: 'Invalid verification code' };
    }

    // Claim the farmstand
    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId
        ? {
            ...f,
            claimStatus: 'claimed' as const,
            ownerUserId: userId,
            verificationCode: null,
            claimedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : f
    );

    set({ allFarmstands: farmstands });

    // Store the claim info so the user gets farmer status on next load
    const approvedClaims = await AsyncStorage.getItem('approved_claims') || '[]';
    const claims = JSON.parse(approvedClaims);
    claims.push({
      farmstandId: farmstandId,
      requesterUserId: userId,
      requesterEmail: null,
      approvedAt: new Date().toISOString(),
    });
    await AsyncStorage.setItem('approved_claims', JSON.stringify(claims));

    return { success: true, farmstandId };
  },

  // Instant Claim - auto-assigns to logged-in user (no verification code needed)
  // A farmstand is "claimed" if claimed_by is NOT NULL
  claimFarmstandInstantly: async (farmstandId: string, userId: string) => {
    // Step A: Require user to be logged in
    if (!userId) {
      return { success: false, error: 'Please log in to claim this farmstand' };
    }

    const now = new Date().toISOString();
    console.log('[AdminStore] Claiming farmstand instantly:', farmstandId, 'for user:', userId);

    // Step 1: Always fetch the latest claim state from Supabase first
    const { data: freshData, error: freshErr } = await supabase
      .from<Record<string, unknown>>('farmstands')
      .select('id, claimed_by, claimed_at')
      .eq('id', farmstandId)
      .execute();

    if (freshErr) {
      console.error('[AdminStore] Error fetching farmstand claim state:', freshErr);
      return { success: false, error: 'Failed to check farmstand status. Please try again.' };
    }

    if (!freshData || freshData.length === 0) {
      return { success: false, error: 'Farmstand not found' };
    }

    const farmstandData = freshData[0] as { id: string; claimed_by?: string | null; claimed_at?: string | null };
    console.log('[AdminStore] Fresh claim data:', JSON.stringify(farmstandData));
    console.log('[AdminStore] claimed_by value:', farmstandData.claimed_by, 'type:', typeof farmstandData.claimed_by);

    // Check if already claimed (claimed_by IS NOT NULL and not empty string)
    // IMPORTANT: Only block if claimed_by is a non-empty string (actual user ID)
    const isAlreadyClaimed = farmstandData.claimed_by !== null &&
                              farmstandData.claimed_by !== undefined &&
                              farmstandData.claimed_by !== '' &&
                              typeof farmstandData.claimed_by === 'string' &&
                              farmstandData.claimed_by.length > 0;

    if (isAlreadyClaimed) {
      // Already claimed
      if (farmstandData.claimed_by === userId) {
        // Same user already owns it
        return { success: false, error: 'You have already claimed this farmstand.' };
      }
      // Someone else claimed it
      console.log('[AdminStore] Farmstand already claimed by:', farmstandData.claimed_by);
      return { success: false, error: 'This farmstand has already been claimed by another user.' };
    }

    console.log('[AdminStore] Farmstand is unclaimed, proceeding with claim...');

    // Step B: Attempt claim by updating the farmstand
    // We already verified claimed_by is null above, so just do the update
    // Note: Removed .is('claimed_by', 'null') because it doesn't work reliably
    // and we already validated the state above
    const { data: updateData, error: supabaseError } = await supabase
      .from<Record<string, unknown>>('farmstands')
      .update({
        claimed_by: userId,
        claimed_at: now,
        updated_at: now,
      })
      .eq('id', farmstandId)
      .select('id, claimed_by, claimed_at')
      .execute();

    // Step E: Handle Supabase errors
    if (supabaseError) {
      console.error('[AdminStore] Supabase claim error:', supabaseError);
      const errorMessage = supabaseError.message || '';
      // Check if it's an RLS error
      if (errorMessage.includes('row-level security') || errorMessage.includes('RLS') || errorMessage.includes('policy')) {
        return {
          success: false,
          error: 'Permission denied. Please contact support to claim this farmstand.'
        };
      }
      return { success: false, error: 'Claim failed. Please try again.' };
    }

    // Step D: If update affects 0 rows, this is likely an RLS policy issue
    // Do NOT assume it's "already claimed" - the ClaimForm will re-fetch to verify
    if (!updateData || updateData.length === 0) {
      console.log('[AdminStore] No rows updated - RLS may have blocked the update');
      console.log('[AdminStore] This usually means the RLS policy requires authentication');
      return { success: false, error: 'Update blocked - check database permissions.' };
    }

    // Step C: Verify the claim was successful by checking the returned data
    const claimedData = updateData[0] as { id: string; claimed_by?: string | null; claimed_at?: string | null };
    if (claimedData.claimed_by !== userId) {
      console.log('[AdminStore] Claim verification failed - claimed_by mismatch:', claimedData.claimed_by, '!==', userId);
      return { success: false, error: 'Claim verification failed. Please try again.' };
    }

    console.log('[AdminStore] Claim successful! claimed_by:', claimedData.claimed_by, 'claimed_at:', claimedData.claimed_at);

    // Step C continued: Update local state with the returned row
    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId
        ? {
            ...f,
            claimStatus: 'claimed' as const,
            ownerUserId: userId,
            claimedByUserId: userId,
            claimedAt: claimedData.claimed_at || now,
            updatedAt: now,
          }
        : f
    );

    set({ allFarmstands: farmstands });

    // Store the claim info so the user gets farmer status on next load
    const approvedClaims = await AsyncStorage.getItem('approved_claims') || '[]';
    const claims = JSON.parse(approvedClaims);
    claims.push({
      farmstandId: farmstandId,
      requesterUserId: userId,
      requesterEmail: null,
      approvedAt: now,
    });
    await AsyncStorage.setItem('approved_claims', JSON.stringify(claims));

    console.log('[AdminStore] Farmstand claimed successfully:', farmstandId);
    return { success: true };
  },

  // Claim Request Methods
  submitClaimRequest: async (request) => {
    // IMPORTANT: User must be logged in to submit a claim
    if (!request.requester_id) {
      return { success: false, error: 'You must be logged in to submit a claim request' };
    }

    // IMPORTANT: Name and email are required
    if (!request.requester_name?.trim()) {
      return { success: false, error: 'Full name is required' };
    }

    if (!request.requester_email?.trim()) {
      return { success: false, error: 'Email is required' };
    }

    const farmstand = get().allFarmstands.find(f => f.id === request.farmstand_id);

    if (!farmstand) {
      return { success: false, error: 'Farmstand not found' };
    }

    if (farmstand.claimStatus === 'claimed') {
      return { success: false, error: 'This farmstand has already been claimed' };
    }

    // Check Supabase for existing pending request
    if (isSupabaseConfigured() && isUuid(request.requester_id)) {
      try {
        const { data: existingClaims, error: checkError } = await supabase
          .from<Record<string, unknown>>('claim_requests')
          .select('id')
          .eq('farmstand_id', request.farmstand_id)
          .eq('user_id', request.requester_id)
          .eq('status', 'pending')
          .execute();

        if (!checkError && existingClaims && existingClaims.length > 0) {
          return { success: false, error: 'You already have a pending claim request for this farmstand' };
        }
      } catch (err) {
        console.log('[AdminStore] Could not check existing claims in Supabase:', err);
      }
    }

    // Fallback check in local store
    const existingRequest = get().claimRequests.find(
      r => r.farmstand_id === request.farmstand_id &&
           r.requester_id === request.requester_id &&
           r.status === 'pending'
    );

    if (existingRequest) {
      return { success: false, error: 'You already have a pending claim request for this farmstand' };
    }

    const now = new Date().toISOString();

    // Supabase is required — claims must be visible to admins in Supabase
    if (!isSupabaseConfigured() || !isUuid(request.requester_id)) {
      return { success: false, error: 'Claim submission requires a valid account and database connection.' };
    }

    try {
      const session = await getValidSession();
      if (!session?.access_token) {
        return { success: false, error: 'Session expired. Please sign in again.' };
      }

      if (__DEV__) {
        console.log('[ClaimSubmit] EXPO_PUBLIC_SUPABASE_URL:', process.env.EXPO_PUBLIC_SUPABASE_URL ? 'present' : 'MISSING');
        console.log('[ClaimSubmit] EXPO_PUBLIC_SUPABASE_ANON_KEY:', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ? 'present' : 'MISSING');
        console.log('[ClaimSubmit] userId:', request.requester_id);
        console.log('[ClaimSubmit] farmstandId:', request.farmstand_id);
        console.log('[ClaimSubmit] evidenceUrlCount:', request.evidence_urls?.length ?? 0);
        console.log('[ClaimSubmit] firstEvidenceUrl:', request.evidence_urls?.[0]?.slice(0, 80) ?? 'none');
        console.log('[ClaimSubmit] path: submit_claim_request RPC');
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc<{ success: boolean; error?: string; claim_request_id?: string }>(
        'submit_claim_request',
        {
          p_farmstand_id:    request.farmstand_id,
          p_user_id:         request.requester_id,
          p_requester_name:  request.requester_name.trim(),
          p_requester_email: request.requester_email.trim().toLowerCase(),
          p_evidence_urls:   request.evidence_urls || [],
          p_notes:           request.notes?.trim() || null,
        },
      );

      if (__DEV__) {
        console.log('[ClaimSubmit] RPC rpcError:', rpcError ? rpcError.message : 'none');
        console.log('[ClaimSubmit] RPC rpcData:', JSON.stringify(rpcData));
      }

      if (rpcError || !rpcData?.success) {
        if (__DEV__) console.warn('[AdminStore] submit_claim_request failed:', rpcError?.message ?? rpcData?.error);
        return { success: false, error: 'Claim could not be submitted. Please try again.' };
      }

      console.log('[AdminStore] Claim submitted successfully — claim_request_id:', (rpcData as { claim_request_id?: string }).claim_request_id ?? 'not returned');

      // DEV verification: confirm the row is visible via direct table read (checks RLS / insert success)
      if (__DEV__) {
        try {
          const { data: verifyData, error: verifyError } = await supabase
            .from<Record<string, unknown>>('claim_requests')
            .select('id, status, created_at, evidence_urls')
            .eq('farmstand_id', request.farmstand_id)
            .eq('user_id', request.requester_id)
            .order('created_at', { ascending: false })
            .execute();
          console.log('[ClaimSubmit] DEV verify — error:', verifyError?.message ?? 'none');
          console.log('[ClaimSubmit] DEV verify — rows found:', verifyData?.length ?? 0);
          if (verifyData && verifyData.length > 0) {
            verifyData.slice(0, 3).forEach((r, idx) => {
              console.log(`[ClaimSubmit] DEV verify row[${idx}] id=${r.id} status=${r.status} created_at=${r.created_at} evidenceCount=${Array.isArray(r.evidence_urls) ? (r.evidence_urls as string[]).length : 0}`);
            });
          }
        } catch (ve) {
          console.warn('[ClaimSubmit] DEV verify exception:', ve);
        }
      }

      // Optimistic update: immediately mark this farmstand as pending in the claim overlay
      // so FarmstandDetail shows "Claim pending" instantly without waiting for a refetch
      get().applyClaimOverride(request.farmstand_id, {
        claimStatus: 'pending',
        ownerId: null,
        claimedBy: request.requester_id ?? null,
        claimedAt: now,
        userClaimRequestStatus: 'pending',
      });
      console.log('[claim] optimistic pending applied', request.farmstand_id);

      // Update local state so UI refreshes immediately
      const newRequest: ClaimRequest = {
        id: `claim-${Date.now()}`,
        farmstand_id: request.farmstand_id,
        requester_id: request.requester_id,
        requester_name: request.requester_name.trim(),
        requester_email: request.requester_email.trim().toLowerCase(),
        notes: request.notes || null,
        evidence_urls: request.evidence_urls || [],
        status: 'pending',
        reviewed_at: null,
        reviewed_by: null,
        created_at: now,
      };

      const claimRequests = [...get().claimRequests, newRequest];
      await AsyncStorage.setItem('admin_claim_requests', JSON.stringify(claimRequests));
      set({ claimRequests });

      // Best-effort admin email — fire-and-forget, mirrors farmstand_submitted pattern
      const farmstandName = get().allFarmstands.find(f => f.id === request.farmstand_id)?.name ?? '';
      const hwUrl = `${getSupabaseUrl()}/functions/v1/hyper-worker`;
      console.log('[ClaimSubmit] hyper-worker firing — type: claim_requested | url:', hwUrl);
      fetch(hwUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''}`,
        },
        body: JSON.stringify({
          type: 'claim_requested',
          data: {
            farmstand_name:    farmstandName,
            farmstand_id:      request.farmstand_id,
            requester_name:    request.requester_name.trim(),
            requester_email:   request.requester_email.trim().toLowerCase(),
            requester_user_id: request.requester_id,
            notes:             request.notes?.trim() || null,
            attachment_info:   request.evidence_urls && request.evidence_urls.length > 0
              ? `${request.evidence_urls.length} photo(s) attached`
              : null,
            submitted_at: now,
          },
        }),
      }).then(async (r) => {
        const body = await r.text().catch(() => '(unreadable)');
        console.log('[ClaimSubmit] hyper-worker response — status:', r.status, '| body:', body);
      }).catch((err: unknown) => console.warn('[ClaimSubmit] hyper-worker network error:', err));

      return { success: true };
    } catch (err: any) {
      if (__DEV__) console.warn('[AdminStore] Supabase claim submit exception:', err);
      return { success: false, error: 'Claim could not be submitted. Please try again.' };
    }
  },

  getPendingClaimRequests: () => {
    return get().claimRequests
      .filter(r => r.status === 'pending')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },

  approveClaimRequest: async (requestId: string, adminId: string) => {
    console.log('[AdminStore] approveClaimRequest called - requestId:', requestId, 'adminId:', adminId);

    const request = get().claimRequests.find(r => r.id === requestId);

    if (!request) {
      console.log('[AdminStore] approveClaimRequest: Claim request not found');
      return { success: false, error: 'Claim request not found' };
    }

    // IMPORTANT: requester_id MUST be present - the claimant must be logged in
    if (!request.requester_id) {
      console.log('[AdminStore] approveClaimRequest: Missing requester_id');
      return { success: false, error: 'Claim request is missing requester user ID. The claimant must be logged in to submit a claim.' };
    }

    const farmstand = get().allFarmstands.find(f => f.id === request.farmstand_id);

    if (!farmstand) {
      console.log('[AdminStore] approveClaimRequest: Farmstand not found');
      return { success: false, error: 'Farmstand not found' };
    }

    if (farmstand.claimStatus === 'claimed') {
      console.log('[AdminStore] approveClaimRequest: Farmstand already claimed');
      return { success: false, error: 'This farmstand has already been claimed' };
    }

    const now = new Date().toISOString();

    // NOTE: We skip the RPC function and use direct updates instead because
    // the Supabase RPC triggers have a conflict ("tuple to be updated was already modified").
    // Direct table updates work correctly without trigger issues.

    // Manual update (local + direct Supabase update)
    const claimRequests = get().claimRequests.map(r =>
      r.id === requestId
        ? { ...r, status: 'approved' as const, reviewed_at: now, reviewed_by: adminId }
        : r
    );

    const ownerUserId = request.requester_id as string;
    const farmstands = get().allFarmstands.map(f =>
      f.id === request.farmstand_id
        ? { ...f, claimStatus: 'claimed' as const, ownerUserId, claimedByUserId: ownerUserId, claimedAt: now, updatedAt: now }
        : f
    );

    // Update Supabase directly if RPC failed
    if (isSupabaseConfigured()) {
      // Use ensureSessionReady to handle race conditions on cold start
      console.log('[AdminStore] approveClaimRequest: Checking session...');
      const session = await ensureSessionReady();
      console.log('[AdminStore] approveClaimRequest: Session check result - hasSession:', !!session, 'hasAccessToken:', !!session?.access_token);

      if (!session) {
        console.log('[AdminStore] approveClaimRequest: No session, returning error');
        return { success: false, error: 'Please sign in to continue.' };
      }

      try {
        console.log('[AdminStore] approveClaimRequest: Updating farmstand claimed_by and owner_id to:', ownerUserId);
        const { error: farmstandError } = await supabase
          .from('farmstands')
          .update({ claimed_by: ownerUserId, owner_id: ownerUserId, claimed_at: now, claim_status: 'claimed', updated_at: now })
          .eq('id', request.farmstand_id)
          .execute();

        if (farmstandError) {
          console.log('[AdminStore] approveClaimRequest: Farmstand update error - code:', (farmstandError as any).code, 'message:', farmstandError.message, 'status:', (farmstandError as any).status);
        } else {
          console.log('[AdminStore] approveClaimRequest: Farmstand update successful');
        }

        // Only update claim_requests if it's a valid UUID (Supabase-created record)
        if (isUuid(requestId)) {
          console.log('[AdminStore] approveClaimRequest: Updating claim_requests table');
          const { error: claimError } = await supabase
            .from('claim_requests')
            .update({ status: 'approved', reviewed_at: now, reviewed_by: adminId })
            .eq('id', requestId)
            .execute();

          if (claimError) {
            console.log('[AdminStore] approveClaimRequest: Claim request update error - code:', (claimError as any).code, 'message:', claimError.message);
          } else {
            console.log('[AdminStore] approveClaimRequest: Claim request update successful');
          }
        }

        console.log('[AdminStore] approveClaimRequest: Completed via direct Supabase update');
      } catch (err) {
        console.log('[AdminStore] approveClaimRequest: Unexpected error:', err instanceof Error ? err.message : 'Unknown');
      }
    }

    await AsyncStorage.setItem('admin_claim_requests', JSON.stringify(claimRequests));
    set({ claimRequests, allFarmstands: farmstands });

    // Store approved claim info
    const approvedClaims = await AsyncStorage.getItem('approved_claims') || '[]';
    const claims = JSON.parse(approvedClaims);
    claims.push({
      farmstandId: request.farmstand_id,
      requesterEmail: request.requester_email.toLowerCase(),
      requesterUserId: request.requester_id,
      approvedAt: now,
    });
    await AsyncStorage.setItem('approved_claims', JSON.stringify(claims));

    // Create an alert for the user
    if (request.requester_id) {
      await createAlert({
        user_id: request.requester_id,
        farmstand_id: request.farmstand_id,
        type: 'claim_approved',
        title: 'Claim Approved!',
        body: `Your claim for "${farmstand.name}" has been approved. You can now manage your farmstand.`,
        action_route: 'FarmstandDetail',
        action_params: { farmstandId: request.farmstand_id },
      });
    }

    // Force-refresh the newly-approved owner's farmstand list so their
    // Profile "My Farmstand" section appears instantly.
    // After refresh, clear the optimistic override so fresh DB state drives the UI
    // on every device (without this, the admin's override lingers and blocks reconciliation).
    get().refreshSingleFarmstand(request.farmstand_id)
      .then(() => { get().clearClaimOverride(request.farmstand_id); })
      .catch(() => {});
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useBootstrapStore } = require('./bootstrap-store') as { useBootstrapStore: { getState: () => { refreshUserFarmstands: () => Promise<void> } } };
      useBootstrapStore.getState().refreshUserFarmstands().catch(() => {});
    } catch { /* bootstrap store not available */ }

    return { success: true };
  },

  denyClaimRequest: async (requestId: string, adminId: string, message?: string) => {
    console.log('[AdminStore] denyClaimRequest called - requestId:', requestId, 'adminId:', adminId);

    const request = get().claimRequests.find(r => r.id === requestId);

    if (!request) {
      console.log('[AdminStore] denyClaimRequest: Claim request not found');
      return { success: false, error: 'Claim request not found' };
    }

    const farmstand = get().allFarmstands.find(f => f.id === request.farmstand_id);
    const now = new Date().toISOString();

    // OPTIMISTIC UPDATE: immediately clear ownership in the overlay so
    // FarmstandDetail / Profile see "Claim this Farmstand" before the DB round-trip
    get().applyClaimOverride(request.farmstand_id, {
      claimStatus: 'unclaimed',
      ownerId: null,
      claimedBy: null,
      claimedAt: null,
      userClaimRequestStatus: 'none',
    });
    console.log('[claim] optimistic deny applied', request.farmstand_id);

    // NOTE: We skip the RPC function and use direct updates instead because
    // the Supabase RPC triggers have a conflict ("tuple to be updated was already modified").
    // Direct table updates work correctly without trigger issues.

    // Manual update
    const claimRequests = get().claimRequests.map(r =>
      r.id === requestId
        ? { ...r, status: 'denied' as const, reviewed_at: now, reviewed_by: adminId, admin_message: message ?? null }
        : r
    );

    // Update Supabase directly
    if (isSupabaseConfigured()) {
      // Use ensureSessionReady to handle race conditions on cold start
      console.log('[AdminStore] denyClaimRequest: Checking session...');
      const session = await ensureSessionReady();
      console.log('[AdminStore] denyClaimRequest: Session check result - hasSession:', !!session, 'hasAccessToken:', !!session?.access_token);

      if (!session) {
        console.log('[AdminStore] denyClaimRequest: No session, returning error');
        return { success: false, error: 'Please sign in to continue.' };
      }

      try {
        // Only update claim_requests if it's a valid UUID (Supabase-created record)
        if (isUuid(requestId)) {
          console.log('[AdminStore] denyClaimRequest: Updating claim_requests table');
          const updatePayload: Record<string, unknown> = { status: 'denied', reviewed_at: now, reviewed_by: adminId };
          if (message) updatePayload.admin_message = message;
          const { error: claimError } = await supabase
            .from('claim_requests')
            .update(updatePayload)
            .eq('id', requestId)
            .execute();

          if (claimError) {
            console.log('[AdminStore] denyClaimRequest: Claim request update error - code:', (claimError as any).code, 'message:', claimError.message);
          } else {
            console.log('[AdminStore] denyClaimRequest: Claim request update successful');
          }
        }

        // Reset farmstand claim_status to unclaimed AND clear owner fields
        // IMPORTANT: owner_id and claimed_by must be cleared — if left set,
        // mapSupabaseFarmstand will derive claimStatus='claimed' on every other
        // device and keep showing "Message this Farmstand" even after denial.
        console.log('[AdminStore] denyClaimRequest: Resetting farmstand claim_status + clearing owner_id');
        const { error: farmstandError } = await supabase
          .from('farmstands')
          .update({ claim_status: 'unclaimed', owner_id: null, claimed_by: null, claimed_at: null, updated_at: now })
          .eq('id', request.farmstand_id)
          .execute();

        if (farmstandError) {
          console.log('[AdminStore] denyClaimRequest: Farmstand update error - code:', (farmstandError as any).code, 'message:', farmstandError.message);
        } else {
          console.log('[AdminStore] denyClaimRequest: Farmstand update successful');
        }

        console.log('[AdminStore] denyClaimRequest: Completed via direct Supabase update');
      } catch (err) {
        console.log('[AdminStore] denyClaimRequest: Unexpected error:', err instanceof Error ? err.message : 'Unknown');
      }
    }

    await AsyncStorage.setItem('admin_claim_requests', JSON.stringify(claimRequests));
    // Also clear the farmstand's ownership in the local store immediately
    // so Profile and FarmstandDetail don't see stale owner_id until next full reload
    const deniedFarmstandId = request.farmstand_id;
    const updatedFarmstandsAfterDeny = get().allFarmstands.map(f =>
      f.id === deniedFarmstandId
        ? { ...f, ownerUserId: '', claimedByUserId: null, claimStatus: 'unclaimed' as const, claimedAt: null, updatedAt: new Date().toISOString() }
        : f
    );
    set({ claimRequests, allFarmstands: updatedFarmstandsAfterDeny });

    // Refresh the farmstand from Supabase to get authoritative live data,
    // then clear the optimistic override so the live data takes over
    get().refreshSingleFarmstand(deniedFarmstandId)
      .then(() => {
        get().clearClaimOverride(deniedFarmstandId);
        console.log('[claim] refetched farmstand state after deny', deniedFarmstandId);
        // Also force-refresh the user's owned farmstand list so Profile
        // immediately reflects that the denied claim is gone
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useBootstrapStore } = require('./bootstrap-store') as { useBootstrapStore: { getState: () => { refreshUserFarmstands: () => Promise<void> } } };
          useBootstrapStore.getState().refreshUserFarmstands().catch(() => {});
        } catch { /* bootstrap store not available */ }
      })
      .catch(() => {});

    // Create an alert for the user to notify them of denial
    if (request.requester_id) {
      await createAlert({
        user_id: request.requester_id,
        farmstand_id: request.farmstand_id,
        type: 'claim_denied',
        title: 'Claim Request Denied',
        body: `Your claim for "${farmstand?.name || 'this farmstand'}" was not approved. Please contact support if you believe this is an error.`,
        action_route: null,
        action_params: null,
      });
    }

    return { success: true };
  },

  requestMoreInfo: async (requestId: string, adminId: string, note: string) => {
    const request = get().claimRequests.find(r => r.id === requestId);

    if (!request) {
      return { success: false, error: 'Claim request not found' };
    }

    const now = new Date().toISOString();

    const claimRequests = get().claimRequests.map(r =>
      r.id === requestId
        ? { ...r, status: 'needs_more_info' as const, reviewed_at: now, reviewed_by: adminId, admin_message: note }
        : r
    );

    // Write to Supabase
    if (isSupabaseConfigured() && isUuid(requestId)) {
      const session = await ensureSessionReady();
      if (session) {
        try {
          const { error } = await supabase
            .from('claim_requests')
            .update({ status: 'needs_more_info', reviewed_at: now, reviewed_by: adminId, admin_message: note })
            .eq('id', requestId)
            .execute();
          if (error) {
            console.log('[AdminStore] requestMoreInfo: update error:', error.message);
          } else {
            console.log('[AdminStore] requestMoreInfo: update successful');
          }
        } catch (err) {
          console.log('[AdminStore] requestMoreInfo: unexpected error:', err instanceof Error ? err.message : 'Unknown');
        }
      }
    }

    await AsyncStorage.setItem('admin_claim_requests', JSON.stringify(claimRequests));
    set({ claimRequests });

    return { success: true };
  },

  getClaimRequestsForFarmstand: (farmstandId: string) => {
    return get().claimRequests.filter(r => r.farmstand_id === farmstandId);
  },

  // Flagged Content / Reports Methods
  submitReport: async (report) => {
    // Check if there's already a pending report for the same content from the same user
    const existingReport = get().flaggedContent.find(
      r => r.contentId === report.contentId &&
           r.reportedBy === report.reportedBy &&
           r.status === 'pending'
    );

    if (existingReport) {
      return { success: false, error: 'You have already reported this content' };
    }

    const newReport: FlaggedContent = {
      ...report,
      id: `report-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'pending',
      resolvedAt: null,
      resolvedBy: null,
      adminNote: null,
    };

    const flaggedContent = [...get().flaggedContent, newReport];
    await AsyncStorage.setItem('admin_flagged_content', JSON.stringify(flaggedContent));
    set({ flaggedContent });

    return { success: true };
  },

  getPendingReports: () => {
    return get().flaggedContent
      .filter(r => r.status === 'pending')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  getAllReports: () => {
    return get().flaggedContent
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  resolveReport: async (reportId: string, adminId: string, adminNote?: string) => {
    const report = get().flaggedContent.find(r => r.id === reportId);

    if (!report) {
      return { success: false, error: 'Report not found' };
    }

    const flaggedContent = get().flaggedContent.map(r =>
      r.id === reportId
        ? {
            ...r,
            status: 'resolved' as const,
            resolvedAt: new Date().toISOString(),
            resolvedBy: adminId,
            adminNote: adminNote ?? null,
          }
        : r
    );

    await AsyncStorage.setItem('admin_flagged_content', JSON.stringify(flaggedContent));
    set({ flaggedContent });

    return { success: true };
  },

  dismissReport: async (reportId: string, adminId: string, adminNote?: string) => {
    const report = get().flaggedContent.find(r => r.id === reportId);

    if (!report) {
      return { success: false, error: 'Report not found' };
    }

    const flaggedContent = get().flaggedContent.map(r =>
      r.id === reportId
        ? {
            ...r,
            status: 'dismissed' as const,
            resolvedAt: new Date().toISOString(),
            resolvedBy: adminId,
            adminNote: adminNote ?? null,
          }
        : r
    );

    await AsyncStorage.setItem('admin_flagged_content', JSON.stringify(flaggedContent));
    set({ flaggedContent });

    return { success: true };
  },

  // NEW: Unified Reports & Flags Methods
  submitReportOrReview: async (submission) => {
    // Validation
    if (!submission.reason) {
      return { success: false, error: 'Reason is required' };
    }
    if (!submission.comments) {
      return { success: false, error: 'Comments are required' };
    }
    if (submission.submissionType === 'review' && !submission.rating) {
      return { success: false, error: 'Rating is required for reviews' };
    }

    const reportId = `rpt-${Date.now()}`;
    const now = new Date().toISOString();

    const newSubmission: ReportAndFlag = {
      ...submission,
      id: reportId,
      createdAt: now,
      status: 'pending',
      reviewedAt: null,
      reviewedBy: null,
      adminNote: null,
    };

    const reportsAndFlags = [...get().reportsAndFlags, newSubmission];
    await AsyncStorage.setItem('admin_reports_and_flags', JSON.stringify(reportsAndFlags));
    set({ reportsAndFlags });

    // Automatically create a support ticket for this report
    const ticketId = `ticket-${Date.now()}`;
    const newTicket: SupportTicket = {
      ticketId,
      reportId,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      farmerUserId: submission.submittedByUserId,
      farmerEmail: submission.submittedByUserEmail,
      subject: `Support request: ${submission.reason}`,
      category: submission.reason,
      rating: submission.rating ?? null,
      lastMessagePreview: submission.comments.slice(0, 120),
      lastMessageAt: now,
      assignedAdminId: null,
      assignedAdminEmail: null,
    };

    const newMessage: SupportMessage = {
      messageId: `msg-${Date.now()}`,
      ticketId,
      senderRole: 'farmer',
      senderUserId: submission.submittedByUserId,
      senderEmail: submission.submittedByUserEmail,
      messageText: submission.comments,
      createdAt: now,
      editedAt: null,
      isEdited: false,
      isVisibleToFarmer: true,
      attachmentUrl: null,
    };

    const supportTickets = [...get().supportTickets, newTicket];
    const supportMessages = [...get().supportMessages, newMessage];

    await AsyncStorage.setItem('support_tickets', JSON.stringify(supportTickets));
    await AsyncStorage.setItem('support_messages', JSON.stringify(supportMessages));
    set({ supportTickets, supportMessages });

    return { success: true };
  },

  getAllReportsAndFlags: () => {
    return get().reportsAndFlags.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },

  getReportsAndFlagsByStatus: (status: ReportStatus) => {
    return get().reportsAndFlags
      .filter(r => r.status === status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  markReportAsReviewed: async (reportId: string, adminId: string, adminNote?: string) => {
    const report = get().reportsAndFlags.find(r => r.id === reportId);

    if (!report) {
      return { success: false, error: 'Report not found' };
    }

    const reportsAndFlags = get().reportsAndFlags.map(r =>
      r.id === reportId
        ? {
            ...r,
            status: 'reviewed' as const,
            reviewedAt: new Date().toISOString(),
            reviewedBy: adminId,
            adminNote: adminNote ?? null,
          }
        : r
    );

    await AsyncStorage.setItem('admin_reports_and_flags', JSON.stringify(reportsAndFlags));
    set({ reportsAndFlags });

    return { success: true };
  },

  resolveReportAndFlag: async (reportId: string, adminId: string, adminNote?: string) => {
    const report = get().reportsAndFlags.find(r => r.id === reportId);

    if (!report) {
      return { success: false, error: 'Report not found' };
    }

    const reportsAndFlags = get().reportsAndFlags.map(r =>
      r.id === reportId
        ? {
            ...r,
            status: 'resolved' as const,
            reviewedAt: new Date().toISOString(),
            reviewedBy: adminId,
            adminNote: adminNote ?? null,
          }
        : r
    );

    await AsyncStorage.setItem('admin_reports_and_flags', JSON.stringify(reportsAndFlags));
    set({ reportsAndFlags });

    return { success: true };
  },

  dismissReportAndFlag: async (reportId: string, adminId: string, adminNote?: string) => {
    const report = get().reportsAndFlags.find(r => r.id === reportId);

    if (!report) {
      return { success: false, error: 'Report not found' };
    }

    const reportsAndFlags = get().reportsAndFlags.map(r =>
      r.id === reportId
        ? {
            ...r,
            status: 'dismissed' as const,
            reviewedAt: new Date().toISOString(),
            reviewedBy: adminId,
            adminNote: adminNote ?? null,
          }
        : r
    );

    await AsyncStorage.setItem('admin_reports_and_flags', JSON.stringify(reportsAndFlags));
    set({ reportsAndFlags });

    return { success: true };
  },

  // Support Ticket System Methods
  createSupportTicket: async (reportId: string, farmerUserId: string | null, farmerEmail: string, subject: string, category: string, rating: number | null, initialMessage: string) => {
    const now = new Date().toISOString();
    const ticketId = `ticket-${Date.now()}`;

    const newTicket: SupportTicket = {
      ticketId,
      reportId,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      farmerUserId,
      farmerEmail,
      subject,
      category,
      rating,
      lastMessagePreview: initialMessage.slice(0, 120),
      lastMessageAt: now,
      assignedAdminId: null,
      assignedAdminEmail: null,
    };

    const newMessage: SupportMessage = {
      messageId: `msg-${Date.now()}`,
      ticketId,
      senderRole: 'farmer',
      senderUserId: farmerUserId,
      senderEmail: farmerEmail,
      messageText: initialMessage,
      createdAt: now,
      editedAt: null,
      isEdited: false,
      isVisibleToFarmer: true,
      attachmentUrl: null,
    };

    const supportTickets = [...get().supportTickets, newTicket];
    const supportMessages = [...get().supportMessages, newMessage];

    await AsyncStorage.setItem('support_tickets', JSON.stringify(supportTickets));
    await AsyncStorage.setItem('support_messages', JSON.stringify(supportMessages));
    set({ supportTickets, supportMessages });

    return { success: true, ticketId };
  },

  getTicketByReportId: (reportId: string) => {
    return get().supportTickets.find(t => t.reportId === reportId);
  },

  getTicketById: (ticketId: string) => {
    return get().supportTickets.find(t => t.ticketId === ticketId);
  },

  getAllSupportTickets: () => {
    return get().supportTickets.sort((a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
  },

  getTicketsByFarmerUserId: (farmerUserId: string) => {
    return get().supportTickets
      .filter(t => t.farmerUserId === farmerUserId)
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  },

  getSupportTicketsByFarmerUserId: (farmerUserId: string) => {
    return get().supportTickets
      .filter(t => t.farmerUserId === farmerUserId)
      .filter(t => {
        const cat = (t.category ?? '').toLowerCase();
        const subject = (t.subject ?? '').toLowerCase();
        return !cat.includes('review') && !subject.includes('customer review') && !subject.includes('new review');
      })
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  },

  getTicketsByStatus: (status: TicketStatus) => {
    return get().supportTickets
      .filter(t => t.status === status)
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  },

  updateTicketStatus: async (ticketId: string, status: TicketStatus) => {
    const ticket = get().supportTickets.find(t => t.ticketId === ticketId);
    if (!ticket) {
      return { success: false, error: 'Ticket not found' };
    }

    const supportTickets = get().supportTickets.map(t =>
      t.ticketId === ticketId
        ? { ...t, status, updatedAt: new Date().toISOString() }
        : t
    );

    await AsyncStorage.setItem('support_tickets', JSON.stringify(supportTickets));
    set({ supportTickets });

    return { success: true };
  },

  resolveTicket: async (ticketId: string, adminId: string) => {
    const ticket = get().supportTickets.find(t => t.ticketId === ticketId);
    if (!ticket) {
      return { success: false, error: 'Ticket not found' };
    }

    const supportTickets = get().supportTickets.map(t =>
      t.ticketId === ticketId
        ? { ...t, status: 'resolved' as TicketStatus, updatedAt: new Date().toISOString(), assignedAdminId: adminId }
        : t
    );

    await AsyncStorage.setItem('support_tickets', JSON.stringify(supportTickets));
    set({ supportTickets });

    return { success: true };
  },

  reopenTicket: async (ticketId: string, adminId: string) => {
    const ticket = get().supportTickets.find(t => t.ticketId === ticketId);
    if (!ticket) {
      return { success: false, error: 'Ticket not found' };
    }

    const supportTickets = get().supportTickets.map(t =>
      t.ticketId === ticketId
        ? { ...t, status: 'reopened' as TicketStatus, updatedAt: new Date().toISOString(), assignedAdminId: adminId }
        : t
    );

    await AsyncStorage.setItem('support_tickets', JSON.stringify(supportTickets));
    set({ supportTickets });

    return { success: true };
  },

  // Support Message Methods
  getMessagesByTicketId: (ticketId: string) => {
    return get().supportMessages
      .filter(m => m.ticketId === ticketId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  sendAdminMessage: async (ticketId: string, adminUserId: string, adminEmail: string, messageText: string) => {
    const ticket = get().supportTickets.find(t => t.ticketId === ticketId);
    if (!ticket) {
      return { success: false, error: 'Ticket not found' };
    }

    const now = new Date().toISOString();
    const newMessage: SupportMessage = {
      messageId: `msg-${Date.now()}`,
      ticketId,
      senderRole: 'admin',
      senderUserId: adminUserId,
      senderEmail: adminEmail,
      messageText,
      createdAt: now,
      editedAt: null,
      isEdited: false,
      isVisibleToFarmer: true,
      attachmentUrl: null,
    };

    const supportMessages = [...get().supportMessages, newMessage];
    const supportTickets = get().supportTickets.map(t =>
      t.ticketId === ticketId
        ? {
            ...t,
            updatedAt: now,
            lastMessagePreview: messageText.slice(0, 120),
            lastMessageAt: now,
            status: 'waiting_on_farmer' as TicketStatus,
            assignedAdminId: adminUserId,
            assignedAdminEmail: adminEmail,
          }
        : t
    );

    await AsyncStorage.setItem('support_messages', JSON.stringify(supportMessages));
    await AsyncStorage.setItem('support_tickets', JSON.stringify(supportTickets));
    set({ supportMessages, supportTickets });

    return { success: true };
  },

  sendFarmerMessage: async (ticketId: string, farmerUserId: string, farmerEmail: string, messageText: string) => {
    const ticket = get().supportTickets.find(t => t.ticketId === ticketId);
    if (!ticket) {
      return { success: false, error: 'Ticket not found' };
    }

    // Check that this farmer owns this ticket
    if (ticket.farmerUserId !== farmerUserId) {
      return { success: false, error: 'You do not have permission to reply to this ticket' };
    }

    const now = new Date().toISOString();
    const newMessage: SupportMessage = {
      messageId: `msg-${Date.now()}`,
      ticketId,
      senderRole: 'farmer',
      senderUserId: farmerUserId,
      senderEmail: farmerEmail,
      messageText,
      createdAt: now,
      editedAt: null,
      isEdited: false,
      isVisibleToFarmer: true,
      attachmentUrl: null,
    };

    // If ticket was resolved, automatically reopen it
    const newStatus: TicketStatus = ticket.status === 'resolved' ? 'reopened' : 'waiting_on_admin';

    const supportMessages = [...get().supportMessages, newMessage];
    const supportTickets = get().supportTickets.map(t =>
      t.ticketId === ticketId
        ? {
            ...t,
            updatedAt: now,
            lastMessagePreview: messageText.slice(0, 120),
            lastMessageAt: now,
            status: newStatus,
          }
        : t
    );

    await AsyncStorage.setItem('support_messages', JSON.stringify(supportMessages));
    await AsyncStorage.setItem('support_tickets', JSON.stringify(supportTickets));
    set({ supportMessages, supportTickets });

    return { success: true };
  },

  editAdminMessage: async (messageId: string, newText: string) => {
    const message = get().supportMessages.find(m => m.messageId === messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    // Only admin messages can be edited
    if (message.senderRole !== 'admin') {
      return { success: false, error: 'Only admin messages can be edited' };
    }

    const now = new Date().toISOString();
    const supportMessages = get().supportMessages.map(m =>
      m.messageId === messageId
        ? { ...m, messageText: newText, isEdited: true, editedAt: now }
        : m
    );

    // Update ticket preview if this was the last message
    const ticket = get().supportTickets.find(t => t.ticketId === message.ticketId);
    let supportTickets = get().supportTickets;
    if (ticket) {
      const ticketMessages = get().supportMessages.filter(m => m.ticketId === ticket.ticketId);
      const lastMessage = ticketMessages.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      if (lastMessage?.messageId === messageId) {
        supportTickets = supportTickets.map(t =>
          t.ticketId === message.ticketId
            ? { ...t, lastMessagePreview: newText.slice(0, 120), updatedAt: now }
            : t
        );
        await AsyncStorage.setItem('support_tickets', JSON.stringify(supportTickets));
      }
    }

    await AsyncStorage.setItem('support_messages', JSON.stringify(supportMessages));
    set({ supportMessages, supportTickets });

    return { success: true };
  },

  // Gold Verification Methods
  evaluateGoldVerificationForFarmstand: async (farmstandId: string) => {
    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) {
      return { success: false, error: 'Farmstand not found' };
    }

    // Skip if admin-controlled
    if (farmstand.goldVerifiedSource === 'admin') {
      return { success: true };
    }

    const result = evaluateGoldVerification(farmstand);

    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId
        ? {
            ...f,
            goldVerified: result.goldVerified,
            goldVerifiedSource: result.goldVerifiedSource,
            updatedAt: new Date().toISOString(),
          }
        : f
    );

    set({ allFarmstands: farmstands });

    return { success: true };
  },

  evaluateAllFarmstandsGoldVerification: async () => {
    const farmstands = get().allFarmstands.map(f => {
      // Skip admin-controlled farmstands
      if (f.goldVerifiedSource === 'admin') {
        return f;
      }

      const result = evaluateGoldVerification(f);
      return {
        ...f,
        goldVerified: result.goldVerified,
        goldVerifiedSource: result.goldVerifiedSource,
      };
    });

    set({ allFarmstands: farmstands });
  },

  setGoldVerifiedAdmin: async (farmstandId: string, goldVerified: boolean, adminId: string) => {
    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) {
      return { success: false, error: 'Farmstand not found' };
    }

    const updates = setGoldVerifiedManually(farmstand, goldVerified);
    const now = new Date().toISOString();

    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId
        ? { ...f, ...updates, updatedAt: now }
        : f
    );

    set({ allFarmstands: farmstands });

    // Log the action
    await get().logGoldVerificationAction(farmstandId, adminId, goldVerified ? 'set gold verified on' : 'set gold verified off');

    return { success: true };
  },

  returnToAutomaticGoldVerification: async (farmstandId: string, adminId: string) => {
    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) {
      return { success: false, error: 'Farmstand not found' };
    }

    const updates = returnToAutomatic(farmstand);
    const now = new Date().toISOString();

    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId
        ? { ...f, ...updates, updatedAt: now }
        : f
    );

    set({ allFarmstands: farmstands });

    // Log the action
    await get().logGoldVerificationAction(farmstandId, adminId, 'return to automatic');

    return { success: true };
  },

  updateFarmstandDisputeStatus: async (farmstandId: string, status: OwnershipDisputeStatus, adminId: string) => {
    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) {
      return { success: false, error: 'Farmstand not found' };
    }

    const updates = handleDisputeStatusChange(farmstand, status);
    const now = new Date().toISOString();

    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId
        ? { ...f, ...updates, updatedAt: now }
        : f
    );

    set({ allFarmstands: farmstands });

    // Log the action
    await get().logGoldVerificationAction(farmstandId, adminId, `dispute status changed to ${status}`);

    return { success: true };
  },

  updateFarmstandReviewStats: async (farmstandId: string, reviewCount: number, avgRating: number) => {
    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) return;

    const now = new Date().toISOString();

    // Update stats and re-evaluate gold verification
    const updatedFarmstand = {
      ...farmstand,
      reviewCount,
      avgRating,
      lastActivityAt: now,
    };

    // Re-evaluate gold verification if not admin-controlled
    let goldUpdates = {};
    if (farmstand.goldVerifiedSource !== 'admin') {
      const result = evaluateGoldVerification(updatedFarmstand);
      goldUpdates = {
        goldVerified: result.goldVerified,
        goldVerifiedSource: result.goldVerifiedSource,
      };
    }

    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId
        ? { ...f, reviewCount, avgRating, lastActivityAt: now, ...goldUpdates, updatedAt: now }
        : f
    );

    set({ allFarmstands: farmstands });
  },

  logGoldVerificationAction: async (farmstandId: string, adminId: string, action: string) => {
    // Store admin actions for audit trail
    const logKey = 'gold_verification_log';
    const existingLog = await AsyncStorage.getItem(logKey);
    const logs = existingLog ? JSON.parse(existingLog) : [];

    logs.push({
      farmstandId,
      adminId,
      action,
      timestamp: new Date().toISOString(),
    });

    // Keep last 1000 entries
    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }

    await AsyncStorage.setItem(logKey, JSON.stringify(logs));
  },

  // Verification Workflow Methods
  verifyFarmstandSubmission: async (farmstandId: string, adminId: string) => {
    console.log('[AdminStore] verifyFarmstandSubmission called - farmstandId:', farmstandId, 'adminId:', adminId);

    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) {
      console.log('[AdminStore] verifyFarmstandSubmission: Farmstand not found');
      return { success: false, error: 'Farmstand not found' };
    }

    const now = new Date().toISOString();

    // Updates for local state (camelCase)
    const localUpdates = {
      verificationStatus: 'VERIFIED' as const,
      verifiedByAdminId: adminId,
      verifiedAt: now,
      lastReviewedAt: now,
      status: 'active' as const,
      approvalStatus: 'approved' as const,
      rejectionReason: null,
      submissionAdminNotes: null,
      deletedAt: null, // Clear deleted_at to ensure farmstand is visible
    };

    // If Supabase is configured, use the RPC function
    if (isSupabaseConfigured()) {
      // Use ensureSessionReady to handle race conditions on cold start
      console.log('[AdminStore] verifyFarmstandSubmission: Checking session...');
      const session = await ensureSessionReady();
      console.log('[AdminStore] verifyFarmstandSubmission: Session check result - hasSession:', !!session, 'hasAccessToken:', !!session?.access_token);

      if (!session) {
        console.log('[AdminStore] verifyFarmstandSubmission: No session, returning error');
        return { success: false, error: 'Please sign in to continue.' };
      }

      console.log('[AdminStore] verifyFarmstandSubmission: Calling RPC approve_farmstand:', farmstandId);

      // Call the approve_farmstand RPC function
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('approve_farmstand', { p_farmstand_id: farmstandId });

      console.log('[AdminStore] verifyFarmstandSubmission: RPC result - data:', JSON.stringify(rpcData), 'error:', rpcError ? `code: ${(rpcError as any).code}, message: ${rpcError.message}, status: ${(rpcError as any).status}` : 'none');

      if (rpcError) {
        console.log('[AdminStore] verifyFarmstandSubmission: RPC error details - code:', (rpcError as any).code, 'hint:', (rpcError as any).hint, 'details:', (rpcError as any).details);
        const errorDetails = [
          rpcError.message,
          (rpcError as any).code ? `Code: ${(rpcError as any).code}` : '',
          (rpcError as any).hint ? `Hint: ${(rpcError as any).hint}` : '',
          (rpcError as any).details ? `Details: ${(rpcError as any).details}` : '',
        ].filter(Boolean).join('\n');
        return { success: false, error: errorDetails };
      }

      console.log('[AdminStore] verifyFarmstandSubmission: RPC success');
    }

    // Update local state
    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId ? { ...f, ...localUpdates, updatedAt: now } : f
    );

    set({ allFarmstands: farmstands });

    return { success: true };
  },

  rejectFarmstandSubmission: async (farmstandId: string, adminId: string, reason: string) => {
    console.log('[AdminStore] rejectFarmstandSubmission called - farmstandId:', farmstandId, 'adminId:', adminId, 'reason:', reason);

    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) {
      console.log('[AdminStore] rejectFarmstandSubmission: Farmstand not found');
      return { success: false, error: 'Farmstand not found' };
    }

    const now = new Date().toISOString();

    // Updates for local state (camelCase)
    // ONLY set deletedAt - do NOT change status
    // All local filters check `!f.deletedAt` so this removes it from all lists
    const localUpdates = {
      verificationStatus: 'REJECTED' as const,
      verifiedByAdminId: adminId,
      lastReviewedAt: now,
      rejectionReason: reason,
      visibilityStatus: 'HIDDEN' as const,
      deletedAt: now, // Soft delete - this ensures it never appears in any list
    };

    // If Supabase is configured, use the RPC function
    if (isSupabaseConfigured()) {
      // Use ensureSessionReady to handle race conditions on cold start
      console.log('[AdminStore] rejectFarmstandSubmission: Checking session...');
      const session = await ensureSessionReady();
      console.log('[AdminStore] rejectFarmstandSubmission: Session check result - hasSession:', !!session, 'hasAccessToken:', !!session?.access_token);

      if (!session) {
        console.log('[AdminStore] rejectFarmstandSubmission: No session, returning error');
        return { success: false, error: 'Please sign in to continue.' };
      }

      console.log('[AdminStore] rejectFarmstandSubmission: Calling RPC deny_farmstand:', farmstandId);

      // Call the deny_farmstand RPC function
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('deny_farmstand', { p_farmstand_id: farmstandId });

      console.log('[AdminStore] rejectFarmstandSubmission: RPC result - data:', JSON.stringify(rpcData), 'error:', rpcError ? `code: ${(rpcError as any).code}, message: ${rpcError.message}, status: ${(rpcError as any).status}` : 'none');

      if (rpcError) {
        console.log('[AdminStore] rejectFarmstandSubmission: RPC error details - code:', (rpcError as any).code, 'hint:', (rpcError as any).hint, 'details:', (rpcError as any).details);
        const errorDetails = [
          rpcError.message,
          (rpcError as any).code ? `Code: ${(rpcError as any).code}` : '',
          (rpcError as any).hint ? `Hint: ${(rpcError as any).hint}` : '',
          (rpcError as any).details ? `Details: ${(rpcError as any).details}` : '',
        ].filter(Boolean).join('\n');
        return { success: false, error: errorDetails };
      }

      console.log('[AdminStore] rejectFarmstandSubmission: RPC success');
    }

    // Update local state - REMOVE the farmstand entirely to ensure immediate UI update
    // The farmstand has deletedAt set, so it should never appear in lists anyway
    // Removing it immediately prevents any visual "pop back" glitches
    const farmstands = get().allFarmstands.filter(f => f.id !== farmstandId);

    set({ allFarmstands: farmstands });

    return { success: true };
  },

  requestMoreInfoForSubmission: async (farmstandId: string, adminId: string, note: string) => {
    const farmstand = get().allFarmstands.find(f => f.id === farmstandId);
    if (!farmstand) {
      return { success: false, error: 'Farmstand not found' };
    }

    const now = new Date().toISOString();

    // Updates for local state (camelCase)
    const localUpdates = {
      verificationStatus: 'NEEDS_INFO' as const,
      submissionAdminNotes: note,
      lastReviewedAt: now,
    };

    // If Supabase is configured, update there first
    if (isSupabaseConfigured()) {
      console.log('[AdminStore] Requesting more info in Supabase:', farmstandId);

      // Supabase update - only use columns that exist in the schema
      const { error: supabaseError } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .update({
          status: 'pending',
          updated_at: now,
        })
        .eq('id', farmstandId)
        .execute();

      if (supabaseError) {
        console.error('[AdminStore] Supabase request info error:', supabaseError);
        return { success: false, error: supabaseError.message };
      }

      console.log('[AdminStore] Supabase request info success');
    }

    // Update local state
    const farmstands = get().allFarmstands.map(f =>
      f.id === farmstandId ? { ...f, ...localUpdates, updatedAt: now } : f
    );

    set({ allFarmstands: farmstands });

    return { success: true };
  },
}));
