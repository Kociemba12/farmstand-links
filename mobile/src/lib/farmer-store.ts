import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Data Models
export type FarmstandStatus = 'draft' | 'pending' | 'active' | 'hidden' | 'denied';
export type ClaimStatus = 'unclaimed' | 'pending' | 'claimed';
export type OperationalStatus = 'active' | 'temporarily_closed' | 'seasonal' | 'permanently_closed';
export type OperatingStatus = 'open' | 'temporarily_closed' | 'seasonal' | 'permanently_closed';
export type GoldVerifiedSource = 'auto' | 'admin' | 'none';
export type OwnershipDisputeStatus = 'none' | 'open' | 'resolved';

// NEW: Verification status for guest-submitted farmstands
export type VerificationStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | 'NEEDS_INFO';
export type VisibilityStatus = 'PUBLIC' | 'HIDDEN';

export interface HoursDay {
  open: string | null; // "HH:MM" or null when closed
  close: string | null; // "HH:MM" or null when closed
  closed: boolean;
}

export interface HoursException {
  date: string; // "YYYY-MM-DD"
  closed: boolean;
  open?: string;
  close?: string;
}

export interface HoursSchedule {
  timezone: string;
  mon: HoursDay;
  tue: HoursDay;
  wed: HoursDay;
  thu: HoursDay;
  fri: HoursDay;
  sat: HoursDay;
  sun: HoursDay;
  exceptions?: HoursException[];
}

export interface SeasonalDates {
  start_month: number; // 1-12
  start_day: number;
  end_month: number;
  end_day: number;
}

// Promotion status type
export type PromoStatus = 'active' | 'scheduled' | 'expired' | 'none';

// Premium status type
export type PremiumStatus = 'free' | 'trial' | 'active' | 'expired';

// Promotion placement options
export interface PromoPlacement {
  exploreTop10: boolean;
  mapTop10: boolean;
}

