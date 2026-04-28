import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  FlatList,
  Dimensions,
  useWindowDimensions,
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

const fallbackHero = require('../../assets/images/farmstand-final-fallback.png') as number;
import { FarmstandLogoPng, LOGO_WIDTH, LOGO_HEIGHT } from '@/components/FarmstandLogoPng';
import { LocationBanner } from '@/components/LocationBanner';
import { GoldVerifiedRibbon } from '@/components/GoldVerifiedRibbon';
import { PremiumBadge, isPremiumFarmstand } from '@/components/PremiumBadge';
import { logSearch, logProductChipTap, logScreenView, logExploreOpen } from '@/lib/analytics-events';
import { trackEvent } from '@/lib/track';
import { useFocusEffect } from '@react-navigation/native';
import { classifySearchQuery, findFarmstandsByName, SearchContext } from '@/lib/search-store';
import { CATEGORY_LABELS } from '@/lib/category-filter';
import { useSplashStore } from '@/lib/splash-store';
import { LOGO_GREEN } from '@/lib/brand-colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.72;
const TILE_WIDTH = SCREEN_WIDTH * 0.3; // 30% of screen width for square category tiles
const SMALL_CARD_WIDTH = SCREEN_WIDTH * 0.44;

// Guard: returns true only for farmstand objects that are safe to render
// A single malformed record (no id, no name) must not break the entire section
function isValidFarmstand(f: unknown): f is Farmstand {
  if (!f || typeof f !== 'object') return false;
  const obj = f as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.id.length > 0 &&
    typeof obj.name === 'string' &&
    obj.name.length > 0
  );
}

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
        opacity.value =withTiming(0.4, { duration: 800 }, () => {
  pulse();
});;
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
  const { width } = useWindowDimensions();
  const isTabletLocal = width >= 768;
  const cardWidth = isTabletLocal
    ? Math.round(width * (variant === 'large' ? 0.52 : 0.46))
    : (variant === 'large' ? CARD_WIDTH : SMALL_CARD_WIDTH);
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
  const { width } = useWindowDimensions();
  const isTabletLocal = width >= 768;
  // On tablet: cap tiles at ~170px so 4-5 are visible; phone: 30% of screen
  const tileWidth = isTabletLocal ? Math.min(Math.round(width * 0.22), 170) : TILE_WIDTH;
  return (
    <View style={{ width: tileWidth, marginRight: 12 }}>
      <Pressable
        onPress={onPress}
        className="overflow-hidden rounded-2xl"
        style={{ width: tileWidth, height: tileWidth, backgroundColor: '#E8DDD4' }}
      >
        <ExpoImage
          source={{ uri: image }}
          style={{ width: tileWidth, height: tileWidth, position: 'absolute' }}
          contentFit="cover"
          cachePolicy="memory-disk"

          recyclingKey={image}
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
    </View>
  );
}

// Farmstand Card Component for carousels
interface FarmstandCardProps {
  farmstand: Farmstand;
  userLocation: { latitude: number; longitude: number } | null;
  onPress: () => void;
  onFavoritePress: () => void;
  isFavorite: boolean;
  favoritesLoaded: boolean;
  index: number;
  variant?: 'large' | 'small';
  overrideImageUrl?: string; // Use pre-computed deduplicated image URL
  overrideWidth?: number; // For grid mode on tablet
}

