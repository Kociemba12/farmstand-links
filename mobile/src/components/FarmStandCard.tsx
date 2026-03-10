import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { Heart, MapPin, Clock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useFavoritesStore } from '@/lib/favorites-store';
import type { FarmStand } from '@/lib/farm-data';
import { getFarmstandDisplayImage, DEFAULT_PLACEHOLDER_IMAGE } from '@/lib/farmstand-image';
import * as Haptics from 'expo-haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface FarmStandCardProps {
  farm: FarmStand;
  variant?: 'default' | 'compact';
}

export function FarmStandCard({ farm, variant = 'default' }: FarmStandCardProps) {
  const router = useRouter();
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const isFavorite = useFavoritesStore((s) => s.favorites.has(farm.id));

  const scale = useSharedValue(1);
  const heartScale = useSharedValue(1);

  // Use unified image selection - single source of truth
  const [cardImage, setCardImage] = useState<string>(() => {
    return getFarmstandDisplayImage({
      id: farm.id,
      hero_image_url: farm.image,
      offerings: farm.products || [],
      categories: farm.features || [],
    }).url;
  });

  // Handle image load error - switch to placeholder
  const handleImageError = useCallback(() => {
    setCardImage(DEFAULT_PLACEHOLDER_IMAGE);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 15 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15 });
  };

  const handleFavoritePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    heartScale.value = withSpring(1.3, { damping: 10 }, () => {
      heartScale.value = withSpring(1, { damping: 10 });
    });
    toggleFavorite(farm.id);
  };

  const handlePress = () => {
    router.push(`/farm/${farm.id}`);
  };

  if (variant === 'compact') {
    return (
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={animatedStyle}
        className="flex-row bg-white rounded-2xl overflow-hidden shadow-sm mb-3 border border-sand"
      >
        <Image
          source={{ uri: cardImage }}
          className="w-24 h-24"
          resizeMode="cover"
          onError={handleImageError}
        />
        <View className="flex-1 p-3 justify-between">
          <View>
            <Text className="text-charcoal font-semibold text-base" numberOfLines={1}>
              {farm.name}
            </Text>
            <View className="flex-row items-center mt-1">
              <View className="bg-forest/10 px-1.5 py-0.5 rounded">
                <Text className="text-forest text-xs font-semibold">New</Text>
              </View>
              <Text className="text-wood text-xs ml-2">• {farm.distance}</Text>
            </View>
          </View>
          <View className="flex-row items-center">
            <Text className="text-wood text-xs">{farm.distance}</Text>
          </View>
        </View>
        <Pressable
          onPress={handleFavoritePress}
          hitSlop={12}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.35,
            shadowRadius: 3,
            elevation: 4,
          }}
        >
          <Animated.View style={heartAnimatedStyle}>
            <Heart
              size={24}
              color="#FFFFFF"
              fill={isFavorite ? '#4A7C59' : 'transparent'}
              strokeWidth={2}
            />
          </Animated.View>
        </Pressable>
      </AnimatedPressable>
    );
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={animatedStyle}
      className="bg-white rounded-2xl overflow-hidden shadow-sm mb-4 border border-sand"
    >
      <View className="relative">
        <Image
          source={{ uri: cardImage }}
          className="w-full h-44"
          resizeMode="cover"
          onError={handleImageError}
        />
        <Pressable
          onPress={handleFavoritePress}
          hitSlop={12}
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

      <View className="p-4">
        <View className="flex-row items-start justify-between">
          <Text className="text-charcoal font-bold text-lg flex-1 mr-2" numberOfLines={1}>
            {farm.name}
          </Text>
          <View className="flex-row items-center bg-forest/10 px-2 py-1 rounded-lg">
            <Text className="text-forest font-semibold text-sm">New</Text>
          </View>
        </View>

        <View className="flex-row items-center mt-2">
          <MapPin size={14} color="#8B6F4E" />
          <Text className="text-wood text-sm ml-1">{farm.city}</Text>
        </View>

        <View className="flex-row items-center mt-2">
          <Clock size={14} color="#8B6F4E" />
          <Text className="text-wood text-sm ml-1">{farm.hours}</Text>
        </View>

        <View className="flex-row flex-wrap mt-3 gap-2">
          {farm.products.slice(0, 4).map((product, index) => (
            <View key={index} className="bg-cream px-2.5 py-1 rounded-full border border-sand">
              <Text className="text-bark text-xs font-medium">{product}</Text>
            </View>
          ))}
          {farm.products.length > 4 && (
            <View className="bg-cream px-2.5 py-1 rounded-full border border-sand">
              <Text className="text-bark text-xs font-medium">+{farm.products.length - 4} more</Text>
            </View>
          )}
        </View>
      </View>
    </AnimatedPressable>
  );
}
