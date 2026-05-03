import React, { useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, TouchableOpacity, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, ChevronRight, MessageSquare, Trash2 } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useReviewsStore } from '@/lib/reviews-store';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DELETE_THRESHOLD = 80;
const FULL_SWIPE_THRESHOLD = SCREEN_WIDTH * 0.4;

interface ReviewWithFarm {
  id: string;
  farmId: string;
  rating: number;
  text: string;
  createdAt: string;
  farmstandDeleted: boolean;
  farm: { id: string; name: string; city: string | null };
}

function SwipeableReviewCard({
  review,
  onPress,
  onDelete,
  formatDate,
}: {
  review: ReviewWithFarm;
  onPress: () => void;
  onDelete: () => void;
  formatDate: (d: string) => string;
}) {
  const translateX = useSharedValue(0);
  const rowOpacity = useSharedValue(1);
  const rowHeight = useSharedValue(-1); // -1 = auto (unmeasured)
  const measuredHeight = useSharedValue(0);
  const isDeleting = useSharedValue(false);

  const triggerDelete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDelete();
  }, [onDelete]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((event) => {
      if (event.translationX < 0) {
        translateX.value = Math.max(event.translationX, -SCREEN_WIDTH * 0.5);
      } else {
        translateX.value = 0;
      }
    })
    .onEnd(() => {
      if (translateX.value < -FULL_SWIPE_THRESHOLD) {
        isDeleting.value = true;
        translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 });
        rowHeight.value = withTiming(0, { duration: 200 });
        rowOpacity.value = withTiming(0, { duration: 200 }, () => {
          runOnJS(triggerDelete)();
        });
      } else if (translateX.value < -DELETE_THRESHOLD / 2) {
        translateX.value = withSpring(-DELETE_THRESHOLD, { damping: 20 });
      } else {
        translateX.value = withSpring(0, { damping: 20 });
      }
    });

  const tapGesture = Gesture.Tap().onStart(() => {
    if (translateX.value < -10) {
      translateX.value = withSpring(0, { damping: 20 });
    } else {
      runOnJS(onPress)();
    }
  });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const rowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const containerAnimatedStyle = useAnimatedStyle(() => {
    if (rowHeight.value < 0) return { opacity: rowOpacity.value };
    return { height: rowHeight.value, opacity: rowOpacity.value, overflow: 'hidden' };
  });

  const deleteButtonAnimatedStyle = useAnimatedStyle(() => {
    const width = interpolate(
      translateX.value,
      [-SCREEN_WIDTH * 0.5, -DELETE_THRESHOLD, 0],
      [SCREEN_WIDTH * 0.5, DELETE_THRESHOLD, 0],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      translateX.value,
      [-DELETE_THRESHOLD, -20, 0],
      [1, 0.5, 0],
      Extrapolation.CLAMP
    );
    return { width, opacity };
  });

  const handleDeleteButtonPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    isDeleting.value = true;
    translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 });
    rowHeight.value = withTiming(0, { duration: 200 });
    rowOpacity.value = withTiming(0, { duration: 200 }, () => {
      runOnJS(triggerDelete)();
    });
  };

  return (
    <Animated.View style={[containerAnimatedStyle, { marginBottom: 14 }]}>
      <View style={{ position: 'relative', flexDirection: 'row' }}>
        {/* Red delete button behind */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: '#DC2626',
              borderRadius: 18,
              justifyContent: 'center',
              alignItems: 'center',
            },
            deleteButtonAnimatedStyle,
          ]}
        >
          <Pressable
            onPress={handleDeleteButtonPress}
            style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, flex: 1 }}
          >
            <Trash2 size={20} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 3 }}>Delete</Text>
          </Pressable>
        </Animated.View>

        {/* Card */}
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            style={[
              rowAnimatedStyle,
              {
                flex: 1,
                backgroundColor: '#fff',
                borderRadius: 18,
                padding: 16,
                shadowColor: 'rgba(0,0,0,0.06)',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 1,
                shadowRadius: 8,
                elevation: 2,
              },
            ]}
            onLayout={(e) => {
              if (measuredHeight.value === 0) {
                measuredHeight.value = e.nativeEvent.layout.height;
              }
            }}
          >
            {/* Farm Info */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: '#F0EBE3', alignItems: 'center', justifyContent: 'center' }}>
                <MessageSquare size={20} color={review.farmstandDeleted ? '#C4B5A5' : '#A8906E'} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: review.farmstandDeleted ? '#9CA3AF' : '#2C2420' }} numberOfLines={1}>
                  {review.farmstandDeleted ? 'Farmstand deleted' : review.farm.name}
                </Text>
                <Text style={{ fontSize: 13, color: '#C4B5A5', marginTop: 2 }}>
                  {review.farmstandDeleted ? 'This listing is no longer available' : review.farm.city ?? ''}
                </Text>
              </View>
              {!review.farmstandDeleted && <ChevronRight size={17} color="#C4B5A5" />}
            </View>

            {/* Rating + Date */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  size={15}
                  color="#D4943A"
                  fill={star <= review.rating ? '#D4943A' : 'transparent'}
                />
              ))}
              <Text style={{ fontSize: 12, color: '#A8906E', marginLeft: 8 }}>
                {formatDate(review.createdAt)}
              </Text>
            </View>

            {/* Review Text */}
            <Text style={{ fontSize: 14, color: '#44403C', lineHeight: 21 }}>{review.text}</Text>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

