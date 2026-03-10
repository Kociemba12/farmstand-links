import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ChevronLeft,
  Search,
  X,
  Sparkles,
  Calendar,
  Clock,
  TrendingUp,
  MapPin,
  Star,
  ChevronRight,
  Megaphone,
  Zap,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown, FadeInRight } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { useAdminStore } from '@/lib/admin-store';
import {
  usePromotionsStore,
  EXPLORE_CATEGORIES,
  getPromoStatus,
} from '@/lib/promotions-store';
import { Farmstand } from '@/lib/farmer-store';

type FilterTab = 'all' | 'active' | 'scheduled' | 'expired' | 'auto';

export default function PromotionsScreen() {
  const router = useRouter();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [refreshing, setRefreshing] = useState(false);

  // Stores
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  const loadPromotionsData = usePromotionsStore((s) => s.loadPromotionsData);
  const getPromotionSummary = usePromotionsStore((s) => s.getPromotionSummary);
  const getActivePromotions = usePromotionsStore((s) => s.getActivePromotions);
  const getScheduledPromotions = usePromotionsStore((s) => s.getScheduledPromotions);
  const getExpiredPromotions = usePromotionsStore((s) => s.getExpiredPromotions);
  const getAutoFeatured = usePromotionsStore((s) => s.getAutoFeatured);

  // Load data on mount
  useEffect(() => {
    loadAdminData();
    loadPromotionsData();
  }, []);

  // Refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadAdminData(), loadPromotionsData()]);
    setRefreshing(false);
  }, [loadAdminData, loadPromotionsData]);

  // Summary counts
  const summary = useMemo(
    () => getPromotionSummary(allFarmstands),
    [allFarmstands, getPromotionSummary]
  );

  // Filtered farmstands based on search and tab
  const filteredFarmstands = useMemo(() => {
    let result: Farmstand[] = [];

    switch (activeTab) {
      case 'active':
        result = getActivePromotions(allFarmstands);
        break;
      case 'scheduled':
        result = getScheduledPromotions(allFarmstands);
        break;
      case 'expired':
        result = getExpiredPromotions(allFarmstands);
        break;
      case 'auto':
        result = getAutoFeatured(allFarmstands, 30);
        break;
      default:
        // All - show both promoted and auto-featured
        result = [
          ...getActivePromotions(allFarmstands),
          ...getScheduledPromotions(allFarmstands),
          ...getAutoFeatured(allFarmstands, 10),
        ];
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(query) ||
          f.city?.toLowerCase().includes(query) ||
          f.offerings.some((o) => o.toLowerCase().includes(query))
      );
    }

    return result;
  }, [
    activeTab,
    searchQuery,
    allFarmstands,
    getActivePromotions,
    getScheduledPromotions,
    getExpiredPromotions,
    getAutoFeatured,
  ]);

  // All farmstands for search (when actively searching)
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    return allFarmstands
      .filter(
        (f) =>
          f.status === 'active' &&
          (f.name.toLowerCase().includes(query) ||
            f.city?.toLowerCase().includes(query) ||
            f.offerings.some((o) => o.toLowerCase().includes(query)))
      )
      .slice(0, 20);
  }, [searchQuery, allFarmstands]);

  const handleFarmstandPress = (farmstand: Farmstand) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/admin/promotion-edit',
      params: { id: farmstand.id },
    });
  };

  const renderSummaryCard = (
    title: string,
    count: number,
    icon: React.ReactNode,
    color: string,
    bgColor: string,
    delay: number
  ) => (
    <Animated.View
      entering={FadeInDown.delay(delay).springify()}
      className="flex-1 mx-1"
    >
      <View
        className="rounded-2xl p-4"
        style={{ backgroundColor: bgColor }}
      >
        <View className="flex-row items-center justify-between mb-2">
          {icon}
          <Text
            className="text-2xl font-bold"
            style={{ color }}
          >
            {count}
          </Text>
        </View>
        <Text className="text-xs font-medium text-charcoal/70">{title}</Text>
      </View>
    </Animated.View>
  );

  const renderFilterChip = (tab: FilterTab, label: string, count: number) => {
    const isActive = activeTab === tab;
    return (
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setActiveTab(tab);
        }}
        className={`mr-2 px-4 py-2 rounded-full border ${
          isActive ? 'bg-forest border-forest' : 'bg-white border-sand'
        }`}
      >
        <Text
          className={`text-sm font-medium ${
            isActive ? 'text-white' : 'text-charcoal'
          }`}
        >
          {label} {count > 0 && `(${count})`}
        </Text>
      </Pressable>
    );
  };

  const renderFarmstandCard = (farmstand: Farmstand, index: number) => {
    const promoStatus = getPromoStatus(farmstand);
    const isPromoted = farmstand.promoActive && promoStatus !== 'none';
    const mainPhoto =
      farmstand.photos[farmstand.mainPhotoIndex ?? 0] ??
      farmstand.photos[0] ??
      'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=800';

    // Get status badge info
    let statusBadge = { label: '', color: '', bg: '' };
    if (isPromoted) {
      if (promoStatus === 'active') {
        statusBadge = { label: 'Promoted', color: '#2D5A3D', bg: '#E8F5E9' };
      } else if (promoStatus === 'scheduled') {
        statusBadge = { label: 'Scheduled', color: '#F57C00', bg: '#FFF3E0' };
      } else if (promoStatus === 'expired') {
        statusBadge = { label: 'Expired', color: '#757575', bg: '#EEEEEE' };
      }
    } else if (farmstand.popularityScore > 0) {
      statusBadge = { label: 'Auto-Featured', color: '#7B1FA2', bg: '#F3E5F5' };
    }

    // Category badges
    const categoryCount = farmstand.promoExploreCategories?.length || 0;

    return (
      <Animated.View
        key={farmstand.id}
        entering={FadeInRight.delay(index * 50).duration(300)}
      >
        <Pressable
          onPress={() => handleFarmstandPress(farmstand)}
          className="bg-white rounded-2xl mb-3 overflow-hidden border border-sand/50"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 2,
          }}
        >
          <View className="flex-row p-3">
            {/* Thumbnail */}
            <Image
              source={{ uri: mainPhoto }}
              className="w-16 h-16 rounded-xl"
              resizeMode="cover"
            />

            {/* Content */}
            <View className="flex-1 ml-3 justify-center">
              <View className="flex-row items-center">
                <Text
                  className="text-charcoal font-semibold text-base flex-1"
                  numberOfLines={1}
                >
                  {farmstand.name}
                </Text>
                <ChevronRight size={18} color="#8B6F4E" />
              </View>

              <View className="flex-row items-center mt-1">
                <MapPin size={12} color="#8B6F4E" />
                <Text className="text-wood text-xs ml-1" numberOfLines={1}>
                  {farmstand.city || 'Oregon'}
                </Text>
              </View>

              {/* Badges row */}
              <View className="flex-row items-center mt-2 flex-wrap">
                {statusBadge.label && (
                  <View
                    className="px-2 py-0.5 rounded-md mr-2"
                    style={{ backgroundColor: statusBadge.bg }}
                  >
                    <Text
                      className="text-xs font-medium"
                      style={{ color: statusBadge.color }}
                    >
                      {statusBadge.label}
                    </Text>
                  </View>
                )}

                {farmstand.promoMapBoost && (
                  <View className="px-2 py-0.5 rounded-md mr-2 bg-blue-50">
                    <Text className="text-xs font-medium text-blue-600">
                      Map Boost
                    </Text>
                  </View>
                )}

                {categoryCount > 0 && (
                  <View className="px-2 py-0.5 rounded-md bg-amber-50">
                    <Text className="text-xs font-medium text-amber-700">
                      {categoryCount} {categoryCount === 1 ? 'Category' : 'Categories'}
                    </Text>
                  </View>
                )}

                {!isPromoted && farmstand.popularityScore > 0 && (
                  <View className="flex-row items-center px-2 py-0.5 rounded-md bg-purple-50">
                    <TrendingUp size={10} color="#7B1FA2" />
                    <Text className="text-xs font-medium text-purple-700 ml-1">
                      Score: {farmstand.popularityScore}
                    </Text>
                  </View>
                )}

                {/* Debug: Priority & Weight (admin only) */}
                {__DEV__ && isPromoted && (
                  <View className="px-2 py-0.5 rounded-md bg-gray-100 ml-2">
                    <Text className="text-xs font-mono text-gray-600">
                      P:{farmstand.promoPriority ?? 50} W:{farmstand.promoRotationWeight ?? 1}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <View className="flex-1 bg-cream">
      {/* Hide the default navigation header */}
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView edges={['top']} className="bg-cream">
        {/* Header */}
        <View className="flex-row items-center px-5 py-3">
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-white items-center justify-center border border-sand"
            hitSlop={10}
          >
            <ChevronLeft size={24} color="#3D3D3D" />
          </Pressable>
          <Text className="flex-1 text-xl font-bold text-charcoal ml-4">
            Promotions
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#2D5A3D"
          />
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Summary Cards */}
        <Animated.View
          entering={FadeIn.delay(100).duration(400)}
          className="px-4 mt-2"
        >
          <Text className="text-sm font-semibold text-wood mb-3 px-1">
            Featured Overview
          </Text>
          <View className="flex-row">
            {renderSummaryCard(
              'Active Promotions',
              summary.activeCount,
              <Sparkles size={20} color="#2D5A3D" />,
              '#2D5A3D',
              '#E8F5E9',
              100
            )}
            {renderSummaryCard(
              'Auto-Featured',
              summary.autoFeaturedCount,
              <TrendingUp size={20} color="#7B1FA2" />,
              '#7B1FA2',
              '#F3E5F5',
              150
            )}
          </View>
          <View className="flex-row mt-2">
            {renderSummaryCard(
              'Scheduled',
              summary.scheduledCount,
              <Calendar size={20} color="#F57C00" />,
              '#F57C00',
              '#FFF3E0',
              200
            )}
            {renderSummaryCard(
              'Expired',
              summary.expiredCount,
              <Clock size={20} color="#757575" />,
              '#757575',
              '#EEEEEE',
              250
            )}
          </View>
        </Animated.View>

        {/* Search Bar */}
        <Animated.View
          entering={FadeInDown.delay(300).duration(400)}
          className="px-5 mt-5"
        >
          <View className="flex-row items-center bg-white rounded-2xl px-4 py-3 border border-sand">
            <Search size={20} color="#8B6F4E" />
            <TextInput
              className="flex-1 ml-3 text-charcoal text-base"
              placeholder="Search farmstands to promote..."
              placeholderTextColor="#8B6F4E"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} className="p-1">
                <X size={18} color="#8B6F4E" />
              </Pressable>
            )}
          </View>
        </Animated.View>

        {/* Filter Tabs */}
        <Animated.View entering={FadeInDown.delay(350).duration(400)} className="mt-4">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled={true}
            contentContainerStyle={{ paddingHorizontal: 20 }}
            style={{ flexGrow: 0 }}
          >
            {renderFilterChip('all', 'All', 0)}
            {renderFilterChip('active', 'Active', summary.activeCount)}
            {renderFilterChip('scheduled', 'Scheduled', summary.scheduledCount)}
            {renderFilterChip('expired', 'Expired', summary.expiredCount)}
            {renderFilterChip('auto', 'Auto-Featured', summary.autoFeaturedCount)}
          </ScrollView>
        </Animated.View>

        {/* Search Results - Show when searching */}
        {searchQuery.trim() && searchResults.length > 0 && (
          <Animated.View
            entering={FadeInDown.delay(100).duration(300)}
            className="px-5 mt-4"
          >
            <Text className="text-sm font-semibold text-wood mb-3">
              Search Results ({searchResults.length})
            </Text>
            {searchResults.map((farmstand, index) =>
              renderFarmstandCard(farmstand, index)
            )}
          </Animated.View>
        )}

        {/* Filtered List - Show when not searching */}
        {!searchQuery.trim() && (
          <Animated.View
            entering={FadeInDown.delay(400).duration(400)}
            className="px-5 mt-4"
          >
            <Text className="text-sm font-semibold text-wood mb-3">
              {activeTab === 'all'
                ? 'All Promoted & Featured'
                : activeTab === 'active'
                ? 'Active Promotions'
                : activeTab === 'scheduled'
                ? 'Scheduled Promotions'
                : activeTab === 'expired'
                ? 'Expired Promotions'
                : 'Auto-Featured by Popularity'}
            </Text>

            {filteredFarmstands.length === 0 ? (
              <View className="items-center py-12">
                <Megaphone size={48} color="#E8DDD4" />
                <Text className="text-wood text-base mt-4 text-center">
                  No farmstands found
                </Text>
                <Text className="text-wood/60 text-sm mt-1 text-center">
                  {activeTab === 'all'
                    ? 'Search for farmstands to promote'
                    : 'No promotions in this category'}
                </Text>
              </View>
            ) : (
              filteredFarmstands.map((farmstand, index) =>
                renderFarmstandCard(farmstand, index)
              )
            )}
          </Animated.View>
        )}

        {/* Quick tip */}
        <Animated.View
          entering={FadeInDown.delay(500).duration(400)}
          className="mx-5 mt-6 p-4 bg-forest/5 rounded-2xl border border-forest/10"
        >
          <View className="flex-row items-start">
            <View className="w-8 h-8 rounded-full bg-forest/10 items-center justify-center mr-3">
              <Zap size={16} color="#2D5A3D" />
            </View>
            <View className="flex-1">
              <Text className="text-forest font-semibold text-sm">
                How Promotions Work
              </Text>
              <Text className="text-wood text-xs mt-1 leading-5">
                Promoted farmstands appear in the top 10 of Explore categories and Map
                cards. Auto-Featured farmstands rise naturally based on clicks, saves,
                and messages. Up to 5 manual promos + 5 auto-featured fill the top 10.
              </Text>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
