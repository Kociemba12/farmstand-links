import React, { useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Eye,
  Star,
  MessageSquare,
  TrendingUp,
  Settings,
  ShoppingBag,
  Clock,
  ChevronRight,
  Lightbulb,
  BarChart3,
} from 'lucide-react-native';
import { FarmerRouteGuard } from '@/components/FarmerRouteGuard';
import { useRouter } from 'expo-router';
import { useUserStore } from '@/lib/user-store';
import { useFarmerStore, DashboardSummary } from '@/lib/farmer-store';
import { useAdminStore } from '@/lib/admin-store';
import { useAnalyticsStore } from '@/lib/analytics-store';
import * as Haptics from 'expo-haptics';

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

export default function FarmerDashboardScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const isFarmer = useUserStore((s) => s.user?.isFarmer);

  const isGuest = useUserStore((s) => s.isGuest);

  const loadFarmerData = useFarmerStore((s) => s.loadFarmerData);
  const isLoading = useFarmerStore((s) => s.isLoading);
  const selectedFarmstandId = useFarmerStore((s) => s.selectedFarmstandId);
  const getDashboardSummary = useFarmerStore((s) => s.getDashboardSummary);

  // Use admin store to find the actual farmstand ID for quick actions
  const adminFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  // Analytics store
  const loadAnalytics = useAnalyticsStore((s) => s.loadAnalytics);
  const seedAnalyticsForFarmstand = useAnalyticsStore((s) => s.seedAnalyticsForFarmstand);
  const getFarmstandStats7Days = useAnalyticsStore((s) => s.getFarmstandStats7Days);
  const getFarmstandTotalStats = useAnalyticsStore((s) => s.getFarmstandTotalStats);

  // Find the user's actual farmstand from admin store
  const actualFarmstandId = useMemo(() => {
    if (!user) return null;

    // First check user.farmId
    if (user.farmId) {
      const found = adminFarmstands.find((f) => f.id === user.farmId);
      if (found) return found.id;
    }

    // Find farmstand where user is the owner
    const userFarmstand = adminFarmstands.find(
      (f) => f.ownerUserId === user.id ||
             f.ownerUserId === user.email ||
             (f.claimStatus === 'claimed' && f.ownerUserId === user.id)
    );
    if (userFarmstand) return userFarmstand.id;

    // Fall back to selectedFarmstandId if it exists in admin store
    if (selectedFarmstandId) {
      const found = adminFarmstands.find((f) => f.id === selectedFarmstandId);
      if (found) return found.id;
    }

    return null;
  }, [user, adminFarmstands, selectedFarmstandId]);

  const [refreshing, setRefreshing] = React.useState(false);
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);

  // Check guest status early (but after all hooks are declared)
  const isGuestUser = isGuest();

  // Seed analytics data for the farmstand if it doesn't exist yet
  useEffect(() => {
    if (isGuestUser) return;
    const seedIfNeeded = async () => {
      if (actualFarmstandId) {
        const totalStats = getFarmstandTotalStats(actualFarmstandId);
        if (!totalStats) {
          // Seed demo data for this farmstand
          await seedAnalyticsForFarmstand(actualFarmstandId);
        }
      }
    };
    seedIfNeeded();
  }, [actualFarmstandId, isGuestUser]);

  useEffect(() => {
    if (isGuestUser) return;
    if (selectedFarmstandId) {
      const data = getDashboardSummary(selectedFarmstandId);
      // Enhance summary with analytics store data
      if (data && actualFarmstandId) {
        const stats7Days = getFarmstandStats7Days(actualFarmstandId);
        const totalStats = getFarmstandTotalStats(actualFarmstandId);
        // Use analytics data if available
        if (totalStats) {
          data.totalViews = stats7Days.views;
          data.averageRating = totalStats.avg_rating;
          data.reviewCount = totalStats.reviews_total;
        }
      }
      setSummary(data);
    }
  }, [selectedFarmstandId, actualFarmstandId, getDashboardSummary, isGuestUser]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user?.id) {
      await loadFarmerData(user.id);
      await loadAdminData();
      await loadAnalytics();
      if (selectedFarmstandId) {
        const data = getDashboardSummary(selectedFarmstandId);
        setSummary(data);
      }
    }
    setRefreshing(false);
  }, [user?.id, selectedFarmstandId]);

  useEffect(() => {
    // Route guard: Only farmers can access dashboard
    // Guests who submitted farmstands are NOT farmers until claim is approved
    if (isGuestUser) {
      // Don't redirect, we'll show a guard message
      return;
    }

    if (!isFarmer) {
      router.replace('/(tabs)/profile');
      return;
    }

    if (user?.id) {
      loadFarmerData(user.id);
      loadAdminData();
      loadAnalytics();
    }
  }, [isFarmer, user?.id, isGuestUser]);

  // Show guard for guests - AFTER all hooks
  if (isGuestUser) {
    return <FarmerRouteGuard title="Farmer Dashboard" />;
  }

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleSettings = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/farmer/settings');
  };

  const handleTilePress = async (route: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as any);
  };

  const handleQuickAction = async (action: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Use actualFarmstandId from admin store (not the potentially stale selectedFarmstandId)
    const farmstandId = actualFarmstandId;
    if (!farmstandId) {
      // No farmstand found, go to onboarding
      router.push('/farmer/onboarding');
      return;
    }
    switch (action) {
      case 'View Analytics':
        router.push(`/profile/analytics`);
        break;
      case 'Edit Listing':
        router.push(`/owner/edit?id=${farmstandId}`);
        break;
      case 'Manage Products':
        router.push(`/owner/products?id=${farmstandId}`);
        break;
      case 'Update Hours':
        router.push(`/owner/hours?id=${farmstandId}`);
        break;
      case 'Update Location':
        router.push(`/owner/location?id=${farmstandId}`);
        break;
    }
  };

  const handleReviewPress = async (reviewId: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(
      `/farmer/reviews/detail?farmstandId=${selectedFarmstandId}&reviewId=${reviewId}`
    );
  };

  const handleViewAllReviews = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farmer/reviews?farmstandId=${selectedFarmstandId}`);
  };

  const handleTipPress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (summary?.tipOfDay?.actionRoute) {
      router.push(summary.tipOfDay.actionRoute as any);
    }
  };

  const QUICK_ACTIONS = [
    { icon: BarChart3, label: 'View Analytics', description: 'See how your listing performs' },
    { icon: ShoppingBag, label: 'Manage Products', description: 'Add or remove products' },
    { icon: Clock, label: 'Update Hours', description: 'Set your business hours' },
  ];

  if (isLoading && !summary) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
        <Text className="text-wood mt-4">Loading dashboard...</Text>
      </View>
    );
  }

  // Use actualFarmstandId for tile navigation
  const farmstandId = actualFarmstandId ?? selectedFarmstandId;

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center justify-between px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold">Farmer Dashboard</Text>
          <Pressable onPress={handleSettings} className="p-2 -mr-2">
            <Settings size={24} color="#FDF8F3" />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2D5A3D" />
        }
      >
        <View className="px-5 py-6">
          {/* Welcome */}
          <View className="mb-6">
            <Text className="text-wood">Welcome back,</Text>
            <Text className="text-charcoal font-bold text-2xl">
              {user?.name?.split(' ')[0] || 'Farmer'}!
            </Text>
          </View>

          {/* Stats Grid */}
          <View className="flex-row flex-wrap mb-6">
            {/* Total Views Tile */}
            <View className="w-1/2 pr-2 mb-4">
              <Pressable
                onPress={() =>
                  handleTilePress(`/farmer/analytics/views?farmstandId=${farmstandId}`)
                }
                className="bg-white rounded-2xl p-4 border border-sand active:bg-sand/30"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <Eye size={20} color="#2D5A3D" />
                  {summary && (
                    <View
                      className={`px-2 py-1 rounded-full ${
                        summary.viewsDeltaPercent >= 0 ? 'bg-mint/20' : 'bg-terracotta/20'
                      }`}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          summary.viewsDeltaPercent >= 0 ? 'text-forest' : 'text-terracotta'
                        }`}
                      >
                        {summary.viewsDeltaPercent >= 0 ? '+' : ''}
                        {summary.viewsDeltaPercent}%
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="text-charcoal font-bold text-2xl">
                  {summary?.totalViews?.toLocaleString() ?? '—'}
                </Text>
                <Text className="text-wood text-sm">Total Views</Text>
              </Pressable>
            </View>

            {/* Average Rating Tile */}
            <View className="w-1/2 pl-2 mb-4">
              <Pressable
                onPress={() =>
                  handleTilePress(`/farmer/analytics/ratings?farmstandId=${farmstandId}`)
                }
                className="bg-white rounded-2xl p-4 border border-sand active:bg-sand/30"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <Star size={20} color="#D4943A" fill="#D4943A" />
                </View>
                <Text className="text-charcoal font-bold text-2xl">
                  {summary?.averageRating?.toFixed(1) ?? '—'}
                </Text>
                <Text className="text-wood text-sm">Average Rating</Text>
              </Pressable>
            </View>

            {/* Reviews Tile */}
            <View className="w-1/2 pr-2">
              <Pressable
                onPress={() =>
                  handleTilePress(`/farmer/reviews?farmstandId=${farmstandId}`)
                }
                className="bg-white rounded-2xl p-4 border border-sand active:bg-sand/30"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <MessageSquare size={20} color="#2D5A3D" />
                </View>
                <Text className="text-charcoal font-bold text-2xl">
                  {summary?.reviewCount ?? '—'}
                </Text>
                <Text className="text-wood text-sm">Reviews</Text>
              </Pressable>
            </View>

            {/* Performance Tile */}
            <View className="w-1/2 pl-2">
              <Pressable
                onPress={() =>
                  handleTilePress(`/farmer/performance?farmstandId=${farmstandId}`)
                }
                className="bg-white rounded-2xl p-4 border border-sand active:bg-sand/30"
              >
                <View className="flex-row items-center justify-between mb-2">
                  <TrendingUp size={20} color="#2D5A3D" />
                </View>
                <Text
                  className={`font-bold text-2xl ${
                    summary?.performanceLabel === 'Great'
                      ? 'text-forest'
                      : summary?.performanceLabel === 'Good'
                      ? 'text-harvest'
                      : 'text-terracotta'
                  }`}
                >
                  {summary?.performanceLabel ?? '—'}
                </Text>
                <Text className="text-wood text-sm">Performance</Text>
              </Pressable>
            </View>
          </View>

          {/* Quick Actions */}
          <Text className="text-charcoal font-bold text-lg mb-4">Quick Actions</Text>
          <View className="bg-white rounded-2xl overflow-hidden border border-sand mb-6">
            {QUICK_ACTIONS.map((action, index) => (
              <Pressable
                key={action.label}
                onPress={() => handleQuickAction(action.label)}
                className={`flex-row items-center px-4 py-4 active:bg-sand/30 ${
                  index !== QUICK_ACTIONS.length - 1 ? 'border-b border-sand' : ''
                }`}
              >
                <View className="w-10 h-10 rounded-full bg-cream items-center justify-center">
                  <action.icon size={20} color="#2D5A3D" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-charcoal font-medium">{action.label}</Text>
                  <Text className="text-wood text-sm">{action.description}</Text>
                </View>
                <ChevronRight size={20} color="#8B6F4E" />
              </Pressable>
            ))}
          </View>

          {/* Recent Reviews */}
          <Text className="text-charcoal font-bold text-lg mb-4">Recent Reviews</Text>
          <View className="bg-white rounded-2xl border border-sand mb-6">
            {summary?.recentReviews && summary.recentReviews.length > 0 ? (
              <>
                {summary.recentReviews.slice(0, 1).map((review) => (
                  <Pressable
                    key={review.id}
                    onPress={() => handleReviewPress(review.id)}
                    className="p-4 active:bg-sand/30"
                  >
                    <View className="flex-row items-center mb-3">
                      <View className="w-10 h-10 rounded-full bg-forest items-center justify-center">
                        <Text className="text-cream font-bold">{review.reviewerInitials}</Text>
                      </View>
                      <View className="ml-3 flex-1">
                        <Text className="text-charcoal font-medium">{review.reviewerName}</Text>
                        <View className="flex-row items-center">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              size={12}
                              color="#D4943A"
                              fill={star <= review.rating ? '#D4943A' : 'transparent'}
                            />
                          ))}
                          <Text className="text-wood text-xs ml-2">
                            {getRelativeTime(review.createdAt)}
                          </Text>
                        </View>
                      </View>
                      <ChevronRight size={20} color="#8B6F4E" />
                    </View>
                    <Text className="text-charcoal" numberOfLines={2}>
                      "{review.comment}"
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={handleViewAllReviews}
                  className="py-3 border-t border-sand items-center active:bg-sand/30"
                >
                  <Text className="text-forest font-medium">View All Reviews</Text>
                </Pressable>
              </>
            ) : (
              <View className="p-6 items-center">
                <MessageSquare size={32} color="#C4B5A4" />
                <Text className="text-wood text-center mt-2">No reviews yet</Text>
                <Text className="text-bark text-center text-sm mt-1">
                  Share your listing to get your first review!
                </Text>
              </View>
            )}
          </View>

          {/* Tip of the Day */}
          {summary?.tipOfDay && (
            <Pressable
              onPress={handleTipPress}
              className="bg-terracotta/10 rounded-2xl p-4 border border-terracotta/30 active:bg-terracotta/20"
            >
              <View className="flex-row items-start">
                <View className="w-8 h-8 rounded-full bg-terracotta/20 items-center justify-center mr-3">
                  <Lightbulb size={16} color="#C4653A" />
                </View>
                <View className="flex-1">
                  <Text className="text-charcoal font-semibold mb-1">
                    {summary.tipOfDay.title}
                  </Text>
                  <Text className="text-bark">{summary.tipOfDay.body}</Text>
                </View>
                {summary.tipOfDay.actionRoute && (
                  <ChevronRight size={20} color="#C4653A" />
                )}
              </View>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
