import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  Eye,
  Heart,
  Navigation,
  Phone,
  Globe,
  Share2,
  Star,
  MessageSquare,
  Clock,
  Image as ImageIcon,
  MapPin,
  Package,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  TrendingUp,
  CheckCircle,
  XCircle,
  X,
  Copy,
  FileText,
  Target,
  Zap,
  Download,
  Info,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn, SlideInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAnalyticsStore, ListingHealth, RecommendedAction } from '@/lib/analytics-store';
import { useAdminStore } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import {
  fetchOwnerAnalytics,
  FarmstandStats7Days,
  FarmstandStats30Days,
  DailyTrend,
  ReviewStats,
} from '@/lib/owner-analytics-supabase';

// ─── Metric explanation config ────────────────────────────────────────────────
interface BenchmarkRange {
  range: string;
  label: string;
  description: string;
}

interface MetricExplanation {
  title: string;
  what: string;
  why: string;
  how: string;
  /** Optional benchmark table shown only for metrics that have clear ranges. */
  benchmarks?: BenchmarkRange[];
  /** Optional encouraging tip shown below the benchmark table. */
  tip?: string;
}

const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  views: {
    title: 'About Views',
    what: 'How many times people opened or viewed your farmstand listing during the last 7 days.',
    why: 'Shows how much attention your stand is getting from people browsing the app.',
    how: 'If views are high but actions are low, try improving your photos, products, or description.',
  },
  intentRate: {
    title: 'About Intent Rate',
    what: 'The percentage of views that turned into a meaningful action — like saves, directions, calls, or website taps.',
    why: 'Shows whether people are interested enough to take the next step after finding you.',
    how: 'A higher intent rate means your listing is attractive and useful. Work on photos and product info to improve it.',
    benchmarks: [
      {
        range: '0–5%',
        label: 'Needs Improvement',
        description: 'Most viewers are not taking action yet. Better photos, clearer product info, and a complete listing can make a big difference.',
      },
      {
        range: '5–10%',
        label: 'Average',
        description: 'Your listing is getting some meaningful actions. There is room to grow with stronger photos and updated product details.',
      },
      {
        range: '10–20%',
        label: 'Good',
        description: 'Your stand is attracting real interest. People are viewing it and taking action — keep it up.',
      },
      {
        range: '20%+',
        label: 'Excellent',
        description: 'Your listing is highly engaging. People are not just browsing — they are saving, getting directions, and taking meaningful next steps.',
      },
    ],
    tip: 'Intent rate improves with better photos, updated products, stock alerts, and a complete listing.',
  },
  conversionFunnel: {
    title: 'About Conversion Funnel',
    what: 'A step-by-step look at how customers move from viewing your listing all the way to taking action.',
    why: 'Helps you see exactly where people lose interest along the way.',
    how: 'If lots of people view but few save or tap directions, improve your listing quality or add a stronger call-to-action.',
  },
  saves: {
    title: 'About Saves',
    what: 'How many users saved your farmstand to come back to it later.',
    why: "Saving is a strong sign of interest — it means someone wants to remember you for later.",
    how: 'A high save count suggests customers may be planning a visit soon. Keep your listing fresh to convert savers to visitors.',
  },
  directions: {
    title: 'About Directions',
    what: 'How many times people tapped to get directions to your farmstand.',
    why: 'Getting directions is one of the strongest signs someone is planning to visit in person.',
    how: 'Track whether updates to your photos, products, or hours lead to more direction taps over time.',
  },
  calls: {
    title: 'About Calls',
    what: 'How many times someone tapped to call your farmstand directly from your listing.',
    why: 'Shows direct buying interest — customers who call are often ready to buy or have specific questions before visiting.',
    how: 'If call counts increase after listing updates, those changes are resonating with customers.',
  },
  website: {
    title: 'About Website',
    what: 'How many times users tapped your website link from your listing.',
    why: 'Shows that customers want to learn more about your farmstand, products, or story.',
    how: 'Make sure your website gives clear, current information that matches what customers expect from your listing.',
  },
  shares: {
    title: 'About Shares',
    what: 'How many times users shared your farmstand listing with someone else.',
    why: 'Shared listings spread word-of-mouth and can bring in new customers you never reached directly.',
    how: 'If people are sharing your stand, your listing is resonating. Keep it updated to maintain that momentum.',
  },
  callsAndMessages: {
    title: 'About Calls + Messages',
    what: 'The total number of direct contact actions taken by customers — calls and messages combined.',
    why: 'Shows how often people are trying to reach you, which is a sign of strong customer interest.',
    how: 'Use this to measure intent. A spike here often means something about your listing is working well.',
  },
  reviews: {
    title: 'About Reviews',
    what: 'Shows customer feedback, your total reviews, your average rating, and recent review activity.',
    why: 'Reviews build trust and can increase how many people click on and visit your stand.',
    how: 'Strong reviews improve conversions. Low ratings highlight areas where you can improve the customer experience.',
  },
};

