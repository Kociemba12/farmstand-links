import React, { useMemo, useState, useRef } from 'react';
import { trackEvent } from '@/lib/track';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  PanResponder,
  Animated as RNAnimated,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Check,
  Lock,
  Camera,
  MessageCircle,
  Bell,
  ShoppingBag,
  LayoutDashboard,
  BarChart2,
  MapPin,
  Star,
  FileText,
  Image as ImageIcon,
  Tag,
  Video,
  Sparkles,
  Info,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

// ─── Feature definition ──────────────────────────────────────────────────────

interface Feature {
  id: string;
  label: string;
  icon: React.ReactNode;
  inFree: boolean;
  inPremium: boolean;
  description: string;
}

const FREE_ICON_COLOR = '#6B7280';
const PREMIUM_ICON_COLOR = '#2D5A3D';

function buildFeatures(): Feature[] {
  return [
    {
      id: 'basic-listing',
      label: 'Basic listing',
      icon: <FileText size={16} color={FREE_ICON_COLOR} />,
      inFree: true,
      inPremium: true,
      description:
        "Your farmstand gets a public listing on the map so customers can discover you. Includes your stand name, location, and basic info to help people find you.",
    },
    {
      id: 'address',
      label: 'Address & directions',
      icon: <MapPin size={16} color={FREE_ICON_COLOR} />,
      inFree: true,
      inPremium: true,
      description:
        "Display your full address and give customers a one-tap way to get directions. Reduces friction and helps first-time visitors find you without confusion.",
    },
    {
      id: 'product-chips',
      label: 'Product chips (category tags)',
      icon: <Tag size={16} color={FREE_ICON_COLOR} />,
      inFree: true,
      inPremium: true,
      description:
        "Highlight what you sell at a glance. Product chips help customers quickly find your stand when searching for items like eggs, produce, or baked goods.",
    },
    {
      id: 'one-photo',
      label: 'One photo',
      icon: <ImageIcon size={16} color={FREE_ICON_COLOR} />,
      inFree: true,
      inPremium: true,
      description:
        "Show a quick preview of your stand so customers know what to expect before visiting. A single compelling photo goes a long way toward building trust.",
    },
    {
      id: 'about',
      label: 'Short about section',
      icon: <FileText size={16} color={FREE_ICON_COLOR} />,
      inFree: true,
      inPremium: true,
      description:
        "Add a brief description to tell your story, build trust, and share what makes your stand unique. Customers love knowing the person behind the produce.",
    },
    {
      id: 'reviews',
      label: 'Customer reviews',
      icon: <Star size={16} color={FREE_ICON_COLOR} />,
      inFree: true,
      inPremium: true,
      description:
        "Let customers leave feedback and build credibility so new visitors feel confident stopping by. Positive reviews are one of the strongest signals of a quality stand.",
    },
    {
      id: 'photos',
      label: 'Up to 20 photos',
      icon: <Camera size={16} color={PREMIUM_ICON_COLOR} />,
      inFree: false,
      inPremium: true,
      description:
        "Showcase your full setup, products, and seasonal updates with a rich photo gallery. More photos attract more customers and give a fuller sense of what you offer.",
    },
    {
      id: 'video',
      label: '1 video up to 30 seconds',
      icon: <Video size={16} color={PREMIUM_ICON_COLOR} />,
      inFree: false,
      inPremium: true,
      description:
        "Bring your stand to life with a short video—great for showing freshness, your setup, and your personality. Video creates an instant connection that photos alone can't match.",
    },
    {
      id: 'messaging',
      label: 'Customer messaging',
      icon: <MessageCircle size={16} color={PREMIUM_ICON_COLOR} />,
      inFree: false,
      inPremium: true,
      description:
        "Allow customers to message you directly with questions, availability, or special requests. Great for building regulars and handling pre-orders without leaving the app.",
    },
    {
      id: 'push',
      label: 'Push notifications',
      icon: <Bell size={16} color={PREMIUM_ICON_COLOR} />,
      inFree: false,
      inPremium: true,
      description:
        "Send instant updates to your followers when items are restocked or available. Perfect for high-demand items like fresh eggs or seasonal produce that sells out fast.",
    },
    {
      id: 'product-cards',
      label: 'Product cards',
      icon: <ShoppingBag size={16} color={PREMIUM_ICON_COLOR} />,
      inFree: false,
      inPremium: true,
      description:
        "Display detailed product listings with photos and descriptions to increase interest and clarity. Customers can see exactly what's available before making the trip.",
    },
    {
      id: 'manager',
      label: 'Farmstand manager',
      icon: <LayoutDashboard size={16} color={PREMIUM_ICON_COLOR} />,
      inFree: false,
      inPremium: true,
      description:
        "Access advanced tools to manage your listing, updates, and customer engagement all in one place. Keep your stand info fresh and stay on top of what's working.",
    },
    {
      id: 'analytics',
      label: 'Analytics & insights',
      icon: <BarChart2 size={16} color={PREMIUM_ICON_COLOR} />,
      inFree: false,
      inPremium: true,
      description:
        "Track views, engagement, and customer interest so you can grow your stand more effectively. See which products get the most attention and when traffic peaks.",
    },
  ];
}

