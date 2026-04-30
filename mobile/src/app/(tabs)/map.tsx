import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { View, Text, Pressable, Dimensions, TextInput, Alert, StyleSheet, FlatList, ActivityIndicator, Keyboard, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Region } from 'react-native-maps';
import { Search, X, Heart, Navigation, Clock, SlidersHorizontal, Navigation2, Compass, Plus, MapPin } from 'lucide-react-native';
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { FarmStand } from '@/lib/farm-data';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { useLocationStore } from '@/lib/location-store';
import { HoursSchedule, Farmstand } from '@/lib/farmer-store';
import { useFavoritesStore } from '@/lib/favorites-store';
import { useProductsStore } from '@/lib/products-store';
import { usePromotionsStore } from '@/lib/promotions-store';
import { useSearchStore, isLocationQuery, detectCategoryFromQuery } from '@/lib/search-store';
import { getFarmstandDisplayImage } from '@/lib/farmstand-image';

const fallbackHero = require('../../assets/images/farmstand-final-fallback.png') as number;

function MapFarmCardImage({ imageUri, style }: { imageUri?: string | null; style: object }) {
  const [imgSource, setImgSource] = useState<{ uri: string } | number>(
    imageUri ? { uri: imageUri } : fallbackHero
  );
  return (
    <Image
      source={imgSource}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={imageUri || 'fallback'}
      transition={250}
      onError={() => setImgSource(fallbackHero)}
    />
  );
}

import { farmstandMatchesCategory, CATEGORY_LABELS } from '@/lib/category-filter';
import { SignInPromptModal } from '@/components/SignInPromptModal';
import { MapFilterModal } from '@/components/MapFilterModal';
import { AddFarmstandBanner, shouldShowAddFarmstandBanner } from '@/components/AddFarmstandBanner';
import { GoldVerifiedRibbon } from '@/components/GoldVerifiedRibbon';
import { PremiumBadge, isPremiumFarmstand } from '@/components/PremiumBadge';
import { logMapOpen } from '@/lib/analytics-events';
import { trackEvent } from '@/lib/track';
import { useMapFiltersStore, SortMode, MAX_FILTER_RADIUS } from '@/lib/map-filters-store';
import { useReviewsStore } from '@/lib/reviews-store';
import { supabase } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// Calculate distance between two coordinates in miles (Haversine formula)
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Relevance sort helper — promotion-weighted daily rotation ───────────────
// Extracted so both sortedViewportFarms and mapResults use identical logic.
// Boosted farms (promoMapBoost + promoActive) appear first, ranked by a
// seeded-random selection score so order rotates daily but stays stable
// within a session. Non-boosted farms follow, ranked by popularityScore then
// distance to the map center.
function getRelevanceSortedFarms(
  farms: ExtendedFarmStand[],
  centerLat: number,
  centerLng: number
): ExtendedFarmStand[] {
  const today = new Date().toISOString().split('T')[0];
  const seedString = `${today}-map_boost`;
  let seed = 0;
  for (let i = 0; i < seedString.length; i++) {
    seed = ((seed << 5) - seed) + seedString.charCodeAt(i);
    seed = seed & seed;
  }
  seed = Math.abs(seed);

  const seededRandom = (s: number): number => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };

  const boostedFarms = farms.filter(f => f.promoMapBoost && f.promoActive);
  const nonBoostedFarms = farms.filter(f => !(f.promoMapBoost && f.promoActive));

  const sortedBoosted = [...boostedFarms]
    .map(farm => {
      let farmSeed = seed;
      for (let i = 0; i < farm.id.length; i++) {
        farmSeed += farm.id.charCodeAt(i) * (i + 1);
      }
      const randomFactor = seededRandom(farmSeed);
      const priority = farm.promoPriority ?? 50;
      const weight = farm.promoRotationWeight ?? 1;
      const selectionScore = (priority * 100) + (weight * randomFactor * 250);
      return { farm, selectionScore, priority };
    })
    .sort((a, b) => {
      if (Math.abs(b.selectionScore - a.selectionScore) > 0.001) return b.selectionScore - a.selectionScore;
      return a.farm.id.localeCompare(b.farm.id);
    })
    .sort((a, b) => b.priority - a.priority)
    .map(item => item.farm);

  const sortedNonBoosted = [...nonBoostedFarms].sort((a, b) => {
    const popularityDiff = (b.popularityScore || 0) - (a.popularityScore || 0);
    if (popularityDiff !== 0) return popularityDiff;
    const distA = calculateDistance(centerLat, centerLng, a.latitude, a.longitude);
    const distB = calculateDistance(centerLat, centerLng, b.latitude, b.longitude);
    return distA - distB;
  });

  return [...sortedBoosted, ...sortedNonBoosted];
}

// ── Sort debug helper — logs first 10 results using REAL Supabase column names ──
function debugSort(sortMode: string, farms: ExtendedFarmStand[]): void {
  console.log('SORT DEBUG', sortMode, farms.slice(0, 10).map(f => ({
    name: f.name,
    avg_rating: f.avg_rating,
    review_count: f.review_count,
    view_count: f.view_count,
    saved_count: f.saved_count,
    updated_at: f.updated_at,
    last_activity_at: f.last_activity_at,
  })));
}

// Big card dimensions for vertical scroll — capped at 700px for large iPads
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 700);
const IMAGE_HEIGHT = CARD_WIDTH;
const CARD_HEIGHT = IMAGE_HEIGHT + 100; // Image + content section
const CARD_SPACING = 16;

// Single card dimensions (slightly larger for featured display) — capped for large iPads
const SINGLE_CARD_WIDTH = Math.min(SCREEN_WIDTH - 24, 700);
const SINGLE_CARD_IMAGE_HEIGHT = SINGLE_CARD_WIDTH * 0.75; // 3:4 aspect ratio for single card
const SINGLE_CARD_HEIGHT = SINGLE_CARD_IMAGE_HEIGHT + 110;

// Tab bar height (from _layout.tsx)
const TAB_BAR_HEIGHT = 88;

// Bottom sheet collapsed height - FIXED, never changes
const COLLAPSED_HEIGHT = 72; // Just handle + header row

// Handle area height (handle bar + count text + padding)
const HANDLE_AREA_HEIGHT = 72;

// Oregon center coordinates
const OREGON_REGION: Region = {
  latitude: 44.0,
  longitude: -120.5,
  latitudeDelta: 6,
  longitudeDelta: 6,
};

// Helper to check if a farm is within the viewport bounds
const isFarmInViewport = (farm: FarmStand, region: Region): boolean => {
  const latMin = region.latitude - region.latitudeDelta / 2;
  const latMax = region.latitude + region.latitudeDelta / 2;
  const lngMin = region.longitude - region.longitudeDelta / 2;
  const lngMax = region.longitude + region.longitudeDelta / 2;

  return (
    farm.latitude >= latMin &&
    farm.latitude <= latMax &&
    farm.longitude >= lngMin &&
    farm.longitude <= lngMax
  );
};

// Extended FarmStand type with hours data and promotion fields
interface ExtendedFarmStand extends FarmStand {
  hoursData?: HoursSchedule | null;
  promoMapBoost?: boolean;
  promoActive?: boolean;
  promoPriority?: number;
  promoRotationWeight?: number;
  popularityScore?: number;
  locationPrecision?: 'exact' | 'approximate' | 'approximate_manual';
  isPending?: boolean;
  goldVerified?: boolean;
  mainProduct?: string | null;
  premiumStatus?: 'free' | 'trial' | 'active' | 'expired' | null;
  // Filter-relevant camelCase aliases (kept for backward-compat)
  avgRating?: number;
  saves30d?: number;
  clicks30d?: number;
  updatedAt?: string | null;
  lastActivityAt?: string | null;
  isOpen24_7?: boolean;
  // Real Supabase column names — used for sort logic
  avg_rating?: number;
  review_count?: number;
  view_count?: number;
  saved_count?: number;
  updated_at?: string | null;
  last_activity_at?: string | null;
  createdAt?: string | null;  // DB created_at — always different per farmstand, used as tiebreaker
}

