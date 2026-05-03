import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  ImageBackground,
  Share,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Store,
  Edit3,
  ChevronRight,
  CheckCircle,
  ShoppingBag,
  Eye,
  Share2,
  ExternalLink,
  Clock,
  AlertCircle,
  Trash2,
  Check,
  RefreshCw,
  Star,
  Zap,
  BarChart3,
  TrendingUp,
  Bell,
  Lock,
  MessageSquare,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Purchases from 'react-native-purchases';
import { isRevenueCatReady } from '@/lib/revenuecat';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { Farmstand } from '@/lib/farmer-store';
import { FarmerRouteGuard } from '@/components/FarmerRouteGuard';
import { FarmstandManager } from '@/components/FarmstandManager';
import { supabase, isSupabaseConfigured, ensureSessionReady } from '@/lib/supabase';
import { useBootstrapStore, selectUserFarmstands, selectAppReady, selectUserFarmstandsLoading, selectUserFarmstandsStatus, isRefreshInFlight } from '@/lib/bootstrap-store';
import { useAuth } from '@/providers/AuthProvider';
import { trackEvent } from '@/lib/track';
import NetInfo from '@react-native-community/netinfo';
import { useReviewUnread, markReviewsViewed, redDotStyle } from '@/lib/review-unread';

const fallbackHero = require('../../assets/images/farmstand-final-fallback.png') as number;

type TabType = 'manage' | 'public';

interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onPress: () => void;
  badge?: string;
  badgeColor?: string;
  locked?: boolean;
  showDot?: boolean;
}

function QuickAction({ icon, label, sublabel, onPress, badge, badgeColor, locked, showDot }: QuickActionProps) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-white rounded-2xl p-4 border border-gray-100 flex-row items-center mb-3"
    >
      <View className="w-10 h-10 bg-forest/10 rounded-xl items-center justify-center mr-3">
        {icon}
      </View>
      <View className="flex-1">
        <Text className="text-gray-900 font-medium">{label}</Text>
        {sublabel && <Text className="text-gray-500 text-sm">{sublabel}</Text>}
      </View>
      {badge && (
        <View
          className="px-2 py-1 rounded-full mr-2"
          style={{ backgroundColor: badgeColor || '#dcfce7' }}
        >
          <Text className="text-xs font-medium" style={{ color: badgeColor ? '#fff' : '#16a34a' }}>
            {badge}
          </Text>
        </View>
      )}
      {showDot && (
        <View style={{ ...redDotStyle, marginRight: 6 }} />
      )}
      {locked ? <Lock size={18} color="#9ca3af" /> : <ChevronRight size={18} color="#9ca3af" />}
    </Pressable>
  );
}

