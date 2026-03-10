import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, TrendingUp, TrendingDown } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, FarmerReview } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';

export default function AnalyticsRatingsScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();

  const getReviewsByFarmstand = useFarmerStore((s) => s.getReviewsByFarmstand);

  const [reviews, setReviews] = useState<FarmerReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (farmstandId) {
      const data = getReviewsByFarmstand(farmstandId);
      setReviews(data.filter((r) => !r.flagged));
      setIsLoading(false);
    }
  }, [farmstandId, getReviewsByFarmstand]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const analytics = useMemo(() => {
    if (reviews.length === 0) {
      return {
        averageRating: 0,
        totalReviews: 0,
        distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        trend: 0,
        recentAverage: 0,
      };
    }

    const totalReviews = reviews.length;
    const averageRating =
      reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews;

    // Rating distribution
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    reviews.forEach((r) => {
      distribution[r.rating as keyof typeof distribution]++;
    });

    // Calculate trend (recent 10 vs. older reviews)
    const sortedReviews = [...reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const recentReviews = sortedReviews.slice(0, Math.min(10, Math.ceil(totalReviews / 2)));
    const olderReviews = sortedReviews.slice(recentReviews.length);

    const recentAverage =
      recentReviews.length > 0
        ? recentReviews.reduce((sum, r) => sum + r.rating, 0) / recentReviews.length
        : 0;
    const olderAverage =
      olderReviews.length > 0
        ? olderReviews.reduce((sum, r) => sum + r.rating, 0) / olderReviews.length
        : recentAverage;

    const trend = recentAverage - olderAverage;

    return {
      averageRating,
      totalReviews,
      distribution,
      trend,
      recentAverage,
    };
  }, [reviews]);

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  const maxDistribution = Math.max(...Object.values(analytics.distribution), 1);

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Ratings Analytics</Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {/* Overall Rating Card */}
          <View className="bg-white rounded-2xl p-6 border border-sand mb-6">
            <View className="flex-row items-center justify-center mb-4">
              <Star size={40} color="#D4943A" fill="#D4943A" />
              <Text className="text-charcoal font-bold text-5xl ml-3">
                {analytics.averageRating.toFixed(1)}
              </Text>
            </View>
            <View className="flex-row justify-center mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  size={24}
                  color="#D4943A"
                  fill={star <= Math.round(analytics.averageRating) ? '#D4943A' : 'transparent'}
                />
              ))}
            </View>
            <Text className="text-wood text-center">
              Based on {analytics.totalReviews} reviews
            </Text>
          </View>

          {/* Trend Card */}
          <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
            <Text className="text-charcoal font-bold text-lg mb-3">Rating Trend</Text>
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-wood text-sm">Recent reviews average</Text>
                <Text className="text-charcoal font-bold text-2xl">
                  {analytics.recentAverage.toFixed(1)}
                </Text>
              </View>
              <View
                className={`flex-row items-center px-4 py-2 rounded-full ${
                  analytics.trend >= 0 ? 'bg-mint/20' : 'bg-terracotta/10'
                }`}
              >
                {analytics.trend >= 0 ? (
                  <TrendingUp size={20} color="#2D5A3D" />
                ) : (
                  <TrendingDown size={20} color="#C4653A" />
                )}
                <Text
                  className={`ml-2 font-semibold ${
                    analytics.trend >= 0 ? 'text-forest' : 'text-terracotta'
                  }`}
                >
                  {analytics.trend >= 0 ? '+' : ''}
                  {analytics.trend.toFixed(1)}
                </Text>
              </View>
            </View>
            <Text className="text-wood text-sm mt-2">
              {analytics.trend >= 0
                ? 'Your ratings are improving!'
                : 'Your ratings have dipped recently.'}
            </Text>
          </View>

          {/* Rating Distribution */}
          <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
            <Text className="text-charcoal font-bold text-lg mb-4">Rating Distribution</Text>
            {[5, 4, 3, 2, 1].map((rating) => {
              const count = analytics.distribution[rating as keyof typeof analytics.distribution];
              const percentage =
                analytics.totalReviews > 0
                  ? Math.round((count / analytics.totalReviews) * 100)
                  : 0;

              return (
                <View key={rating} className="flex-row items-center mb-3 last:mb-0">
                  <View className="flex-row items-center w-12">
                    <Text className="text-charcoal font-medium">{rating}</Text>
                    <Star size={14} color="#D4943A" fill="#D4943A" />
                  </View>
                  <View className="flex-1 h-4 bg-sand rounded-full mx-3 overflow-hidden">
                    <View
                      className="h-full bg-harvest rounded-full"
                      style={{ width: `${(count / maxDistribution) * 100}%` }}
                    />
                  </View>
                  <Text className="text-wood text-sm w-16 text-right">
                    {count} ({percentage}%)
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Tips */}
          <View className="bg-mint/10 rounded-2xl p-4 border border-mint/30">
            <Text className="text-charcoal font-semibold mb-2">Tips to Improve Ratings</Text>
            <Text className="text-bark text-sm">
              • Respond promptly to customer reviews{'\n'}
              • Maintain consistent product quality{'\n'}
              • Keep your listing photos up to date{'\n'}
              • Provide excellent customer service
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
