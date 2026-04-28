import React, { useEffect, useMemo, useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Heart, MapPin, Navigation, LogIn, UserPlus } from 'lucide-react-native';
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useRouter, useFocusEffect } from 'expo-router';
import { useFavoritesStore } from '@/lib/favorites-store';
import { useAdminStore } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import { Farmstand } from '@/lib/farmer-store';
import { getFarmstandDisplayImage } from '@/lib/farmstand-image';

const fallbackHero = require('../../assets/images/farmstand-final-fallback.png') as number;
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { GoldVerifiedRibbon } from '@/components/GoldVerifiedRibbon';
import { PremiumBadge, isPremiumFarmstand } from '@/components/PremiumBadge';
import { Image as ExpoImage } from 'expo-image';
import { trackEvent } from '@/lib/track';


// Calculate distance between two coordinates
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

// Check if farmstand is open now
const isOpenNow = (farmstand: Farmstand): boolean => {
  if (!farmstand.hours) return farmstand.isActive;

  const now = new Date();
  const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()] as
    | 'mon'
    | 'tue'
    | 'wed'
    | 'thu'
    | 'fri'
    | 'sat'
    | 'sun';
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const todayHours = farmstand.hours[dayOfWeek];
  if (todayHours.closed || !todayHours.open || !todayHours.close) return false;

  const [openHour, openMin] = todayHours.open.split(':').map(Number);
  const [closeHour, closeMin] = todayHours.close.split(':').map(Number);
  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
};

// Saved Farmstand Card Component
interface SavedFarmstandCardProps {
  farmstand: Farmstand;
  userLocation: { latitude: number; longitude: number } | null;
  onPress: () => void;
  onRemove: () => void;
  index: number;
}

