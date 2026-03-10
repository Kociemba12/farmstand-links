import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Search,
  X,
  Heart,
  MapPin,
  ChevronRight,
  Navigation,
  WifiOff,
} from 'lucide-react-native';
import Animated, {
  FadeInDown,
  FadeInRight,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';

import { useFavoritesStore } from '@/lib/favorites-store';
import { useAdminStore } from '@/lib/admin-store';
import { useExploreStore } from '@/lib/explore-store';
import { useUserStore } from '@/lib/user-store';
import { useLocationStore } from '@/lib/location-store';
import { usePromotionsStore } from '@/lib/promotions-store';
import { Farmstand } from '@/lib/farmer-store';
import { getFarmstandDisplayImage } from '@/lib/farmstand-image';
import { LocationPermissionModal } from '@/components/LocationPermissionModal';
import { LocationBanner } from '@/components/LocationBanner';
import { GoldVerifiedRibbon } from '@/components/GoldVerifiedRibbon';
import { logSearch, logProductChipTap, logScreenView, logExploreOpen } from '@/lib/analytics-events';
import { useFocusEffect } from '@react-navigation/native';
import { classifySearchQuery, findFarmstandsByName, SearchContext } from '@/lib/search-store';
import { CATEGORY_LABELS } from '@/lib/category-filter';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.72;
const TILE_WIDTH = SCREEN_WIDTH * 0.3; // 30% of screen width for square category tiles
const SMALL_CARD_WIDTH = SCREEN_WIDTH * 0.44;

// Calculate distance
const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Smart radius thresholds
const RADIUS_TIERS = [25, 50, 100] as const;
const MIN_RESULTS = 8;

// Smart radius filter: expands radius (25 → 50 → 100 mi) until we get enough results
// Returns { farmstands, activeRadius } sorted by distance
interface SmartRadiusResult {
  farmstands: Farmstand[];
  activeRadius: number;
}

const filterBySmartRadius = (
  farmstands: Farmstand[],
  anchorLocation: { latitude: number; longitude: number } | null,
  maxResults: number = 10
): SmartRadiusResult => {
  // No anchor location = return all sorted by some default (no radius display)
  if (!anchorLocation) {
    return { farmstands: farmstands.slice(0, maxResults), activeRadius: 0 };
  }

  // Calculate distance for each farmstand
  const withDistance = farmstands.map((f) => ({
    farmstand: f,
    distance: calculateDistance(
      anchorLocation.latitude,
      anchorLocation.longitude,
      f.latitude ?? 0,
      f.longitude ?? 0
    ),
  }));

  // Sort by distance ascending (closest first)
  withDistance.sort((a, b) => a.distance - b.distance);

  // Try each radius tier until we get enough results
  for (const radius of RADIUS_TIERS) {
    const filtered = withDistance.filter((item) => item.distance <= radius);
    if (filtered.length >= MIN_RESULTS || radius === RADIUS_TIERS[RADIUS_TIERS.length - 1]) {
      // Either we have enough results, or we're at max radius
      return {
        farmstands: filtered.slice(0, maxResults).map((item) => item.farmstand),
        activeRadius: radius,
      };
    }
  }

  // Fallback (shouldn't reach here)
  return {
    farmstands: withDistance.slice(0, maxResults).map((item) => item.farmstand),
    activeRadius: RADIUS_TIERS[RADIUS_TIERS.length - 1],
  };
};

// Skeleton pulse component for loading state
function SkeletonCard({ width, height }: { width: number; height: number }) {
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    const pulse = () => {
      opacity.value = withTiming(1, { duration: 800 }, () => {
        opacity.value = withTiming(0.4, { duration: 800 }, pulse);
      });
    };
    pulse();
  }, [opacity]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        animStyle,
        { width, height, borderRadius: 16, backgroundColor: '#E8DDD4', marginRight: 16 },
      ]}
    />
  );
}