export interface Farmstand {
  id: string;
  ownerUserId: string;
  name: string;
  shortDescription: string;
  description: string;
  categories: string[];
  photos: string[];
  mainPhotoIndex: number;
  phone: string | null;
  email: string | null;
  socialLinks: { platform: string; url: string }[];
  isActive: boolean;
  status: FarmstandStatus;
  operationalStatus: OperationalStatus;
  operatingStatus: OperatingStatus;
  showOnMap: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  fullAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  hours: HoursSchedule | null;
  isOpen24_7: boolean; // If true, farmstand is open 24/7 - ignore hours schedule
  seasonalNotes: string | null;
  seasonalDates: SeasonalDates | null;
  offerings: string[];
  otherProducts?: string[]; // Individual "other products" entered by submitter
  paymentOptions: string[];
  // New owner-editable fields
  honorSystem: boolean;
  selfServe: boolean;
  directionsNotes: string | null;
  parkingNotes: string | null;
  todaysNote: string | null;
  // Admin-only fields
  adminNotes: string | null;
  updatedAt: string;
  createdAt: string;
  // Claim-related fields
  claimStatus: ClaimStatus;
  verificationCode: string | null;
  claimedAt: string | null;
  // Gold verification fields
  goldVerified: boolean;
  goldVerifiedSource: GoldVerifiedSource;
  ownershipDisputeStatus: OwnershipDisputeStatus;
  lastActivityAt: string | null;
  // Review aggregation fields
  reviewCount: number;
  avgRating: number;
  // Raw Supabase snake_case sort fields — used directly in sort logic
  // These mirror the actual DB column names to avoid mapping mismatches
  avg_rating?: number;
  review_count?: number;
  view_count?: number;
  saved_count?: number;
  updated_at?: string | null;
  last_activity_at?: string | null;
  // NEW: Verification fields for guest submissions
  verificationStatus: VerificationStatus;
  visibilityStatus: VisibilityStatus;
  createdByUserId: string | null; // Who submitted it (may differ from owner)
  claimedByUserId: string | null; // Owner once claimed/approved
  verifiedByAdminId: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  submissionAdminNotes: string | null;
  lastReviewedAt: string | null;
  // NEW: Promotion fields
  promoActive: boolean;
  promoExploreCategories: string[]; // Category names/IDs to appear in
  promoMapBoost: boolean;
  promoPriority: number; // 0-100, higher = shows more often
  promoStartAt: string | null; // ISO datetime
  promoEndAt: string | null; // ISO datetime
  promoRotationWeight: number; // 1-10, higher = appears more in rotation
  promoStatus: PromoStatus;
  // NEW: Popularity tracking fields (for auto-featured)
  clicks30d: number;
  saves30d: number;
  messages30d: number;
  popularityScore: number; // Calculated score
  // NEW: Monetization hook (future)
  isPaidPromotion: boolean;
  promotionTier: 'standard' | 'premium' | 'none';
  // NEW: Premium trial fields
  premiumStatus: PremiumStatus;
  premiumTrialStartedAt: string | null;
  premiumTrialExpiresAt: string | null;
  // NEW: Seeded listing fields (for admin-imported farmstands)
  seededListing: boolean;
  importSource: 'manual_admin_seed' | 'csv_import' | 'user_submission' | null;
  confidenceLevel: 'low' | 'medium' | 'high';
  approvalStatus: 'pending' | 'approved' | 'rejected';
  visibility: 'public' | 'admin_only' | 'hidden';
  claimingDisabled: boolean;
  reviewsEnabled: boolean;
  messagingEnabled: boolean;
  showStatusBanner: boolean;
  statusBannerText: string | null;
  statusBannerType: 'neutral' | 'warning' | 'success' | 'info';
  createdByRole: 'system' | 'admin' | 'farmer' | 'guest';
  // NEW: Location mode fields
  locationMode: 'exact_address' | 'cross_streets' | 'use_my_location';
  areaType: 'cross_streets' | 'generic_area' | null;
  crossStreet1: string | null;
  crossStreet2: string | null;
  genericAreaText: string | null;
  nearestCityState: string | null;
  pinSource: 'geocode_exact' | 'geocode_approx' | 'device_gps' | 'manual_map_tap' | null;
  // NEW: Approximate location fields
  useApproximateLocation: boolean;
  approxLocationText: string | null; // e.g., "Jacksonville Hill & Cady Rd"
  optionalNearestCityState: string | null; // e.g., "Jacksonville, OR"
  locationPrecision: 'exact' | 'approximate' | 'approximate_manual';
  geocodeProvider: 'expo' | 'google' | 'mapbox' | 'nominatim' | null;
  geocodeConfidence: number | null; // 0-1 confidence score
  pinAdjustedByUser: boolean;
  adminReviewReason: string | null; // e.g., "approx_location"
  // Hero image fields - stored permanently per farmstand
  heroPhotoUrl: string | null; // User-uploaded hero photo (takes priority)
  aiPhotoUrl: string | null; // AI-generated category-based photo URL (fallback when no hero_photo_url)
  heroImageUrl: string | null; // Legacy AI-generated fallback hero image URL
  heroImageTheme: string | null; // e.g., "eggs", "produce", "flowers"
  heroImageSeed: number | null; // Random seed for variety (0-999999)
  heroImageGeneratedAt: string | null; // ISO timestamp when image was generated
  // NEW: Main product selection for AI image generation
  mainProduct: string | null; // e.g., "eggs", "honey", "flowers" - determines AI image category
  aiImageUrl: string | null; // AI-generated image URL based on main_product
  aiImageSeed: string | null; // Deterministic seed: "{id}:{main_product}"
  aiImageUpdatedAt: string | null; // ISO timestamp when AI image was last generated
  // Legacy photo columns still used by some card components
  photoUrl?: string | null; // Legacy photo_url column
  imageUrl?: string | null; // Legacy image_url column
  // NEW: Smart card image fields
  primaryImageMode: 'uploaded' | 'ai_fallback'; // Whether using uploaded photo or AI fallback
  fallbackImageKey: string | null; // Key for AI fallback image (e.g., "eggs_fresh_carton_closeup")
  // Soft delete field
  deletedAt: string | null; // ISO timestamp when farmstand was soft-deleted
  // URL slug for share links
  slug: string | null;
  // Seasonal Stands: only farmstands with is_seasonal === true appear in "Seasonal Stands" explore section
  isSeasonal: boolean;
  // Internal contact fields (admin-only, never shown publicly)
  internalContactPhone?: string | null;
  internalContactEmail?: string | null;
  // Video fields (premium feature — 1 video per farmstand)
  videoUrl: string | null;
  videoPath: string | null;
  videoDurationSeconds: number | null;
}

