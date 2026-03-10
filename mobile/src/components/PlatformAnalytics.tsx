import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Share,
  StyleSheet,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  Users,
  TrendingUp,
  Store,
  BarChart3,
  Download,
  Copy,
  CheckCircle,
  AlertTriangle,
  Eye,
  Heart,
  Navigation,
  Phone,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
  ChevronDown,
  Target,
  Zap,
  Award,
  Share2,
  FileText,
  PieChart,
  Activity,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAdminStore } from '@/lib/admin-store';
import type { AnalyticsEventName } from '@/lib/analytics-events';

// Types for analytics data
interface AnalyticsEvent {
  id: string;
  event_name: AnalyticsEventName;
  created_at: string;
  user_id: string | null;
  session_id: string;
  device_id: string;
  screen: string;
  farmstand_id: string | null;
  product_key: string | null;
  properties: Record<string, unknown> | null;
}

interface DateRange {
  label: string;
  days: number;
}

const DATE_RANGES: DateRange[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

// Tab definitions - Investor-ready tabs
type TabId = 'overview' | 'growth' | 'engagement' | 'marketplace' | 'funnel' | 'top' | 'exports';

interface Tab {
  id: TabId;
  label: string;
  icon: (color: string) => React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', icon: (color) => <BarChart3 size={16} color={color} /> },
  { id: 'growth', label: 'Growth', icon: (color) => <TrendingUp size={16} color={color} /> },
  { id: 'engagement', label: 'Engagement', icon: (color) => <Activity size={16} color={color} /> },
  { id: 'marketplace', label: 'Marketplace', icon: (color) => <Store size={16} color={color} /> },
  { id: 'funnel', label: 'Funnel', icon: (color) => <Target size={16} color={color} /> },
  { id: 'top', label: 'Top Farmstands', icon: (color) => <Award size={16} color={color} /> },
  { id: 'exports', label: 'Exports', icon: (color) => <Download size={16} color={color} /> },
];

// Premium KPI Card Component
interface KPICardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  change?: number;
  icon: React.ReactNode;
  color: string;
  size?: 'normal' | 'large';
}