export default function MyFarmstandScreen() {
  const router = useRouter();
  const { id: routeFarmstandId } = useLocalSearchParams<{ id?: string }>();
  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);

  // Get auth session from AuthProvider for reliable session state
  const { session: authSession, loading: authLoading } = useAuth();

  // Get safe area insets for floating back button positioning
  const insets = useSafeAreaInsets();

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const refreshSingleFarmstand = useAdminStore((s) => s.refreshSingleFarmstand);
  const ownerDeleteFarmstand = useAdminStore((s) => s.ownerDeleteFarmstand);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  const claimRequests = useAdminStore((s) => s.claimRequests);
  const isLoading = useAdminStore((s) => s.isLoading);

  const [isPremiumActive, setIsPremiumActive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('manage');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [showFarmstandManager, setShowFarmstandManager] = useState(false);
  const [showStockAlertModal, setShowStockAlertModal] = useState(false);
  const [isSendingStockAlert, setIsSendingStockAlert] = useState(false);
  const [sendingAlertType, setSendingAlertType] = useState<'in_stock' | 'out_of_stock' | null>(null);
  const [stockAlertCooldownUntil, setStockAlertCooldownUntil] = useState<number>(0);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Supabase-sourced pending claims (source of truth)
  const [supabasePendingClaims, setSupabasePendingClaims] = useState<Array<{
    id: string;
    farmstand_id: string;
    status: string;
    created_at: string;
    farmstand?: {
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      photos: string[];
    };
  }>>([]);
  const [isLoadingClaims, setIsLoadingClaims] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const isGuestUser = isGuest();

  // Get preloaded farmstands from bootstrap store (source of truth for owned farmstands)
  const bootstrapFarmstands = useBootstrapStore(selectUserFarmstands);
  const appReady = useBootstrapStore(selectAppReady);
  const userFarmstandsLoading = useBootstrapStore(selectUserFarmstandsLoading);
  const userFarmstandsStatus = useBootstrapStore(selectUserFarmstandsStatus);
  const refreshUserFarmstands = useBootstrapStore((s) => s.refreshUserFarmstands);

  // Track whether we have kicked off a refresh on this screen mount
  const hasFetchedRef = useRef(false);
  // Track whether a screen-level refresh is in progress
  const [isRefetchingOwnership, setIsRefetchingOwnership] = useState(false);
  // Track if the initial fetch was blocked by the in-flight guard and needs retry
  const needsRetryRef = useRef(false);

  // On mount / when auth becomes ready: refresh ownership from the server.
  // CRITICAL: We must wait until authLoading is false AND user.id is available
  // before querying farmstands. Firing before the session is restored causes
  // getValidSession() to return null → empty results → infinite spinner or
  // premature "No Farmstand" empty state.
  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) return;
    // If guest or already fetched, skip
    if (isGuestUser || hasFetchedRef.current) return;
    // Must have a real user ID to query farmstands
    if (!authSession && !user?.id) {
      // Auth is done loading but no session — user is logged out; let the
      // isLoggedIn effect handle the redirect. Don't spin forever.
      console.log('[MyFarmstand] Auth resolved with no session — not fetching farmstands');
      setIsRefetchingOwnership(false);
      return;
    }
    hasFetchedRef.current = true;

    const doRefresh = async () => {
      const state = useBootstrapStore.getState();
      // STEP 4: Farmstand query starts
      console.log('[DEBUG][Step 4] Farmstand query starts — user:', user?.id, '| routeId:', routeFarmstandId, '| status:', state.userFarmstandsStatus);

      // If a refresh is already in-flight (e.g. from bootstrap or profile's useFocusEffect),
      // do NOT kick off another one — it would be silently dropped by the in-flight guard.
      // Mark needsRetryRef=true so the store-status effect below retries once it's done.
      if (isRefreshInFlight() || state.userFarmstandsStatus === 'loading') {
        console.log('[MyFarmstand] Mount — refresh already in-flight, will retry when store status resolves');
        console.log('[DEBUG][Step 4] Query blocked — refresh already in-flight, needsRetry=true');
        needsRetryRef.current = true;
        setIsRefetchingOwnership(false);
        return;
      }

      setIsRefetchingOwnership(true);
      try {
        // Pass the AuthProvider token so the fetch bypasses getValidSession() on cold launch
        await refreshUserFarmstands(authSession?.access_token ?? undefined);
        const after = useBootstrapStore.getState();
        // STEP 5: Farmstand query resolves
        console.log('[DEBUG][Step 5] Farmstand query resolves — farmstands:', after.userFarmstands.length, '| ids:', after.userFarmstands.map((f) => f.id).join(', ') || 'none', '| status:', after.userFarmstandsStatus);
        console.log('[MyFarmstand] Mount refresh complete — farmstands:', after.userFarmstands.length);
      } catch (err) {
        console.log('[MyFarmstand] Mount refresh error:', err);
        console.log('[DEBUG][Step 5] Farmstand query ERROR:', String(err));
      } finally {
        setIsRefetchingOwnership(false);
      }
    };

    // If the bootstrap store already has a completed fetch with data that matches
    // our route ID, we can skip the re-fetch for snappier UX.
    const state = useBootstrapStore.getState();
    const alreadyHasThisFarmstand = routeFarmstandId
      ? state.userFarmstands.some((f) => f.id === routeFarmstandId)
      : state.userFarmstands.length > 0;
    const alreadyLoaded = state.userFarmstandsStatus === 'loaded';

    if (alreadyLoaded && alreadyHasThisFarmstand) {
      console.log('[MyFarmstand] Mount — data already loaded and farmstand present, skipping re-fetch');
      setIsRefetchingOwnership(false);
    } else {
      doRefresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, authSession]);

  // Retry effect: when the bootstrap store transitions out of 'loading'/'idle' state and
  // our initial fetch was blocked by the in-flight guard (needsRetryRef=true),
  // kick off a fresh fetch now that the guard has cleared.
  // Also fires when status is 'idle' (bootstrap skipped due to no valid session at boot time).
  useEffect(() => {
    // Always retry when status is 'idle' and auth is ready — bootstrap didn't fetch
    const shouldRetryIdle = userFarmstandsStatus === 'idle' && !authLoading && !isGuestUser && !isRefetchingOwnership && !!authSession;
    const shouldRetryBlocked = needsRetryRef.current && !authLoading && !isGuestUser && userFarmstandsStatus !== 'loading' && !isRefetchingOwnership;

    if (!shouldRetryIdle && !shouldRetryBlocked) return;

    needsRetryRef.current = false;
    const state = useBootstrapStore.getState();
    const alreadyHasThisFarmstand = routeFarmstandId
      ? state.userFarmstands.some((f) => f.id === routeFarmstandId)
      : state.userFarmstands.length > 0;

    if (alreadyHasThisFarmstand && !shouldRetryIdle) {
      // Bootstrap fetched the data for us — nothing more to do
      console.log('[MyFarmstand] Retry check — bootstrap already has farmstand data, skipping retry');
      return;
    }

    // Bootstrap finished but returned 0 farmstands (likely because getValidSession was null
    // at bootstrap time). Now that auth is ready, retry with a valid session.
    console.log('[MyFarmstand] Retry — farmstandsStatus:', userFarmstandsStatus, '| retrying with valid session token');
    setIsRefetchingOwnership(true);
    refreshUserFarmstands(authSession?.access_token ?? undefined)
      .catch((err) => {
        console.log('[MyFarmstand] Retry refresh error:', err);
      })
      .finally(() => {
        setIsRefetchingOwnership(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFarmstandsStatus, authLoading, isRefetchingOwnership, authSession]);

  // Safety timeout: if loading stalls, force unblock.
  // IMPORTANT: loadingTimedOut is a one-way latch. Once it fires it stays true for
  // the lifetime of this screen mount. We use a ref to prevent the timeout effect's
  // else-branch from resetting it and recreating the infinite spinner.
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const loadingTimedOutRef = useRef(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Once the latch has fired, do not re-arm or reset it.
    // This prevents the else-branch from clearing loadingTimedOut when transient state
    // changes (e.g. isRefetchingOwnership → false) fire the effect again after timeout.
    if (loadingTimedOutRef.current) return;

    const stillLoading = authLoading || isRefetchingOwnership || !appReady ||
      (appReady && (userFarmstandsLoading || userFarmstandsStatus === 'loading'));

    if (stillLoading) {
      // Clear any existing pending timeout before scheduling a new one
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = setTimeout(() => {
        if (loadingTimedOutRef.current) return; // Double-guard: don't fire twice
        console.log('[MyFarmstand] Loading timeout reached — forcing unblock');
        loadingTimedOutRef.current = true;
        setLoadingTimedOut(true);
        setIsRefetchingOwnership(false);
      }, 4000); // 4s — more forgiving on slow networks while still protecting against infinite spin
    } else {
      // Everything loaded successfully — cancel any pending timeout (no latch needed)
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }
    return () => {
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    };
  }, [authLoading, appReady, userFarmstandsLoading, userFarmstandsStatus, isRefetchingOwnership]);

  // Fetch pending claims from Supabase (source of truth)
  const fetchPendingClaimsFromSupabase = useCallback(async () => {
    if (!user?.id || !isSupabaseConfigured()) {
      setIsLoadingClaims(false);
      return;
    }

    const netState = await NetInfo.fetch();
    if (netState.isConnected === false) {
      setSupabasePendingClaims([]);
      setIsOffline(true);
      setIsLoadingClaims(false);
      return;
    }
    setIsOffline(false);

    try {
      // Fetch user's pending claim requests with farmstand info
      const { data, error } = await supabase
        .from<Record<string, unknown>>('claim_requests')
        .requireAuth()
        .select('id, farmstand_id, status, created_at')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .execute();

      if (error) {
        console.log('[MyFarmstand] Error fetching claim requests (table may not exist):', error.message);
        setIsLoadingClaims(false);
        return;
      }

      if (data && data.length > 0) {
        // Fetch farmstand details for each claim
        const farmstandIds = data.map((c: Record<string, unknown>) => c.farmstand_id as string);
        const { data: farmstandsData } = await supabase
          .from<Record<string, unknown>>('farmstands')
          .select('id, name, city, state, photos')
          .in('id', farmstandIds)
          .execute();

        const farmstandsMap = new Map(
          (farmstandsData || []).map((f: Record<string, unknown>) => [f.id as string, f])
        );

        const claimsWithFarmstands = data.map((claim: Record<string, unknown>) => ({
          id: claim.id as string,
          farmstand_id: claim.farmstand_id as string,
          status: claim.status as string,
          created_at: claim.created_at as string,
          farmstand: farmstandsMap.get(claim.farmstand_id as string) as {
            id: string;
            name: string;
            city: string | null;
            state: string | null;
            photos: string[];
          } | undefined,
        }));

        console.log('[MyFarmstand] Fetched', claimsWithFarmstands.length, 'pending claims from Supabase');
        setSupabasePendingClaims(claimsWithFarmstands);
      } else {
        setSupabasePendingClaims([]);
      }
      setIsLoadingClaims(false);
    } catch (err) {
      console.error('[MyFarmstand] Error fetching pending claims:', err);
      setIsLoadingClaims(false);
    }
  }, [user?.id]);

  // State for selected farmstand when user has multiple (can be overridden by route param)
  const [selectedFarmstandId, setSelectedFarmstandId] = useState<string | null>(routeFarmstandId || null);

  // Update selected farmstand when route param changes
  useEffect(() => {
    if (routeFarmstandId) {
      setSelectedFarmstandId(routeFarmstandId);
    }
  }, [routeFarmstandId]);

  // Find ALL user's farmstands - support multiple ownership
  // AUTHORITATIVE: Bootstrap store queries farmstand_owners table exclusively.
  // The admin-store fallback is intentionally removed — it used owner_id/claimed_by
  // which are NOT cleared on claim denial, causing stale ownership UI.
  const userFarmstands: Farmstand[] = useMemo(() => {
    if (!user?.id) return [];

    // Bootstrap store is the authoritative source (queries farmstand_owners)
    return bootstrapFarmstands;
  }, [user?.id, bootstrapFarmstands]);

  // Currently selected farmstand (for management)
  const userFarmstand: Farmstand | undefined = useMemo(() => {
    if (userFarmstands.length === 0) return undefined;
    // If a specific one is selected, use it
    if (selectedFarmstandId) {
      return userFarmstands.find((f) => f.id === selectedFarmstandId);
    }
    // Default to first farmstand
    return userFarmstands[0];
  }, [userFarmstands, selectedFarmstandId]);

  // Unread review indicator — true when farmstand has reviews newer than last viewed
  const hasUnreadReviews = useReviewUnread(userFarmstand?.id);

  // Check for ALL pending claim requests for this user
  // SOURCE OF TRUTH: Supabase claim_requests table, with local store as fallback
  const pendingClaimRequests = useMemo(() => {
    if (!user?.id) return [];
    // Prefer Supabase data if available
    if (supabasePendingClaims.length > 0) {
      return supabasePendingClaims.map((c) => ({
        id: c.id,
        farmstand_id: c.farmstand_id,
        requester_id: user.id,
        requester_name: user.name || '',
        requester_email: user.email || '',
        status: c.status as 'pending',
        reviewed_at: null,
        reviewed_by: null,
        created_at: c.created_at,
      }));
    }
    // Fallback to local store
    return claimRequests.filter(
      (r) => r.requester_id === user.id && r.status === 'pending'
    );
  }, [supabasePendingClaims, claimRequests, user?.id]);

  // Get farmstands for pending claims (to show info)
  const pendingFarmstands = useMemo(() => {
    // Use Supabase data if available (includes farmstand info)
    if (supabasePendingClaims.length > 0) {
      return supabasePendingClaims
        .filter((c) => c.farmstand)
        .map((c) => ({
          request: {
            id: c.id,
            farmstand_id: c.farmstand_id,
            requester_id: user?.id || '',
            requester_name: user?.name || '',
            requester_email: user?.email || '',
            status: c.status as 'pending',
            reviewed_at: null,
            reviewed_by: null,
            created_at: c.created_at,
          },
          farmstand: {
            id: c.farmstand!.id,
            name: c.farmstand!.name,
            city: c.farmstand!.city,
            state: c.farmstand!.state,
            photos: c.farmstand!.photos || [],
          } as Partial<Farmstand>,
        }));
    }
    // Fallback to local data
    return pendingClaimRequests.map((req) => ({
      request: req,
      farmstand: allFarmstands.find((f) => f.id === req.farmstand_id),
    })).filter((p) => p.farmstand !== undefined);
  }, [supabasePendingClaims, pendingClaimRequests, allFarmstands, user]);

  const hasClaimedFarmstands = userFarmstands.length > 0;
  const hasMultipleFarmstands = userFarmstands.length > 1;
  const hasPendingClaims = pendingClaimRequests.length > 0 || supabasePendingClaims.length > 0;

  // Determine if user is the owner (can manage)
  const isOwner = useMemo(() => {
    if (!userFarmstand || !user?.id) return false;
    return userFarmstand.ownerUserId === user.id && userFarmstand.claimStatus === 'claimed';
  }, [userFarmstand, user?.id]);

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login');
    }
  }, [isLoggedIn]);

  // Diagnostic log on mount
  useEffect(() => {
    const state = useBootstrapStore.getState();
    // STEP 3: Farmstand manager screen mounts
    console.log('[DEBUG][Step 3] Farmstand manager screen mounted — routeId:', routeFarmstandId, '| appReady:', state.appReady, '| userFarmstandsStatus:', state.userFarmstandsStatus, '| farmstands:', state.userFarmstands.length, '| user:', user?.id ?? 'none');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isGuestUser) {
      // Gate pending claims fetch behind auth being ready
      if (!authLoading) {
        loadAdminData();
        fetchPendingClaimsFromSupabase();
      }
    }
  }, [isGuestUser, authLoading, fetchPendingClaimsFromSupabase]);

  // Check RevenueCat premium entitlement
  useEffect(() => {
    if (!isRevenueCatReady()) return;
    Purchases.getCustomerInfo()
      .then((info) => {
        const active = !!info.entitlements.active['pro'];
        setIsPremiumActive(active);
      })
      .catch((e) => {
        console.log('[MyFarmstand] RevenueCat getCustomerInfo failed (non-fatal):', e);
      });
  }, [user?.id]);

  // Refresh farmstand data when screen gains focus (e.g., after editing or returning from admin approval)
  useFocusEffect(
    useCallback(() => {
      trackEvent('my_farmstand_opened', {
        farmstand_id: userFarmstand?.id ?? null,
        farmstand_name: userFarmstand?.name ?? null,
      });
      if (!isGuestUser && !authLoading) {
        // Refresh pending claims from Supabase
        fetchPendingClaimsFromSupabase();
        // Refresh farmstand data if user has one
        if (userFarmstand?.id) {
          refreshSingleFarmstand(userFarmstand.id);
        }
        // Re-fetch ownership in case it changed (e.g. admin approved while screen was open)
        // Only re-fetch if ownership status is stale (not currently loading)
        const state = useBootstrapStore.getState();
        if (state.userFarmstandsStatus === 'loaded' && !isRefetchingOwnership) {
          console.log('[MyFarmstand] Focus — refreshing ownership from Supabase');
          refreshUserFarmstands(authSession?.access_token ?? undefined).catch((err) => {
            console.log('[MyFarmstand] Focus refresh error:', err);
          });
        }
      }
    }, [isGuestUser, authLoading, userFarmstand?.id, refreshSingleFarmstand, fetchPendingClaimsFromSupabase, isRefetchingOwnership, refreshUserFarmstands])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      loadAdminData(),
      fetchPendingClaimsFromSupabase(),
      refreshUserFarmstands(),
    ]);
    setRefreshing(false);
  };

  // Show guard for guests - AFTER all hooks
  if (isGuestUser) {
    return <FarmerRouteGuard title="My Farmstand" />;
  }

  // Show loading spinner while:
  // 1. Auth session is still being restored (authLoading), OR
  // 2. Bootstrap hasn't finished (app still starting up), OR
  // 3. We are actively re-fetching ownership on this screen mount and have no data yet, OR
  // 4. The bootstrap store itself is mid-fetch (e.g. Profile's useFocusEffect fired first)
  //    and the in-flight guard blocked our own call — we still need to wait for the result.
  // Never spin forever — loadingTimedOut unblocks after 4s regardless (one-way latch).
  // IMPORTANT: If auth finished loading but there is no session/user, do NOT spin —
  // fall through to the empty state or redirect to login.
  const authStillLoading = authLoading && !loadingTimedOut;
  // ownershipFetchPending: show spinner if:
  //   - actively refetching (isRefetchingOwnership=true), OR
  //   - status is 'loading' (bootstrap or explicit refresh in flight), OR
  //   - status is 'idle' AND auth is ready with a session (retry effect is about to fire)
  // ...AND we have no data to show yet AND status is not definitively 'loaded'.
  // Never show spinner if status is 'loaded' (authoritative result is available).
  const ownershipFetchPending = (isRefetchingOwnership || userFarmstandsStatus === 'loading' || (userFarmstandsStatus === 'idle' && !authLoading && !!authSession)) &&
    bootstrapFarmstands.length === 0 &&
    userFarmstandsStatus !== 'loaded';
  // bootstrapStillRunning: only block on appReady=false if we also have no data yet
  // AND the status isn't already resolved. This prevents !appReady from trapping the
  // screen when the bootstrap store already has a valid 'loaded' status with data.
  const bootstrapStillRunning = !appReady && !loadingTimedOut && bootstrapFarmstands.length === 0 && userFarmstandsStatus !== 'loaded';
  const shouldShowLoadingSpinner = (authStillLoading || bootstrapStillRunning || ownershipFetchPending) && !loadingTimedOut;

  if (shouldShowLoadingSpinner) {
    console.log('[MyFarmstand] Showing loading spinner — authLoading:', authLoading, '| appReady:', appReady, '| isRefetchingOwnership:', isRefetchingOwnership, '| bootstrapFarmstands:', bootstrapFarmstands.length);
    return (
      <View className="flex-1 bg-cream items-center justify-center px-8">
        <ActivityIndicator size="large" color="#2D5A3D" />
        <Text className="text-stone-500 text-sm mt-3 text-center">Loading your farmstand...</Text>
      </View>
    );
  }

  // Timeout fallback: the 4s latch fired and we still have no data.
  // Show a friendly retry state instead of an empty or broken screen.
  if (loadingTimedOut && bootstrapFarmstands.length === 0 && userFarmstandsStatus !== 'loaded' && !hasPendingClaims) {
    console.log('[MyFarmstand] Showing timeout retry state — timed out with no data');
    const handleRetry = async () => {
      loadingTimedOutRef.current = false;
      setLoadingTimedOut(false);
      hasFetchedRef.current = false;
      needsRetryRef.current = false;
      setIsRefetchingOwnership(true);
      try {
        await refreshUserFarmstands(authSession?.access_token ?? undefined);
      } catch (err) {
        console.log('[MyFarmstand] Retry after timeout error:', err);
      } finally {
        setIsRefetchingOwnership(false);
      }
    };
    return (
      <View className="flex-1 bg-cream items-center justify-center px-8">
        <View style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: '#F0FDF4',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}>
          <RefreshCw size={28} color="#2D5A3D" />
        </View>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1A1A1A', textAlign: 'center', marginBottom: 8 }}>
          Trouble loading your farmstand
        </Text>
        <Text style={{ fontSize: 14, color: '#8A8A8A', textAlign: 'center', marginBottom: 28, lineHeight: 20 }}>
          We're having trouble connecting. Check your internet connection and tap to retry.
        </Text>
        <Pressable
          onPress={handleRetry}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#245030' : '#2D5A3D',
            borderRadius: 14,
            paddingHorizontal: 32,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          })}
        >
          <RefreshCw size={16} color="white" />
          <Text style={{ color: 'white', fontSize: 15, fontWeight: '700' }}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  // Pending claim request state - show waiting message (only if no claimed farmstands)
  if (hasPendingClaims && !hasClaimedFarmstands) {
    const firstPending = pendingFarmstands[0];
    const pendingFarmstand = firstPending?.farmstand;
    const pendingRequest = firstPending?.request;
    return (
      <View className="flex-1" style={{ backgroundColor: '#FAF7F2' }}>
        {/* Airy farmstand hero with white fog fade */}
        <View style={{ height: 260 }}>
          <ImageBackground
            source={pendingFarmstand?.photos?.[0] ? { uri: pendingFarmstand.photos[0] } : fallbackHero}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          >
            {/* White fog gradient fade at bottom */}
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

          {/* Header bar */}
          <SafeAreaView
            edges={['top']}
            style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
          >
            <View className="px-5">
              <View className="flex-row items-center pt-2">
                <Pressable onPress={() => router.back()} className="p-2 -ml-2">
                  <ArrowLeft size={24} color="#1C1917" />
                </Pressable>
                <Text className="text-xl font-bold ml-2" style={{ color: '#1C1917' }}>
                  My Farmstand
                </Text>
              </View>
            </View>
          </SafeAreaView>
        </View>

        {/* Name + subtitle below hero */}
        <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1C1917', letterSpacing: -0.3 }}>
            {user?.name || 'User'}
          </Text>
          <Text style={{ fontSize: 14, color: '#57534E', marginTop: 3 }}>
            {pendingClaimRequests.length > 1 ? `${pendingClaimRequests.length} Claims Pending` : 'Claim Pending Review'}
          </Text>
        </View>

        {/* Pending claim content card */}
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
          {pendingFarmstands.map(({ request, farmstand }) => (
            <View key={request.id} className="px-5 mt-4">
              <View
                style={{
                  backgroundColor: '#FFFBEB',
                  borderRadius: 22,
                  padding: 24,
                  borderWidth: 1,
                  borderColor: '#FCD34D',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.06,
                  shadowRadius: 12,
                  elevation: 4,
                }}
              >
                <View className="items-center">
                  <View className="bg-amber-100 p-4 rounded-full mb-4">
                    <Clock size={40} color="#D97706" />
                  </View>
                  <Text className="text-xl font-bold text-center mb-2" style={{ color: '#92400E' }}>
                    Claim Request Pending
                  </Text>
                  <Text className="text-center mb-4" style={{ color: '#B45309' }}>
                    Your claim for "{farmstand?.name || 'this farmstand'}" is being reviewed by our team.
                  </Text>
                  <View className="bg-amber-50 rounded-xl p-4 w-full">
                    <View className="flex-row items-center mb-2">
                      <AlertCircle size={16} color="#D97706" />
                      <Text className="text-amber-800 font-medium ml-2">What happens next?</Text>
                    </View>
                    <Text className="text-amber-700 text-sm leading-5">
                      We'll review your submitted evidence and notify you at {request.requester_email || 'your email'} once approved. This usually takes 1-2 business days.
                    </Text>
                  </View>
                </View>
                {/* View Farmstand Button */}
                {farmstand && (
                  <Pressable
                    onPress={() => router.push(`/farm/${farmstand.id}`)}
                    className="py-4 rounded-xl flex-row items-center justify-center mt-4"
                    style={{ backgroundColor: '#F5F5F4' }}
                  >
                    <Eye size={18} color="#44403C" />
                    <Text className="font-semibold ml-2" style={{ color: '#44403C' }}>
                      View Farmstand Listing
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // No farmstand - show empty state with farmstand hero (fog fade design)
  if (!hasClaimedFarmstands) {
    return (
      <View className="flex-1" style={{ backgroundColor: '#FAF7F2' }}>
        {/* Airy farmstand hero with white fog fade */}
        <View style={{ height: 260 }}>
          <ImageBackground
            source={fallbackHero}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          >
            {/* White fog gradient fade at bottom */}
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

          {/* Header bar */}
          <SafeAreaView
            edges={['top']}
            style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
          >
            <View className="px-5">
              <View className="flex-row items-center pt-2">
                <Pressable onPress={() => router.back()} className="p-2 -ml-2">
                  <ArrowLeft size={24} color="#1C1917" />
                </Pressable>
                <Text className="text-xl font-bold ml-2" style={{ color: '#1C1917' }}>
                  My Farmstand
                </Text>
              </View>
            </View>
          </SafeAreaView>
        </View>

        {/* Name + subtitle below hero */}
        <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1C1917', letterSpacing: -0.3 }}>
            {user?.name || 'User'}
          </Text>
          <Text style={{ fontSize: 14, color: '#57534E', marginTop: 3 }}>
            New Farmstand Manager
          </Text>
        </View>

        {/* Content card below hero */}
        <View className="px-5 -mt-2">
          <View
            style={{
              backgroundColor: '#FFFCF9',
              borderRadius: 22,
              padding: 24,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.06,
              shadowRadius: 12,
              elevation: 4,
            }}
          >
            <View className="items-center">
              <View className="bg-amber-50 p-4 rounded-full mb-4">
                <Store size={40} color="#D97706" />
              </View>
              <Text className="text-xl font-bold text-center mb-2" style={{ color: '#1C1917' }}>
                No Farmstand Connected
              </Text>
              <Text className="text-center mb-6" style={{ color: '#78716C' }}>
                Claim your farmstand to manage your listing, products, and availability.
              </Text>
              <View className="w-full" style={{ gap: 12 }}>
                <Pressable
                  onPress={() => router.push('/farmer/onboarding')}
                  className="px-6 py-3.5 rounded-xl w-full"
                  style={{ backgroundColor: '#2D5A3D' }}
                >
                  <Text className="text-white font-semibold text-center">Add a Farmstand</Text>
                </Pressable>
                <Pressable
                  onPress={() => router.push('/(tabs)/map')}
                  className="px-6 py-3.5 rounded-xl w-full"
                  style={{ backgroundColor: '#F5F5F4' }}
                >
                  <Text className="font-semibold text-center" style={{ color: '#44403C' }}>
                    Claim a Farmstand
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // Safety check - userFarmstand should be defined if we got here.
  // If it's still undefined after ownership fetch is done, fall through to the
  // "No Farmstand" state rather than spinning forever.
  if (!userFarmstand) {
    // If the bootstrap store is in 'loaded' state with zero farmstands, the user
    // just deleted their last farmstand — navigate to Profile immediately instead
    // of showing a confusing retry screen.
    if (userFarmstandsStatus === 'loaded' && userFarmstands.length === 0) {
      router.replace('/(tabs)/profile');
      return null;
    }
    // If we're still fetching (either this screen or the bootstrap store itself), show a brief spinner (timeout will unblock it)
    if ((isRefetchingOwnership || userFarmstandsStatus === 'loading') && !loadingTimedOut) {
      return (
        <View className="flex-1 bg-cream items-center justify-center">
          <ActivityIndicator size="large" color="#2D5A3D" />
          <Text className="text-stone-500 text-sm mt-3">Loading your farmstand...</Text>
        </View>
      );
    }
    // Fetch done but no farmstand found — show a retry/empty state, never hang
    return (
      <View className="flex-1 bg-cream items-center justify-center px-8">
        <View className="bg-white rounded-2xl p-6 items-center" style={{ shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 }}>
          <RefreshCw size={36} color="#A8A29E" />
          <Text className="text-stone-700 font-semibold text-base mt-4 text-center">
            Couldn't load farmstand
          </Text>
          <Text className="text-stone-400 text-sm mt-2 text-center">
            Your farmstand data may still be loading. Pull to refresh or tap retry.
          </Text>
          <Pressable
            onPress={async () => {
              console.log('[MyFarmstand] Manual retry — refreshing ownership');
              setIsRefetchingOwnership(true);
              try {
                await refreshUserFarmstands();
              } finally {
                setIsRefetchingOwnership(false);
              }
            }}
            className="mt-5 px-6 py-3 rounded-xl"
            style={{ backgroundColor: '#2D5A3D' }}
          >
            <Text className="text-white font-semibold">Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Now TypeScript knows userFarmstand is defined
  const currentFarmstand = userFarmstand;
  const mainPhoto = currentFarmstand.photos[currentFarmstand.mainPhotoIndex] || currentFarmstand.photos[0];
  const heroImage = mainPhoto || null;

  // Single shared premium check used for all owner tools
  const hasPremium = isPremiumActive ||
    currentFarmstand.premiumStatus === 'trial' ||
    currentFarmstand.premiumStatus === 'active';

  const handlePremiumUpsell = () => {
    trackEvent('locked_premium_feature_tapped', { farmstand_id: currentFarmstand.id, farmstand_name: currentFarmstand.name });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/owner/premium-onboarding?farmstandId=${currentFarmstand.id}`);
  };

  const handleShareListing = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const shareSlug = currentFarmstand.slug ?? currentFarmstand.id;
    const shareUrl = `https://links.farmstand.online/farmstand/${shareSlug}`;
    try {
      await Share.share({
        message: `Check out ${currentFarmstand.name} on the Farmstand app 🌱 ${shareUrl}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const handleViewAsGuest = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/farm/${currentFarmstand.id}`);
  };

  const handleSendStockAlert = async (alertType: 'in_stock' | 'out_of_stock') => {
    if (!currentFarmstand?.id) return;
    setIsSendingStockAlert(true);
    setSendingAlertType(alertType);
    try {
      const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
      let token: string | null = null;
      if (authSession?.access_token) {
        token = authSession.access_token;
      } else {
        const session = await ensureSessionReady();
        token = session?.access_token ?? null;
      }
      if (!token) {
        showToast('Please sign in to continue', 'error');
        setShowStockAlertModal(false);
        return;
      }
      const resp = await fetch(`${backendUrl}/api/manual-stock-alert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ farmstand_id: currentFarmstand.id, alert_type: alertType }),
      });
      const mfct = resp.headers.get('content-type') ?? '';
      if (!mfct.includes('application/json')) {
        console.log('[MyFarmstand] manual-stock-alert non-JSON response (HTTP', resp.status, '), content-type:', mfct);
        showToast('Unexpected response from server', 'error');
        return;
      }
      const data = (await resp.json()) as {
        success: boolean;
        sent?: number;
        usersFound?: number;
        tokensFound?: number;
        pushesSent?: number;
        pushesFailed?: number;
        reason?: string;
        error?: string;
      };
      setShowStockAlertModal(false);
      if (resp.status === 429) {
        showToast(data.error || 'Please wait before sending again', 'error');
      } else if (data.success && (data.usersFound === 0 || data.reason === 'no_saved_users')) {
        showToast('No saved customers to notify yet', 'error');
      } else if (data.success && data.reason === 'no_push_tokens') {
        showToast('No saved customers to notify yet', 'error');
      } else if (data.success) {
        trackEvent('stock_alert_sent', { farmstand_id: currentFarmstand.id, farmstand_name: currentFarmstand.name, alert_type: alertType });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Stock alert sent', 'success');
        // 30-second client-side cooldown after a successful send
        setStockAlertCooldownUntil(Date.now() + 30_000);
      } else {
        showToast(data.error || 'Failed to send alert', 'error');
      }
    } catch {
      setShowStockAlertModal(false);
      showToast('Failed to send alert', 'error');
    } finally {
      setIsSendingStockAlert(false);
      setSendingAlertType(null);
    }
  };

  const handleDeleteFarmstand = async () => {
    if (!user?.id || !currentFarmstand?.id) return;

    // STEP 6: Delete button tapped
    console.log('[DEBUG][Step 6] Delete button tapped — farmstandId:', currentFarmstand.id, '| userId:', user.id);

    setIsDeleting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // CRITICAL FIX: Check AuthProvider session first (most reliable in production builds)
    // Fall back to ensureSessionReady for race conditions
    let session = authSession;
    if (!session) {
      console.log('[MyFarmstand] No session from AuthProvider, trying ensureSessionReady...');
      session = await ensureSessionReady();
    }

    if (!session) {
      setIsDeleting(false);
      setShowDeleteModal(false);
      showToast('Please sign in to continue', 'error');
      console.log('[MyFarmstand] Delete failed: No valid session found');
      return;
    }

    // STEP 7: Delete request starts
    console.log('[DEBUG][Step 7] Delete request starts — farmstandId:', currentFarmstand.id);
    console.log('[MyFarmstand] Session verified, proceeding with delete');
    const result = await ownerDeleteFarmstand(currentFarmstand.id, user.id);

    // STEP 8: Delete request succeeds or fails
    if (result.success) {
      console.log('[DEBUG][Step 8] Delete request SUCCEEDED — farmstandId:', currentFarmstand.id);
    } else {
      console.log('[DEBUG][Step 8] Delete request FAILED — error:', result.error);
    }

    setIsDeleting(false);
    setShowDeleteModal(false);

    if (result.success) {
      // STEP 9: Local farmstand state cleared (done inside ownerDeleteFarmstand via purgeDeletedFarmstandFromBootstrap)
      const afterPurge = useBootstrapStore.getState();
      console.log('[DEBUG][Step 9] Local farmstand state cleared — bootstrapFarmstands:', afterPurge.userFarmstands.length, '| status:', afterPurge.userFarmstandsStatus);

      // STEP 10: Queries invalidated (purgeDeletedFarmstandFromBootstrap already ran inside ownerDeleteFarmstand)
      console.log('[DEBUG][Step 10] Queries invalidated (bootstrap purge complete)');

      // STEP 11: Navigation to Profile fired
      console.log('[DEBUG][Step 11] Navigation back to Profile fired');

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigate immediately — ownerDeleteFarmstand already called purgeDeletedFarmstandFromBootstrap
      // which set userFarmstandsStatus='loaded' and userFarmstands=[].
      // Do NOT kick off a background refreshUserFarmstands here — it would set status='loading'
      // and block Profile's useFocusEffect from running its own refresh (in-flight guard).
      // Profile will call refreshUserFarmstands() in its useFocusEffect when it mounts.
      router.replace('/(tabs)/profile');
    } else if (result.error === 'Farmstand not found') {
      // Already deleted (e.g. by admin) — navigate to Profile, Profile will refresh on focus
      console.log('[MyFarmstand] Farmstand not found — already deleted, navigating to profile silently');
      console.log('[DEBUG][Step 8b] Farmstand already deleted — cleaning up and navigating');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)/profile');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast(result.error || 'Failed to delete farmstand', 'error');
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: '#FAF7F2' }}>
      {/* Toast notification */}
      {toastMessage && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          className={`absolute top-16 left-5 right-5 z-50 rounded-2xl px-5 py-4 flex-row items-center ${
            toastMessage.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 8,
          }}
        >
          {toastMessage.type === 'success' ? (
            <Check size={20} color="white" />
          ) : (
            <AlertCircle size={20} color="white" />
          )}
          <Text className="text-white font-medium ml-3 flex-1">{toastMessage.text}</Text>
        </Animated.View>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View
            className="mx-6 rounded-2xl p-6"
            style={{
              backgroundColor: '#FFFFFF',
              width: '85%',
              maxWidth: 340,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 10,
            }}
          >
            <View className="items-center mb-4">
              <View className="w-14 h-14 rounded-full items-center justify-center mb-3" style={{ backgroundColor: '#FEE2E2' }}>
                <Trash2 size={28} color="#DC2626" />
              </View>
              <Text className="text-xl font-bold text-center" style={{ color: '#1C1917' }}>
                Delete Farmstand?
              </Text>
              <Text className="text-center mt-2" style={{ color: '#78716C' }}>
                This will remove it from the map and search. You can't undo this.
              </Text>
            </View>

            <View style={{ gap: 12 }}>
              <Pressable
                onPress={handleDeleteFarmstand}
                disabled={isDeleting}
                className="py-3.5 rounded-xl items-center justify-center"
                style={{ backgroundColor: '#DC2626', opacity: isDeleting ? 0.6 : 1 }}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="text-white font-semibold">Delete</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="py-3.5 rounded-xl items-center justify-center"
                style={{ backgroundColor: '#F5F5F4' }}
              >
                <Text className="font-semibold" style={{ color: '#44403C' }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Stock Alert Confirmation Modal */}
      <Modal
        visible={showStockAlertModal}
        transparent
        animationType="fade"
        onRequestClose={() => !isSendingStockAlert && setShowStockAlertModal(false)}
      >
        <View className="flex-1 justify-center items-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View
            className="mx-6 rounded-2xl p-6"
            style={{
              backgroundColor: '#FFFFFF',
              width: '85%',
              maxWidth: 340,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 10,
            }}
          >
            <View className="items-center mb-4">
              <View className="w-14 h-14 rounded-full items-center justify-center mb-3" style={{ backgroundColor: '#DCFCE7' }}>
                <Bell size={28} color="#2D5A3D" />
              </View>
              <Text className="text-xl font-bold text-center" style={{ color: '#1C1917' }}>
                Send stock update?
              </Text>
              <Text className="text-center mt-2" style={{ color: '#78716C' }}>
                Notify everyone who saved your farmstand about your current stock status.
              </Text>
            </View>

            <View style={{ gap: 12 }}>
              <Pressable
                onPress={() => handleSendStockAlert('in_stock')}
                disabled={isSendingStockAlert}
                className="py-3.5 rounded-xl items-center justify-center"
                style={{ backgroundColor: '#2D5A3D', opacity: isSendingStockAlert ? 0.6 : 1 }}
              >
                {sendingAlertType === 'in_stock' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="text-white font-semibold">Send In-Stock Alert</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => handleSendStockAlert('out_of_stock')}
                disabled={isSendingStockAlert}
                className="py-3.5 rounded-xl items-center justify-center"
                style={{ backgroundColor: '#B91C1C', opacity: isSendingStockAlert ? 0.6 : 1 }}
              >
                {sendingAlertType === 'out_of_stock' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text className="text-white font-semibold">Send Out-of-Stock Alert</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => setShowStockAlertModal(false)}
                disabled={isSendingStockAlert}
                className="py-3.5 rounded-xl items-center justify-center"
                style={{ backgroundColor: '#F5F5F4' }}
              >
                <Text className="font-semibold" style={{ color: '#44403C' }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Airy farmstand hero with white fog fade */}
      <View style={{ height: 220, overflow: 'hidden' }}>
        <ImageBackground
          source={heroImage ? { uri: heroImage } : fallbackHero}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        >
          {/* Soft bottom fade — card overlap handles the visual transition */}
          <LinearGradient
            colors={[
              'transparent',
              'rgba(250,247,242,0.1)',
              'rgba(250,247,242,0.35)',
            ]}
            locations={[0.5, 0.8, 1]}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '60%',
            }}
          />
        </ImageBackground>

        {/* Floating Back Button */}
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: insets.top + 12,
            left: 16,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: '#FFFFFF',
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
            zIndex: 999,
          }}
        >
          <ArrowLeft size={20} color="#1F1F1F" />
        </Pressable>
      </View>

      {/* Rounded content card — overlaps hero for layered look */}
      <View
        style={{
          flex: 1,
          backgroundColor: '#FAF7F2',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          marginTop: -24,
          overflow: 'hidden',
        }}
      >

      {/* Farmstand name + location below hero */}
      <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 2 }}>
        {(() => { console.log('farmstand-manager-page: circle overlay removed, hero image preserved'); return null; })()}
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#1C1917', letterSpacing: -0.3 }}>
          {currentFarmstand.name}
        </Text>
        <Text style={{ fontSize: 14, color: '#57534E', marginTop: 3 }}>
          Farmstand Manager{currentFarmstand.city ? ` • ${currentFarmstand.city}, ${currentFarmstand.state}` : ''}
        </Text>
      </View>

      {/* Farmstand info card - static header (no dropdown) */}
      {currentFarmstand.claimStatus === 'claimed' && (
      <View className="px-5 mt-2">
        <View
          style={{
            backgroundColor: '#FFFCF9',
            borderRadius: 16,
            paddingVertical: 10,
            paddingHorizontal: 14,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.05,
            shadowRadius: 8,
            elevation: 3,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <CheckCircle size={14} color="#16a34a" />
          <Text className="text-sm ml-1.5 font-medium" style={{ color: '#16a34a' }}>Verified Farmstand</Text>
        </View>
      </View>
      )}

      {/* Trial expiring banner — shown when trial expires within 30 days */}
      {currentFarmstand.premiumStatus === 'trial' && currentFarmstand.premiumTrialExpiresAt && (() => {
        const expires = new Date(currentFarmstand.premiumTrialExpiresAt!);
        const now = new Date();
        const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 30) return null;
        return (
          <Animated.View entering={FadeInDown.delay(50).springify()} style={{ paddingHorizontal: 20, marginTop: 12 }}>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(
                  `/owner/premium?farmstandId=${currentFarmstand.id}&premiumStatus=${currentFarmstand.premiumStatus}&trialExpiresAt=${currentFarmstand.premiumTrialExpiresAt ?? ''}`
                );
              }}
            >
              <LinearGradient
                colors={['#D97706', '#F59E0B']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  borderRadius: 14,
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <Clock size={16} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600', flex: 1, marginLeft: 8 }}>
                  Your Premium trial expires in {daysLeft} {daysLeft === 1 ? 'day' : 'days'}
                </Text>
                <View
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.25)',
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>Continue</Text>
                </View>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        );
      })()}

      {/* Tabs: Manage | Public Page */}
      <View className="px-5 mt-4">
        <View
          className="flex-row"
          style={{
            backgroundColor: '#F5F5F4',
            borderRadius: 12,
            padding: 4,
          }}
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab('manage');
            }}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: activeTab === 'manage' ? '#FFFFFF' : 'transparent',
              shadowColor: activeTab === 'manage' ? '#000' : 'transparent',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: activeTab === 'manage' ? 0.08 : 0,
              shadowRadius: 4,
              elevation: activeTab === 'manage' ? 2 : 0,
            }}
          >
            <Text
              className="text-center font-semibold"
              style={{ color: activeTab === 'manage' ? '#1C1917' : '#78716C' }}
            >
              Manage
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveTab('public');
            }}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: activeTab === 'public' ? '#FFFFFF' : 'transparent',
              shadowColor: activeTab === 'public' ? '#000' : 'transparent',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: activeTab === 'public' ? 0.08 : 0,
              shadowRadius: 4,
              elevation: activeTab === 'public' ? 2 : 0,
            }}
          >
            <Text
              className="text-center font-semibold"
              style={{ color: activeTab === 'public' ? '#1C1917' : '#78716C' }}
            >
              Public Page
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2D5A3D" />
        }
      >
        {activeTab === 'manage' ? (
          /* Manage Tab - Quick Actions */
          <Animated.View entering={FadeInDown.delay(0)}>
            <QuickAction
              icon={<Edit3 size={20} color="#2D5A3D" />}
              label="Edit Listing"
              sublabel="Photos, hours, location, contact & more"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                trackEvent('edit_listing_tapped', { farmstand_id: currentFarmstand.id, farmstand_name: currentFarmstand.name, is_premium: hasPremium });
                router.push(`/owner/edit?id=${currentFarmstand.id}`);
              }}
            />

            <QuickAction
              icon={<ShoppingBag size={20} color="#2D5A3D" />}
              label="Products"
              sublabel={hasPremium ? 'Add, edit, and manage your products' : 'Upgrade to Premium to unlock'}
              locked={!hasPremium}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (!hasPremium) { handlePremiumUpsell(); return; }
                trackEvent('products_manager_opened', { farmstand_id: currentFarmstand.id, farmstand_name: currentFarmstand.name, is_premium: hasPremium });
                router.push(`/owner/products?id=${currentFarmstand.id}`);
              }}
            />

            <QuickAction
              icon={<Bell size={20} color={!hasPremium || Date.now() < stockAlertCooldownUntil ? '#9ca3af' : '#2D5A3D'} />}
              label="Send Stock Alert"
              sublabel={
                !hasPremium
                  ? 'Upgrade to Premium to unlock'
                  : Date.now() < stockAlertCooldownUntil
                  ? 'Alert sent — tap again in 30s'
                  : 'Notify people who saved your farmstand'
              }
              locked={!hasPremium}
              onPress={() => {
                if (!hasPremium) { handlePremiumUpsell(); return; }
                if (Date.now() < stockAlertCooldownUntil) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                trackEvent('stock_alert_tapped', { farmstand_id: currentFarmstand.id, farmstand_name: currentFarmstand.name, is_premium: hasPremium });
                setShowStockAlertModal(true);
              }}
            />

            {/* Farmstand Manager — isolated module, only shown for claimed farmstands */}
            {currentFarmstand.claimStatus === 'claimed' && (
              <>
                <QuickAction
                  icon={<TrendingUp size={20} color="#2D5A3D" />}
                  label="Farmstand Manager"
                  sublabel={hasPremium ? 'Track sales, expenses & inventory' : 'Upgrade to Premium to unlock'}
                  locked={!hasPremium}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (!hasPremium) { handlePremiumUpsell(); return; }
                    trackEvent('farmstand_manager_opened', { farmstand_id: currentFarmstand.id, farmstand_name: currentFarmstand.name, is_premium: hasPremium });
                    setShowFarmstandManager(true);
                  }}
                />
                <FarmstandManager
                  farmstandId={currentFarmstand.id}
                  farmstandName={currentFarmstand.name}
                  premiumStatus={currentFarmstand.premiumStatus}
                  isOpen={showFarmstandManager}
                  onClose={() => setShowFarmstandManager(false)}
                  onUpgradePress={() => {
                    setShowFarmstandManager(false);
                    router.push(`/owner/premium-onboarding?farmstandId=${currentFarmstand.id}`);
                  }}
                />
              </>
            )}

            <QuickAction
              icon={<BarChart3 size={20} color="#2D5A3D" />}
              label="Analytics"
              sublabel={hasPremium ? 'Track views, saves, clicks, and customer activity' : 'Upgrade to Premium to unlock'}
              locked={!hasPremium}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (!hasPremium) { handlePremiumUpsell(); return; }
                trackEvent('owner_analytics_opened', { farmstand_id: currentFarmstand.id, farmstand_name: currentFarmstand.name, is_premium: hasPremium });
                router.push(`/profile/analytics?farmstandId=${currentFarmstand.id}`);
              }}
            />

            <QuickAction
              icon={<MessageSquare size={20} color="#2D5A3D" />}
              label="Manage Reviews"
              sublabel="Reply to customer feedback"
              showDot={hasUnreadReviews}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                trackEvent('manage_reviews_opened', { farmstand_id: currentFarmstand.id, farmstand_name: currentFarmstand.name });
                markReviewsViewed(currentFarmstand.id);
                router.push(`/farmer/reviews?farmstandId=${currentFarmstand.id}`);
              }}
            />


            {/* Destructive actions — always last */}
            {isOwner && (
              <>
                <View
                  style={{
                    height: 1,
                    backgroundColor: '#E8DDD4',
                    marginHorizontal: 16,
                    marginTop: 24,
                    marginBottom: 8,
                  }}
                />
                <QuickAction
                  icon={<Trash2 size={20} color="#DC2626" />}
                  label="Delete Farmstand"
                  sublabel="Remove from map and search"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setShowDeleteModal(true);
                  }}
                />
              </>
            )}
          </Animated.View>
        ) : (
          /* Public Page Tab */
          <Animated.View entering={FadeInDown.delay(0)}>
            <View
              style={{
                backgroundColor: '#FFFCF9',
                borderRadius: 18,
                padding: 20,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.05,
                shadowRadius: 8,
                elevation: 3,
              }}
            >
              <View className="items-center mb-4">
                <View
                  className="w-14 h-14 rounded-full items-center justify-center mb-3"
                  style={{ backgroundColor: '#EFF6FF' }}
                >
                  <Eye size={28} color="#3B82F6" />
                </View>
                <Text className="text-lg font-bold text-center" style={{ color: '#1C1917' }}>
                  Preview Your Public Listing
                </Text>
                <Text className="text-sm text-center mt-1" style={{ color: '#78716C' }}>
                  See exactly how guests will view your farmstand
                </Text>
              </View>

              {/* View as Guest Button */}
              <Pressable
                onPress={handleViewAsGuest}
                className="flex-row items-center justify-center py-3.5 rounded-xl mb-3"
                style={{ backgroundColor: '#2D5A3D' }}
              >
                <ExternalLink size={18} color="#FFFFFF" />
                <Text className="text-white font-semibold ml-2">View as Guest</Text>
              </Pressable>

              {/* Share Listing Button */}
              <Pressable
                onPress={handleShareListing}
                className="flex-row items-center justify-center py-3.5 rounded-xl"
                style={{ backgroundColor: '#F5F5F4' }}
              >
                <Share2 size={18} color="#44403C" />
                <Text className="font-semibold ml-2" style={{ color: '#44403C' }}>
                  Share Listing
                </Text>
              </Pressable>
            </View>

            {/* Info Card */}
            <View
              className="mt-4 p-4 rounded-xl"
              style={{ backgroundColor: '#FEF3C7' }}
            >
              <Text className="text-sm" style={{ color: '#92400E' }}>
                Your public listing shows your farmstand's photos, products, hours, and location to all Farmstand app users.
              </Text>
            </View>
          </Animated.View>
        )}
      </ScrollView>
      </View>
    </View>
  );
}
