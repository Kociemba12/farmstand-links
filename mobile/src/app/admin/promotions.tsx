import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Image,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import {
  ChevronLeft,
  Search,
  X,
  Calendar,
  Clock,
  TrendingUp,
  MapPin,
  ChevronRight,
  Megaphone,
  Zap,
  Eye,
  MousePointer,
  Package,
  MoreHorizontal,
  Receipt,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown, FadeInRight } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { useAdminStore } from '@/lib/admin-store';
import {
  usePromotionsStore,
  getPromoStatus,
} from '@/lib/promotions-store';
import { Farmstand } from '@/lib/farmer-store';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { Promotion, PromotionType } from '@/app/owner/promotions';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatPromotionType(type: PromotionType): string {
  switch (type) {
    case 'featured_explore_7':  return 'Featured in Explore (7 Days)';
    case 'featured_explore_30': return 'Featured in Explore (30 Days)';
    case 'map_boost_7':         return 'Map Boost (7 Days)';
    case 'seasonal_spotlight':  return 'Seasonal Spotlight';
    default:                    return type;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: 'Active',    color: '#166534', bg: '#DCFCE7' },
  scheduled: { label: 'Scheduled', color: '#92400E', bg: '#FEF3C7' },
  expired:   { label: 'Expired',   color: '#6B7280', bg: '#F3F4F6' },
};