// Helper to get hours status text
const getHoursStatus = (hours: HoursSchedule | null | undefined, isOpen: boolean): { text: string; isOpenNow: boolean } => {
  if (!hours) {
    // No structured hours data — treat as closed for "Open Now" filter purposes
    return { text: isOpen ? 'Hours vary' : 'Closed', isOpenNow: false };
  }

  const now = new Date();
  const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()] as keyof Omit<HoursSchedule, 'timezone' | 'exceptions'>;
  const todayHours = hours[dayOfWeek];

  if (!todayHours || todayHours.closed || !todayHours.open || !todayHours.close) {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
    for (let i = 1; i <= 7; i++) {
      const nextDayIndex = (now.getDay() + i) % 7;
      const nextDay = days[nextDayIndex] as keyof Omit<HoursSchedule, 'timezone' | 'exceptions'>;
      const nextDayHours = hours[nextDay];
      if (!nextDayHours.closed && nextDayHours.open) {
        const dayName = i === 1 ? 'Tomorrow' : days[nextDayIndex].charAt(0).toUpperCase() + days[nextDayIndex].slice(1);
        return { text: `Opens ${dayName}`, isOpenNow: false };
      }
    }
    return { text: 'Closed', isOpenNow: false };
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openHour, openMin] = todayHours.open.split(':').map(Number);
  const [closeHour, closeMin] = todayHours.close.split(':').map(Number);
  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;

  const formatTime = (time: string): string => {
    const [hour, minute] = time.split(':').map(Number);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return minute === 0 ? `${displayHour} ${period}` : `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  };

  if (currentMinutes < openMinutes) {
    return { text: `Opens ${formatTime(todayHours.open)}`, isOpenNow: false };
  } else if (currentMinutes < closeMinutes) {
    return { text: `Open until ${formatTime(todayHours.close)}`, isOpenNow: true };
  } else {
    return { text: 'Closed', isOpenNow: false };
  }
};

// Bottom sheet state enum - TWO STATES ONLY
type SheetState = 'collapsed' | 'expanded';

export default function MapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    search?: string;
    searchType?: string;
    mapFilterType?: string;
    mapFilterProductTag?: string;
    targetLat?: string;
    targetLng?: string;
    matchedFarmstandId?: string;
    matchedFarmstandIds?: string; // Comma-separated list of matching farmstand IDs
    // "View on Map" from Manage Listings
    viewOnMapFarmstandId?: string;
    viewOnMapLat?: string;
    viewOnMapLng?: string;
    viewOnMapName?: string;
    // Unique nonce stamped on every Explore→Map navigation so the Map always
    // re-processes the filter even when the search term is identical to a cleared search
    searchNonce?: string;
    // Generic collection from Explore "Show all" — Top Spots, New This Week, Most Saved, Open Now, etc.
    collectionIds?: string;
    collectionLabel?: string;
    collectionNonce?: string;
    // Radius restriction passed from Explore sections that use a local radius (e.g. Egg Stands Near You)
    navRadiusMiles?: string;
    // Open Now filter from Explore "Show all" — activates panel filter, NOT a fixed collection
    navOpenNow?: string;
    openNowNonce?: string;
  }>();
  const mapRef = useRef<MapView>(null);
  const flatListRef = useRef<FlatList<ExtendedFarmStand>>(null);
  // Separate draft text (what user types) from active query (what we filter on)
  // Category navigations never carry a text query — only the chip is shown.
  const isCategoryNav = !!(params.mapFilterType && params.mapFilterProductTag);
  const [searchDraftText, setSearchDraftText] = useState(isCategoryNav ? '' : (params.search ?? ''));
  const [activeSearchQuery, setActiveSearchQuery] = useState(isCategoryNav ? '' : (params.search ?? ''));
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  // Separate "pinned detail" state — only changes on explicit user action (marker tap / X button)
  // This breaks the cascade: selectedFarmId → selectedFarmstand → EXPANDED_HEIGHT → snapToState → search zoom effect
  const [pinnedFarmstand, setPinnedFarmstand] = useState<ExtendedFarmStand | null>(null);
  // Mirror as ref so effects can guard without adding pinnedFarmstand to their deps
  const pinnedFarmstandRef = useRef<ExtendedFarmStand | null>(null);
  // Active collection scope — set when Explore "Show all" passes a curated ID list (e.g. Top Spots).
  // null = normal map; string[] = only these farmstands are shown.
  const [activeCollectionIds, setActiveCollectionIds] = useState<string[] | null>(null);
  const [activeCollectionLabel, setActiveCollectionLabel] = useState<string | null>(null);
  // Ref to prevent the collection zoom effect from re-firing after the initial zoom
  const processedCollectionZoomRef = useRef<string | null>(null);
  // Set to true when navRadiusMiles was applied via Explore navigation.
  // clearPrimaryMapContext resets the radius back to MAX_FILTER_RADIUS only when this is true,
  // so user-set panel radius is not disturbed by unrelated chip X presses.
  const navRadiusMilesSetRef = useRef(false);
  // Set to true when filterOpenNow was activated via Explore "Open Now → Show all".
  // clearPrimaryMapContext resets openNow = false only when this is true, so a user-set
  // Open Now filter from the panel is not cleared by unrelated chip X presses.
  const navOpenNowSetRef = useRef(false);

  const [visibleRegion, setVisibleRegion] = useState<Region>(OREGON_REGION);
  const [_userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [mapHeading, setMapHeading] = useState(0);

  // Search store for debounced Supabase search
  const performSearch = useSearchStore((s) => s.performSearch);
  const isSearching = useSearchStore((s) => s.isSearching);
  const isSearchActive = useSearchStore((s) => s.isSearchActive);
  const searchResults = useSearchStore((s) => s.searchResults);
  const clearSearch = useSearchStore((s) => s.clearSearch);

  // Map filter state from route params (for category navigation from Explore tab)
  const [mapFilter, setMapFilter] = useState<{ type: string; productTag: string } | null>(
    params.mapFilterType && params.mapFilterProductTag
      ? { type: params.mapFilterType, productTag: params.mapFilterProductTag }
      : null
  );

  // Track which params have been processed to avoid rehydrating stale params
  // Key includes searchNonce so identical terms after a clear always re-process
  const processedParamsRef = useRef<string | null>(
    params.mapFilterType && params.mapFilterProductTag
      ? `${params.mapFilterType}-${params.mapFilterProductTag}-${params.searchNonce ?? '0'}`
      : null
  );

  // Track the last text search query applied from Explore navigation
  const processedSearchRef = useRef<string | null>(
    params.search ? `${params.search}-${params.searchNonce ?? '0'}` : null
  );

  // Track if initial search navigation has been handled
  const initialSearchHandledRef = useRef(false);

  // Tracks the searchNonce of Explore-passed params that the user explicitly cleared
  // (via chip X press or by typing a new search). Any useFocusEffect re-run with the
  // same nonce is skipped, preventing the chip from re-applying after the user dismissed it.
  const userClearedNonceRef = useRef<string | null>(null);

  // True whenever the user has performed a local action (typed search, clear) that supersedes
  // the current route params. Prevents searchFilteredFarms from using stale params.matchedFarmstandIds
  // / matchedFarmstandId as PRIORITY 1/2 overrides after the user has moved on.
  // Reset to false only when useFocusEffect successfully applies fresh Explore params.
  const paramsStaleRef = useRef(false);

  // Track which "View on Map" farmstand we have already focused (to avoid re-triggering on focus)
  const processedViewOnMapIdRef = useRef<string | null>(null);

  // Safe area insets for expanded height calculation
  const insets = useSafeAreaInsets();
  const { width: mapScreenWidth } = useWindowDimensions();
  const isTablet = mapScreenWidth >= 768;

  // Maximum expanded height: screen height minus top safe area minus 80px padding
  // This ensures the sheet stops well below the status bar, leaving map visible
  const MAX_EXPANDED_HEIGHT = SCREEN_HEIGHT - insets.top - 80;

  // Shared value for max height (needed for worklet access in useAnimatedStyle)
  // Will be updated dynamically based on content
  const maxExpandedHeight = useSharedValue(MAX_EXPANDED_HEIGHT);

  // Guest prompt modal state
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);

  // Map type toggle state
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');

  // Filter modal state
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Map filters store — sortBy is local state to guarantee immediate re-render
  const [filterSortBy, setFilterSortBy] = useState<SortMode>('relevance');
  const handleSortChange = (mode: SortMode) => {
    console.log('SORT PRESSED:', mode);
    setFilterSortBy(mode);
    trackEvent('map_sort_changed', { sort_mode: mode });
  };
  const filterMinRating = useMapFiltersStore((s) => s.minRating);
  const filterRadiusMiles = useMapFiltersStore((s) => s.radiusMiles);
  const setRadiusMiles = useMapFiltersStore((s) => s.setRadiusMiles);
  const filterMinPrice = useMapFiltersStore((s) => s.minPrice);
  const filterMaxPrice = useMapFiltersStore((s) => s.maxPrice);
  const filterOpenNow = useMapFiltersStore((s) => s.openNow);
  const setOpenNow = useMapFiltersStore((s) => s.setOpenNow);
  const filterInStockOnly = useMapFiltersStore((s) => s.inStockOnly);
  const filterCategories = useMapFiltersStore((s) => s.selectedCategories);
  const filterSavedOnly = useMapFiltersStore((s) => s.savedOnly);
  const filterActiveCount = useMapFiltersStore((s) => s.activeFilterCount);
  const loadFilters = useMapFiltersStore((s) => s.loadFilters);
  const loadAllReviewStats = useReviewsStore((s) => s.loadAllReviewStats);
  const allProducts = useProductsStore((s) => s.products);

  // Price filter: IDs fetched directly from Supabase using price_cents
  // null = no price filter active; [] = filter active but no matches
  const [priceFilteredIds, setPriceFilteredIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (filterMinPrice === null && filterMaxPrice === null) {
      setPriceFilteredIds(null);
      return;
    }

    const minCents = filterMinPrice !== null ? Math.round(filterMinPrice * 100) : null;
    const maxCents = filterMaxPrice !== null ? Math.round(filterMaxPrice * 100) : null;

    if (__DEV__) {
      console.log('[PriceFilter] min $', filterMinPrice, '→', minCents, 'cents | max $', filterMaxPrice, '→', maxCents, 'cents');
    }

    let query = supabase
      .from('farmstand_products')
      .select('farmstand_id')
      .eq('in_stock', true);

    if (minCents !== null) query = query.gte('price_cents', minCents);
    if (maxCents !== null) query = query.lte('price_cents', maxCents);

    query.then(({ data, error }) => {
      if (error) {
        if (__DEV__) console.warn('[PriceFilter] Supabase error:', error.message);
        setPriceFilteredIds([]);
        return;
      }
      const ids = [...new Set((data ?? []).map((r) => (r as { farmstand_id: string }).farmstand_id))];
      if (__DEV__) {
        console.log('[PriceFilter] matched farmstand_ids from farmstand_products:', ids);
      }
      setPriceFilteredIds(ids);
    });
  }, [filterMinPrice, filterMaxPrice]);

  // Note: Radius is now only used to ZOOM the map, not as a hard filter
  // The map always shows farmstands within visible bounds (Airbnb-style)
  // Store map center separately for zoom calculations (updated on region change complete)
  const [mapCenter, setMapCenter] = useState<{ latitude: number; longitude: number }>({
    latitude: OREGON_REGION.latitude,
    longitude: OREGON_REGION.longitude,
  });

  // Bottom sheet state - TWO STATES ONLY: collapsed (72px) or expanded
  const [sheetState, setSheetState] = useState<SheetState>('collapsed');
  const scrollOffset = useSharedValue(0);
  const sheetHeight = useSharedValue(COLLAPSED_HEIGHT);
  const startY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  // Search input focus state - controls sheet behavior during typing
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  // Track the sheet state before search focus to restore it after
  const preSearchSheetState = useRef<SheetState>('collapsed');

  // Add Farmstand reminder banner state
  const [showAddBanner, setShowAddBanner] = useState(false);

  // Get user's search radius from settings
  const searchRadius = useUserStore((s) => s.location.searchRadius);
  const isGuest = useUserStore((s) => s.isGuest);
  const user = useUserStore((s) => s.user);

  // Location store - anchor location for distance calculations
  // anchorLocation only changes when user explicitly sets location (Use My Location, search)
  // NOT when selecting a farmstand
  const anchorLocation = useLocationStore((s) => s.anchorLocation);
  const setAnchorLocation = useLocationStore((s) => s.setAnchorLocation);

  // Favorites store
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const favorites = useFavoritesStore((s) => s.favorites);

  // Get farmstands from admin store
  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  // Cached farmstands for instant pin rendering
  const [cachedFarmstands, setCachedFarmstands] = useState<ExtendedFarmStand[]>([]);
  const FARMSTANDS_CACHE_KEY = 'map_farmstands_cache';

  // Promotions store for boosted ordering
  const loadPromotionsData = usePromotionsStore((s) => s.loadPromotionsData);
  const getBoostedForMap = usePromotionsStore((s) => s.getBoostedForMap);

  // Central reset helper — call whenever a new primary context starts (new search, new Explore
  // nav, chip X, search bar clear). Clears all primary context state and marks the current
  // nonce as consumed so it cannot reapply via useFocusEffect.
  //
  // Uses the most specific active nonce — collection > search — so the right guard is set
  // regardless of which type of context was previously active.
  //
  // Does NOT clear panel filters (rating, price, open-now, etc.) — those are secondary and
  // persist intentionally. Only the nav-applied radius is reset when navRadiusMilesSetRef is set.
  const clearPrimaryMapContext = useCallback((reason: string) => {
    const activeNonce = params.collectionNonce ?? params.openNowNonce ?? params.searchNonce ?? '0';
    if (__DEV__) {
      console.log('[MapContext] clearing primary context | reason:', reason,
        '| nonce:', activeNonce,
        '| params.search:', params.search ?? '(none)',
        '| params.collectionLabel:', params.collectionLabel ?? '(none)',
        '| navOpenNow:', params.navOpenNow ?? '(none)');
    }
    paramsStaleRef.current = true;
    userClearedNonceRef.current = activeNonce;
    // Intentionally NOT resetting processedParamsRef.current — the paramsKey guard in
    // useFocusEffect must stay intact so old Explore params cannot slip through on re-focus.
    // Same for processedSearchRef — preserve so the text-search block cannot re-apply.
    processedSearchRef.current = params.search
      ? `${params.search}-${params.searchNonce ?? '0'}`
      : null;
    initialSearchHandledRef.current = false;
    setSearchDraftText('');
    setActiveSearchQuery('');
    setMapFilter(null);
    setActiveCollectionIds(null);
    setActiveCollectionLabel(null);
    clearSearch();
    // Reset nav-applied panel filters — only if they were set via Explore navigation
    if (navRadiusMilesSetRef.current) {
      navRadiusMilesSetRef.current = false;
      setRadiusMiles(MAX_FILTER_RADIUS);
      if (__DEV__) console.log('[MapContext] nav-applied radius reset to MAX_FILTER_RADIUS');
    }
    if (navOpenNowSetRef.current) {
      navOpenNowSetRef.current = false;
      setOpenNow(false);
      if (__DEV__) console.log('[MapContext] nav-applied openNow reset to false');
    }
  }, [clearSearch, params.searchNonce, params.collectionNonce, params.openNowNonce, params.collectionLabel, params.search, setRadiusMiles, setOpenNow]);

  // Load admin data on mount and when returning to this screen
  useFocusEffect(
    useCallback(() => {
      loadAdminData();
      loadPromotionsData();
      loadFilters();
      loadAllReviewStats(); // pre-load so "Best Rated" sort has data ready immediately
      logMapOpen(user?.id);

      // Helper: reset any panel filters that were applied via Explore navigation (not user-set).
      // Called when a new primary context replaces the previous one so stale panel state is cleared.
      const resetNavPanelFilters = () => {
        if (navRadiusMilesSetRef.current) {
          navRadiusMilesSetRef.current = false;
          setRadiusMiles(MAX_FILTER_RADIUS);
          if (__DEV__) console.log('[MapContext] nav-applied radius reset (context switch)');
        }
        if (navOpenNowSetRef.current) {
          navOpenNowSetRef.current = false;
          setOpenNow(false);
          if (__DEV__) console.log('[MapContext] nav-applied openNow reset (context switch)');
        }
      };

      // --- NEW CATEGORY FILTER from Explore chip tap OR product text search ---
      // Guards: (1) nonce must exist, (2) paramsKey not already processed, (3) nonce not cleared.
      // NOTE: !paramsStaleRef is intentionally ABSENT — a fresh nonce always trumps prior local
      // actions. processedParamsRef alone prevents re-runs of the same nonce.
      if (params.mapFilterType && params.mapFilterProductTag) {
        const paramsKey = `${params.mapFilterType}-${params.mapFilterProductTag}-${params.searchNonce ?? '0'}`;
        const nonce = params.searchNonce ?? '0';
        if (params.searchNonce && processedParamsRef.current !== paramsKey && nonce !== userClearedNonceRef.current) {
          if (__DEV__) console.log('[MapContext] applying context | type: explore_category | tag:', params.mapFilterProductTag, '| nonce:', nonce, '| navRadius:', params.navRadiusMiles ?? '(none)');
          processedParamsRef.current = paramsKey;
          paramsStaleRef.current = false;
          resetNavPanelFilters(); // clear any previous nav-applied panel filters
          // Clear any previous primary context before applying the new one
          setActiveCollectionIds(null);
          setActiveCollectionLabel(null);
          processedCollectionZoomRef.current = null;
          setMapFilter({ type: params.mapFilterType, productTag: params.mapFilterProductTag });
          setActiveSearchQuery('');
          setSearchDraftText('');
          processedSearchRef.current = null;
          clearSearch();
          if (params.navRadiusMiles) {
            const parsedRadius = parseInt(params.navRadiusMiles, 10);
            if (!isNaN(parsedRadius) && parsedRadius > 0 && parsedRadius <= MAX_FILTER_RADIUS) {
              setRadiusMiles(parsedRadius);
              navRadiusMilesSetRef.current = true;
              if (__DEV__) console.log('[MapContext] nav radius applied:', parsedRadius, 'mi | anchor:', anchorLocation ? `${anchorLocation.latitude.toFixed(4)},${anchorLocation.longitude.toFixed(4)}` : '(none)');
            }
          }
        } else if (__DEV__) {
          console.log('[MapContext] ignored stale nonce | type: explore_category | nonce:', nonce, '| reason:', processedParamsRef.current === paramsKey ? 'already-processed' : 'user-cleared');
        }
      }

      // --- NEW TEXT-ONLY SEARCH from Explore search bar ---
      // Guards: (1) no category filter in same nav, (2) key not already processed, (3) nonce not cleared.
      // !paramsStaleRef intentionally absent — fresh nonce always wins.
      const textNonce = params.searchNonce ?? '0';
      const textSearchKey = params.search ? `${params.search}-${textNonce}` : null;
      if (
        params.search &&
        !params.mapFilterType &&
        textSearchKey !== processedSearchRef.current &&
        textNonce !== userClearedNonceRef.current
      ) {
        if (__DEV__) console.log('[MapContext] applying context | type: explore_text | query:', params.search, '| nonce:', textNonce);
        processedSearchRef.current = textSearchKey;
        paramsStaleRef.current = false;
        resetNavPanelFilters(); // clear any previous nav-applied panel filters
        // Clear any previous primary context before applying the new one
        setMapFilter(null);
        setActiveCollectionIds(null);
        setActiveCollectionLabel(null);
        processedParamsRef.current = null;
        processedCollectionZoomRef.current = null;
        setSearchDraftText(params.search);
        setActiveSearchQuery(params.search);
        initialSearchHandledRef.current = false;
      } else if (params.search && textSearchKey === processedSearchRef.current && __DEV__) {
        console.log('[MapContext] ignored stale nonce | type: explore_text | query:', params.search, '| nonce:', textNonce, '| reason: already-processed');
      } else if (params.search && textNonce === userClearedNonceRef.current && __DEV__) {
        console.log('[MapContext] ignored stale nonce | type: explore_text | query:', params.search, '| nonce:', textNonce, '| reason: user-cleared');
      }

      // --- GENERIC COLLECTION from Explore "Show all" (Top Spots, New This Week, Most Saved, …) ---
      // Guards: (1) key not already processed, (2) nonce not cleared.
      // !paramsStaleRef intentionally absent — fresh nonce always wins.
      if (params.collectionIds && params.collectionNonce && params.collectionLabel) {
        const collectionNonce = params.collectionNonce;
        const collectionKey = `collection-${collectionNonce}`;
        if (processedParamsRef.current !== collectionKey && collectionNonce !== userClearedNonceRef.current) {
          const ids = params.collectionIds.split(',').filter(Boolean);
          if (ids.length > 0) {
            if (__DEV__) console.log('[MapContext] applying context | type: explore_collection | label:', params.collectionLabel, '| ids:', ids.length, '| nonce:', collectionNonce);
            processedParamsRef.current = collectionKey;
            paramsStaleRef.current = false;
            processedCollectionZoomRef.current = null;
            resetNavPanelFilters(); // clear any previous nav-applied panel filters
            // Clear any previous primary context before applying the new one
            setMapFilter(null);
            setActiveSearchQuery('');
            setSearchDraftText('');
            processedSearchRef.current = null;
            clearSearch();
            initialSearchHandledRef.current = true;
            setActiveCollectionIds(ids);
            setActiveCollectionLabel(params.collectionLabel);
          }
        } else if (__DEV__) {
          console.log('[MapContext] ignored stale nonce | type: explore_collection | label:', params.collectionLabel, '| nonce:', collectionNonce, '| reason:', processedParamsRef.current === collectionKey ? 'already-processed' : 'user-cleared');
        }
      }

      // --- OPEN NOW FILTER from Explore "Open Now → Show all" ---
      // Activates the panel Open Now filter + a 25-mile radius. NOT a fixed ID collection —
      // panning/zooming updates visible results from the live viewport pipeline.
      // Guards: same pattern as category block — processedParamsRef + userClearedNonceRef.
      if (params.navOpenNow === 'true' && params.openNowNonce) {
        const openNowNonce = params.openNowNonce;
        const openNowKey = `open_now-${openNowNonce}`;
        if (processedParamsRef.current !== openNowKey && openNowNonce !== userClearedNonceRef.current) {
          if (__DEV__) console.log('[MapContext] applying context | type: open_now_filter | nonce:', openNowNonce, '| navRadiusMiles:', params.navRadiusMiles ?? '25');
          processedParamsRef.current = openNowKey;
          paramsStaleRef.current = false;
          resetNavPanelFilters(); // clear any previous nav-applied panel filters first
          // Clear any previous primary context
          setActiveCollectionIds(null);
          setActiveCollectionLabel(null);
          setMapFilter(null);
          setActiveSearchQuery('');
          setSearchDraftText('');
          processedSearchRef.current = null;
          processedCollectionZoomRef.current = null;
          clearSearch();
          initialSearchHandledRef.current = true;
          // Activate Open Now panel filter
          setOpenNow(true);
          navOpenNowSetRef.current = true;
          // Apply radius (default 25 miles if not specified)
          const rawRadius = params.navRadiusMiles ? parseInt(params.navRadiusMiles, 10) : 25;
          const parsedRadius = !isNaN(rawRadius) && rawRadius > 0 && rawRadius <= MAX_FILTER_RADIUS ? rawRadius : 25;
          setRadiusMiles(parsedRadius);
          navRadiusMilesSetRef.current = true;
          if (__DEV__) console.log('[MapContext] open_now_filter applied | openNow: true | radius:', parsedRadius, 'mi | filterOpenNow will be:', true);
        } else if (__DEV__) {
          console.log('[MapContext] ignored stale nonce | type: open_now_filter | nonce:', openNowNonce, '| reason:', processedParamsRef.current === openNowKey ? 'already-processed' : 'user-cleared');
        }
      }

      // --- NO SEARCH PARAMS: returning to Map tab with no active Explore navigation ---
      // paramsStaleRef = true means the user has done a local action (typed, cleared) that owns
      // the current context. Do NOT clear local state in that case.
      if (!params.search && !params.mapFilterType && !params.collectionIds && !params.navOpenNow) {
        if (__DEV__) console.log('[MapContext] active context summary | NO_SEARCH_PARAMS | paramsStaleRef:', paramsStaleRef.current, '| search:', activeSearchQuery || '(none)', '| mapFilter:', mapFilter ? mapFilter.productTag : '(none)', '| collection:', activeCollectionLabel ?? '(none)');
        if (activeSearchQuery && !paramsStaleRef.current) {
          if (__DEV__) console.log('[MapContext] clearing stale search | reason: no Explore params and paramsStaleRef=false');
          setSearchDraftText('');
          setActiveSearchQuery('');
          clearSearch();
        }
        if (mapFilter && !paramsStaleRef.current) {
          setMapFilter(null);
        }
        processedParamsRef.current = null;
        processedSearchRef.current = null;
        initialSearchHandledRef.current = false;
      }

      // Check if Add Farmstand banner should be shown
      const checkBanner = async () => {
        const shouldShow = await shouldShowAddFarmstandBanner();
        if (shouldShow) {
          // Small delay for smooth UX
          setTimeout(() => setShowAddBanner(true), 800);
        }
      };
      checkBanner();

      // Hide banner when leaving the screen
      return () => {
        setShowAddBanner(false);
      };
    // IMPORTANT: Do NOT include searchDraftText, activeSearchQuery, or selectedFarmId in deps
    // This prevents the effect from clearing search while user is typing
    // selectedFarmId removed - selection should NOT be cleared by this effect
    }, [loadAdminData, loadAllReviewStats, params.mapFilterType, params.mapFilterProductTag, params.search, params.searchNonce, params.collectionIds, params.collectionLabel, params.collectionNonce, params.navRadiusMiles, params.navOpenNow, params.openNowNonce, mapFilter, clearSearch, setRadiusMiles, setOpenNow])
  );


  // Navigate to Add Farmstand screen
  const handleAddFarmstand = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Pass current map center as prefilled location
    router.push({
      pathname: '/farmer/onboarding',
      params: {
        prefillLat: visibleRegion.latitude.toString(),
        prefillLng: visibleRegion.longitude.toString(),
      },
    });
  }, [router, visibleRegion.latitude, visibleRegion.longitude]);

  // Center map on user's location when the screen first loads
  useEffect(() => {
    const centerOnUserLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          return; // Keep default Oregon region if permission not granted
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const { latitude, longitude } = location.coords;
        setUserLocation({ latitude, longitude });

        // Set anchor location for distance calculations on initial load
        await setAnchorLocation({ latitude, longitude });

        // Set map center for radius filtering
        setMapCenter({ latitude, longitude });

        // Use search radius to determine zoom level
        const radiusDelta = (searchRadius / 69) * 2;

        mapRef.current?.animateToRegion({
          latitude,
          longitude,
          latitudeDelta: radiusDelta,
          longitudeDelta: radiusDelta,
        }, 500);
      } catch (error) {
        console.log('Could not get user location on mount:', error);
        // Keep default Oregon region on error
      }
    };

    centerOnUserLocation();
  }, []); // Only run once on mount

  // Keyboard event listeners - collapse sheet when typing in search
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener('keyboardWillShow', () => {
      // Only collapse if search input is focused
      if (isSearchFocused) {
        // Save current sheet state to restore later
        preSearchSheetState.current = sheetState;
        // Collapse sheet to keep search bar visible
        sheetHeight.value = withSpring(COLLAPSED_HEIGHT, {
          damping: 20,
          stiffness: 200,
          mass: 0.5,
        });
        setSheetState('collapsed');
      }
    });

    const keyboardWillHide = Keyboard.addListener('keyboardWillHide', () => {
      // When keyboard hides, we DON'T auto-expand
      // The sheet will expand when user submits search or taps a result
      // This prevents the jarring UX of the sheet jumping up immediately
    });

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, [isSearchFocused, sheetState, sheetHeight]);

  // Convert admin farmstands to FarmStand format for the map
  // Include promotion fields for sorting
  // Show both PENDING and ACTIVE farmstands on the map
  const allFarmStands: ExtendedFarmStand[] = useMemo(() => {
    return adminFarmstands
      .filter((f) => {
        // Must have valid coordinates
        if (f.latitude == null || f.longitude == null) {
          return false;
        }
        // Exclude soft-deleted farmstands
        if (f.deletedAt) {
          return false;
        }
        // Only show active farmstands on the public map
        if (f.status !== 'active') {
          return false;
        }
        // Only exclude from map if showOnMap is explicitly false
        if (f.showOnMap === false) {
          return false;
        }
        return true;
      })
      .map((f) => {
        // Use unified image selection - single source of truth
        const { url: smartImage } = getFarmstandDisplayImage({
          id: f.id,
          photos: f.photos,
          mainPhotoIndex: f.mainPhotoIndex,
          heroPhotoUrl: f.heroPhotoUrl,
          hero_image_url: f.heroImageUrl,
          ai_image_url: f.aiImageUrl,
          main_product: f.mainProduct,
          offerings: f.offerings,
          categories: f.categories,
        });

        return {
          id: f.id,
          name: f.name,
          description: f.description,
          address: [f.addressLine1, f.city, f.state].filter(Boolean).join(', ') || 'Address not available',
          city: f.city ?? '',
          region: f.state ?? 'Oregon',
          latitude: f.latitude!,
          longitude: f.longitude!,
          phone: f.phone ?? '',
          hours: 'See hours on detail page',
          rating: 0,
          reviewCount: f.reviewCount ?? 0,
          image: smartImage,
          products: f.offerings,
          features: f.categories,
          isOpen: f.isActive,
          distance: '',
          isFavorite: false,
          hoursData: f.hours,
          // Include promotion fields for sorting
          promoMapBoost: f.promoMapBoost,
          promoActive: f.promoActive,
          promoPriority: f.promoPriority,
          promoRotationWeight: f.promoRotationWeight,
          popularityScore: f.popularityScore,
          // Location precision for map marker styling
          locationPrecision: f.locationPrecision,
          // Mark as pending if status is pending
          isPending: f.status === 'pending',
          goldVerified: f.goldVerified,
          mainProduct: f.mainProduct,
          premiumStatus: f.premiumStatus,
          // camelCase aliases (kept for backward-compat)
          avgRating: f.avgRating,
          saves30d: f.saves30d,
          clicks30d: f.clicks30d,
          updatedAt: f.updatedAt,
          lastActivityAt: f.lastActivityAt ?? null,
          isOpen24_7: f.isOpen24_7,
          createdAt: f.createdAt ?? null,
          // ── Real Supabase snake_case sort fields — MUST be forwarded or sort sees all-zero ──
          avg_rating: f.avg_rating ?? f.avgRating ?? 0,
          review_count: f.review_count ?? f.reviewCount ?? 0,
          view_count: f.view_count ?? 0,
          saved_count: f.saved_count ?? 0,
          updated_at: f.updated_at ?? f.updatedAt ?? null,
          last_activity_at: f.last_activity_at ?? f.lastActivityAt ?? null,
          operatingStatus: f.operatingStatus ?? 'open',
        };
      });
  }, [adminFarmstands]);

  // BASE FARMSTANDS: Use fresh data if available, otherwise use cached data for instant pins
  const baseFarmstands = useMemo(() => {
    return allFarmStands.length > 0 ? allFarmStands : cachedFarmstands;
  }, [allFarmStands, cachedFarmstands]);

  // Load cached farmstands on mount for instant pin rendering
  useEffect(() => {
    const loadCachedFarmstands = async () => {
      try {
        const cached = await AsyncStorage.getItem(FARMSTANDS_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as ExtendedFarmStand[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('[Map] Loaded', parsed.length, 'cached farmstands for instant pins');
            setCachedFarmstands(parsed);
          }
        }
      } catch (e) {
        console.log('[Map] Failed to load cached farmstands:', e);
      }
    };
    loadCachedFarmstands();
  }, []);

  // Save fresh farmstands to cache when they arrive
  useEffect(() => {
    if (allFarmStands.length > 0) {
      AsyncStorage.setItem(FARMSTANDS_CACHE_KEY, JSON.stringify(allFarmStands)).catch((e: unknown) => {
        console.log('[Map] Failed to cache farmstands:', e);
      });
    }
  }, [allFarmStands]);

  // Filter farms based on search query using search store results
  // When Supabase search is active, use those results; otherwise fall back to local filtering
  const searchFilteredFarms = useMemo(() => {
    // If no active search query, return all farms (or the active collection subset)
    if (!activeSearchQuery.trim()) {
      if (activeCollectionIds !== null) {
        const idSet = new Set(activeCollectionIds);
        const filtered = baseFarmstands.filter((f) => idSet.has(f.id));
        if (__DEV__) console.log('[TopSpots] collection scope:', filtered.length, '/', baseFarmstands.length, '| first5:', filtered.slice(0, 5).map((f) => f.id));
        return filtered;
      }
      return baseFarmstands;
    }

    // PRIORITY 1: If matchedFarmstandIds param is present (name search from Explore), use those directly.
    // Guard: skip when paramsStaleRef is true — means the user has done a new local search/clear
    // and the route params are from a previous Explore navigation that no longer applies.
    if (params.matchedFarmstandIds && params.searchType === 'name' && !paramsStaleRef.current) {
      const matchedIds = params.matchedFarmstandIds.split(',').filter(Boolean);
      if (matchedIds.length > 0) {
        const matchedIdSet = new Set(matchedIds);
        // Filter and maintain the order from matchedIds (best match first)
        const matched = matchedIds
          .map((id) => baseFarmstands.find((f) => f.id === id))
          .filter((f): f is ExtendedFarmStand => f !== undefined);
        return matched;
      }
    }

    // PRIORITY 2: If single matchedFarmstandId param (legacy name search), use that.
    // Same stale-params guard as PRIORITY 1.
    if (params.matchedFarmstandId && params.searchType === 'name' && !paramsStaleRef.current) {
      const matched = baseFarmstands.find((f) => f.id === params.matchedFarmstandId);
      if (matched) {
        return [matched];
      }
    }

    // PRIORITY 3: If search store has results from Supabase search, use those
    if (isSearchActive && searchResults.length > 0) {
      const resultSet = new Set(searchResults);
      return baseFarmstands.filter(farm => resultSet.has(farm.id));
    }

    // PRIORITY 4: Fall back to local search
    const query = activeSearchQuery.toLowerCase().trim();

    // Define search term expansions for category searches
    // When user searches for these terms, we expand to include related keywords
    const searchExpansions: { [key: string]: string[] } = {
      'baked goods': ['baked', 'bakery', 'bread', 'sourdough', 'cookies', 'brownies', 'pastries', 'pastry', 'pie', 'pies', 'cake', 'cakes', 'muffins', 'scones', 'donuts', 'cinnamon rolls', 'croissant'],
      'sourdough': ['sourdough', 'bread', 'baked', 'bakery'],
      'fresh eggs': ['eggs', 'egg', 'farm fresh eggs', 'chicken eggs', 'duck eggs'],
      'produce': ['produce', 'vegetables', 'veggies', 'tomatoes', 'greens', 'lettuce', 'peppers', 'corn', 'squash', 'zucchini', 'cucumber', 'carrots', 'onions', 'garlic', 'potatoes'],
      'meat': ['meat', 'beef', 'pork', 'lamb', 'chicken', 'turkey', 'sausage', 'bacon', 'grass-fed', 'pasture-raised'],
      'flowers': ['flowers', 'flower', 'bouquet', 'tulips', 'sunflowers', 'lavender', 'roses', 'dahlias', 'cut flowers'],
      'honey': ['honey', 'bee', 'bees', 'honeycomb', 'raw honey', 'local honey'],
      'u-pick': ['u-pick', 'upick', 'pick your own', 'pyo'],
      'pumpkins': ['pumpkin', 'pumpkins', 'gourds', 'fall', 'autumn', 'halloween'],
      'seasonal': ['seasonal', 'apple', 'apples', 'peach', 'peaches', 'cherry', 'cherries', 'pear', 'pears', 'berries', 'strawberries', 'blueberries'],
      'dairy': ['dairy', 'milk', 'cheese', 'yogurt', 'butter', 'cream'],
    };

    // Check if this is a category search that should use expanded keywords
    let searchKeywords: string[] = [];
    let useOrLogic = false;

    // Check for exact or partial category match
    for (const [category, keywords] of Object.entries(searchExpansions)) {
      if (query === category || query.includes(category) || category.includes(query)) {
        searchKeywords = keywords;
        useOrLogic = true;
        break;
      }
    }

    // If no category match, use the original query words
    if (searchKeywords.length === 0) {
      searchKeywords = query.split(/\s+/).filter((word: string) => word.length > 0);
      useOrLogic = false; // Regular searches use AND logic
    }

    return baseFarmstands.filter((farm) => {
      const searchableText = [
        farm.name,
        farm.city,
        farm.region,
        farm.description,
        ...farm.products,
        ...farm.features,
      ].join(' ').toLowerCase();

      if (useOrLogic) {
        // Category search: ANY keyword match
        return searchKeywords.some((keyword) => searchableText.includes(keyword));
      } else {
        // Regular search: ALL words must match
        return searchKeywords.every((word) => searchableText.includes(word));
      }
    });
  }, [activeSearchQuery, activeCollectionIds, baseFarmstands, isSearchActive, searchResults, params.matchedFarmstandIds, params.matchedFarmstandId, params.searchType]);

  // Filter farms based on mapFilter (category navigation from Explore tab)
  // Uses the unified category filter for consistent results
  const mapFilteredFarms = useMemo(() => {
    // If no mapFilter, return all search-filtered farms
    if (!mapFilter || mapFilter.type !== 'category' || !mapFilter.productTag) {
      return searchFilteredFarms;
    }

    const categoryKey = mapFilter.productTag.toLowerCase();
    console.log('[MapFilter] Filtering by category:', categoryKey);

    // Use the unified category filter function
    const filtered = searchFilteredFarms.filter((farm) => {
      const matches = farmstandMatchesCategory({
        products: farm.products,
        features: farm.features,
        offerings: farm.products,
        categories: farm.features,
        mainProduct: farm.mainProduct, // Pass mainProduct for accurate filtering
      }, categoryKey);

      return matches;
    });

    console.log('[MapFilter] Category:', categoryKey, '- Filtered count:', filtered.length, '/', searchFilteredFarms.length);
    return filtered;
  }, [searchFilteredFarms, mapFilter]);

  // ── Advanced filters (rating, price, availability, category, saved) ──────
  const advancedFilteredFarms = useMemo(() => {
    let farms = mapFilteredFarms;
    if (__DEV__) console.log('[FilterPipeline] base before advanced filters:', farms.length);

    // Rating — only include farmstands with at least 1 review AND avgRating >= threshold
    if (filterMinRating !== null) {
      const before = farms.length;
      farms = farms.filter((f) => {
        const avg = Number(f.avg_rating ?? f.avgRating ?? 0);
        const count = Number(f.review_count ?? f.reviewCount ?? 0);
        // Require at least 1 review; exclude unrated farmstands
        return count > 0 && avg >= filterMinRating;
      });
      if (__DEV__) console.log('[RatingFilter] minRating:', filterMinRating, '| passed:', farms.length, '/', before);
    }

    // Price range — filter using farmstand_ids matched by Supabase price_cents query
    if (priceFilteredIds !== null) {
      const idSet = new Set(priceFilteredIds);
      farms = farms.filter((f) => idSet.has(f.id));
      if (__DEV__) {
        console.log('[PriceFilter] final farmstand_ids on map:', farms.map((f) => f.id));
      }
    }

    // Open Now — match the card badge exactly: badge shows "Open Now" when operatingStatus === 'open'
    // (operatingStatus defaults to 'open' when unset, same as the badge logic on line ~1808)
    if (filterOpenNow) {
      const before = farms.length;
      if (__DEV__) {
        const sampleBefore = farms.slice(0, 3).map((f) => ({
          id: f.id, name: f.name,
          operatingStatus: f.operatingStatus ?? '(unset→open)',
          hoursData: f.hoursData ? 'has hours' : null,
          badgeWouldShow: (f.operatingStatus ?? 'open') === 'open' ? 'Open Now' : f.operatingStatus,
        }));
        console.log('[OpenNowFilter] checking', before, 'farms | sample:', sampleBefore);
      }
      farms = farms.filter((f) => (f.operatingStatus ?? 'open') === 'open');
      if (__DEV__) {
        console.log('[OpenNowFilter] passed:', farms.length, '/', before);
      }
    }

    // Has products listed
    if (filterInStockOnly) {
      farms = farms.filter((f) => f.products && f.products.length > 0);
    }

    // Advanced category chips (separate from mapFilter navigate-from-explore)
    if (filterCategories.length > 0) {
      farms = farms.filter((f) =>
        filterCategories.some((cat) =>
          farmstandMatchesCategory(
            { products: f.products, features: f.features, offerings: f.products, categories: f.features, mainProduct: f.mainProduct ?? null },
            cat
          )
        )
      );
    }

    // Saved only
    if (filterSavedOnly) {
      farms = farms.filter((f) => favorites.has(f.id));
    }

    // Distance radius — hard filter when user set < 100mi and we have an anchor location
    if (filterRadiusMiles < MAX_FILTER_RADIUS && anchorLocation) {
      const before = farms.length;
      farms = farms.filter((f) => {
        const dist = calculateDistance(
          anchorLocation.latitude, anchorLocation.longitude,
          f.latitude, f.longitude
        );
        return dist <= filterRadiusMiles;
      });
      if (__DEV__) console.log('[RadiusFilter] radius:', filterRadiusMiles, 'mi | passed:', farms.length, '/', before);
    }

    if (__DEV__) console.log('[FilterPipeline] advancedFilteredFarms:', farms.length, '| filterMinRating:', filterMinRating ?? 'off', '| first5:', farms.slice(0, 5).map((f) => f.id));
    return farms;
  }, [mapFilteredFarms, filterMinRating, filterRadiusMiles, priceFilteredIds, filterOpenNow, filterInStockOnly, filterCategories, filterSavedOnly, favorites, anchorLocation]);

  // Load all review stats when rating filter OR Best Rated sort is active
  useEffect(() => {
    if (filterMinRating !== null || filterSortBy === 'rating') {
      loadAllReviewStats();
    }
  }, [filterMinRating, filterSortBy]);

  // DEV: log Open Now toggle changes so the wiring is visible in Expo logs
  useEffect(() => {
    if (!__DEV__) return;
    const openCount = baseFarmstands.filter((f) => (f.operatingStatus ?? 'open') === 'open').length;
    console.log('[OpenNowFilter] filterOpenNow changed →', filterOpenNow,
      '| baseFarmstands:', baseFarmstands.length,
      '| would pass filter:', openCount,
      '| sample operatingStatus (first 3):', baseFarmstands.slice(0, 3).map((f) => ({
        id: f.id, name: f.name, operatingStatus: f.operatingStatus ?? '(unset→open)',
      })));
  }, [filterOpenNow]);

  // DEV: log the active context whenever any primary context state changes
  useEffect(() => {
    if (!__DEV__) return;
    const contextType = activeCollectionIds !== null ? 'explore_collection'
      : mapFilter ? 'explore_category'
      : activeSearchQuery ? 'search'
      : 'normal_map_view';
    console.log('[MapContext] active context summary | type:', contextType,
      '| collection:', activeCollectionLabel ?? '(none)',
      '| collectionIds:', activeCollectionIds?.length ?? 0,
      '| category:', mapFilter?.productTag ?? '(none)',
      '| search:', activeSearchQuery || '(none)',
      '| paramsStale:', paramsStaleRef.current,
      '| clearedNonce:', userClearedNonceRef.current ?? '(null)');
  }, [activeSearchQuery, mapFilter, activeCollectionIds, activeCollectionLabel]);

  // Whether a text search, Explore category nav, or curated collection is active.
  // These bypass viewport restriction so all matches are visible globally.
  // Panel filter chips (Open Now, rating, price, radius, etc.) intentionally do NOT set this flag —
  // they must AND with the current viewport, not bypass it and show all global matches.
  const isFilterActive = useMemo(() => {
    return !!(activeSearchQuery.trim() || mapFilter || activeCollectionIds !== null);
  }, [activeSearchQuery, mapFilter, activeCollectionIds]);

  // ── SINGLE SOURCE OF TRUTH ─────────────────────────────────────────────────
  // ALL tray cards, count label, and search results come from this one array.
  // Filtering happens first (viewport or all-matches), then sorting is applied last.
  const finalVisibleFarmstands = useMemo((): ExtendedFarmStand[] => {
    const centerLat = anchorLocation?.latitude ?? visibleRegion.latitude;
    const centerLng = anchorLocation?.longitude ?? visibleRegion.longitude;

    // When a text search or Explore category nav is active: show all matches globally.
    // All other cases (panel filters, no filter, sort-only): restrict to the visible map viewport.
    const base: ExtendedFarmStand[] = isFilterActive
      ? [...advancedFilteredFarms]
      : advancedFilteredFarms.filter((f) => isFarmInViewport(f, visibleRegion));
    if (__DEV__) console.log('[FilterPipeline] after viewport/area filter:', base.length, '| isFilterActive:', isFilterActive);

    let sorted: ExtendedFarmStand[];

    if (filterSortBy === 'rating') {
      sorted = base.sort((a, b) => {
        const aRated = Number(a.avg_rating ?? 0) > 0 || Number(a.review_count ?? 0) > 0;
        const bRated = Number(b.avg_rating ?? 0) > 0 || Number(b.review_count ?? 0) > 0;
        if (aRated !== bRated) return aRated ? -1 : 1;
        const diff = Number(b.avg_rating ?? 0) - Number(a.avg_rating ?? 0);
        return diff !== 0 ? diff : Number(b.review_count ?? 0) - Number(a.review_count ?? 0);
      });
    } else if (filterSortBy === 'most_viewed') {
      sorted = base.sort((a, b) => Number(b.view_count ?? 0) - Number(a.view_count ?? 0));
    } else if (filterSortBy === 'most_saved') {
      sorted = base.sort((a, b) => Number(b.saved_count ?? 0) - Number(a.saved_count ?? 0));
    } else if (filterSortBy === 'recently_active') {
      sorted = base.sort((a, b) => {
        const getTs = (f: ExtendedFarmStand) =>
          new Date(f.updated_at ?? f.last_activity_at ?? f.updatedAt ?? 0).getTime();
        return getTs(b) - getTs(a);
      });
    } else {
      sorted = getRelevanceSortedFarms(base, centerLat, centerLng);
    }

    if (__DEV__) console.log('[PinSync] finalVisibleFarmstands (cards/count):', sorted.length, '| filterMinRating:', filterMinRating ?? 'off', '| first5:', sorted.slice(0, 5).map((f) => f.id));
    return sorted;
  }, [advancedFilteredFarms, visibleRegion, filterSortBy, isFilterActive, anchorLocation, filterMinRating]);

  // Backward-compat alias — all existing JSX that referenced visibleFarmstands now uses the sorted array
  const visibleFarmstands = finalVisibleFarmstands;

  // ── sortedFarmstands: guaranteed re-run when filterSortBy changes ────────────
  const sortedFarmstands = useMemo((): ExtendedFarmStand[] => {
    const sorted = [...finalVisibleFarmstands];
    if (filterSortBy === 'relevance') {
      const centerLat = anchorLocation?.latitude ?? visibleRegion.latitude;
      const centerLng = anchorLocation?.longitude ?? visibleRegion.longitude;
      return getRelevanceSortedFarms(sorted, centerLat, centerLng);
    } else if (filterSortBy === 'recently_active') {
      sorted.sort((a, b) => {
        // updated_at → last_activity_at → updatedAt (camelCase) → createdAt (always differs per stand)
        const aTs = new Date(a.updated_at ?? a.last_activity_at ?? a.updatedAt ?? a.createdAt ?? 0).getTime();
        const bTs = new Date(b.updated_at ?? b.last_activity_at ?? b.updatedAt ?? b.createdAt ?? 0).getTime();
        return bTs - aTs;
      });
    } else if (filterSortBy === 'rating') {
      sorted.sort((a, b) => {
        // Rated farms (have any rating data) come before unrated ones
        const aRated = Number(a.avg_rating ?? 0) > 0 || Number(a.review_count ?? 0) > 0;
        const bRated = Number(b.avg_rating ?? 0) > 0 || Number(b.review_count ?? 0) > 0;
        if (aRated !== bRated) return aRated ? -1 : 1;
        const diff = Number(b.avg_rating ?? 0) - Number(a.avg_rating ?? 0);
        return diff !== 0 ? diff : Number(b.review_count ?? 0) - Number(a.review_count ?? 0);
      });
    } else if (filterSortBy === 'most_viewed') {
      sorted.sort((a, b) => Number(b.view_count ?? 0) - Number(a.view_count ?? 0));
    } else if (filterSortBy === 'most_saved') {
      sorted.sort((a, b) => Number(b.saved_count ?? 0) - Number(a.saved_count ?? 0));
    }
    return sorted;
  }, [finalVisibleFarmstands, filterSortBy, anchorLocation, visibleRegion]);

  // Compute selectedFarmstand from master list (baseFarmstands - uses fresh OR cached)
  // This is separate from displayedFarms to enable strict render priority
  const selectedFarmstand = useMemo(() => {
    if (!selectedFarmId) return null;
    // Look up in baseFarmstands which includes cached data for instant availability
    return baseFarmstands.find((farm) => farm.id === selectedFarmId) ?? null;
  }, [selectedFarmId, baseFarmstands]);

  // GUARD: Single boolean to control ALL card rendering
  // Based on pinnedFarmstand — only set/cleared by explicit user action, never by effects/memos
  const isPinSelected = Boolean(pinnedFarmstand);

  // Pins to show on map — always derived from advancedFilteredFarms so panel filters
  // (rating, openNow, price, categories, etc.) remove non-matching pins immediately.
  // When no filters are active, advancedFilteredFarms ≡ baseFarmstands so the
  // Airbnb-style all-pins behavior is preserved.
  // NOTE: pin logic is NOT affected by sort order — do NOT change this.
  const pinsToShow = useMemo(() => {
    if (__DEV__) console.log('[PinSync] pinsToShow (marker array):', advancedFilteredFarms.length, '| filterMinRating:', filterMinRating ?? 'off', '| first5:', advancedFilteredFarms.slice(0, 5).map((f) => f.id));
    return advancedFilteredFarms;
  }, [advancedFilteredFarms, filterMinRating]);

  // Debounce map-pin updates while the filter modal is open.
  // Without this, each chip tap immediately destroys/recreates all native Marker components
  // (e.g. 500 → 50 pins) while the user is still interacting with the sheet,
  // causing native-view churn that can OOM the Simulator.
  // The modal covers the map anyway, so the user never sees intermediate pin states.
  const [stablePins, setStablePins] = useState<ExtendedFarmStand[]>(() => pinsToShow);
  useEffect(() => {
    if (!showFilterModal) {
      if (__DEV__) console.log('[PinSync] stablePins→actual rendered markers:', pinsToShow.length, '| finalVisible (cards/count):', finalVisibleFarmstands.length, '| first5:', pinsToShow.slice(0, 5).map((f) => f.id));
      setStablePins(pinsToShow);
      return;
    }
    const t = setTimeout(() => {
      if (__DEV__) console.log('[PinSync] stablePins→actual rendered markers (debounced):', pinsToShow.length, '| finalVisible (cards/count):', finalVisibleFarmstands.length, '| first5:', pinsToShow.slice(0, 5).map((f) => f.id));
      setStablePins(pinsToShow);
    }, 150);
    return () => clearTimeout(t);
  }, [pinsToShow, showFilterModal, finalVisibleFarmstands.length]);

  // Calculate content-aware expanded height based on what will be shown
  const EXPANDED_HEIGHT = useMemo(() => {
    // If a pin is selected, we show 1 card
    // NOTE: use pinnedFarmstand (not selectedFarmstand) so this memo is NOT in the
    // selectedFarmId → selectedFarmstand → EXPANDED_HEIGHT → snapToState cascade
    const farmCount = pinnedFarmstand ? 1 : visibleFarmstands.length;

    if (farmCount === 0) {
      // Empty state - show enough for message + add button
      return Math.min(300, MAX_EXPANDED_HEIGHT);
    }

    if (farmCount === 1) {
      // Single farmstand - height = handle + single card + padding
      // Use larger single card dimensions
      const singleCardContentHeight = HANDLE_AREA_HEIGHT + SINGLE_CARD_HEIGHT + 24;
      // Cap at 60% of screen or max expanded, whichever is smaller
      const maxSingleHeight = Math.min(SCREEN_HEIGHT * 0.6, MAX_EXPANDED_HEIGHT);
      return Math.min(singleCardContentHeight, maxSingleHeight);
    }

    // Multiple farmstands - use full expanded height for scrollable list
    return MAX_EXPANDED_HEIGHT;
  }, [pinnedFarmstand, visibleFarmstands.length, MAX_EXPANDED_HEIGHT]);

  // Keep maxExpandedHeight shared value in sync with EXPANDED_HEIGHT
  useEffect(() => {
    maxExpandedHeight.value = EXPANDED_HEIGHT;
  }, [EXPANDED_HEIGHT]);

  // Calculate distance from user's anchor location (NOT map center)
  // Returns null if no anchor location is set
  const getDistanceFromAnchor = useCallback((farm: FarmStand): string | null => {
    if (!anchorLocation) return null;
    const dist = calculateDistance(
      anchorLocation.latitude,
      anchorLocation.longitude,
      farm.latitude,
      farm.longitude
    );
    return dist < 10 ? dist.toFixed(1) : Math.round(dist).toString();
  }, [anchorLocation]);

  // Search effect - triggers Supabase search when activeSearchQuery changes (on submit)
  useEffect(() => {
    const trimmedQuery = activeSearchQuery.trim();

    // If empty, clear search immediately
    if (!trimmedQuery) {
      clearSearch();
      return;
    }

    // Trigger search immediately (no debounce needed since it only fires on submit)
    console.log('[Map] Triggering search for:', trimmedQuery);
    // Cast adminFarmstands to Farmstand[] for the search store
    performSearch(trimmedQuery, adminFarmstands as unknown as Farmstand[]);
  }, [activeSearchQuery, adminFarmstands, performSearch, clearSearch]);

  // Snap to nearest state based on height (JS thread only) - TWO STATES ONLY
  const snapToState = useCallback((targetState: SheetState) => {
    const targetHeight = targetState === 'expanded' ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;

    sheetHeight.value = withSpring(targetHeight, {
      damping: 20,
      stiffness: 200,
      mass: 0.5,
    });
    setSheetState(targetState);
    // NOTE: Do NOT clear selectedFarmId here - selection should persist until explicit user action
  }, [sheetHeight, EXPANDED_HEIGHT]);

  // Get closest snap point - TWO STATES ONLY
  const getClosestState = useCallback((height: number): SheetState => {
    const midpoint = (COLLAPSED_HEIGHT + EXPANDED_HEIGHT) / 2;
    return height > midpoint ? 'expanded' : 'collapsed';
  }, [EXPANDED_HEIGHT]);

  // Handle tap on the handle area
  const handleHandleTap = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (sheetState === 'collapsed') {
      snapToState('expanded');
    } else {
      snapToState('collapsed');
    }
  }, [sheetState, snapToState]);

  // Helper to snap to closest state (called from JS thread)
  const snapToClosestState = useCallback((height: number) => {
    const closest = getClosestState(height);
    snapToState(closest);
  }, [getClosestState, snapToState]);

  // Zoom map to fit all matching farms when search results change
  useEffect(() => {
    if (!activeSearchQuery.trim() || searchFilteredFarms.length === 0) return;

    const timer = setTimeout(() => {
      // GUARD: Never move the map or override the sheet when the user has selected a pin.
      // pinnedFarmstandRef is a ref so it can be read here without being in deps.
      if (pinnedFarmstandRef.current) return;

      // Only zoom/fit if NOT currently typing (search not focused)
      // This prevents jarring map movements while the user is still typing
      if (!isSearchFocused) {
        if (searchFilteredFarms.length === 1) {
          const farm = searchFilteredFarms[0];
          mapRef.current?.animateToRegion({
            latitude: farm.latitude,
            longitude: farm.longitude,
            latitudeDelta: 0.15,
            longitudeDelta: 0.15,
          }, 500);
        } else if (searchFilteredFarms.length > 0) {
          const coordinates = searchFilteredFarms.map((farm) => ({
            latitude: farm.latitude,
            longitude: farm.longitude,
          }));

          mapRef.current?.fitToCoordinates(coordinates, {
            edgePadding: { top: 150, right: 50, bottom: 170, left: 50 },
            animated: true,
          });
        }

        // Expand bottom sheet to show results (only if not typing)
        if (searchFilteredFarms.length > 0) {
          snapToState('expanded');
        }
      }
      // NOTE: Do NOT clear selectedFarmId here - selection should persist until explicit user action
    }, 100); // Small delay to let results settle

    return () => clearTimeout(timer);
  // isSearchActive added: re-zoom when Supabase results arrive (local Priority-4 and Supabase
  // Priority-3 may return the same count but different farms at different coordinates)
  }, [searchFilteredFarms.length, activeSearchQuery, isSearchActive, snapToState, isSearchFocused]);

  // Zoom map to fit all filtered farms when mapFilter changes (category navigation)
  useEffect(() => {
    if (!mapFilter || mapFilter.type !== 'category' || mapFilteredFarms.length === 0) return;

    const timer = setTimeout(() => {
      if (mapFilteredFarms.length === 1) {
        const farm = mapFilteredFarms[0];
        mapRef.current?.animateToRegion({
          latitude: farm.latitude,
          longitude: farm.longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }, 500);
      } else {
        const coordinates = mapFilteredFarms.map((farm) => ({
          latitude: farm.latitude,
          longitude: farm.longitude,
        }));

        mapRef.current?.fitToCoordinates(coordinates, {
          edgePadding: { top: 80, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }

      // Expand the bottom sheet to show filtered results
      snapToState('expanded');
      // NOTE: Do NOT clear selectedFarmId here - selection should persist until explicit user action
    }, 400);

    return () => clearTimeout(timer);
  }, [mapFilter, mapFilteredFarms, snapToState]);

  // Zoom map to show all farms in the active collection when it is first applied.
  // Uses processedCollectionZoomRef so the zoom only fires once per collection, even if
  // baseFarmstands loads asynchronously after the collection IDs arrive.
  useEffect(() => {
    if (!activeCollectionIds || searchFilteredFarms.length === 0) return;
    const key = activeCollectionIds.join(',');
    if (processedCollectionZoomRef.current === key) return;
    processedCollectionZoomRef.current = key;

    if (__DEV__) console.log('[TopSpots] auto-zoom to', searchFilteredFarms.length, 'collection farms | first5:', searchFilteredFarms.slice(0, 5).map((f) => f.id));

    const timer = setTimeout(() => {
      const coordinates = searchFilteredFarms.map((f) => ({ latitude: f.latitude, longitude: f.longitude }));
      isProgrammaticAnimation.current = true;
      if (coordinates.length === 1) {
        mapRef.current?.animateToRegion({
          latitude: coordinates[0].latitude,
          longitude: coordinates[0].longitude,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }, 500);
      } else {
        mapRef.current?.fitToCoordinates(coordinates, {
          edgePadding: { top: 80, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }
      snapToState('expanded');
    }, 400);
    return () => clearTimeout(timer);
  }, [activeCollectionIds, searchFilteredFarms, snapToState]);

  // Called by MapFilterModal when the user presses "Show X Farmstands" (not swipe-to-close).
  // Sets a ref so the auto-zoom effect below can distinguish CTA close from cancel close.
  const handleFilterApplyIntent = useCallback(() => {
    filterJustApplied.current = true;
    if (__DEV__) console.log('[FilterApply] CTA pressed — will auto-zoom to', advancedFilteredFarms.length, 'farms on modal close');
  }, [advancedFilteredFarms.length]);

  // Auto-zoom the map to fit all filtered farms when the filter modal CTA was pressed.
  // Only fires when showFilterModal transitions to false AND filterJustApplied = true.
  // Does not fire on swipe-to-close so the viewport isn't disturbed on accidental dismissal.
  useEffect(() => {
    if (showFilterModal || !filterJustApplied.current) return;
    filterJustApplied.current = false;

    const farms = advancedFilteredFarms;
    // Only zoom if filtering meaningfully reduced the set (skip if no active filter)
    if (farms.length === 0 || farms.length >= baseFarmstands.length) {
      if (__DEV__) console.log('[FilterApply] skipping auto-zoom | farms:', farms.length, '| base:', baseFarmstands.length);
      return;
    }

    if (__DEV__) console.log('[FilterApply] auto-zoom to', farms.length, 'filtered farms | first5:', farms.slice(0, 5).map((f) => f.id));

    const coordinates = farms.map((f) => ({ latitude: f.latitude, longitude: f.longitude }));
    isProgrammaticAnimation.current = true;
    if (coordinates.length === 1) {
      mapRef.current?.animateToRegion({
        latitude: coordinates[0].latitude,
        longitude: coordinates[0].longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }, 500);
    } else {
      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: 80, right: 60, bottom: 220, left: 60 },
        animated: true,
      });
    }
    snapToState('expanded');
  }, [showFilterModal, advancedFilteredFarms, baseFarmstands.length, snapToState]);

  // Handle initial search navigation from Explore (runs once when search params are present)
  useEffect(() => {
    // Skip if already handled, no search params, or user has superseded these params locally
    if (initialSearchHandledRef.current) return;
    if (!params.search || baseFarmstands.length === 0 || paramsStaleRef.current) return;

    initialSearchHandledRef.current = true;
    const searchType = params.searchType;

    // Handle different search types with specific behaviors
    if (searchType === 'location' && params.targetLat && params.targetLng) {
      // Location search: zoom to target location
      const targetLat = parseFloat(params.targetLat);
      const targetLng = parseFloat(params.targetLng);

      if (!isNaN(targetLat) && !isNaN(targetLng) && targetLat !== 0 && targetLng !== 0) {
        isProgrammaticAnimation.current = true;
        const newRegion = {
          latitude: targetLat,
          longitude: targetLng,
          latitudeDelta: 0.5, // ~25mi view
          longitudeDelta: 0.5,
        };
        setTimeout(() => {
          mapRef.current?.animateToRegion(newRegion, 500);
        }, 300);
      }
    } else if (searchType === 'name') {
      // Name search: show matching farmstands
      // Parse matched farmstand IDs (comma-separated)
      const matchedIds = params.matchedFarmstandIds
        ? params.matchedFarmstandIds.split(',').filter(Boolean)
        : params.matchedFarmstandId
          ? [params.matchedFarmstandId]
          : [];

      if (matchedIds.length > 0) {
        // Find the best match (first one) for centering
        const bestMatchId = params.matchedFarmstandId || matchedIds[0];
        const bestMatch = baseFarmstands.find((f) => f.id === bestMatchId);

        if (bestMatch && bestMatch.latitude && bestMatch.longitude) {
          isProgrammaticAnimation.current = true;

          // Calculate region to fit all matches if multiple
          if (matchedIds.length === 1) {
            // Single match: zoom in close and select it
            const newRegion = {
              latitude: bestMatch.latitude,
              longitude: bestMatch.longitude,
              latitudeDelta: 0.15,
              longitudeDelta: 0.15,
            };
            setSelectedFarmId(bestMatch.id);
            setTimeout(() => {
              mapRef.current?.animateToRegion(newRegion, 500);
              snapToState('expanded');
            }, 300);
          } else {
            // Multiple matches: calculate bounds to fit all
            const matchedFarms = baseFarmstands.filter((f) => matchedIds.includes(f.id));
            const validFarms = matchedFarms.filter((f) => f.latitude && f.longitude);

            if (validFarms.length > 0) {
              const lats = validFarms.map((f) => f.latitude!);
              const lngs = validFarms.map((f) => f.longitude!);
              const minLat = Math.min(...lats);
              const maxLat = Math.max(...lats);
              const minLng = Math.min(...lngs);
              const maxLng = Math.max(...lngs);

              const centerLat = (minLat + maxLat) / 2;
              const centerLng = (minLng + maxLng) / 2;
              const latDelta = Math.max(0.1, (maxLat - minLat) * 1.5);
              const lngDelta = Math.max(0.1, (maxLng - minLng) * 1.5);

              const newRegion = {
                latitude: centerLat,
                longitude: centerLng,
                latitudeDelta: latDelta,
                longitudeDelta: lngDelta,
              };
              // Don't select any single farm when multiple matches
              setTimeout(() => {
                mapRef.current?.animateToRegion(newRegion, 500);
                snapToState('expanded');
              }, 300);
            }
          }
        }
      }
    }
    // Product search is handled by the mapFilter effect above
  }, [params.search, params.searchType, params.targetLat, params.targetLng, params.matchedFarmstandId, params.matchedFarmstandIds, baseFarmstands, snapToState]);

  // Handle "View on Map" navigation from Manage Listings admin screen
  // This runs whenever viewOnMapFarmstandId param appears or baseFarmstands loads
  useEffect(() => {
    if (!params.viewOnMapFarmstandId) return;
    // Skip if we already processed this exact farmstand navigation
    if (processedViewOnMapIdRef.current === params.viewOnMapFarmstandId) return;
    // Wait until farmstand data has loaded (either live or cached)
    if (baseFarmstands.length === 0 && adminFarmstands.length === 0) return;

    const targetId = params.viewOnMapFarmstandId;
    const targetLat = params.viewOnMapLat ? parseFloat(params.viewOnMapLat) : null;
    const targetLng = params.viewOnMapLng ? parseFloat(params.viewOnMapLng) : null;

    console.log('[ViewOnMap] Processing farmstand id:', targetId, '| coords:', targetLat, targetLng);

    // Mark as processed so tab re-focus doesn't re-trigger
    processedViewOnMapIdRef.current = targetId;

    // Try to find in baseFarmstands (visible, active/pending farmstands with coords)
    const visibleFarm = baseFarmstands.find((f) => f.id === targetId);

    if (visibleFarm) {
      // Found in visible map results - select marker and open card
      console.log('[ViewOnMap] Found in visible results, selecting marker and opening card:', targetId);
      setSelectedFarmId(visibleFarm.id);
      isProgrammaticAnimation.current = true;
      const newRegion = {
        latitude: visibleFarm.latitude,
        longitude: visibleFarm.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      setTimeout(() => {
        mapRef.current?.animateToRegion(newRegion, 500);
        snapToState('expanded');
        console.log('[ViewOnMap] Map centered and bottom sheet opened for:', targetId);
      }, 300);
      return;
    }

    // Not in visible results (hidden/draft farmstand) - try adminFarmstands for coords
    const adminMatch = adminFarmstands.find((f) => f.id === targetId);
    const lat = targetLat ?? (adminMatch?.latitude ?? null);
    const lng = targetLng ?? (adminMatch?.longitude ?? null);

    if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
      // Animate to coordinates even if no visible marker
      console.log('[ViewOnMap] Not in visible results (may be hidden/draft), animating to coords:', lat, lng);
      isProgrammaticAnimation.current = true;
      const newRegion = {
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      setTimeout(() => {
        mapRef.current?.animateToRegion(newRegion, 500);
        console.log('[ViewOnMap] Animated to coords for hidden/draft farmstand:', targetId);
      }, 300);
    } else {
      // No coords available at all
      console.log('[ViewOnMap] Cannot locate farmstand - no coords found for:', targetId);
      Alert.alert('Location unavailable', 'This farmstand does not have a location set.');
    }
  }, [params.viewOnMapFarmstandId, params.viewOnMapLat, params.viewOnMapLng, baseFarmstands, adminFarmstands, snapToState]);

  // Pan gesture for the handle area - TWO STATES ONLY
  const handlePanGesture = Gesture.Pan()
    .onStart(() => {
      startY.value = sheetHeight.value;
      isDragging.value = true;
    })
    .onUpdate((event) => {
      // Dragging up = negative translationY = increase height
      // Hard clamp between COLLAPSED_HEIGHT and maxExpandedHeight (shared value for worklet)
      const newHeight = startY.value - event.translationY;
      sheetHeight.value = Math.max(COLLAPSED_HEIGHT, Math.min(maxExpandedHeight.value, newHeight));
    })
    .onEnd((event) => {
      isDragging.value = false;
      const velocity = -event.velocityY; // Positive velocity = moving up
      const currentHeight = sheetHeight.value;

      // Use velocity to determine direction - TWO STATES ONLY
      if (Math.abs(velocity) > 500) {
        if (velocity > 0) {
          // Moving up -> expand
          runOnJS(snapToState)('expanded');
        } else {
          // Moving down -> collapse
          runOnJS(snapToState)('collapsed');
        }
      } else {
        // Snap to closest
        runOnJS(snapToClosestState)(currentHeight);
      }
    });

  // Content area pan gesture (for scrolled-to-top collapse behavior)
  const contentPanGesture = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onStart(() => {
      startY.value = sheetHeight.value;
    })
    .onUpdate((event) => {
      // Only allow collapse if scrolled to top and dragging down
      if (scrollOffset.value <= 0 && event.translationY > 0) {
        const newHeight = startY.value - event.translationY;
        sheetHeight.value = Math.max(COLLAPSED_HEIGHT, Math.min(maxExpandedHeight.value, newHeight));
      }
    })
    .onEnd((event) => {
      if (scrollOffset.value <= 0 && event.translationY > 50) {
        // Dragged down enough - collapse
        runOnJS(snapToState)('collapsed');
      } else {
        // Snap back to expanded
        runOnJS(snapToState)('expanded');
      }
    });

  // Animated style for bottom sheet - HARD CLAMP using shared value for worklet access
  const animatedSheetStyle = useAnimatedStyle(() => ({
    height: Math.max(COLLAPSED_HEIGHT, Math.min(maxExpandedHeight.value, sheetHeight.value)),
  }));

  const handleMarkerPress = useCallback((farm: FarmStand, event?: { stopPropagation?: () => void }) => {
    // Stop event from bubbling to map (which would deselect)
    event?.stopPropagation?.();

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackEvent('map_marker_tapped', { farmstand_id: farm.id, farmstand_name: farm.name });
    setSelectedFarmId(farm.id);

    // Open sheet to expanded state when tapping a marker
    snapToState('expanded');

    // Mark this as a programmatic animation so handleRegionChangeComplete doesn't clear the selection
    isProgrammaticAnimation.current = true;

    // Animate map to farm location
    const newRegion = {
      latitude: farm.latitude,
      longitude: farm.longitude,
      latitudeDelta: 0.15,
      longitudeDelta: 0.15,
    };
    mapRef.current?.animateToRegion(newRegion, 500);
  }, [snapToState]);

  const handleFarmCardPress = useCallback((farm: FarmStand) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackEvent('map_card_tapped', { farmstand_id: farm.id, farmstand_name: farm.name });
    router.push(`/farm/${farm.id}`);
  }, [router]);

  const handleMapPress = useCallback(() => {
    // Dismiss keyboard when tapping on the map (keep search results unchanged)
    Keyboard.dismiss();

    // Clear selection
    if (selectedFarmId) {
      pinnedFarmstandRef.current = null;
      setPinnedFarmstand(null);
      setSelectedFarmId(null);
    }
    // Collapse sheet when tapping map
    snapToState('collapsed');
  }, [selectedFarmId, snapToState]);

  // Track the latest region during panning (throttled to avoid too many updates)
  const lastRegionUpdate = useRef<number>(0);

  // Track previous region for auto-deselect on meaningful pan/zoom
  const lastRegionRef = useRef<Region | null>(null);

  const handleRegionChange = useCallback((region: Region) => {
    // Throttle updates to every 100ms during panning
    const now = Date.now();
    if (now - lastRegionUpdate.current > 100) {
      lastRegionUpdate.current = now;
      setVisibleRegion(region);
    }
  }, []);

  // Track if map animation was triggered programmatically (e.g., by marker press)
  const isProgrammaticAnimation = useRef(false);

  // True when the user pressed "Show X Farmstands" CTA in the filter modal (vs swipe-to-close).
  // Consumed by the auto-zoom effect below to fit the map to filtered results.
  const filterJustApplied = useRef(false);

  const handleRegionChangeComplete = useCallback((region: Region) => {
    // Always update visible region - render priority handles the flash issue
    setVisibleRegion(region);
    // Update map center for radius calculations
    setMapCenter({ latitude: region.latitude, longitude: region.longitude });

    // Auto-deselect on meaningful pan/zoom (skip if programmatic animation or pin is locked)
    if (!isProgrammaticAnimation.current && selectedFarmId && !pinnedFarmstandRef.current) {
      const last = lastRegionRef.current;
      const movedEnough =
        !last ||
        Math.abs(region.latitude - last.latitude) > 0.005 ||
        Math.abs(region.longitude - last.longitude) > 0.005 ||
        (last.latitudeDelta > 0 && Math.abs(region.latitudeDelta - last.latitudeDelta) / last.latitudeDelta > 0.05) ||
        (last.longitudeDelta > 0 && Math.abs(region.longitudeDelta - last.longitudeDelta) / last.longitudeDelta > 0.05);

      if (movedEnough) {
        setSelectedFarmId(null);
      }
    }

    // Update last region ref
    lastRegionRef.current = region;

    // Clear programmatic animation flag
    isProgrammaticAnimation.current = false;

    mapRef.current?.getCamera().then((camera) => {
      if (camera.heading !== undefined) {
        setMapHeading(camera.heading);
      }
    });
  }, [selectedFarmId]);

  const handleLocateMe = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLocating(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Permission',
          'Please enable location access in your device settings to find farms near you.',
          [{ text: 'OK' }]
        );
        setIsLocating(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;
      setUserLocation({ latitude, longitude });

      // Set anchor location for distance calculations - this is an explicit user action
      await setAnchorLocation({ latitude, longitude });

      // Update map center for radius filtering
      setMapCenter({ latitude, longitude });

      const radiusDelta = (searchRadius / 69) * 2;

      // Mark as programmatic so we auto-update locked region
      isProgrammaticAnimation.current = true;

      const newRegion = {
        latitude,
        longitude,
        latitudeDelta: radiusDelta,
        longitudeDelta: radiusDelta,
      };

      mapRef.current?.animateToRegion(newRegion, 500);
      // NOTE: Do NOT clear selectedFarmId here - selection should persist until explicit user action

    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert(
        'Location Error',
        'Unable to get your location. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsLocating(false);
    }
  }, [searchRadius, setAnchorLocation]);

  const handleCompassPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    mapRef.current?.animateCamera({
      heading: 0,
    }, { duration: 300 });
    setMapHeading(0);
  }, []);

  // Handle radius change with auto-zoom to fit the radius circle on screen
  // This is called in real-time as the slider moves
  const handleRadiusChangeWithZoom = useCallback((miles: number | null) => {
    // If clearing radius (null), don't change zoom - keep current view
    if (miles === null) {
      return;
    }

    // Convert miles to degrees for delta calculation
    // 1 degree latitude ≈ 69 miles
    // We want the radius to fit comfortably on screen, so use diameter with padding
    const radiusMilesValue = miles;
    const diameterMiles = radiusMilesValue * 2;
    const paddingFactor = 1.25; // 25% padding so circle fits comfortably
    const paddedDiameterMiles = diameterMiles * paddingFactor;

    // Convert to degrees (latitude delta)
    const latitudeDelta = paddedDiameterMiles / 69;
    // Longitude delta varies with latitude, but for simplicity use same as lat
    // (This is accurate enough for most locations in the continental US)
    const longitudeDelta = latitudeDelta;

    // Mark as programmatic animation
    isProgrammaticAnimation.current = true;

    const newRegion = {
      latitude: mapCenter.latitude,
      longitude: mapCenter.longitude,
      latitudeDelta,
      longitudeDelta,
    };

    // Animate to the new region centered on current map center
    // Use shorter duration for real-time responsiveness
    mapRef.current?.animateToRegion(newRegion, 200);
  }, [mapCenter.latitude, mapCenter.longitude]);

  // Render big vertical card
  // isSingleCard: true when only 1 farmstand is displayed (uses larger dimensions)
  const renderBigCard = useCallback((farm: ExtendedFarmStand, isSingleCard: boolean = false, rank?: number) => {
    const hoursStatus = getHoursStatus(farm.hoursData, farm.isOpen);
    const isSelected = selectedFarmId === farm.id;
    const isFavorite = favorites.has(farm.id);

    const handleHeartPress = (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // Check if user is a guest
      if (isGuest()) {
        setShowGuestPrompt(true);
        return;
      }

      toggleFavorite(farm.id);
    };

    // Use different dimensions for single card display
    const cardWidth = isSingleCard ? SINGLE_CARD_WIDTH : CARD_WIDTH;
    const imageHeight = isSingleCard ? SINGLE_CARD_IMAGE_HEIGHT : IMAGE_HEIGHT;
    const cardHeight = isSingleCard ? SINGLE_CARD_HEIGHT : CARD_HEIGHT;

    return (
      <Pressable
        key={farm.id}
        onPress={() => handleFarmCardPress(farm)}
        style={[
          styles.card,
          { width: cardWidth, height: cardHeight },
          isSelected && styles.cardSelected,
          isSingleCard && styles.singleCard,
          isTablet && { alignSelf: 'center' as const },
        ]}
      >
        {/* Image Section */}
        <View style={[styles.cardImageContainer, { height: imageHeight }]}>
          <MapFarmCardImage
            imageUri={farm.image}
            style={styles.cardImage}
          />

          {/* Heart/Save Button */}
          <Pressable
            onPress={handleHeartPress}
            style={styles.heartButton}
          >
            <Heart
              size={22}
              color={isFavorite ? '#C94A4A' : '#FFFFFF'}
              fill={isFavorite ? '#C94A4A' : 'transparent'}
              strokeWidth={2}
            />
          </Pressable>

          {/* Open/Closed Badge — driven by operating_status */}
          {(() => {
            const opStatus = farm.operatingStatus ?? 'open';
            const badgeConfig: Record<string, { bg: string; label: string }> = {
              open:               { bg: '#2D5A3D',            label: 'Open Now' },
              temporarily_closed: { bg: 'rgba(180,83,9,0.9)', label: 'Temp. Closed' },
              seasonal:           { bg: 'rgba(29,78,216,0.9)',label: 'Seasonal' },
              permanently_closed: { bg: 'rgba(185,28,28,0.9)',label: 'Perm. Closed' },
            };
            const cfg = badgeConfig[opStatus] ?? badgeConfig['open'];
            return (
              <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                <Text style={styles.statusBadgeText}>{cfg.label}</Text>
              </View>
            );
          })()}

          {/* Distance Pill - only show if anchor location is set */}
          {getDistanceFromAnchor(farm) !== null && (
            <View style={styles.distancePill}>
              <Navigation size={12} color="#2D5A3D" />
              <Text style={styles.distanceText}>
                {getDistanceFromAnchor(farm)} mi
              </Text>
            </View>
          )}
        </View>

        {/* Content Section */}
        <View style={styles.cardContent}>
          {/* Name */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text numberOfLines={1} style={[styles.cardTitle, isSingleCard && styles.singleCardTitle, { flexShrink: 1 }]}>
              {farm.name}
            </Text>
            {farm.goldVerified && <GoldVerifiedRibbon size={14} />}
          </View>
          {isPremiumFarmstand(farm.premiumStatus) && (
            <View style={{ marginTop: 4 }}>
              <PremiumBadge size="small" />
            </View>
          )}

          {/* Categories/Products */}
          <Text numberOfLines={1} style={styles.cardSubtitle}>
            {farm.products.slice(0, 4).join(' • ')}
          </Text>

        </View>
      </Pressable>
    );
  }, [selectedFarmId, handleFarmCardPress, getDistanceFromAnchor, favorites, isGuest, toggleFavorite, isTablet]);

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={OREGON_REGION}
        mapType={mapType}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        rotateEnabled={true}
        onPress={handleMapPress}
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {/* Render pins from stablePins - debounced to avoid native Marker churn on rapid chip taps */}
        {stablePins.map((farm: ExtendedFarmStand) => {
          return (
            <Marker
              key={farm.id}
              identifier={farm.id}
              coordinate={{ latitude: farm.latitude, longitude: farm.longitude }}
              onPress={() => {
                // Use farm.id directly from closure - this ensures correct farmstand is selected
                console.log('[Map] Marker pressed:', farm.id, farm.name);
                // Set both selectedFarmId (for map pin highlight) and pinnedFarmstand (for sheet lock)
                // pinnedFarmstandRef is set synchronously so effects that fire later see it immediately
                pinnedFarmstandRef.current = farm;
                setPinnedFarmstand(farm);
                setSelectedFarmId(farm.id);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                snapToState('expanded');
                isProgrammaticAnimation.current = true;
                mapRef.current?.animateToRegion({
                  latitude: farm.latitude,
                  longitude: farm.longitude,
                  latitudeDelta: 0.15,
                  longitudeDelta: 0.15,
                }, 500);
              }}
              stopPropagation={true}
              tracksViewChanges={false}
            >
              <FarmstandPinMarker />
            </Marker>
          );
        })}
      </MapView>

      {/* Top-right controls: Map/Satellite toggle + Location + Compass stacked vertically */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 74,
          right: 16,
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 10,
        }}
      >
        {/* Map / Satellite toggle */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: 'rgba(255,255,255,0.95)',
            borderRadius: 20,
            padding: 3,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.12,
            shadowRadius: 4,
            elevation: 3,
          }}
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setMapType('standard');
              trackEvent('map_type_changed', { map_type: 'standard' });
            }}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 16,
              backgroundColor: mapType === 'standard' ? '#2D5A3D' : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: mapType === 'standard' ? '#FFFFFF' : '#78716C',
              }}
            >
              Map
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setMapType('satellite');
              trackEvent('map_type_changed', { map_type: 'satellite' });
            }}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 16,
              backgroundColor: mapType === 'satellite' ? '#2D5A3D' : 'transparent',
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: mapType === 'satellite' ? '#FFFFFF' : '#78716C',
              }}
            >
              Satellite
            </Text>
          </Pressable>
        </View>

        {/* My Location Button */}
        <Pressable
          onPress={handleLocateMe}
          disabled={isLocating}
          style={[styles.mapButton, { position: 'relative', right: undefined, top: undefined }]}
        >
          <Navigation2
            size={22}
            color={isLocating ? '#8B6F4E' : '#2D5A3D'}
            fill={isLocating ? 'transparent' : '#2D5A3D'}
          />
        </Pressable>

        {/* Compass Button - only visible when map is rotated */}
        {Math.abs(mapHeading) > 5 && (
          <Pressable
            onPress={handleCompassPress}
            style={[styles.mapButton, { position: 'relative', right: undefined, top: undefined }]}
          >
            <View style={{ transform: [{ rotate: `${-mapHeading}deg` }] }}>
              <Compass size={22} color="#2D5A3D" />
            </View>
          </Pressable>
        )}
      </View>

      {/* Header with Search */}
      <SafeAreaView edges={['top']} style={styles.searchContainer}>
        <View style={[styles.searchBar, isTablet && { marginHorizontal: 40 }]}>
          <Search size={20} color="#8B6F4E" />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search farms, cities, products..."
            placeholderTextColor="#8B6F4E"
            value={searchDraftText}
            onChangeText={(text) => {
              setSearchDraftText(text);
              if (text.trim().length > 0) {
                // Any keystroke owns the context — mark all active Explore params as stale.
                // Use the most specific active nonce (collection > search) so the right guard
                // is set in useFocusEffect.
                const activeNonce = params.collectionNonce ?? params.searchNonce ?? '0';
                paramsStaleRef.current = true;
                userClearedNonceRef.current = activeNonce;
                // Typing clears any active primary context immediately
                if (mapFilter) {
                  setMapFilter(null);
                  if (__DEV__) console.log('[MapContext] typing cleared category chip | nonce:', activeNonce, '| draft:', text.trim().slice(0, 30));
                }
                if (activeCollectionIds !== null) {
                  setActiveCollectionIds(null);
                  setActiveCollectionLabel(null);
                  if (__DEV__) console.log('[MapContext] typing cleared collection chip | label:', activeCollectionLabel, '| nonce:', activeNonce, '| draft:', text.trim().slice(0, 30));
                }
              }
            }}
            returnKeyType="search"
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            onSubmitEditing={() => {
              Keyboard.dismiss();
              setIsSearchFocused(false);
              const trimmed = searchDraftText.trim();
              if (trimmed) trackEvent('map_search_submitted', { query: trimmed, query_length: trimmed.length });

              // Full state reset — new search always fully replaces old search.
              // clearPrimaryMapContext sets paramsStaleRef, userClearedNonceRef, processedParamsRef,
              // processedSearchRef, initialSearchHandledRef, and clears all search/filter state.
              clearPrimaryMapContext('typed-search-submit');
              pinnedFarmstandRef.current = null;
              setPinnedFarmstand(null);
              setSelectedFarmId(null);

              if (!trimmed) {
                setActiveSearchQuery('');
                setMapFilter(null);
                snapToState('collapsed');
                return;
              }

              // Use same category resolution as Explore and chip taps
              const categoryKey = detectCategoryFromQuery(trimmed);
              if (categoryKey) {
                // Category/product search — chip is the sole visual indicator.
                // paramsStaleRef (set by clearPrimaryMapContext above) keeps old Explore params from
                // resurging via useFocusEffect. Never reset userClearedNonceRef here — doing so
                // would re-open the window for a previously cleared Explore chip to reapply.
                setMapFilter({ type: 'category', productTag: categoryKey });
                setActiveSearchQuery('');
                setSearchDraftText('');  // search bar stays empty; chip shows the active filter
                if (__DEV__) {
                  console.log('[MapContext] applying context | type: local_map_category | tag:', categoryKey, '| query:', trimmed);
                }
                snapToState('expanded');
                return;
              }

              // Non-category: text/name/location search
              if (__DEV__) {
                console.log('[MapContext] applying context | type: local_map_text_search | query:', trimmed);
              }
              setMapFilter(null);
              // clearPrimaryMapContext cleared searchDraftText=''; restore it so the bar stays populated
              setSearchDraftText(trimmed);
              setActiveSearchQuery(trimmed);
              snapToState('expanded');
            }}
          />
          {/* Loading indicator while searching */}
          {isSearching && (
            <ActivityIndicator size="small" color="#2D5A3D" style={{ marginRight: 8 }} />
          )}
          {/* Clear button - resets search and map */}
          {searchDraftText.length > 0 && !isSearching && (
            <Pressable
              onPress={() => {
                if (__DEV__) {
                  console.log('[Map] X clear pressed — draft:', searchDraftText,
                    '| active query:', activeSearchQuery,
                    '| route param search:', params.search ?? '(none)',
                    '| nonce:', params.searchNonce ?? '(none)');
                }
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                clearPrimaryMapContext('clear-button');
                snapToState('collapsed');
                pinnedFarmstandRef.current = null;
                setPinnedFarmstand(null);
                setSelectedFarmId(null);
              }}
              style={styles.clearButton}
            >
              <X size={18} color="#8B6F4E" />
            </Pressable>
          )}

          {/* Filter Button */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowFilterModal(true);
              trackEvent('map_filter_opened', { active_filter_count: filterActiveCount });
            }}
            style={[styles.filterButton, filterActiveCount > 0 && styles.filterButtonActive]}
          >
            <SlidersHorizontal size={20} color={filterActiveCount > 0 ? '#FFFFFF' : '#8B6F4E'} />
            {filterActiveCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{filterActiveCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Active Category Filter Chip */}
        {mapFilter && mapFilter.type === 'category' && (
          <View style={styles.filterChipContainer}>
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText}>{CATEGORY_LABELS[mapFilter.productTag] ?? mapFilter.productTag}</Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (__DEV__) {
                    console.log('[MapContext] user cleared category chip | tag:', mapFilter?.productTag, '| nonce:', params.searchNonce ?? '0');
                  }
                  clearPrimaryMapContext('chip-x-pressed');
                  pinnedFarmstandRef.current = null;
                  setPinnedFarmstand(null);
                  setSelectedFarmId(null);
                }}
                style={styles.filterChipClose}
              >
                <X size={14} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}

        {/* Active Collection Chip (e.g. Top Spots For You) */}
        {activeCollectionIds !== null && activeCollectionLabel && (
          <View style={styles.filterChipContainer}>
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText}>{activeCollectionLabel}</Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (__DEV__) console.log('[MapContext] user cleared collection chip | label:', activeCollectionLabel, '| nonce:', params.collectionNonce ?? '0');
                  clearPrimaryMapContext('collection-chip-x');
                  pinnedFarmstandRef.current = null;
                  setPinnedFarmstand(null);
                  setSelectedFarmId(null);
                }}
                style={styles.filterChipClose}
              >
                <X size={14} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>

      {/* FAB and other overlays below */}

      {/* Add Farmstand bubble — independently anchored to left */}
      {!isPinSelected && sheetState === 'collapsed' && (
        <View style={styles.bannerAnchor}>
          <AddFarmstandBanner
            visible={showAddBanner}
            onPress={() => {
              setShowAddBanner(false);
              handleAddFarmstand();
            }}
            onDismiss={() => setShowAddBanner(false)}
          />
        </View>
      )}

      {/* FAB — independently anchored to right */}
      <Pressable
        onPress={handleAddFarmstand}
        style={styles.fab}
      >
        <Plus size={28} color="#FFFFFF" strokeWidth={2.5} />
      </Pressable>

      {/* No Farmstands in View Banner - Show when collapsed and no farmstands visible */}
      {sheetState === 'collapsed' && !isFilterActive && finalVisibleFarmstands.length === 0 && (
        <View style={styles.noFarmstandsBanner}>
          <Text style={styles.noFarmstandsBannerText}>
            Don't see a farmstand here?
          </Text>
          <Pressable
            onPress={handleAddFarmstand}
            style={styles.noFarmstandsBannerButton}
          >
            <Text style={styles.noFarmstandsBannerButtonText}>Add one</Text>
          </Pressable>
        </View>
      )}

      {/* Custom Bottom Sheet */}
      <Animated.View style={[styles.bottomSheet, animatedSheetStyle]}>
        {/* Handle Area - Tappable and Draggable */}
        <GestureDetector gesture={handlePanGesture}>
          <Pressable onPress={handleHandleTap} style={styles.handleArea}>
            <View style={styles.handleBar} />
            <View style={styles.handleContent}>
              {isPinSelected ? (
                // When pin is selected: show farmstand name with close button
                <>
                  <MapPin size={16} color="#2D5A3D" />
                  <Text style={styles.countText} numberOfLines={1}>
                    {pinnedFarmstand?.name ?? 'Loading...'}
                  </Text>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      // Clear pin lock — sheet will return to search results
                      pinnedFarmstandRef.current = null;
                      setPinnedFarmstand(null);
                      setSelectedFarmId(null);
                      // Restore sheet: expanded if search is active, collapsed otherwise
                      if (activeSearchQuery.trim()) {
                        snapToState('expanded');
                      } else {
                        snapToState('collapsed');
                      }
                    }}
                    style={{ marginLeft: 8, padding: 4 }}
                  >
                    <X size={18} color="#8B6F4E" />
                  </Pressable>
                </>
              ) : (
                // Normal mode: show count
                <>
                  <MapPin size={16} color="#2D5A3D" />
                  <Text style={styles.countText}>
                    {isFilterActive
                      ? finalVisibleFarmstands.length === 0
                        ? 'No matches found'
                        : `${finalVisibleFarmstands.length} match${finalVisibleFarmstands.length !== 1 ? 'es' : ''}`
                      : finalVisibleFarmstands.length === 0
                        ? 'No Farmstands in view'
                        : `${finalVisibleFarmstands.length} Farmstand${finalVisibleFarmstands.length !== 1 ? 's' : ''} in view`}
                  </Text>
                </>
              )}
            </View>
          </Pressable>
        </GestureDetector>

        {/* Scrollable Content - ONE FlatList with switched data source */}
        {sheetState === 'expanded' && (isPinSelected || visibleFarmstands.length > 0) ? (
          <GestureDetector gesture={contentPanGesture}>
            <View style={styles.scrollContainer}>
              {(() => {
                // SINGLE SOURCE OF TRUTH: sortedFarmstands is the final sorted array.
                const trayRenderData: ExtendedFarmStand[] = pinnedFarmstand
                  ? [pinnedFarmstand]
                  : [...sortedFarmstands];

                return (
                  <>
                    <FlatList
                      key={`tray-${filterSortBy}`}
                      extraData={filterSortBy}
                      ref={flatListRef}
                      data={trayRenderData}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item, index }) => renderBigCard(item, isPinSelected || trayRenderData.length === 1, isPinSelected ? undefined : index + 1)}
                      contentContainerStyle={styles.sheetContent}
                      showsVerticalScrollIndicator={!isPinSelected && trayRenderData.length > 1}
                      scrollEnabled={!isPinSelected && trayRenderData.length > 1}
                      onScroll={(e) => { scrollOffset.value = e.nativeEvent.contentOffset.y; }}
                      scrollEventThrottle={16}
                      bounces={!isPinSelected && trayRenderData.length > 1}
                      getItemLayout={(_, index) => ({
                        length: CARD_HEIGHT + CARD_SPACING,
                        offset: (CARD_HEIGHT + CARD_SPACING) * index,
                        index,
                      })}
                    />
                  </>
                );
              })()}
            </View>
          </GestureDetector>
        ) : null}

        {/* EMPTY STATE: When NOT isPinSelected, expanded, and no farmstands */}
        {sheetState === 'expanded' && !isPinSelected && visibleFarmstands.length === 0 ? (
          <GestureDetector gesture={contentPanGesture}>
            <View style={styles.scrollContainer}>
              <View style={styles.emptyState}>
                <MapPin size={48} color="#E8DDD4" />
                <Text style={styles.emptyStateTitle}>
                  {activeSearchQuery ? 'No matches found' : 'No farms in this area'}
                </Text>
                <Text style={styles.emptyStateSubtitle}>
                  {activeSearchQuery
                    ? `No farmstands match "${activeSearchQuery.slice(0, 30)}${activeSearchQuery.length > 30 ? '...' : ''}"`
                    : 'Try zooming out or moving the map'}
                </Text>
                {activeSearchQuery ? (
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      clearPrimaryMapContext('empty-state-clear');
                      snapToState('collapsed');
                      pinnedFarmstandRef.current = null;
                      setPinnedFarmstand(null);
                      setSelectedFarmId(null);
                    }}
                    style={styles.emptyStateButton}
                  >
                    <X size={16} color="#FFFFFF" />
                    <Text style={styles.emptyStateButtonText}>Clear Search</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={handleAddFarmstand}
                    style={styles.emptyStateButton}
                  >
                    <Plus size={16} color="#FFFFFF" />
                    <Text style={styles.emptyStateButtonText}>Add a Farmstand</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </GestureDetector>
        ) : null}
      </Animated.View>

      {/* Guest Sign In Prompt Modal */}
      <SignInPromptModal
        visible={showGuestPrompt}
        onClose={() => setShowGuestPrompt(false)}
        action="favorite"
      />

      {/* Map Filter Modal - slider auto-zooms the map in real-time */}
      <MapFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onApply={handleFilterApplyIntent}
        onSliderChange={handleRadiusChangeWithZoom}
        resultCount={finalVisibleFarmstands.length}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FDF8F3',
  },
  searchContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  searchBar: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E8DDD4',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  filterButton: {
    padding: 4,
    marginLeft: 8,
    position: 'relative',
  },
  filterButtonActive: {
    backgroundColor: '#2D5A3D',
    borderRadius: 8,
    padding: 6,
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: '#3D3D3D',
  },
  clearButton: {
    padding: 4,
  },
  mapButton: {
    position: 'absolute',
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E8DDD4',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
    overflow: 'hidden',
  },
  handleArea: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: '#E8DDD4',
    borderRadius: 2,
    marginBottom: 12,
  },
  handleContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  countText: {
    color: '#2D5A3D',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 8,
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  sheetContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginBottom: CARD_SPACING,
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: '#C45C3E',
  },
  cardImageContainer: {
    height: IMAGE_HEIGHT,
    position: 'relative',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  heartButton: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  statusBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  distancePill: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  distanceText: {
    color: '#2D5A3D',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  cardContent: {
    flex: 1,
    padding: 14,
    justifyContent: 'flex-start',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3D3D3D',
  },
  singleCard: {
    marginBottom: 8,
  },
  singleCardTitle: {
    fontSize: 20,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#8B6F4E',
    marginTop: 4,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  hoursText: {
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 6,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateTitle: {
    color: '#8B6F4E',
    fontSize: 18,
    fontWeight: '500',
    marginTop: 16,
  },
  emptyStateSubtitle: {
    color: 'rgba(139, 111, 78, 0.6)',
    fontSize: 14,
    marginTop: 4,
  },
  emptyStateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 20,
  },
  emptyStateButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  ctaRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: COLLAPSED_HEIGHT + 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 999,
    elevation: 10,
  },
  ctaBannerArea: {
    flex: 1,
    alignItems: 'flex-start',
    marginRight: 8,
  },
  bannerContainer: {
    position: 'absolute',
    left: 16,
    right: 80,
    bottom: COLLAPSED_HEIGHT + 16,
    alignItems: 'center',
    zIndex: 20,
    elevation: 20,
  },
  bannerAnchor: {
    position: 'absolute',
    left: 16,
    bottom: COLLAPSED_HEIGHT + 16,
    zIndex: 20,
    elevation: 20,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: COLLAPSED_HEIGHT + 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2D5A3D',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  floatingActionRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: COLLAPSED_HEIGHT + 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
    elevation: 20,
  },
  noFarmstandsBanner: {
    position: 'absolute',
    left: 16,
    right: 80,
    bottom: COLLAPSED_HEIGHT + 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E8DDD4',
  },
  noFarmstandsBannerText: {
    fontSize: 14,
    color: '#3D3D3D',
    flex: 1,
  },
  noFarmstandsBannerButton: {
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  noFarmstandsBannerButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    marginRight: 6,
  },
  filterChipClose: {
    padding: 2,
  },
});