// ─── Metric Explain Bottom Sheet ──────────────────────────────────────────────
interface MetricExplainSheetProps {
  visible: boolean;
  onClose: () => void;
  metricKey: string | null;
}

function MetricExplainSheet({ visible, onClose, metricKey }: MetricExplainSheetProps) {
  const insets = useSafeAreaInsets();
  if (!visible || !metricKey) return null;
  const info = METRIC_EXPLANATIONS[metricKey];
  if (!info) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Animated.View
          entering={SlideInUp.duration(300)}
          className="bg-white rounded-t-3xl"
          style={{ maxHeight: '92%', width: '100%' }}
          onStartShouldSetResponder={() => true}
        >
          {/* Handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-gray-300 rounded-full" />
          </View>

          {/* Header — fixed, does not scroll */}
          <View className="flex-row items-center justify-between px-5 pb-4 border-b border-gray-100">
            <Text className="text-gray-900 font-bold text-lg">{info.title}</Text>
            <Pressable onPress={onClose} className="p-2 -mr-2">
              <X size={22} color="#6b7280" />
            </Pressable>
          </View>

          {/* Scrollable content */}
          <ScrollView
            style={{ flexGrow: 0 }}
            showsVerticalScrollIndicator={true}
            bounces={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: insets.bottom + 48 }}
          >
            <View className="mb-4">
              <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">What it is</Text>
              <Text className="text-gray-700 text-base leading-relaxed">{info.what}</Text>
            </View>
            <View className="h-px bg-gray-100 mb-4" />
            <View className="mb-4">
              <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Why it matters</Text>
              <Text className="text-gray-700 text-base leading-relaxed">{info.why}</Text>
            </View>
            <View className="h-px bg-gray-100 mb-4" />
            <View className={info.benchmarks ? 'mb-4' : ''}>
              <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">How to use it</Text>
              <Text className="text-gray-700 text-base leading-relaxed">{info.how}</Text>
            </View>

            {/* Benchmark ranges — only rendered for metrics that define them (e.g. Intent Rate) */}
            {info.benchmarks && (
              <>
                <View className="h-px bg-gray-100 mb-4" />
                <View>
                  <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">How to read your number</Text>
                  {info.benchmarks.map((b, i) => (
                    <View key={i} className="mb-2 bg-gray-50 rounded-xl p-3">
                      <View className="flex-row items-center mb-1" style={{ gap: 6 }}>
                        <Text className="text-green-700 font-bold text-sm">{b.range}</Text>
                        <View className="w-1 h-1 bg-gray-300 rounded-full" />
                        <Text className="text-gray-700 font-semibold text-sm">{b.label}</Text>
                      </View>
                      <Text className="text-gray-500 text-sm leading-relaxed">{b.description}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Encouraging tip shown below benchmarks */}
            {info.tip && (
              <View className="mt-3">
                <Text className="text-gray-400 text-sm leading-relaxed">{info.tip}</Text>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// Premium KPI Card
interface KPICardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
  size?: 'normal' | 'large';
  onInfoPress?: () => void;
}

function KPICard({ title, value, icon, color, subtitle, size = 'normal', onInfoPress }: KPICardProps) {
  const isLarge = size === 'large';
  return (
    <Pressable
      onPress={onInfoPress}
      className={`bg-white rounded-2xl border border-gray-100 ${isLarge ? 'p-5' : 'p-4'} flex-1 min-w-[140px]`}
      style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8 }}
    >
      <View className="flex-row items-center justify-between mb-2">
        <View
          className="w-9 h-9 rounded-xl items-center justify-center"
          style={{ backgroundColor: color + '15' }}
        >
          {icon}
        </View>
        {onInfoPress && <Info size={15} color="#c4c9d4" />}
      </View>
      <Text className={`font-bold text-gray-900 ${isLarge ? 'text-3xl' : 'text-2xl'}`}>{value}</Text>
      <Text className="text-gray-500 text-sm mt-1">{title}</Text>
      {subtitle && <Text className="text-gray-400 text-xs mt-0.5">{subtitle}</Text>}
    </Pressable>
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
  onInfoPress?: () => void;
}

function FunnelStage({ label, value, conversionRate, icon, color, isFirst, onInfoPress }: FunnelStageProps) {
  return (
    <View className="items-center">
      {!isFirst && (
        <View className="items-center mb-2">
          <ChevronDown size={18} color="#9ca3af" />
          {conversionRate !== undefined && (
            <View className="bg-gray-100 px-2 py-0.5 rounded-full">
              <Text className="text-gray-600 text-xs font-medium">{conversionRate.toFixed(1)}%</Text>
            </View>
          )}
        </View>
      )}
      <Pressable
        onPress={onInfoPress}
        className="w-full rounded-xl p-4 items-center"
        style={{ backgroundColor: color + '10' }}
      >
        <View className="mb-2">{icon}</View>
        <Text className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</Text>
        <View className="flex-row items-center mt-0.5">
          <Text className="text-gray-600 text-sm">{label}</Text>
          {onInfoPress && <Info size={12} color="#c4c9d4" style={{ marginLeft: 4 }} />}
        </View>
      </Pressable>
    </View>
  );
}

// Health Item Component
interface HealthItemProps {
  label: string;
  isSet: boolean;
  actionLabel: string;
  onPress: () => void;
  icon: React.ReactNode;
}

function HealthItem({ label, isSet, actionLabel, onPress, icon }: HealthItemProps) {
  return (
    <View className="flex-row items-center py-3.5 border-b border-gray-50 last:border-b-0">
      <View
        className={`w-9 h-9 rounded-xl items-center justify-center mr-3 ${isSet ? 'bg-green-50' : 'bg-orange-50'}`}
      >
        {icon}
      </View>
      <Text className={`flex-1 ${isSet ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>
        {label}
      </Text>
      {isSet ? (
        <View className="bg-green-50 px-3 py-1.5 rounded-lg flex-row items-center">
          <CheckCircle size={14} color="#16a34a" />
          <Text className="text-green-700 text-xs font-medium ml-1">Done</Text>
        </View>
      ) : (
        <Pressable onPress={onPress} className="bg-forest px-4 py-2 rounded-xl">
          <Text className="text-white text-sm font-semibold">{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

// Metric Row Component
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

// Trend Row Component
interface TrendRowProps {
  date: string;
  views: number;
  saves: number;
  directions: number;
  reviews: number;
}

function TrendRow({ date, views, saves, directions, reviews }: TrendRowProps) {
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <View className="flex-row items-center py-2.5 border-b border-gray-50">
      <Text className="w-20 text-gray-500 text-sm">{formatDate(date)}</Text>
      <Text className="flex-1 text-center text-gray-900 font-medium">{views}</Text>
      <Text className="flex-1 text-center text-gray-900 font-medium">{saves}</Text>
      <Text className="flex-1 text-center text-gray-900 font-medium">{directions}</Text>
      <Text className="flex-1 text-center text-gray-900 font-medium">{reviews}</Text>
    </View>
  );
}

// Section Card Component
interface SectionCardProps {
  title: string;
  children: React.ReactNode;
  delay?: number;
  action?: { label: string; onPress: () => void };
  onInfoPress?: () => void;
}

function SectionCard({ title, children, delay = 0, action, onInfoPress }: SectionCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)} className="mb-5">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center flex-1">
          <Text className="text-gray-900 font-bold text-lg">{title}</Text>
          {onInfoPress && (
            <Pressable onPress={onInfoPress} className="ml-1.5 p-1" hitSlop={10}>
              <Info size={16} color="#c4c9d4" />
            </Pressable>
          )}
        </View>
        {action && (
          <Pressable onPress={action.onPress}>
            <Text className="text-forest font-medium text-sm">{action.label}</Text>
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

// Export Bottom Sheet
interface ExportSheetProps {
  visible: boolean;
  onClose: () => void;
  farmstandName: string;
  stats7Days: FarmstandStats7Days | null;
  stats30Days: FarmstandStats30Days | null;
  funnelData: {
    views: number;
    saves: number;
    directions: number;
    callsAndMessages: number;
    intentRate: number;
  };
  reviewStats: ReviewStats | null;
}

function ExportSheet({ visible, onClose, farmstandName, stats7Days, stats30Days, funnelData, reviewStats }: ExportSheetProps) {
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const generateSummary = useCallback(() => {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const viewToSavePct = funnelData.views > 0
      ? ((funnelData.saves / funnelData.views) * 100).toFixed(1)
      : '0.0';
    const saveToDirectionsPct = funnelData.saves > 0
      ? ((funnelData.directions / funnelData.saves) * 100).toFixed(1)
      : '0.0';
    const intentPct = funnelData.intentRate.toFixed(1);

    // Simple bar indicator: fills up to 10 chars based on percentage
    const bar = (pct: number, max = 100) => {
      const filled = Math.round(Math.min(pct, max) / max * 8);
      return '█'.repeat(filled) + '░'.repeat(8 - filled);
    };

    const rating = reviewStats?.avgRating ?? 0;
    const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));

    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${farmstandName}
Farmstand Analytics Report
${dateStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Performance — Last 7 Days
  Views          ${funnelData.views}
  Saves          ${funnelData.saves}
  Directions     ${funnelData.directions}
  Calls/Messages ${funnelData.callsAndMessages}

──────────────────────────────
Conversion Funnel
  View → Save      ${bar(Number(viewToSavePct))}  ${viewToSavePct}%
  Save → Direction ${bar(Number(saveToDirectionsPct))}  ${saveToDirectionsPct}%
  Overall Intent   ${bar(Number(intentPct))}  ${intentPct}%

──────────────────────────────
7-Day Activity Summary
  Views      ${stats7Days?.views || 0}
  Saves      ${stats7Days?.saves || 0}
  Directions ${stats7Days?.directions || 0}
  Calls      ${stats7Days?.calls || 0}
  Website    ${stats7Days?.website || 0}
  Shares     ${stats7Days?.shares || 0}

──────────────────────────────
Customer Intent — Last 30 Days
  Directions  ${stats30Days?.directions || 0}
  Calls       ${stats30Days?.calls || 0}
  Website     ${stats30Days?.website || 0}
  Shares      ${stats30Days?.shares || 0}
  Intent Rate ${intentPct}%

──────────────────────────────
Reviews & Ratings
  ${stars}  ${rating.toFixed(1)} out of 5
  Total Reviews    ${reviewStats?.totalReviews || 0}
  New (last 30d)   ${reviewStats?.newReviews30Days || 0}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by Farmstand
farmstand.app
`;
  }, [farmstandName, funnelData, stats7Days, stats30Days, reviewStats]);

  const buildAnalyticsCsv = useCallback(() => {
    // Safe CSV cell: wrap in quotes only when value contains comma, quote, or newline
    const c = (v: string | number | null | undefined): string => {
      const s = v == null ? '' : String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const row = (...cells: (string | number | null | undefined)[]) =>
      cells.map(c).join(',');

    return [
      row('Metric', 'Last 7 Days', 'Last 30 Days', 'All Time'),
      row('Views',            stats7Days?.views ?? 0,          '',                                    ''),
      row('Saves',            stats7Days?.saves ?? 0,          '',                                    ''),
      row('Directions',       stats7Days?.directions ?? 0,     stats30Days?.directions ?? 0,          ''),
      row('Calls + Messages', stats7Days?.calls ?? 0,          stats30Days?.calls ?? 0,               ''),
      row('Website',          stats7Days?.website ?? 0,        stats30Days?.website ?? 0,             ''),
      row('Shares',           stats7Days?.shares ?? 0,         stats30Days?.shares ?? 0,              ''),
      row('Intent Rate',      '',                              funnelData.intentRate.toFixed(2),      ''),
      row('Total Reviews',    '',                              '',                                    reviewStats?.totalReviews ?? 0),
      row('Average Rating',   '',                              '',                                    (reviewStats?.avgRating ?? 0).toFixed(2)),
      row('New Reviews',      '',                              reviewStats?.newReviews30Days ?? 0,    ''),
    ].join('\n');
  }, [funnelData, stats7Days, stats30Days, reviewStats]);

  const buildAnalyticsShareText = useCallback(() => {
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const intentPct = funnelData.intentRate.toFixed(1);
    const rating = reviewStats?.avgRating ?? 0;

    return `Farmstand Analytics Report
${farmstandName}
${dateStr}

Last 7 Days
Views: ${stats7Days?.views ?? 0}
Saves: ${stats7Days?.saves ?? 0}
Directions: ${stats7Days?.directions ?? 0}
Calls + Messages: ${stats7Days?.calls ?? 0}
Website: ${stats7Days?.website ?? 0}
Shares: ${stats7Days?.shares ?? 0}

Last 30 Days
Directions: ${stats30Days?.directions ?? 0}
Calls + Messages: ${stats30Days?.calls ?? 0}
Website: ${stats30Days?.website ?? 0}
Shares: ${stats30Days?.shares ?? 0}
Intent Rate: ${intentPct}%

Reviews & Ratings
Average Rating: ${rating.toFixed(1)} out of 5
Total Reviews: ${reviewStats?.totalReviews ?? 0}
New Reviews: ${reviewStats?.newReviews30Days ?? 0}

Generated by Farmstand
farmstand.app`;
  }, [farmstandName, funnelData, stats7Days, stats30Days, reviewStats]);

  const copyToClipboard = async (type: 'summary' | 'csv') => {
    const content = type === 'summary' ? generateSummary() : buildAnalyticsCsv();
    await Clipboard.setStringAsync(content);
    setCopySuccess(type);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  const shareReport = async () => {
    const summary = buildAnalyticsShareText();
    try {
      await Share.share({
        message: summary,
        title: `${farmstandName} Analytics`,
      });
    } catch (error) {
      console.log('Share error:', error);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Animated.View
          entering={SlideInUp.duration(300)}
          className="bg-white rounded-t-3xl"
          onStartShouldSetResponder={() => true}
        >
          {/* Handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-gray-300 rounded-full" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pb-4 border-b border-gray-100">
            <Text className="text-gray-900 font-bold text-lg">Export Analytics</Text>
            <Pressable onPress={onClose} className="p-2 -mr-2">
              <X size={22} color="#6b7280" />
            </Pressable>
          </View>

          {/* Content */}
          <View className="px-5 py-4">
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
                <Text className="text-gray-500 text-sm">Text format for sharing</Text>
              </View>
              <Copy size={18} color="#16a34a" />
            </Pressable>

            <Pressable
              onPress={() => copyToClipboard('csv')}
              className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex-row items-center mb-3"
            >
              <View className="w-10 h-10 rounded-lg bg-blue-100 items-center justify-center mr-3">
                <Download size={20} color="#3b82f6" />
              </View>
              <View className="flex-1">
                <Text className="text-gray-900 font-semibold">Copy CSV</Text>
                <Text className="text-gray-500 text-sm">For spreadsheets</Text>
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
          </View>

          {/* Safe area padding */}
          <View className="h-8" />
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// Main Component
interface OwnerAnalyticsProps {
  farmstandId: string | null;
}

export function OwnerAnalytics({ farmstandId }: OwnerAnalyticsProps) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const [explainMetricKey, setExplainMetricKey] = useState<string | null>(null);

  const openExplain = useCallback((key: string) => setExplainMetricKey(key), []);
  const closeExplain = useCallback(() => setExplainMetricKey(null), []);

  // Supabase analytics state - REAL data only, no fallbacks
  const [stats7Days, setStats7Days] = useState<FarmstandStats7Days | null>(null);
  const [stats30Days, setStats30Days] = useState<FarmstandStats30Days | null>(null);
  const [dailyTrends, setDailyTrends] = useState<DailyTrend[]>([]);
  const [reviewStats, setReviewStats] = useState<ReviewStats | null>(null);
  const [hasData, setHasData] = useState(false);

  // Keep local store for listing health
  const getListingHealth = useAnalyticsStore((s) => s.getListingHealth);

  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  const farmstand = farmstandId ? getFarmstandById(farmstandId) : null;
  const health = farmstandId ? getListingHealth(farmstandId, farmstand) : null;

  // Fetch REAL analytics from Supabase - filtered by farmstand_id ONLY
  const fetchAnalytics = useCallback(async () => {
    if (!farmstandId) {
      console.log('[OwnerAnalytics] No farmstandId — clearing loading state');
      setLoading(false);
      return;
    }

    console.log(`[OwnerAnalytics] Fetching analytics for farmstand: ${farmstandId}`);

    try {
      const result = await fetchOwnerAnalytics(farmstandId);

      // Set state from Supabase data - NO FALLBACKS
      setStats7Days(result.stats7Days);
      setStats30Days(result.stats30Days);
      setDailyTrends(result.dailyTrends);
      setReviewStats(result.reviewStats);
      setHasData(result.hasData);

      console.log(`[OwnerAnalytics] Loaded data, hasData: ${result.hasData}, views7d: ${result.stats7Days.views}`);
    } catch (e) {
      console.log('[OwnerAnalytics] Error fetching analytics:', e);
      // On error, show zeros - NOT fallback data
      setStats7Days({ views: 0, saves: 0, directions: 0, calls: 0, website: 0, shares: 0 });
      setStats30Days({ newReviews: 0, avgRating: 0, directions: 0, calls: 0, website: 0, shares: 0 });
      setDailyTrends([]);
      setReviewStats({ totalReviews: 0, avgRating: 0, ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, newReviews30Days: 0 });
      setHasData(false);
    }

    setLoading(false);
  }, [farmstandId]);

  useEffect(() => {
    loadAdminData();
    fetchAnalytics();
  }, [farmstandId, fetchAnalytics, loadAdminData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAdminData();
    await fetchAnalytics();
    setRefreshing(false);
  };

  // Calculate funnel data from 7-day stats
  const funnelData = useMemo(() => {
    const views = stats7Days?.views || 0;
    const saves = stats7Days?.saves || 0;
    const directions = stats7Days?.directions || 0;
    const calls = stats7Days?.calls || 0;
    // Calculate messages from 7-day data (we don't have separate messages in stats7Days,
    // but we track message_tap events - for now use 0 as placeholder)
    const messages = 0;
    const callsAndMessages = calls + messages;

    // Intent rate is calculated from 30-day data
    const views30d = (stats30Days?.directions || 0) + (stats30Days?.calls || 0) + (stats30Days?.website || 0) + (stats30Days?.shares || 0);
    // For intent rate, we need total views in 30 days - estimate from 7-day * 4
    const estimatedViews30d = (stats7Days?.views || 0) * 4;
    const intentActions30d = (stats30Days?.directions || 0) + (stats30Days?.calls || 0);
    const intentRate = estimatedViews30d > 0 ? (intentActions30d / estimatedViews30d) * 100 : 0;

    // Conversion rates
    const viewToSave = views > 0 ? (saves / views) * 100 : 0;
    const saveToDirections = saves > 0 ? (directions / saves) * 100 : 0;
    const directionsToContact = directions > 0 ? (callsAndMessages / directions) * 100 : 0;

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
      intentRate,
    };
  }, [stats7Days, stats30Days]);

  // Convert daily trends to the format expected by TrendRow
  const trends = useMemo(() => {
    return dailyTrends.map((d) => ({
      date: d.date,
      views: d.views,
      saves: d.saves,
      directions: d.directions,
      reviews: d.reviews,
    }));
  }, [dailyTrends]);

  // Loading state
  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
        <Text className="text-gray-500 mt-3">Loading analytics...</Text>
      </View>
    );
  }

  // Empty state - no farmstand
  if (!farmstandId) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <View className="bg-gray-100 p-4 rounded-full mb-4">
          <AlertCircle size={48} color="#6b7280" />
        </View>
        <Text className="text-gray-900 font-bold text-xl text-center mb-2">
          No Farmstand Connected
        </Text>
        <Text className="text-gray-500 text-center mb-6">
          Claim your farmstand to unlock analytics and see how customers interact with your listing.
        </Text>
        <Pressable
          onPress={() => router.push('/(tabs)')}
          className="bg-forest px-6 py-3 rounded-xl"
        >
          <Text className="text-white font-semibold">Find Your Farmstand</Text>
        </Pressable>
      </View>
    );
  }

  // Always show full analytics UI — even with zero data.
  // A brand-new approved owner should see the cards at 0 so they know what to expect,
  // not a "No Activity Yet" screen that looks like an error.
  const hasActivity = stats7Days && (stats7Days.views > 0 || stats7Days.saves > 0);
  const ratingDistribution: { [rating: number]: number } = reviewStats?.ratingDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const totalReviews: number = reviewStats?.totalReviews || 0;

  return (
    <>
      <ScrollView
        className="flex-1 bg-gray-50"
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2D5A3D" />
        }
      >
        {/* No-activity banner: shown when there's no data yet, but we still render all cards */}
        {!hasActivity && (
          <Animated.View entering={FadeInDown.delay(0).duration(400)} className="mb-5">
            <View className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex-row items-center">
              <TrendingUp size={22} color="#3b82f6" />
              <View className="flex-1 ml-3">
                <Text className="text-blue-900 font-semibold text-sm">Analytics are live</Text>
                <Text className="text-blue-700 text-xs mt-0.5">
                  Once customers view your listing, data will start appearing here.
                </Text>
              </View>
            </View>
          </Animated.View>
        )}
        <Animated.View entering={FadeInDown.delay(0).duration(400)} className="flex-row flex-wrap gap-3 mb-5">
          <KPICard
            title="Views (7d)"
            value={stats7Days?.views || 0}
            icon={<Eye size={18} color="#3b82f6" />}
            color="#3b82f6"
            size="large"
            onInfoPress={() => openExplain('views')}
          />
          <KPICard
            title="Intent Rate"
            value={`${funnelData.intentRate.toFixed(1)}%`}
            subtitle="Actions / Views"
            icon={<Target size={18} color="#16a34a" />}
            color="#16a34a"
            size="large"
            onInfoPress={() => openExplain('intentRate')}
          />
        </Animated.View>

        {/* Conversion Funnel */}
        <SectionCard title="Conversion Funnel (7 Days)" delay={100} onInfoPress={() => openExplain('conversionFunnel')}>
          <View className="py-2">
            <FunnelStage
              label="Views"
              value={funnelData.views}
              icon={<Eye size={22} color="#3b82f6" />}
              color="#3b82f6"
              isFirst
              onInfoPress={() => openExplain('views')}
            />
            <FunnelStage
              label="Saves"
              value={funnelData.saves}
              conversionRate={funnelData.viewToSave}
              icon={<Heart size={22} color="#ec4899" />}
              color="#ec4899"
              onInfoPress={() => openExplain('saves')}
            />
            <FunnelStage
              label="Directions"
              value={funnelData.directions}
              conversionRate={funnelData.saveToDirections}
              icon={<Navigation size={22} color="#16a34a" />}
              color="#16a34a"
              onInfoPress={() => openExplain('directions')}
            />
            <FunnelStage
              label="Calls + Messages"
              value={funnelData.callsAndMessages}
              conversionRate={funnelData.directionsToContact}
              icon={<Phone size={22} color="#f59e0b" />}
              color="#f59e0b"
              onInfoPress={() => openExplain('callsAndMessages')}
            />
          </View>
        </SectionCard>

        {/* Customer Intent - 30 Days */}
        <SectionCard title="Customer Intent (30 Days)" delay={200}>
          <View className="flex-row flex-wrap gap-3">
            <KPICard
              title="Directions"
              value={stats30Days?.directions || 0}
              icon={<Navigation size={16} color="#16a34a" />}
              color="#16a34a"
              onInfoPress={() => openExplain('directions')}
            />
            <KPICard
              title="Calls"
              value={stats30Days?.calls || 0}
              icon={<Phone size={16} color="#8b5cf6" />}
              color="#8b5cf6"
              onInfoPress={() => openExplain('calls')}
            />
          </View>
          <View className="flex-row flex-wrap gap-3 mt-3">
            <KPICard
              title="Website"
              value={stats30Days?.website || 0}
              icon={<Globe size={16} color="#0ea5e9" />}
              color="#0ea5e9"
              onInfoPress={() => openExplain('website')}
            />
            <KPICard
              title="Shares"
              value={stats30Days?.shares || 0}
              icon={<Share2 size={16} color="#f59e0b" />}
              color="#f59e0b"
              onInfoPress={() => openExplain('shares')}
            />
          </View>
        </SectionCard>

        {/* Reviews Summary */}
        <SectionCard title="Reviews" delay={300} onInfoPress={() => openExplain('reviews')}>
          <View className="flex-row items-center mb-4">
            <View className="items-center mr-6">
              <Text className="text-3xl font-bold text-gray-900">
                {reviewStats?.avgRating?.toFixed(1) || '0.0'}
              </Text>
              <View className="flex-row items-center mt-1">
                <Star size={14} color="#f59e0b" fill="#f59e0b" />
                <Text className="text-gray-500 text-sm ml-1">avg rating</Text>
              </View>
            </View>
            <View className="flex-1">
              <Text className="text-gray-700 font-medium mb-2">
                {totalReviews} total review{totalReviews !== 1 ? 's' : ''}
              </Text>
              {[5, 4, 3, 2, 1].map((rating) => (
                <View key={rating} className="flex-row items-center mb-1">
                  <Text className="text-gray-500 text-xs w-4">{rating}</Text>
                  <View className="flex-1 h-2 bg-gray-100 rounded-full mx-2 overflow-hidden">
                    <View
                      className="h-full bg-amber-400 rounded-full"
                      style={{
                        width: `${totalReviews > 0 ? (ratingDistribution[rating] / totalReviews) * 100 : 0}%`,
                      }}
                    />
                  </View>
                  <Text className="text-gray-400 text-xs w-6">{ratingDistribution[rating]}</Text>
                </View>
              ))}
            </View>
          </View>
          <Text className="text-gray-500 text-sm">
            {stats30Days?.newReviews || 0} new review{(stats30Days?.newReviews || 0) !== 1 ? 's' : ''} in the last 30 days
          </Text>
        </SectionCard>

        {/* Trends - 7 Days Table */}
        <SectionCard title="Daily Trends (7 Days)" delay={400}>
          {/* Header */}
          <View className="flex-row items-center py-2.5 bg-gray-50 -mx-4 px-4 -mt-4 rounded-t-xl border-b border-gray-100">
            <Text className="w-20 text-gray-500 text-xs font-semibold">Date</Text>
            <Text className="flex-1 text-center text-gray-500 text-xs font-semibold">Views</Text>
            <Text className="flex-1 text-center text-gray-500 text-xs font-semibold">Saves</Text>
            <Text className="flex-1 text-center text-gray-500 text-xs font-semibold">Dirs</Text>
            <Text className="flex-1 text-center text-gray-500 text-xs font-semibold">Reviews</Text>
          </View>
          {/* Show last 7 days in table */}
          {trends.length > 0 ? (
            trends.slice(-7).reverse().map((day) => (
              <TrendRow
                key={day.date}
                date={day.date}
                views={day.views}
                saves={day.saves}
                directions={day.directions}
                reviews={day.reviews}
              />
            ))
          ) : (
            <Text className="text-gray-400 text-center py-4">No trend data yet</Text>
          )}
        </SectionCard>

        {/* Listing Health & Next Actions */}
        {health && (
          <SectionCard title="Listing Health" delay={500}>
            <HealthItem
              label="Contact method"
              isSet={health.has_contact}
              actionLabel="Add"
              onPress={() => router.push(`/owner/edit?id=${farmstandId}`)}
              icon={<Phone size={18} color={health.has_contact ? '#16a34a' : '#f59e0b'} />}
            />
            <HealthItem
              label="Photos"
              isSet={health.has_photos}
              actionLabel="Add"
              onPress={() => router.push(`/owner/edit?id=${farmstandId}`)}
              icon={<ImageIcon size={18} color={health.has_photos ? '#16a34a' : '#f59e0b'} />}
            />
            <HealthItem
              label="Hours"
              isSet={health.has_hours}
              actionLabel="Set"
              onPress={() => router.push(`/owner/hours?id=${farmstandId}`)}
              icon={<Clock size={18} color={health.has_hours ? '#16a34a' : '#f59e0b'} />}
            />
            <HealthItem
              label="Products"
              isSet={health.has_products}
              actionLabel="Add"
              onPress={() => router.push(`/owner/products?id=${farmstandId}`)}
              icon={<Package size={18} color={health.has_products ? '#16a34a' : '#f59e0b'} />}
            />
            <HealthItem
              label="Location"
              isSet={health.has_location}
              actionLabel="Set"
              onPress={() => router.push(`/owner/location?id=${farmstandId}`)}
              icon={<MapPin size={18} color={health.has_location ? '#16a34a' : '#f59e0b'} />}
            />
          </SectionCard>
        )}

        {/* Export Button */}
        <Animated.View entering={FadeInDown.delay(600).duration(400)}>
          <Pressable
            onPress={() => setShowExportSheet(true)}
            className="bg-forest rounded-xl py-4 flex-row items-center justify-center"
            style={{ shadowColor: '#2D5A3D', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 }}
          >
            <Download size={20} color="white" />
            <Text className="text-white font-semibold text-lg ml-2">Export Analytics</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>

      {/* Metric Explanation Sheet */}
      <MetricExplainSheet
        visible={explainMetricKey !== null}
        onClose={closeExplain}
        metricKey={explainMetricKey}
      />

      {/* Export Bottom Sheet */}
      <ExportSheet
        visible={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        farmstandName={farmstand?.name || 'Farmstand'}
        stats7Days={stats7Days}
        stats30Days={stats30Days}
        funnelData={funnelData}
        reviewStats={reviewStats}
      />
    </>
  );
}
