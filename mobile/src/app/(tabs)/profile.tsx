import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, Dimensions, ImageBackground, Alert, AppState, AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronRight,
  HelpCircle,
  LogOut,
  Leaf,
  Shield,
  BarChart3,
  Store,
  MessageSquare,
  MapPin,
  Send,
  Settings,
  UserPlus,
  FileText,
  LogIn,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn, FadeOut } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { useFavoritesStore } from '@/lib/favorites-store';
import { useAdminStore } from '@/lib/admin-store';
import { useBootstrapStore } from '@/lib/bootstrap-store';
import { useAdminStatusStore } from '@/lib/admin-status-store';
import { useAuth } from '@/providers/AuthProvider';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { MenuRow } from '@/components/MenuRow';
import { logProfileOpen } from '@/lib/analytics-events';
import { FarmstandDebugOverlay, FarmstandDebugState, FARMSTAND_DEBUG_INITIAL } from '@/components/FarmstandDebugOverlay';
import { ProfileFarmstandSkeleton, ProfileAnalyticsSkeleton } from '@/components/ProfileSkeletons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Background color constant
const BG_COLOR = '#FAF7F2';

// Default farmstand hero image - rustic produce stand with warm tones
const DEFAULT_FARMSTAND_HERO = 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800&q=80';

// Account Tile Component (2-column grid)
interface AccountTileProps {
  icon: React.ElementType;
  label: string;
  onPress: () => void;
  iconColor?: string;
  fullWidth?: boolean;
}

function AccountTile({
  icon: Icon,
  label,
  onPress,
  iconColor = '#2D5A3D',
  fullWidth = false,
}: AccountTileProps) {
  return (
    <Pressable
      onPress={onPress}
      className={`bg-white rounded-2xl p-4 active:scale-[0.98] ${fullWidth ? 'flex-1' : ''}`}
      style={{
        width: fullWidth ? '100%' : (SCREEN_WIDTH - 52) / 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <View
            className="w-11 h-11 rounded-full items-center justify-center"
            style={{ backgroundColor: '#E8F0E8' }}
          >
            <Icon size={20} color={iconColor} />
          </View>
          <Text className="ml-3 text-base text-stone-800 font-medium flex-1" numberOfLines={1}>
            {label}
          </Text>
        </View>
        <ChevronRight size={16} color="#A8A29E" />
      </View>
    </Pressable>
  );
}

// Feature Card Component (for prominent CTAs)
interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  onPress: () => void;
  bgColor: string;
  iconBgColor: string;
  iconColor: string;
  delay?: number;
}

function FeatureCard({
  icon: Icon,
  title,
  subtitle,
  onPress,
  bgColor,
  iconBgColor,
  iconColor,
  delay = 0,
}: FeatureCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)} className="mb-4">
      <Pressable
        onPress={onPress}
        className="rounded-2xl p-5 active:scale-[0.98]"
        style={{
          backgroundColor: bgColor,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.06,
          shadowRadius: 10,
          elevation: 3,
        }}
      >
        <View className="flex-row items-center">
          <View
            className="w-12 h-12 rounded-full items-center justify-center"
            style={{ backgroundColor: iconBgColor }}
          >
            <Icon size={24} color={iconColor} />
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-stone-900 font-semibold text-base">{title}</Text>
            <Text className="text-stone-500 text-sm mt-0.5">{subtitle}</Text>
          </View>
          <ChevronRight size={20} color="#78716C" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Section Header Component
function SectionHeader({ title, delay = 0 }: { title: string; delay?: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)}>
      <Text className="text-stone-500 font-semibold text-sm uppercase tracking-wider mb-3 ml-1">
        {title}
      </Text>
    </Animated.View>
  );
}