export interface Product {
  id: string;
  farmstandId: string;
  name: string;
  description: string;
  category: string;
  price: number;
  unit: string;
  inStock: boolean;
  photos: string[];
  updatedAt: string;
}

export interface FarmerReview {
  id: string;
  farmstandId: string;
  reviewerName: string;
  reviewerInitials: string;
  rating: number;
  comment: string;
  createdAt: string;
  replyText?: string | null;
  repliedAt?: string | null;
  flagged?: boolean;
}

export interface ViewEvent {
  id: string;
  farmstandId: string;
  createdAt: string;
  source: string;
}

export interface DashboardSummary {
  farmerName: string;
  farmstandId: string;
  totalViews: number;
  viewsDeltaPercent: number;
  averageRating: number;
  reviewCount: number;
  performanceLabel: string;
  performanceScore: number;
  recentReviews: FarmerReview[];
  tipOfDay: { title: string; body: string; actionRoute?: string } | null;
}

// Default hours schedule
const DEFAULT_HOURS: HoursSchedule = {
  timezone: 'America/Los_Angeles',
  mon: { open: '09:00', close: '17:00', closed: false },
  tue: { open: '09:00', close: '17:00', closed: false },
  wed: { open: '09:00', close: '17:00', closed: false },
  thu: { open: '09:00', close: '17:00', closed: false },
  fri: { open: '09:00', close: '17:00', closed: false },
  sat: { open: '09:00', close: '17:00', closed: false },
  sun: { open: '09:00', close: '17:00', closed: true },
};

