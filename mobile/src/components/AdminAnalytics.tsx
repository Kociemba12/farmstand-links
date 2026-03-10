import React, { useEffect, useMemo } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Store,
  ShieldCheck,
  CheckCircle,
  MessageSquare,
  Flag,
  Users,
  Activity,
  TrendingUp,
  AlertTriangle,
  Image as ImageIcon,
  Clock,
  MapPin,
  Package,
  ChevronRight,
  Zap,
  BarChart3,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAnalyticsStore, EventType } from '@/lib/analytics-store';
import { useAdminStore } from '@/lib/admin-store';

interface AdminStatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}

function AdminStatCard({ title, value, icon, color, subtitle }: AdminStatCardProps) {
  return (
    <View className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex-1 min-w-[140px]">
      <View className="flex-row items-center mb-2">
        <View
          className="w-8 h-8 rounded-lg items-center justify-center mr-2"
          style={{ backgroundColor: color + '20' }}
        >
          {icon}
        </View>
      </View>
      <Text className="text-2xl font-bold text-gray-900">{value}</Text>
      <Text className="text-gray-500 text-xs mt-0.5">{title}</Text>
      {subtitle && <Text className="text-gray-400 text-xs">{subtitle}</Text>}
    </View>
  );
}

interface QualityMetricProps {
  label: string;
  percent: number;
  color: string;
}

function QualityMetric({ label, percent, color }: QualityMetricProps) {
  return (
    <View className="mb-3">
      <View className="flex-row justify-between mb-1">
        <Text className="text-gray-600 text-sm">{label}</Text>
        <Text className="text-gray-900 font-medium text-sm">{percent}%</Text>
      </View>
      <View className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </View>
    </View>
  );
}

interface AttentionItemProps {
  title: string;
  count: number;
  icon: React.ReactNode;
  onPress: () => void;
}

function AttentionItem({ title, count, icon, onPress }: AttentionItemProps) {
  if (count === 0) return null;

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center py-3 border-b border-gray-100 last:border-b-0"
    >
      <View className="bg-amber-50 p-2 rounded-lg mr-3">{icon}</View>
      <View className="flex-1">
        <Text className="text-gray-900 font-medium">{title}</Text>
        <Text className="text-gray-500 text-sm">{count} item{count !== 1 ? 's' : ''}</Text>
      </View>
      <ChevronRight size={18} color="#9ca3af" />
    </Pressable>
  );
}

interface TopFarmstandRowProps {
  rank: number;
  name: string;
  value: number;
  metric: string;
}

function TopFarmstandRow({ rank, name, value, metric }: TopFarmstandRowProps) {
  return (
    <View className="flex-row items-center py-2.5 border-b border-gray-50 last:border-b-0">
      <Text className="w-8 text-gray-400 font-medium">{rank}</Text>
      <Text className="flex-1 text-gray-900" numberOfLines={1}>{name}</Text>
      <Text className="text-gray-600 font-medium">{value} {metric}</Text>
    </View>
  );
}

