import React, { useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Image as ImageIcon,
  MessageCircle,
  Bell,
  ShoppingBag,
  Settings,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Zap,
  Star,
  Clock,
  MessageSquare,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useBootstrapStore, selectUserFarmstands } from '@/lib/bootstrap-store';
import { trackEvent } from '@/lib/track';

type PremiumStatus = 'free' | 'trial' | 'active' | 'expired';

const FEATURES = [
  {
    icon: ImageIcon,
    label: 'Up to 20 Photos + 1 Video',
    description: 'Showcase your farmstand with up to 20 photos and 1 video',
  },
  {
    icon: MessageCircle,
    label: 'Customer Messaging',
    description: 'Respond to customer inquiries directly in the app',
  },
  {
    icon: Bell,
    label: 'Push Notifications',
    description: 'Get alerts out when products are in stock or out of stock',
  },
  {
    icon: ShoppingBag,
    label: 'Product Cards',
    description: 'Rich listings with photos, prices, and descriptions',
  },
  {
    icon: Settings,
    label: 'Farmstand Manager',
    description: 'Track sales, expenses, and inventory in one place',
  },
  {
    icon: BarChart3,
    label: 'Analytics & Insights',
    description: 'Track views, saves, clicks, and customer activity',
  },
  {
    icon: MessageSquare,
    label: 'Manage Reviews',
    description: 'Reply to customer feedback',
  },
];

/**
 * Parse a date string and return null if it is invalid, empty, or NaN.
 */
function parseValidDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || dateStr.trim() === '') return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    console.warn('[Premium] parseValidDate: invalid date string:', JSON.stringify(dateStr));
    return null;
  }
  return d;
}

