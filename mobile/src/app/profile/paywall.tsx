import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Star,
  Image as ImageIcon,
  MessageCircle,
  Bell,
  ShoppingBag,
  Settings,
  BarChart3,
  CheckCircle2,
  Smartphone,
  Crown,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Purchases, { PurchasesPackage, CustomerInfo } from 'react-native-purchases';
import { useBootstrapStore } from '@/lib/bootstrap-store';
import { isRevenueCatReady, prepareForPurchase } from '@/lib/revenuecat';
import { trackEvent } from '@/lib/track';

const ENTITLEMENT_ID = 'pro';

const FEATURES = [
  {
    icon: ImageIcon,
    label: 'Up to 20 Photos + 1 Video',
    description: 'Showcase your farmstand beautifully',
  },
  {
    icon: MessageCircle,
    label: 'Customer Messaging',
    description: 'Respond to inquiries directly from the app',
  },
  {
    icon: Bell,
    label: 'Push Notifications',
    description: 'Get alerts when products are in stock or out of stock',
  },
  {
    icon: ShoppingBag,
    label: 'Product Cards',
    description: 'Rich listings with photos, prices, and descriptions',
  },
  {
    icon: Settings,
    label: 'Farmstand Manager',
    description: 'Full dashboard to run your farmstand with ease',
  },
  {
    icon: BarChart3,
    label: 'Analytics & Insights',
    description: 'Track views, clicks, and customer engagement',
  },
];