export function AdminAnalytics() {
  const router = useRouter();
  const [refreshing, setRefreshing] = React.useState(false);

  const loadAnalytics = useAnalyticsStore((s) => s.loadAnalytics);
  const getAdminStats7Days = useAnalyticsStore((s) => s.getAdminStats7Days);
  const getActiveUsers30Days = useAnalyticsStore((s) => s.getActiveUsers30Days);
  const getTopFarmstands = useAnalyticsStore((s) => s.getTopFarmstands);
  const getDataQualityMetrics = useAnalyticsStore((s) => s.getDataQualityMetrics);
  const getTotalEvents7Days = useAnalyticsStore((s) => s.getTotalEvents7Days);
  const getTopEventTypes7Days = useAnalyticsStore((s) => s.getTopEventTypes7Days);

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const getPendingClaimRequests = useAdminStore((s) => s.getPendingClaimRequests);
  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);

  useEffect(() => {
    loadAnalytics();
    loadAdminData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAnalytics();
    await loadAdminData();
    setRefreshing(false);
  };

  const stats7Days = getAdminStats7Days();
  const activeUsers = getActiveUsers30Days();
  const totalEvents = getTotalEvents7Days();
  const topEventTypes = getTopEventTypes7Days();
  const dataQuality = useMemo(() => getDataQualityMetrics(allFarmstands), [allFarmstands]);
  const pendingClaims = getPendingClaimRequests().length;

  // Get top farmstands
  const topByViews = getTopFarmstands('views', 5);
  const topBySaves = getTopFarmstands('saves', 5);
  const topByDirections = getTopFarmstands('directions', 5);

  // Count flagged listings (reports >= 3)
  const flaggedListings = allFarmstands.filter((f) => {
    // This would need actual report counts from analytics
    return false; // Placeholder
  }).length;

  const eventTypeLabels: { [key in EventType]?: string } = {
    farmstand_viewed: 'Views',
    saved: 'Saves',
    directions_clicked: 'Directions',
    call_clicked: 'Calls',
    review_created: 'Reviews',
    shared: 'Shares',
    listing_claim_requested: 'Claims',
  };

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
      }
    >
      {/* Platform Stats - 7 Days */}
      <Animated.View entering={FadeInDown.delay(0)}>
        <Text className="text-gray-900 font-bold text-lg mb-3">Platform Analytics (7 Days)</Text>
        <View className="flex-row flex-wrap gap-3 mb-6">
          <AdminStatCard
            title="New Listings"
            value={stats7Days.newListings}
            icon={<Store size={16} color="#16a34a" />}
            color="#16a34a"
          />
          <AdminStatCard
            title="Claims Requested"
            value={stats7Days.claimsRequested}
            icon={<ShieldCheck size={16} color="#8b5cf6" />}
            color="#8b5cf6"
          />
          <AdminStatCard
            title="Claims Approved"
            value={stats7Days.claimsApproved}
            icon={<CheckCircle size={16} color="#16a34a" />}
            color="#16a34a"
          />
          <AdminStatCard
            title="New Reviews"
            value={stats7Days.newReviews}
            icon={<MessageSquare size={16} color="#3b82f6" />}
            color="#3b82f6"
          />
          <AdminStatCard
            title="Reports"
            value={stats7Days.reports}
            icon={<Flag size={16} color="#dc2626" />}
            color="#dc2626"
          />
          <AdminStatCard
            title="Active Users"
            value={activeUsers}
            icon={<Users size={16} color="#f59e0b" />}
            color="#f59e0b"
            subtitle="30 days"
          />
        </View>
      </Animated.View>

      {/* Needs Attention */}
      <Animated.View entering={FadeInDown.delay(100)} className="mb-6">
        <Text className="text-gray-900 font-bold text-lg mb-3">Needs Attention</Text>
        <View className="bg-white rounded-2xl p-4 border border-gray-100">
          {pendingClaims === 0 && flaggedListings === 0 ? (
            <View className="items-center py-4">
              <CheckCircle size={32} color="#16a34a" />
              <Text className="text-gray-500 mt-2">All caught up!</Text>
            </View>
          ) : (
            <>
              <AttentionItem
                title="Pending Claim Requests"
                count={pendingClaims}
                icon={<ShieldCheck size={18} color="#f59e0b" />}
                onPress={() => router.push('/admin/claim-requests')}
              />
              <AttentionItem
                title="Flagged Listings"
                count={flaggedListings}
                icon={<AlertTriangle size={18} color="#f59e0b" />}
                onPress={() => router.push('/admin/reports')}
              />
            </>
          )}
        </View>
      </Animated.View>

      {/* Data Quality */}
      <Animated.View entering={FadeInDown.delay(200)} className="mb-6">
        <Text className="text-gray-900 font-bold text-lg mb-3">Data Quality</Text>
        <View className="bg-white rounded-2xl p-4 border border-gray-100">
          <QualityMetric
            label="Claimed Listings"
            percent={dataQuality.percentClaimed}
            color="#8b5cf6"
          />
          <QualityMetric
            label="With Photos"
            percent={dataQuality.percentWithPhotos}
            color="#ec4899"
          />
          <QualityMetric
            label="With Hours"
            percent={dataQuality.percentWithHours}
            color="#f59e0b"
          />
          <QualityMetric
            label="With Location"
            percent={dataQuality.percentWithLocation}
            color="#16a34a"
          />
          <QualityMetric
            label="With Products"
            percent={dataQuality.percentWithProducts}
            color="#3b82f6"
          />
        </View>
      </Animated.View>

      {/* Engagement */}
      <Animated.View entering={FadeInDown.delay(300)} className="mb-6">
        <Text className="text-gray-900 font-bold text-lg mb-3">Engagement (7 Days)</Text>
        <View className="bg-white rounded-2xl p-4 border border-gray-100">
          <View className="flex-row items-center mb-4">
            <View className="bg-blue-50 p-3 rounded-xl mr-4">
              <Activity size={24} color="#3b82f6" />
            </View>
            <View>
              <Text className="text-3xl font-bold text-gray-900">{totalEvents}</Text>
              <Text className="text-gray-500 text-sm">Total Events</Text>
            </View>
          </View>

          {topEventTypes.length > 0 && (
            <View className="border-t border-gray-100 pt-3">
              <Text className="text-gray-500 text-xs font-medium mb-2">TOP EVENT TYPES</Text>
              {topEventTypes.map((item, index) => (
                <View key={item.type} className="flex-row items-center py-1.5">
                  <View className="w-6 h-6 bg-gray-100 rounded items-center justify-center mr-2">
                    <Text className="text-gray-500 text-xs font-medium">{index + 1}</Text>
                  </View>
                  <Text className="flex-1 text-gray-700">
                    {eventTypeLabels[item.type] || item.type.replace(/_/g, ' ')}
                  </Text>
                  <Text className="text-gray-500 font-medium">{item.count}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </Animated.View>

      {/* Top Farmstands */}
      <Animated.View entering={FadeInDown.delay(400)}>
        <Text className="text-gray-900 font-bold text-lg mb-3">Top Farmstands</Text>

        {/* By Views */}
        {topByViews.length > 0 && (
          <View className="bg-white rounded-2xl p-4 border border-gray-100 mb-3">
            <View className="flex-row items-center mb-3">
              <BarChart3 size={18} color="#3b82f6" />
              <Text className="text-gray-700 font-medium ml-2">By Views</Text>
            </View>
            {topByViews.map((item, index) => {
              const farmstand = getFarmstandById(item.farmstand_id);
              return (
                <TopFarmstandRow
                  key={item.farmstand_id}
                  rank={index + 1}
                  name={farmstand?.name || 'Unknown'}
                  value={item.value}
                  metric="views"
                />
              );
            })}
          </View>
        )}

        {/* By Saves */}
        {topBySaves.length > 0 && (
          <View className="bg-white rounded-2xl p-4 border border-gray-100 mb-3">
            <View className="flex-row items-center mb-3">
              <BarChart3 size={18} color="#ec4899" />
              <Text className="text-gray-700 font-medium ml-2">By Saves</Text>
            </View>
            {topBySaves.map((item, index) => {
              const farmstand = getFarmstandById(item.farmstand_id);
              return (
                <TopFarmstandRow
                  key={item.farmstand_id}
                  rank={index + 1}
                  name={farmstand?.name || 'Unknown'}
                  value={item.value}
                  metric="saves"
                />
              );
            })}
          </View>
        )}

        {/* By Directions */}
        {topByDirections.length > 0 && (
          <View className="bg-white rounded-2xl p-4 border border-gray-100">
            <View className="flex-row items-center mb-3">
              <BarChart3 size={18} color="#16a34a" />
              <Text className="text-gray-700 font-medium ml-2">By Directions</Text>
            </View>
            {topByDirections.map((item, index) => {
              const farmstand = getFarmstandById(item.farmstand_id);
              return (
                <TopFarmstandRow
                  key={item.farmstand_id}
                  rank={index + 1}
                  name={farmstand?.name || 'Unknown'}
                  value={item.value}
                  metric="taps"
                />
              );
            })}
          </View>
        )}

        {topByViews.length === 0 && topBySaves.length === 0 && topByDirections.length === 0 && (
          <View className="bg-white rounded-2xl p-8 border border-gray-100 items-center">
            <TrendingUp size={32} color="#9ca3af" />
            <Text className="text-gray-500 mt-2 text-center">
              No engagement data yet. Analytics will appear as users interact with farmstands.
            </Text>
          </View>
        )}
      </Animated.View>
    </ScrollView>
  );
}