function SkeletonSection({ variant = 'large' }: { variant?: 'large' | 'small' }) {
  const cardWidth = variant === 'large' ? CARD_WIDTH : SMALL_CARD_WIDTH;
  return (
    <View style={{ marginTop: 24 }}>
      {/* Section header skeleton */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
        <View style={{ width: 140, height: 20, borderRadius: 8, backgroundColor: '#E8DDD4' }} />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        scrollEnabled={false}
      >
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} width={cardWidth} height={cardWidth} />
        ))}
      </ScrollView>
    </View>
  );
}

// Trending Category Tile Component
interface TrendingTileProps {
  category: string;
  label: string;
  image: string;
  count: number;
  onPress: () => void;
  index: number;
}

function TrendingTile({ category, label, image, count, onPress, index }: TrendingTileProps) {
  return (
    <Animated.View entering={FadeInRight.delay(index * 80).duration(400)}>
      <Pressable
        onPress={onPress}
        className="mr-3 overflow-hidden rounded-2xl"
        style={{ width: TILE_WIDTH, height: TILE_WIDTH, backgroundColor: '#E8DDD4' }}
      >
        <ExpoImage
          source={{ uri: image }}
          style={{ width: TILE_WIDTH, height: TILE_WIDTH, position: 'absolute' }}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={300}
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.75)']}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '65%',
          }}
        />
        <View className="absolute bottom-0 left-0 p-2.5">
          <Text className="text-white font-bold text-sm" numberOfLines={2}>
            {label}
          </Text>
          <Text className="text-white/80 text-xs mt-0.5">{count} stands</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Farmstand Card Component for carousels
interface FarmstandCardProps {
  farmstand: Farmstand;
  userLocation: { latitude: number; longitude: number } | null;
  onPress: () => void;
  onFavoritePress: () => void;
  isFavorite: boolean;
  index: number;
  variant?: 'large' | 'small';
  overrideImageUrl?: string; // Use pre-computed deduplicated image URL
}

function FarmstandCard({
  farmstand,
  userLocation,
  onPress,
  onFavoritePress,
  isFavorite,
  index,
  variant = 'large',
  overrideImageUrl,
}: FarmstandCardProps) {
  const heartScale = useSharedValue(1);

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const handleFavoritePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    heartScale.value = withSpring(1.3, { damping: 10 }, () => {
      heartScale.value = withSpring(1, { damping: 10 });
    });
    onFavoritePress();
  };

  const distance = userLocation
    ? calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        farmstand.latitude ?? 0,
        farmstand.longitude ?? 0
      )
    : null;

  const imageUrl = overrideImageUrl ?? getFarmstandDisplayImage({
    id: farmstand.id,
    hero_image_url: farmstand.heroImageUrl,
    ai_image_url: farmstand.aiImageUrl,
    main_product: farmstand.mainProduct,
    offerings: farmstand.offerings,
    categories: farmstand.categories,
  }).url;

  const cardWidth = variant === 'large' ? CARD_WIDTH : SMALL_CARD_WIDTH;
  // Square cards (1:1 aspect ratio) - height matches width
  const cardHeight = cardWidth;

  return (
    <Animated.View entering={FadeInRight.delay(index * 100).duration(400)}>
      <Pressable
        onPress={onPress}
        style={{ width: cardWidth, marginRight: 16, marginBottom: 4 }}
      >
        {/* Floating Image Card with Shadow */}
        <View
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            backgroundColor: '#E8DDD4',
            shadowColor: 'rgba(0, 0, 0, 1)',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.06,
            shadowRadius: 4,
            elevation: 2,
          }}
        >
          <ExpoImage
            source={{ uri: imageUrl }}
            style={{ width: cardWidth, height: cardHeight }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={250}
          />
          {/* Heart button */}
          <Pressable
            onPress={handleFavoritePress}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.35,
              shadowRadius: 3,
              elevation: 4,
            }}
            hitSlop={12}
          >
            <Animated.View style={heartAnimatedStyle}>
              <Heart
                size={26}
                color="#FFFFFF"
                fill={isFavorite ? '#4A7C59' : 'transparent'}
                strokeWidth={2}
              />
            </Animated.View>
          </Pressable>
        </View>

        {/* Unboxed Text Area - No background, no border, transparent */}
        <View style={{ paddingTop: 10, paddingHorizontal: 2 }}>
          <View className="flex-row items-start justify-between">
            <View className="flex-row items-center flex-1 mr-2">
              <Text
                className="text-charcoal font-bold"
                style={{ fontSize: 16, flexShrink: 1 }}
                numberOfLines={1}
              >
                {farmstand.name}
              </Text>
              {farmstand.goldVerified && <GoldVerifiedRibbon size={14} />}
            </View>
            <View className="flex-row items-center bg-forest/10 px-2 py-0.5 rounded-md">
              <Text className="text-forest text-xs font-semibold">New</Text>
            </View>
          </View>

          {/* Categories */}
          <Text className="text-wood text-xs mt-1" style={{ opacity: 0.7 }} numberOfLines={1}>
            {farmstand.offerings.slice(0, 3).join(' • ')}
          </Text>

          {/* Distance and location */}
          <View className="flex-row items-center mt-1.5">
            {distance !== null && (
              <View className="flex-row items-center mr-3">
                <Navigation size={11} color="#2D5A3D" />
                <Text className="text-forest text-xs font-medium ml-1">
                  {distance < 10 ? distance.toFixed(1) : Math.round(distance)} mi
                </Text>
              </View>
            )}
            <View className="flex-row items-center flex-1">
              <MapPin size={11} color="#8B6F4E" />
              <Text className="text-wood text-xs ml-1" style={{ opacity: 0.7 }} numberOfLines={1}>
                {farmstand.city ?? 'Oregon'}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Section Header Component
