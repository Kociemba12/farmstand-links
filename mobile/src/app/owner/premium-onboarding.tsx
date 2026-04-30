import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  Camera,
  MessageCircle,
  Bell,
  ShoppingBag,
  LayoutDashboard,
  BarChart2,
  Sparkles,
  Star,
  AlertCircle,
  X,
  CheckCircle,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn, ZoomIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Purchases, { PurchasesPackage } from 'react-native-purchases';
import { useUserStore } from '@/lib/user-store';
import {
  markPremiumOnboardingAsSeen,
  markClaimApprovedModalAsSeen,
  usePremiumOnboardingStore,
} from '@/lib/premium-onboarding-store';
import { prepareForPurchase } from '@/lib/revenuecat';
import { useBootstrapStore } from '@/lib/bootstrap-store';
import { getValidSession } from '@/lib/supabase';
import { trackEvent } from '@/lib/track';

const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const ENTITLEMENT_ID = 'pro';

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

// ─── Success State ────────────────────────────────────────────────────────────

function PremiumActiveState({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Animated.View
      entering={FadeIn.duration(350)}
      style={{ alignItems: 'center', paddingHorizontal: 24, paddingVertical: 48 }}
    >
      {/* X close button */}
      <Pressable
        onPress={onDismiss}
        hitSlop={8}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: '#E9E9EB',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.08,
          shadowRadius: 3,
          elevation: 2,
        }}
      >
        <X size={17} color="#1C1917" strokeWidth={2.5} />
      </Pressable>

      <Animated.View entering={ZoomIn.delay(100).springify().damping(14)}>
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
            marginBottom: 24,
            shadowColor: '#2D5A3D',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.45,
            shadowRadius: 20,
            elevation: 12,
          }}
        >
          <CheckCircle size={44} color="#FFFFFF" strokeWidth={2.5} />
        </LinearGradient>
      </Animated.View>

      <Animated.Text
        entering={FadeInDown.delay(160).springify().damping(18)}
        style={{
          fontSize: 28,
          fontWeight: '800',
          color: '#1C1917',
          textAlign: 'center',
          letterSpacing: -0.6,
          marginBottom: 10,
        }}
      >
        Premium Active
      </Animated.Text>

      <Animated.Text
        entering={FadeInDown.delay(220).springify().damping(18)}
        style={{
          fontSize: 15,
          color: '#57534E',
          textAlign: 'center',
          lineHeight: 22,
        }}
      >
        Your 3-month free trial is now active. Enjoy all premium features.
      </Animated.Text>
    </Animated.View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function PremiumOnboardingScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId?: string }>();
  const user = useUserStore((s) => s.user);
  const setPendingFarmstandId = usePremiumOnboardingStore((s) => s.setPendingFarmstandId);
  const refreshUserFarmstands = useBootstrapStore((s) => s.refreshUserFarmstands);

  const targetFarmstandId = farmstandId ?? '';

  const [purchasing, setPurchasing] = useState(false);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Guard: ensure the mark-as-seen + store-clear logic only runs once,
  // even if this component re-renders or React StrictMode mounts it twice.
  const hasInitializedRef = useRef(false);

  // Mark as seen when this screen mounts — the user has seen the onboarding
  useEffect(() => {
    if (hasInitializedRef.current) {
      return;
    }
    if (user?.id && targetFarmstandId) {
      hasInitializedRef.current = true;
      markPremiumOnboardingAsSeen(user.id, targetFarmstandId);
      // Also mark the Explore modal as seen so it doesn't appear after this screen
      markClaimApprovedModalAsSeen(user.id);
      // Clear pending state so no other screen triggers it again
      setPendingFarmstandId(null);
    }
  }, [user?.id, targetFarmstandId, setPendingFarmstandId]);

  // Track whether success has already been shown so the customerInfo listener
  // doesn't fire a duplicate success animation if purchasePackage already handled it.
  const purchaseSuccessRef = useRef(false);

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  // Subscribe to RevenueCat customerInfo updates so purchases that complete after
  // the app returns from background (Apple auth flow) are still handled.
  const handleCustomerInfoUpdate = useCallback(
    (info: import('react-native-purchases').CustomerInfo) => {
      const isPremiumActive = !!info.entitlements.active[ENTITLEMENT_ID];
      const activeKeys = Object.keys(info.entitlements.active).join(', ') || 'none';
      console.log('[PremiumPurchase] customerInfo listener fired — entitlement "' + ENTITLEMENT_ID + '" active:', isPremiumActive, '| all active:', activeKeys);
      if (isPremiumActive && !purchaseSuccessRef.current) {
        console.log('[PremiumPurchase] Entitlement became active via background listener — showing success state');
        purchaseSuccessRef.current = true;
        refreshUserFarmstands().catch(() => {});
        setPurchaseSuccess(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
    [refreshUserFarmstands]
  );

  useEffect(() => {
    Purchases.addCustomerInfoUpdateListener(handleCustomerInfoUpdate);
    return () => {
      Purchases.removeCustomerInfoUpdateListener(handleCustomerInfoUpdate);
    };
  }, [handleCustomerInfoUpdate]);

  const handleRestore = async () => {
    trackEvent('restore_purchase_tapped', { source: 'premium_onboarding', farmstand_id: targetFarmstandId || null });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    console.log('[PremiumPurchase] ── Restore Purchases tapped ──');
    const { ok, reason } = prepareForPurchase();
    if (!ok) {
      if (reason === 'non-native') {
        Alert.alert('Available in the iOS App', 'Premium purchases are available in the iOS app. Open the app from the App Store or TestFlight to subscribe.', [{ text: 'OK' }]);
      } else {
        Alert.alert('Purchase Setup Error', 'Unable to initialize the purchase system. Please restart the app and try again.', [{ text: 'OK' }]);
      }
      return;
    }
    setIsRestoring(true);
    try {
      console.log('[PremiumPurchase] Calling Purchases.restorePurchases()...');
      const info = await Purchases.restorePurchases();
      const isPremiumActive = !!info.entitlements.active[ENTITLEMENT_ID];
      const activeEntitlements = Object.keys(info.entitlements.active).join(', ') || 'none';
      console.log('[PremiumPurchase] restorePurchases complete — entitlement "' + ENTITLEMENT_ID + '" active:', isPremiumActive, '| all active:', activeEntitlements);
      if (isPremiumActive) {
        refreshUserFarmstands().catch(() => {});
        Alert.alert('Premium Restored', 'Your Premium access has been restored!', [{ text: 'Continue', onPress: handleDismiss }]);
      } else {
        console.log('[PremiumPurchase] No active entitlement found after restore — all active:', activeEntitlements);
        Alert.alert('No Purchase Found', 'No previous App Store Premium purchases were found for this account.', [{ text: 'OK' }]);
      }
    } catch (e: unknown) {
      const err = e as { message?: string; code?: number; userCancelled?: boolean };
      console.warn('[PremiumPurchase] restorePurchases error — code:', err?.code, 'userCancelled:', err?.userCancelled, 'message:', err?.message ?? String(e));
      try { console.warn('[PremiumPurchase] restore error JSON:', JSON.stringify(e)); } catch { /* non-serializable */ }
      Alert.alert('Unable to Restore', "We couldn't restore premium access right now. Please try again.", [{ text: 'OK' }]);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleCompare = () => {
    trackEvent('premium_comparison_opened', { source: 'premium_onboarding', farmstand_id: targetFarmstandId || null });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (targetFarmstandId) {
      router.push(`/owner/free-vs-premium?farmstandId=${targetFarmstandId}`);
    } else {
      router.push('/owner/free-vs-premium');
    }
  };

  const handleStartTrial = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    console.log('[PremiumPurchase] ── tap: "Start 3-Month Free Trial" ──');
    console.log('[PremiumPurchase] Platform.OS:', Platform.OS, '| user?.id:', user?.id ?? '(none)');

    const { ok, reason } = prepareForPurchase();
    console.log('[PremiumPurchase] prepareForPurchase — ok:', ok, 'reason:', reason ?? 'none');

    if (!ok) {
      if (reason === 'non-native') {
        Alert.alert(
          'Available in the iOS App',
          'Premium purchases are available in the iOS app. Open the app from the App Store or TestFlight to subscribe.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Purchase Setup Error',
          'Unable to initialize the purchase system. Please restart the app and try again.',
          [{ text: 'OK' }]
        );
      }
      return;
    }

    // Ensure the current user is identified in RevenueCat before purchasing so
    // the entitlement is bound to the right account.  logIn() is idempotent if
    // the user is already identified, so it is safe to call here.
    if (user?.id) {
      try {
        const loginResult = await Purchases.logIn(user.id);
        console.log('[PremiumPurchase] RC logIn — created new RC user:', loginResult.created);
      } catch (loginErr) {
        console.warn('[PremiumPurchase] RC logIn failed (non-fatal — will attempt purchase anyway):', loginErr);
      }
    }

    setPurchasing(true);
    try {
      console.log('[PremiumPurchase] Calling Purchases.getOfferings()...');
      const offerings = await Purchases.getOfferings();
      const currentOfferingId = offerings.current?.identifier ?? 'none';
      const allOfferingKeys = Object.keys(offerings.all ?? {}).join(', ') || 'none';
      console.log('[PremiumPurchase] Offerings — current:', currentOfferingId, '| allKeys:', allOfferingKeys);

      if (!offerings.current) {
        console.error('[PremiumPurchase] offerings.current is null — no active offering in RevenueCat dashboard for this environment');
        if (__DEV__) {
          console.log('[PremiumPurchase] Full offerings:', JSON.stringify(offerings));
        }
        Alert.alert(
          'Subscription Unavailable',
          'Unable to load subscription options. Please check your connection and try again.',
          [{ text: 'OK' }]
        );
        setPurchasing(false);
        return;
      }

      const pkgList = offerings.current.availablePackages
        .map((p) => `${p.identifier}(product:${p.product.identifier},type:${p.packageType})`)
        .join(' | ');
      console.log('[PremiumPurchase] Available packages:', pkgList || 'none');

      const pkg: PurchasesPackage | undefined =
        offerings.current?.monthly ??
        offerings.current?.availablePackages.find(
          (p) =>
            p.packageType === 'MONTHLY' ||
            p.identifier === '$rc_monthly' ||
            p.identifier === 'monthly'
        );

      if (!pkg) {
        console.error('[PremiumPurchase] No monthly package found — cannot proceed. PackageTypes available:', offerings.current.availablePackages.map(p => p.packageType).join(', '));
        Alert.alert(
          'Subscription Unavailable',
          'Unable to load subscription options. Please check your connection and try again.',
          [{ text: 'OK' }]
        );
        setPurchasing(false);
        return;
      }

      console.log('[PremiumPurchase] Package selected:', pkg.identifier, '| product:', pkg.product.identifier);
      console.log('[PremiumPurchase] Product — priceString:', pkg.product.priceString, '| introPrice:', JSON.stringify(pkg.product.introPrice));
      console.log('[PremiumPurchase] Calling Purchases.purchasePackage()...');

      // Capture customerInfo directly from purchasePackage — avoids a separate getCustomerInfo()
      // network call and is the most reliable way to check entitlement post-purchase.
      const { customerInfo: purchaseCustomerInfo } = await Purchases.purchasePackage(pkg);
      console.log('[PremiumPurchase] purchasePackage() resolved');

      const isPremiumActive = !!purchaseCustomerInfo.entitlements.active[ENTITLEMENT_ID];
      const activeEntitlements = Object.keys(purchaseCustomerInfo.entitlements.active).join(', ') || 'none';
      console.log('[PremiumPurchase] Entitlement "' + ENTITLEMENT_ID + '" active:', isPremiumActive, '| all active entitlements:', activeEntitlements);

      if (!isPremiumActive) {
        // Purchase processed but entitlement not yet active — RevenueCat may need a moment.
        // The customerInfo listener will catch it if it becomes active shortly after.
        console.warn('[PremiumPurchase] Purchase completed but entitlement "' + ENTITLEMENT_ID + '" NOT active. Check: 1) entitlement key in RevenueCat dashboard matches "' + ENTITLEMENT_ID + '" 2) product is attached to offering and entitlement');
      }

      // Write to DB — activates premium_status='trial' on the farmstand record
      if (targetFarmstandId) {
        try {
          const session = await getValidSession();
          if (session?.access_token) {
            console.log('[PremiumPurchase] Calling activate-premium backend for farmstand:', targetFarmstandId);
            const resp = await fetch(`${BACKEND_URL}/api/activate-premium`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ farmstand_id: targetFarmstandId }),
            });
            if (resp.ok) {
              console.log('[PremiumPurchase] activate-premium backend succeeded');
            } else {
              const errText = await resp.text();
              console.warn('[PremiumPurchase] activate-premium backend failed:', resp.status, errText);
            }
          } else {
            console.warn('[PremiumPurchase] No valid session — skipping activate-premium backend call');
          }
        } catch (backendErr) {
          console.warn('[PremiumPurchase] activate-premium network error:', backendErr);
        }
      }

      refreshUserFarmstands().catch(() => {});
      trackEvent('premium_trial_started', { source: 'premium_onboarding', farmstand_id: targetFarmstandId || null });
      purchaseSuccessRef.current = true;
      setPurchaseSuccess(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: unknown) {
      const err = e as {
        userCancelled?: boolean;
        message?: string;
        code?: number;
        underlyingErrorMessage?: string;
        readableErrorCode?: string;
      };

      // Log every available field — critical for diagnosing the "nothing happens" case
      console.warn('[PremiumPurchase] ── PURCHASE ERROR ──');
      console.warn('[PremiumPurchase] userCancelled:', err?.userCancelled);
      console.warn('[PremiumPurchase] code:', err?.code);
      console.warn('[PremiumPurchase] message:', err?.message ?? String(e));
      console.warn('[PremiumPurchase] underlyingErrorMessage:', err?.underlyingErrorMessage ?? '(none)');
      console.warn('[PremiumPurchase] readableErrorCode:', err?.readableErrorCode ?? '(none)');
      try { console.warn('[PremiumPurchase] full error JSON:', JSON.stringify(e)); } catch { /* non-serializable */ }

      if (err?.userCancelled) {
        // "Nothing happens" is almost always this branch — userCancelled=true silently exits.
        // Show a DEV alert so it's visible during debugging.
        console.log('[PremiumPurchase] Purchase cancelled (userCancelled=true) — user stays on free plan');
        if (__DEV__) {
          Alert.alert(
            '[DEV] Purchase Cancelled',
            'userCancelled=true\n\nThis means StoreKit returned a cancelled transaction.\n\nCommon causes:\n• Product not in App Store Connect / sandbox\n• Offering not active in RevenueCat\n• User dismissed payment sheet\n• Wrong bundle ID\n• Sandbox account issue\n\nCheck LOGS tab for full error details.',
            [{ text: 'OK' }]
          );
        }
      } else if (err?.code === 23) {
        console.warn('[PremiumPurchase] CONFIGURATION_ERROR (code 23) — product not set up in App Store Connect / RevenueCat');
        Alert.alert(
          'Subscriptions Unavailable',
          'Subscription options are not available right now. Please try again later.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert(
          'Purchase Failed',
          err?.message ?? 'Something went wrong. Please try again.',
          [{ text: 'OK' }]
        );
      }
    } finally {
      setPurchasing(false);
    }
  };

  const maxCardHeight = SCREEN_HEIGHT * 0.82;
  const [legalModal, setLegalModal] = useState<{ title: string; url: string } | null>(null);

  return (
    <SafeAreaView edges={[]} style={{ flex: 1 }}>
      {/* ── Dimmed overlay ── */}
      <Pressable
        onPress={handleDismiss}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <BlurView
          intensity={18}
          tint="dark"
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
      </Pressable>

      {/* ── Centered card ── */}
      <Animated.View
        entering={FadeIn.duration(280)}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 20,
        }}
        pointerEvents="box-none"
      >
        <View
          style={{
            width: '100%',
            maxWidth: 520,
            maxHeight: purchaseSuccess ? undefined : maxCardHeight,
            borderRadius: 28,
            backgroundColor: '#FAF7F2',
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 20 },
            shadowOpacity: 0.25,
            shadowRadius: 40,
            elevation: 24,
          }}
        >
          {/* ── Purchase success state ── */}
          {purchaseSuccess ? (
            <PremiumActiveState onDismiss={handleDismiss} />
          ) : (
            <>
              {/* ── Card header with close button ── */}
              <View
                style={{
                  paddingTop: 18,
                  paddingHorizontal: 18,
                  paddingBottom: 0,
                }}
              >
                <Pressable
                  onPress={handleDismiss}
                  hitSlop={8}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: '#E9E9EB',
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.08,
                    shadowRadius: 3,
                    elevation: 2,
                  }}
                >
                  <X size={17} color="#1C1917" strokeWidth={2.5} />
                </Pressable>
              </View>

              {/* ── Scrollable content ── */}
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 28 }}
                bounces={true}
              >
                {/* ── Hero zone ── */}
                <Animated.View
                  entering={FadeIn.duration(500)}
                  style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 10, paddingHorizontal: 24 }}
                >
                  {/* Layered glow rings */}
                  <View
                    style={{
                      width: 104,
                      height: 104,
                      borderRadius: 52,
                      backgroundColor: 'rgba(45,90,61,0.06)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 14,
                    }}
                  >
                    <View
                      style={{
                        width: 82,
                        height: 82,
                        borderRadius: 41,
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
                            width: 60,
                            height: 60,
                            borderRadius: 30,
                            alignItems: 'center',
                            justifyContent: 'center',
                            shadowColor: '#2D5A3D',
                            shadowOffset: { width: 0, height: 8 },
                            shadowOpacity: 0.4,
                            shadowRadius: 16,
                            elevation: 10,
                          }}
                        >
                          <Sparkles size={27} color="#FFD700" fill="#FFD700" strokeWidth={1.5} />
                        </LinearGradient>
                      </Animated.View>
                    </View>
                  </View>

                  {/* Title */}
                  <Animated.Text
                    entering={FadeInDown.delay(120).springify().damping(18)}
                    style={{
                      fontSize: 28,
                      fontWeight: '800',
                      color: '#1C1917',
                      textAlign: 'center',
                      letterSpacing: -0.6,
                      marginBottom: 10,
                      lineHeight: 34,
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
                      paddingHorizontal: 8,
                    }}
                  >
                    Start your{' '}
                    <Text style={{ color: '#2D5A3D', fontWeight: '700' }}>3-month free trial</Text>
                    {' '}to unlock all premium features. $4.99/month after — cancel anytime.
                  </Animated.Text>
                </Animated.View>

                {/* ── Primary CTA — visible before scrolling ── */}
                <Animated.View
                  entering={FadeInDown.delay(220).springify().damping(18)}
                  style={{ paddingHorizontal: 16, paddingBottom: 18 }}
                >
                  <Pressable
                    onPress={handleStartTrial}
                    disabled={purchasing}
                    style={({ pressed }) => ({
                      borderRadius: 16,
                      shadowColor: '#142E1E',
                      shadowOffset: { width: 0, height: 6 },
                      shadowOpacity: purchasing ? 0.18 : 0.38,
                      shadowRadius: 16,
                      elevation: 10,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                      opacity: purchasing ? 0.82 : 1,
                    })}
                  >
                    <LinearGradient
                      colors={purchasing ? ['#4A7C59', '#3A6649'] : ['#2F6346', '#1C3D2A']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0.6, y: 1 }}
                      style={{
                        height: 58,
                        borderRadius: 16,
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'row',
                        gap: 10,
                      }}
                    >
                      {purchasing ? (
                        <>
                          <ActivityIndicator color="#FFFFFF" size="small" />
                          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.2 }}>
                            Starting Trial...
                          </Text>
                        </>
                      ) : (
                        <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.25 }}>
                          Start 3-Month Free Trial
                        </Text>
                      )}
                    </LinearGradient>
                  </Pressable>

                  {/* Supporting line */}
                  <Text
                    style={{
                      textAlign: 'center',
                      fontSize: 12,
                      color: '#A8A29E',
                      marginTop: 9,
                      letterSpacing: 0.1,
                    }}
                  >
                    Cancel anytime. $4.99/month after trial.
                  </Text>

                  {/* Restore Purchases */}
                  <View style={{ width: '100%', alignItems: 'center', marginTop: 12, marginBottom: 18 }}>
                    <Pressable
                      onPress={handleRestore}
                      disabled={isRestoring}
                      style={({ pressed }) => ({
                        paddingVertical: 9,
                        paddingHorizontal: 14,
                        opacity: pressed || isRestoring ? 0.45 : 1,
                      })}
                    >
                      <Text style={{ color: 'rgba(31,77,54,0.85)', fontSize: 14, fontWeight: '500', textDecorationLine: 'underline', textAlign: 'center' }}>
                        {isRestoring ? 'Restoring…' : 'Restore Purchases'}
                      </Text>
                    </Pressable>
                  </View>
                </Animated.View>

                {/* ── Features card ── */}
                <Animated.View
                  entering={FadeInDown.delay(290).springify().damping(18)}
                  style={{ marginHorizontal: 16 }}
                >
                  <View
                    style={{
                      backgroundColor: '#FFFFFF',
                      borderRadius: 20,
                      padding: 18,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.07,
                      shadowRadius: 14,
                      elevation: 5,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
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
                    marginHorizontal: 16,
                    marginTop: 12,
                    borderRadius: 16,
                    padding: 14,
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
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
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
                      <AlertCircle size={11} color="#2D5A3D" />
                    </View>
                    <Text style={{ fontSize: 13, color: '#57534E', flex: 1, lineHeight: 19 }}>
                      Promotions (boosted visibility) are separate paid add-ons and are not part of Premium.
                    </Text>
                  </View>
                </Animated.View>

                {/* ── Bottom links ── */}
                <View style={{ marginTop: 16, paddingHorizontal: 16 }}>
                  {/* Compare Free vs Premium */}
                  <Pressable
                    onPress={handleCompare}
                    style={({ pressed }) => ({
                      paddingVertical: 14,
                      alignItems: 'center',
                      opacity: pressed ? 0.5 : 1,
                    })}
                  >
                    <Text style={{ color: '#2D5A3D', fontWeight: '600', fontSize: 14, textAlign: 'center' }}>
                      Compare Free vs Premium
                    </Text>
                  </Pressable>

                  {/* Legal links */}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingBottom: 8, gap: 6 }}>
                    <Pressable
                      onPress={() => setLegalModal({ title: 'Privacy Policy', url: 'https://farmstand.online/privacy' })}
                      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                    >
                      <Text style={{ fontSize: 12, color: '#A8A29E' }}>Privacy Policy</Text>
                    </Pressable>
                    <Text style={{ fontSize: 12, color: '#D6D3D1' }}>|</Text>
                    <Pressable
                      onPress={() => setLegalModal({ title: 'Terms of Use', url: 'https://farmstand.online/terms' })}
                      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                    >
                      <Text style={{ fontSize: 12, color: '#A8A29E' }}>Terms of Use</Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            </>
          )}
        </View>
      </Animated.View>

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
    </SafeAreaView>
  );
}