function FarmstandCard({
  farmstand,
  userLocation,
  onPress,
  onFavoritePress,
  isFavorite,
  favoritesLoaded,
  index,
  variant = 'large',
  overrideImageUrl,
  overrideWidth,
}: FarmstandCardProps) {
  const heartScale = useSharedValue(1);
  const { width: dynWidth } = useWindowDimensions();
  const isDynTablet = dynWidth >= 768;
  // overrideWidth used in grid mode; otherwise tablet gets ~48% of screen (shows ~2 cards)
  const cardWidth = overrideWidth ?? (isDynTablet
    ? Math.round(dynWidth * (variant === 'large' ? 0.52 : 0.46))
    : (variant === 'large' ? CARD_WIDTH : SMALL_CARD_WIDTH));

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
    photos: farmstand.photos,
    mainPhotoIndex: farmstand.mainPhotoIndex,
    heroPhotoUrl: farmstand.heroPhotoUrl,
    hero_image_url: farmstand.heroImageUrl,
    ai_image_url: farmstand.aiImageUrl,
    main_product: farmstand.mainProduct,
    offerings: farmstand.offerings,
    categories: farmstand.categories,
  }).url;

  const [imgSource, setImgSource] = useState<{ uri: string } | number>(
    imageUrl ? { uri: imageUrl } : fallbackHero
  );

  const cardHeight = cardWidth;

  return (
    // Outer wrapper: fixed width, margin for spacing only (no right margin in grid mode)
    <View style={{ width: cardWidth, marginRight: overrideWidth ? 0 : 16, marginBottom: overrideWidth ? 0 : 4 }}>
      {/* Pressable fills wrapper exactly — no second width declaration */}
      <Pressable onPress={onPress} style={{ width: '100%' }}>
        {/* Floating Image Card with Shadow */}
        <View
          style={{
            width: cardWidth,
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
          {/* Image uses explicit pixel dimensions — never relative inside overflow:hidden container */}
          <ExpoImage
            source={imgSource}
            style={{ width: cardWidth, height: cardHeight }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={imageUrl || 'fallback'}
            transition={250}
            onError={() => setImgSource(fallbackHero)}
          />
          {/* Heart button — absolute positioned, does not affect layout flow */}
          <Pressable
            onPress={handleFavoritePress}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
            }}
            hitSlop={12}
          >
            <Animated.View style={heartAnimatedStyle}>
              <Heart
                size={22}
                color={favoritesLoaded && isFavorite ? '#C94A4A' : '#FFFFFF'}
                fill={favoritesLoaded && isFavorite ? '#C94A4A' : 'transparent'}
                strokeWidth={2}
              />
            </Animated.View>
          </Pressable>
        </View>

        {/* Text area — explicit width matches card, not relative to parent */}
        <View style={{ width: cardWidth, paddingTop: 10, paddingHorizontal: 2, minWidth: 0, overflow: 'hidden' }}>
          {/* Farm name row — flex: 1 + minWidth: 0 to allow text to shrink */}
          <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
            <Text
              className="text-charcoal font-bold"
              style={{ fontSize: 16, flexShrink: 1, minWidth: 0 }}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {farmstand.name}
            </Text>
            {farmstand.goldVerified && (
              <View style={{ flexShrink: 0, marginLeft: 4 }}>
                <GoldVerifiedRibbon size={14} />
              </View>
            )}
          </View>
          {isPremiumFarmstand(farmstand.premiumStatus) && (
            <View style={{ marginTop: 4 }}>
              <PremiumBadge size="small" />
            </View>
          )}

          {/* Operating status badge — only shown when not 'open' */}
          {farmstand.operatingStatus && farmstand.operatingStatus !== 'open' && (() => {
            const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
              temporarily_closed: { label: 'Temp. Closed', bg: '#FEF3C7', text: '#B45309' },
              seasonal: { label: 'Seasonal', bg: '#DBEAFE', text: '#1D4ED8' },
              permanently_closed: { label: 'Permanently Closed', bg: '#FEE2E2', text: '#B91C1C' },
            };
            const cfg = statusConfig[farmstand.operatingStatus];
            if (!cfg) return null;
            return (
              <View style={{ marginTop: 4, alignSelf: 'flex-start', backgroundColor: cfg.bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '600', color: cfg.text }}>{cfg.label}</Text>
              </View>
            );
          })()}

          {/* Categories — single line, truncates */}
          <Text
            className="text-wood text-xs mt-1"
            style={{ opacity: 0.7, minWidth: 0, flexShrink: 1 }}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {farmstand.offerings.slice(0, 3).join(' • ')}
          </Text>

          {/* Distance and location row — both shrink, neither pushes beyond card */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, minWidth: 0, overflow: 'hidden' }}>
            {distance !== null && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10, flexShrink: 0 }}>
                <Navigation size={11} color="#2D5A3D" />
                <Text className="text-forest text-xs font-medium" style={{ marginLeft: 3 }}>
                  {distance < 10 ? distance.toFixed(1) : Math.round(distance)} mi
                </Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <MapPin size={11} color="#8B6F4E" style={{ flexShrink: 0 }} />
              <Text
                className="text-wood text-xs"
                style={{ opacity: 0.7, marginLeft: 3, flexShrink: 1, minWidth: 0 }}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {farmstand.city ?? 'Oregon'}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
    </View>
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
  const { width: w } = useWindowDimensions();
  const padH = w >= 768 ? 28 : 20;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: padH, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        <Text className="text-charcoal font-bold text-lg">{title}</Text>
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
  favoritesLoaded: boolean;
  onFarmstandPress: (farmstand: Farmstand) => void;
  onToggleFavorite: (id: string) => void;
  numCols?: number;
  colWidth?: number;
}