// Card Wrapper Component
function CardWrapper({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(400)}
      className="bg-white rounded-[22px] overflow-hidden mb-5"
      style={{
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

export default function ProfileScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);
  const location = useUserStore((s) => s.location);
  const loadUser = useUserStore((s) => s.loadUser);
  const signOut = useUserStore((s) => s.signOut);

  // Admin status from Supabase (with email-based failsafe)
  const adminStatus = useAdminStatusStore((s) => s.status);
  const checkAdminStatus = useAdminStatusStore((s) => s.checkAdminStatus);

  // Auth session state — used to gate the farmstand fetch and skeleton logic
  const { session: authSession, loading: authLoading } = useAuth();

  // FAILSAFE: Admin email always grants admin, regardless of profile lookup
  const isAdminByEmail = isAdminEmail(user?.email);
  const isAdmin = isAdminByEmail || adminStatus === 'admin';
  const isAdminLoading = !isAdminByEmail && adminStatus === 'loading';

  // Get admin store helpers
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const refreshUserFarmstands = useBootstrapStore((s) => s.refreshUserFarmstands);

  // Read owned farmstands and status directly from bootstrap store.
  const userFarmstandsStatus = useBootstrapStore((s) => s.userFarmstandsStatus);
  const ownedFarmstands = useBootstrapStore((s) => s.userFarmstands);

  // farmstandsReady: ONLY true when the fetch has fully completed with authoritative data.
  // Never use cached/stale data to show "My Farmstand" — a pending-claim user must not
  // see ownership cards until the server confirms they are an approved owner.
  const farmstandsReady = userFarmstandsStatus === 'loaded';

  // In-flight guard: prevents overlapping refreshes from useFocusEffect + AppState
  const refreshInFlight = useRef(false);

  // Track whether the Profile screen is currently focused.
  // Used so the auth-ready effect below can trigger a fetch if the screen was
  // already focused when authLoading flipped to false (useFocusEffect won't re-run
  // for a screen that is already in focus when its callback deps change).
  const isFocusedRef = useRef(false);

  // ── Unified loading state: true until ALL profile data is ready ──────────
  // Prevents partial content from appearing — Farmstand + Analytics both
  // fade in together once every parallel fetch resolves.
  const [profileLoading, setProfileLoading] = useState(true);

  // ── DEBUG OVERLAY (dev/TestFlight only — remove when bugs are resolved) ──
  const [profileDebugState, setProfileDebugState] = useState<FarmstandDebugState>(FARMSTAND_DEBUG_INITIAL);
  const profileDbg = useCallback((patch: Partial<FarmstandDebugState>) => {
    if (!__DEV__) return;
    setProfileDebugState((s) => ({ ...s, ...patch }));
  }, []);

  // Find farmstands SUBMITTED by this user (safe to derive from allFarmstands — no flicker risk)
  const mySubmissions = allFarmstands.filter(
    (f) => f.createdByUserId === user?.id
  );

  // Check admin status when user email changes
  useEffect(() => {
    if (user?.email) {
      checkAdminStatus(user.email);
    }
  }, [user?.email, checkAdminStatus]);

  // Helper: run a farmstand refresh if not already in flight.
  // Extracted so both useFocusEffect and the auth-ready effect can call it.
  const doProfileRefresh = useCallback(() => {
    if (refreshInFlight.current) {
      console.log('[Profile] doProfileRefresh — refresh already in flight, skipping');
      return;
    }
    refreshInFlight.current = true;
    setProfileLoading(true);

    const { userFarmstandsStatus: statusNow, userFarmstands: farmsNow } = useBootstrapStore.getState();
    console.log('[Profile] doProfileRefresh — userId:', user?.id, '| farmstandsStatus:', statusNow, '| inMemory:', farmsNow.length);

    profileDbg({
      farmstandQueryIsLoading: true,
      farmstandQueryIsFetching: true,
      farmstandQueryStatus: statusNow,
      farmstandQueryReturnedId: farmsNow[0]?.id ?? null,
      farmstandQueryReturnedNull: farmsNow.length === 0,
    });

    // Load all profile data in parallel — user, admin data, and farmstands.
    // setProfileLoading(false) only fires once ALL three resolve.
    Promise.all([
      loadUser(),
      loadAdminData(),
      // Pass the AuthProvider session token so the fetch can bypass getValidSession()
      // on cold launch when the token may appear expired but AuthProvider has confirmed it.
      refreshUserFarmstands(authSession?.access_token),
    ]).finally(() => {
      refreshInFlight.current = false;
      const { userFarmstands: farmsAfter, userFarmstandsStatus: statusAfter, userFarmstandsError: errAfter } = useBootstrapStore.getState();
      console.log('[DEBUG][Step 13] Profile re-fetch resolves — ownedFarmstands:', farmsAfter.length, '| ids:', farmsAfter.map((f) => f.id).join(', ') || 'none', '| status:', statusAfter);
      profileDbg({
        profileLoaded: true,
        farmstandQueryIsLoading: false,
        farmstandQueryIsFetching: false,
        farmstandQueryStatus: statusAfter,
        farmstandQueryReturnedId: farmsAfter[0]?.id ?? null,
        farmstandQueryReturnedNull: farmsAfter.length === 0,
        farmstandQueryError: errAfter ?? null,
      });
      setProfileLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authSession?.access_token, loadUser, loadAdminData, refreshUserFarmstands, profileDbg]);

  // Reload user data when screen comes into focus.
  // CRITICAL: Do not call refreshUserFarmstands while auth is still loading —
  // getValidSession() returns null before the session is restored, which causes
  // the fetch to return 0 farmstands and incorrectly show "Add a Farmstand".
  useFocusEffect(
    useCallback(() => {
      // Track focus state so the auth-ready effect below can trigger a fetch
      // if authLoading flips while the screen is already focused.
      isFocusedRef.current = true;

      // STEP 1 & 12: Profile screen mounts / re-mounts (focus)
      console.log('[DEBUG][Step 1/12] Profile screen focused — userId:', user?.id ?? 'none', '| authLoading:', authLoading);
      profileDbg({
        profileScreenMounted: true,
        authReady: !authLoading,
        userId: user?.id ?? null,
      });

      // Wait for auth to finish loading before querying farmstands.
      // If auth is still loading, the auth-ready effect below will pick this up
      // and call doProfileRefresh() once authLoading becomes false.
      if (!authLoading) {
        doProfileRefresh();
        logProfileOpen(user?.id);
        if (user?.email) {
          checkAdminStatus(user.email);
        }
      } else {
        console.log('[Profile] useFocusEffect — auth still loading, auth-ready effect will trigger fetch');
      }

      return () => {
        isFocusedRef.current = false;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, user?.email, authLoading, doProfileRefresh])
  );

  // Auth-ready trigger: fires when authLoading transitions true → false.
  // Handles the race where the screen was already focused when AuthProvider
  // finished initializing — useFocusEffect won't re-run for a screen that is
  // already focused when its callback deps change.
  const prevAuthLoadingRef = useRef(authLoading);
  useEffect(() => {
    const wasLoading = prevAuthLoadingRef.current;
    prevAuthLoadingRef.current = authLoading;

    // Only act on the transition true → false
    if (wasLoading && !authLoading) {
      console.log('[Profile] auth became ready — isFocused:', isFocusedRef.current, '| triggering farmstand fetch');
      if (isFocusedRef.current) {
        doProfileRefresh();
        logProfileOpen(user?.id);
        if (user?.email) {
          checkAdminStatus(user.email);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // AppState listener: refetch when app comes to foreground
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // Guard: skip if a refresh is already running
        if (refreshInFlight.current) return;
        refreshInFlight.current = true;

        console.log('[Profile] AppState active - refreshing user farmstands');
        refreshUserFarmstands().finally(() => {
          refreshInFlight.current = false;
        });
      }
      appStateRef.current = nextAppState;
    });
    return () => subscription.remove();
  // refreshUserFarmstands is a stable Zustand action ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect to auth choice page when not logged in
  useEffect(() => {
    if (!isLoggedIn || !user) {
      router.replace('/auth/login');
    }
  }, [isLoggedIn, user, router]);

  // ── DEBUG: keep profile debug panel in sync with live store/auth values ──
  useEffect(() => {
    if (!__DEV__) return;
    profileDbg({
      authReady: !authLoading,
      userId: user?.id ?? null,
      farmstandQueryIsLoading: userFarmstandsStatus === 'loading',
      farmstandQueryIsFetching: userFarmstandsStatus === 'loading',
      farmstandQueryStatus: userFarmstandsStatus,
      farmstandQueryReturnedId: ownedFarmstands[0]?.id ?? null,
      farmstandQueryReturnedNull: farmstandsReady && ownedFarmstands.length === 0,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, userFarmstandsStatus, ownedFarmstands, farmstandsReady]);

  const handleMenuPress = async (route: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  };

  const handleStatPress = async (type: 'visited' | 'reviews') => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/profile/${type}` as never);
  };

  const handleFarmerPress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/farmer/onboarding');
  };

  const handleAdminPress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // FAILSAFE: Admin email ALWAYS gets access, bypass loading state
    if (isAdminByEmail) {
      router.push('/admin/dashboard');
      return;
    }

    // If still loading, show spinner alert and don't navigate
    if (isAdminLoading) {
      Alert.alert('Checking Access', 'Please wait while we verify your admin status...');
      return;
    }

    // If not admin, show alert and stay on current screen (no redirect)
    if (!isAdmin) {
      Alert.alert(
        'Not Authorized',
        "You don't have admin access. Admin access requires is_admin = true in your profile."
      );
      return;
    }

    // User is admin - navigate to dashboard
    router.push('/admin/dashboard');
  };

  const handleAnalyticsPress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/profile/analytics');
  };

  const handleSignOut = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await signOut();
  };

  // Not logged in - show loading state while redirecting to welcome
  if (!isLoggedIn || !user) {
    return (
      <View className="flex-1 bg-forest">
        <SafeAreaView className="flex-1 items-center justify-center px-6">
          <Image
            source={require('../../../assets/farmstand-logo.png')}
            style={{ width: 280, height: 140, tintColor: '#FFFFFF' }}
            resizeMode="contain"
          />
        </SafeAreaView>
      </View>
    );
  }

  const isGuestUser = isGuest();
  // ownedFarmstands is always an array from the store (never null)
  const resolvedOwned = ownedFarmstands;
  const primaryFarmstand = resolvedOwned[0];
  const userLocation = location?.city && location?.state ? `${location.city}, ${location.state}` : null;

  // Single source of truth: user has a farmstand only when the query confirms it.
  // Never use user.isFarmer alone for farmstand-ownership UI — it is stale after delete.
  const hasFarmstand = farmstandsReady && resolvedOwned.length > 0;

  // Log which farmstand render branch we're taking
  console.log('[Profile] RENDER BRANCH — status:', userFarmstandsStatus, '| ownedCount:', resolvedOwned.length, '| hasFarmstand:', hasFarmstand, '| profileLoading:', profileLoading, '| isAdmin:', isAdmin, '| ids:', resolvedOwned.map((f) => f.id).join(', ') || 'none');

  // Determine hero background image - use user's profile photo with fallback
  const isFarmerOrOwner = !isGuestUser && hasFarmstand;
  const heroImage = user.profilePhoto || DEFAULT_FARMSTAND_HERO;

  // Get subtitle text
  const getSubtitleText = () => {
    if (isGuestUser) {
      return userLocation ? `Guest • ${userLocation}` : 'Looking for fresh & local';
    }
    // Admins show as "Admin" not "Farmstand Manager"
    if (isAdmin) {
      return userLocation ? `Admin • ${userLocation}` : 'Admin';
    }
    // Only show farmstand subtitle when ownership data is authoritative
    if (farmstandsReady && resolvedOwned.length > 0 && primaryFarmstand) {
      // Show count if multiple farmstands
      const countText = resolvedOwned.length > 1 ? ` (${resolvedOwned.length})` : '';
      return `Farmstand Manager${countText} • ${primaryFarmstand.city}, ${primaryFarmstand.state}`;
    }
    return userLocation ? `Member • ${userLocation}` : 'Member';
  };

  return (
    <View className="flex-1" style={{ backgroundColor: BG_COLOR }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Hero Header - Airy farmstand photo with white fog fade */}
        <Animated.View entering={FadeIn.duration(500)}>
          <View style={{ height: 290 }}>
            {/* Hero Image - No tint overlay */}
            <ImageBackground
              source={{ uri: heroImage }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            >
              {/* White fog gradient fade at bottom - dissolves into page */}
              <LinearGradient
                colors={[
                  'transparent',
                  'transparent',
                  'rgba(250,247,242,0.3)',
                  'rgba(250,247,242,0.7)',
                  'rgba(250,247,242,0.92)',
                ]}
                locations={[0, 0.35, 0.55, 0.75, 1]}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: '100%',
                }}
              />
            </ImageBackground>

            {/* Avatar positioned over hero */}
            <SafeAreaView
              edges={['top']}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
              }}
            >
              <View className="items-center pt-10 px-5">
                {/* Avatar with white ring */}
                <View
                  style={{
                    width: 92,
                    height: 92,
                    borderRadius: 46,
                    borderWidth: 4,
                    borderColor: '#FFFFFF',
                    overflow: 'hidden',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.15,
                    shadowRadius: 8,
                    elevation: 6,
                  }}
                >
                  {user.profilePhoto ? (
                    <Image
                      source={{ uri: user.profilePhoto }}
                      style={{ width: 84, height: 84 }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      className="w-full h-full items-center justify-center"
                      style={{ backgroundColor: isFarmerOrOwner ? '#2D5A3D' : '#78716C' }}
                    >
                      <Text className="text-white text-3xl font-bold">{user.initials}</Text>
                    </View>
                  )}
                </View>

                {/* Name */}
                <Text
                  className="text-2xl font-bold mt-4"
                  style={{ color: '#1C1917' }}
                >
                  {user.name}
                </Text>

                {/* Subtitle */}
                <Text
                  className="text-sm mt-1"
                  style={{ color: '#57534E' }}
                >
                  {getSubtitleText()}
                </Text>
              </View>
            </SafeAreaView>
          </View>
        </Animated.View>

        {/* Stats Card - Below hero, soft shadow (only for logged in users) */}
        {!isGuestUser && (
          <View className="px-5 mt-4">
            <Animated.View
              entering={FadeInDown.delay(100).duration(400)}
              style={{
                backgroundColor: '#FFFCF9',
                borderRadius: 22,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.06,
                shadowRadius: 12,
                elevation: 4,
              }}
            >
              <View className="flex-row" style={{ height: 92 }}>
                <Pressable
                  className="flex-1 items-center justify-center border-r border-stone-100 active:bg-stone-50"
                  onPress={() => handleStatPress('visited')}
                  style={{ borderTopLeftRadius: 22, borderBottomLeftRadius: 22 }}
                >
                  <Text className="text-stone-900 text-3xl font-bold">{user.visitedCount}</Text>
                  <Text className="text-stone-500 text-sm mt-1">Visited</Text>
                </Pressable>
                <Pressable
                  className="flex-1 items-center justify-center active:bg-stone-50"
                  onPress={() => handleStatPress('reviews')}
                  style={{ borderTopRightRadius: 22, borderBottomRightRadius: 22 }}
                >
                  <Text className="text-stone-900 text-3xl font-bold">{user.reviewsCount}</Text>
                  <Text className="text-stone-500 text-sm mt-1">Reviews</Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        )}

        {/* Main Content */}
        <View className="px-5 pt-6">
          {/* GUEST USER LAYOUT */}
          {isGuestUser && (
            <>
              {/* Create Account CTA */}
              <FeatureCard
                icon={UserPlus}
                title="Create an Account"
                subtitle="Sign up to save stands, leave reviews, and add your info."
                onPress={() => handleMenuPress('/auth/signup')}
                bgColor="#E8F5E9"
                iconBgColor="#2D5A3D"
                iconColor="#FFFFFF"
                delay={150}
              />

              {/* Log In Row */}
              <CardWrapper delay={200}>
                <MenuRow
                  icon={LogIn}
                  label="Log In"
                  subtitle="Already have an account?"
                  onPress={() => handleMenuPress('/auth/login')}
                  isLast
                />
              </CardWrapper>

              {/* Legal Section for Guests */}
              <SectionHeader title="Legal" delay={250} />
              <CardWrapper delay={300}>
                <MenuRow
                  icon={Shield}
                  label="Privacy Policy"
                  subtitle="How we protect your data"
                  onPress={() => handleMenuPress('/profile/privacy-policy')}
                  iconColor="#6B7280"
                />
                <MenuRow
                  icon={FileText}
                  label="Terms of Service"
                  subtitle="Our terms and conditions"
                  onPress={() => handleMenuPress('/profile/terms')}
                  iconColor="#6B7280"
                  isLast
                />
              </CardWrapper>

              {/* Version for Guests */}
              <Text className="text-center text-stone-400 text-xs mt-4">Version 1.0.0</Text>
            </>
          )}

          {/* LOGGED IN USER LAYOUT */}
          {!isGuestUser && (
            <>
              {/* Admin Dashboard - Only for the app owner */}
              {isAdmin && (
                <FeatureCard
                  icon={Shield}
                  title="Admin Dashboard"
                  subtitle="Manage farmstands, users, and content"
                  onPress={handleAdminPress}
                  bgColor="#F5F3FF"
                  iconBgColor="#7C3AED"
                  iconColor="#FFFFFF"
                  delay={150}
                />
              )}

              {/* My Farmstand Section + Analytics — split skeleton logic by ownership state */}
              {/* Show farmstand skeleton while loading, regardless of ownership outcome */}
              {/* Only show analytics skeleton AFTER ownership is confirmed true */}
              {!isAdmin && profileLoading && (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
                  <ProfileFarmstandSkeleton />
                  {/* Analytics skeleton only renders once server confirms ownership */}
                  {userFarmstandsStatus === 'loaded' && ownedFarmstands.length > 0 && (
                    <ProfileAnalyticsSkeleton />
                  )}
                </Animated.View>
              )}

              {/* Real cards: revealed together once profileLoading is false */}
              {!isAdmin && !profileLoading && (
                <Animated.View entering={FadeIn.duration(300)}>
                  {/* Owned farmstands */}
                  {farmstandsReady && resolvedOwned.length > 0 && (
                    <>
                      <SectionHeader title={resolvedOwned.length > 1 ? 'My Farmstands' : 'My Farmstand'} delay={0} />
                      {resolvedOwned.map((farmstand, index) => (
                        <Animated.View
                          key={farmstand.id}
                          entering={FadeInDown.delay(index * 40).duration(300)}
                          className="bg-white rounded-2xl overflow-hidden mb-3"
                          style={{
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 3 },
                            shadowOpacity: 0.06,
                            shadowRadius: 12,
                            elevation: 3,
                          }}
                        >
                          <Pressable
                            onPress={() => {
                              // STEP 2: My Farmstand card tapped
                              console.log('[DEBUG][Step 2] My Farmstand card tapped — farmstandId:', farmstand.id, '| name:', farmstand.name, '| appReady:', useBootstrapStore.getState().appReady, '| userFarmstandsStatus:', useBootstrapStore.getState().userFarmstandsStatus);
                              console.log('[Profile] Tapping My Farmstand — id:', farmstand.id, 'appReady:', useBootstrapStore.getState().appReady, 'userFarmstandsStatus:', useBootstrapStore.getState().userFarmstandsStatus);
                              router.push(`/owner/my-farmstand?id=${farmstand.id}`);
                            }}
                            className="active:bg-stone-50"
                          >
                            <View className="flex-row p-4">
                              {/* Thumbnail */}
                              <View className="w-20 h-20 rounded-xl overflow-hidden bg-stone-100">
                                {farmstand.photos?.[0] ? (
                                  <Image
                                    source={{ uri: farmstand.photos[0] }}
                                    style={{ width: 80, height: 80 }}
                                    resizeMode="cover"
                                  />
                                ) : (
                                  <View className="w-full h-full items-center justify-center">
                                    <Store size={28} color="#A8A29E" />
                                  </View>
                                )}
                              </View>

                              {/* Info */}
                              <View className="flex-1 ml-4 justify-center">
                                <Text className="text-stone-900 font-semibold text-base" numberOfLines={1}>
                                  {farmstand.name}
                                </Text>
                                <View className="flex-row items-center mt-1">
                                  <MapPin size={14} color="#78716C" />
                                  <Text className="text-stone-500 text-sm ml-1">
                                    {farmstand.city}, {farmstand.state}
                                  </Text>
                                </View>
                              </View>

                              <View className="justify-center ml-2">
                                <ChevronRight size={20} color="#A8A29E" />
                              </View>
                            </View>
                          </Pressable>
                        </Animated.View>
                      ))}
                      <View style={{ height: 8 }} />
                    </>
                  )}

                  {/* Add a Farmstand CTA — only after fetch confirmed no owned farmstands */}
                  {userFarmstandsStatus === 'loaded' && resolvedOwned.length === 0 && (
                    <FeatureCard
                      icon={Leaf}
                      title="Add a Farmstand"
                      subtitle="Help grow the map by adding a local farmstand."
                      onPress={handleFarmerPress}
                      bgColor="#FEF7F5"
                      iconBgColor="#C45C3E"
                      iconColor="#FFFFFF"
                      delay={200}
                    />
                  )}

                  {/* Analytics CTA — only visible for owners, revealed together with farmstand card */}
                  {hasFarmstand && (
                    <FeatureCard
                      icon={BarChart3}
                      title="My Analytics"
                      subtitle="Track views, saves, and customer interactions"
                      onPress={handleAnalyticsPress}
                      bgColor="#EFF6FF"
                      iconBgColor="#3B82F6"
                      iconColor="#FFFFFF"
                      delay={300}
                    />
                  )}
                </Animated.View>
              )}

              {/* Admin Analytics — always visible for admins, no skeleton needed */}
              {isAdmin && (
                <FeatureCard
                  icon={BarChart3}
                  title="Platform Analytics"
                  subtitle="Monitor platform activity and engagement"
                  onPress={handleAnalyticsPress}
                  bgColor="#EFF6FF"
                  iconBgColor="#3B82F6"
                  iconColor="#FFFFFF"
                  delay={300}
                />
              )}

              {/* My Submissions Row - Show for users who have submissions */}
              {mySubmissions.length > 0 && (
                <FeatureCard
                  icon={Send}
                  title="My Submissions"
                  subtitle={`${mySubmissions.length} Farmstand${mySubmissions.length !== 1 ? 's' : ''} you've added`}
                  onPress={() => handleMenuPress('/profile/submissions')}
                  bgColor="#FDF4FF"
                  iconBgColor="#A855F7"
                  iconColor="#FFFFFF"
                  delay={320}
                />
              )}

              {/* Account Section - 2 Column Grid */}
              <SectionHeader title="Account" delay={350} />
              <Animated.View
                entering={FadeInDown.delay(400).duration(400)}
                className="flex-row flex-wrap mb-5"
                style={{ gap: 12 }}
              >
                <AccountTile
                  icon={Settings}
                  label="Settings"
                  onPress={() => handleMenuPress('/profile/settings')}
                />
                <AccountTile
                  icon={MessageSquare}
                  label="Reviews"
                  onPress={() => handleStatPress('reviews')}
                />
              </Animated.View>

              {/* Support Section */}
              <SectionHeader title="Support" delay={450} />
              <CardWrapper delay={500}>
                <MenuRow
                  icon={HelpCircle}
                  label="Feedback & Support"
                  onPress={() => handleMenuPress('/profile/help')}
                  isLast
                />
              </CardWrapper>

              {/* Sign Out */}
              <Animated.View entering={FadeInDown.delay(650).duration(400)} className="mt-2 mb-4">
                <Pressable
                  onPress={handleSignOut}
                  className="flex-row items-center justify-center py-4 active:opacity-70"
                >
                  <LogOut size={18} color="#A64B33" />
                  <Text className="text-rust font-medium ml-2">Sign Out</Text>
                </Pressable>
              </Animated.View>

              {/* Version */}
              <Text className="text-center text-stone-400 text-xs">Version 1.0.0</Text>
            </>
          )}
        </View>
      </ScrollView>

      {/* Debug overlay — dev/TestFlight only, remove when bugs are resolved */}
      <FarmstandDebugOverlay
        state={profileDebugState}
        extra={{
          authLoading: authLoading,
          farmstandsReady: farmstandsReady,
          isWaitingForFetch: profileLoading,
          showSkeleton: profileLoading,
          ownedCount: ownedFarmstands.length,
          profileHasFarmstandUI: hasFarmstand,
        }}
      />
    </View>
  );
}