interface SectionHeaderProps {
  title: string;
  onShowAll?: () => void;
  showAllLabel?: string;
  radiusMiles?: number; // Active radius to display (0 = don't show)
}

function SectionHeader({ title, onShowAll, showAllLabel = 'Show all', radiusMiles }: SectionHeaderProps) {
  return (
    <View className="flex-row items-center justify-between px-5 mb-3">
      <View className="flex-row items-center flex-1">
        <Text className="text-charcoal font-bold text-lg">{title}</Text>
        {radiusMiles !== undefined && radiusMiles > 0 ? (
          <Text className="text-wood/60 font-medium text-sm ml-2">
            · within {radiusMiles} mi
          </Text>
        ) : null}
      </View>
      {onShowAll ? (
        <Pressable onPress={onShowAll} className="flex-row items-center">
          <Text className="text-forest font-medium text-sm">{showAllLabel}</Text>
          <ChevronRight size={16} color="#2D5A3D" />
        </Pressable>
      ) : null}
    </View>
  );
}

// Top Spots Carousel with image deduplication - prevents duplicate images for adjacent cards
interface TopSpotsCarouselProps {
  farmstands: Farmstand[];
  anchorLocation: { latitude: number; longitude: number } | null;
  favorites: Set<string>;
  onFarmstandPress: (farmstand: Farmstand) => void;
  onToggleFavorite: (id: string) => void;
}

