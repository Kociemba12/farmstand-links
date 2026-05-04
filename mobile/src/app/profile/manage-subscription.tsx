import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Crown, RotateCcw, CreditCard, Star } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { useBootstrapStore } from '@/lib/bootstrap-store';
import { prepareForPurchase } from '@/lib/revenuecat';
import { MenuRow } from '@/components/MenuRow';

const ENTITLEMENT_ID = 'Farmstand Premium';
const BG_COLOR = '#FAF7F2';

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function SectionHeader({ title, delay = 0 }: { title: string; delay?: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)}>
      <Text
        style={{
          color: '#78716C',
          fontWeight: '600',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          marginBottom: 10,
          marginLeft: 4,
        }}
      >
        {title}
      </Text>
    </Animated.View>
  );
}

function CardWrapper({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(400)}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
        overflow: 'hidden',
        marginBottom: 20,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.06)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 3,
      }}
    >
      {children}
    </Animated.View>
  );
}

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [restoring, setRestoring] = useState(false);

  const ownedFarmstands = useBootstrapStore((s) => s.userFarmstands);
  const refreshUserFarmstands = useBootstrapStore((s) => s.refreshUserFarmstands);

  const primaryFarmstand = ownedFarmstands[0] ?? null;

  useEffect(() => {
    // Lazy-init RC when the user opens this screen (user-triggered, not startup).
    const { ok } = prepareForPurchase();
    if (!ok) {
      setLoadingInfo(false);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const info = await Purchases.getCustomerInfo();
        if (mounted) setCustomerInfo(info);
      } catch (e) {
        console.error('[ManageSubscription] getCustomerInfo error:', e);
      } finally {
        if (mounted) setLoadingInfo(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const getPlanInfo = () => {
    const entitlement = customerInfo?.entitlements.active[ENTITLEMENT_ID];

    if (entitlement) {
      const isTrial = primaryFarmstand?.premiumStatus === 'trial';
      const planLabel = isTrial ? 'Premium Trial Active' : 'Premium Active';
      let secondaryText = '';
      if (entitlement.expirationDate) {
        const formatted = formatDate(entitlement.expirationDate);
        secondaryText = `Renews ${formatted}`;
      } else if (primaryFarmstand?.premiumTrialExpiresAt) {
        secondaryText = `Renews ${formatDate(primaryFarmstand.premiumTrialExpiresAt)}`;
      }
      return { planLabel, secondaryText };
    }

    // Fallback to farmstand-level status
    const status = primaryFarmstand?.premiumStatus ?? 'free';
    const statusMap: Record<string, string> = {
      active: 'Premium Active',
      trial: 'Premium Trial Active',
      expired: 'Trial Ended',
      free: 'Free Plan',
    };
    const planLabel = statusMap[status] ?? 'Free Plan';
    let secondaryText = '';
    if (status === 'trial' && primaryFarmstand?.premiumTrialExpiresAt) {
      secondaryText = `Renews ${formatDate(primaryFarmstand.premiumTrialExpiresAt)}`;
    }
    return { planLabel, secondaryText };
  };

  const handleRestore = useCallback(async () => {
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
          'Setup Error',
          'Unable to initialize the purchase system. Please restart the app and try again.',
          [{ text: 'OK' }]
        );
      }
      return;
    }

    setRestoring(true);
    try {
      // Fetch fresh entitlement state from RevenueCat right now — not from cached screen state.
      const freshInfoBefore = await Purchases.getCustomerInfo();
      const wasPremiumBefore = !!freshInfoBefore.entitlements.active[ENTITLEMENT_ID];
      console.log('[ManageSubscription] restore — wasPremiumBefore:', wasPremiumBefore);

      const infoAfter = await Purchases.restorePurchases();
      const isPremiumAfter = !!infoAfter.entitlements.active[ENTITLEMENT_ID];
      console.log('[ManageSubscription] restore — isPremiumAfter:', isPremiumAfter);
      setCustomerInfo(infoAfter);

      if (wasPremiumBefore) {
        Alert.alert('Premium Active', 'You already have premium access.', [{ text: 'OK' }]);
      } else if (isPremiumAfter) {
        refreshUserFarmstands().catch(() => {});
        Alert.alert('Access Restored', 'Your premium access has been restored.', [{ text: 'OK' }]);
      } else {
        Alert.alert('No Purchases Found', 'No previous App Store Premium purchases were found for this account.', [{ text: 'OK' }]);
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error('[ManageSubscription] restorePurchases error:', err?.message ?? String(e));
      Alert.alert(
        'Unable to Restore',
        "We couldn't restore premium access right now. Please try again.",
        [{ text: 'OK' }]
      );
    } finally {
      setRestoring(false);
    }
  }, [refreshUserFarmstands]);

  const handleManageBilling = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'ios') {
      const url = 'https://apps.apple.com/account/subscriptions';
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert(
          'Manage Billing',
          'Subscription billing is managed through your Apple account settings.',
          [{ text: 'OK' }]
        );
      }
    } else {
      Alert.alert(
        'Manage Billing',
        'Subscription billing is managed through your Apple account settings.',
        [{ text: 'OK' }]
      );
    }
  }, []);

  const handlePremiumFeatures = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/profile/paywall');
  }, [router]);

  const { planLabel, secondaryText } = getPlanInfo();
  const isPremiumActive = planLabel === 'Premium Active' || planLabel === 'Premium Trial Active';
  const planIconColor = isPremiumActive ? '#2D5A3D' : '#78716C';
  const planIconBg = isPremiumActive ? '#E8F0E8' : '#F5F5F4';

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Manage Subscription',
          headerBackTitle: 'Profile',
          headerStyle: { backgroundColor: BG_COLOR },
          headerShadowVisible: false,
          headerTintColor: '#1C1917',
          headerTitleStyle: { fontWeight: '600', fontSize: 17 },
        }}
      />
      <View style={{ flex: 1, backgroundColor: BG_COLOR }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 }}
        >
          {/* Current Plan */}
          <SectionHeader title="Plan" delay={0} />
          <CardWrapper delay={60}>
            <View style={{ padding: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: planIconBg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 16,
                  }}
                >
                  {loadingInfo ? (
                    <ActivityIndicator size="small" color="#2D5A3D" />
                  ) : (
                    <Crown size={24} color={planIconColor} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      color: '#78716C',
                      fontWeight: '500',
                      letterSpacing: 0.4,
                      marginBottom: 3,
                    }}
                  >
                    Current Plan
                  </Text>
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: '700',
                      color: '#1C1917',
                      letterSpacing: -0.3,
                    }}
                  >
                    {loadingInfo ? 'Loading...' : planLabel}
                  </Text>
                  {!loadingInfo && secondaryText ? (
                    <Text style={{ fontSize: 13, color: '#78716C', marginTop: 2 }}>
                      {secondaryText}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          </CardWrapper>

          {/* Actions */}
          <SectionHeader title="Actions" delay={100} />
          <CardWrapper delay={140}>
            <MenuRow
              icon={CreditCard}
              label="Manage Billing"
              subtitle="View subscription in Apple account settings"
              onPress={handleManageBilling}
              iconColor="#3B82F6"
              iconBgColor="#EFF6FF"
            />
            <MenuRow
              icon={Star}
              label="Premium Features"
              subtitle="See everything included in Premium"
              onPress={handlePremiumFeatures}
              iconColor="#D4943A"
              iconBgColor="#FEF3C7"
            />
            <MenuRow
              icon={RotateCcw}
              label="Restore Purchases"
              subtitle={restoring ? 'Restoring…' : 'If you previously purchased Premium, tap here to restore your access'}
              onPress={restoring ? () => {} : handleRestore}
              iconColor="#78716C"
              iconBgColor="#F5F5F4"
              isLast
            />
          </CardWrapper>
        </ScrollView>
      </View>
    </>
  );
}