export default function PaywallScreen() {
  const router = useRouter();
  const [pkg, setPkg] = useState<PurchasesPackage | null>(null);
  const [priceString, setPriceString] = useState<string>('$4.99/month');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loadingOfferings, setLoadingOfferings] = useState(true);
  const [offeringsLoadFailed, setOfferingsLoadFailed] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loadingEntitlement, setLoadingEntitlement] = useState(true);

  const refreshUserFarmstands = useBootstrapStore((s) => s.refreshUserFarmstands);
  const ownedFarmstands = useBootstrapStore((s) => s.userFarmstands);
  const primaryFarmstand = ownedFarmstands[0] ?? null;

  // Whether RevenueCat is ready for purchase calls in this environment.
  // State (not const) so that the lazy-init effect below can flip it to true
  // and trigger the offerings/entitlement effects to re-run.
  const [rcReady, setRcReady] = useState(() => isRevenueCatReady());

  // Lazy-init RevenueCat when the user explicitly opens the paywall.
  // With STARTUP_REVENUECAT_ENABLED=false, RC is not configured until here.
  useEffect(() => {
    if (rcReady) return;
    const { ok } = prepareForPurchase();
    if (ok) setRcReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch entitlement state to detect existing premium users before showing purchase UI.
  useEffect(() => {
    if (!rcReady) {
      setLoadingEntitlement(false);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const info = await Purchases.getCustomerInfo();
        if (mounted) setCustomerInfo(info);
      } catch (e) {
        console.error('[Paywall] getCustomerInfo error:', e);
      } finally {
        if (mounted) setLoadingEntitlement(false);
      }
    })();
    return () => { mounted = false; };
  }, [rcReady]);

  // Fetch the default offering and extract the monthly package from RevenueCat.
  useEffect(() => {
    if (!rcReady) {
      console.log('[Paywall] RevenueCat not ready — skipping getOfferings()');
      setLoadingOfferings(false);
      return;
    }

    let mounted = true;
    const fetchOffering = async () => {
      try {
        console.log('[RC] offerings fetch starting');
        console.log('[Paywall] Calling Purchases.getOfferings()...');
        const offerings = await Purchases.getOfferings();
        if (!mounted) return;

        console.log('[Paywall] getOfferings() result — current offering:', offerings.current?.identifier ?? 'none');

        const monthlyPkg =
          offerings.current?.monthly ??
          offerings.current?.availablePackages.find(
            (p) =>
              p.packageType === 'MONTHLY' ||
              p.identifier === '$rc_monthly' ||
              p.identifier === 'monthly'
          );

        if (monthlyPkg) {
          console.log('[Paywall] Monthly package found:', monthlyPkg.identifier, monthlyPkg.product.priceString);
          setPkg(monthlyPkg);
          setPriceString(monthlyPkg.product.priceString + '/month');
        } else if (!offerings.current) {
          console.warn('[Paywall] No default offering returned from RevenueCat — check dashboard configuration');
        } else {
          console.warn('[Paywall] Default offering has no monthly package — check RevenueCat offering setup');
        }
      } catch (e: unknown) {
        if (!mounted) return;
        const err = e as { message?: string };
        console.log('[RC] offerings fetch failed', err?.message ?? String(e));
        console.warn('[Paywall] getOfferings() error:', err?.message ?? String(e));
        setOfferingsLoadFailed(true);
      } finally {
        if (mounted) setLoadingOfferings(false);
      }
    };
    fetchOffering();
    return () => { mounted = false; };
  }, [rcReady]);

  useEffect(() => {
    trackEvent('paywall_opened', {
      farmstand_id: primaryFarmstand?.id ?? null,
      farmstand_name: primaryFarmstand?.name ?? null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive premium status: RevenueCat entitlement takes precedence, then farmstand status.
  const isPremium = (() => {
    if (customerInfo?.entitlements.active[ENTITLEMENT_ID]) return true;
    const status = primaryFarmstand?.premiumStatus;
    return status === 'active' || status === 'trial';
  })();

  const handleSubscribe = useCallback(async () => {
    trackEvent('upgrade_to_premium_tapped', { source: 'paywall', farmstand_id: primaryFarmstand?.id ?? null, farmstand_name: primaryFarmstand?.name ?? null });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    console.log('[Paywall] ── tap: subscribe button ──');
    console.log('[Paywall] Platform.OS:', Platform.OS);
    console.log('[Paywall] isNativeIOS:', Platform.OS === 'ios');

    const { ok, reason } = prepareForPurchase();
    console.log('[Paywall] prepareForPurchase result — ok:', ok, 'reason:', reason ?? 'none');

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

    let purchasePkg = pkg;
    if (!purchasePkg) {
      console.log('[Paywall] No cached package — fetching offerings now...');
      try {
        console.log('[RC] offerings fetch starting');
        const offerings = await Purchases.getOfferings();
        const currentOfferingId = offerings.current?.identifier ?? 'none';
        console.log('[Paywall] Offerings loaded — current offering:', currentOfferingId);

        purchasePkg =
          offerings.current?.monthly ??
          offerings.current?.availablePackages.find(
            (p) =>
              p.packageType === 'MONTHLY' ||
              p.identifier === '$rc_monthly' ||
              p.identifier === 'monthly'
          ) ?? null;

        if (purchasePkg) {
          console.log('[Paywall] Package found:', purchasePkg.identifier, '—', purchasePkg.product.identifier);
        } else {
          console.warn('[Paywall] No monthly package found in offerings');
        }
      } catch (e: unknown) {
        const err = e as { message?: string };
        console.log('[RC] offerings fetch failed', err?.message ?? String(e));
        console.warn('[Paywall] getOfferings() error:', err?.message ?? String(e));
        setOfferingsLoadFailed(true);
      }
    } else {
      console.log('[Paywall] Using cached package — offerings loaded: true');
      console.log('[Paywall] Current offering: (cached)');
    }

    if (!purchasePkg) {
      Alert.alert(
        'Subscription Unavailable',
        'Unable to load subscription options. Please check your connection and try again.',
        [{ text: 'OK' }]
      );
      return;
    }

    console.log('[Paywall] Selected package identifier:', purchasePkg.identifier);
    console.log('[Paywall] Store product identifier:', purchasePkg.product.identifier);
    console.log('[Paywall] Calling Purchases.purchasePackage()...');

    setPurchasing(true);
    try {
      await Purchases.purchasePackage(purchasePkg);

      const info = await Purchases.getCustomerInfo();
      const isPremiumActive = !!info.entitlements.active[ENTITLEMENT_ID];
      console.log('[Paywall] Purchase complete — premium entitlement active:', isPremiumActive);

      refreshUserFarmstands().catch(() => {});

      if (isPremiumActive) {
        Alert.alert(
          'Welcome to Premium!',
          'Your Farmstand Premium subscription is now active.',
          [{ text: 'Continue', onPress: () => router.back() }]
        );
      } else {
        Alert.alert(
          'Purchase Complete',
          'Your subscription is being processed. Premium features will be available shortly.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      }
    } catch (e: unknown) {
      const err = e as { userCancelled?: boolean; message?: string; code?: number };
      console.warn('[Paywall] Caught purchase error — code:', err?.code, 'message:', err?.message ?? String(e));
      if (err?.userCancelled) {
        console.log('[Paywall] Purchase cancelled by user');
      } else if (err?.code === 23) {
        console.warn('[Paywall] CONFIGURATION_ERROR — products not set up in App Store Connect / RevenueCat');
        Alert.alert(
          'Subscriptions Unavailable',
          'Subscription options are not available right now. Please try again later.',
          [{ text: 'OK' }]
        );
      } else {
        console.warn('[Paywall] purchasePackage() failed — message:', err?.message ?? String(e));
        Alert.alert(
          'Purchase Failed',
          err?.message ?? 'Something went wrong. Please try again.',
          [{ text: 'OK' }]
        );
      }
    } finally {
      setPurchasing(false);
    }
  }, [pkg, router, refreshUserFarmstands, primaryFarmstand]);

  const handleRestore = useCallback(async () => {
    trackEvent('restore_purchase_tapped', { source: 'paywall', farmstand_id: primaryFarmstand?.id ?? null });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const { ok, reason } = prepareForPurchase();
    if (!ok) {
      if (reason === 'non-native') {
        Alert.alert(
          'Available in the iOS App',
          'Restoring purchases is available in the iOS app build.',
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

    console.log('[Paywall] ── tap: restore purchases button ──');

    setRestoring(true);
    try {
      console.log('[Paywall] Calling Purchases.restorePurchases()...');
      const info = await Purchases.restorePurchases();
      const isPremiumActive = !!info.entitlements.active[ENTITLEMENT_ID];
      console.log('[Paywall] restorePurchases() complete — premium active:', isPremiumActive);

      if (isPremiumActive) {
        refreshUserFarmstands().catch(() => {});
        Alert.alert(
          'Premium Restored',
          'Your premium access has been restored.',
          [{ text: 'Continue', onPress: () => router.back() }]
        );
      } else {
        Alert.alert(
          'No Purchase Found',
          "We couldn't find a previous premium subscription for this Apple ID.",
          [{ text: 'OK' }]
        );
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error('[Paywall] restorePurchases() error:', err?.message ?? String(e));
      Alert.alert(
        'Unable to Restore',
        "We couldn't restore premium right now. Please try again later.",
        [{ text: 'OK' }]
      );
    } finally {
      setRestoring(false);
    }
  }, [router, refreshUserFarmstands, primaryFarmstand]);

  const displayPrice = loadingOfferings ? 'Loading...' : priceString;

  return (
    <View style={{ flex: 1, backgroundColor: '#FAF7F2' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Close button */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: 56,
            right: 20,
            zIndex: 10,
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: 'rgba(255,255,255,0.9)',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.1,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
            elevation: 3,
          }}
        >
          <X size={18} color="#1C1917" />
        </Pressable>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Green gradient hero */}
          <Animated.View entering={FadeIn.duration(400)}>
            <LinearGradient
              colors={['#1E4230', '#2D5A3D', '#3D7A53']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ paddingTop: 60, paddingBottom: 36, paddingHorizontal: 24, overflow: 'hidden' }}
            >
              {/* Decorative circles */}
              <View
                style={{
                  position: 'absolute',
                  top: -40,
                  right: -40,
                  width: 160,
                  height: 160,
                  borderRadius: 80,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  bottom: -20,
                  left: -20,
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                }}
              />

              {/* Badge */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  alignSelf: 'flex-start',
                  borderRadius: 20,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  marginBottom: 16,
                }}
              >
                <Star size={13} color="#FFD700" fill="#FFD700" />
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 12, marginLeft: 5 }}>
                  FARMSTAND PREMIUM
                </Text>
              </View>

              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 30,
                  fontWeight: '800',
                  letterSpacing: -0.5,
                  marginBottom: 8,
                  lineHeight: 36,
                }}
              >
                Grow your farmstand{'\n'}with Premium
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.78)', fontSize: 15, lineHeight: 22 }}>
                Everything you need to run and grow your local farmstand — in one place.
              </Text>

              {/* Price pill — hidden for users who already have premium */}
              {!isPremium && (
                <View
                  style={{
                    marginTop: 20,
                    backgroundColor: 'rgba(255,255,255,0.14)',
                    borderRadius: 50,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    alignSelf: 'flex-start',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>
                    {loadingOfferings ? 'Loading pricing...' : priceString}
                  </Text>
                </View>
              )}
            </LinearGradient>
          </Animated.View>

          {/* Premium Active banner — shown when user already has an active subscription or trial */}
          {!loadingEntitlement && isPremium && (
            <Animated.View entering={FadeInDown.delay(80).duration(350)}>
              <View
                style={{
                  marginHorizontal: 20,
                  marginTop: 16,
                  backgroundColor: '#EAF2EC',
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#C2D9C8',
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: '#2D5A3D',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Crown size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#1C1917', fontWeight: '700', fontSize: 15 }}>
                    Premium Active
                  </Text>
                  <Text style={{ color: '#4A7C59', fontSize: 13, marginTop: 2, lineHeight: 18 }}>
                    You have full access to all premium features
                  </Text>
                </View>
              </View>
            </Animated.View>
          )}

          {/* Preview-mode notice — shown only when RevenueCat is not ready */}
          {!rcReady && (
            <Animated.View entering={FadeInDown.delay(80).duration(350)}>
              <View
                style={{
                  marginHorizontal: 20,
                  marginTop: 16,
                  backgroundColor: '#FFF8E7',
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#F5D98A',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Smartphone size={18} color="#B07D0A" />
                <Text style={{ color: '#7A5500', fontSize: 13, lineHeight: 18, flex: 1 }}>
                  Premium purchases are available in the iOS app build and TestFlight.
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Features */}
          <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
            <Animated.View entering={FadeInDown.delay(100).duration(400)}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '700',
                  color: '#1C1917',
                  marginBottom: 12,
                  letterSpacing: -0.2,
                }}
              >
                Everything included
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
                  marginBottom: 24,
                }}
              >
                {FEATURES.map((feature, index) => {
                  const Icon = feature.icon;
                  const isLast = index === FEATURES.length - 1;
                  return (
                    <Animated.View
                      key={feature.label}
                      entering={FadeInDown.delay(150 + index * 50).duration(350)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        borderBottomWidth: isLast ? 0 : 1,
                        borderBottomColor: '#F5F0EB',
                      }}
                    >
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 19,
                          backgroundColor: '#EAF2EC',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginRight: 14,
                        }}
                      >
                        <Icon size={18} color="#2D5A3D" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#1C1917', fontWeight: '600', fontSize: 15 }}>
                          {feature.label}
                        </Text>
                        <Text style={{ color: '#9CA3AF', fontSize: 13, marginTop: 1 }}>
                          {feature.description}
                        </Text>
                      </View>
                      <CheckCircle2 size={20} color="#2D5A3D" />
                    </Animated.View>
                  );
                })}
              </View>
            </Animated.View>

            {/* Bottom section — varies by entitlement state */}
            {loadingEntitlement ? (
              // Still checking entitlement — show spinner, never show purchase UI prematurely
              <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color="#2D5A3D" />
              </Animated.View>
            ) : isPremium ? (
              // User already has premium — feature list is sufficient, no purchase UI needed
              null
            ) : rcReady && offeringsLoadFailed ? (
              // Offerings fetch failed — show spinner, never show "temporarily unavailable" to users
              <Animated.View entering={FadeIn.duration(300)} style={{ alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color="#2D5A3D" />
              </Animated.View>
            ) : (
              // Free user — show full paywall with price, subscribe, and restore
              <>
                {/* Disclaimer */}
                <Animated.View entering={FadeInDown.delay(500).duration(400)}>
                  <Text
                    style={{
                      color: '#A8A29E',
                      fontSize: 12,
                      textAlign: 'center',
                      lineHeight: 18,
                      marginBottom: 20,
                      paddingHorizontal: 8,
                    }}
                  >
                    Subscription renews automatically at {priceString} unless cancelled at least 24 hours before renewal. Manage or cancel anytime in your App Store account settings.
                  </Text>
                </Animated.View>

                {/* Subscribe button */}
                <Animated.View entering={FadeInDown.delay(560).duration(400)}>
                  <Pressable
                    onPress={handleSubscribe}
                    disabled={purchasing || restoring}
                    style={{
                      backgroundColor: purchasing ? '#4A7C59' : '#2D5A3D',
                      borderRadius: 16,
                      paddingVertical: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      shadowColor: '#2D5A3D',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 10,
                      elevation: 4,
                      marginBottom: 10,
                      opacity: purchasing ? 0.85 : 1,
                    }}
                  >
                    {purchasing ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 17, letterSpacing: -0.2 }}>
                          {rcReady ? `Subscribe for ${displayPrice}` : 'Subscribe · $4.99/month'}
                        </Text>
                        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 3 }}>
                          Cancel anytime
                        </Text>
                      </>
                    )}
                  </Pressable>
                </Animated.View>

                {/* Helper text */}
                <Animated.View entering={FadeInDown.delay(600).duration(400)}>
                  <Text
                    style={{
                      color: '#A8A29E',
                      fontSize: 12,
                      textAlign: 'center',
                      lineHeight: 17,
                      marginBottom: 20,
                      paddingHorizontal: 12,
                    }}
                  >
                    Your premium features will automatically unlock after purchase or restore.
                  </Text>
                </Animated.View>

                {/* Restore purchases */}
                <Animated.View entering={FadeInDown.delay(640).duration(400)}>
                  <Pressable
                    onPress={handleRestore}
                    disabled={purchasing || restoring}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 20,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#D6CFC8',
                      backgroundColor: '#FFFFFF',
                      marginBottom: 8,
                    }}
                  >
                    {restoring ? (
                      <ActivityIndicator size="small" color="#57534E" />
                    ) : (
                      <Text style={{ color: '#57534E', fontSize: 15, fontWeight: '500' }}>
                        Restore Purchases
                      </Text>
                    )}
                  </Pressable>
                </Animated.View>
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
