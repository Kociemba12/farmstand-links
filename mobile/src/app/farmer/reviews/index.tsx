import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, MessageSquare, ChevronRight, Filter } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, FarmerReview } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';

type FilterType = 'all' | 'unreplied' | '5star' | 'low' | 'flagged';

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unreplied', label: 'Unreplied' },
  { key: '5star', label: '5 Star' },
  { key: 'low', label: '1-2 Star' },
  { key: 'flagged', label: 'Flagged' },
];

function getRelativeTime(dateString: string): string {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return `${Math.floor(diffDays / 30)} months ago`;
}

export default function ReviewsListScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();

  const getReviewsByFarmstand = useFarmerStore((s) => s.getReviewsByFarmstand);

  const [reviews, setReviews] = useState<FarmerReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    if (farmstandId) {
      const data = getReviewsByFarmstand(farmstandId);
      setReviews(data);
      setIsLoading(false);
    }
  }, [farmstandId, getReviewsByFarmstand]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleFilterChange = async (newFilter: FilterType) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFilter(newFilter);
  };

  const handleReviewPress = async (reviewId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farmer/reviews/detail?farmstandId=${farmstandId}&reviewId=${reviewId}`);
  };

  const filteredReviews = reviews.filter((review) => {
    switch (filter) {
      case 'unreplied':
        return !review.replyText && !review.flagged;
      case '5star':
        return review.rating === 5 && !review.flagged;
      case 'low':
        return review.rating <= 2 && !review.flagged;
      case 'flagged':
        return review.flagged;
      default:
        return !review.flagged;
    }
  });

  const sortedReviews = [...filteredReviews].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  const averageRating =
    reviews.filter((r) => !r.flagged).length > 0
      ? (
          reviews.filter((r) => !r.flagged).reduce((sum, r) => sum + r.rating, 0) /
          reviews.filter((r) => !r.flagged).length
        ).toFixed(1)
      : '0.0';

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Reviews</Text>
        </View>
      </SafeAreaView>

      {/* Stats */}
      <View className="bg-white border-b border-sand px-5 py-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Star size={24} color="#D4943A" fill="#D4943A" />
            <Text className="text-charcoal font-bold text-2xl ml-2">{averageRating}</Text>
            <Text className="text-wood ml-2">
              ({reviews.filter((r) => !r.flagged).length} reviews)
            </Text>
          </View>
          <View className="flex-row items-center">
            <View className="bg-terracotta/10 px-3 py-1 rounded-full">
              <Text className="text-terracotta text-sm font-medium">
                {reviews.filter((r) => !r.replyText && !r.flagged).length} unreplied
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="bg-white border-b border-sand"
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12 }}
        style={{ flexGrow: 0 }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => handleFilterChange(f.key)}
            className={`px-4 py-2 rounded-full mr-2 ${
              filter === f.key ? 'bg-forest' : 'bg-cream border border-sand'
            }`}
          >
            <Text
              className={filter === f.key ? 'text-cream font-medium' : 'text-charcoal'}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-4">
          {sortedReviews.length === 0 ? (
            <View className="bg-white rounded-2xl p-8 border border-sand items-center">
              <MessageSquare size={48} color="#C4B5A4" />
              <Text className="text-charcoal font-bold text-lg mt-4">No Reviews Found</Text>
              <Text className="text-wood text-center mt-2">
                {filter === 'all'
                  ? "You haven't received any reviews yet."
                  : 'No reviews match this filter.'}
              </Text>
            </View>
          ) : (
            sortedReviews.map((review) => (
              <Pressable
                key={review.id}
                onPress={() => handleReviewPress(review.id)}
                className="bg-white rounded-2xl p-4 border border-sand mb-4 active:bg-sand/30"
              >
                <View className="flex-row items-start">
                  <View className="w-12 h-12 rounded-full bg-forest items-center justify-center">
                    <Text className="text-cream font-bold">{review.reviewerInitials}</Text>
                  </View>
                  <View className="ml-3 flex-1">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-charcoal font-semibold">{review.reviewerName}</Text>
                      <ChevronRight size={20} color="#8B6F4E" />
                    </View>
                    <View className="flex-row items-center mt-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={14}
                          color="#D4943A"
                          fill={star <= review.rating ? '#D4943A' : 'transparent'}
                        />
                      ))}
                      <Text className="text-wood text-xs ml-2">
                        {getRelativeTime(review.createdAt)}
                      </Text>
                    </View>
                    <Text className="text-charcoal mt-2" numberOfLines={2}>
                      {review.comment}
                    </Text>

                    {/* Status badges */}
                    <View className="flex-row mt-3">
                      {review.replyText ? (
                        <View className="bg-mint/20 px-2 py-1 rounded-full mr-2">
                          <Text className="text-forest text-xs font-medium">Replied</Text>
                        </View>
                      ) : (
                        <View className="bg-harvest/20 px-2 py-1 rounded-full mr-2">
                          <Text className="text-harvest text-xs font-medium">Awaiting Reply</Text>
                        </View>
                      )}
                      {review.flagged && (
                        <View className="bg-terracotta/10 px-2 py-1 rounded-full">
                          <Text className="text-terracotta text-xs font-medium">Flagged</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
