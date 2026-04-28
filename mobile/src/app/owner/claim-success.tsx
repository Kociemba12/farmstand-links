import React from 'react';
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
  CheckCircle,
  Camera,
  MessageCircle,
  Bell,
  ShoppingBag,
  LayoutDashboard,
  BarChart2,
  Sparkles,
  X,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { StyleSheet } from 'react-native';

// ─── Feature Row ─────────────────────────────────────────────────────────────

interface FeatureRowProps {
  icon: React.ReactNode;
  label: string;
  delay: number;
}

function FeatureRow({ icon, label, delay }: FeatureRowProps) {
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).springify().damping(18)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(45,90,61,0.08)',
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: 'rgba(45,90,61,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
        }}
      >
        {icon}
      </View>
      <Text style={{ fontSize: 14, color: '#1C1917', fontWeight: '500', flex: 1 }}>
        {label}
      </Text>
      <CheckCircle size={16} color="#2D5A3D" />
    </Animated.View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ClaimSuccessScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId?: string }>();

  const handleStartTrial = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (farmstandId) {
      router.replace(`/owner/premium-onboarding?farmstandId=${farmstandId}`);
    } else {
      router.replace('/owner/premium-onboarding');
    }
  };

  const handleLearnMore = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (farmstandId) {
      router.push(`/owner/free-vs-premium?farmstandId=${farmstandId}`);
    } else {
      router.push('/owner/free-vs-premium');
    }
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={{ flex: 1, backgroundColor: '#FAF7F2' }}
    >
      {/* Close Button */}
      <Pressable
        onPress={handleClose}
        style={styles.closeButtonHitArea}
      >
        <View style={styles.closeButtonCircle}>
          <X size={20} color="#1C1917" strokeWidth={2.5} />
        </View>
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        bounces={false}
      >
        {/* ── Hero celebration zone ── */}
        <Animated.View
          entering={FadeIn.duration(400)}
          style={{ alignItems: 'center', paddingTop: 48, paddingBottom: 32, paddingHorizontal: 24 }}
        >
          {/* Radial glow ring */}
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: 'rgba(45,90,61,0.08)',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 24,
            }}
          >
            <LinearGradient
              colors={['#2D5A3D', '#4A7C59']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: 88,
                height: 88,
                borderRadius: 44,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#2D5A3D',
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.4,
                shadowRadius: 16,
                elevation: 10,
              }}
            >
              <CheckCircle size={44} color="#FFFFFF" strokeWidth={2.5} />
            </LinearGradient>
          </View>

          {/* Title */}
          <Animated.Text
            entering={FadeInDown.delay(100).springify().damping(18)}
            style={{
              fontSize: 28,
              fontWeight: '800',
              color: '#1C1917',
              textAlign: 'center',
              letterSpacing: -0.5,
              marginBottom: 10,
            }}
          >
            Your Farmstand is Claimed!
          </Animated.Text>

          {/* Subtitle */}
          <Animated.Text
            entering={FadeInDown.delay(160).springify().damping(18)}
            style={{
              fontSize: 15,
              color: '#57534E',
              textAlign: 'center',
              lineHeight: 22,
              paddingHorizontal: 8,
              marginBottom: 20,
            }}
          >
            Start your{' '}
            <Text style={{ color: '#2D5A3D', fontWeight: '700' }}>3-month free trial</Text>
            {' '}to unlock all premium features. $4.99/month after — cancel anytime.
          </Animated.Text>

          {/* Free trial badge */}
          <Animated.View
            entering={FadeInDown.delay(220).springify().damping(18)}
          >
            <LinearGradient
              colors={['#2D5A3D', '#3D7A52']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 100,
                gap: 6,
              }}
            >
              <Sparkles size={14} color="#FFD700" />
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>
                3-Month Free Trial Available
              </Text>
            </LinearGradient>
          </Animated.View>
        </Animated.View>

        {/* ── Features card ── */}
        <Animated.View
          entering={FadeInDown.delay(280).springify().damping(18)}
          style={{ marginHorizontal: 20 }}
        >
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 20,
              padding: 20,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.07,
              shadowRadius: 12,
              elevation: 4,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '700',
                color: '#2D5A3D',
                textTransform: 'uppercase',
                letterSpacing: 0.8,
                marginBottom: 4,
              }}
            >
              What's unlocked with Premium:
            </Text>

            <FeatureRow
              icon={<Camera size={18} color="#2D5A3D" />}
              label="Up to 20 Photos + 1 Video"
              delay={320}
            />
            <FeatureRow
              icon={<MessageCircle size={18} color="#2D5A3D" />}
              label="Customer messaging"
              delay={360}
            />
            <FeatureRow
              icon={<Bell size={18} color="#2D5A3D" />}
              label="Push notifications"
              delay={400}
            />
            <FeatureRow
              icon={<ShoppingBag size={18} color="#2D5A3D" />}
              label="Product cards"
              delay={440}
            />
            <FeatureRow
              icon={<LayoutDashboard size={18} color="#2D5A3D" />}
              label="Farmstand manager"
              delay={480}
            />
            <FeatureRow
              icon={<BarChart2 size={18} color="#2D5A3D" />}
              label="Analytics & insights"
              delay={520}
            />
          </View>
        </Animated.View>

        {/* ── CTA buttons ── */}
        <Animated.View
          entering={FadeInDown.delay(560).springify().damping(18)}
          style={{ marginHorizontal: 20, marginTop: 24, gap: 12 }}
        >
          {/* Primary CTA */}
          <Pressable
            onPress={handleStartTrial}
            style={({ pressed }) => ({
              backgroundColor: '#2D5A3D',
              height: 56,
              borderRadius: 28,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.88 : 1,
              shadowColor: '#2D5A3D',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.35,
              shadowRadius: 10,
              elevation: 6,
            })}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', textAlign: 'center', letterSpacing: 0.2 }}>
              Start 3-Month Free Trial
            </Text>
          </Pressable>

          {/* Secondary CTA */}
          <Pressable
            onPress={handleLearnMore}
            style={({ pressed }) => ({
              height: 50,
              borderRadius: 16,
              backgroundColor: '#FFFFFF',
              borderWidth: 1.5,
              borderColor: 'rgba(45,90,61,0.25)',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: '#2D5A3D', fontSize: 15, fontWeight: '600' }}>
              Compare Free vs Premium
            </Text>
          </Pressable>
        </Animated.View>

        {/* Pricing note */}
        <Animated.View
          entering={FadeInDown.delay(600).springify().damping(18)}
          style={{
            marginHorizontal: 20,
            marginTop: 14,
            padding: 14,
            backgroundColor: '#F5F5F4',
            borderRadius: 12,
          }}
        >
          <Text style={{ fontSize: 12, color: '#78716C', textAlign: 'center', lineHeight: 18 }}>
            After 3 months, $4.99/month — renews automatically unless canceled. Manage in Apple account settings.
          </Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  closeButtonHitArea: {
    position: 'absolute',
    top: 28,
    left: 20,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  closeButtonCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E9E9EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
});