function TopSpotsCarousel({
  farmstands,
  anchorLocation,
  favorites,
  favoritesLoaded,
  onFarmstandPress,
  onToggleFavorite,
  numCols = 1,
  colWidth = 0,
}: TopSpotsCarouselProps) {
  const listRef = useRef<FlatList>(null);
  const { width: dynWidth } = useWindowDimensions();
  const leftPad = dynWidth >= 768 ? 28 : 16;

  // Get images for all farmstands using unified helper
  const farmstandImages = useMemo(() => {
    const images = new Map<string, { url: string; isAIGenerated: boolean }>();
    for (const f of farmstands) {
      const result = getFarmstandDisplayImage({
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
      images.set(f.id, { url: result.url, isAIGenerated: result.isAI });
    }
    return images;
  }, [farmstands]);

  // Reset scroll when farmstands change
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [farmstands]);

  // Grid mode for tablet
  if (numCols > 1 && colWidth > 0) {
    const rows: Farmstand[][] = [];
    for (let i = 0; i < farmstands.length; i += numCols) {
      rows.push(farmstands.slice(i, i + numCols));
    }
    return (
      <View style={{ paddingHorizontal: leftPad }}>
        {rows.map((row, rowIdx) => (
          <View key={rowIdx} style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            {row.map((farmstand, colIdx) => {
              const imageData = farmstandImages.get(farmstand.id);
              return (
                <FarmstandCard
                  key={farmstand.id}
                  farmstand={farmstand}
                  userLocation={anchorLocation}
                  onPress={() => onFarmstandPress(farmstand)}
                  onFavoritePress={() => onToggleFavorite(farmstand.id)}
                  isFavorite={favorites.has(farmstand.id)}
                  favoritesLoaded={favoritesLoaded}
                  index={rowIdx * numCols + colIdx}
                  variant="large"
                  overrideImageUrl={imageData?.url}
                  overrideWidth={colWidth}
                />
              );
            })}
            {row.length < numCols && Array.from({ length: numCols - row.length }, (_, i) => (
              <View key={`filler-${i}`} style={{ width: colWidth }} />
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      horizontal
      data={farmstands}
      keyExtractor={(item) => item.id}
      renderItem={({ item: farmstand, index }) => {
        const imageData = farmstandImages.get(farmstand.id);
        return (
          <FarmstandCard
            farmstand={farmstand}
            userLocation={anchorLocation}
            onPress={() => onFarmstandPress(farmstand)}
            onFavoritePress={() => onToggleFavorite(farmstand.id)}
            isFavorite={favorites.has(farmstand.id)}
            favoritesLoaded={favoritesLoaded}
            index={index}
            variant="large"
            overrideImageUrl={imageData?.url}
          />
        );
      }}
      showsHorizontalScrollIndicator={false}
      removeClippedSubviews={false}
      initialNumToRender={6}
      windowSize={5}
      contentContainerStyle={{ paddingLeft: leftPad, paddingRight: 8 }}
      style={{ flexGrow: 0 }}
    />
  );
}

// Reusable horizontal FlatList for farmstand sections
interface HorizontalFarmstandListProps {
  sectionName: string;
  data: Farmstand[];
  anchorLocation: { latitude: number; longitude: number } | null;
  favorites: Set<string>;
  favoritesLoaded: boolean;
  onFarmstandPress: (f: Farmstand) => void;
  onToggleFavorite: (id: string) => void;
  variant?: 'large' | 'small';
  resetKey?: number; // increment to force scroll reset
  numCols?: number;
  colWidth?: number;
}

function HorizontalFarmstandList({
  sectionName,
  data,
  anchorLocation,
  favorites,
  favoritesLoaded,
  onFarmstandPress,
  onToggleFavorite,
  variant = 'small',
  resetKey,
  numCols = 1,
  colWidth = 0,
}: HorizontalFarmstandListProps) {
  const listRef = useRef<FlatList>(null);
  const { width: dynWidth } = useWindowDimensions();
  const isDynTablet = dynWidth >= 768;
  const leftPad = isDynTablet ? 28 : 16;

  // Reset scroll when data changes or screen re-focuses
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [data, resetKey]);

  // Grid mode for tablet
  if (numCols > 1 && colWidth > 0) {
    const rows: Farmstand[][] = [];
    for (let i = 0; i < data.length; i += numCols) {
      rows.push(data.slice(i, i + numCols));
    }
    return (
      <View style={{ paddingHorizontal: leftPad }}>
        {rows.map((row, rowIdx) => (
          <View key={rowIdx} style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            {row.map((farmstand, colIdx) => (
              <FarmstandCard
                key={farmstand.id}
                farmstand={farmstand}
                userLocation={anchorLocation}
                onPress={() => onFarmstandPress(farmstand)}
                onFavoritePress={() => onToggleFavorite(farmstand.id)}
                isFavorite={favorites.has(farmstand.id)}
                favoritesLoaded={favoritesLoaded}
                index={rowIdx * numCols + colIdx}
                variant={variant}
                overrideWidth={colWidth}
              />
            ))}
            {row.length < numCols && Array.from({ length: numCols - row.length }, (_, i) => (
              <View key={`filler-${i}`} style={{ width: colWidth }} />
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      horizontal
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={({ item: farmstand, index }) => (
        <FarmstandCard
          farmstand={farmstand}
          userLocation={anchorLocation}
          onPress={() => onFarmstandPress(farmstand)}
          onFavoritePress={() => onToggleFavorite(farmstand.id)}
          isFavorite={favorites.has(farmstand.id)}
          favoritesLoaded={favoritesLoaded}
          index={index}
          variant={variant}
        />
      )}
      showsHorizontalScrollIndicator={false}
      removeClippedSubviews={false}
      initialNumToRender={6}
      windowSize={5}
      contentContainerStyle={{ paddingLeft: leftPad, paddingRight: 8 }}
      style={{ flexGrow: 0 }}
    />
  );
}

export default function ExploreScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const hPad = isTablet ? 32 : 16;
  const COL_GAP = 12;
  const numColumns = isTablet ? (width >= 1200 ? 3 : 2) : 1;
  const colWidth = numColumns > 1 ? Math.floor((width - hPad * 2 - COL_GAP * (numColumns - 1)) / numColumns) : 0;
  const scrollRef = useRef<ScrollView>(null);

  // State
  const [searchQuery, setSearchQuery] = useState('');
const [focusResetKey, setFocusResetKey] = useState(0);

  // Stores
  const loadFavorites = useFavoritesStore((s) => s.loadFavorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const favorites = useFavoritesStore((s) => s.favorites);
  const isFavoritesLoaded = useFavoritesStore((s) => s.isLoaded);

  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const isAdminLoading = useAdminStore((s) => s.isLoading);
  const farmstandsSource = useAdminStore((s) => s.farmstandsSource);
  const loadExploreData = useExploreStore((s) => s.loadExploreData);
  const loadSaveCounts = useExploreStore((s) => s.loadSaveCounts);
  const saveCounts = useExploreStore((s) => s.saveCounts);
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
  const getPromotedForExploreRow = usePromotionsStore((s) => s.getPromotedForExploreRow);

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

  // Splash readiness signal: fires once data is loaded + 350ms image settle
  const setExploreReady = useSplashStore((s) => s.setExploreReady);
  // Gate post-splash UI (location modal) until the overlay has fully faded out
  const splashDismissed = useSplashStore((s) => s.splashDismissed);
  const exploreReadySignaled = useRef(false);
  useEffect(() => {
    if (exploreReadySignaled.current) return;
    if (isAdminLoading || activeFarmstands.length === 0) return;
    exploreReadySignaled.current = true;
    console.log('[Splash] Explore data ready —', activeFarmstands.length, 'farmstands');
    const timer = setTimeout(() => {
      console.log('[Splash] Visible images ready — signaling explore ready');
      setExploreReady();
    }, 350);
    return () => clearTimeout(timer);
  }, [isAdminLoading, activeFarmstands.length, setExploreReady]);

  // Load data on mount. loadFavorites is discarded by the version guard if a
  // toggle fires before the fetch resolves (version will have advanced).
  useEffect(() => {
    loadFavorites();
    loadAdminData().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('[Explore] FETCH FAILED loadAdminData:', msg);
    });
    loadExploreData();
    loadSaveCounts();
    loadLocationState();
    loadPromotionsData();
  }, []);

  // Log explore_open when tab is focused, and increment focusResetKey to reset carousels
  useFocusEffect(
    useCallback(() => {
      logExploreOpen(user?.id);
      setFocusResetKey((k) => k + 1);
    }, [user?.id])
  );

  // Request location permission directly after splash — no custom pre-permission screen.
  useEffect(() => {
    if (!splashDismissed) return;
    if (!hasSeenLocationOnboarding && permissionStatus === 'unknown') {
      const timer = setTimeout(async () => {
        await setOnboardingSeen();
        await requestLocationPermission();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [splashDismissed, hasSeenLocationOnboarding, permissionStatus]);

  // Sync anchor location to explore store when it changes
  useEffect(() => {
    if (anchorLocation) {
      setExploreUserLocation(anchorLocation);
    }
  }, [anchorLocation, setExploreUserLocation]);

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
  const trendingCategories = useMemo(() => {
    const cats = getTrendingCategories(activeFarmstands, 8);
    console.log('[Explore] TrendingCategories count:', cats.length, 'first3:', cats.slice(0, 3).map(c => c.category), 'rendered:', cats.length > 0);
    return cats;
  }, [activeFarmstands, getTrendingCategories]);

  // Top Spots: hard 25-mile cap, sorted by real save counts then distance, promoted slot injected
  const topSpotsData = useMemo(() => {
    const TOP_SPOTS_MILES = 25;
    const promoRadius = anchorLocation ? RADIUS_TIERS[RADIUS_TIERS.length - 1] : 0;
    const pool = getPromotedForExploreRow(activeFarmstands, 'best_near_you', anchorLocation, promoRadius, 20);

    console.log('[TopSpots] pool size:', pool.length);

    if (!anchorLocation) {
      const valid = pool.slice(0, 10).filter(isValidFarmstand);
      console.log('[TopSpots] no anchorLocation — returning', valid.length, 'items');
      return { farmstands: valid, activeRadius: 0 };
    }

    const distFn = (f: Farmstand) =>
      calculateDistance(anchorLocation.latitude, anchorLocation.longitude, f.latitude ?? 0, f.longitude ?? 0);

    // Effective save count: use the real aggregate from saved_farmstands (same source as MostSaved)
    const effectiveCount = (f: Farmstand) => saveCounts[f.id] ?? (f as any).saved_count ?? f.saves30d ?? 0;

    // Hard 25-mile cap
    const withinRange = pool.filter((f) => {
      if (f.latitude == null || f.longitude == null) {
        console.log('[TopSpots] excluded (no coords):', f.id, f.name);
        return false;
      }
      const dist = distFn(f);
      if (dist > TOP_SPOTS_MILES) {
        console.log('[TopSpots] excluded (distance', dist.toFixed(1), 'mi > 25):', f.id, f.name);
        return false;
      }
      return true;
    });
    console.log('[TopSpots] after 25-mile filter:', withinRange.length);

    // Promoted slot: pool[0] if it has an active promo and survived the radius cap
    const promotedItem = pool[0]?.promoActive && withinRange.includes(pool[0]) ? pool[0] : null;

    // Organic: all within-range farmstands except the promoted slot, sorted by saves then distance
    // NOTE: no save-count minimum — Top Spots shows all quality nearby farmstands regardless of saves
    const organic = withinRange
      .filter((f) => f !== promotedItem)
      .sort((a, b) => {
        const aSaved = effectiveCount(a);
        const bSaved = effectiveCount(b);
        if (bSaved !== aSaved) return bSaved - aSaved;
        return distFn(a) - distFn(b);
      })
      .slice(0, 10);

    console.log('[TopSpots] organic count:', organic.length,
      'saves breakdown:', organic.slice(0, 5).map(f => ({ id: f.id, name: f.name, saves: effectiveCount(f), dist: distFn(f).toFixed(1) }))
    );

    // Insert promoted item at a stable position within [0, 2]
    let result = [...organic];
    if (promotedItem) {
      const windowIndex = Math.floor(Date.now() / (2 * 60 * 60 * 1000));
      const insertAt = Math.min(windowIndex % 3, result.length);
      result.splice(insertAt, 0, promotedItem);
      result = result.slice(0, 10);
    }

    const valid = result.filter(isValidFarmstand);
    console.log('[TopSpots] final count:', valid.length, 'first3:', valid.slice(0, 3).map(f => f.id));
    return { farmstands: valid, activeRadius: TOP_SPOTS_MILES };
  }, [activeFarmstands, getPromotedForExploreRow, anchorLocation, saveCounts]);

  const topSpots = topSpotsData.farmstands;
  const topSpotsRadius = topSpotsData.activeRadius;

  const trendingFarmstands = useMemo(
    () => getTrendingFarmstands(activeFarmstands, 10),
    [activeFarmstands, getTrendingFarmstands]
  );

  const newThisWeek = useMemo(() => {
    const raw = getNewThisWeek(activeFarmstands, 10);
    const valid = raw.filter(isValidFarmstand);
    console.log('[Explore] NewThisWeek count:', valid.length, 'first3:', valid.slice(0, 3).map(f => f.id), 'rendered:', valid.length > 0);
    return valid;
  }, [activeFarmstands, getNewThisWeek]);

  const mostSaved = useMemo(() => {
    const raw = getMostSaved(activeFarmstands, anchorLocation, 10);
    const valid = raw.filter(isValidFarmstand);
    console.log('[MostSaved UI] items length:', valid.length,
      valid.map((f) => ({
        id: f.id,
        name: f.name,
        saved_count: f.saved_count,
        saveCountFromStore: saveCounts[f.id] ?? 0,
        operatingStatus: f.operatingStatus,
      }))
    );
    if (valid.length === 0) {
      console.log('[MostSaved UI] section HIDDEN —',
        anchorLocation ? 'no qualifying farmstands within 25mi with saves > 0' : 'no user location set'
      );
    } else {
      console.log('[MostSaved UI] section RENDERING', valid.length, 'items');
    }
    return valid;
  }, [activeFarmstands, anchorLocation, getMostSaved, saveCounts]);

  const openNow = useMemo(() => {
    const raw = getOpenNow(activeFarmstands, 10);
    const valid = raw.filter(isValidFarmstand);
    console.log('[Explore] OpenNow count:', valid.length, 'first3:', valid.slice(0, 3).map(f => f.id), 'rendered:', valid.length > 0);
    return valid;
  }, [activeFarmstands, getOpenNow]);

  // Egg Stands: hard 25-mile cap, open-only, distance asc + saved_count desc tie-breaker, promoted slot at random 0-2
  const eggStandsData = useMemo(() => {
    const EGG_MILES = 25;
    const promoRadius = anchorLocation ? RADIUS_TIERS[RADIUS_TIERS.length - 1] : 0;
    const pool = getPromotedForExploreRow(activeFarmstands, 'eggs', anchorLocation, promoRadius, 20);

    if (!anchorLocation) {
      const valid = pool.slice(0, 10).filter(isValidFarmstand);
      console.log('[Explore] EggStands count:', valid.length, 'rendered:', valid.length > 0);
      return { farmstands: valid, activeRadius: 0 };
    }

    const distFn = (f: Farmstand) =>
      calculateDistance(anchorLocation.latitude, anchorLocation.longitude, f.latitude ?? 0, f.longitude ?? 0);

    // Hard 25-mile cap + exclude non-open statuses
    const withinRange = pool.filter((f) => {
      if (f.latitude == null || f.longitude == null) return false;
      if (f.operatingStatus && f.operatingStatus !== 'open') return false;
      return distFn(f) <= EGG_MILES;
    });

    // Promoted slot: pool[0] if promoActive and survived filters
    const promotedItem = pool[0]?.promoActive && withinRange.includes(pool[0]) ? pool[0] : null;

    // Organic: distance asc, saved_count desc as tie-breaker
    const organic = withinRange
      .filter((f) => f !== promotedItem)
      .sort((a, b) => {
        const aDist = distFn(a);
        const bDist = distFn(b);
        if (aDist !== bDist) return aDist - bDist;
        const aSaved = (a as any).saved_count ?? a.saves30d ?? 0;
        const bSaved = (b as any).saved_count ?? b.saves30d ?? 0;
        return bSaved - aSaved;
      })
      .slice(0, 10);

    // Insert promoted item at deterministic random position within [0, 2]
    let result = [...organic];
    if (promotedItem) {
      const windowIndex = Math.floor(Date.now() / (2 * 60 * 60 * 1000));
      const insertAt = Math.min(windowIndex % 3, result.length);
      result.splice(insertAt, 0, promotedItem);
      result = result.slice(0, 10);
    }

    const valid = result.filter(isValidFarmstand);
    console.log('[Explore] EggStands count:', valid.length, 'first3:', valid.slice(0, 3).map(f => f.id), 'rendered:', valid.length > 0);
    return { farmstands: valid, activeRadius: EGG_MILES };
  }, [activeFarmstands, getPromotedForExploreRow, anchorLocation]);

  const eggStands = eggStandsData.farmstands;
  const eggStandsRadius = eggStandsData.activeRadius;

  const bakedGoodsData = useMemo(() => {
    const promoRadius = anchorLocation ? RADIUS_TIERS[RADIUS_TIERS.length - 1] : 0;
    const categoryFarms = getPromotedForExploreRow(activeFarmstands, 'baked_goods', anchorLocation, promoRadius, 20);
    const result = filterBySmartRadius(categoryFarms, anchorLocation, 10);
    const valid = result.farmstands.filter(isValidFarmstand);
    console.log('[Explore] BakedGoods count:', valid.length, 'first3:', valid.slice(0, 3).map(f => f.id), 'rendered:', valid.length > 0);
    return { farmstands: valid, activeRadius: result.activeRadius };
  }, [activeFarmstands, getPromotedForExploreRow, anchorLocation]);

  const bakedGoods = bakedGoodsData.farmstands;
  const bakedGoodsRadius = bakedGoodsData.activeRadius;

  const seasonalStandsData = useMemo(() => {
    const seasonalFarms = activeFarmstands.filter(f => f.isSeasonal === true);
    const result = filterBySmartRadius(seasonalFarms, anchorLocation, 10);
    const valid = result.farmstands.filter(isValidFarmstand);
    console.log('[Explore] SeasonalStands count:', valid.length, 'rendered:', valid.length > 0);
    return { farmstands: valid, activeRadius: result.activeRadius };
  }, [activeFarmstands, anchorLocation]);

  const seasonalStands = seasonalStandsData.farmstands;
  const seasonalStandsRadius = seasonalStandsData.activeRadius;

  // Handlers
  const handleSearch = () => {
    if (!searchQuery.trim()) return;

    logSearch(searchQuery.trim(), activeFarmstands.length, user?.id);
    trackEvent('explore_search_submitted', { query: searchQuery.trim(), query_length: searchQuery.trim().length });

    // Resolve search intent with correct priority: category > location > name
    const searchContext = classifySearchQuery(searchQuery.trim(), activeFarmstands);

    // Product/category searches use ONLY the filter params — no raw text param.
    // This matches handleCategoryPress and prevents Map's initial useState from
    // hydrating the search bar with the typed text on first mount.
    const navParams: Record<string, string> = {};

    if (searchContext.searchType === 'product' && searchContext.categoryKey) {
      navParams.mapFilterType = 'category';
      navParams.mapFilterProductTag = searchContext.categoryKey;
    } else if (searchContext.searchType === 'location' && searchContext.targetLocation) {
      navParams.search = searchQuery.trim();
      navParams.searchType = 'location';
      navParams.targetLat = String(searchContext.targetLocation.latitude);
      navParams.targetLng = String(searchContext.targetLocation.longitude);
    } else {
      // Name or general search — pass text so Map can filter by it
      navParams.search = searchQuery.trim();
      navParams.searchType = searchContext.searchType;
      const nameMatches = findFarmstandsByName(searchQuery.trim(), activeFarmstands);
      if (nameMatches.farmstands.length > 0) {
        navParams.searchType = 'name';
        if (nameMatches.bestMatchId) {
          navParams.matchedFarmstandId = nameMatches.bestMatchId;
        }
        navParams.matchedFarmstandIds = nameMatches.farmstands.map(f => f.id).join(',');
      }
    }

    setSearchQuery('');
    // searchNonce makes every navigation unique so Map re-processes even if params match a cleared search
    navParams.searchNonce = Date.now().toString();
    router.push({
      pathname: '/(tabs)/map',
      params: navParams,
    });
  };

  const handleCategoryPress = (category: string, label: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Log product chip tap to analytics
    logProductChipTap(category, user?.id);
    trackEvent('explore_category_selected', { category: label || category });
    const nonce = Date.now().toString();
    if (__DEV__) {
      console.log('[Explore] chip passed to Map — tag:', category, '| label:', label || category, '| nonce:', nonce);
    }
    // Navigate to Map tab with mapFilter param for category-based filtering
    // Pass the category KEY (e.g., "eggs", "meat") not the label
    router.push({
      pathname: '/(tabs)/map',
      params: {
        mapFilterType: 'category',
        mapFilterProductTag: category, // Use category key (e.g., "eggs", "meat")
        searchNonce: nonce,
      },
    });
  };

  const handleFarmstandPress = (farmstand: Farmstand) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackEvent('farmstand_card_tapped', { source: 'explore', farmstand_id: farmstand.id, farmstand_name: farmstand.name });
    router.push(`/farm/${farmstand.id}`);
  };

  const handleToggleFavorite = (farmstandId: string) => {
    const isCurrentlySaved = favorites.has(farmstandId);
    const farm = activeFarmstands.find(f => f.id === farmstandId);
    trackEvent('save_farmstand_tapped', { source: 'explore', farmstand_id: farmstandId, farmstand_name: farm?.name ?? null, new_saved_state: !isCurrentlySaved });
    toggleFavorite(farmstandId);
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
    <View style={{ flex: 1, backgroundColor: '#F4F1E8' }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#F4F1E8' }}>
        {/* Logo: tight=true clips 41px transparent top + 52px transparent bottom from asset */}
        {/* paddingTop=12 → 12px from safe area to visible artwork top */}
        {/* paddingLeft floors (screenWidth-360)/2 to an integer so the logo origin lands on a */}
        {/* whole physical pixel on every device (375pt→7pt, 393pt→16pt, etc.).               */}
        {/* alignItems:'center' produces 7.5pt/16.5pt offsets on those screens = sub-pixel blur */}
        <View style={{ paddingLeft: Math.floor((SCREEN_WIDTH - LOGO_WIDTH) / 2), paddingTop: 12 }}>
          <FarmstandLogoPng
            width={LOGO_WIDTH}
            height={LOGO_HEIGHT}
            tintColor={LOGO_GREEN}
            tight
          />
        </View>
        {/* Search Bar: paddingTop=12 → 12px from visible artwork bottom to search bar */}
        <Animated.View
          entering={FadeInDown.duration(400)}
          style={{ paddingHorizontal: hPad, paddingTop: 12, paddingBottom: 8 }}
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
      <View style={{ flex: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden', backgroundColor: '#F4F1E8' }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: '#F4F1E8' }}
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
              contentContainerStyle={{ paddingLeft: hPad, paddingRight: 8 }}
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
          <Animated.View className="mt-6">
            <SectionHeader
              title="Top Spots For You"
              onShowAll={topSpots.length > 1 ? () => handleShowAll('top') : undefined}
              radiusMiles={topSpotsRadius}
            />
            {/* Always use the carousel — even with 1 item it renders the correct large-card horizontal row */}
            <TopSpotsCarousel
              farmstands={topSpots}
              anchorLocation={anchorLocation}
              favorites={favorites}
              favoritesLoaded={isFavoritesLoaded}
              onFarmstandPress={handleFarmstandPress}
              onToggleFavorite={handleToggleFavorite}
              numCols={numColumns}
              colWidth={colWidth}
            />
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
            <HorizontalFarmstandList
              sectionName="BakedGoods"
              data={bakedGoods}
              anchorLocation={anchorLocation}
              favorites={favorites}
              favoritesLoaded={isFavoritesLoaded}
              onFarmstandPress={handleFarmstandPress}
              onToggleFavorite={handleToggleFavorite}
              variant="small"
              resetKey={focusResetKey}
              numCols={numColumns}
              colWidth={colWidth}
            />
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
            <HorizontalFarmstandList
              sectionName="EggStands"
              data={eggStands}
              anchorLocation={anchorLocation}
              favorites={favorites}
              favoritesLoaded={isFavoritesLoaded}
              onFarmstandPress={handleFarmstandPress}
              onToggleFavorite={handleToggleFavorite}
              variant="small"
              resetKey={focusResetKey}
              numCols={numColumns}
              colWidth={colWidth}
            />
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
            <HorizontalFarmstandList
              sectionName="SeasonalStands"
              data={seasonalStands}
              anchorLocation={anchorLocation}
              favorites={favorites}
              favoritesLoaded={isFavoritesLoaded}
              onFarmstandPress={handleFarmstandPress}
              onToggleFavorite={handleToggleFavorite}
              variant="small"
              resetKey={focusResetKey}
              numCols={numColumns}
              colWidth={colWidth}
            />
          </Animated.View>
        )}

        {/* New This Week */}
        {newThisWeek.length > 0 && (
          <Animated.View entering={FadeInDown.delay(800).duration(400)} className="mt-6">
            <SectionHeader
              title="New This Week"
              onShowAll={() => handleShowAll('new')}
            />
            <HorizontalFarmstandList
              sectionName="NewThisWeek"
              data={newThisWeek}
              anchorLocation={anchorLocation}
              favorites={favorites}
              favoritesLoaded={isFavoritesLoaded}
              onFarmstandPress={handleFarmstandPress}
              onToggleFavorite={handleToggleFavorite}
              variant="small"
              resetKey={focusResetKey}
              numCols={numColumns}
              colWidth={colWidth}
            />
          </Animated.View>
        )}

        {/* Most Saved */}
        {mostSaved.length > 0 && (
          <Animated.View entering={FadeInDown.delay(900).duration(400)} className="mt-6">
            <SectionHeader
              title="Most Saved"
              onShowAll={() => handleShowAll('saved')}
            />
            <HorizontalFarmstandList
              sectionName="MostSaved"
              data={mostSaved}
              anchorLocation={anchorLocation}
              favorites={favorites}
              favoritesLoaded={isFavoritesLoaded}
              onFarmstandPress={handleFarmstandPress}
              onToggleFavorite={handleToggleFavorite}
              variant="small"
              resetKey={focusResetKey}
              numCols={numColumns}
              colWidth={colWidth}
            />
          </Animated.View>
        )}

        {/* Open Now */}
        {openNow.length > 0 && (
          <Animated.View entering={FadeInDown.delay(1000).duration(400)} className="mt-6">
            <SectionHeader
              title="Open Now"
              onShowAll={() => handleShowAll('open')}
            />
            <HorizontalFarmstandList
              sectionName="OpenNow"
              data={openNow}
              anchorLocation={anchorLocation}
              favorites={favorites}
              favoritesLoaded={isFavoritesLoaded}
              onFarmstandPress={handleFarmstandPress}
              onToggleFavorite={handleToggleFavorite}
              variant="small"
              resetKey={focusResetKey}
              numCols={numColumns}
              colWidth={colWidth}
            />
          </Animated.View>
        )}
      </ScrollView>
      </View>


    </View>
  );
}