function statusSort(s: string) {
  if (s === 'active')    return 0;
  if (s === 'scheduled') return 1;
  return 2;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type MainTab = 'paid' | 'auto';
type PaidFilter = 'all' | 'active' | 'scheduled' | 'expired';

interface EnrichedPromotion extends Promotion {
  farmstandName: string;
  farmstandCity: string | null;
  farmstandPhoto: string | null;
}

// ─────────────────────────────────────────────────────────────
// Paid Promotion Card
// ─────────────────────────────────────────────────────────────

function PaidPromotionCard({
  promo,
  index,
  onActions,
}: {
  promo: EnrichedPromotion;
  index: number;
  onActions: (promo: EnrichedPromotion) => void;
}) {
  const meta = STATUS_META[promo.status] ?? STATUS_META.expired;

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <View
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 18,
          marginBottom: 12,
          shadowColor: '#1C1C1C',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 2,
          borderWidth: 1,
          borderColor: '#F0EDE8',
          overflow: 'hidden',
        }}
      >
        {/* Status stripe */}
        <View style={{ height: 3, backgroundColor: meta.color, opacity: 0.5 }} />

        <View style={{ padding: 16 }}>
          {/* Header row */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
            {/* Farmstand photo */}
            {promo.farmstandPhoto ? (
              <Image
                source={{ uri: promo.farmstandPhoto }}
                style={{ width: 48, height: 48, borderRadius: 12, marginRight: 12 }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  width: 48, height: 48, borderRadius: 12, marginRight: 12,
                  backgroundColor: '#F3EFE8', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Package size={20} color="#A09880" />
              </View>
            )}

            {/* Name + location */}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A', marginBottom: 2, letterSpacing: -0.2 }} numberOfLines={1}>
                {promo.farmstandName}
              </Text>
              {promo.farmstandCity && (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <MapPin size={11} color="#9A8F82" />
                  <Text style={{ fontSize: 12, color: '#9A8F82', marginLeft: 3 }}>{promo.farmstandCity}</Text>
                </View>
              )}
            </View>

            {/* Status badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ backgroundColor: meta.bg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: meta.color }}>{meta.label}</Text>
              </View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onActions(promo);
                }}
                hitSlop={8}
                style={{ padding: 4 }}
              >
                <MoreHorizontal size={18} color="#9A8F82" />
              </Pressable>
            </View>
          </View>

          {/* Promotion type pill */}
          <View
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: '#F7F4EE', borderRadius: 10,
              paddingHorizontal: 10, paddingVertical: 6,
              marginBottom: 12, alignSelf: 'flex-start',
            }}
          >
            <Zap size={13} color="#2F5D50" />
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#2F5D50', marginLeft: 5 }}>
              {formatPromotionType(promo.type)}
            </Text>
          </View>

          {/* Dates row */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <Calendar size={13} color="#9A8F82" />
              <View style={{ marginLeft: 6 }}>
                <Text style={{ fontSize: 10, color: '#B0A898', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 }}>Start</Text>
                <Text style={{ fontSize: 13, color: '#3A3530', fontWeight: '600' }}>{formatDate(promo.startDate)}</Text>
              </View>
            </View>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <Clock size={13} color="#9A8F82" />
              <View style={{ marginLeft: 6 }}>
                <Text style={{ fontSize: 10, color: '#B0A898', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 }}>End</Text>
                <Text style={{ fontSize: 13, color: '#3A3530', fontWeight: '600' }}>{formatDate(promo.endDate)}</Text>
              </View>
            </View>
          </View>

          {/* Metrics row */}
          <View
            style={{
              flexDirection: 'row', gap: 8,
              backgroundColor: '#FAF8F3', borderRadius: 12,
              padding: 10,
            }}
          >
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
              <Eye size={14} color="#7C9A84" />
              <Text style={{ fontSize: 13, color: '#3A3530', fontWeight: '600', marginLeft: 5 }}>
                {promo.impressions.toLocaleString()}
              </Text>
              <Text style={{ fontSize: 11, color: '#9A8F82', marginLeft: 3 }}>views</Text>
            </View>
            <View style={{ width: 1, backgroundColor: '#EDE9E0' }} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
              <MousePointer size={14} color="#7C9A84" />
              <Text style={{ fontSize: 13, color: '#3A3530', fontWeight: '600', marginLeft: 5 }}>
                {promo.clicks.toLocaleString()}
              </Text>
              <Text style={{ fontSize: 11, color: '#9A8F82', marginLeft: 3 }}>clicks</Text>
            </View>
            {promo.impressions > 0 && (
              <>
                <View style={{ width: 1, backgroundColor: '#EDE9E0' }} />
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
                  <TrendingUp size={14} color="#7C9A84" />
                  <Text style={{ fontSize: 13, color: '#3A3530', fontWeight: '600', marginLeft: 5 }}>
                    {((promo.clicks / promo.impressions) * 100).toFixed(1)}%
                  </Text>
                  <Text style={{ fontSize: 11, color: '#9A8F82', marginLeft: 3 }}>CTR</Text>
                </View>
              </>
            )}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────
// Auto-Featured Farmstand Card (existing logic, unchanged)
// ─────────────────────────────────────────────────────────────

function AutoFarmstandCard({
  farmstand,
  index,
  onPress,
}: {
  farmstand: Farmstand;
  index: number;
  onPress: () => void;
}) {
  const promoStatus = getPromoStatus(farmstand);
  const isPromoted = farmstand.promoActive && promoStatus !== 'none';
  const mainPhoto =
    farmstand.photos[farmstand.mainPhotoIndex ?? 0] ??
    farmstand.photos[0] ??
    'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=800';

  let statusBadge = { label: '', color: '', bg: '' };
  if (isPromoted) {
    if (promoStatus === 'active')    statusBadge = { label: 'Promoted',  color: '#166534', bg: '#DCFCE7' };
    else if (promoStatus === 'scheduled') statusBadge = { label: 'Scheduled', color: '#92400E', bg: '#FEF3C7' };
    else if (promoStatus === 'expired')   statusBadge = { label: 'Expired',   color: '#6B7280', bg: '#F3F4F6' };
  } else if (farmstand.popularityScore > 0) {
    statusBadge = { label: 'Auto-Featured', color: '#6D28D9', bg: '#EDE9FE' };
  }

  const categoryCount = farmstand.promoExploreCategories?.length || 0;

  return (
    <Animated.View entering={FadeInRight.delay(index * 50).duration(300)}>
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 16,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: '#F0EDE8',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 6,
          elevation: 2,
          overflow: 'hidden',
        }}
      >
        <View style={{ flexDirection: 'row', padding: 12 }}>
          <Image source={{ uri: mainPhoto }} style={{ width: 56, height: 56, borderRadius: 12 }} resizeMode="cover" />
          <View style={{ flex: 1, marginLeft: 12, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A', flex: 1 }} numberOfLines={1}>
                {farmstand.name}
              </Text>
              <ChevronRight size={16} color="#B0A898" />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
              <MapPin size={11} color="#9A8F82" />
              <Text style={{ fontSize: 12, color: '#9A8F82', marginLeft: 3 }} numberOfLines={1}>
                {farmstand.city || 'Oregon'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 }}>
              {statusBadge.label ? (
                <View style={{ backgroundColor: statusBadge.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: statusBadge.color }}>{statusBadge.label}</Text>
                </View>
              ) : null}
              {farmstand.promoMapBoost && (
                <View style={{ backgroundColor: '#EFF6FF', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#1D4ED8' }}>Map Boost</Text>
                </View>
              )}
              {categoryCount > 0 && (
                <View style={{ backgroundColor: '#FFFBEB', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#B45309' }}>
                    {categoryCount} {categoryCount === 1 ? 'Category' : 'Categories'}
                  </Text>
                </View>
              )}
              {!isPromoted && farmstand.popularityScore > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EDE9FE', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <TrendingUp size={10} color="#6D28D9" />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#6D28D9', marginLeft: 3 }}>
                    {farmstand.popularityScore}
                  </Text>
                </View>
              )}
              {__DEV__ && isPromoted && (
                <View style={{ backgroundColor: '#F3F4F6', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 10, fontFamily: 'monospace', color: '#6B7280' }}>
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
}

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────

export default function PromotionsScreen() {
  const router = useRouter();

  // Tab state
  const [mainTab, setMainTab] = useState<MainTab>('paid');
  const [paidFilter, setPaidFilter] = useState<PaidFilter>('all');
  const [autoFilterTab, setAutoFilterTab] = useState<'all' | 'active' | 'scheduled' | 'expired' | 'auto'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Paid promotions state
  const [paidPromotions, setPaidPromotions] = useState<EnrichedPromotion[]>([]);
  const [paidLoading, setPaidLoading] = useState(false);

  // Stores
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const loadPromotionsData = usePromotionsStore((s) => s.loadPromotionsData);
  const getPromotionSummary = usePromotionsStore((s) => s.getPromotionSummary);
  const getActivePromotions = usePromotionsStore((s) => s.getActivePromotions);
  const getScheduledPromotions = usePromotionsStore((s) => s.getScheduledPromotions);
  const getExpiredPromotions = usePromotionsStore((s) => s.getExpiredPromotions);
  const getAutoFeatured = usePromotionsStore((s) => s.getAutoFeatured);

  // ── Fetch paid promotions from Supabase ──────────────────────
  const fetchPaidPromotions = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    setPaidLoading(true);
    try {
      console.log('[AdminPromotions] Fetching paid promotions from DB...');
      const { data, error } = await supabase
        .from<Record<string, unknown>>('promotions')
        .select('*')
        .order('start_date', { ascending: false })
        .execute();

      if (error) {
        console.log('[AdminPromotions] promotions table error:', error.message);
        setPaidPromotions([]);
        return;
      }

      if (!data || data.length === 0) {
        console.log('[AdminPromotions] No paid promotions found (table may be empty or not yet created)');
        setPaidPromotions([]);
        return;
      }

      // Enrich with farmstand data from the store
      const farmstandMap = new Map(allFarmstands.map((f) => [f.id, f]));

      const enriched: EnrichedPromotion[] = data.map((row) => {
        const farmstandId = (row['farmstand_id'] ?? row['farmstandId'] ?? '') as string;
        const fs = farmstandMap.get(farmstandId);
        const mainPhoto = fs
          ? (fs.photos[fs.mainPhotoIndex ?? 0] ?? fs.photos[0] ?? fs.heroPhotoUrl ?? null)
          : null;

        return {
          id: (row['id'] ?? '') as string,
          type: (row['type'] ?? 'featured_explore_7') as PromotionType,
          farmstandId,
          ownerUserId: (row['owner_user_id'] ?? row['ownerUserId'] ?? '') as string,
          startDate: (row['start_date'] ?? row['startDate'] ?? null) as string | null,
          endDate: (row['end_date'] ?? row['endDate'] ?? null) as string | null,
          status: (row['status'] ?? 'expired') as Promotion['status'],
          paymentProductId: (row['payment_product_id'] ?? row['paymentProductId'] ?? null) as string | null,
          purchaseId: (row['purchase_id'] ?? row['purchaseId'] ?? null) as string | null,
          impressions: Number(row['impressions'] ?? 0),
          clicks: Number(row['clicks'] ?? 0),
          farmstandName: fs?.name ?? 'Unknown Farmstand',
          farmstandCity: fs?.city ?? null,
          farmstandPhoto: mainPhoto,
        };
      });

      // Sort: active → scheduled → expired, then by startDate desc within each group
      enriched.sort((a, b) => {
        const s = statusSort(a.status) - statusSort(b.status);
        if (s !== 0) return s;
        return new Date(b.startDate ?? 0).getTime() - new Date(a.startDate ?? 0).getTime();
      });

      console.log(`[AdminPromotions] Loaded ${enriched.length} paid promotions`);
      console.log('[AdminPromotions] Status counts:', {
        active: enriched.filter((p) => p.status === 'active').length,
        scheduled: enriched.filter((p) => p.status === 'scheduled').length,
        expired: enriched.filter((p) => p.status === 'expired').length,
      });
      setPaidPromotions(enriched);
    } catch (err) {
      console.log('[AdminPromotions] fetch error:', err);
      setPaidPromotions([]);
    } finally {
      setPaidLoading(false);
    }
  }, [allFarmstands]);

  // Load on mount
  useEffect(() => {
    loadAdminData();
    loadPromotionsData();
    fetchPaidPromotions();
  }, []);

  // Re-enrich when farmstands load
  useEffect(() => {
    if (allFarmstands.length > 0) {
      fetchPaidPromotions();
    }
  }, [allFarmstands.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadAdminData(), loadPromotionsData()]);
    await fetchPaidPromotions();
    setRefreshing(false);
  }, [loadAdminData, loadPromotionsData, fetchPaidPromotions]);

  // ── Derived data ──────────────────────────────────────────────

  const autoSummary = useMemo(() => getPromotionSummary(allFarmstands), [allFarmstands, getPromotionSummary]);

  const filteredPaid = useMemo(() => {
    let result = paidFilter === 'all'
      ? paidPromotions
      : paidPromotions.filter((p) => p.status === paidFilter);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.farmstandName.toLowerCase().includes(q) ||
          p.farmstandCity?.toLowerCase().includes(q) ||
          formatPromotionType(p.type).toLowerCase().includes(q)
      );
    }
    return result;
  }, [paidPromotions, paidFilter, searchQuery]);

  const filteredAuto = useMemo(() => {
    let result: Farmstand[] = [];
    switch (autoFilterTab) {
      case 'active':    result = getActivePromotions(allFarmstands); break;
      case 'scheduled': result = getScheduledPromotions(allFarmstands); break;
      case 'expired':   result = getExpiredPromotions(allFarmstands); break;
      case 'auto':      result = getAutoFeatured(allFarmstands, 30); break;
      default:
        result = [
          ...getActivePromotions(allFarmstands),
          ...getScheduledPromotions(allFarmstands),
          ...getAutoFeatured(allFarmstands, 10),
        ];
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.city?.toLowerCase().includes(q) ||
          f.offerings.some((o) => o.toLowerCase().includes(q))
      );
    }
    return result;
  }, [autoFilterTab, searchQuery, allFarmstands, getActivePromotions, getScheduledPromotions, getExpiredPromotions, getAutoFeatured]);

  // ── Paid promo counts ─────────────────────────────────────────

  const paidCounts = useMemo(() => ({
    all:       paidPromotions.length,
    active:    paidPromotions.filter((p) => p.status === 'active').length,
    scheduled: paidPromotions.filter((p) => p.status === 'scheduled').length,
    expired:   paidPromotions.filter((p) => p.status === 'expired').length,
  }), [paidPromotions]);

  // ── Actions modal ─────────────────────────────────────────────

  const handlePromotionActions = (promo: EnrichedPromotion) => {
    Alert.alert(
      promo.farmstandName,
      formatPromotionType(promo.type),
      [
        {
          text: 'View Purchase Details',
          onPress: () => {
            const details = [
              `Status: ${promo.status}`,
              `Type: ${formatPromotionType(promo.type)}`,
              `Start: ${formatDate(promo.startDate)}`,
              `End: ${formatDate(promo.endDate)}`,
              `Impressions: ${promo.impressions.toLocaleString()}`,
              `Clicks: ${promo.clicks.toLocaleString()}`,
              promo.purchaseId ? `Purchase ID: ${promo.purchaseId}` : null,
              promo.paymentProductId ? `Product ID: ${promo.paymentProductId}` : null,
            ].filter(Boolean).join('\n');
            Alert.alert('Purchase Details', details, [{ text: 'OK' }]);
          },
        },
        {
          text: 'Cancel Promotion',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Cancel Promotion',
              'Cancelling paid promotions requires backend support. This will be available when RevenueCat is connected.',
              [{ text: 'OK' }]
            );
          },
        },
        {
          text: 'Extend Promotion',
          onPress: () => {
            Alert.alert(
              'Extend Promotion',
              'Extending paid promotions requires backend support. This will be available when RevenueCat is connected.',
              [{ text: 'OK' }]
            );
          },
        },
        { text: 'Dismiss', style: 'cancel' },
      ]
    );
  };

  // ── Filter chip helpers ───────────────────────────────────────

  const renderPaidFilterChip = (tab: PaidFilter, label: string, count: number) => {
    const isActive = paidFilter === tab;
    return (
      <Pressable
        key={tab}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setPaidFilter(tab);
        }}
        style={{
          marginRight: 8,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          borderWidth: 1.5,
          borderColor: isActive ? '#2F5D50' : '#DED7CC',
          backgroundColor: isActive ? '#2F5D50' : '#FFFFFF',
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: isActive ? '#FFFFFF' : '#6B6355' }}>
          {label}{count > 0 ? ` (${count})` : ''}
        </Text>
      </Pressable>
    );
  };

  const renderAutoFilterChip = (tab: 'all' | 'active' | 'scheduled' | 'expired' | 'auto', label: string, count: number) => {
    const isActive = autoFilterTab === tab;
    return (
      <Pressable
        key={tab}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setAutoFilterTab(tab);
        }}
        style={{
          marginRight: 8,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 20,
          borderWidth: 1.5,
          borderColor: isActive ? '#2F5D50' : '#DED7CC',
          backgroundColor: isActive ? '#2F5D50' : '#FFFFFF',
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: isActive ? '#FFFFFF' : '#6B6355' }}>
          {label}{count > 0 ? ` (${count})` : ''}
        </Text>
      </Pressable>
    );
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: '#FAF7F2' }}>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FAF7F2' }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={{
              width: 38, height: 38, borderRadius: 19,
              backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: '#E8E0D8',
            }}
          >
            <ChevronLeft size={22} color="#3D3D3D" />
          </Pressable>
          <Text style={{ flex: 1, fontSize: 20, fontWeight: '700', color: '#1A1A1A', marginLeft: 14, letterSpacing: -0.3 }}>
            Promotions
          </Text>
        </View>

        {/* Main tabs */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 4, gap: 8 }}>
          {(['paid', 'auto'] as const).map((tab) => {
            const isActive = mainTab === tab;
            return (
              <Pressable
                key={tab}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setMainTab(tab);
                  setSearchQuery('');
                }}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 14,
                  backgroundColor: isActive ? '#1A1A1A' : '#FFFFFF',
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: isActive ? '#1A1A1A' : '#E8E0D8',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: isActive ? '#FFFFFF' : '#6B6355' }}>
                  {tab === 'paid' ? `Paid Promotions${paidCounts.all > 0 ? ` (${paidCounts.all})` : ''}` : 'Auto-Featured'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2D5A3D" />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }}
      >
        {/* Search bar */}
        <Animated.View entering={FadeIn.delay(100).duration(300)} style={{ marginBottom: 16 }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: '#FFFFFF', borderRadius: 16,
              paddingHorizontal: 14, paddingVertical: 12,
              borderWidth: 1, borderColor: '#E8E0D8',
            }}
          >
            <Search size={18} color="#9A8F82" />
            <TextInput
              style={{ flex: 1, marginLeft: 10, fontSize: 15, color: '#1A1A1A' }}
              placeholder={mainTab === 'paid' ? 'Search paid promotions…' : 'Search farmstands…'}
              placeholderTextColor="#B0A898"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <X size={16} color="#9A8F82" />
              </Pressable>
            )}
          </View>
        </Animated.View>

        {/* ── PAID PROMOTIONS TAB ── */}
        {mainTab === 'paid' && (
          <>
            {/* Summary strip */}
            <Animated.View entering={FadeInDown.delay(80).springify()}>
              <View
                style={{
                  flexDirection: 'row', gap: 8,
                  backgroundColor: '#FFFFFF', borderRadius: 16,
                  padding: 14, marginBottom: 16,
                  borderWidth: 1, borderColor: '#F0EDE8',
                }}
              >
                {[
                  { label: 'Active',    count: paidCounts.active,    color: '#166534', bg: '#DCFCE7' },
                  { label: 'Scheduled', count: paidCounts.scheduled, color: '#92400E', bg: '#FEF3C7' },
                  { label: 'Expired',   count: paidCounts.expired,   color: '#6B7280', bg: '#F3F4F6' },
                ].map((item) => (
                  <View key={item.label} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                    <View style={{ backgroundColor: item.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: item.color }}>{item.count}</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: '#9A8F82', fontWeight: '500' }}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>

            {/* Filter chips */}
            <Animated.View entering={FadeInDown.delay(120).springify()} style={{ marginBottom: 16 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {renderPaidFilterChip('all',       'All',       paidCounts.all)}
                {renderPaidFilterChip('active',    'Active',    paidCounts.active)}
                {renderPaidFilterChip('scheduled', 'Scheduled', paidCounts.scheduled)}
                {renderPaidFilterChip('expired',   'Expired',   paidCounts.expired)}
              </ScrollView>
            </Animated.View>

            {/* Content */}
            {paidLoading ? (
              <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <ActivityIndicator size="small" color="#2F5D50" />
                <Text style={{ marginTop: 12, fontSize: 14, color: '#9A8F82' }}>Loading promotions…</Text>
              </View>
            ) : filteredPaid.length === 0 ? (
              <Animated.View entering={FadeInDown.delay(160).springify()}>
                <View
                  style={{
                    alignItems: 'center', paddingVertical: 56,
                    backgroundColor: '#FFFFFF', borderRadius: 20,
                    borderWidth: 1, borderColor: '#F0EDE8',
                  }}
                >
                  <View
                    style={{
                      width: 64, height: 64, borderRadius: 32,
                      backgroundColor: '#F7F4EE', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <Receipt size={28} color="#C8B89A" />
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#3A3530', marginBottom: 6 }}>
                    {paidFilter === 'all' ? 'No paid promotions yet' : `No ${paidFilter} promotions`}
                  </Text>
                  <Text style={{ fontSize: 13, color: '#9A8F82', textAlign: 'center', maxWidth: 260, lineHeight: 19 }}>
                    {paidFilter === 'all'
                      ? 'Paid promotions purchased by farmstand owners will appear here once RevenueCat is connected.'
                      : `No ${paidFilter} promotions found.`}
                  </Text>
                </View>
              </Animated.View>
            ) : (
              <>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#9A8F82', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
                  {filteredPaid.length} promotion{filteredPaid.length !== 1 ? 's' : ''}
                </Text>
                {filteredPaid.map((promo, index) => (
                  <PaidPromotionCard
                    key={promo.id}
                    promo={promo}
                    index={index}
                    onActions={handlePromotionActions}
                  />
                ))}
              </>
            )}
          </>
        )}

        {/* ── AUTO-FEATURED TAB ── */}
        {mainTab === 'auto' && (
          <>
            {/* Summary strip */}
            <Animated.View entering={FadeInDown.delay(80).springify()}>
              <View
                style={{
                  flexDirection: 'row', gap: 8,
                  backgroundColor: '#FFFFFF', borderRadius: 16,
                  padding: 14, marginBottom: 16,
                  borderWidth: 1, borderColor: '#F0EDE8',
                }}
              >
                {[
                  { label: 'Active',       count: autoSummary.activeCount,       color: '#166534', bg: '#DCFCE7' },
                  { label: 'Auto-Feat.',   count: autoSummary.autoFeaturedCount, color: '#6D28D9', bg: '#EDE9FE' },
                  { label: 'Scheduled',    count: autoSummary.scheduledCount,    color: '#92400E', bg: '#FEF3C7' },
                  { label: 'Expired',      count: autoSummary.expiredCount,      color: '#6B7280', bg: '#F3F4F6' },
                ].map((item) => (
                  <View key={item.label} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                    <View style={{ backgroundColor: item.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: item.color }}>{item.count}</Text>
                    </View>
                    <Text style={{ fontSize: 10, color: '#9A8F82', fontWeight: '500', textAlign: 'center' }}>{item.label}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>

            {/* Filter chips */}
            <Animated.View entering={FadeInDown.delay(120).springify()} style={{ marginBottom: 16 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                {renderAutoFilterChip('all',       'All',          0)}
                {renderAutoFilterChip('active',    'Active',       autoSummary.activeCount)}
                {renderAutoFilterChip('scheduled', 'Scheduled',    autoSummary.scheduledCount)}
                {renderAutoFilterChip('expired',   'Expired',      autoSummary.expiredCount)}
                {renderAutoFilterChip('auto',      'Auto-Featured',autoSummary.autoFeaturedCount)}
              </ScrollView>
            </Animated.View>

            {filteredAuto.length === 0 ? (
              <Animated.View entering={FadeInDown.delay(160).springify()}>
                <View style={{ alignItems: 'center', paddingVertical: 56, backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#F0EDE8' }}>
                  <Megaphone size={36} color="#C8B89A" />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#9A8F82', marginTop: 14, textAlign: 'center' }}>No farmstands found</Text>
                  <Text style={{ fontSize: 13, color: '#B0A898', marginTop: 4, textAlign: 'center' }}>
                    {autoFilterTab === 'all' ? 'Search for farmstands to promote' : 'No promotions in this category'}
                  </Text>
                </View>
              </Animated.View>
            ) : (
              <>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#9A8F82', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
                  {filteredAuto.length} farmstand{filteredAuto.length !== 1 ? 's' : ''}
                </Text>
                {filteredAuto.map((farmstand, index) => (
                  <AutoFarmstandCard
                    key={farmstand.id}
                    farmstand={farmstand}
                    index={index}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({ pathname: '/admin/promotion-edit', params: { id: farmstand.id } });
                    }}
                  />
                ))}
              </>
            )}

            {/* How it works */}
            <Animated.View entering={FadeInDown.delay(500).duration(400)}>
              <View
                style={{
                  marginTop: 24, padding: 16,
                  backgroundColor: '#F7F4EE', borderRadius: 18,
                  borderWidth: 1, borderColor: '#DED7CC',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View
                    style={{
                      width: 34, height: 34, borderRadius: 10,
                      backgroundColor: '#E6F0E9', alignItems: 'center', justifyContent: 'center', marginRight: 12,
                    }}
                  >
                    <Zap size={16} color="#2F5D50" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#1A1A1A', marginBottom: 5 }}>
                      How Auto-Featured Works
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6B6355', lineHeight: 18 }}>
                      Promoted farmstands appear in the top 10 of Explore categories and Map cards. Auto-Featured farmstands rise naturally based on clicks, saves, and messages. Up to 5 manual promos + 5 auto-featured fill the top 10.
                    </Text>
                  </View>
                </View>
              </View>
            </Animated.View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