// ─── Feature Detail Modal ─────────────────────────────────────────────────────

interface FeatureDetailModalProps {
  feature: Feature | null;
  onClose: () => void;
}

function FeatureDetailModal({ feature, onClose }: FeatureDetailModalProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new RNAnimated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 90 || gs.vy > 0.6) {
          onClose();
        } else {
          RNAnimated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 14,
          }).start();
        }
      },
    })
  ).current;

  const isPremiumOnly = feature ? !feature.inFree && feature.inPremium : false;

  return (
    <Modal
      visible={!!feature}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalOuter}>
        {/* Tap-to-dismiss backdrop */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose}>
          <View style={styles.backdrop} />
        </Pressable>

        {/* Sheet */}
        <RNAnimated.View
          {...panResponder.panHandlers}
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          {/* Drag handle */}
          <View style={styles.dragHandle} />

          {/* Scrollable content so long descriptions are never clipped */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: insets.bottom + 56 },
            ]}
          >
            {/* Icon */}
            <View
              style={[
                styles.modalIconBg,
                { backgroundColor: isPremiumOnly ? 'rgba(45,90,61,0.1)' : '#F5F5F4' },
              ]}
            >
              {feature?.icon}
            </View>

            {/* Title */}
            <Text style={styles.modalTitle}>{feature?.label}</Text>

            {/* Badge */}
            {isPremiumOnly && (
              <View style={styles.premiumBadge}>
                <Sparkles size={11} color="#2D5A3D" />
                <Text style={styles.premiumBadgeText}>Premium feature</Text>
              </View>
            )}

            {/* Description */}
            <Text style={styles.modalDescription}>{feature?.description}</Text>
          </ScrollView>
        </RNAnimated.View>
      </View>
    </Modal>
  );
}

// ─── Feature Row ──────────────────────────────────────────────────────────────

interface FeatureRowProps {
  feature: Feature;
  delay: number;
  isLast: boolean;
  onPress: (feature: Feature) => void;
}