function TopSpotsCarousel({
  farmstands,
  anchorLocation,
  favorites,
  onFarmstandPress,
  onToggleFavorite,
}: TopSpotsCarouselProps) {
  // Get images for all farmstands using unified helper
  const farmstandImages = useMemo(() => {
    const images = new Map<string, { url: string; isAIGenerated: boolean }>();
    for (const f of farmstands) {
      const result = getFarmstandDisplayImage({
        id: f.id,
        hero_image_url: f.heroImageUrl,
        ai_image_url: f.aiImageUrl,
        main_product: f.mainProduct,
        offerings: f.offerings,
        categories: f.categories,
      });
      images.set(f.id, { url: result.url, isAIGenerated: result.isAI });
    }
    return images;
  }, [farmstands]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      nestedScrollEnabled={true}
      contentContainerStyle={{ paddingHorizontal: 20 }}
      style={{ flexGrow: 0 }}
    >
      {farmstands.map((farmstand, index) => {
        const imageData = farmstandImages.get(farmstand.id);
        return (
          <FarmstandCard
            key={farmstand.id}
            farmstand={farmstand}
            userLocation={anchorLocation}
            onPress={() => onFarmstandPress(farmstand)}
            onFavoritePress={() => onToggleFavorite(farmstand.id)}
            isFavorite={favorites.has(farmstand.id)}
            index={index}
            variant="large"
            overrideImageUrl={imageData?.url}
          />
        );
      })}
    </ScrollView>
  );
}

