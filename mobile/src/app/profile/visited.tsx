import React, { useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, MapPin, Star, ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useAdminStore } from '@/lib/admin-store';
import { getFarmstandDisplayImage } from '@/lib/farmstand-image';
import * as Haptics from 'expo-haptics';

export default function VisitedScreen() {
  const router = useRouter();
  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  // Show approved farmstands only (this would eventually be filtered by actual visit history)
  // For now, show empty state since we don't have visit tracking yet
  const visitedFarms = useMemo(() => {
    // TODO: Replace with actual visit tracking from user store
    // For now, return empty array to show empty state
    return [];
  }, [adminFarmstands]);

  const handleFarmPress = async (farmId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farm/${farmId}`);
  };

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Visited Farms</Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          <Text className="text-wood text-sm mb-4">
            {visitedFarms.length} farm stands you've visited
          </Text>

          {visitedFarms.length === 0 ? (
            <View className="items-center py-12">
              <MapPin size={48} color="#E8DDD4" />
              <Text className="text-charcoal font-semibold text-lg mt-4">
                No visits yet
              </Text>
              <Text className="text-wood text-center mt-2">
                Start exploring farm stands to track your visits!
              </Text>
              <Pressable
                onPress={() => router.push('/(tabs)/map')}
                className="mt-6 bg-forest px-6 py-3 rounded-xl"
              >
                <Text className="text-cream font-medium">Explore Map</Text>
              </Pressable>
            </View>
          ) : (
            <View className="bg-white rounded-2xl overflow-hidden border border-sand">
              {visitedFarms.map((farm: { id: string; name: string; photos: string[]; mainPhotoIndex: number; offerings: string[]; categories: string[]; avgRating: number; city: string | null; primaryImageMode?: 'uploaded' | 'ai_fallback'; fallbackImageKey?: string | null; heroImageUrl?: string | null; heroImageTheme?: string | null; heroImageSeed?: number | null; mainProduct?: string | null; aiImageUrl?: string | null; aiImageSeed?: string | null }, index: number) => {
                const { url: imageUrl } = getFarmstandDisplayImage({
                  id: farm.id,
                  hero_image_url: farm.heroImageUrl,
                  ai_image_url: farm.aiImageUrl,
                  main_product: farm.mainProduct,
                  offerings: farm.offerings,
                  categories: farm.categories,
                });
                return (
                  <Pressable
                    key={farm.id}
                    onPress={() => handleFarmPress(farm.id)}
                    className={`flex-row p-4 ${
                      index !== visitedFarms.length - 1 ? 'border-b border-sand' : ''
                    }`}
                  >
                    <Image
                      source={{ uri: imageUrl }}
                      className="w-16 h-16 rounded-xl"
                      resizeMode="cover"
                    />
                    <View className="flex-1 ml-3 justify-center">
                      <Text className="text-charcoal font-semibold" numberOfLines={1}>
                        {farm.name}
                      </Text>
                      <View className="flex-row items-center mt-1">
                        <Star size={12} color="#D4943A" fill="#D4943A" />
                        <Text className="text-charcoal text-sm ml-1">{farm.avgRating ?? 0}</Text>
                        <Text className="text-wood text-sm ml-2">• {farm.city ?? 'Unknown'}</Text>
                      </View>
                      <Text className="text-wood text-xs mt-1">
                        Visited recently
                      </Text>
                    </View>
                    <ChevronRight size={18} color="#8B6F4E" />
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
