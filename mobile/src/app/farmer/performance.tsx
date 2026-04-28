import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Check,
  X,
  Camera,
  FileText,
  Clock,
  MapPin,
  ShoppingBag,
  ChevronRight,
  Trophy,
} from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, Farmstand, Product } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';
import { LucideIcon } from 'lucide-react-native';

interface PerformanceItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  points: number;
  completed: boolean;
  fixRoute?: string;
}

export default function PerformanceScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();

  const getFarmstandById = useFarmerStore((s) => s.getFarmstandById);
  const getProductsByFarmstand = useFarmerStore((s) => s.getProductsByFarmstand);

  const [isLoading, setIsLoading] = useState(true);
  const [farmstand, setFarmstand] = useState<Farmstand | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (farmstandId) {
      const farmstandData = getFarmstandById(farmstandId);
      const productsData = getProductsByFarmstand(farmstandId);
      setFarmstand(farmstandData || null);
      setProducts(productsData);
      setIsLoading(false);
    }
  }, [farmstandId, getFarmstandById, getProductsByFarmstand]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleFix = async (route: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as any);
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  if (!farmstand) {
    return (
      <View className="flex-1 bg-cream items-center justify-center px-6">
        <Text className="text-charcoal font-bold text-lg mb-2">Not Found</Text>
        <Pressable onPress={handleBack} className="bg-forest px-6 py-3 rounded-xl">
          <Text className="text-cream font-semibold">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  // Calculate performance items
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const hasRecentProducts = products.some(
    (p) => new Date(p.updatedAt).getTime() > thirtyDaysAgo
  );

  const performanceItems: PerformanceItem[] = [
    {
      id: 'photos',
      label: 'Add Photos',
      description: 'Listings with photos get 3x more views',
      icon: Camera,
      points: 25,
      completed: farmstand.photos && farmstand.photos.length > 0,
      fixRoute: `/farmer/listing/edit?farmstandId=${farmstandId}`,
    },
    {
      id: 'description',
      label: 'Write a Description',
      description: 'Tell customers about your farm',
      icon: FileText,
      points: 15,
      completed: !!farmstand.description && farmstand.description.length > 20,
      fixRoute: `/farmer/listing/edit?farmstandId=${farmstandId}`,
    },
    {
      id: 'hours',
      label: 'Set Operating Hours',
      description: 'Let customers know when to visit',
      icon: Clock,
      points: 15,
      completed: !!farmstand.hours,
      fixRoute: `/farmer/hours?farmstandId=${farmstandId}`,
    },
    {
      id: 'location',
      label: 'Pin Your Location',
      description: 'Help customers find you on the map',
      icon: MapPin,
      points: 20,
      completed: !!farmstand.latitude && !!farmstand.longitude,
      fixRoute: `/farmer/location?farmstandId=${farmstandId}`,
    },
    {
      id: 'products',
      label: 'Keep Products Updated',
      description: 'Updated within the last 30 days',
      icon: ShoppingBag,
      points: 15,
      completed: products.length > 0 && hasRecentProducts,
      fixRoute: `/farmer/products?farmstandId=${farmstandId}`,
    },
  ];

  const completedPoints = performanceItems
    .filter((item) => item.completed)
    .reduce((sum, item) => sum + item.points, 0);
  const totalPoints = performanceItems.reduce((sum, item) => sum + item.points, 0);
  const score = Math.round((completedPoints / totalPoints) * 100);

  const performanceLabel = score >= 85 ? 'Great' : score >= 70 ? 'Good' : 'Needs Attention';
  const performanceColor =
    score >= 85 ? 'text-forest' : score >= 70 ? 'text-harvest' : 'text-terracotta';
  const performanceBg =
    score >= 85 ? 'bg-mint/20' : score >= 70 ? 'bg-harvest/20' : 'bg-terracotta/10';

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Performance</Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {/* Score Card */}
          <View className="bg-white rounded-2xl p-6 border border-sand mb-6 items-center">
            <View className={`w-24 h-24 rounded-full ${performanceBg} items-center justify-center mb-4`}>
              <Trophy size={40} color={score >= 85 ? '#2D5A3D' : score >= 70 ? '#D4943A' : '#C4653A'} />
            </View>
            <Text className={`font-bold text-3xl ${performanceColor}`}>{performanceLabel}</Text>
            <Text className="text-wood mt-2">Performance Score: {score}%</Text>

            {/* Progress Bar */}
            <View className="w-full h-3 bg-sand rounded-full mt-4 overflow-hidden">
              <View
                className={`h-full rounded-full ${
                  score >= 85 ? 'bg-forest' : score >= 70 ? 'bg-harvest' : 'bg-terracotta'
                }`}
                style={{ width: `${score}%` }}
              />
            </View>
            <Text className="text-wood text-sm mt-2">
              {completedPoints} / {totalPoints} points earned
            </Text>
          </View>

          {/* Checklist */}
          <Text className="text-charcoal font-bold text-lg mb-4">Performance Checklist</Text>
          <View className="bg-white rounded-2xl border border-sand overflow-hidden">
            {performanceItems.map((item, index) => (
              <View
                key={item.id}
                className={`p-4 ${
                  index !== performanceItems.length - 1 ? 'border-b border-sand' : ''
                }`}
              >
                <View className="flex-row items-start">
                  <View
                    className={`w-10 h-10 rounded-full items-center justify-center ${
                      item.completed ? 'bg-mint/20' : 'bg-terracotta/10'
                    }`}
                  >
                    {item.completed ? (
                      <Check size={20} color="#2D5A3D" />
                    ) : (
                      <item.icon size={20} color="#C4653A" />
                    )}
                  </View>
                  <View className="ml-3 flex-1">
                    <View className="flex-row items-center justify-between">
                      <Text
                        className={`font-semibold ${
                          item.completed ? 'text-charcoal' : 'text-terracotta'
                        }`}
                      >
                        {item.label}
                      </Text>
                      <View className="bg-sand px-2 py-0.5 rounded-full">
                        <Text className="text-wood text-xs">+{item.points} pts</Text>
                      </View>
                    </View>
                    <Text className="text-wood text-sm mt-1">{item.description}</Text>

                    {!item.completed && item.fixRoute && (
                      <Pressable
                        onPress={() => handleFix(item.fixRoute!)}
                        className="flex-row items-center mt-3 bg-forest py-2 px-4 rounded-lg self-start"
                      >
                        <Text className="text-cream font-medium">Fix This</Text>
                        <ChevronRight size={16} color="#FDF8F3" />
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>

          {/* Tips */}
          {score < 100 && (
            <View className="bg-harvest/10 rounded-2xl p-4 border border-harvest/30 mt-6">
              <Text className="text-charcoal font-semibold mb-2">Why This Matters</Text>
              <Text className="text-bark text-sm">
                Complete listings are more likely to appear in search results and attract
                customers. Each item on this checklist helps improve your visibility and
                credibility.
              </Text>
            </View>
          )}

          {score === 100 && (
            <View className="bg-mint/10 rounded-2xl p-4 border border-mint/30 mt-6">
              <View className="flex-row items-center">
                <Trophy size={24} color="#2D5A3D" />
                <Text className="text-forest font-semibold ml-2">Perfect Score!</Text>
              </View>
              <Text className="text-bark text-sm mt-2">
                Your listing is fully optimized. Keep your information up to date to maintain
                your great performance.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