function FeatureRow({ feature, delay, isLast, onPress }: FeatureRowProps) {
  const isPremiumOnly = !feature.inFree && feature.inPremium;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress(feature);
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
    >
      <Animated.View
        entering={FadeInDown.delay(delay).springify().damping(20)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          borderBottomWidth: isLast ? 0 : 1,
          borderBottomColor: '#F0EBE4',
        }}
      >
        {/* Feature icon + label */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              backgroundColor: isPremiumOnly ? 'rgba(45,90,61,0.08)' : '#F5F5F4',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {feature.icon}
          </View>
          <Text
            style={{
              fontSize: 14,
              color: '#1C1917',
              fontWeight: isPremiumOnly ? '600' : '400',
              flex: 1,
            }}
          >
            {feature.label}
          </Text>
        </View>

        {/* Free column */}
        <View style={{ width: 52, alignItems: 'center' }}>
          {feature.inFree ? (
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#F0FDF4',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Check size={13} color="#16A34A" strokeWidth={2.5} />
            </View>
          ) : (
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#F3F4F6',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Lock size={11} color="#9CA3AF" />
            </View>
          )}
        </View>

        {/* Premium column */}
        <View style={{ width: 68, alignItems: 'center' }}>
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: '#F0F9F3',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check size={13} color="#2D5A3D" strokeWidth={2.5} />
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function FreeVsPremiumScreen() {
  const router = useRouter();
  const { farmstandId, trialExpiresAt } = useLocalSearchParams<{
    farmstandId?: string;
    trialExpiresAt?: string;
  }>();

  const features = useMemo(() => buildFeatures(), []);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);

  const hasTrial = !!trialExpiresAt;
  const expiryLabel = hasTrial ? formatDate(trialExpiresAt!) : '';

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: '#FAF7F2' }}
    >
      {/* ── Header ── */}
      <Animated.View
        entering={FadeIn.duration(250)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 16,
        }}
      >
        <Pressable
          onPress={handleBack}
          hitSlop={10}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.08,
            shadowRadius: 6,
            elevation: 3,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <ArrowLeft size={20} color="#1C1917" />
        </Pressable>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text
            style={{
              fontSize: 20,
              fontWeight: '800',
              color: '#1C1917',
              letterSpacing: -0.3,
            }}
          >
            Free vs Premium
          </Text>
          <Text style={{ fontSize: 13, color: '#78716C', marginTop: 1 }}>
            Tap any feature to learn more
          </Text>
        </View>
      </Animated.View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* ── Plan header cards ── */}
        <Animated.View
          entering={FadeInDown.delay(80).springify().damping(20)}
          style={{
            flexDirection: 'row',
            marginHorizontal: 16,
            gap: 10,
            marginBottom: 20,
          }}
        >
          {/* Free card */}
          <View
            style={{
              flex: 1,
              backgroundColor: '#FFFFFF',
              borderRadius: 16,
              padding: 16,
              borderWidth: 1.5,
              borderColor: '#E8E3DC',
              alignItems: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.05,
              shadowRadius: 8,
              elevation: 2,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: '#F5F5F4',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 8,
              }}
            >
              <MapPin size={20} color="#6B7280" />
            </View>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '700',
                color: '#374151',
                textAlign: 'center',
              }}
            >
              Free Listing
            </Text>
            <Text
              style={{
                fontSize: 18,
                fontWeight: '800',
                color: '#374151',
                marginTop: 6,
              }}
            >
              $0
            </Text>
            <Text style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
              forever
            </Text>
          </View>

          {/* Premium card */}
          <View style={{ flex: 1 }}>
            <LinearGradient
              colors={['#2D5A3D', '#3D7A52']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 16,
                padding: 16,
                alignItems: 'center',
                shadowColor: '#2D5A3D',
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.35,
                shadowRadius: 14,
                elevation: 8,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                }}
              >
                <Sparkles size={20} color="#FFD700" />
              </View>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '700',
                  color: '#FFFFFF',
                  textAlign: 'center',
                }}
              >
                Premium
              </Text>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: '800',
                  color: '#FFFFFF',
                  marginTop: 6,
                }}
              >
                $4.99
              </Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                per month
              </Text>
            </LinearGradient>
          </View>
        </Animated.View>

        {/* ── Column headers ── */}
        <Animated.View
          entering={FadeInDown.delay(140).springify().damping(20)}
          style={{
            flexDirection: 'row',
            marginHorizontal: 16,
            marginBottom: 4,
            paddingRight: 2,
          }}
        >
          <View style={{ flex: 1 }} />
          <View style={{ width: 52, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Free
            </Text>
          </View>
          <View style={{ width: 68, alignItems: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#2D5A3D', textTransform: 'uppercase', letterSpacing: 0.3 }}>
              Premium
            </Text>
          </View>
        </Animated.View>

        {/* ── Feature comparison list ── */}
        <Animated.View
          entering={FadeInDown.delay(180).springify().damping(20)}
          style={{
            marginHorizontal: 16,
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            paddingHorizontal: 16,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.06,
            shadowRadius: 12,
            elevation: 4,
          }}
        >
          {features.map((feature, index) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              delay={200 + index * 30}
              isLast={index === features.length - 1}
              onPress={(f) => {
                trackEvent('premium_feature_explained', { feature: f.id, farmstand_id: farmstandId ?? null });
                setSelectedFeature(f);
              }}
            />
          ))}
        </Animated.View>

        {/* ── Premium feature note ── */}
        <Animated.View
          entering={FadeInDown.delay(660).springify().damping(20)}
          style={{ marginHorizontal: 16, marginTop: 12 }}
        >
          <View
            style={{
              backgroundColor: '#F8FBF9',
              borderRadius: 14,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              borderWidth: 1,
              borderColor: 'rgba(45,90,61,0.1)',
            }}
          >
            <Info size={16} color="#2D5A3D" style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 13, color: '#57534E', lineHeight: 19 }}>
              After your 3-month trial ends, your subscription continues at $4.99/month and renews automatically unless canceled.
            </Text>
          </View>
        </Animated.View>

        {/* ── Trial active banner (only shown when trial param is present) ── */}
        {hasTrial && (
          <Animated.View
            entering={FadeInDown.delay(700).springify().damping(20)}
            style={{ marginHorizontal: 16, marginTop: 16 }}
          >
            <LinearGradient
              colors={['#2D5A3D', '#3D7A52']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 16,
                padding: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles size={18} color="#FFD700" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF', marginBottom: 3 }}>
                  Your trial includes all Premium features
                </Text>
                {expiryLabel ? (
                  <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
                    Trial expires {expiryLabel}
                  </Text>
                ) : null}
              </View>
            </LinearGradient>
          </Animated.View>
        )}
      </ScrollView>

      {/* ── Feature detail bottom sheet ── */}
      <FeatureDetailModal
        feature={selectedFeature}
        onClose={() => setSelectedFeature(null)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modalOuter: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 20,
  },
  sheetContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 0,
  },
  modalIconBg: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1C1917',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(45,90,61,0.08)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  premiumBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2D5A3D',
  },
  modalDescription: {
    fontSize: 15,
    color: '#57534E',
    lineHeight: 23,
    marginTop: 4,
  },
});