export default function ExploreScreen() {
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [showPermissionModal, setShowPermissionModal] = useState(false);

  // Stores
  const loadFavorites = useFavoritesStore((s) => s.loadFavorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const favorites = useFavoritesStore((s) => s.favorites);

  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const isAdminLoading = useAdminStore((s) => s.isLoading);
  const farmstandsSource = useAdminStore((s) => s.farmstandsSource);

  const loadExploreData = useExploreStore((s) => s.loadExploreData);
  const getTrendingCategories = useExploreStore((s) => s.getTrendingCategories);
  const getTrendingFarmstands = useExploreStore((s) => s.getTrendingFarmstands);
  const getNewThisWeek = useExploreStore((s) => s.getNewThisWeek);
  const getMostSaved = useExploreStore((s) => s.getMostSaved);
  const getOpenNow = useExploreStore((s) => s.getOpenNow);
  const getFarmstandsByCategory = useExploreStore((s) => s.getFarmstandsByCategory);
  const getTopSpots = useExploreStore((s) => s.getTopSpots);
  const setExploreUserLocation = useExploreStore((s) => s.setUserLocation);

  // Promotions store
  const loadPromotionsData = usePromotionsStore((s) => s.loadPromotionsData);
  const getPromotedForCategory = usePromotionsStore((s) => s.getPromotedForCategory);

  const user = useUserStore((s) => s.user);

  // Location store
  const loadLocationState = useLocationStore((s) => s.loadLocationState);
  const hasSeenLocationOnboarding = useLocationStore((s) => s.hasSeenLocationOnboarding);
  const permissionStatus = useLocationStore((s) => s.permissionStatus);
  const userCoordinates = useLocationStore((s) => s.userCoordinates);
  const anchorLocation = useLocationStore((s) => s.anchorLocation);
  const bannerDismissedForSession = useLocationStore((s) => s.bannerDismissedForSession);
  const setOnboardingSeen = useLocationStore((s) => s.setOnboardingSeen);
  const requestLocationPermission = useLocationStore((s) => s.requestLocationPermission);
  const getCurrentLocation = useLocationStore((s) => s.getCurrentLocation);
  const dismissBannerForSession = useLocationStore((s) => s.dismissBannerForSession);
  const openSettings = useLocationStore((s) => s.openSettings);

  // Get active farmstands - only show APPROVED farmstands
  // Supabase is the source of truth: status='active' AND approval_status='approved'
  const activeFarmstands = useMemo(() => {
    return adminFarmstands.filter((f) => {
      // Must be approved to show in Explore
      if (f.status !== 'active') {
        return false;
      }
      // Must have approved approval status
      if (f.approvalStatus !== 'approved') {
        return false;
      }
      // Only exclude from explore if showOnMap is explicitly false
      if (f.showOnMap === false) {
        return false;
      }
      return true;
    });
  }, [adminFarmstands]);

  // Load data on mount
  useEffect(() => {
    loadFavorites();
    loadAdminData().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('[Explore] FETCH FAILED loadAdminData:', msg);
    });
    loadExploreData();
    loadLocationState();
    loadPromotionsData();
  }, []);

  // Log explore_open when tab is focused
  useFocusEffect(
    useCallback(() => {
      logExploreOpen(user?.id);
    }, [user?.id])
  );

  // Show location permission modal if not seen before
  useEffect(() => {
    if (!hasSeenLocationOnboarding && permissionStatus === 'unknown') {
      // Small delay to let the screen render first
      const timer = setTimeout(() => {
        setShowPermissionModal(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [hasSeenLocationOnboarding, permissionStatus]);

  // Sync anchor location to explore store when it changes
  useEffect(() => {
    if (anchorLocation) {
      setExploreUserLocation(anchorLocation);
    }
  }, [anchorLocation, setExploreUserLocation]);

  // Handle enable location from modal
  const handleEnableLocation = async () => {
    setShowPermissionModal(false);
    await setOnboardingSeen();
    // requestLocationPermission already fetches location when granted
    await requestLocationPermission();
  };

  // Handle not now from modal
  const handleNotNow = async () => {
    setShowPermissionModal(false);
    await setOnboardingSeen();
  };

  // Handle enable location from banner
  const handleBannerEnable = async () => {
    // requestLocationPermission already fetches location when granted
    await requestLocationPermission();
  };

  // Should show location banner
  const shouldShowBanner =
    hasSeenLocationOnboarding &&
    permissionStatus !== 'granted' &&
    permissionStatus !== 'unknown' &&
    !bannerDismissedForSession;

  // Computed data - now using promotions for ordering
  const trendingCategories = useMemo(
    () => getTrendingCategories(activeFarmstands, 8),
    [activeFarmstands, getTrendingCategories]
  );

  // Top Spots now uses promoted farmstands with smart radius filtering
  const topSpotsData = useMemo(() => {
    const promoted = getPromotedForCategory(activeFarmstands, 'best_near_you', 20);
    return filterBySmartRadius(promoted, anchorLocation, 10);
  }, [activeFarmstands, getPromotedForCategory, anchorLocation]);

  const topSpots = topSpotsData.farmstands;
  const topSpotsRadius = topSpotsData.activeRadius;

  const trendingFarmstands = useMemo(
    () => getTrendingFarmstands(activeFarmstands, 10),
    [activeFarmstands, getTrendingFarmstands]
  );

  const newThisWeek = useMemo(
    () => getNewThisWeek(activeFarmstands, 10),
    [activeFarmstands, getNewThisWeek]
  );

  const mostSaved = useMemo(
    () => getMostSaved(activeFarmstands, favorites, 10),
    [activeFarmstands, favorites, getMostSaved]
  );

  const openNow = useMemo(
    () => getOpenNow(activeFarmstands, 10),
    [activeFarmstands, getOpenNow]
  );

  // Category sections now use smart radius filtering
  const eggStandsData = useMemo(() => {
    const categoryFarms = getPromotedForCategory(activeFarmstands, 'eggs', 20);
    return filterBySmartRadius(categoryFarms, anchorLocation, 10);
  }, [activeFarmstands, getPromotedForCategory, anchorLocation]);

  const eggStands = eggStandsData.farmstands;
  const eggStandsRadius = eggStandsData.activeRadius;

  const bakedGoodsData = useMemo(() => {
    const categoryFarms = getPromotedForCategory(activeFarmstands, 'baked_goods', 20);
    return filterBySmartRadius(categoryFarms, anchorLocation, 10);
  }, [activeFarmstands, getPromotedForCategory, anchorLocation]);

  const bakedGoods = bakedGoodsData.farmstands;
  const bakedGoodsRadius = bakedGoodsData.activeRadius;

  const seasonalStandsData = useMemo(() => {
    const categoryFarms = getPromotedForCategory(activeFarmstands, 'seasonal', 20);
    return filterBySmartRadius(categoryFarms, anchorLocation, 10);
  }, [activeFarmstands, getPromotedForCategory, anchorLocation]);

  const seasonalStands = seasonalStandsData.farmstands;
  const seasonalStandsRadius = seasonalStandsData.activeRadius;

  // Handlers
  const handleSearch = () => {
    if (searchQuery.trim()) {
      // Log search event to analytics
      logSearch(searchQuery.trim(), activeFarmstands.length, user?.id);

      // First, try to find farmstands by name with tiered matching
      const nameMatches = findFarmstandsByName(searchQuery.trim(), activeFarmstands);

      // If we have name matches, use name search type
      if (nameMatches.farmstands.length > 0) {
        const navParams: Record<string, string> = {
          search: searchQuery.trim(),
          searchType: 'name',
        };

        // Pass the best match ID for centering
        if (nameMatches.bestMatchId) {
          navParams.matchedFarmstandId = nameMatches.bestMatchId;
        }

        // Pass all matching IDs for filtering (comma-separated)
        if (nameMatches.farmstands.length > 0) {
          navParams.matchedFarmstandIds = nameMatches.farmstands.map(f => f.id).join(',');
        }

        // Clear the search bar after navigating
        setSearchQuery('');

        router.push({
          pathname: '/(tabs)/map',
          params: navParams,
        });
        return;
      }

      // Fall back to regular classification for non-name searches
      const searchContext = classifySearchQuery(searchQuery.trim(), activeFarmstands);

      // Build navigation params based on search type
      const navParams: Record<string, string> = {
        search: searchQuery.trim(),
        searchType: searchContext.searchType,
      };

      // Add category key for product searches
      if (searchContext.searchType === 'product' && searchContext.categoryKey) {
        navParams.mapFilterType = 'category';
        navParams.mapFilterProductTag = searchContext.categoryKey;
      }

      // Add target location for location searches
      if (searchContext.searchType === 'location' && searchContext.targetLocation) {
        navParams.targetLat = String(searchContext.targetLocation.latitude);
        navParams.targetLng = String(searchContext.targetLocation.longitude);
      }

      // Clear the search bar after navigating
      setSearchQuery('');

      router.push({
        pathname: '/(tabs)/map',
        params: navParams,
      });
    }
  };

  const handleCategoryPress = (category: string, label: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Log product chip tap to analytics
    logProductChipTap(category, user?.id);
    // Navigate to Map tab with mapFilter param for category-based filtering
    // Pass the category KEY (e.g., "eggs", "meat") not the label
    router.push({
      pathname: '/(tabs)/map',
      params: {
        mapFilterType: 'category',
        mapFilterProductTag: category, // Use category key (e.g., "eggs", "meat")
      },
    });
  };

  const handleFarmstandPress = (farmstand: Farmstand) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farm/${farmstand.id}`);
  };

  const handleMapPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/(tabs)/map');
  };

  const handleShowAll = (section: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/(tabs)/map',
      params: { section },
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FAFAF8' }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FAFAF8' }}>
        {/* Search Bar — hero element, Airbnb/Hipcamp style */}
        <Animated.View
          entering={FadeInDown.duration(400)}
          style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: '#FFFFFF',
              borderRadius: 30,
              paddingHorizontal: 18,
              height: 52,
              borderWidth: 1,
              borderColor: 'rgba(0,0,0,0.07)',
              shadowColor: '#1A1A1A',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.10,
              shadowRadius: 12,
              elevation: 8,
            }}
          >
            <Search size={18} color="#5C7A5F" strokeWidth={2.2} />
            <TextInput
              style={{
                flex: 1,
                marginLeft: 10,
                fontSize: 15,
                fontWeight: '500',
                color: '#1C1C1E',
                letterSpacing: -0.1,
              }}
              placeholder="Search farms, products, cities..."
              placeholderTextColor="#9B9B9B"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} className="p-1">
                <X size={16} color="#9B9B9B" />
              </Pressable>
            )}
          </View>
        </Animated.View>
      </SafeAreaView>

      {/* Location Banner */}
      {shouldShowBanner && (
        <LocationBanner
          permissionStatus={permissionStatus}
          onEnable={handleBannerEnable}
          onOpenSettings={openSettings}
          onDismiss={dismissBannerForSession}
        />
      )}

      {/* Main Content */}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Offline / stale cache indicator — shown subtly when data is from cache */}
        {farmstandsSource === 'cache' && !isAdminLoading && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 16 }}>
            <WifiOff size={12} color="#8B6F4E" />
            <Text style={{ fontSize: 11, color: '#8B6F4E', marginLeft: 5, opacity: 0.8 }}>
              Showing saved data · refreshing…
            </Text>
          </View>
        )}

        {/* Skeleton: shown only on first load when there is NO cached data */}
        {isAdminLoading && adminFarmstands.length === 0 && (
          <>
            <SkeletonSection variant="large" />
            <SkeletonSection variant="small" />
            <SkeletonSection variant="small" />
          </>
        )}

        {/* Trending Near You - Category Tiles */}
        {trendingCategories.length > 0 && (
          <Animated.View entering={FadeInDown.delay(300).duration(400)} className="mt-2">
            <SectionHeader
              title="Trending Near You"
              onShowAll={() => handleShowAll('trending')}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              style={{ flexGrow: 0 }}
            >
              {trendingCategories.map((cat, index) => (
                <TrendingTile
                  key={cat.category}
                  category={cat.category}
                  label={cat.label}
                  image={cat.image}
                  count={cat.count}
                  onPress={() => handleCategoryPress(cat.category, cat.label)}
                  index={index}
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Top Spots For You - Only renders REAL farmstands, no placeholders/duplicates */}
        {topSpots.length > 0 && (
          <Animated.View entering={FadeInDown.delay(400).duration(400)} className="mt-6">
            <SectionHeader
              title="Top Spots For You"
              onShowAll={topSpots.length > 1 ? () => handleShowAll('top') : undefined}
              radiusMiles={topSpotsRadius}
            />
            {/* Single farmstand: centered layout, no horizontal scroll needed */}
            {topSpots.length === 1 ? (
              <View style={{ paddingHorizontal: 20, alignItems: 'center' }}>
                <FarmstandCard
                  key={topSpots[0].id}
                  farmstand={topSpots[0]}
                  userLocation={anchorLocation}
                  onPress={() => handleFarmstandPress(topSpots[0])}
                  onFavoritePress={() => toggleFavorite(topSpots[0].id)}
                  isFavorite={favorites.has(topSpots[0].id)}
                  index={0}
                  variant="large"
                />
              </View>
            ) : (
              /* Multiple farmstands: horizontal scroll with deduplicated images */
              <TopSpotsCarousel
                farmstands={topSpots}
                anchorLocation={anchorLocation}
                favorites={favorites}
                onFarmstandPress={handleFarmstandPress}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </Animated.View>
        )}

        {/* Baked Goods Near You */}
        {bakedGoods.length > 0 && (
          <Animated.View entering={FadeInDown.delay(500).duration(400)} className="mt-6">
            <SectionHeader
              title="Baked Goods Near You"
              onShowAll={() => handleCategoryPress('baked_goods', 'Baked Goods')}
              radiusMiles={bakedGoodsRadius}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              style={{ flexGrow: 0 }}
            >
              {bakedGoods.map((farmstand, index) => (
                <FarmstandCard
                  key={farmstand.id}
                  farmstand={farmstand}
                  userLocation={anchorLocation}
                  onPress={() => handleFarmstandPress(farmstand)}
                  onFavoritePress={() => toggleFavorite(farmstand.id)}
                  isFavorite={favorites.has(farmstand.id)}
                  index={index}
                  variant="small"
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Egg Stands Near You */}
        {eggStands.length > 0 && (
          <Animated.View entering={FadeInDown.delay(600).duration(400)} className="mt-6">
            <SectionHeader
              title="Egg Stands Near You"
              onShowAll={() => handleCategoryPress('eggs', 'Fresh Eggs')}
              radiusMiles={eggStandsRadius}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              style={{ flexGrow: 0 }}
            >
              {eggStands.map((farmstand, index) => (
                <FarmstandCard
                  key={farmstand.id}
                  farmstand={farmstand}
                  userLocation={anchorLocation}
                  onPress={() => handleFarmstandPress(farmstand)}
                  onFavoritePress={() => toggleFavorite(farmstand.id)}
                  isFavorite={favorites.has(farmstand.id)}
                  index={index}
                  variant="small"
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Seasonal Stands */}
        {seasonalStands.length > 0 && (
          <Animated.View entering={FadeInDown.delay(700).duration(400)} className="mt-6">
            <SectionHeader
              title="Seasonal Stands"
              onShowAll={() => handleCategoryPress('seasonal', 'Seasonal')}
              radiusMiles={seasonalStandsRadius}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              style={{ flexGrow: 0 }}
            >
              {seasonalStands.map((farmstand, index) => (
                <FarmstandCard
                  key={farmstand.id}
                  farmstand={farmstand}
                  userLocation={anchorLocation}
                  onPress={() => handleFarmstandPress(farmstand)}
                  onFavoritePress={() => toggleFavorite(farmstand.id)}
                  isFavorite={favorites.has(farmstand.id)}
                  index={index}
                  variant="small"
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* New This Week */}
        {newThisWeek.length > 0 && (
          <Animated.View entering={FadeInDown.delay(800).duration(400)} className="mt-6">
            <SectionHeader
              title="New This Week"
              onShowAll={() => handleShowAll('new')}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              style={{ flexGrow: 0 }}
            >
              {newThisWeek.map((farmstand, index) => (
                <FarmstandCard
                  key={farmstand.id}
                  farmstand={farmstand}
                  userLocation={anchorLocation}
                  onPress={() => handleFarmstandPress(farmstand)}
                  onFavoritePress={() => toggleFavorite(farmstand.id)}
                  isFavorite={favorites.has(farmstand.id)}
                  index={index}
                  variant="small"
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Most Saved */}
        {mostSaved.length > 0 && (
          <Animated.View entering={FadeInDown.delay(900).duration(400)} className="mt-6">
            <SectionHeader
              title="Most Saved"
              onShowAll={() => handleShowAll('saved')}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              style={{ flexGrow: 0 }}
            >
              {mostSaved.map((farmstand, index) => (
                <FarmstandCard
                  key={farmstand.id}
                  farmstand={farmstand}
                  userLocation={anchorLocation}
                  onPress={() => handleFarmstandPress(farmstand)}
                  onFavoritePress={() => toggleFavorite(farmstand.id)}
                  isFavorite={favorites.has(farmstand.id)}
                  index={index}
                  variant="small"
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Open Now */}
        {openNow.length > 0 && (
          <Animated.View entering={FadeInDown.delay(1000).duration(400)} className="mt-6">
            <SectionHeader
              title="Open Now"
              onShowAll={() => handleShowAll('open')}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              contentContainerStyle={{ paddingHorizontal: 20 }}
              style={{ flexGrow: 0 }}
            >
              {openNow.map((farmstand, index) => (
                <FarmstandCard
                  key={farmstand.id}
                  farmstand={farmstand}
                  userLocation={anchorLocation}
                  onPress={() => handleFarmstandPress(farmstand)}
                  onFavoritePress={() => toggleFavorite(farmstand.id)}
                  isFavorite={favorites.has(farmstand.id)}
                  index={index}
                  variant="small"
                />
              ))}
            </ScrollView>
          </Animated.View>
        )}
      </ScrollView>

      {/* Location Permission Modal */}
      <LocationPermissionModal
        visible={showPermissionModal}
        onEnableLocation={handleEnableLocation}
        onNotNow={handleNotNow}
      />

    </View>
  );
}