export default function ReviewsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const myReviews = useReviewsStore((s) => s.myReviews);
  const loadMyReviews = useReviewsStore((s) => s.loadMyReviews);
  const deleteMyReview = useReviewsStore((s) => s.deleteMyReview);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);

  useEffect(() => {
    if (user?.id) {
      loadMyReviews(user.id);
    }
  }, [user?.id, loadMyReviews]);

  const reviewsWithFarms = useMemo<ReviewWithFarm[]>(() => {
    return myReviews.map((review) => {
      const farmstand = allFarmstands.find((f) => f.id === review.farmId);
      const farmstandDeleted = !farmstand || farmstand.deletedAt != null;
      return {
        id: review.id,
        farmId: review.farmId,
        rating: review.rating,
        text: review.text,
        createdAt: review.createdAt,
        farmstandDeleted,
        farm: {
          id: review.farmId,
          name: farmstand?.name ?? 'Farmstand',
          city: farmstand?.city ?? null,
        },
      };
    });
  }, [myReviews, allFarmstands]);

  const handleFarmPress = useCallback(async (farmId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farm/${farmId}`);
  }, [router]);

  const handleDeleteRequest = useCallback((reviewId: string) => {
    Alert.alert(
      'Delete review?',
      'This will permanently remove your review.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            const { success, error } = await deleteMyReview(reviewId, user.id);
            if (!success) {
              Alert.alert('Error', error ?? 'Could not delete review. Please try again.');
            }
          },
        },
      ]
    );
  }, [user?.id, deleteMyReview]);

  const handleExplore = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FDF8F3' }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FDF8F3' }}>
        <View style={{ paddingTop: 4, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}>
          <View style={{ position: 'relative', height: 56, justifyContent: 'center' }}>
            <Text
              pointerEvents="none"
              style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#2C2420', zIndex: 0 }}
            >
              My Reviews
            </Text>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ position: 'absolute', left: 16, zIndex: 10, elevation: 10, padding: 4 }}
            >
              <ArrowLeft size={22} color="#4A7C59" />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 14, color: '#A8906E', marginTop: 2, textAlign: 'center' }}>
            {reviewsWithFarms.length > 0
              ? `${reviewsWithFarms.length} review${reviewsWithFarms.length !== 1 ? 's' : ''} written`
              : 'Your written reviews'}
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48 }}>
          {reviewsWithFarms.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 64, paddingBottom: 40, paddingHorizontal: 32 }}>
              <View style={{
                width: 80, height: 80, borderRadius: 40,
                backgroundColor: '#F0EBE3',
                alignItems: 'center', justifyContent: 'center', marginBottom: 20,
              }}>
                <MessageSquare size={36} color="#A8906E" />
              </View>
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#2C2420', textAlign: 'center', marginBottom: 8 }}>
                No reviews yet
              </Text>
              <Text style={{ fontSize: 14, color: '#A8906E', textAlign: 'center', lineHeight: 21 }}>
                Reviews you write will show up here.
              </Text>
              <Pressable
                onPress={handleExplore}
                style={{
                  marginTop: 28,
                  backgroundColor: '#4A7C59',
                  paddingHorizontal: 28,
                  paddingVertical: 14,
                  borderRadius: 14,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Explore Farmstands</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              {reviewsWithFarms.map((review) => (
                <SwipeableReviewCard
                  key={review.id}
                  review={review}
                  onPress={review.farmstandDeleted ? () => {} : () => handleFarmPress(review.farm.id)}
                  onDelete={() => handleDeleteRequest(review.id)}
                  formatDate={formatDate}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
