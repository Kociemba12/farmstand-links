import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, BarChart3, ChevronDown, Store } from 'lucide-react-native';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { useAnalyticsStore } from '@/lib/analytics-store';
import { useAdminStatusStore } from '@/lib/admin-status-store';
import { useBootstrapStore, selectUserFarmstands } from '@/lib/bootstrap-store';
import { OwnerAnalytics } from '@/components/OwnerAnalytics';
import { PlatformAnalytics } from '@/components/PlatformAnalytics';
import { FarmerRouteGuard } from '@/components/FarmerRouteGuard';
import { Farmstand } from '@/lib/farmer-store';

export default function AnalyticsScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const loadAnalytics = useAnalyticsStore((s) => s.loadAnalytics);

  // Admin status from Supabase (single source of truth)
  const adminStatus = useAdminStatusStore((s) => s.status);
  const checkAdminStatus = useAdminStatusStore((s) => s.checkAdminStatus);
  const isAdmin = adminStatus === 'admin';

  // Bootstrap store: source of truth for APPROVED owned farmstands.
  // This is used first so we never show "No Farmstand" to an approved owner
  // just because allFarmstands hasn't loaded yet from AsyncStorage cache.
  const bootstrapFarmstands = useBootstrapStore(selectUserFarmstands);
  const refreshUserFarmstands = useBootstrapStore((s) => s.refreshUserFarmstands);

  const isGuestUser = isGuest();

  // State for selected farmstand when viewing analytics - MUST be before early returns
  const [selectedFarmstandId, setSelectedFarmstandId] = useState<string | null>(null);
  const [showFarmstandPicker, setShowFarmstandPicker] = useState(false);

  useEffect(() => {
    loadAdminData();
    loadAnalytics();
    // Ensure we have fresh ownership data — critical for TestFlight where AsyncStorage
    // cache may not yet have the newly-approved farmstand
    console.log('[Analytics] Mount — user:', user?.id, '| bootstrapFarmstands:', bootstrapFarmstands.length);
    refreshUserFarmstands().then(() => {
      console.log('[Analytics] refreshUserFarmstands complete — bootstrap count:', useBootstrapStore.getState().userFarmstands.length);
    }).catch((err) => {
      console.log('[Analytics] refreshUserFarmstands error:', err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check admin status when user email changes
  useEffect(() => {
    if (user?.email) {
      checkAdminStatus(user.email);
    }
  }, [user?.email, checkAdminStatus]);

  // Redirect if not logged in
  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login');
    }
  }, [isLoggedIn, router]);

  // Use bootstrap store as the primary source for approved ownership.
  // Fall back to allFarmstands for cases where bootstrap isn't populated yet
  // (e.g. admin viewing another user's farmstand).
  const userFarmstands: Farmstand[] = React.useMemo(() => {
    if (!user) return [];

    // Primary: bootstrap store has the confirmed-approved owned farmstands
    if (bootstrapFarmstands.length > 0) {
      // Cross-reference with allFarmstands to get full Farmstand objects (if available)
      const enriched = bootstrapFarmstands.map((bf) => {
        const full = allFarmstands.find((f) => f.id === bf.id);
        return full || bf;
      });
      console.log('[Analytics] userFarmstands from bootstrap:', enriched.map((f) => f.id).join(', '));
      return enriched;
    }

    // Fallback: derive from allFarmstands (needed for admin or when bootstrap is empty)
    const fallback = allFarmstands.filter(
      (f) => f.claimStatus === 'claimed' &&
        (f.claimedByUserId === user.id || f.ownerUserId === user.id)
    );
    console.log('[Analytics] userFarmstands from allFarmstands fallback:', fallback.map((f) => f.id).join(', ') || 'none');
    return fallback;
  }, [user, bootstrapFarmstands, allFarmstands]);

  // Set initial selected farmstand when farmstands load
  useEffect(() => {
    if (userFarmstands.length > 0 && !selectedFarmstandId) {
      console.log('[Analytics] Setting initial selectedFarmstandId:', userFarmstands[0].id);
      setSelectedFarmstandId(userFarmstands[0].id);
    }
  }, [userFarmstands.length, selectedFarmstandId]);

  // Show guard for guests - AFTER all hooks
  if (isGuestUser) {
    return <FarmerRouteGuard title="Analytics" />;
  }

  if (!user) return null;

  // Get selected farmstand
  const selectedFarmstand = userFarmstands.find((f) => f.id === selectedFarmstandId) || userFarmstands[0];
  const farmstandId = selectedFarmstand?.id || null;
  const hasMultipleFarmstands = userFarmstands.length > 1;

  console.log('[Analytics] Render — isAdmin:', isAdmin, '| userFarmstands:', userFarmstands.length, '| farmstandId:', farmstandId);

  return (
    <>
      {/* Hide the default navigation header */}
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-1 bg-gray-50">
        <LinearGradient
        colors={['#2F6F4E', '#6FAF8E']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ paddingTop: 0, paddingBottom: 32, paddingHorizontal: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}
      >
        <SafeAreaView edges={['top']}>
          <View className="flex-row items-center justify-between mb-6">
            <Pressable onPress={() => router.back()} className="p-2 -ml-2">
              <ArrowLeft size={24} color="white" />
            </Pressable>
          </View>

          <View className="flex-row items-center mb-2">
            <View
              style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <BarChart3 size={24} color="white" />
            </View>
            <Text className="text-2xl font-bold text-white ml-3">
              {isAdmin ? 'Platform Analytics' : 'My Analytics'}
            </Text>
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.85)' }} className="text-base mt-2">
            {isAdmin
              ? 'Monitor platform activity and engagement'
              : 'Track how customers interact with your listing'}
          </Text>

          {/* Farmstand Selector - Show if user has multiple farmstands */}
          {!isAdmin && hasMultipleFarmstands && selectedFarmstand && (
            <Pressable
              onPress={() => setShowFarmstandPicker(!showFarmstandPicker)}
              className="flex-row items-center mt-4 p-3 rounded-xl"
              style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}
            >
              <Store size={18} color="white" />
              <Text className="text-white font-medium ml-2 flex-1" numberOfLines={1}>
                {selectedFarmstand.name}
              </Text>
              <ChevronDown size={18} color="white" style={{ transform: [{ rotate: showFarmstandPicker ? '180deg' : '0deg' }] }} />
            </Pressable>
          )}

          {/* Farmstand Picker Dropdown */}
          {!isAdmin && showFarmstandPicker && (
            <View className="mt-2 rounded-xl overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.95)' }}>
              {userFarmstands.map((farmstand) => (
                <Pressable
                  key={farmstand.id}
                  onPress={() => {
                    setSelectedFarmstandId(farmstand.id);
                    setShowFarmstandPicker(false);
                  }}
                  className="flex-row items-center p-3 border-b border-gray-100"
                  style={{
                    backgroundColor: farmstand.id === selectedFarmstandId ? '#E8F5E9' : 'transparent',
                  }}
                >
                  <Store size={16} color={farmstand.id === selectedFarmstandId ? '#2D5A3D' : '#78716C'} />
                  <Text
                    className="ml-2 flex-1"
                    style={{ color: farmstand.id === selectedFarmstandId ? '#2D5A3D' : '#44403C', fontWeight: farmstand.id === selectedFarmstandId ? '600' : '400' }}
                    numberOfLines={1}
                  >
                    {farmstand.name}
                  </Text>
                  {farmstand.id === selectedFarmstandId && (
                    <View className="w-2 h-2 rounded-full bg-green-600" />
                  )}
                </Pressable>
              ))}
            </View>
          )}
        </SafeAreaView>
      </LinearGradient>

      <View className="flex-1 -mt-4 bg-gray-50 rounded-t-3xl overflow-hidden">
        {isAdmin ? (
          <PlatformAnalytics />
        ) : (
          <OwnerAnalytics farmstandId={farmstandId} />
        )}
      </View>
    </View>
    </>
  );
}