function SavedFarmstandCard({
  farmstand,
  userLocation,
  onPress,
  onRemove,
  index,
}: SavedFarmstandCardProps) {
  const heartScale = useSharedValue(1);

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const handleRemove = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    heartScale.value = withSpring(0.5, { damping: 10 }, () => {
      heartScale.value = withSpring(1, { damping: 10 });
    });
    onRemove();
  };

  const distance = userLocation
    ? calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        farmstand.latitude ?? 0,
        farmstand.longitude ?? 0
      )
    : null;

  const isOpen = isOpenNow(farmstand);

  const imageUrl = getFarmstandDisplayImage({
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

  return (
    <Animated.View entering={FadeInDown.delay(index * 80).duration(400)}>
      <Pressable
        onPress={onPress}
        className="bg-white rounded-2xl overflow-hidden shadow-sm mb-4 border border-sand"
      >
        {/* Image */}
        <View className="relative">
          <ExpoImage
            source={imgSource}
            style={{ width: '100%', height: 176 }}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={imageUrl || 'fallback'}
            transition={250}
            onError={() => setImgSource(fallbackHero)}
          />
          {/* Heart button to remove */}
          <Pressable
            onPress={handleRemove}
            hitSlop={10}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
            }}
          >
            <Animated.View style={heartAnimatedStyle}>
              <Heart size={22} color="#C94A4A" fill="#C94A4A" strokeWidth={2} />
            </Animated.View>
          </Pressable>
          {/* Open/Closed badge */}
          <View
            className={`absolute bottom-3 left-3 px-3 py-1 rounded-full ${
              isOpen ? 'bg-forest' : 'bg-charcoal/80'
            }`}
          >
            <Text className="text-white text-xs font-semibold">
              {isOpen ? 'Open Now' : 'Closed'}
            </Text>
          </View>
        </View>

        {/* Content */}
        <View className="p-4">
          <View className="flex-row items-start justify-between">
            <View className="flex-row items-center flex-1 mr-2">
              <Text
                className="text-charcoal font-bold text-lg"
                numberOfLines={1}
                style={{ flexShrink: 1 }}
              >
                {farmstand.name}
              </Text>
              {farmstand.goldVerified && <GoldVerifiedRibbon size={14} />}
            </View>
            {isPremiumFarmstand(farmstand.premiumStatus) && (
              <View style={{ marginTop: 3, marginBottom: -2 }}>
                <PremiumBadge size="small" />
              </View>
            )}
            <View className="flex-row items-center bg-forest/10 px-2 py-1 rounded-lg">
              <Text className="text-forest font-semibold text-sm">New</Text>
            </View>
          </View>

          {/* Location and distance */}
          <View className="flex-row items-center mt-2">
            <MapPin size={14} color="#8B6F4E" />
            <Text className="text-wood text-sm ml-1">{farmstand.city ?? 'Oregon'}</Text>
            {distance !== null && (
              <>
                <Text className="text-wood text-sm mx-2">•</Text>
                <Navigation size={14} color="#2D5A3D" />
                <Text className="text-forest text-sm font-medium ml-1">
                  {distance < 10 ? distance.toFixed(1) : Math.round(distance)} mi
                </Text>
              </>
            )}
          </View>

          {/* Categories */}
          <View className="flex-row flex-wrap mt-3 gap-2">
            {farmstand.offerings.slice(0, 4).map((product, idx) => (
              <View
                key={idx}
                className="bg-cream px-2.5 py-1 rounded-full border border-sand"
              >
                <Text className="text-bark text-xs font-medium">{product}</Text>
              </View>
            ))}
            {farmstand.offerings.length > 4 && (
              <View className="bg-cream px-2.5 py-1 rounded-full border border-sand">
                <Text className="text-bark text-xs font-medium">
                  +{farmstand.offerings.length - 4}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function FavoritesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const hPad = isTablet ? 40 : 20;
  const [refreshing, setRefreshing] = useState(false);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // User store - check guest status
  const isGuest = useUserStore((s) => s.isGuest);

  // Stores
  const loadFavorites = useFavoritesStore((s) => s.loadFavorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const favorites = useFavoritesStore((s) => s.favorites);
  const isLoaded = useFavoritesStore((s) => s.isLoaded);

  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  // Load favorites on mount only — version-based guard in the store discards
  // this result if a toggle fires before it resolves.
  useEffect(() => {
    loadFavorites();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload farmstand details on every focus (needed for name/status/content updates)
  useFocusEffect(
    useCallback(() => {
      loadAdminData();
    }, [loadAdminData])
  );

  // Request location
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setUserLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
        }
      } catch (error) {
        console.log('Location error:', error);
      }
    })();
  }, []);

  // Get favorite farmstands from admin store — only after BOTH favorites and admin data are loaded
  const favoriteFarmstands = useMemo(() => {
    if (!isLoaded) return [];

    const result: Farmstand[] = [];
    for (const f of adminFarmstands) {
      if (
        favorites.has(f.id) &&
        !f.deletedAt &&
        f.status === 'active' &&
        f.showOnMap &&
        f.latitude &&
        f.longitude
      ) {
        result.push(f);
      }
    }

    return result;
  }, [adminFarmstands, favorites, isLoaded]);

  // Refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadFavorites(), loadAdminData()]);
    setRefreshing(false);
  }, [loadFavorites, loadAdminData]);

  const handleFarmstandPress = (farmstand: Farmstand) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackEvent('saved_card_tapped', { farmstand_id: farmstand.id, farmstand_name: farmstand.name });
    router.push(`/farm/${farmstand.id}`);
  };

  const handleRemoveFavorite = (farmstandId: string) => {
    const farm = favoriteFarmstands.find((f: Farmstand) => f.id === farmstandId);
    trackEvent('save_farmstand_tapped', { source: 'saved', farmstand_id: farmstandId, farmstand_name: farm?.name ?? null, new_saved_state: false });
    toggleFavorite(farmstandId);
  };

  const handleSignIn = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/auth/login');
  };

  const handleCreateAccount = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/auth/login');
  };

  // Show guest state if user is a guest
  if (isGuest()) {
    return (
      <View className="flex-1 bg-cream">
        <SafeAreaView edges={['top']} className="bg-cream">
          <View style={{ paddingHorizontal: hPad }} className="py-4 border-b border-sand">
            <Text className="text-charcoal text-2xl font-bold">Saved Stands</Text>
            <Text className="text-wood mt-1">Your favorite farm stands</Text>
          </View>
        </SafeAreaView>

        <View className="flex-1 items-center justify-center px-8">
          <View className="bg-sand/50 rounded-full p-6 mb-4">
            <Heart size={48} color="#8B6F4E" />
          </View>
          <Text className="text-charcoal text-xl font-bold mb-2 text-center">
            Sign in to save favorites
          </Text>
          <Text className="text-wood text-center mb-6 leading-6">
            Guest Mode: Guests can browse Farmstands but must sign in to leave reviews or save favorites.
          </Text>

          <Pressable
            onPress={handleSignIn}
            className="bg-forest px-8 py-4 rounded-xl flex-row items-center w-full justify-center mb-3"
          >
            <LogIn size={20} color="#FDF8F3" />
            <Text className="text-cream font-semibold text-base ml-2">Sign In</Text>
          </Pressable>

          <Pressable
            onPress={handleCreateAccount}
            className="bg-white border-2 border-forest px-8 py-4 rounded-xl flex-row items-center w-full justify-center"
          >
            <UserPlus size={20} color="#2D5A3D" />
            <Text className="text-forest font-semibold text-base ml-2">Create Account</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-cream">
        <View style={{ paddingHorizontal: hPad }} className="py-4 border-b border-sand">
          <Text className="text-charcoal text-2xl font-bold">Saved Stands</Text>
          <Text className="text-wood mt-1">
            {favoriteFarmstands.length > 0
              ? `${favoriteFarmstands.length} saved farm stand${favoriteFarmstands.length !== 1 ? 's' : ''}`
              : 'Your favorite farm stands'}
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: hPad, paddingTop: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#2D5A3D"
          />
        }
      >
        {!isLoaded ? (
          <View className="items-center py-12">
            <Text className="text-wood">Loading...</Text>
          </View>
        ) : favoriteFarmstands.length > 0 ? (
          favoriteFarmstands.map((farmstand, index) => (
            <SavedFarmstandCard
              key={farmstand.id}
              farmstand={farmstand}
              userLocation={userLocation}
              onPress={() => handleFarmstandPress(farmstand)}
              onRemove={() => handleRemoveFavorite(farmstand.id)}
              index={index}
            />
          ))
        ) : (
          <View className="items-center py-16">
            <View className="bg-sand/50 rounded-full p-6 mb-4">
              <Heart size={48} color="#8B6F4E" />
            </View>
            <Text className="text-charcoal text-lg font-semibold mb-2">
              No saved stands yet
            </Text>
            <Text className="text-wood text-center px-8">
              Tap the heart icon on any farm stand to save it here for quick access
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
