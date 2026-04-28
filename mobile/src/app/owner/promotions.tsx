import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Eye,
  MapPin,
  Star,
  Leaf,
  Info,
  Clock,
  Calendar,
  CheckCircle2,
  TrendingUp,
  Sprout,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

// ─────────────────────────────────────────────
// Promotion data structures (Phase 1)
// Designed to be attached to real products later.
// ─────────────────────────────────────────────

export type PromotionStatus = 'active' | 'scheduled' | 'expired';
export type PromotionType =
  | 'featured_explore_7'
  | 'featured_explore_30'
  | 'map_boost_7'
  | 'seasonal_spotlight';

export interface Promotion {
  id: string;
  type: PromotionType;
  farmstandId: string;
  ownerUserId: string;
  startDate: string | null;
  endDate: string | null;
  status: PromotionStatus;
  paymentProductId: string | null;
  purchaseId: string | null;
  impressions: number;
  clicks: number;
}

interface PromotionOption {
  type: PromotionType;
  name: string;
  description: string;
  bestFor: string;
  duration: string;
  // Phase 1 placeholder prices — swap paymentProductId for real RevenueCat product later
  price: number;
  priceLabel: string;
  icon: React.ReactNode;
  accentColor: string;
  bgColor: string;
  borderColor: string;
  // TODO: wire paymentProductId from RevenueCat one-time purchase products
  paymentProductId: string | null;
}

const PROMOTION_OPTIONS: PromotionOption[] = [
  {
    type: 'featured_explore_7',
    name: 'Featured in Explore',
    description: 'Appear higher in Explore so more nearby shoppers can discover your stand this week.',
    bestFor: 'Weekend traffic, big harvests, and new stands getting discovered',
    duration: '7 days',
    price: 3.99,
    priceLabel: '$3.99',
    icon: <TrendingUp size={22} color="#C8A46A" />,
    accentColor: '#C8A46A',
    bgColor: '#FAF8F3',
    borderColor: '#E6E1D9',
    paymentProductId: null, // TODO: attach RevenueCat product ID
  },
  {
    type: 'featured_explore_30',
    name: 'Featured in Explore',
    description: 'Stay more visible in Explore all month long so local shoppers see your stand more often.',
    bestFor: 'Busy harvest months, flower stands, and steady inventory',
    duration: '30 days',
    price: 5.99,
    priceLabel: '$5.99',
    icon: <Star size={22} color="#C8A46A" />,
    accentColor: '#C8A46A',
    bgColor: '#FAF8F3',
    borderColor: '#E6E1D9',
    paymentProductId: null, // TODO: attach RevenueCat product ID
  },
  {
    type: 'map_boost_7',
    name: 'Map Boost',
    description: 'Increase visibility on the map so nearby shoppers can spot your stand faster.',
    bestFor: 'Roadside stands, high-traffic weekends, and passing travelers',
    duration: '7 days',
    price: 2.99,
    priceLabel: '$2.99',
    icon: <MapPin size={22} color="#6C7A86" />,
    accentColor: '#6C7A86',
    bgColor: '#FAF8F3',
    borderColor: '#E6E1D9',
    paymentProductId: null, // TODO: attach RevenueCat product ID
  },
  {
    type: 'seasonal_spotlight',
    name: 'Seasonal Spotlight',
    description: 'Highlight your stand during peak seasonal shopping times when customers are actively looking.',
    bestFor: 'Pumpkins, berries, flowers, Christmas trees, and seasonal events',
    duration: '14 days',
    price: 4.99,
    priceLabel: '$4.99',
    icon: <Leaf size={22} color="#7C9A84" />,
    accentColor: '#7C9A84',
    bgColor: '#FAF8F3',
    borderColor: '#E6E1D9',
    paymentProductId: null, // TODO: attach RevenueCat product ID
  },
];

// ─────────────────────────────────────────────
// Placeholder active promotions for Phase 1
// TODO: replace with real data from backend
// ─────────────────────────────────────────────
const PLACEHOLDER_ACTIVE: Promotion[] = [];

