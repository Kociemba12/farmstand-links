import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Star, MessageSquare, ChevronRight, Store } from 'lucide-react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useReviewsStore, Review } from '@/lib/reviews-store';
import { useBootstrapStore } from '@/lib/bootstrap-store';
import { useAdminStore } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';

const CREAM = '#FDF8F3';
const FOREST = '#2D5A3D';
const BORDER = '#EDE8E0';

type FilterType = 'all' | 'unreplied' | '5star' | '4star' | '3star' | 'low';
type TabType = 'received' | 'written';

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unreplied', label: 'Unreplied' },
  { key: '5star', label: '5 Star' },
  { key: '4star', label: '4 Star' },
  { key: '3star', label: '3 Star' },
  { key: 'low', label: '1–2 Star' },
];

type ReviewWithFarm = Review & { farmstandName: string };

function StarRow({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={size}
          color="#D4943A"
          fill={s <= rating ? '#D4943A' : 'transparent'}
        />
      ))}
    </View>
  );
}

export default function ReviewsListScreen() {
  const router = useRouter();
  const { farmstandId: paramFarmstandId } = useLocalSearchParams<{ farmstandId?: string }>();

  const loadReviewsForFarm = useReviewsStore((s) => s.loadReviewsForFarm);
  const reviewsByFarm = useReviewsStore((s) => s.reviewsByFarm);
  const myReviews = useReviewsStore((s) => s.myReviews);
  const loadMyReviews = useReviewsStore((s) => s.loadMyReviews);
  const ownedFarmstands = useBootstrapStore((s) => s.userFarmstands);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const user = useUserStore((s) => s.user);

  const [activeTab, setActiveTab] = useState<TabType>('received');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingWritten, setIsLoadingWritten] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  const farmIds = useMemo(
    () => (paramFarmstandId ? [paramFarmstandId] : ownedFarmstands.map((f) => f.id)),
    [paramFarmstandId, ownedFarmstands]
  );

  const farmNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of ownedFarmstands) map[f.id] = f.name;
    for (const f of allFarmstands) if (f.name) map[f.id] = f.name;
    return map;
  }, [ownedFarmstands, allFarmstands]);

  const allReceivedReviews: ReviewWithFarm[] = useMemo(() => {
    const result: ReviewWithFarm[] = [];
    for (const farmId of farmIds) {
      for (const r of reviewsByFarm[farmId] ?? []) {
        result.push({ ...r, farmstandName: farmNameById[farmId] ?? '' });
      }
    }
    return result.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [farmIds, reviewsByFarm, farmNameById]);

  const myWrittenReviews: ReviewWithFarm[] = useMemo(
    () => myReviews.map((r) => ({ ...r, farmstandName: farmNameById[r.farmId] ?? '' })),
    [myReviews, farmNameById]
  );

  const doLoadReceived = useCallback(async () => {
    if (farmIds.length === 0) {
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    await Promise.all(farmIds.map((id) => loadReviewsForFarm(id)));
    setIsLoading(false);
    setIsRefreshing(false);
  }, [farmIds, loadReviewsForFarm]);

  const doLoadWritten = useCallback(async () => {
    if (!user?.id) return;
    setIsLoadingWritten(true);
    await loadMyReviews(user.id);
    setIsLoadingWritten(false);
  }, [user?.id, loadMyReviews]);

  useEffect(() => {
    doLoadReceived();
  }, [doLoadReceived]);

  useFocusEffect(
    useCallback(() => {
      doLoadReceived();
    }, [doLoadReceived])
  );

  // Load written reviews when that tab becomes active
  useEffect(() => {
    if (activeTab === 'written') {
      doLoadWritten();
    }
  }, [activeTab, doLoadWritten]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    if (activeTab === 'received') {
      doLoadReceived();
    } else {
      doLoadWritten().finally(() => setIsRefreshing(false));
    }
  };

  const filteredReviews = useMemo(
    () =>
      allReceivedReviews.filter((r) => {
        switch (filter) {
          case 'unreplied': return !r.response;
          case '5star': return r.rating === 5;
          case '4star': return r.rating === 4;
          case '3star': return r.rating === 3;
          case 'low': return r.rating <= 2;
          default: return true;
        }
      }),
    [allReceivedReviews, filter]
  );

  const avgRating =
    allReceivedReviews.length > 0
      ? (allReceivedReviews.reduce((s, r) => s + r.rating, 0) / allReceivedReviews.length).toFixed(1)
      : '—';
  const unrepliedCount = allReceivedReviews.filter((r) => !r.response).length;
  const showFarmName = farmIds.length > 1;

  const handleTabPress = async (tab: TabType) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: CREAM, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={FOREST} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      {/* Header */}
      <SafeAreaView
        edges={['top']}
        style={{ backgroundColor: CREAM, borderBottomWidth: 1, borderBottomColor: BORDER }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            hitSlop={12}
            style={{ padding: 10, borderRadius: 20 }}
          >
            <ChevronLeft size={24} color="#44403C" />
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#44403C' }}>
            Reviews
          </Text>
          <View style={{ width: 44 }} />
        </View>

        {/* Segmented Tab Control */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 4 }}>
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: '#EEEAE4',
              borderRadius: 12,
              padding: 3,
            }}
          >
            {([
              { key: 'received' as TabType, label: 'Received' },
              { key: 'written' as TabType, label: 'Written by Me' },
            ] as const).map(({ key, label }) => (
              <Pressable
                key={key}
                onPress={() => handleTabPress(key)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 10,
                  alignItems: 'center',
                  backgroundColor: activeTab === key ? '#FFFFFF' : 'transparent',
                  shadowColor: activeTab === key ? '#000' : 'transparent',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: activeTab === key ? 0.08 : 0,
                  shadowRadius: 3,
                  elevation: activeTab === key ? 2 : 0,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: activeTab === key ? '600' : '500',
                    color: activeTab === key ? '#1C1917' : '#78716C',
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </SafeAreaView>

      {/* ── RECEIVED TAB ── */}
      {activeTab === 'received' && (
        <>
          {/* Summary Bar */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingVertical: 13,
              backgroundColor: CREAM,
              borderBottomWidth: 1,
              borderBottomColor: BORDER,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Star size={16} color="#D4943A" fill="#D4943A" />
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#1C1917', letterSpacing: -0.3 }}>
                {avgRating}
              </Text>
              <Text style={{ fontSize: 14, color: '#A8906E', marginLeft: 2 }}>
                {allReceivedReviews.length} {allReceivedReviews.length === 1 ? 'review' : 'reviews'}
              </Text>
            </View>
            {unrepliedCount > 0 && (
              <View
                style={{
                  backgroundColor: '#FFF8EC',
                  borderWidth: 1,
                  borderColor: '#F0D070',
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 99,
                }}
              >
                <Text style={{ color: '#92600A', fontSize: 12, fontWeight: '600' }}>
                  {unrepliedCount} unreplied
                </Text>
              </View>
            )}
          </View>

          {/* Filter Chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, backgroundColor: CREAM, borderBottomWidth: 1, borderBottomColor: BORDER }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
          >
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                onPress={async () => {
                  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setFilter(f.key);
                }}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 7,
                  borderRadius: 99,
                  backgroundColor: filter === f.key ? FOREST : '#EDE8E0',
                }}
              >
                <Text
                  style={{
                    color: filter === f.key ? '#FFFFFF' : '#78716C',
                    fontWeight: filter === f.key ? '600' : '500',
                    fontSize: 13,
                  }}
                >
                  {f.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Review List */}
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={FOREST} />
            }
          >
            {filteredReviews.length === 0 ? (
              <EmptyState
                filter={filter}
                message={filter === 'all' ? "When customers leave reviews, they'll appear here." : 'Try a different filter to see more reviews.'}
                title={filter === 'all' ? 'No reviews yet' : 'No reviews match this filter'}
              />
            ) : (
              filteredReviews.map((review) => (
                <ReceivedReviewCard
                  key={review.id}
                  review={review}
                  showFarmName={showFarmName}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push(`/review/${review.id}?farmstandId=${review.farmId}`);
                  }}
                />
              ))
            )}
          </ScrollView>
        </>
      )}

      {/* ── WRITTEN BY ME TAB ── */}
      {activeTab === 'written' && (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={FOREST} />
          }
        >
          {isLoadingWritten ? (
            <View style={{ paddingTop: 60, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={FOREST} />
            </View>
          ) : myWrittenReviews.length === 0 ? (
            <EmptyState
              filter="all"
              title="No reviews yet"
              message="Reviews you've written will appear here."
            />
          ) : (
            myWrittenReviews.map((review) => (
              <WrittenReviewCard key={review.id} review={review} />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ filter, title, message }: { filter: FilterType; title: string; message: string }) {
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 40,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: BORDER,
        marginTop: 8,
      }}
    >
      <MessageSquare size={44} color="#D0C8C0" />
      <Text style={{ color: '#1C1917', fontWeight: '700', fontSize: 18, marginTop: 16, letterSpacing: -0.2 }}>
        {title}
      </Text>
      <Text style={{ color: '#A8906E', textAlign: 'center', marginTop: 8, fontSize: 14, lineHeight: 20 }}>
        {message}
      </Text>
    </View>
  );
}

function ReceivedReviewCard({
  review,
  showFarmName,
  onPress,
}: {
  review: ReviewWithFarm;
  showFarmName: boolean;
  onPress: () => void;
}) {
  const initials =
    review.userName
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ?? '?';

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: BORDER,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {/* Avatar */}
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            overflow: 'hidden',
            backgroundColor: '#EDE8E0',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {review.userAvatar ? (
            <Image source={{ uri: review.userAvatar }} style={{ width: 46, height: 46 }} resizeMode="cover" />
          ) : (
            <Text style={{ color: '#A8906E', fontWeight: '700', fontSize: 16 }}>{initials}</Text>
          )}
        </View>

        {/* Content */}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: '#1C1917', fontWeight: '600', fontSize: 15, letterSpacing: -0.1 }}>
              {review.userName || 'Anonymous'}
            </Text>
            <ChevronRight size={17} color="#C0B8AE" strokeWidth={2} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
            <StarRow rating={review.rating} />
            <Text style={{ color: '#C0B8AE', fontSize: 12, letterSpacing: 0.1 }}>· {review.date}</Text>
          </View>

          {showFarmName && review.farmstandName ? (
            <Text style={{ color: FOREST, fontSize: 12, fontWeight: '600', marginTop: 3, letterSpacing: 0.1 }}>
              {review.farmstandName}
            </Text>
          ) : null}

          <Text style={{ color: '#57534E', fontSize: 14, lineHeight: 20, marginTop: 6 }} numberOfLines={2}>
            {review.text}
          </Text>

          {review.response ? (
            <View
              style={{
                marginTop: 10,
                backgroundColor: '#F3F9F5',
                borderRadius: 10,
                borderWidth: 1,
                borderColor: '#D0E8D8',
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '600', color: '#4A7C59', marginBottom: 2, letterSpacing: 0.4 }}>
                YOU
              </Text>
              <Text style={{ color: '#44403C', fontSize: 13, lineHeight: 18 }} numberOfLines={1}>
                {review.response.text}
              </Text>
            </View>
          ) : (
            <View
              style={{
                marginTop: 10,
                alignSelf: 'flex-start',
                backgroundColor: '#FFF8EC',
                borderWidth: 1,
                borderColor: '#F0D070',
                borderRadius: 99,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: '#92600A', fontSize: 12, fontWeight: '600' }}>Tap to reply</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function WrittenReviewCard({ review }: { review: ReviewWithFarm }) {
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: BORDER,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
      }}
    >
      {/* Farmstand name */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: '#E8F0E8',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Store size={18} color={FOREST} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: FOREST, fontWeight: '700', fontSize: 14, letterSpacing: -0.1 }} numberOfLines={1}>
            {review.farmstandName || 'Farmstand'}
          </Text>
          <Text style={{ color: '#A8906E', fontSize: 12 }}>{review.date}</Text>
        </View>
      </View>

      {/* Divider */}
      <View style={{ height: 1, backgroundColor: BORDER, marginBottom: 10 }} />

      {/* Rating */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <StarRow rating={review.rating} size={14} />
        <Text style={{ color: '#78716C', fontSize: 13, fontWeight: '500' }}>
          {review.rating}.0
        </Text>
      </View>

      {/* Review text */}
      <Text style={{ color: '#44403C', fontSize: 14, lineHeight: 21 }}>{review.text}</Text>

      {/* Owner response (if any) */}
      {review.response && (
        <View
          style={{
            marginTop: 12,
            backgroundColor: '#F3F9F5',
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#D0E8D8',
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#4A7C59', marginBottom: 4, letterSpacing: 0.5 }}>
            OWNER RESPONSE
          </Text>
          <Text style={{ color: '#44403C', fontSize: 13, lineHeight: 19 }}>
            {review.response.text}
          </Text>
        </View>
      )}
    </View>
  );
}
