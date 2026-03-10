import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { View, Text, Pressable, Dimensions, TextInput, Alert, Image, StyleSheet, FlatList, ActivityIndicator, Keyboard } from 'react-native';
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
import { usePromotionsStore } from '@/lib/promotions-store';
import { useSearchStore, isLocationQuery } from '@/lib/search-store';
import { getFarmstandDisplayImage, DEFAULT_PLACEHOLDER_IMAGE } from '@/lib/farmstand-image';
import { farmstandMatchesCategory, CATEGORY_LABELS } from '@/lib/category-filter';
import { SignInPromptModal } from '@/components/SignInPromptModal';
import { MapFilterModal } from '@/components/MapFilterModal';
import { AddFarmstandBanner, shouldShowAddFarmstandBanner } from '@/components/AddFarmstandBanner';
import { GoldVerifiedRibbon } from '@/components/GoldVerifiedRibbon';
import { logMapOpen } from '@/lib/analytics-events';
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

// Big card dimensions for vertical scroll
const CARD_WIDTH = SCREEN_WIDTH - 32;
const IMAGE_HEIGHT = CARD_WIDTH; // Square images - as tall as wide
const CARD_HEIGHT = IMAGE_HEIGHT + 100; // Image + content section
const CARD_SPACING = 16;

// Single card dimensions (slightly larger for featured display)
const SINGLE_CARD_WIDTH = SCREEN_WIDTH - 24;
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
  isPending?: boolean; // True if status='pending'
  goldVerified?: boolean; // Gold verified status
  mainProduct?: string | null; // Main product for category filtering
}