function PromotionCard({
  option,
  farmstandId,
  index,
}: {
  option: PromotionOption;
  farmstandId: string;
  index: number;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePromoteNow = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // TODO: wire RevenueCat one-time purchase
    Alert.alert(
      'Promotions Coming Soon',
      'Paid promotion purchases will be available in an upcoming update. We\'ll notify you when they launch!',
      [{ text: 'OK', style: 'default' }]
    );
  };

  return (
    <Animated.View entering={FadeInDown.delay(index * 80).springify()} style={[animatedStyle, { marginBottom: 20 }]}>
      <Pressable
        onPress={handlePromoteNow}
        onPressIn={() => { scale.value = withSpring(0.972, { damping: 20, stiffness: 320 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 20, stiffness: 320 }); }}
        style={({ pressed }) => ({
          backgroundColor: '#FFFFFF',
          borderRadius: 20,
          borderWidth: 1,
          borderColor: pressed ? '#A8C4B0' : '#DDD8CF',
          paddingHorizontal: 20,
          paddingVertical: 20,
          shadowColor: '#2A2A2A',
          shadowOffset: { width: 0, height: pressed ? 1 : 3 },
          shadowOpacity: pressed ? 0.03 : 0.09,
          shadowRadius: pressed ? 2 : 8,
          elevation: pressed ? 1 : 3,
        })}
      >
        {/* Header row: icon + name/duration + price */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 }}>
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 13,
              backgroundColor: '#EDF3EE',
              borderWidth: 1,
              borderColor: '#D4E4D8',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 13,
            }}
          >
            {option.icon}
          </View>
          <View style={{ flex: 1, paddingTop: 2 }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '700',
                color: '#111111',
                marginBottom: 4,
                letterSpacing: -0.3,
              }}
            >
              {option.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Clock size={11} color="#A09880" />
              <Text
                style={{
                  fontSize: 12,
                  color: '#A09880',
                  marginLeft: 4,
                  fontWeight: '500',
                }}
              >
                {option.duration}
              </Text>
            </View>
          </View>
          {/* Price pill — preserved for RevenueCat wiring */}
          <View
            style={{
              backgroundColor: '#F4F9F6',
              borderRadius: 10,
              paddingHorizontal: 11,
              paddingVertical: 6,
              borderWidth: 1,
              borderColor: '#BEDAD0',
              alignSelf: 'flex-start',
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '700',
                color: '#2A5444',
                letterSpacing: -0.2,
              }}
            >
              {option.priceLabel}
            </Text>
          </View>
        </View>

        {/* Divider */}
        <View style={{ height: 1, backgroundColor: '#EDE8E0', marginBottom: 14 }} />

        {/* Description */}
        <Text
          style={{
            fontSize: 14,
            color: '#3D3830',
            lineHeight: 22,
            marginBottom: 14,
            fontWeight: '400',
          }}
        >
          {option.description}
        </Text>

        {/* Best for */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            backgroundColor: '#F2EEE7',
            borderRadius: 11,
            paddingHorizontal: 13,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: '#E2DDD4',
          }}
        >
          <Text style={{ fontSize: 12, color: '#6B5E50', fontWeight: '700', marginRight: 5 }}>
            Best for:
          </Text>
          <Text style={{ fontSize: 12, color: '#6B5E50', flex: 1, lineHeight: 19 }}>
            {option.bestFor}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function ActivePromotionRow({ promo }: { promo: Promotion }) {
  const optionMeta = PROMOTION_OPTIONS.find((o) => o.type === promo.type);
  const statusColor =
    promo.status === 'active'
      ? '#16a34a'
      : promo.status === 'scheduled'
      ? '#D97706'
      : '#9CA3AF';
  const statusLabel =
    promo.status === 'active'
      ? 'Active'
      : promo.status === 'scheduled'
      ? 'Scheduled'
      : 'Expired';

  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E8DDD4',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C1917' }}>
          {optionMeta?.name ?? promo.type}
        </Text>
        {promo.endDate && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            <Calendar size={12} color="#78716C" />
            <Text style={{ fontSize: 12, color: '#78716C', marginLeft: 4 }}>
              Ends {new Date(promo.endDate).toLocaleDateString()}
            </Text>
          </View>
        )}
      </View>
      <View
        style={{
          backgroundColor: statusColor + '20',
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: '600', color: statusColor }}>
          {statusLabel}
        </Text>
      </View>
    </View>
  );
}