// Mock data for demo
const MOCK_FARMSTAND: Farmstand = {
  id: 'farm-demo-1',
  ownerUserId: '1',
  name: "John's Fresh Farm",
  shortDescription: 'Fresh organic produce from our family farm',
  description:
    'Welcome to our family-operated farm stand! We grow a variety of organic fruits, vegetables, and herbs using sustainable farming practices. Our farm has been in the family for three generations.',
  categories: ['produce', 'eggs', 'baked_goods'],
  photos: [
    'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=800',
    'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=800',
  ],
  mainPhotoIndex: 0,
  phone: '(503) 555-1234',
  email: 'john@freshfarm.com',
  socialLinks: [],
  isActive: true,
  status: 'active',
  operationalStatus: 'active',
  operatingStatus: 'open',
  showOnMap: true,
  addressLine1: '1234 Farm Road',
  addressLine2: null,
  city: 'Portland',
  state: 'OR',
  zip: '97201',
  fullAddress: '1234 Farm Road, Portland, OR 97201',
  latitude: 45.5152,
  longitude: -122.6784,
  hours: DEFAULT_HOURS,
  isOpen24_7: false,
  seasonalNotes: null,
  seasonalDates: null,
  offerings: ['Eggs', 'Produce', 'Baked Goods'],
  paymentOptions: ['cash', 'card'],
  honorSystem: false,
  selfServe: false,
  directionsNotes: null,
  parkingNotes: null,
  todaysNote: null,
  adminNotes: null,
  updatedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  claimStatus: 'claimed',
  verificationCode: null,
  claimedAt: new Date().toISOString(),
  goldVerified: false,
  goldVerifiedSource: 'none',
  ownershipDisputeStatus: 'none',
  lastActivityAt: new Date().toISOString(),
  reviewCount: 0,
  avgRating: 0,
  // Verification fields
  verificationStatus: 'VERIFIED',
  visibilityStatus: 'PUBLIC',
  createdByUserId: '1',
  claimedByUserId: '1',
  verifiedByAdminId: null,
  verifiedAt: null,
  rejectionReason: null,
  submissionAdminNotes: null,
  lastReviewedAt: null,
  // Promotion fields
  promoActive: false,
  promoExploreCategories: [],
  promoMapBoost: false,
  promoPriority: 50,
  promoStartAt: null,
  promoEndAt: null,
  promoRotationWeight: 1,
  promoStatus: 'none',
  // Popularity tracking fields
  clicks30d: 0,
  saves30d: 0,
  messages30d: 0,
  popularityScore: 0,
  // Monetization hook
  isPaidPromotion: false,
  promotionTier: 'none',
  // Seeded listing fields
  seededListing: false,
  importSource: null,
  confidenceLevel: 'high',
  approvalStatus: 'approved',
  visibility: 'public',
  claimingDisabled: false,
  reviewsEnabled: true,
  messagingEnabled: true,
  showStatusBanner: false,
  statusBannerText: null,
  statusBannerType: 'neutral',
  createdByRole: 'farmer',
  // Location mode fields
  locationMode: 'exact_address',
  areaType: null,
  crossStreet1: null,
  crossStreet2: null,
  genericAreaText: null,
  nearestCityState: null,
  pinSource: null,
  // Approximate location fields
  useApproximateLocation: false,
  approxLocationText: null,
  optionalNearestCityState: null,
  locationPrecision: 'exact',
  geocodeProvider: null,
  geocodeConfidence: null,
  pinAdjustedByUser: false,
  adminReviewReason: null,
  // Hero image fields
  heroPhotoUrl: null,
  aiPhotoUrl: null,
  heroImageUrl: null,
  heroImageTheme: null,
  heroImageSeed: null,
  heroImageGeneratedAt: null,
  // Main product AI image fields
  mainProduct: null,
  aiImageUrl: null,
  aiImageSeed: null,
  aiImageUpdatedAt: null,
  // Smart card image fields
  primaryImageMode: 'ai_fallback',
  fallbackImageKey: null,
  // Soft delete field
  deletedAt: null,
  slug: null,
  // Premium fields
  premiumStatus: 'free',
  premiumTrialStartedAt: null,
  premiumTrialExpiresAt: null,
  isSeasonal: false,
  videoUrl: null,
  videoPath: null,
  videoDurationSeconds: null,
};

