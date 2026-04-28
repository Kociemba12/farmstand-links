import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, ChevronRight, MessageSquare } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useReviewsStore, Review } from '@/lib/reviews-store';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import * as Haptics from 'expo-haptics';

export default function ReviewsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const reviewsByFarm = useReviewsStore((s) => s.reviewsByFarm);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);

  // Filter reviews to only show ones authored by the current user
  const userReviews = useMemo(() => {
    if (!user?.id) return [];

    const allReviews: Review[] = Object.values(reviewsByFarm).flat();

    return allReviews
      .filter((review: Review) => {
        const isAuthor = review.userId === user.id || review.userName === user.name || review.userName === user.email;
        if (!isAuthor) return false;
        return true;
      })
      .sort((a: Review, b: Review) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [reviewsByFarm, user?.id, user?.name, user?.email]);

  // Map reviews to include farmstand data
  const reviewsWithFarms = useMemo(() => {
    return userReviews.map((review: Review) => {
      const farmstand = allFarmstands.find((f) => f.id === review.farmId);
      return {
        ...review,
        farm: farmstand ? {
          id: farmstand.id,
          name: farmstand.name,
          city: farmstand.city,
          image: farmstand.photos?.[farmstand.mainPhotoIndex ?? 0] || farmstand.photos?.[0],
        } : null,
      };
    }).filter((r) => r.farm !== null);
  }, [userReviews, allFarmstands]);

  const handleFarmPress = async (farmId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farm/${farmId}`);
  };

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
      {/* Light header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FDF8F3' }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}>
          <Pressable onPress={() => router.back()} style={{ marginBottom: 12, alignSelf: 'flex-start', padding: 2, marginLeft: -2 }}>
            <ArrowLeft size={22} color="#4A7C59" />
          </Pressable>
          <Text style={{ fontSize: 26, fontWeight: '700', color: '#2C2420', letterSpacing: -0.3 }}>My Reviews</Text>
          <Text style={{ fontSize: 14, color: '#A8906E', marginTop: 2 }}>
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
                <Pressable
                  key={review.id}
                  onPress={() => review.farm && handleFarmPress(review.farm.id)}
                  style={{
                    backgroundColor: '#fff', borderRadius: 18, padding: 16,
                    marginBottom: 14,
                    shadowColor: 'rgba(0,0,0,0.06)', shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 1, shadowRadius: 8, elevation: 2,
                  }}
                >
                  {/* Farm Info */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                    {review.farm?.image ? (
                      <Image
                        source={{ uri: review.farm.image }}
                        style={{ width: 48, height: 48, borderRadius: 12 }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: '#F0EBE3', alignItems: 'center', justifyContent: 'center' }}>
                        <MessageSquare size={20} color="#A8906E" />
                      </View>
                    )}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#2C2420' }} numberOfLines={1}>
                        {review.farm?.name || 'Unknown Farmstand'}
                      </Text>
                      <Text style={{ fontSize: 13, color: '#A8906E', marginTop: 2 }}>{review.farm?.city || ''}</Text>
                    </View>
                    <ChevronRight size={17} color="#C4B5A5" />
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
                      {formatDate(review.date)}
                    </Text>
                  </View>

                  {/* Review Text */}
                  <Text style={{ fontSize: 14, color: '#44403C', lineHeight: 21 }}>{review.text}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
