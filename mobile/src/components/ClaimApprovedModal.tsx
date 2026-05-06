/**
 * ClaimApprovedModal
 *
 * Full-screen celebration modal shown on the Explore screen the first time
 * the user opens the app after their farmstand claim is approved.
 *
 * Shows once per user (persisted via AsyncStorage key "claimApprovedSeen:{userId}").
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import Purchases from 'react-native-purchases';
import { prepareForPurchase } from '@/lib/revenuecat';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Camera,
  MessageCircle,
  Bell,
  ShoppingBag,
  LayoutDashboard,
  BarChart2,
  ChevronRight,
  Sparkles,
  Star,
  AlertCircle,
  X,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn, ZoomIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

// ─── Feature Row ─────────────────────────────────────────────────────────────

interface FeatureRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  delay: number;
}

function FeatureRow({ icon, label, description, delay }: FeatureRowProps) {
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).springify().damping(18)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 13,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(45,90,61,0.07)',
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: 'rgba(45,90,61,0.09)',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 14,
          flexShrink: 0,
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, color: '#1C1917', fontWeight: '600', marginBottom: 1 }}>
          {label}
        </Text>
        <Text style={{ fontSize: 12, color: '#78716C', lineHeight: 17 }}>
          {description}
        </Text>
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: '#2D5A3D',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 10,
          flexShrink: 0,
        }}
      >
        <Star size={11} color="#FFD700" fill="#FFD700" />
      </View>
    </Animated.View>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ClaimApprovedModalProps {
  visible: boolean;
  farmstandId: string | null;
  onDismiss: () => void;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

const ENTITLEMENT_ID = 'Farmstand Premium';

export function ClaimApprovedModal({ visible, farmstandId, onDismiss }: ClaimApprovedModalProps) {
  const router = useRouter();
  const navigatedRef = useRef(false);
  const [legalModal, setLegalModal] = useState<{ title: string; url: string } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleRestore = async () => {
    const { ok, reason } = prepareForPurchase();
    if (!ok) {
      if (reason === 'non-native') {
        Alert.alert('Available in the iOS App', 'Restoring purchases is available in the iOS app build.', [{ text: 'OK' }]);
      } else {
        Alert.alert('Setup Error', 'Unable to initialize the purchase system. Please restart the app and try again.', [{ text: 'OK' }]);
      }
      return;
    }
    setIsRestoring(true);
    try {
      const freshInfoBefore = await Purchases.getCustomerInfo();
      const wasPremiumBefore = !!freshInfoBefore.entitlements.active[ENTITLEMENT_ID];
      const infoAfter = await Purchases.restorePurchases();
      const isPremiumAfter = !!infoAfter.entitlements.active[ENTITLEMENT_ID];
      if (isPremiumAfter) {
        Alert.alert('Purchases Restored', 'Your Premium access has been restored!', [{ text: 'OK', onPress: onDismiss }]);
      } else if (wasPremiumBefore) {
        Alert.alert('Already Active', 'Your Premium subscription is already active.', [{ text: 'OK' }]);
      } else {
        Alert.alert('No Purchases Found', 'No previous App Store Premium purchases were found for this account.', [{ text: 'OK' }]);
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error('[ClaimApprovedModal] restorePurchases error:', err?.message ?? String(e));
      Alert.alert('Unable to Restore', "We couldn't restore premium access right now. Please try again.", [{ text: 'OK' }]);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDismiss();
  };

  const handleContinue = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDismiss();
    setTimeout(() => {
      if (farmstandId) {
        router.push(`/owner/premium-onboarding?farmstandId=${farmstandId}`);
      } else {
        router.push('/owner/premium-onboarding');
      }
    }, 50);
  };

  const handleCompare = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDismiss();
    setTimeout(() => {
      if (farmstandId) {
        router.push(`/owner/free-vs-premium?farmstandId=${farmstandId}`);
      } else {
        router.push('/owner/free-vs-premium');
      }
    }, 50);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
    >
      {/* SafeAreaView handles all insets — no manual inset math needed */}
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FAF7F2' }}>
        <View style={{ flex: 1 }}>

          {/* ── HEADER (sits in layout flow, does not scroll) ── */}
          <View
            style={{
              height: 52,
              paddingHorizontal: 16,
              justifyContent: 'center',
              backgroundColor: '#FAF7F2',
            }}
          >
            <Pressable
              onPress={handleDismiss}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: '#E9E9EB',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 1 },
                  shadowOpacity: 0.09,
                  shadowRadius: 3,
                  elevation: 2,
                }}
              >
                <X size={20} color="#1C1917" strokeWidth={2.5} />
              </View>
            </Pressable>
          </View>

          {/* ── SCROLLABLE CONTENT (flex: 1 so it fills space between header and footer) ── */}
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 32 }}
            bounces
          >
            {/* ── Hero zone ── */}
            <Animated.View
              entering={FadeIn.duration(500)}
              style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 28, paddingHorizontal: 24 }}
            >
              {/* Layered glow rings */}
              <View
                style={{
                  width: 136,
                  height: 136,
                  borderRadius: 68,
                  backgroundColor: 'rgba(45,90,61,0.06)',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 28,
                }}
              >
                <View
                  style={{
                    width: 108,
                    height: 108,
                    borderRadius: 54,
                    backgroundColor: 'rgba(45,90,61,0.1)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Animated.View entering={ZoomIn.delay(200).springify().damping(14)}>
                    <LinearGradient
                      colors={['#2D5A3D', '#4A7C59']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: 40,
                        alignItems: 'center',
                        justifyContent: 'center',
                        shadowColor: '#2D5A3D',
                        shadowOffset: { width: 0, height: 10 },
                        shadowOpacity: 0.45,
                        shadowRadius: 20,
                        elevation: 12,
                      }}
                    >
                      <Sparkles size={36} color="#FFD700" fill="#FFD700" strokeWidth={1.5} />
                    </LinearGradient>
                  </Animated.View>
                </View>
              </View>

              {/* Title */}
              <Animated.Text
                entering={FadeInDown.delay(120).springify().damping(18)}
                style={{
                  fontSize: 30,
                  fontWeight: '800',
                  color: '#1C1917',
                  textAlign: 'center',
                  letterSpacing: -0.6,
                  marginBottom: 10,
                  lineHeight: 36,
                }}
              >
                Your Farmstand{'\n'}Is Claimed
              </Animated.Text>

              {/* Subtitle */}
              <Animated.Text
                entering={FadeInDown.delay(180).springify().damping(18)}
                style={{
                  fontSize: 15,
                  color: '#57534E',
                  textAlign: 'center',
                  lineHeight: 22,
                  paddingHorizontal: 12,
                  marginBottom: 22,
                }}
              >
                Start your{' '}
                <Text style={{ color: '#2D5A3D', fontWeight: '700' }}>3-month free trial</Text>
                {' '}to unlock all premium features. $4.99/month after — cancel anytime.
              </Animated.Text>

              {/* Free trial badge */}
              <Animated.View entering={FadeInDown.delay(240).springify().damping(18)}>
                <LinearGradient
                  colors={['#2D5A3D', '#3D7A52']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 18,
                    paddingVertical: 9,
                    borderRadius: 100,
                    gap: 7,
                  }}
                >
                  <Sparkles size={14} color="#FFD700" fill="#FFD700" />
                  <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>
                    3-Month Free Trial Available
                  </Text>
                </LinearGradient>
              </Animated.View>
            </Animated.View>

            {/* ── Features card ── */}
            <Animated.View
              entering={FadeInDown.delay(290).springify().damping(18)}
              style={{ marginHorizontal: 20 }}
            >
              <View
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: 22,
                  padding: 20,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.07,
                  shadowRadius: 14,
                  elevation: 5,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: '#2D5A3D',
                    textTransform: 'uppercase',
                    letterSpacing: 0.9,
                    marginBottom: 6,
                  }}
                >
                  Your Premium features:
                </Text>

                <FeatureRow
                  icon={<Camera size={19} color="#2D5A3D" />}
                  label="Up to 20 Photos + 1 Video"
                  description="Showcase your stand with up to 20 photos and 1 video up to 30 seconds"
                  delay={330}
                />
                <FeatureRow
                  icon={<MessageCircle size={19} color="#2D5A3D" />}
                  label="Customer messaging"
                  description="Answer questions directly from shoppers"
                  delay={370}
                />
                <FeatureRow
                  icon={<Bell size={19} color="#2D5A3D" />}
                  label="Push notifications"
                  description="Keep your customers in the loop"
                  delay={410}
                />
                <FeatureRow
                  icon={<ShoppingBag size={19} color="#2D5A3D" />}
                  label="Detailed product cards"
                  description="Rich product listings with photos and descriptions"
                  delay={450}
                />
                <FeatureRow
                  icon={<LayoutDashboard size={19} color="#2D5A3D" />}
                  label="Farmstand Manager"
                  description="Full dashboard to manage your stand"
                  delay={490}
                />
                <FeatureRow
                  icon={<BarChart2 size={19} color="#2D5A3D" />}
                  label="Analytics & Insights"
                  description="See views, saves, and customer activity"
                  delay={530}
                />
              </View>
            </Animated.View>

            {/* ── Pricing note ── */}
            <Animated.View
              entering={FadeInDown.delay(570).springify().damping(18)}
              style={{
                marginHorizontal: 20,
                marginTop: 14,
                borderRadius: 16,
                padding: 16,
                backgroundColor: '#F0F9F3',
                borderWidth: 1,
                borderColor: 'rgba(45,90,61,0.13)',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: '#2D5A3D',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 10,
                    marginTop: 1,
                    flexShrink: 0,
                  }}
                >
                  <Star size={10} color="#FFD700" fill="#FFD700" />
                </View>
                <Text style={{ fontSize: 13, color: '#1C1917', fontWeight: '600', flex: 1 }}>
                  After 3 months, $4.99/month — renews automatically unless canceled
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: 'rgba(45,90,61,0.1)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 10,
                    marginTop: 1,
                    flexShrink: 0,
                  }}
                >
                  <Text style={{ fontSize: 10, color: '#2D5A3D', fontWeight: '800' }}>✓</Text>
                </View>
                <Text style={{ fontSize: 13, color: '#57534E', flex: 1, lineHeight: 19 }}>
                  Payment will be charged to your Apple ID after the 3-month trial. Cancel anytime in your Apple account settings.
                </Text>
              </View>
            </Animated.View>

          </ScrollView>

          {/* ── FOOTER (plain sibling View below ScrollView, never scrolls) ── */}
          <View
            style={{
              backgroundColor: '#FAF7F2',
              paddingTop: 14,
              paddingHorizontal: 16,
              paddingBottom: 20,
              borderTopWidth: 1,
              borderTopColor: '#EDE9E4',
            }}
          >
            {/* Primary CTA */}
            <Pressable
              onPress={handleContinue}
              style={({ pressed }) => ({
                backgroundColor: '#2D5A3D',
                borderRadius: 16,
                paddingVertical: 16,
                paddingHorizontal: 20,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#2D5A3D',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25,
                shadowRadius: 10,
                elevation: 4,
                opacity: pressed ? 0.88 : 1,
              })}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16, flex: 1, textAlign: 'center', marginLeft: 24 }}>
                Start 3-Month Free Trial
              </Text>
              <ChevronRight size={20} color="#FFFFFF" strokeWidth={2.5} />
            </Pressable>

            {/* Restore Purchases */}
            <Pressable
              onPress={handleRestore}
              disabled={isRestoring}
              style={({ pressed }) => ({
                marginTop: 10,
                marginBottom: 2,
                paddingVertical: 10,
                paddingHorizontal: 16,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed || isRestoring ? 0.45 : 1,
              })}
            >
              <Text style={{ color: '#8C9E8A', fontSize: 13, fontWeight: '500' }}>
                {isRestoring ? 'Restoring…' : 'Restore Purchases'}
              </Text>
            </Pressable>

            {/* Compare Free vs Premium row */}
            <Pressable
              onPress={handleCompare}
              style={({ pressed }) => ({
                marginTop: 16,
                paddingVertical: 14,
                paddingHorizontal: 16,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(31,77,54,0.06)',
                borderRadius: 12,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: '#1F4D36', fontWeight: '600', fontSize: 14, textAlign: 'center', flex: 1 }}>
                Compare Free vs Premium
              </Text>
              <ChevronRight size={16} color="#1F4D36" strokeWidth={2.5} />
            </Pressable>

            {/* Legal links */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 16, gap: 6 }}>
              <Pressable
                onPress={() => setLegalModal({ title: 'Privacy Policy', url: 'https://farmstand.online/privacy-policy' })}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Text style={{ fontSize: 12, color: '#A8A29E' }}>Privacy Policy</Text>
              </Pressable>
              <Text style={{ fontSize: 12, color: '#D6D3D1' }}>|</Text>
              <Pressable
                onPress={() => setLegalModal({ title: 'Terms of Use', url: 'https://farmstand.online/terms-of-service' })}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Text style={{ fontSize: 12, color: '#A8A29E' }}>Terms of Use</Text>
              </Pressable>
            </View>
          </View>

        </View>
      </SafeAreaView>

      {/* Legal WebView Modal */}
      {legalModal && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setLegalModal(null)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
            {/* Header */}
            <View
              style={{
                height: 52,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                borderBottomWidth: 1,
                borderBottomColor: '#EDE9E4',
              }}
            >
              <Pressable
                onPress={() => setLegalModal(null)}
                style={({ pressed }) => ({
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: '#E9E9EB',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <X size={17} color="#1C1917" strokeWidth={2.5} />
              </Pressable>
              <Text
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 16,
                  fontWeight: '600',
                  color: '#1C1917',
                  marginRight: 34,
                }}
              >
                {legalModal.title}
              </Text>
            </View>
            <WebView source={{ uri: legalModal.url }} style={{ flex: 1 }} />
          </SafeAreaView>
        </Modal>
      )}
    </Modal>
  );
}