const MOCK_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    farmstandId: 'farm-demo-1',
    name: 'Organic Strawberries',
    description: 'Sweet, juicy strawberries picked fresh daily',
    category: 'produce',
    price: 6.99,
    unit: 'lb',
    inStock: true,
    photos: ['https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=800'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-2',
    farmstandId: 'farm-demo-1',
    name: 'Farm Fresh Eggs',
    description: 'Free-range eggs from our happy hens',
    category: 'eggs',
    price: 7.5,
    unit: 'dozen',
    inStock: true,
    photos: ['https://images.unsplash.com/photo-1518569656558-1f25e69d93d7?w=800'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-3',
    farmstandId: 'farm-demo-1',
    name: 'Sourdough Bread',
    description: 'Artisan sourdough baked fresh each morning',
    category: 'baked_goods',
    price: 8.0,
    unit: 'each',
    inStock: true,
    photos: ['https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-4',
    farmstandId: 'farm-demo-1',
    name: 'Organic Tomatoes',
    description: 'Heirloom tomatoes, vine-ripened',
    category: 'produce',
    price: 4.99,
    unit: 'lb',
    inStock: false,
    photos: ['https://images.unsplash.com/photo-1592921870789-04563d55041c?w=800'],
    updatedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const MOCK_REVIEWS: FarmerReview[] = [];

// Generate mock view events
const generateMockViewEvents = (farmstandId: string): ViewEvent[] => {
  const events: ViewEvent[] = [];
  const sources = ['map', 'search', 'favorite', 'share'];
  const now = Date.now();

  // Generate 60 days of view events
  for (let i = 0; i < 60; i++) {
    const dayOffset = i * 24 * 60 * 60 * 1000;
    const viewsPerDay = Math.floor(Math.random() * 30) + 10 + (i < 30 ? 5 : 0); // More views in recent 30 days

    for (let j = 0; j < viewsPerDay; j++) {
      events.push({
        id: `view-${i}-${j}`,
        farmstandId,
        createdAt: new Date(now - dayOffset - Math.random() * 24 * 60 * 60 * 1000).toISOString(),
        source: sources[Math.floor(Math.random() * sources.length)],
      });
    }
  }

  return events;
};

interface FarmerState {
  farmstands: Farmstand[];
  products: Product[];
  reviews: FarmerReview[];
  viewEvents: ViewEvent[];
  selectedFarmstandId: string | null;
  isLoading: boolean;

  // Actions
  loadFarmerData: (userId: string) => Promise<void>;
  getFarmstandById: (id: string) => Farmstand | undefined;
  getDashboardSummary: (farmstandId: string) => DashboardSummary | null;
  getProductsByFarmstand: (farmstandId: string) => Product[];
  getReviewsByFarmstand: (farmstandId: string) => FarmerReview[];
  getViewEventsByFarmstand: (farmstandId: string) => ViewEvent[];

  // Mutations
  updateFarmstand: (farmstandId: string, updates: Partial<Farmstand>) => Promise<void>;
  createFarmstand: (farmstand: Omit<Farmstand, 'id' | 'updatedAt'>) => Promise<string>;
  addProduct: (product: Omit<Product, 'id' | 'updatedAt'>) => Promise<void>;
  updateProduct: (productId: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  replyToReview: (reviewId: string, replyText: string) => Promise<void>;
  flagReview: (reviewId: string) => Promise<void>;
  setSelectedFarmstand: (farmstandId: string) => Promise<void>;
}

export const useFarmerStore = create<FarmerState>((set, get) => ({
  farmstands: [],
  products: [],
  reviews: [],
  viewEvents: [],
  selectedFarmstandId: null,
  isLoading: false,

  loadFarmerData: async (userId: string) => {
    set({ isLoading: true });

    try {
      // Try to load from AsyncStorage first
      const storedFarmstands = await AsyncStorage.getItem('farmer_farmstands');
      const storedProducts = await AsyncStorage.getItem('farmer_products');
      const storedReviews = await AsyncStorage.getItem('farmer_reviews');
      const storedSelectedId = await AsyncStorage.getItem('farmer_selected_id');

      if (storedFarmstands) {
        const farmstands = JSON.parse(storedFarmstands) as Farmstand[];
        const userFarmstands = farmstands.filter((f) => f.ownerUserId === userId);

        if (userFarmstands.length > 0) {
          set({
            farmstands: userFarmstands,
            products: storedProducts ? JSON.parse(storedProducts) : [],
            reviews: storedReviews ? JSON.parse(storedReviews) : MOCK_REVIEWS,
            viewEvents: generateMockViewEvents(userFarmstands[0].id),
            selectedFarmstandId: storedSelectedId || userFarmstands[0].id,
            isLoading: false,
          });
          return;
        }
      }

      // For demo, set up mock data if user is a farmer
      const mockFarmstand = { ...MOCK_FARMSTAND, ownerUserId: userId };
      await AsyncStorage.setItem('farmer_farmstands', JSON.stringify([mockFarmstand]));
      await AsyncStorage.setItem('farmer_products', JSON.stringify(MOCK_PRODUCTS));
      await AsyncStorage.setItem('farmer_reviews', JSON.stringify(MOCK_REVIEWS));
      await AsyncStorage.setItem('farmer_selected_id', mockFarmstand.id);

      set({
        farmstands: [mockFarmstand],
        products: MOCK_PRODUCTS,
        reviews: MOCK_REVIEWS,
        viewEvents: generateMockViewEvents(mockFarmstand.id),
        selectedFarmstandId: mockFarmstand.id,
        isLoading: false,
      });
    } catch (error) {
      console.error('Error loading farmer data:', error);
      set({ isLoading: false });
    }
  },

  getFarmstandById: (id: string) => {
    return get().farmstands.find((f) => f.id === id);
  },

  getDashboardSummary: (farmstandId: string) => {
    const state = get();
    const farmstand = state.farmstands.find((f) => f.id === farmstandId);
    if (!farmstand) return null;

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;

    // Calculate views
    const farmViews = state.viewEvents.filter((v) => v.farmstandId === farmstandId);
    const viewsLast30 = farmViews.filter(
      (v) => new Date(v.createdAt).getTime() > thirtyDaysAgo
    ).length;
    const viewsPrev30 = farmViews.filter(
      (v) =>
        new Date(v.createdAt).getTime() > sixtyDaysAgo &&
        new Date(v.createdAt).getTime() <= thirtyDaysAgo
    ).length;
    const viewsDeltaPercent = Math.round(
      ((viewsLast30 - viewsPrev30) / Math.max(viewsPrev30, 1)) * 100
    );

    // Calculate reviews
    const farmReviews = state.reviews.filter(
      (r) => r.farmstandId === farmstandId && !r.flagged
    );
    const reviewCount = farmReviews.length;
    const averageRating =
      reviewCount > 0
        ? Math.round(
            (farmReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10
          ) / 10
        : 0;
    const recentReviews = [...farmReviews]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 3);

    // Calculate performance score
    let performanceScore = 100;
    const missingItems: string[] = [];

    if (!farmstand.photos || farmstand.photos.length === 0) {
      performanceScore -= 25;
      missingItems.push('photos');
    }
    if (!farmstand.description) {
      performanceScore -= 15;
      missingItems.push('description');
    }
    if (!farmstand.hours) {
      performanceScore -= 15;
      missingItems.push('hours');
    }
    if (!farmstand.latitude || !farmstand.longitude) {
      performanceScore -= 20;
      missingItems.push('location');
    }

    const farmProducts = state.products.filter((p) => p.farmstandId === farmstandId);
    const hasRecentProducts = farmProducts.some(
      (p) => new Date(p.updatedAt).getTime() > thirtyDaysAgo
    );
    if (farmProducts.length === 0 || !hasRecentProducts) {
      performanceScore -= 15;
      missingItems.push('products');
    }

    performanceScore = Math.max(0, Math.min(100, performanceScore));
    const performanceLabel =
      performanceScore >= 85 ? 'Great' : performanceScore >= 70 ? 'Good' : 'Needs Attention';

    // Generate tip of the day
    let tipOfDay: DashboardSummary['tipOfDay'] = null;
    if (missingItems.includes('photos')) {
      tipOfDay = {
        title: 'Add Photos',
        body: 'Listings with photos get 3x more views! Add photos of your fresh produce.',
        actionRoute: `/owner/edit?id=${farmstandId}`,
      };
    } else if (missingItems.includes('hours')) {
      tipOfDay = {
        title: 'Set Your Hours',
        body: 'Let customers know when you\'re open so they can plan their visit.',
        actionRoute: `/owner/hours?id=${farmstandId}`,
      };
    } else if (missingItems.includes('products')) {
      tipOfDay = {
        title: 'Update Your Products',
        body: 'Keep your product list fresh to show customers what\'s in season.',
        actionRoute: `/owner/products?id=${farmstandId}`,
      };
    } else if (missingItems.includes('location')) {
      tipOfDay = {
        title: 'Pin Your Location',
        body: 'Help customers find you by adding your exact location on the map.',
        actionRoute: `/owner/location?id=${farmstandId}`,
      };
    } else {
      tipOfDay = {
        title: 'Engage With Customers',
        body: 'Respond to reviews to build relationships and encourage repeat visits.',
        actionRoute: `/farmer/reviews?farmstandId=${farmstandId}`,
      };
    }

    return {
      farmerName: farmstand.name,
      farmstandId,
      totalViews: viewsLast30,
      viewsDeltaPercent,
      averageRating,
      reviewCount,
      performanceLabel,
      performanceScore,
      recentReviews,
      tipOfDay,
    };
  },

  getProductsByFarmstand: (farmstandId: string) => {
    return get().products.filter((p) => p.farmstandId === farmstandId);
  },

  getReviewsByFarmstand: (farmstandId: string) => {
    return get().reviews.filter((r) => r.farmstandId === farmstandId);
  },

  getViewEventsByFarmstand: (farmstandId: string) => {
    return get().viewEvents.filter((v) => v.farmstandId === farmstandId);
  },

  updateFarmstand: async (farmstandId: string, updates: Partial<Farmstand>) => {
    const state = get();
    const updatedFarmstands = state.farmstands.map((f) =>
      f.id === farmstandId ? { ...f, ...updates, updatedAt: new Date().toISOString() } : f
    );

    await AsyncStorage.setItem('farmer_farmstands', JSON.stringify(updatedFarmstands));
    set({ farmstands: updatedFarmstands });
  },

  createFarmstand: async (farmstand: Omit<Farmstand, 'id' | 'updatedAt'>) => {
    const newId = `farm-${Date.now()}`;
    const newFarmstand: Farmstand = {
      ...farmstand,
      id: newId,
      updatedAt: new Date().toISOString(),
    };

    const state = get();
    const updatedFarmstands = [...state.farmstands, newFarmstand];

    await AsyncStorage.setItem('farmer_farmstands', JSON.stringify(updatedFarmstands));
    await AsyncStorage.setItem('farmer_selected_id', newId);
    set({ farmstands: updatedFarmstands, selectedFarmstandId: newId });

    return newId;
  },

  addProduct: async (product: Omit<Product, 'id' | 'updatedAt'>) => {
    const newProduct: Product = {
      ...product,
      id: `prod-${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };

    const state = get();
    const updatedProducts = [...state.products, newProduct];

    await AsyncStorage.setItem('farmer_products', JSON.stringify(updatedProducts));
    set({ products: updatedProducts });
  },

  updateProduct: async (productId: string, updates: Partial<Product>) => {
    const state = get();
    const updatedProducts = state.products.map((p) =>
      p.id === productId ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
    );

    await AsyncStorage.setItem('farmer_products', JSON.stringify(updatedProducts));
    set({ products: updatedProducts });
  },

  deleteProduct: async (productId: string) => {
    const state = get();
    const updatedProducts = state.products.filter((p) => p.id !== productId);

    await AsyncStorage.setItem('farmer_products', JSON.stringify(updatedProducts));
    set({ products: updatedProducts });
  },

  replyToReview: async (reviewId: string, replyText: string) => {
    const state = get();
    const updatedReviews = state.reviews.map((r) =>
      r.id === reviewId
        ? { ...r, replyText, repliedAt: new Date().toISOString() }
        : r
    );

    await AsyncStorage.setItem('farmer_reviews', JSON.stringify(updatedReviews));
    set({ reviews: updatedReviews });
  },

  flagReview: async (reviewId: string) => {
    const state = get();
    const updatedReviews = state.reviews.map((r) =>
      r.id === reviewId ? { ...r, flagged: true } : r
    );

    await AsyncStorage.setItem('farmer_reviews', JSON.stringify(updatedReviews));
    set({ reviews: updatedReviews });
  },

  setSelectedFarmstand: async (farmstandId: string) => {
    await AsyncStorage.setItem('farmer_selected_id', farmstandId);
    set({ selectedFarmstandId: farmstandId });
  },
}));