function KPICard({ title, value, subtitle, change, icon, color, size = 'normal' }: KPICardProps) {
  const isLarge = size === 'large';
  return (
    <View
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${isLarge ? 'p-5' : 'p-4'} flex-1 min-w-[140px]`}
      style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8 }}
    >
      <View className="flex-row items-center justify-between mb-3">
        <View
          className="w-10 h-10 rounded-xl items-center justify-center"
          style={{ backgroundColor: color + '15' }}
        >
          {icon}
        </View>
        {change !== undefined && (
          <View className={`px-2 py-1 rounded-full ${change >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <Text className={`text-xs font-semibold ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {change >= 0 ? '+' : ''}{change.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>
      <Text className={`font-bold text-gray-900 ${isLarge ? 'text-3xl' : 'text-2xl'}`}>{value}</Text>
      <Text className="text-gray-500 text-sm mt-1">{title}</Text>
      {subtitle && <Text className="text-gray-400 text-xs mt-0.5">{subtitle}</Text>}
    </View>
  );
}

// Compact Metric Row
interface MetricRowProps {
  label: string;
  value: number | string;
  subValue?: string;
  highlight?: boolean;
}

function MetricRow({ label, value, subValue, highlight }: MetricRowProps) {
  return (
    <View className={`flex-row items-center justify-between py-3 border-b border-gray-50 ${highlight ? 'bg-green-50/50 -mx-4 px-4' : ''}`}>
      <Text className={`text-gray-700 ${highlight ? 'font-medium' : ''}`}>{label}</Text>
      <View className="items-end">
        <Text className={`font-semibold ${highlight ? 'text-green-700' : 'text-gray-900'}`}>{value}</Text>
        {subValue && <Text className="text-gray-400 text-xs">{subValue}</Text>}
      </View>
    </View>
  );
}

// Funnel Stage Component
interface FunnelStageProps {
  label: string;
  value: number;
  conversionRate?: number;
  icon: React.ReactNode;
  color: string;
  isFirst?: boolean;
}

function FunnelStage({ label, value, conversionRate, icon, color, isFirst }: FunnelStageProps) {
  return (
    <View className="items-center">
      {!isFirst && (
        <View className="items-center mb-2">
          <ChevronDown size={20} color="#9ca3af" />
          {conversionRate !== undefined && (
            <View className="bg-gray-100 px-2 py-0.5 rounded-full">
              <Text className="text-gray-600 text-xs font-medium">{conversionRate.toFixed(1)}%</Text>
            </View>
          )}
        </View>
      )}
      <View
        className="w-full rounded-xl p-4 items-center"
        style={{ backgroundColor: color + '10' }}
      >
        <View className="mb-2">{icon}</View>
        <Text className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</Text>
        <Text className="text-gray-600 text-sm">{label}</Text>
      </View>
    </View>
  );
}

// Ranking Table Row
interface RankingRowProps {
  rank: number;
  name: string;
  metric: number | string;
  metricLabel: string;
  secondaryMetric?: string;
}

function RankingRow({ rank, name, metric, metricLabel, secondaryMetric }: RankingRowProps) {
  const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
  const showMedal = rank <= 3;

  return (
    <View className="flex-row items-center py-3 border-b border-gray-50">
      <View className="w-8 items-center">
        {showMedal ? (
          <View
            className="w-6 h-6 rounded-full items-center justify-center"
            style={{ backgroundColor: medalColors[rank - 1] + '30' }}
          >
            <Text style={{ color: medalColors[rank - 1], fontWeight: '700', fontSize: 12 }}>{rank}</Text>
          </View>
        ) : (
          <Text className="text-gray-400 font-medium">{rank}</Text>
        )}
      </View>
      <View className="flex-1 ml-2">
        <Text className="text-gray-900 font-medium" numberOfLines={1}>{name}</Text>
      </View>
      <View className="items-end">
        <Text className="text-gray-900 font-semibold">{metric}</Text>
        <Text className="text-gray-400 text-xs">{metricLabel}</Text>
        {secondaryMetric && <Text className="text-gray-400 text-xs">{secondaryMetric}</Text>}
      </View>
    </View>
  );
}

// Section Card Component
interface SectionCardProps {
  title: string;
  children: React.ReactNode;
  delay?: number;
  action?: { label: string; onPress: () => void };
}

function SectionCard({ title, children, delay = 0, action }: SectionCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)} className="mb-5">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-gray-900 font-bold text-lg">{title}</Text>
        {action && (
          <Pressable onPress={action.onPress}>
            <Text className="text-green-600 font-medium text-sm">{action.label}</Text>
          </Pressable>
        )}
      </View>
      <View
        className="bg-white rounded-2xl p-4 border border-gray-100"
        style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8 }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

// Date Range Selector
interface DateRangeSelectorProps {
  selectedDays: number;
  onSelect: (days: number) => void;
}

function DateRangeSelector({ selectedDays, onSelect }: DateRangeSelectorProps) {
  return (
    <View style={dateRangeStyles.container}>
      {DATE_RANGES.map((range) => (
        <Pressable
          key={range.days}
          onPress={() => onSelect(range.days)}
          style={[
            dateRangeStyles.button,
            selectedDays === range.days && dateRangeStyles.buttonSelected,
          ]}
        >
          <Text
            style={[
              dateRangeStyles.buttonText,
              selectedDays === range.days && dateRangeStyles.buttonTextSelected,
            ]}
          >
            {range.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// Styles for DateRangeSelector to avoid NativeWind/navigation context conflict
const dateRangeStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 4,
  },
  button: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonSelected: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  buttonText: {
    textAlign: 'center',
    fontWeight: '500',
    color: '#6b7280',
  },
  buttonTextSelected: {
    color: '#111827',
  },
});

// Main Component
export function PlatformAnalytics() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedDays, setSelectedDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);

  // Fetch analytics events from Supabase
  const fetchEvents = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      console.log('[PlatformAnalytics] Supabase not configured');
      setLoading(false);
      return;
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90); // Fetch 90 days for flexibility
      const cutoffIso = cutoffDate.toISOString();

      const { data, error } = await supabase
        .from<AnalyticsEvent>('analytics_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50000)
        .execute();

      if (error) {
        console.log('[PlatformAnalytics] Error fetching events:', error.message);
      } else {
        // Filter by date client-side (Supabase client doesn't support .gte())
        const filteredData = (data || []).filter((e) => e.created_at >= cutoffIso);
        setEvents(filteredData);
        console.log('[PlatformAnalytics] Fetched', filteredData.length, 'events');
      }
    } catch (e) {
      console.log('[PlatformAnalytics] Network error:', e);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadAdminData();
    fetchEvents();
  }, [fetchEvents, loadAdminData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadAdminData(), fetchEvents()]);
    setRefreshing(false);
  };

  // Filter events by date range
  const filteredEvents = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - selectedDays);
    return events.filter((e) => new Date(e.created_at) >= cutoffDate);
  }, [events, selectedDays]);

  // Filter farmstand-related events (only where farmstand_id is NOT NULL)
  const farmstandEvents = useMemo(() => {
    return filteredEvents.filter((e) => e.farmstand_id !== null);
  }, [filteredEvents]);

  // =====================
  // OVERVIEW TAB METRICS
  // =====================

  // DAU/WAU/MAU calculations
  const userMetrics = useMemo(() => {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dauSet = new Set<string>();
    const wauSet = new Set<string>();
    const mauSet = new Set<string>();

    events.forEach((e) => {
      const deviceId = e.device_id;
      if (!deviceId) return;
      const eventDate = new Date(e.created_at);

      if (eventDate >= dayAgo) dauSet.add(deviceId);
      if (eventDate >= weekAgo) wauSet.add(deviceId);
      if (eventDate >= monthAgo) mauSet.add(deviceId);
    });

    const dau = dauSet.size;
    const mau = mauSet.size;
    const stickiness = mau > 0 ? (dau / mau) * 100 : 0;

    return {
      dau,
      wau: wauSet.size,
      mau,
      stickiness,
    };
  }, [events]);

  // Farmstand counts
  const farmstandCounts = useMemo(() => {
    const total = allFarmstands.length;
    const claimed = allFarmstands.filter((f) => f.claimStatus === 'claimed').length;
    const active = allFarmstands.filter((f) => f.status === 'active' && f.approvalStatus === 'approved').length;

    return { total, claimed, active };
  }, [allFarmstands]);

  // Claim metrics (30d)
  const claimMetrics = useMemo(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let claimsStarted = 0;
    let claimsSubmitted = 0;

    events.forEach((e) => {
      const eventDate = new Date(e.created_at);
      if (eventDate < thirtyDaysAgo) return;

      if (e.event_name === 'claim_start') claimsStarted++;
      if (e.event_name === 'claim_submit') claimsSubmitted++;
    });

    return { claimsStarted, claimsSubmitted };
  }, [events]);

  // Farmstand views (7d and 30d) - only where farmstand_id is NOT NULL
  const viewMetrics = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let views7d = 0;
    let views30d = 0;

    events.forEach((e) => {
      if (e.event_name !== 'farmstand_view' || !e.farmstand_id) return;
      const eventDate = new Date(e.created_at);

      if (eventDate >= weekAgo) views7d++;
      if (eventDate >= monthAgo) views30d++;
    });

    return { views7d, views30d };
  }, [events]);

  // Intent rate = (directions + calls + messages) / views
  const intentRate = useMemo(() => {
    let views = 0;
    let directions = 0;
    let calls = 0;
    let messages = 0;

    farmstandEvents.forEach((e) => {
      switch (e.event_name) {
        case 'farmstand_view':
          views++;
          break;
        case 'directions_tap':
          directions++;
          break;
        case 'call_tap':
          calls++;
          break;
        case 'message_farmstand':
        case 'message_tap':
          messages++;
          break;
      }
    });

    const totalIntent = directions + calls + messages;
    const rate = views > 0 ? (totalIntent / views) * 100 : 0;

    return { views, directions, calls, messages, totalIntent, rate };
  }, [farmstandEvents]);

  // =====================
  // GROWTH TAB METRICS
  // =====================

  const growthMetrics = useMemo(() => {
    const now = new Date();
    const periods = [
      { label: 'Today', start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now },
      { label: 'Yesterday', start: new Date(now.getTime() - 48 * 60 * 60 * 1000), end: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      { label: 'This Week', start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: now },
      { label: 'Last Week', start: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000), end: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      { label: 'This Month', start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now },
    ];

    const signupsByPeriod: Record<string, number> = {};
    const appOpensByPeriod: Record<string, number> = {};

    periods.forEach((p) => {
      signupsByPeriod[p.label] = 0;
      appOpensByPeriod[p.label] = 0;
    });

    events.forEach((e) => {
      const eventDate = new Date(e.created_at);
      periods.forEach((p) => {
        if (eventDate >= p.start && eventDate < p.end) {
          if (e.event_name === 'signup_complete') signupsByPeriod[p.label]++;
          if (e.event_name === 'app_open') appOpensByPeriod[p.label]++;
        }
      });
    });

    // Week over week growth
    const thisWeekSignups = signupsByPeriod['This Week'];
    const lastWeekSignups = signupsByPeriod['Last Week'];
    const signupGrowth = lastWeekSignups > 0 ? ((thisWeekSignups - lastWeekSignups) / lastWeekSignups) * 100 : 0;

    return { signupsByPeriod, appOpensByPeriod, signupGrowth };
  }, [events]);

  // =====================
  // ENGAGEMENT TAB METRICS
  // =====================

  const engagementMetrics = useMemo(() => {
    let searches = 0;
    let filterChanges = 0;
    let productClicks = 0;
    let saves = 0;
    let shares = 0;
    let reviews = 0;

    filteredEvents.forEach((e) => {
      switch (e.event_name) {
        case 'search':
          searches++;
          break;
        case 'filter_change':
          filterChanges++;
          break;
        case 'product_click':
          productClicks++;
          break;
        case 'farmstand_save':
        case 'save_toggle':
          saves++;
          break;
        case 'share_tap':
          shares++;
          break;
        case 'review_create':
          reviews++;
          break;
      }
    });

    // Sessions per user (DAU)
    const sessionsCount = filteredEvents.filter((e) => e.event_name === 'app_open').length;
    const uniqueDevices = new Set(filteredEvents.map((e) => e.device_id)).size;
    const sessionsPerUser = uniqueDevices > 0 ? sessionsCount / uniqueDevices : 0;

    return { searches, filterChanges, productClicks, saves, shares, reviews, sessionsPerUser };
  }, [filteredEvents]);

  // =====================
  // FUNNEL TAB METRICS
  // =====================

  const funnelMetrics = useMemo(() => {
    let views = 0;
    let saves = 0;
    let directions = 0;
    let calls = 0;
    let messages = 0;

    // Only count events with farmstand_id
    farmstandEvents.forEach((e) => {
      switch (e.event_name) {
        case 'farmstand_view':
          views++;
          break;
        case 'farmstand_save':
        case 'save_toggle':
          saves++;
          break;
        case 'directions_tap':
          directions++;
          break;
        case 'call_tap':
          calls++;
          break;
        case 'message_farmstand':
        case 'message_tap':
          messages++;
          break;
      }
    });

    const callsAndMessages = calls + messages;

    // Conversion rates
    const viewToSave = views > 0 ? (saves / views) * 100 : 0;
    const saveToDirections = saves > 0 ? (directions / saves) * 100 : 0;
    const directionsToContact = directions > 0 ? (callsAndMessages / directions) * 100 : 0;
    const viewToContact = views > 0 ? (callsAndMessages / views) * 100 : 0;

    return {
      views,
      saves,
      directions,
      calls,
      messages,
      callsAndMessages,
      viewToSave,
      saveToDirections,
      directionsToContact,
      viewToContact,
    };
  }, [farmstandEvents]);

  // =====================
  // TOP FARMSTANDS TAB METRICS
  // =====================

  const topFarmstands = useMemo(() => {
    const farmstandStats: Record<string, {
      views: number;
      saves: number;
      directions: number;
      calls: number;
      messages: number;
    }> = {};

    // Only count events with farmstand_id
    farmstandEvents.forEach((e) => {
      const fid = e.farmstand_id;
      if (!fid) return;

      if (!farmstandStats[fid]) {
        farmstandStats[fid] = { views: 0, saves: 0, directions: 0, calls: 0, messages: 0 };
      }

      switch (e.event_name) {
        case 'farmstand_view':
          farmstandStats[fid].views++;
          break;
        case 'farmstand_save':
        case 'save_toggle':
          farmstandStats[fid].saves++;
          break;
        case 'directions_tap':
          farmstandStats[fid].directions++;
          break;
        case 'call_tap':
          farmstandStats[fid].calls++;
          break;
        case 'message_farmstand':
        case 'message_tap':
          farmstandStats[fid].messages++;
          break;
      }
    });

    // Calculate intent rate for each farmstand
    const farmstandsWithIntent = Object.entries(farmstandStats).map(([id, stats]) => {
      const intent = stats.directions + stats.calls + stats.messages;
      const intentRate = stats.views > 0 ? (intent / stats.views) * 100 : 0;
      return {
        id,
        name: getFarmstandById(id)?.name || 'Unknown',
        ...stats,
        intent,
        intentRate,
      };
    });

    return {
      byViews: [...farmstandsWithIntent].sort((a, b) => b.views - a.views).slice(0, 10),
      bySaves: [...farmstandsWithIntent].sort((a, b) => b.saves - a.saves).slice(0, 10),
      byIntentRate: [...farmstandsWithIntent].filter((f) => f.views >= 5).sort((a, b) => b.intentRate - a.intentRate).slice(0, 10),
      byMessages: [...farmstandsWithIntent].sort((a, b) => b.messages - a.messages).slice(0, 10),
    };
  }, [farmstandEvents, getFarmstandById]);

  // =====================
  // EXPORT FUNCTIONALITY
  // =====================

  const generateSummary = useCallback(() => {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return `FARMSTAND PLATFORM ANALYTICS
Generated: ${dateStr}
Period: Last ${selectedDays} days

=== KEY METRICS ===
DAU: ${userMetrics.dau.toLocaleString()}
WAU: ${userMetrics.wau.toLocaleString()}
MAU: ${userMetrics.mau.toLocaleString()}
Stickiness (DAU/MAU): ${userMetrics.stickiness.toFixed(1)}%

=== FARMSTANDS ===
Total Farmstands: ${farmstandCounts.total.toLocaleString()}
Claimed Farmstands: ${farmstandCounts.claimed.toLocaleString()}
Active Farmstands: ${farmstandCounts.active.toLocaleString()}
Claim Rate: ${farmstandCounts.total > 0 ? ((farmstandCounts.claimed / farmstandCounts.total) * 100).toFixed(1) : 0}%

=== ENGAGEMENT (${selectedDays}d) ===
Farmstand Views: ${funnelMetrics.views.toLocaleString()}
Saves: ${funnelMetrics.saves.toLocaleString()}
Directions: ${funnelMetrics.directions.toLocaleString()}
Calls: ${funnelMetrics.calls.toLocaleString()}
Messages: ${funnelMetrics.messages.toLocaleString()}
Intent Rate: ${intentRate.rate.toFixed(1)}%

=== CONVERSION FUNNEL ===
View → Save: ${funnelMetrics.viewToSave.toFixed(1)}%
Save → Directions: ${funnelMetrics.saveToDirections.toFixed(1)}%
Directions → Contact: ${funnelMetrics.directionsToContact.toFixed(1)}%
View → Contact: ${funnelMetrics.viewToContact.toFixed(1)}%

=== CLAIMS (30d) ===
Claims Started: ${claimMetrics.claimsStarted}
Claims Submitted: ${claimMetrics.claimsSubmitted}
Completion Rate: ${claimMetrics.claimsStarted > 0 ? ((claimMetrics.claimsSubmitted / claimMetrics.claimsStarted) * 100).toFixed(1) : 0}%
`;
  }, [selectedDays, userMetrics, farmstandCounts, funnelMetrics, intentRate, claimMetrics]);

  const generateCSV = useCallback(() => {
    let csv = 'metric,value,period\n';

    // User metrics
    csv += `DAU,${userMetrics.dau},daily\n`;
    csv += `WAU,${userMetrics.wau},weekly\n`;
    csv += `MAU,${userMetrics.mau},monthly\n`;
    csv += `Stickiness,${userMetrics.stickiness.toFixed(2)},daily\n`;

    // Farmstand counts
    csv += `Total Farmstands,${farmstandCounts.total},all time\n`;
    csv += `Claimed Farmstands,${farmstandCounts.claimed},all time\n`;
    csv += `Active Farmstands,${farmstandCounts.active},all time\n`;

    // Funnel metrics
    csv += `Farmstand Views,${funnelMetrics.views},${selectedDays}d\n`;
    csv += `Saves,${funnelMetrics.saves},${selectedDays}d\n`;
    csv += `Directions,${funnelMetrics.directions},${selectedDays}d\n`;
    csv += `Calls,${funnelMetrics.calls},${selectedDays}d\n`;
    csv += `Messages,${funnelMetrics.messages},${selectedDays}d\n`;
    csv += `Intent Rate,${intentRate.rate.toFixed(2)},${selectedDays}d\n`;

    // Conversion rates
    csv += `View to Save Rate,${funnelMetrics.viewToSave.toFixed(2)},${selectedDays}d\n`;
    csv += `Save to Directions Rate,${funnelMetrics.saveToDirections.toFixed(2)},${selectedDays}d\n`;
    csv += `View to Contact Rate,${funnelMetrics.viewToContact.toFixed(2)},${selectedDays}d\n`;

    return csv;
  }, [selectedDays, userMetrics, farmstandCounts, funnelMetrics, intentRate]);

  const copyToClipboard = async (type: 'summary' | 'csv') => {
    const content = type === 'summary' ? generateSummary() : generateCSV();
    await Clipboard.setStringAsync(content);
    setCopySuccess(type);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  const shareReport = async () => {
    const summary = generateSummary();
    try {
      await Share.share({
        message: summary,
        title: 'Farmstand Platform Analytics',
      });
    } catch (error) {
      console.log('Share error:', error);
    }
  };

  // =====================
  // RENDER TABS
  // =====================

  const renderOverviewTab = () => (
    <>
      <DateRangeSelector selectedDays={selectedDays} onSelect={setSelectedDays} />

      {/* Top KPI Row */}
      <Animated.View entering={FadeInDown.delay(0).duration(400)} className="flex-row flex-wrap gap-3 mb-5">
        <KPICard
          title="Daily Active Users"
          value={userMetrics.dau.toLocaleString()}
          icon={<Users size={20} color="#3b82f6" />}
          color="#3b82f6"
          size="large"
        />
        <KPICard
          title="Monthly Active Users"
          value={userMetrics.mau.toLocaleString()}
          icon={<Users size={20} color="#16a34a" />}
          color="#16a34a"
          size="large"
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(100).duration(400)} className="flex-row flex-wrap gap-3 mb-5">
        <KPICard
          title="Stickiness"
          value={`${userMetrics.stickiness.toFixed(1)}%`}
          subtitle="DAU / MAU"
          icon={<Zap size={18} color="#f59e0b" />}
          color="#f59e0b"
        />
        <KPICard
          title="Intent Rate"
          value={`${intentRate.rate.toFixed(1)}%`}
          subtitle="Actions / Views"
          icon={<Target size={18} color="#8b5cf6" />}
          color="#8b5cf6"
        />
      </Animated.View>

      <SectionCard title="Farmstands" delay={200}>
        <View className="flex-row flex-wrap gap-3">
          <KPICard
            title="Total Farmstands"
            value={farmstandCounts.total.toLocaleString()}
            icon={<Store size={18} color="#16a34a" />}
            color="#16a34a"
          />
          <KPICard
            title="Claimed"
            value={farmstandCounts.claimed.toLocaleString()}
            subtitle={`${farmstandCounts.total > 0 ? ((farmstandCounts.claimed / farmstandCounts.total) * 100).toFixed(0) : 0}% claimed`}
            icon={<ShieldCheck size={18} color="#8b5cf6" />}
            color="#8b5cf6"
          />
        </View>
      </SectionCard>

      <SectionCard title="Claims (30d)" delay={300}>
        <MetricRow label="Claims Started" value={claimMetrics.claimsStarted} />
        <MetricRow label="Claims Submitted" value={claimMetrics.claimsSubmitted} />
        <MetricRow
          label="Completion Rate"
          value={`${claimMetrics.claimsStarted > 0 ? ((claimMetrics.claimsSubmitted / claimMetrics.claimsStarted) * 100).toFixed(1) : 0}%`}
          highlight
        />
      </SectionCard>

      <SectionCard title="Farmstand Views" delay={400}>
        <MetricRow label="Last 7 Days" value={viewMetrics.views7d.toLocaleString()} />
        <MetricRow label="Last 30 Days" value={viewMetrics.views30d.toLocaleString()} highlight />
      </SectionCard>
    </>
  );

  const renderGrowthTab = () => (
    <>
      <DateRangeSelector selectedDays={selectedDays} onSelect={setSelectedDays} />

      <Animated.View entering={FadeInDown.delay(0).duration(400)} className="flex-row flex-wrap gap-3 mb-5">
        <KPICard
          title="Weekly Signups"
          value={growthMetrics.signupsByPeriod['This Week']}
          change={growthMetrics.signupGrowth}
          icon={<TrendingUp size={18} color="#16a34a" />}
          color="#16a34a"
          size="large"
        />
        <KPICard
          title="WAU"
          value={userMetrics.wau.toLocaleString()}
          icon={<Users size={18} color="#3b82f6" />}
          color="#3b82f6"
          size="large"
        />
      </Animated.View>

      <SectionCard title="New User Signups" delay={100}>
        <MetricRow label="Today" value={growthMetrics.signupsByPeriod['Today']} />
        <MetricRow label="Yesterday" value={growthMetrics.signupsByPeriod['Yesterday']} />
        <MetricRow label="This Week" value={growthMetrics.signupsByPeriod['This Week']} highlight />
        <MetricRow label="Last Week" value={growthMetrics.signupsByPeriod['Last Week']} />
        <MetricRow label="This Month" value={growthMetrics.signupsByPeriod['This Month']} />
      </SectionCard>

      <SectionCard title="App Opens" delay={200}>
        <MetricRow label="Today" value={growthMetrics.appOpensByPeriod['Today']} />
        <MetricRow label="Yesterday" value={growthMetrics.appOpensByPeriod['Yesterday']} />
        <MetricRow label="This Week" value={growthMetrics.appOpensByPeriod['This Week']} highlight />
        <MetricRow label="This Month" value={growthMetrics.appOpensByPeriod['This Month']} />
      </SectionCard>

      <SectionCard title="Active Users Trend" delay={300}>
        <MetricRow label="DAU" value={userMetrics.dau.toLocaleString()} subValue="Daily" />
        <MetricRow label="WAU" value={userMetrics.wau.toLocaleString()} subValue="Weekly" />
        <MetricRow label="MAU" value={userMetrics.mau.toLocaleString()} subValue="Monthly" highlight />
      </SectionCard>
    </>
  );

  const renderEngagementTab = () => (
    <>
      <DateRangeSelector selectedDays={selectedDays} onSelect={setSelectedDays} />

      <Animated.View entering={FadeInDown.delay(0).duration(400)} className="flex-row flex-wrap gap-3 mb-5">
        <KPICard
          title="Searches"
          value={engagementMetrics.searches.toLocaleString()}
          icon={<BarChart3 size={18} color="#3b82f6" />}
          color="#3b82f6"
        />
        <KPICard
          title="Saves"
          value={engagementMetrics.saves.toLocaleString()}
          icon={<Heart size={18} color="#ec4899" />}
          color="#ec4899"
        />
      </Animated.View>

      <SectionCard title="User Actions" delay={100}>
        <MetricRow label="Searches" value={engagementMetrics.searches.toLocaleString()} />
        <MetricRow label="Filter Changes" value={engagementMetrics.filterChanges.toLocaleString()} />
        <MetricRow label="Product Clicks" value={engagementMetrics.productClicks.toLocaleString()} />
        <MetricRow label="Saves" value={engagementMetrics.saves.toLocaleString()} />
        <MetricRow label="Shares" value={engagementMetrics.shares.toLocaleString()} />
        <MetricRow label="Reviews" value={engagementMetrics.reviews.toLocaleString()} />
      </SectionCard>

      <SectionCard title="Session Quality" delay={200}>
        <MetricRow
          label="Sessions per User"
          value={engagementMetrics.sessionsPerUser.toFixed(1)}
          subValue={`${selectedDays}d avg`}
          highlight
        />
        <MetricRow
          label="Stickiness (DAU/MAU)"
          value={`${userMetrics.stickiness.toFixed(1)}%`}
        />
      </SectionCard>
    </>
  );

  const renderMarketplaceTab = () => (
    <>
      <DateRangeSelector selectedDays={selectedDays} onSelect={setSelectedDays} />

      <Animated.View entering={FadeInDown.delay(0).duration(400)} className="flex-row flex-wrap gap-3 mb-5">
        <KPICard
          title="Active Listings"
          value={farmstandCounts.active.toLocaleString()}
          icon={<Store size={18} color="#16a34a" />}
          color="#16a34a"
          size="large"
        />
        <KPICard
          title="Claim Rate"
          value={`${farmstandCounts.total > 0 ? ((farmstandCounts.claimed / farmstandCounts.total) * 100).toFixed(0) : 0}%`}
          icon={<ShieldCheck size={18} color="#8b5cf6" />}
          color="#8b5cf6"
          size="large"
        />
      </Animated.View>

      <SectionCard title="Marketplace Health" delay={100}>
        <MetricRow label="Total Farmstands" value={farmstandCounts.total.toLocaleString()} />
        <MetricRow label="Active Farmstands" value={farmstandCounts.active.toLocaleString()} />
        <MetricRow label="Claimed Farmstands" value={farmstandCounts.claimed.toLocaleString()} />
        <MetricRow
          label="Unclaimed"
          value={(farmstandCounts.total - farmstandCounts.claimed).toLocaleString()}
          subValue="Opportunity"
        />
      </SectionCard>

      <SectionCard title="Claim Activity (30d)" delay={200}>
        <MetricRow label="Claims Started" value={claimMetrics.claimsStarted} />
        <MetricRow label="Claims Submitted" value={claimMetrics.claimsSubmitted} />
        <MetricRow
          label="Claim Conversion"
          value={`${claimMetrics.claimsStarted > 0 ? ((claimMetrics.claimsSubmitted / claimMetrics.claimsStarted) * 100).toFixed(0) : 0}%`}
          highlight
        />
      </SectionCard>

      <SectionCard title="Intent Metrics" delay={300}>
        <MetricRow label="Total Intent Actions" value={intentRate.totalIntent.toLocaleString()} subValue="Directions + Calls + Messages" />
        <MetricRow label="Intent Rate" value={`${intentRate.rate.toFixed(1)}%`} subValue="Actions / Views" highlight />
      </SectionCard>
    </>
  );

  const renderFunnelTab = () => (
    <>
      <DateRangeSelector selectedDays={selectedDays} onSelect={setSelectedDays} />

      <SectionCard title="Conversion Funnel" delay={0}>
        <View className="py-2">
          <FunnelStage
            label="Views"
            value={funnelMetrics.views}
            icon={<Eye size={24} color="#3b82f6" />}
            color="#3b82f6"
            isFirst
          />
          <FunnelStage
            label="Saves"
            value={funnelMetrics.saves}
            conversionRate={funnelMetrics.viewToSave}
            icon={<Heart size={24} color="#ec4899" />}
            color="#ec4899"
          />
          <FunnelStage
            label="Directions"
            value={funnelMetrics.directions}
            conversionRate={funnelMetrics.saveToDirections}
            icon={<Navigation size={24} color="#16a34a" />}
            color="#16a34a"
          />
          <FunnelStage
            label="Calls + Messages"
            value={funnelMetrics.callsAndMessages}
            conversionRate={funnelMetrics.directionsToContact}
            icon={<Phone size={24} color="#f59e0b" />}
            color="#f59e0b"
          />
        </View>
      </SectionCard>

      <SectionCard title="Conversion Rates" delay={100}>
        <MetricRow label="View → Save" value={`${funnelMetrics.viewToSave.toFixed(1)}%`} />
        <MetricRow label="Save → Directions" value={`${funnelMetrics.saveToDirections.toFixed(1)}%`} />
        <MetricRow label="Directions → Contact" value={`${funnelMetrics.directionsToContact.toFixed(1)}%`} />
        <MetricRow label="View → Contact (Overall)" value={`${funnelMetrics.viewToContact.toFixed(1)}%`} highlight />
      </SectionCard>

      <SectionCard title="Contact Breakdown" delay={200}>
        <MetricRow label="Calls" value={funnelMetrics.calls.toLocaleString()} />
        <MetricRow label="Messages" value={funnelMetrics.messages.toLocaleString()} />
        <MetricRow label="Total Contact" value={funnelMetrics.callsAndMessages.toLocaleString()} highlight />
      </SectionCard>
    </>
  );

  const renderTopFarmstandsTab = () => (
    <>
      <DateRangeSelector selectedDays={selectedDays} onSelect={setSelectedDays} />

      <SectionCard title="Top by Views" delay={0}>
        {topFarmstands.byViews.length === 0 ? (
          <Text className="text-gray-400 text-center py-4">No view data</Text>
        ) : (
          topFarmstands.byViews.map((f, i) => (
            <RankingRow
              key={f.id}
              rank={i + 1}
              name={f.name}
              metric={f.views.toLocaleString()}
              metricLabel="views"
            />
          ))
        )}
      </SectionCard>

      <SectionCard title="Top by Saves" delay={100}>
        {topFarmstands.bySaves.length === 0 ? (
          <Text className="text-gray-400 text-center py-4">No save data</Text>
        ) : (
          topFarmstands.bySaves.map((f, i) => (
            <RankingRow
              key={f.id}
              rank={i + 1}
              name={f.name}
              metric={f.saves.toLocaleString()}
              metricLabel="saves"
            />
          ))
        )}
      </SectionCard>

      <SectionCard title="Top by Intent Rate" delay={200}>
        {topFarmstands.byIntentRate.length === 0 ? (
          <Text className="text-gray-400 text-center py-4">Not enough data (min 5 views)</Text>
        ) : (
          topFarmstands.byIntentRate.map((f, i) => (
            <RankingRow
              key={f.id}
              rank={i + 1}
              name={f.name}
              metric={`${f.intentRate.toFixed(1)}%`}
              metricLabel="intent rate"
              secondaryMetric={`${f.views} views`}
            />
          ))
        )}
      </SectionCard>

      <SectionCard title="Top by Messages" delay={300}>
        {topFarmstands.byMessages.length === 0 ? (
          <Text className="text-gray-400 text-center py-4">No message data</Text>
        ) : (
          topFarmstands.byMessages.map((f, i) => (
            <RankingRow
              key={f.id}
              rank={i + 1}
              name={f.name}
              metric={f.messages.toLocaleString()}
              metricLabel="messages"
            />
          ))
        )}
      </SectionCard>
    </>
  );

  const renderExportsTab = () => (
    <>
      <SectionCard title="Export Options" delay={0}>
        <Text className="text-gray-600 mb-4">
          Export analytics data for presentations, spreadsheets, or sharing with stakeholders.
        </Text>

        {copySuccess && (
          <View className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex-row items-center">
            <CheckCircle size={18} color="#16a34a" />
            <Text className="text-green-700 ml-2 font-medium">
              {copySuccess === 'summary' ? 'Summary copied!' : 'CSV copied!'}
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => copyToClipboard('summary')}
          className="bg-green-50 border border-green-200 rounded-xl p-4 flex-row items-center mb-3"
        >
          <View className="w-10 h-10 rounded-lg bg-green-100 items-center justify-center mr-3">
            <FileText size={20} color="#16a34a" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-semibold">Copy Summary</Text>
            <Text className="text-gray-500 text-sm">Text format for presentations</Text>
          </View>
          <Copy size={18} color="#16a34a" />
        </Pressable>

        <Pressable
          onPress={() => copyToClipboard('csv')}
          className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex-row items-center mb-3"
        >
          <View className="w-10 h-10 rounded-lg bg-blue-100 items-center justify-center mr-3">
            <PieChart size={20} color="#3b82f6" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-semibold">Copy CSV</Text>
            <Text className="text-gray-500 text-sm">For spreadsheets & data analysis</Text>
          </View>
          <Copy size={18} color="#3b82f6" />
        </Pressable>

        <Pressable
          onPress={shareReport}
          className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex-row items-center"
        >
          <View className="w-10 h-10 rounded-lg bg-purple-100 items-center justify-center mr-3">
            <Share2 size={20} color="#8b5cf6" />
          </View>
          <View className="flex-1">
            <Text className="text-gray-900 font-semibold">Share Report</Text>
            <Text className="text-gray-500 text-sm">Send via email, message, etc.</Text>
          </View>
          <ChevronRight size={18} color="#8b5cf6" />
        </Pressable>
      </SectionCard>

      <SectionCard title="Data Summary" delay={100}>
        <MetricRow label="Total Events" value={filteredEvents.length.toLocaleString()} subValue={`Last ${selectedDays}d`} />
        <MetricRow label="Farmstand Events" value={farmstandEvents.length.toLocaleString()} subValue="With farmstand_id" />
        <MetricRow label="Unique Devices" value={new Set(filteredEvents.map((e) => e.device_id)).size.toLocaleString()} />
        <MetricRow label="Unique Users" value={new Set(filteredEvents.filter((e) => e.user_id).map((e) => e.user_id)).size.toLocaleString()} />
      </SectionCard>
    </>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'growth':
        return renderGrowthTab();
      case 'engagement':
        return renderEngagementTab();
      case 'marketplace':
        return renderMarketplaceTab();
      case 'funnel':
        return renderFunnelTab();
      case 'top':
        return renderTopFarmstandsTab();
      case 'exports':
        return renderExportsTab();
      default:
        return renderOverviewTab();
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-gray-500 mt-3">Loading analytics...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-50">
      {/* Tab Bar */}
      <View className="bg-white border-b border-gray-100">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
        >
          {TABS.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              className={`flex-row items-center px-4 py-2 rounded-full mr-2 ${
                activeTab === tab.id ? 'bg-green-600' : 'bg-gray-100'
              }`}
            >
              {tab.icon(activeTab === tab.id ? 'white' : '#6b7280')}
              <Text
                className={`ml-2 font-medium text-sm ${
                  activeTab === tab.id ? 'text-white' : 'text-gray-600'
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
        }
      >
        {!isSupabaseConfigured() ? (
          <View className="items-center py-8">
            <AlertTriangle size={48} color="#f59e0b" />
            <Text className="text-gray-700 font-medium mt-4 text-center">
              Supabase Not Configured
            </Text>
            <Text className="text-gray-500 text-center mt-2 px-8">
              Add your Supabase credentials in the ENV tab to enable analytics tracking.
            </Text>
          </View>
        ) : events.length === 0 ? (
          <View className="items-center py-8">
            <BarChart3 size={48} color="#9ca3af" />
            <Text className="text-gray-700 font-medium mt-4 text-center">
              No Analytics Data Yet
            </Text>
            <Text className="text-gray-500 text-center mt-2 px-8">
              Analytics events will appear here as users interact with the app.
            </Text>
          </View>
        ) : (
          renderContent()
        )}
      </ScrollView>
    </View>
  );
}