function formatDate(dateStr: string | null | undefined): string | null {
  const d = parseValidDate(dateStr);
  if (!d) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function getDaysRemaining(dateStr: string | null | undefined): number | null {
  const d = parseValidDate(dateStr);
  if (!d) return null;
  const diff = d.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export default function PremiumScreen() {
  const router = useRouter();
  const { farmstandId, premiumStatus: urlPremiumStatus, trialExpiresAt: urlTrialExpiresAt } = useLocalSearchParams<{
    farmstandId?: string;
    premiumStatus?: string;
    trialExpiresAt?: string;
  }>();

  // Pull the live farmstand from the bootstrap store so we always show fresh data
  // even if the URL params were built from stale/null values.
  const userFarmstands = useBootstrapStore(selectUserFarmstands);
  const refreshUserFarmstands = useBootstrapStore((s) => s.refreshUserFarmstands);

  const liveFarmstand = useMemo(() => {
    if (!farmstandId) return null;
    return userFarmstands.find((f) => f.id === farmstandId) ?? null;
  }, [userFarmstands, farmstandId]);

  // Prefer live store data; fall back to URL params for status/date.
  // This ensures we always show the latest premium fields even if the screen
  // was opened from a cached my-farmstand navigation.
  // Default to 'free' — never assume premium if data is missing.
  const resolvedStatus = (
    liveFarmstand?.premiumStatus ?? urlPremiumStatus ?? 'free'
  ) as PremiumStatus;

  const resolvedExpiresAt =
    liveFarmstand?.premiumTrialExpiresAt ??
    (urlTrialExpiresAt && urlTrialExpiresAt.trim() !== '' ? urlTrialExpiresAt : null);

  // Debug logs — helps trace "Invalid Date" bugs
  useEffect(() => {
    console.log('[Premium] farmstandId:', farmstandId);
    console.log('[Premium] URL params — premiumStatus:', urlPremiumStatus, '| trialExpiresAt:', urlTrialExpiresAt);
    console.log('[Premium] Live store — premiumStatus:', liveFarmstand?.premiumStatus, '| premiumTrialExpiresAt:', liveFarmstand?.premiumTrialExpiresAt);
    console.log('[Premium] Resolved — status:', resolvedStatus, '| expiresAt:', resolvedExpiresAt);
    if (resolvedExpiresAt) {
      const parsed = new Date(resolvedExpiresAt);
      console.log('[Premium] Parsed date:', parsed.toString(), '| isValid:', !isNaN(parsed.getTime()));
    }
  }, [farmstandId, urlPremiumStatus, urlTrialExpiresAt, liveFarmstand, resolvedStatus, resolvedExpiresAt]);

  const hasLoaded = useRef(false);

  // Trigger a fresh fetch on mount so we get the latest premium fields from Supabase.
  // This fixes the case where the user was navigated here before the bootstrap store refreshed.
  // hasLoaded guard prevents duplicate calls from React strict mode or state hydration.
  useEffect(() => {
    if (hasLoaded.current) return;
    hasLoaded.current = true;
    console.log('[Premium] Triggering refreshUserFarmstands on mount');
    refreshUserFarmstands();
    trackEvent('premium_membership_status_viewed', {
      farmstand_id: farmstandId ?? null,
      farmstand_name: liveFarmstand?.name ?? null,
      status: resolvedStatus,
    });
  }, []);

  const daysRemaining = useMemo(() => getDaysRemaining(resolvedExpiresAt), [resolvedExpiresAt]);
  const formattedExpiry = useMemo(() => formatDate(resolvedExpiresAt), [resolvedExpiresAt]);

  const isTrialOrDefault = resolvedStatus === 'trial' || resolvedStatus === 'active';
  const isFree = resolvedStatus === 'free';
  const isExpired = resolvedStatus === 'expired';

  // Build the trial status line — only show if we have valid date info
  const hasValidExpiry = daysRemaining !== null && formattedExpiry !== null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F2' }} edges={['top']}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          hitSlop={8}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#FFFFFF',
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }}
        >
          <ArrowLeft size={20} color="#1C1917" />
        </Pressable>
        <Text
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 18,
            fontWeight: '700',
            color: '#1C1917',
            marginRight: 40,
          }}
        >
          Your Premium Plan
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 2 }}
      >
        {/* ── A. Status Card ── */}
        <Animated.View entering={FadeInDown.delay(0).springify()}>
          {isTrialOrDefault && (
            <LinearGradient
              colors={['#2D5A3D', '#3D7A53', '#4A9463']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 24,
                padding: 18,
                marginBottom: 16,
                overflow: 'hidden',
              }}
            >
              {/* Decorative circles */}
              <View
                style={{
                  position: 'absolute',
                  top: -30,
                  right: -30,
                  width: 120,
                  height: 120,
                  borderRadius: 60,
                  backgroundColor: 'rgba(255,255,255,0.07)',
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  bottom: -20,
                  left: -20,
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  backgroundColor: 'rgba(255,255,255,0.05)',
                }}
              />

              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <View
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    borderRadius: 10,
                    padding: 6,
                    marginRight: 10,
                  }}
                >
                  <Star size={18} color="#FFFFFF" />
                </View>
                <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>
                  Premium Trial Active
                </Text>
              </View>

              {/* Expiry line — only shown when we have a valid parsed date */}
              {hasValidExpiry ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Clock size={14} color="rgba(255,255,255,0.75)" />
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, marginLeft: 6 }}>
                      Expires {formattedExpiry}
                    </Text>
                  </View>

                  {/* Days remaining pill */}
                  <View
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.18)',
                      borderRadius: 50,
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      alignSelf: 'flex-start',
                      marginBottom: 10,
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>
                      {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
                    </Text>
                  </View>
                </>
              ) : (
                /* Safe fallback when date is not yet available */
                <View
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.18)',
                    borderRadius: 50,
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    alignSelf: 'flex-start',
                    marginBottom: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Clock size={12} color="rgba(255,255,255,0.9)" />
                  <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>
                    Trial active
                  </Text>
                </View>
              )}

              <View
                style={{
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  borderRadius: 12,
                  padding: 10,
                }}
              >
                <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 18 }}>
                  After your 3-month trial, continue for{' '}
                  <Text style={{ fontWeight: '700', color: '#FFFFFF' }}>$4.99/month</Text>.
                  Renews automatically — cancel anytime.
                </Text>
              </View>
            </LinearGradient>
          )}

          {isFree && (
            <View
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 24,
                padding: 24,
                marginBottom: 24,
                borderWidth: 1.5,
                borderColor: '#E8DDD4',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.05,
                shadowRadius: 8,
                elevation: 3,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <View
                  style={{
                    backgroundColor: '#F5F5F4',
                    borderRadius: 10,
                    padding: 6,
                    marginRight: 10,
                  }}
                >
                  <Zap size={18} color="#78716C" />
                </View>
                <Text style={{ color: '#1C1917', fontSize: 20, fontWeight: '800' }}>Free Plan</Text>
              </View>
              <Text style={{ color: '#78716C', fontSize: 14, lineHeight: 20, marginBottom: 16 }}>
                You're on the free plan. Start your 3-month free premium membership to unlock all premium features.
              </Text>
              <Pressable
                onPress={() => {
                  trackEvent('upgrade_to_premium_tapped', { source: 'premium_status_free', farmstand_id: farmstandId ?? null, farmstand_name: liveFarmstand?.name ?? null });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push(`/owner/premium-onboarding${farmstandId ? `?farmstandId=${farmstandId}` : ''}`);
                }}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? '#254d34' : '#2D5A3D',
                  borderRadius: 14,
                  paddingVertical: 16,
                  paddingHorizontal: 20,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                  shadowColor: '#2D5A3D',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.25,
                  shadowRadius: 8,
                  elevation: 4,
                })}
              >
                <Zap size={16} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>
                  Start 3-Month Free Premium Membership
                </Text>
              </Pressable>
            </View>
          )}

          {isExpired && (
            <LinearGradient
              colors={['#D97706', '#F59E0B', '#FCD34D']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 24,
                padding: 24,
                marginBottom: 24,
                overflow: 'hidden',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <View
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.25)',
                    borderRadius: 10,
                    padding: 6,
                    marginRight: 10,
                  }}
                >
                  <Clock size={18} color="#FFFFFF" />
                </View>
                <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>Trial Ended</Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, lineHeight: 20, marginBottom: 16 }}>
                Your trial has ended. Start a new premium membership to unlock all features again.
              </Text>
              <Pressable
                onPress={() => {
                  trackEvent('upgrade_to_premium_tapped', { source: 'premium_status_expired', farmstand_id: farmstandId ?? null, farmstand_name: liveFarmstand?.name ?? null });
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push(`/owner/premium-onboarding${farmstandId ? `?farmstandId=${farmstandId}` : ''}`);
                }}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,1)',
                  borderRadius: 14,
                  paddingVertical: 16,
                  paddingHorizontal: 20,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.15,
                  shadowRadius: 8,
                  elevation: 4,
                })}
              >
                <Zap size={16} color="#D97706" />
                <Text style={{ color: '#92400E', fontSize: 15, fontWeight: '700' }}>
                  Start 3-Month Free Premium Membership
                </Text>
              </Pressable>
            </LinearGradient>
          )}
        </Animated.View>

        {/* ── B. What's Included ── */}
        <Animated.View entering={FadeInDown.delay(80).springify()}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: '700',
              color: '#1C1917',
              marginBottom: 8,
              letterSpacing: -0.2,
            }}
          >
            What's Included
          </Text>

          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 20,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: '#F0EBE4',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.04,
              shadowRadius: 8,
              elevation: 2,
              marginBottom: 16,
            }}
          >
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              const isLast = index === FEATURES.length - 1;
              return (
                <Animated.View
                  key={feature.label}
                  entering={FadeInDown.delay(100 + index * 50).springify()}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: '#F5F0EB',
                  }}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: '#EAF2EC',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Icon size={16} color="#2D5A3D" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#1C1917', fontWeight: '600', fontSize: 14 }}>
                      {feature.label}
                    </Text>
                    <Text style={{ color: '#9CA3AF', fontSize: 12 }}>
                      {feature.description}
                    </Text>
                  </View>
                  <CheckCircle2 size={18} color="#2D5A3D" />
                </Animated.View>
              );
            })}
          </View>
        </Animated.View>

        {/* ── C. About Promotions — hidden, kept for future use ── */}
        {false && <Animated.View entering={FadeInDown.delay(200).springify()}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(`/owner/promotions${farmstandId ? `?farmstandId=${farmstandId}` : ''}`);
            }}
            style={{
              backgroundColor: '#FEF9EC',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: '#FDE68A',
              marginBottom: 24,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View
                style={{
                  backgroundColor: '#FDE68A',
                  borderRadius: 8,
                  padding: 5,
                  marginRight: 10,
                  marginTop: 1,
                }}
              >
                <Zap size={14} color="#92400E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#92400E', fontWeight: '700', fontSize: 14, marginBottom: 4 }}>
                  About Promotions
                </Text>
                <Text style={{ color: '#78350F', fontSize: 13, lineHeight: 19 }}>
                  Promotions are separate paid boosts that increase your farmstand's visibility in Explore and the map. They are not part of your Premium plan.
                </Text>
              </View>
              <ChevronRight size={16} color="#92400E" style={{ marginTop: 2 }} />
            </View>
          </Pressable>
        </Animated.View>}

        {/* ── D. Compare Plans Footer ── */}
        <Animated.View entering={FadeInDown.delay(260).springify()}>
          {/* Compare Free vs Premium — text link */}
          <Pressable
            onPress={() => {
              trackEvent('premium_comparison_opened', { source: 'premium_status', farmstand_id: farmstandId ?? null });
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              const params = new URLSearchParams();
              if (farmstandId) params.set('farmstandId', farmstandId);
              // Pass the resolved live expires-at (not the potentially-stale URL param)
              if (resolvedExpiresAt) params.set('trialExpiresAt', resolvedExpiresAt);
              const query = params.toString();
              router.push((`/owner/free-vs-premium${query ? `?${query}` : ''}`) as any);
            }}
            style={{ paddingVertical: 10, alignItems: 'center' }}
          >
            <Text style={{ color: '#2D5A3D', fontWeight: '600', fontSize: 14, textAlign: 'center' }}>
              Compare Free vs Premium
            </Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