export default function PromoteYourFarmstandScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { farmstandId } = useLocalSearchParams<{ farmstandId?: string }>();

  // Phase 1: no real promotions yet
  const activePromotions: Promotion[] = PLACEHOLDER_ACTIVE;
  const hasActive = activePromotions.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#FAF7F2' }}>
      {/* Header */}
      <View
        style={{
          backgroundColor: '#FFFFFF',
          paddingTop: insets.top + 4,
          paddingBottom: 14,
          paddingHorizontal: 20,
          borderBottomWidth: 1,
          borderBottomColor: '#F0EDE8',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.04,
          shadowRadius: 4,
          elevation: 2,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            hitSlop={8}
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: '#F5F5F4',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 12,
            }}
          >
            <ArrowLeft size={20} color="#1C1917" />
          </Pressable>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1C1917', flex: 1 }}>
            Grow Your Farmstand
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero intro card */}
        <Animated.View entering={FadeInDown.delay(0).springify()}>
          <LinearGradient
            colors={['#2D5A3D', '#3D7056']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 20,
              padding: 22,
              marginBottom: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View
                style={{
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  borderRadius: 10,
                  padding: 7,
                  marginRight: 10,
                }}
              >
                <Eye size={18} color="#FFFFFF" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.2 }}>
                Get More Eyes on Your Stand
              </Text>
            </View>
            <Text style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.88)', lineHeight: 21 }}>
              Farmstand offers optional visibility tools to help more local shoppers discover your stand. Use them when you have a big harvest or seasonal products.
            </Text>
          </LinearGradient>
        </Animated.View>

        {/* Section title */}
        <Animated.View entering={FadeInDown.delay(60).springify()}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Sprout size={13} color="#7C9A84" style={{ marginRight: 6 }} />
            <Text
              style={{
                fontSize: 12,
                fontWeight: '700',
                color: '#78716C',
                textTransform: 'uppercase',
                letterSpacing: 0.9,
              }}
            >
              Growth Tools
            </Text>
          </View>
        </Animated.View>

        {PROMOTION_OPTIONS.map((option, index) => (
          <PromotionCard
            key={option.type}
            option={option}
            farmstandId={farmstandId ?? ''}
            index={index}
          />
        ))}

        {/* Boost when it makes sense microcopy */}
        <Animated.View entering={FadeInDown.delay(380).springify()} style={{ marginBottom: 24, marginTop: 2 }}>
          <Text
            style={{
              fontSize: 12.5,
              color: '#A8A29E',
              textAlign: 'center',
              lineHeight: 18,
              paddingHorizontal: 8,
            }}
          >
            You can boost only when it makes sense for your stand.
          </Text>
        </Animated.View>

        {/* Active Promotions section */}
        <Animated.View entering={FadeInDown.delay(420).springify()} style={{ marginTop: 4 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: '#78716C',
              textTransform: 'uppercase',
              letterSpacing: 0.9,
              marginBottom: 14,
            }}
          >
            Active Promotions
          </Text>

          {hasActive ? (
            activePromotions.map((promo) => (
              <ActivePromotionRow key={promo.id} promo={promo} />
            ))
          ) : (
            <View
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 14,
                padding: 20,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: '#E8DDD4',
                borderStyle: 'dashed',
                marginBottom: 10,
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: '#F5F5F4',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 10,
                }}
              >
                <CheckCircle2 size={22} color="#A8A29E" />
              </View>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#78716C' }}>
                No active promotions yet
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: '#A8A29E',
                  textAlign: 'center',
                  marginTop: 4,
                  lineHeight: 18,
                }}
              >
                Your active, scheduled, and expired promotions will appear here.
              </Text>
            </View>
          )}
        </Animated.View>

        {/* How promotions work section */}
        <Animated.View entering={FadeInDown.delay(480).springify()} style={{ marginTop: 8 }}>
          <View
            style={{
              backgroundColor: '#F7F4EE',
              borderRadius: 18,
              padding: 20,
              borderWidth: 1,
              borderColor: '#DED7CC',
              marginBottom: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <View
                style={{
                  backgroundColor: '#E6F0E9',
                  borderRadius: 10,
                  padding: 7,
                  marginRight: 10,
                }}
              >
                <Info size={14} color="#2F5D50" />
              </View>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#1A1A1A', letterSpacing: -0.1 }}>
                How promotions work
              </Text>
            </View>

            {[
              'Promotions boost your farmstand into high-visibility spots in Explore and on the map.',
              'Promoted farmstands rotate through top positions throughout the day, so different shoppers may see different farmstands featured at different times.',
              'Promotions only compete with other promoted farmstands within the shopper\'s selected radius.',
              'Results can vary depending on how many farmstands are promoting in your area.',
            ].map((tip, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  marginBottom: i < 3 ? 13 : 0,
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 2.5,
                    backgroundColor: '#7C9A84',
                    marginTop: 8,
                    marginRight: 11,
                  }}
                />
                <Text
                  style={{
                    fontSize: 13.5,
                    color: '#4A4238',
                    lineHeight: 21,
                    flex: 1,
                  }}
                >
                  {tip}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}
