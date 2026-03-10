import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Eye, TrendingUp, TrendingDown, Map, Search, Heart, Share2 } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, ViewEvent } from '@/lib/farmer-store';
import * as Haptics from 'expo-haptics';

type TimeRange = '7d' | '30d' | '90d';

const SOURCE_ICONS = {
  map: Map,
  search: Search,
  favorite: Heart,
  share: Share2,
};

const SOURCE_COLORS = {
  map: '#2D5A3D',
  search: '#D4943A',
  favorite: '#C4653A',
  share: '#7FB069',
};

export default function AnalyticsViewsScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();

  const getViewEventsByFarmstand = useFarmerStore((s) => s.getViewEventsByFarmstand);

  const [viewEvents, setViewEvents] = useState<ViewEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');

  useEffect(() => {
    if (farmstandId) {
      const data = getViewEventsByFarmstand(farmstandId);
      setViewEvents(data);
      setIsLoading(false);
    }
  }, [farmstandId, getViewEventsByFarmstand]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleTimeRangeChange = async (range: TimeRange) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeRange(range);
  };

  const analytics = useMemo(() => {
    const now = Date.now();
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const rangeStart = now - days * 24 * 60 * 60 * 1000;
    const prevRangeStart = rangeStart - days * 24 * 60 * 60 * 1000;

    const currentViews = viewEvents.filter(
      (v) => new Date(v.createdAt).getTime() >= rangeStart
    );
    const previousViews = viewEvents.filter(
      (v) =>
        new Date(v.createdAt).getTime() >= prevRangeStart &&
        new Date(v.createdAt).getTime() < rangeStart
    );

    const totalViews = currentViews.length;
    const previousTotal = previousViews.length;
    const deltaPercent = previousTotal > 0
      ? Math.round(((totalViews - previousTotal) / previousTotal) * 100)
      : 0;

    // Views by source
    const sourceBreakdown = currentViews.reduce(
      (acc, v) => {
        acc[v.source] = (acc[v.source] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Views by day for chart
    const viewsByDay: { date: string; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * 24 * 60 * 60 * 1000;
      const dayEnd = now - i * 24 * 60 * 60 * 1000;
      const count = currentViews.filter(
        (v) => {
          const vTime = new Date(v.createdAt).getTime();
          return vTime >= dayStart && vTime < dayEnd;
        }
      ).length;
      const date = new Date(dayStart).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      viewsByDay.push({ date, count });
    }

    // Calculate max for chart scaling
    const maxViews = Math.max(...viewsByDay.map((d) => d.count), 1);

    return {
      totalViews,
      deltaPercent,
      sourceBreakdown,
      viewsByDay,
      maxViews,
    };
  }, [viewEvents, timeRange]);

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  const screenWidth = Dimensions.get('window').width - 40;

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Views Analytics</Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {/* Time Range Selector */}
          <View className="flex-row bg-white rounded-xl p-1 border border-sand mb-6">
            {(['7d', '30d', '90d'] as TimeRange[]).map((range) => (
              <Pressable
                key={range}
                onPress={() => handleTimeRangeChange(range)}
                className={`flex-1 py-2 rounded-lg ${
                  timeRange === range ? 'bg-forest' : ''
                }`}
              >
                <Text
                  className={`text-center font-medium ${
                    timeRange === range ? 'text-cream' : 'text-charcoal'
                  }`}
                >
                  {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Total Views Card */}
          <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-wood mb-1">Total Views</Text>
                <Text className="text-charcoal font-bold text-4xl">
                  {analytics.totalViews.toLocaleString()}
                </Text>
              </View>
              <View
                className={`flex-row items-center px-3 py-2 rounded-full ${
                  analytics.deltaPercent >= 0 ? 'bg-mint/20' : 'bg-terracotta/10'
                }`}
              >
                {analytics.deltaPercent >= 0 ? (
                  <TrendingUp size={18} color="#2D5A3D" />
                ) : (
                  <TrendingDown size={18} color="#C4653A" />
                )}
                <Text
                  className={`ml-1 font-semibold ${
                    analytics.deltaPercent >= 0 ? 'text-forest' : 'text-terracotta'
                  }`}
                >
                  {analytics.deltaPercent >= 0 ? '+' : ''}
                  {analytics.deltaPercent}%
                </Text>
              </View>
            </View>
            <Text className="text-wood text-sm mt-2">
              vs. previous {timeRange === '7d' ? '7' : timeRange === '30d' ? '30' : '90'} days
            </Text>
          </View>

          {/* Simple Bar Chart */}
          <View className="bg-white rounded-2xl p-5 border border-sand mb-6">
            <Text className="text-charcoal font-bold text-lg mb-4">Views Over Time</Text>
            <View className="flex-row items-end justify-between" style={{ height: 120 }}>
              {analytics.viewsByDay
                .filter((_, i) => {
                  // Show fewer bars for readability
                  const interval = timeRange === '7d' ? 1 : timeRange === '30d' ? 3 : 7;
                  return i % interval === 0;
                })
                .map((day, index) => {
                  const height = (day.count / analytics.maxViews) * 100;
                  return (
                    <View key={index} className="items-center flex-1">
                      <View
                        className="bg-forest rounded-t w-full max-w-[20px]"
                        style={{ height: Math.max(height, 4) }}
                      />
                      <Text
                        className="text-wood text-[8px] mt-1"
                        numberOfLines={1}
                      >
                        {day.date.split(' ')[1]}
                      </Text>
                    </View>
                  );
                })}
            </View>
          </View>

          {/* Source Breakdown */}
          <View className="bg-white rounded-2xl p-5 border border-sand">
            <Text className="text-charcoal font-bold text-lg mb-4">Views by Source</Text>
            {Object.entries(analytics.sourceBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([source, count]) => {
                const Icon = SOURCE_ICONS[source as keyof typeof SOURCE_ICONS] || Eye;
                const color = SOURCE_COLORS[source as keyof typeof SOURCE_COLORS] || '#8B6F4E';
                const percentage = Math.round((count / analytics.totalViews) * 100);

                return (
                  <View key={source} className="mb-4 last:mb-0">
                    <View className="flex-row items-center justify-between mb-2">
                      <View className="flex-row items-center">
                        <View
                          className="w-8 h-8 rounded-full items-center justify-center"
                          style={{ backgroundColor: `${color}20` }}
                        >
                          <Icon size={16} color={color} />
                        </View>
                        <Text className="text-charcoal font-medium ml-3 capitalize">
                          {source}
                        </Text>
                      </View>
                      <Text className="text-charcoal font-semibold">
                        {count.toLocaleString()} ({percentage}%)
                      </Text>
                    </View>
                    <View className="h-2 bg-sand rounded-full overflow-hidden">
                      <View
                        className="h-full rounded-full"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: color,
                        }}
                      />
                    </View>
                  </View>
                );
              })}

            {Object.keys(analytics.sourceBreakdown).length === 0 && (
              <Text className="text-wood text-center py-4">No views in this period</Text>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