// Helper to get hours status text
const getHoursStatus = (hours: HoursSchedule | null | undefined, isOpen: boolean): { text: string; isOpenNow: boolean } => {
  if (!hours) {
    return { text: isOpen ? 'Hours vary' : 'Closed', isOpenNow: isOpen };
  }

  const now = new Date();
  const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()] as keyof Omit<HoursSchedule, 'timezone' | 'exceptions'>;
  const todayHours = hours[dayOfWeek];

  if (todayHours.closed || !todayHours.open || !todayHours.close) {
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
  }>();
  const mapRef = useRef<MapView>(null);
  const flatListRef = useRef<FlatList<ExtendedFarmStand>>(null);
  // Separate draft text (what user types) from active query (what we filter on)
  // This prevents map updates from resetting the input while typing
  const [searchDraftText, setSearchDraftText] = useState(params.search ?? '');
  const [activeSearchQuery, setActiveSearchQuery] = useState(params.search ?? '');
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
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
  const processedParamsRef = useRef<string | null>(
    params.mapFilterType && params.mapFilterProductTag
      ? `${params.mapFilterType}-${params.mapFilterProductTag}`
      : null
  );

  // Track if initial search navigation has been handled
  const initialSearchHandledRef = useRef(false);

  // Safe area insets for expanded height calculation
  const insets = useSafeAreaInsets();

  // Maximum expanded height: screen height minus top safe area minus 80px padding
  // This ensures the sheet stops well below the status bar, leaving map visible
  const MAX_EXPANDED_HEIGHT = SCREEN_HEIGHT - insets.top - 80;

  // Shared value for max height (needed for worklet access in useAnimatedStyle)
  // Will be updated dynamically based on content
  const maxExpandedHeight = useSharedValue(MAX_EXPANDED_HEIGHT);

  // Guest prompt modal state
  const [showGuestPrompt, setShowGuestPrompt] = useState(false);

  // Filter modal state
  const [showFilterModal, setShowFilterModal] = useState(false);
  // Note: Radius is now only used to ZOOM the map, not as a hard filter
  // The map always shows farmstands within visible bounds (Airbnb-style)
  // Store map center separately for zoom calculations (updated on region change complete)
  const [mapCenter, setMapCenter] = useState<{ latitude: number; longitude: number }>({
    latitude: OREGON_REGION.latitude,
    longitude: OREGON_REGION.longitude,
  });

  // Bottom sheet state - TWO STATES ONLY: collapsed (72px) or expanded
  const [sheetState, setSheetState] = useState<SheetState>('collapsed');
  const scrollOffset = useRef(0);
  const sheetHeight = useSharedValue(COLLAPSED_HEIGHT);
  const startY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  // Search input focus state - controls sheet behavior during typing
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  // Track the sheet state before search focus to restore it after
  const preSearchSheetState = useRef<SheetState>('collapsed');

  // First-time user tip state
  const [showFirstTimeTip, setShowFirstTimeTip] = useState(false);
  const FIRST_TIME_TIP_KEY = 'farmstand_map_first_time_tip_dismissed';

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

  // Load admin data on mount and when returning to this screen
  useFocusEffect(
    useCallback(() => {
      loadAdminData();
      loadPromotionsData();
      logMapOpen(user?.id);

      // Only apply route params if they are NEW (not already processed)
      // This prevents stale params from rehydrating after user cleared the filter
      if (params.mapFilterType && params.mapFilterProductTag) {
        const paramsKey = `${params.mapFilterType}-${params.mapFilterProductTag}`;
        if (processedParamsRef.current !== paramsKey) {
          // Fresh params from a new Explore chip tap - apply them
          processedParamsRef.current = paramsKey;
          setMapFilter({ type: params.mapFilterType, productTag: params.mapFilterProductTag });
          // NOTE: Do NOT clear selectedFarmId here - selection should persist
        }
        // If paramsKey matches processedParamsRef, it's stale - ignore
      }

      // When returning to Map with no active search params, restore default pins
      // This handles the case of returning from a farmstand detail page
      // NOTE: Only clear if there's an active search query (not while user is typing)
      if (!params.search && !params.mapFilterType) {
        // Clear search state if it was active
        if (activeSearchQuery) {
          setSearchDraftText('');
          setActiveSearchQuery('');
          clearSearch();
        }
        // Clear mapFilter if it was set
        if (mapFilter) {
          setMapFilter(null);
        }
        // NOTE: Do NOT clear selectedFarmId here - selection should only clear on explicit user action
        // Reset processed params refs
        processedParamsRef.current = null;
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
    }, [loadAdminData, params.mapFilterType, params.mapFilterProductTag, params.search, mapFilter, clearSearch])
  );

  // Check if first-time tip should be shown
  useEffect(() => {
    const checkFirstTimeTip = async () => {
      try {
        const dismissed = await AsyncStorage.getItem(FIRST_TIME_TIP_KEY);
        if (!dismissed) {
          // Show tip after a short delay
          console.log('[Map] First-time tip not dismissed — showing after 1s delay');
          setTimeout(() => setShowFirstTimeTip(true), 1000);
        } else {
          console.log('[Map] First-time tip already dismissed — showing normal FAB only');
        }
      } catch (error) {
        console.log('Error checking first-time tip:', error);
      }
    };
    checkFirstTimeTip();
  }, []);

  // Dismiss first-time tip permanently
  const dismissFirstTimeTip = useCallback(async () => {
    setShowFirstTimeTip(false);
    try {
      await AsyncStorage.setItem(FIRST_TIME_TIP_KEY, 'true');
    } catch (error) {
      console.log('Error saving first-time tip dismissal:', error);
    }
  }, []);

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
        // Show both pending and active farmstands
        if (f.status !== 'active' && f.status !== 'pending') {
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
          reviewCount: 0,
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
          // Gold verified status
          goldVerified: f.goldVerified,
          // Main product for category filtering
          mainProduct: f.mainProduct,
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
      AsyncStorage.setItem(FARMSTANDS_CACHE_KEY, JSON.stringify(allFarmStands)).catch((e) => {
        console.log('[Map] Failed to cache farmstands:', e);
      });
    }
  }, [allFarmStands]);

  // Filter farms based on search query using search store results
  // When Supabase search is active, use those results; otherwise fall back to local filtering
  const searchFilteredFarms = useMemo(() => {
    // If no active search query, return all farms (using baseFarmstands for instant rendering)
    if (!activeSearchQuery.trim()) return baseFarmstands;

    // PRIORITY 1: If matchedFarmstandIds param is present (name search from Explore), use those directly
    if (params.matchedFarmstandIds && params.searchType === 'name') {
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

    // PRIORITY 2: If single matchedFarmstandId param (legacy name search), use that
    if (params.matchedFarmstandId && params.searchType === 'name') {
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
  }, [activeSearchQuery, baseFarmstands, isSearchActive, searchResults, params.matchedFarmstandIds, params.matchedFarmstandId, params.searchType]);

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

      if (matches) {
        console.log('[MapFilter] INCLUDED:', farm.name, '- mainProduct:', farm.mainProduct, '- products:', farm.products?.slice(0, 3));
      }

      return matches;
    });

    console.log('[MapFilter] Category:', categoryKey, '- Filtered count:', filtered.length, '/', searchFilteredFarms.length);
    return filtered;
  }, [searchFilteredFarms, mapFilter]);

  // Farms visible in the current viewport
  // Uses visibleRegion which updates on every pan/zoom
  // This ensures pins always match what's visible on the map
  const viewportFarms = useMemo(() => {
    return mapFilteredFarms.filter((farm) => isFarmInViewport(farm, visibleRegion));
  }, [mapFilteredFarms, visibleRegion]);

  // Sort viewport farms using weighted rotation: boosted first (with daily rotation), then by popularity, then by distance
  const sortedViewportFarms = useMemo(() => {
    const centerLat = visibleRegion.latitude;
    const centerLng = visibleRegion.longitude;

    // Generate daily seed for rotation (same seed throughout the day)
    const today = new Date().toISOString().split('T')[0];
    const seedString = `${today}-map_boost`;
    let seed = 0;
    for (let i = 0; i < seedString.length; i++) {
      seed = ((seed << 5) - seed) + seedString.charCodeAt(i);
      seed = seed & seed;
    }
    seed = Math.abs(seed);

    // Seeded random for consistent daily rotation
    const seededRandom = (s: number): number => {
      const x = Math.sin(s) * 10000;
      return x - Math.floor(x);
    };

    // Separate boosted and non-boosted farms
    const boostedFarms = viewportFarms.filter(f => f.promoMapBoost && f.promoActive);
    const nonBoostedFarms = viewportFarms.filter(f => !(f.promoMapBoost && f.promoActive));

    // Apply weighted rotation selection to boosted farms
    const sortedBoosted = [...boostedFarms].map(farm => {
      // Generate unique seed per farm
      let farmSeed = seed;
      for (let i = 0; i < farm.id.length; i++) {
        farmSeed += farm.id.charCodeAt(i) * (i + 1);
      }
      const randomFactor = seededRandom(farmSeed);

      // Selection score: priority * 100 + rotationWeight * randomFactor * 250
      const priority = farm.promoPriority ?? 50;
      const weight = farm.promoRotationWeight ?? 1;
      const selectionScore = (priority * 100) + (weight * randomFactor * 250);

      return { farm, selectionScore, priority };
    })
    .sort((a, b) => {
      // Sort by selection score first
      if (Math.abs(b.selectionScore - a.selectionScore) > 0.001) {
        return b.selectionScore - a.selectionScore;
      }
      // Tie-breaker by ID
      return a.farm.id.localeCompare(b.farm.id);
    })
    // Final sort by priority for display order
    .sort((a, b) => b.priority - a.priority)
    .map(item => item.farm);

    // Sort non-boosted by popularity, then distance
    const sortedNonBoosted = [...nonBoostedFarms].sort((a, b) => {
      const popularityDiff = (b.popularityScore || 0) - (a.popularityScore || 0);
      if (popularityDiff !== 0) return popularityDiff;

      const distA = calculateDistance(centerLat, centerLng, a.latitude, a.longitude);
      const distB = calculateDistance(centerLat, centerLng, b.latitude, b.longitude);
      return distA - distB;
    });

    return [...sortedBoosted, ...sortedNonBoosted];
  }, [viewportFarms, visibleRegion.latitude, visibleRegion.longitude]);

  // Determine if a filter/search is active (should show ALL matches, not just viewport)
  const isFilterActive = useMemo(() => {
    return !!(activeSearchQuery.trim() || mapFilter);
  }, [activeSearchQuery, mapFilter]);

  // Single source of truth for map results (used by both markers and cards)
  // When filter is active: show ALL matching farmstands sorted by distance
  // When no filter: show farmstands in the visible viewport
  const mapResults = useMemo(() => {
    if (!isFilterActive) {
      // No filter active - use viewport farms
      return sortedViewportFarms;
    }

    // Filter is active - show ALL matching farms sorted by distance from anchor/center
    const centerLat = anchorLocation?.latitude ?? visibleRegion.latitude;
    const centerLng = anchorLocation?.longitude ?? visibleRegion.longitude;

    return [...mapFilteredFarms].sort((a, b) => {
      const distA = calculateDistance(centerLat, centerLng, a.latitude, a.longitude);
      const distB = calculateDistance(centerLat, centerLng, b.latitude, b.longitude);
      return distA - distB;
    });
  }, [isFilterActive, sortedViewportFarms, mapFilteredFarms, anchorLocation, visibleRegion]);

  // Count of pins currently visible on map
  // This must match EXACTLY what's being rendered as pins (mapResults)
  // and filter by the current visibleRegion for accurate "in view" count
  const currentlyVisiblePinsCount = useMemo(() => {
    // Count how many pins from mapResults are in the current visible region
    return mapResults.filter((farm) => isFarmInViewport(farm, visibleRegion)).length;
  }, [mapResults, visibleRegion]);

  // Compute selectedFarmstand from master list (baseFarmstands - uses fresh OR cached)
  // This is separate from displayedFarms to enable strict render priority
  const selectedFarmstand = useMemo(() => {
    if (!selectedFarmId) return null;
    // Look up in baseFarmstands which includes cached data for instant availability
    return baseFarmstands.find((farm) => farm.id === selectedFarmId) ?? null;
  }, [selectedFarmId, baseFarmstands]);

  // GUARD: Single boolean to control ALL card rendering
  // Based ONLY on selectedFarmId - do NOT tie to visibleFarmstands or selectedFarmstand lookup
  // This ensures selection remains stable even if baseFarmstands is still loading
  const isPinSelected = Boolean(selectedFarmId);

  // Farms to display in bottom sheet when NO pin is selected
  // This is the normal viewport/filtered list
  const visibleFarmstands = mapResults;

  // Pins to show on map - when filter/search is active, show only filtered results
  // When no filter, show all farmstands for instant visibility
  const pinsToShow = useMemo(() => {
    if (isFilterActive) {
      // Filter active - show only matching farmstands
      return mapResults;
    }
    // No filter - show all farmstands for instant pin rendering
    return baseFarmstands;
  }, [isFilterActive, mapResults, baseFarmstands]);

  // Calculate content-aware expanded height based on what will be shown
  const EXPANDED_HEIGHT = useMemo(() => {
    // If a pin is selected, we show 1 card
    const farmCount = selectedFarmstand ? 1 : visibleFarmstands.length;

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
  }, [selectedFarmstand, visibleFarmstands.length, MAX_EXPANDED_HEIGHT]);

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
  }, [searchFilteredFarms.length, activeSearchQuery, snapToState, isSearchFocused]);

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

  // Handle initial search navigation from Explore (runs once when search params are present)
  useEffect(() => {
    // Skip if already handled or no search params
    if (initialSearchHandledRef.current) return;
    if (!params.search || baseFarmstands.length === 0) return;

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
      if (scrollOffset.current <= 0 && event.translationY > 0) {
        const newHeight = startY.value - event.translationY;
        sheetHeight.value = Math.max(COLLAPSED_HEIGHT, Math.min(maxExpandedHeight.value, newHeight));
      }
    })
    .onEnd((event) => {
      if (scrollOffset.current <= 0 && event.translationY > 50) {
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
    router.push(`/farm/${farm.id}`);
  }, [router]);

  const handleMapPress = useCallback(() => {
    // Dismiss keyboard when tapping on the map (keep search results unchanged)
    Keyboard.dismiss();

    // Clear selection
    if (selectedFarmId) {
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

  const handleRegionChangeComplete = useCallback((region: Region) => {
    // Always update visible region - render priority handles the flash issue
    setVisibleRegion(region);
    // Update map center for radius calculations
    setMapCenter({ latitude: region.latitude, longitude: region.longitude });

    // Auto-deselect on meaningful pan/zoom (skip if programmatic animation)
    if (!isProgrammaticAnimation.current && selectedFarmId) {
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
  const renderBigCard = useCallback((farm: ExtendedFarmStand, isSingleCard: boolean = false) => {
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
        ]}
      >
        {/* Image Section */}
        <View style={[styles.cardImageContainer, { height: imageHeight }]}>
          <Image
            source={{ uri: farm.image || DEFAULT_PLACEHOLDER_IMAGE }}
            style={styles.cardImage}
            resizeMode="cover"
          />

          {/* Heart/Save Button */}
          <Pressable
            onPress={handleHeartPress}
            style={styles.heartButton}
          >
            <Heart
              size={20}
              color={isFavorite ? '#C45C3E' : '#5C4033'}
              fill={isFavorite ? '#C45C3E' : 'transparent'}
            />
          </Pressable>

          {/* Open/Closed Badge */}
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: hoursStatus.isOpenNow ? '#2D5A3D' : 'rgba(60,60,60,0.85)' },
            ]}
          >
            <Text style={styles.statusBadgeText}>
              {hoursStatus.isOpenNow ? 'Open Now' : 'Closed'}
            </Text>
          </View>

          {/* Pending Approval Badge */}
          {farm.isPending && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>Pending Approval</Text>
            </View>
          )}

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

          {/* Categories/Products */}
          <Text numberOfLines={1} style={styles.cardSubtitle}>
            {farm.products.slice(0, 4).join(' • ')}
          </Text>

          {/* Hours Status */}
          <View style={styles.hoursRow}>
            <Clock size={14} color={hoursStatus.isOpenNow ? '#2D5A3D' : '#8B6F4E'} />
            <Text
              numberOfLines={1}
              style={[
                styles.hoursText,
                { color: hoursStatus.isOpenNow ? '#2D5A3D' : '#8B6F4E' },
              ]}
            >
              {hoursStatus.text}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }, [selectedFarmId, handleFarmCardPress, getDistanceFromAnchor, favorites, isGuest, toggleFavorite]);

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={OREGON_REGION}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        rotateEnabled={true}
        onPress={handleMapPress}
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {/* Render pins from pinsToShow - filtered when search/filter active, all when not */}
        {pinsToShow.map((farm: ExtendedFarmStand) => {
          return (
            <Marker
              key={farm.id}
              identifier={farm.id}
              coordinate={{ latitude: farm.latitude, longitude: farm.longitude }}
              onPress={() => {
                // Use farm.id directly from closure - this ensures correct farmstand is selected
                console.log('[Map] Marker pressed:', farm.id, farm.name);
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

      {/* Header with Search */}
      <SafeAreaView edges={['top']} style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={20} color="#8B6F4E" />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search farms, cities, products..."
            placeholderTextColor="#8B6F4E"
            value={searchDraftText}
            onChangeText={setSearchDraftText}
            returnKeyType="search"
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            onSubmitEditing={() => {
              Keyboard.dismiss();
              setIsSearchFocused(false);
              // Apply the search when user submits
              const trimmed = searchDraftText.trim();
              setActiveSearchQuery(trimmed);
              // Clear any selected pin when starting a new search
              setSelectedFarmId(null);
              // Expand sheet to show results after search submission
              if (trimmed && searchFilteredFarms.length > 0) {
                snapToState('expanded');
              }
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
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                // Clear both draft text and active query
                setSearchDraftText('');
                setActiveSearchQuery('');
                clearSearch();
                // Clear any mapFilter as well
                setMapFilter(null);
                // Reset processed params so stale params don't rehydrate
                processedParamsRef.current = null;
                initialSearchHandledRef.current = false;
                // Collapse bottom sheet
                snapToState('collapsed');
                // Clear selected farm
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
            }}
            style={styles.filterButton}
          >
            <SlidersHorizontal size={20} color="#8B6F4E" />
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
                  setMapFilter(null);
                  // Clear any selected pin when clearing the filter
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

      {/* My Location Button */}
      <Pressable
        onPress={handleLocateMe}
        disabled={isLocating}
        style={[styles.mapButton, { top: 120 }]}
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
          style={[styles.mapButton, { top: 175 }]}
        >
          <View style={{ transform: [{ rotate: `${-mapHeading}deg` }] }}>
            <Compass size={22} color="#2D5A3D" />
          </View>
        </Pressable>
      )}

      {/* Floating Action Button - Add Farmstand (hidden when first-time tip is showing) */}
      {!showFirstTimeTip && (
      <Pressable
        onPress={handleAddFarmstand}
        style={styles.fab}
      >
        <Plus size={28} color="#FFFFFF" strokeWidth={2.5} />
      </Pressable>
      )}

      {/* Add Farmstand Reminder Banner - only when map is idle (no selected stand, sheet collapsed) */}
      {!showFirstTimeTip && !isPinSelected && sheetState === 'collapsed' && (
        <AddFarmstandBanner
          visible={showAddBanner}
          onPress={() => {
            setShowAddBanner(false);
            handleAddFarmstand();
          }}
          onDismiss={() => setShowAddBanner(false)}
          bottomOffset={COLLAPSED_HEIGHT + 16}
        />
      )}

      {/* First-Time User Tip Banner */}
      {showFirstTimeTip && (
        <View style={styles.firstTimeTip}>
          <View style={styles.firstTimeTipContent}>
            <Text style={styles.firstTimeTipText}>
              Help grow Farmstand by adding local farmstands you know.
            </Text>
            <Pressable
              onPress={() => {
                dismissFirstTimeTip();
                handleAddFarmstand();
              }}
              style={styles.firstTimeTipButton}
            >
              <Text style={styles.firstTimeTipButtonText}>Add a Farmstand</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={dismissFirstTimeTip}
            style={styles.firstTimeTipDismiss}
          >
            <X size={18} color="#8B6F4E" />
          </Pressable>
        </View>
      )}

      {/* No Farmstands in View Banner - Show when collapsed and no farmstands visible */}
      {!showFirstTimeTip && sheetState === 'collapsed' && !isFilterActive && currentlyVisiblePinsCount === 0 && (
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
                    {selectedFarmstand?.name ?? 'Loading...'}
                  </Text>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedFarmId(null);
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
                      ? mapResults.length === 0
                        ? 'No matches found'
                        : `${mapResults.length} match${mapResults.length !== 1 ? 'es' : ''}`
                      : currentlyVisiblePinsCount === 0
                        ? 'No Farmstands in view'
                        : `${currentlyVisiblePinsCount} Farmstand${currentlyVisiblePinsCount !== 1 ? 's' : ''} in view`}
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
              <FlatList
                ref={flatListRef}
                // KEY FIX: Switch data source - selected item ONLY when pin selected, otherwise full list
                // Filter out null in case selectedFarmstand hasn't loaded yet
                data={isPinSelected && selectedFarmstand ? [selectedFarmstand] : (isPinSelected ? [] : visibleFarmstands)}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => renderBigCard(item, isPinSelected || visibleFarmstands.length === 1)}
                contentContainerStyle={styles.sheetContent}
                showsVerticalScrollIndicator={!isPinSelected && visibleFarmstands.length > 1}
                scrollEnabled={!isPinSelected && visibleFarmstands.length > 1}
                onScroll={(e) => { scrollOffset.current = e.nativeEvent.contentOffset.y; }}
                scrollEventThrottle={16}
                bounces={!isPinSelected && visibleFarmstands.length > 1}
                getItemLayout={(_, index) => ({
                  length: CARD_HEIGHT + CARD_SPACING,
                  offset: (CARD_HEIGHT + CARD_SPACING) * index,
                  index,
                })}
              />
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
                      setSearchDraftText('');
                      setActiveSearchQuery('');
                      clearSearch();
                      setMapFilter(null);
                      processedParamsRef.current = null;
                      initialSearchHandledRef.current = false;
                      snapToState('collapsed');
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
        radiusMiles={null}
        onRadiusMilesChange={() => {}}
        onSliderChange={handleRadiusChangeWithZoom}
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
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  heartButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
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
  pendingBadge: {
    position: 'absolute',
    top: 12,
    right: 50,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  pendingBadgeText: {
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
    justifyContent: 'space-between',
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
    elevation: 8,
  },
  firstTimeTip: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: COLLAPSED_HEIGHT + 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E8DDD4',
  },
  firstTimeTipContent: {
    flex: 1,
    marginRight: 12,
  },
  firstTimeTipText: {
    fontSize: 14,
    color: '#3D3D3D',
    lineHeight: 20,
    marginBottom: 12,
  },
  firstTimeTipButton: {
    backgroundColor: '#2D5A3D',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  firstTimeTipButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  firstTimeTipDismiss: {
    padding: 4,
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
