import { LogBox } from 'react-native';
import { PostHogProvider } from 'posthog-react-native';
import { getPostHog } from '@/lib/posthog';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from '@/lib/useColorScheme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useUserStore } from '@/lib/user-store';
import { useReviewsStore } from '@/lib/reviews-store';
import { useChatStore } from '@/lib/chat-store';
import { useSupabaseAutoRefresh } from '@/lib/supabase';
import { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, AppState, type AppStateStatus } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { SplashScreen as AnimatedSplash } from '@/components/SplashScreen';
import { useSplashStore } from '@/lib/splash-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, LibreBaskerville_400Regular } from '@expo-google-fonts/libre-baskerville';
import { initAnalytics, logAppOpen } from '@/lib/analytics-events';
import { initializePushNotifications, syncProfilePushToken, setupNotificationListeners, initNotificationHandler } from '@/lib/push-notifications';
import { registerPushTokenForCurrentUser } from '@/lib/push';
import * as Notifications from 'expo-notifications';
import { navigateToConversation } from '@/lib/conversation-navigation';
import { useRouter } from 'expo-router';
import { useBootstrapStore, selectAppReady, selectBootstrapStatus, selectUserFarmstands, selectUserFarmstandsStatus } from '@/lib/bootstrap-store';
import * as Linking from 'expo-linking';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { usePendingNotificationStore } from '@/lib/pending-notification-store';
import { checkForPendingPremiumOnboarding, usePremiumOnboardingStore, hasPremiumOnboardingBeenSeen } from '@/lib/premium-onboarding-store';
import { useFavoritesStore } from '@/lib/favorites-store';
import { initRevenueCat, identifyRevenueCatUser, logOutRevenueCatUser } from '@/lib/revenuecat';

// Suppress RevenueCat SDK console.error overlays in dev — these fire when App Store Connect
// products aren't configured (e.g. outside TestFlight). Production behavior is unchanged.
LogBox.ignoreLogs([
  '[RevenueCat]',
  'Error fetching offerings',
  'None of the products registered',
  'RevenueCat.OfferingsManager',
]);

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

const queryClient = new QueryClient();

function RootLayoutNav({ colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
  const user = useUserStore((s) => s.user);
  const clearAllReviews = useReviewsStore((s) => s.clearAllReviews);
  const router = useRouter();
  const pushNotificationsInitialized = useRef(false);

  // Cold-start notification routing state
  const splashDismissed = useSplashStore((s) => s.splashDismissed);
  const pendingColdStartFarmstandId = useRef<string | null>(null);
  /** Notification type that cold-started the app — used for routing (e.g. claim_denied) */
  const pendingColdStartNotifType = useRef<string | null>(null);
  /** Claim ID from a claim_denied push — used to preload the denied claim in the Update Claim form */
  const pendingColdStartClaimId = useRef<string | null>(null);
  /** For message pushes: the other participant's userId — used to open the correct thread */
  const pendingColdStartOtherUserId = useRef<string | null>(null);
  /** For message pushes: stable conversation_id from the push payload (optional) */
  const pendingColdStartConversationId = useRef<string | null>(null);
  /** For message pushes: threadId from the push payload (legacy / no-farmstandId payloads) */
  const pendingColdStartThreadId = useRef<string | null>(null);
  /** Identifier of the notification that cold-started the app — used to deduplicate */
  const coldStartNotifId = useRef<string | null>(null);
  /** Ensures we only navigate once per cold start */
  const coldStartNavigated = useRef(false);
  /** Guards the post-auth redirect so it fires exactly once per session */
  const hasConsumedPendingRedirectRef = useRef(false);

  // Auth hydration state — needed so cold-start message routing waits for session restore
  const { loading: authLoading } = useAuth();

  // Premium onboarding: watch for loaded farmstands and check for pending onboarding
  const userFarmstands = useBootstrapStore(selectUserFarmstands);
  const userFarmstandsStatus = useBootstrapStore(selectUserFarmstandsStatus);
  const pendingOnboardingFarmstandId = usePremiumOnboardingStore((s) => s.pendingFarmstandId);
  const hasCheckedThisSession = usePremiumOnboardingStore((s) => s.hasCheckedThisSession);
  const setHasCheckedThisSession = usePremiumOnboardingStore((s) => s.setHasCheckedThisSession);

  // Bootstrap is now handled by RootLayout before this component mounts
  // Keep Supabase session alive with auto-refresh
  useSupabaseAutoRefresh();

  // Re-load favorites any time a real (UUID) user becomes the active user.
  // This covers both cold launch (bootstrap sets user → triggers this) and
  // login-after-guest (user changes from null/guest to a UUID).
  // Bootstrap also calls loadFavorites() in its Promise.all, so on cold start
  // this may fire a second time — harmless due to the version guard in the store.
  const currentUserId = useUserStore((s) => s.user?.id ?? null);
  const loadFavoritesGlobal = useFavoritesStore((s) => s.loadFavorites);
  const prevFavoritesUserIdRef = useRef<string | null>(null);
  const isUuidId = (v: string | null): boolean =>
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  useEffect(() => {
    if (isUuidId(currentUserId) && currentUserId !== prevFavoritesUserIdRef.current) {
      prevFavoritesUserIdRef.current = currentUserId;
      loadFavoritesGlobal();
    }
  }, [currentUserId, loadFavoritesGlobal]);

  // Premium onboarding: when farmstands finish loading, check if onboarding needs to be shown.
  // This fires on app open after bootstrap completes (app-open trigger).
  useEffect(() => {
    if (!user?.id || user.id === 'guest') return;
    if (userFarmstandsStatus !== 'loaded') return;
    if (hasCheckedThisSession) return;
    if (userFarmstands.length === 0) return;

    const userId = user.id;
    console.log(
      '[PremiumOnboarding] App-open check: userId=' + userId +
      ' farmstands=' + userFarmstands.length +
      ' status=' + userFarmstandsStatus
    );

    setHasCheckedThisSession(true);
    checkForPendingPremiumOnboarding(userId, userFarmstands).then((pendingId) => {
      if (pendingId) {
        // pendingFarmstandId is already set in the store by checkForPendingPremiumOnboarding.
        // The Explore screen will detect it and show the ClaimApprovedModal overlay —
        // no navigation needed here.
        console.log('[PremiumOnboarding] App-open trigger: pendingFarmstandId set for', pendingId, '— Explore screen will show modal');
      }
    });
  }, [user?.id, userFarmstandsStatus, userFarmstands, hasCheckedThisSession, setHasCheckedThisSession, router]);

  // When the authenticated user changes (login, logout, account switch),
  // immediately wipe userFarmstands from the bootstrap store so stale
  // farmstand data from the previous session can never flash on screen.
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== currentId) {
      console.log('[RootLayout] User changed from', prevUserIdRef.current, '→', currentId, '— clearing bootstrap store');
      useBootstrapStore.getState().reset();
      // Also reset premium onboarding check state so new user gets a fresh check
      usePremiumOnboardingStore.getState().reset();
      // Identify / log out the user in RevenueCat
      if (currentId && currentId !== 'guest') {
        identifyRevenueCatUser(currentId).catch(() => {});
      } else {
        logOutRevenueCatUser().catch(() => {});
      }
      // CRITICAL: Reset push init flag whenever the user changes (logout or account switch).
      // Without this, signing out and back in skips registration because the ref stays true.
      if (!currentId || currentId === 'guest' || currentId !== prevUserIdRef.current) {
        console.log('[PushDebug] User changed/signed-out — resetting pushNotificationsInitialized flag for next login');
        pushNotificationsInitialized.current = false;
      }
      // Reset post-auth redirect guard so the next login can consume a fresh pending redirect.
      hasConsumedPendingRedirectRef.current = false;
    }
    prevUserIdRef.current = currentId;
  }, [user?.id]);

  // ── Post-auth redirect ────────────────────────────────────────────────────
  // Fires any pending message notification redirect as soon as auth is confirmed.
  // Covers ALL authentication paths:
  //   • Explicit login (email/password, OAuth)
  //   • Session restore on cold start (persisted valid session)
  // hasConsumedPendingRedirectRef prevents double-firing; it is reset in the
  // user-change effect above whenever the active user changes (login/logout/switch).
  useEffect(() => {
    // Exit immediately if there is no pending notification — this is the common
    // case for every normal login/session-restore and must short-circuit first.
    const pending = usePendingNotificationStore.getState().pending;
    if (!pending) return;

    // A pending notification exists: now require auth to be fully ready
    if (!user?.id || user.id === 'guest') return;
    if (authLoading) return;
    // Only consume once per session
    if (hasConsumedPendingRedirectRef.current) return;

    // Mark consumed before navigating to guard against re-entry
    hasConsumedPendingRedirectRef.current = true;
    usePendingNotificationStore.getState().clear();
    console.log('[PendingRedirect] Auth ready: consuming pending redirect:', JSON.stringify(pending));

    if (pending.type === 'message_thread') {
      if (pending.farmstandId && pending.otherUserId) {
        console.log('[PendingRedirect] Navigating to conversation thread — farmstandId:', pending.farmstandId);
        navigateToConversation({
          farmstandId: pending.farmstandId,
          otherUserId: pending.otherUserId,
          ...(pending.conversationId ? { conversationId: pending.conversationId } : {}),
        });
      } else if (pending.threadId) {
        console.log('[PendingRedirect] Navigating to thread by id (fallback):', pending.threadId);
        router.navigate('/(tabs)/inbox' as any);
        router.push(`/chat/${pending.threadId}` as any);
      } else {
        console.log('[PendingRedirect] Navigating to Inbox (no conversation params)');
        router.navigate('/(tabs)/inbox' as any);
      }
    }
  }, [user?.id, authLoading, router]);

  // ── Cold-start push notification routing ──────────────────────────────────
  // Check whether the app was launched by tapping a push notification.
  // expo-notifications does not reliably fire addNotificationResponseReceivedListener
  // for the notification that opened the app from a terminated state, so we use
  // getLastNotificationResponseAsync() as the authoritative cold-start source.
  useEffect(() => {
    const checkColdStartNotification = async () => {
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        if (!response) {
          console.log('[ColdStart] No initial notification response — normal launch');
          return;
        }

        const data = response.notification.request.content.data;
        const notifId = response.notification.request.identifier;
        console.log('[ColdStart] Initial notification received on cold start — id:', notifId);
        console.log('[ColdStart] Payload:', JSON.stringify(data));

        // Extract farmstandId from payload (stock_alert and generic farmstand notifications
        // both send farmstandId directly in the data object)
        const farmstandId = data?.farmstandId ? (data.farmstandId as string) : null;
        const notifType = data?.type as string | undefined;
        const claimId = data?.claimId as string | undefined;
        const threadId = data?.threadId as string | undefined;
        const isMessage = notifType === 'message' || !!threadId;

        console.log('[ColdStart] type:', notifType, 'farmstandId:', farmstandId, 'claimId:', claimId, 'threadId:', threadId, 'isMessage:', isMessage);

        if (farmstandId || isMessage) {
          console.log('[ColdStart] Storing pending navigation — farmstandId:', farmstandId, 'type:', notifType, 'isMessage:', isMessage);
          coldStartNotifId.current = notifId;
          pendingColdStartFarmstandId.current = farmstandId;
          pendingColdStartNotifType.current = notifType ?? null;
          pendingColdStartClaimId.current = claimId ?? null;
          pendingColdStartOtherUserId.current = isMessage ? ((data?.otherUserId as string) ?? null) : null;
          pendingColdStartConversationId.current = isMessage ? ((data?.conversation_id as string) ?? null) : null;
          pendingColdStartThreadId.current = isMessage ? (threadId ?? null) : null;

          // Edge case: splash already dismissed before this async check resolved
          if (useSplashStore.getState().splashDismissed && !coldStartNavigated.current) {
            coldStartNavigated.current = true;
            pendingColdStartFarmstandId.current = null;
            pendingColdStartNotifType.current = null;
            pendingColdStartClaimId.current = null;
            pendingColdStartOtherUserId.current = null;
            pendingColdStartConversationId.current = null;
            pendingColdStartThreadId.current = null;
            if (notifType === 'claim_denied' && farmstandId) {
              const claimParam = claimId ? `&claimId=${claimId}` : '';
              console.log('[ColdStart] claim_denied — navigating to claim resubmit screen for farmstand:', farmstandId, 'claimId:', claimId);
              router.push(`/farm/${farmstandId}?openClaimModal=true&claimMode=resubmit${claimParam}`);
            } else if (isMessage) {
              const msgOtherUserId = data?.otherUserId as string | undefined;
              const msgConversationId = data?.conversation_id as string | undefined;
              const msgThreadId = data?.threadId as string | undefined;
              const currentUserId = useUserStore.getState().user?.id;
              if (currentUserId && currentUserId !== 'guest') {
                console.log('[ColdStart] Splash already dismissed — message push, user logged in, opening conversation');
                if (farmstandId && msgOtherUserId) {
                  navigateToConversation({ farmstandId, otherUserId: msgOtherUserId, ...(msgConversationId ? { conversationId: msgConversationId } : {}) });
                } else if (msgThreadId) {
                  router.navigate('/(tabs)/inbox' as any);
                  router.push(`/chat/${msgThreadId}` as any);
                } else {
                  router.navigate('/(tabs)/inbox' as any);
                }
              } else {
                console.log('[PushTap][ColdStart] Splash already dismissed — message push, user not logged in, saving for post-auth redirect');
                usePendingNotificationStore.getState().set({
                  type: 'message_thread',
                  farmstandId: farmstandId ?? null,
                  otherUserId: msgOtherUserId ?? null,
                  conversationId: msgConversationId ?? null,
                  threadId: msgThreadId ?? null,
                });
              }
            } else if (farmstandId) {
              console.log('[ColdStart] Splash already dismissed — navigating immediately to farmstand:', farmstandId);
              router.push(`/farm/${farmstandId}`);
            }
          }
        } else {
          console.log('[ColdStart] No actionable payload in cold-start notification — skipping');
        }
      } catch (e) {
        console.log('[ColdStart] Error checking initial notification:', e);
      }
    };

    checkColdStartNotification();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire the pending cold-start navigation once the splash overlay is gone and the
  // router stack is ready. For message pushes, also waits for auth hydration so we
  // know whether to navigate immediately (logged in) or defer to pending store (logged out).
  useEffect(() => {
    if (!splashDismissed) return;
    if (coldStartNavigated.current) return;

    const farmstandId = pendingColdStartFarmstandId.current;
    const notifType = pendingColdStartNotifType.current;
    const savedThreadId = pendingColdStartThreadId.current;
    const isMessagePush = notifType === 'message' || !!savedThreadId;

    // Nothing pending
    if (!farmstandId && !isMessagePush) return;

    // For message pushes: wait for auth hydration before deciding how to route.
    // The effect re-runs automatically when authLoading transitions to false.
    if (isMessagePush && authLoading) {
      console.log('[ColdStart] Message push pending — waiting for auth hydration before routing');
      return;
    }

    const savedClaimId = pendingColdStartClaimId.current;
    const savedOtherUserId = pendingColdStartOtherUserId.current;
    const savedConversationId = pendingColdStartConversationId.current;

    // Consume all refs now — ensures this only runs once
    coldStartNavigated.current = true;
    pendingColdStartFarmstandId.current = null;
    pendingColdStartNotifType.current = null;
    pendingColdStartClaimId.current = null;
    pendingColdStartOtherUserId.current = null;
    pendingColdStartConversationId.current = null;
    pendingColdStartThreadId.current = null;

    if (notifType === 'claim_denied' && farmstandId) {
      const claimParam = savedClaimId ? `&claimId=${savedClaimId}` : '';
      console.log('[ColdStart] Splash dismissed — claim_denied, navigating to claim resubmit for farmstand:', farmstandId, 'claimId:', savedClaimId);
      router.push(`/farm/${farmstandId}?openClaimModal=true&claimMode=resubmit${claimParam}`);
    } else if (isMessagePush) {
      const currentUserId = user?.id;
      if (currentUserId && currentUserId !== 'guest') {
        // Session restored — navigate directly into the conversation
        console.log('[ColdStart] Splash dismissed — message push, session restored, opening conversation');
        if (farmstandId && savedOtherUserId) {
          navigateToConversation({ farmstandId, otherUserId: savedOtherUserId, ...(savedConversationId ? { conversationId: savedConversationId } : {}) });
        } else if (savedThreadId) {
          router.navigate('/(tabs)/inbox' as any);
          router.push(`/chat/${savedThreadId}` as any);
        } else {
          router.navigate('/(tabs)/inbox' as any);
        }
      } else {
        // No valid session — save target so it fires automatically after login
        console.log('[PushTap][ColdStart] Splash dismissed — message push, user not logged in, saving for post-auth redirect');
        usePendingNotificationStore.getState().set({
          type: 'message_thread',
          farmstandId: farmstandId ?? null,
          otherUserId: savedOtherUserId ?? null,
          conversationId: savedConversationId ?? null,
          threadId: savedThreadId ?? null,
        });
      }
    } else if (farmstandId) {
      console.log('[ColdStart] Splash dismissed — navigating to farmstand:', farmstandId);
      router.push(`/farm/${farmstandId}`);
    }
  }, [splashDismissed, router, authLoading, user?.id]);

  // Track if we've handled the initial deep link
  const deepLinkHandled = useRef(false);

  // Global deep link handling for password reset (cold start on TestFlight)
  // This captures deep links like:
  // - farmstand://auth/callback#access_token=xxx&type=recovery (Supabase recovery flow)
  // - farmstand://reset-password (direct deep link to reset password screen)
  useEffect(() => {
    // Parse tokens from URL (handles both query params and hash fragment)
    const parseTokensFromUrl = (url: string): { accessToken?: string; refreshToken?: string; type?: string } => {
      const result: { accessToken?: string; refreshToken?: string; type?: string } = {};

      try {
        // Parse query params
        const queryStart = url.indexOf('?');
        if (queryStart !== -1) {
          const queryString = url.substring(queryStart + 1).split('#')[0];
          const queryPairs = queryString.split('&');
          for (const pair of queryPairs) {
            const [key, value] = pair.split('=');
            if (key === 'access_token' && value) result.accessToken = decodeURIComponent(value);
            if (key === 'refresh_token' && value) result.refreshToken = decodeURIComponent(value);
            if (key === 'type' && value) result.type = decodeURIComponent(value);
          }
        }

        // Parse hash fragment (Supabase uses this for tokens - overrides query params)
        const hashStart = url.indexOf('#');
        if (hashStart !== -1) {
          const hashString = url.substring(hashStart + 1);
          const hashPairs = hashString.split('&');
          for (const pair of hashPairs) {
            const [key, value] = pair.split('=');
            if (key === 'access_token' && value) result.accessToken = decodeURIComponent(value);
            if (key === 'refresh_token' && value) result.refreshToken = decodeURIComponent(value);
            if (key === 'type' && value) result.type = decodeURIComponent(value);
          }
        }
      } catch (err) {
        console.log('[RootLayout] Error parsing URL tokens:', err);
      }

      return result;
    };

    const handleDeepLink = (url: string) => {
      console.log('[DeepLink] ===== INCOMING URL =====');
      console.log('[DeepLink] Raw URL:', url);

      // Parse tokens from URL
      const { accessToken, refreshToken, type } = parseTokensFromUrl(url);
      console.log('[DeepLink] Token parse - hasAccessToken:', !!accessToken, 'hasRefreshToken:', !!refreshToken, 'type:', type);

      // Detect password recovery flow
      const isRecovery = type === 'recovery' || type === 'password_recovery';
      if (isRecovery) {
        console.log('[DeepLink] [DEBUG] Recovery flow detected - type:', type, 'hasTokens:', !!(accessToken && refreshToken));
        console.log('[DeepLink] [DEBUG] URL origin:', url.split('?')[0].split('#')[0]);
      }

      // Check if this is an auth callback URL (Supabase password reset with tokens)
      // This handles the legacy farmstand://auth/callback redirect format
      if (url.includes('auth/callback') && (url.includes('type=recovery') || url.includes('access_token'))) {
        console.log('[DeepLink] -> AUTH CALLBACK (recovery), navigating to /auth/callback');
        router.replace('/auth/callback');
        return;
      }

      // Handle Universal Links: https://links.farmstand.online/farmstand/:slug
      // Check this FIRST before legacy /stands/ route
      const farmstandSlugMatch = url.match(/(?:links\.farmstand\.online|farmstand:\/\/)\/farmstand\/([^/?#]+)/);
      if (farmstandSlugMatch) {
        const slug = decodeURIComponent(farmstandSlugMatch[1]);
        console.log('[DeepLink] -> FARMSTAND SLUG match, slug:', slug);
        console.log('[DeepLink] Navigating to /farmstand/' + slug);
        router.push(`/farmstand/${slug}`);
        console.log('[DeepLink] Navigation pushed, awaiting slug resolution');
        return;
      }

      // Handle Universal Links: https://links.farmstand.online/stands/:id
      // and https://links.farmstand.online/share/:id (legacy formats)
      const standsMatch = url.match(/links\.farmstand\.online\/(?:stands|share)\/([^/?#]+)/);
      if (standsMatch) {
        const farmstandId = decodeURIComponent(standsMatch[1]);
        console.log('[DeepLink] -> LEGACY STANDS match, id:', farmstandId);
        console.log('[DeepLink] Navigating to /farm/' + farmstandId);
        router.push(`/farm/${farmstandId}`);
        return;
      }

      // Check if this is a reset-password deep link. Handles:
      //   farmstand://reset-password[#tokens]  ← primary redirect
      //   https://links.farmstand.online/reset-password[#tokens]  ← legacy fallback
      // Safety-net: any URL containing recovery tokens with type=recovery also lands here.
      const isResetPasswordUrl = url.includes('reset-password') && !url.includes('auth/');
      const isRecoveryWithTokens = isRecovery && !!(accessToken && refreshToken);
      if (isResetPasswordUrl || isRecoveryWithTokens) {
        console.log('[DeepLink] -> RESET PASSWORD deep link, isResetPasswordUrl:', isResetPasswordUrl, 'isRecoveryWithTokens:', isRecoveryWithTokens);
        console.log('[DeepLink] [DEBUG] Routing to /reset-password screen');

        if (accessToken && refreshToken) {
          console.log('[DeepLink] [DEBUG] Passing tokens to /reset-password as params');
          router.replace({
            pathname: '/reset-password',
            params: {
              access_token: accessToken,
              refresh_token: refreshToken,
              type: type || 'recovery',
            },
          });
        } else {
          console.log('[DeepLink] [DEBUG] No tokens found, navigating to /reset-password without params');
          router.replace('/reset-password');
        }
        return;
      }

      console.log('[DeepLink] No matching handler for URL:', url);
    };

    // Check for initial URL (app was cold started by deep link)
    const checkInitialUrl = async () => {
      if (deepLinkHandled.current) return;

      try {
        const initialUrl = await Linking.getInitialURL();
        console.log('[DeepLink] Cold start initial URL check:', initialUrl ?? '(none)');

        if (initialUrl) {
          deepLinkHandled.current = true;
          console.log('[DeepLink] Cold start: handling initial URL');
          handleDeepLink(initialUrl);
        } else {
          console.log('[DeepLink] Cold start: no initial URL (normal launch)');
        }
      } catch (err) {
        console.log('[DeepLink] Error getting initial URL:', err);
      }
    };

    // Listen for URL events (app was already running when deep link was clicked)
    const urlSubscription = Linking.addEventListener('url', (event) => {
      console.log('[DeepLink] Foreground URL event received:', event.url);
      handleDeepLink(event.url);
    });

    // Delay slightly to ensure Expo Router has finished its initial render
    // This prevents navigation calls firing before the router stack is ready
    setTimeout(checkInitialUrl, 200);

    return () => {
      urlSubscription.remove();
    };
  }, [router]);

  // Install global JS error handler — catches uncaught errors that would otherwise SIGABRT.
  // Must be set early, inside a useEffect, so it survives hot-reloads without leaving stale handlers.
  // Chains to the existing default handler so React Native's built-in crash reporting is preserved.
  useEffect(() => {
    try {
      const g = global as {
        ErrorUtils?: {
          getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | null;
          setGlobalHandler?: (fn: (error: Error, isFatal?: boolean) => void) => void;
        };
      };
      if (g.ErrorUtils?.setGlobalHandler) {
        const defaultHandler = g.ErrorUtils.getGlobalHandler?.() ?? null;
        g.ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
          console.error('[GLOBAL ERROR] isFatal:', isFatal, '|', error?.message ?? String(error), error);
          defaultHandler?.(error, isFatal);
        });
        console.log('[BOOT] Global error handler installed');
      }
    } catch {
      // ErrorUtils may not be available on all platforms — safe to ignore
    }
  }, []);

  // Initialize analytics and log app_open on app start
  // Note: Analytics is already loaded by bootstrap, this just logs the open event
  useEffect(() => {
    (async () => {
      // Log Supabase config at boot to verify correct project is targeted (critical for TestFlight debugging)
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '(not set)';
      const anonKeyPreview = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').slice(0, 20);
      console.log('[App Boot] Supabase URL:', supabaseUrl);
      console.log('[App Boot] Supabase Anon Key prefix:', anonKeyPreview || '(not set)');
      try {
        await initAnalytics();
        logAppOpen(user?.id);
        console.log('[BOOT] analytics init ok');
      } catch (e) {
        console.warn('[BOOT] analytics init failed (non-fatal):', e instanceof Error ? e.message : String(e));
      }
    })().catch((e) => {
      console.warn('[BOOT] analytics effect uncaught:', e instanceof Error ? e.message : String(e));
    });
  }, []);

  // Initialize push notifications after user session is available.
  // authLoading guard ensures we never register push tokens before the Supabase
  // session is fully hydrated — avoids registering against a stale/pre-auth user ID
  // that was read from AsyncStorage before the session was confirmed on first launch.
  useEffect(() => {
    if (authLoading) return;
    // Only initialize once per session, and only if user is logged in
    if (!user?.id || user.id === 'guest' || pushNotificationsInitialized.current) {
      return;
    }

    const initPush = async () => {
      try {
        pushNotificationsInitialized.current = true;
        console.log('[App] Initializing push notifications for user:', user.id);

        if (!user.id) {
          console.log('[App] Skipping push notification init - no user ID');
          return;
        }

        const result = await initializePushNotifications(user.id);
        console.log('[App] Push notifications result:', {
          success: result.success,
          permissionStatus: result.permissionStatus,
          hasToken: !!result.token,
        });

        // Also register token into public.push_tokens for the authenticated user
        console.log('[App] Registering push token into public.push_tokens for user:', user.id);
        await registerPushTokenForCurrentUser(user.id);

      } catch (error) {
        console.log('[App] Error initializing push notifications:', error);
        // Don't crash - push notifications are not critical
      }
    };

    initPush();
  }, [user?.id, authLoading]);

  // Sync profiles.expo_push_token whenever the user changes or app comes to foreground.
  // This is a separate, lightweight sync that runs independently of the one-shot
  // initializePushNotifications() above, ensuring the profile is always current
  // even if the device restarts or the token rotates between sessions.
  const profileSyncUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id ?? null;
    const email = (user as { email?: string } | null)?.email;
    if (!uid || uid === 'guest') return;

    // Sync immediately when user first becomes available
    if (uid !== profileSyncUserIdRef.current) {
      profileSyncUserIdRef.current = uid;
      console.log('[App] User ready — syncing profile push token, userId:', uid);
      syncProfilePushToken(uid, email).catch(() => {});
    }

    // Re-sync each time app returns from background
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        const currentUid = useUserStore.getState().user?.id ?? null;
        if (currentUid && currentUid !== 'guest') {
          const currentEmail = (useUserStore.getState().user as { email?: string } | null)?.email;
          console.log('[App] App active — re-syncing profile push token, userId:', currentUid);
          syncProfilePushToken(currentUid, currentEmail).catch(() => {});
          // Re-register into public.push_tokens in case token rotated
          registerPushTokenForCurrentUser(currentUid).catch(() => {});
        }
      }
    });
    return () => sub.remove();
  }, [user?.id]);

  // Set up notification listeners for handling notification taps
  useEffect(() => {
    const cleanup = setupNotificationListeners(
      // onNotificationReceived - notification received while app is in foreground
      (notification) => {
        console.log('[App] Notification received:', notification.request.content.title);
      },
      // onNotificationResponse - user tapped on notification
      (response) => {
        // Guard: skip if this is the same notification that opened the app from
        // a terminated state. That path is handled by the cold-start flow above
        // to avoid double navigation.
        if (
          coldStartNotifId.current &&
          response.notification.request.identifier === coldStartNotifId.current
        ) {
          console.log('[App] Skipping cold-start notification from live listener — handled by cold-start path');
          return;
        }

        console.log('[App] Notification tapped:', response.notification.request.content);

        // Handle deep linking based on notification data
        const data = response.notification.request.content.data;
        console.log('[PushTap] type:', data?.type, 'farmstandId:', data?.farmstandId, 'claimId:', data?.claimId);

        if (data?.type === 'claim_denied' && data?.farmstandId) {
          // Denied claim: open the claim resubmission flow directly — NOT the public farmstand page
          const farmstandId = data.farmstandId as string;
          const claimId = data?.claimId as string | undefined;
          const claimParam = claimId ? `&claimId=${claimId}` : '';
          console.log('[PushTap] claim_denied — routing to claim resubmit screen for farmstand:', farmstandId, 'claimId:', claimId);
          router.push(`/farm/${farmstandId}?openClaimModal=true&claimMode=resubmit${claimParam}`);
        } else if (data?.type === 'claim_approved' && data?.farmstandId) {
          // Claim approved notification: route to premium onboarding (if not yet seen) or owner dashboard
          const farmstandId = data.farmstandId as string;
          console.log('[App] Notification tap: claim_approved for farmstand', farmstandId);
          const userId = useUserStore.getState().user?.id;
          if (userId && userId !== 'guest') {
            hasPremiumOnboardingBeenSeen(userId, farmstandId).then((seen: boolean) => {
              if (!seen) {
                console.log('[App] Routing to premium onboarding from push tap');
                router.push(`/owner/premium-onboarding?farmstandId=${farmstandId}`);
              } else {
                console.log('[App] Onboarding already seen, routing to my-farmstand from push tap');
                router.push(`/owner/my-farmstand?id=${farmstandId}`);
              }
            });
          }
        } else if (data?.type === 'message' || data?.threadId) {
          // Message notification: open the conversation via the Inbox tab so
          // the back arrow returns to Inbox. If the user is not logged in, save
          // the target to the pending store so it fires automatically after login.
          console.log('[PushTap] message push payload:', JSON.stringify(data));

          const tapUserId = useUserStore.getState().user?.id;
          const tapFarmstandId = data?.farmstandId as string | undefined;
          const tapOtherUserId = data?.otherUserId as string | undefined;
          const tapConversationId = data?.conversation_id as string | undefined;
          const tapThreadId = data?.threadId as string | undefined;

          if (tapUserId && tapUserId !== 'guest') {
            // Logged in — navigate immediately (existing behaviour)
            if (tapConversationId) {
              console.log('[PushTap] message → conversation_id:', tapConversationId);
              if (tapFarmstandId && tapOtherUserId) {
                navigateToConversation({ farmstandId: tapFarmstandId, otherUserId: tapOtherUserId, conversationId: tapConversationId });
              } else {
                console.log('[PushTap] message → conversation_id present but missing farmstandId/otherUserId — routing to Inbox');
                router.navigate('/(tabs)/inbox' as any);
              }
            } else if (tapFarmstandId && tapOtherUserId) {
              console.log('[PushTap] message → direct conversation farmstandId:', tapFarmstandId, 'otherUserId:', tapOtherUserId);
              navigateToConversation({ farmstandId: tapFarmstandId, otherUserId: tapOtherUserId });
            } else if (tapThreadId) {
              console.log('[PushTap] message → legacy threadId:', tapThreadId);
              router.navigate('/(tabs)/inbox' as any);
              router.push(`/chat/${tapThreadId}` as any);
            } else {
              router.navigate('/(tabs)/inbox' as any);
            }
          } else {
            // Not logged in — save for post-auth redirect; the app will route
            // to the thread automatically once the user signs in.
            console.log('[PushTap] message push — user not logged in, saving for post-auth redirect');
            usePendingNotificationStore.getState().set({
              type: 'message_thread',
              farmstandId: tapFarmstandId ?? null,
              otherUserId: tapOtherUserId ?? null,
              conversationId: tapConversationId ?? null,
              threadId: tapThreadId ?? null,
            });
          }
        } else if (data?.type === 'alert' || data?.alertId) {
          // Alert notification: Navigate to Inbox tab (Alerts tab)
          router.push('/(tabs)/inbox');
          // If alert has an action route, navigate to it after a delay
          if (data?.actionRoute && data?.actionParams) {
            setTimeout(() => {
              const params = data.actionParams as Record<string, string> | undefined;
              switch (data.actionRoute) {
                case 'FarmstandDetail':
                  if (params?.farmstandId) {
                    router.push(`/farm/${params.farmstandId}`);
                  }
                  break;
                case 'Reviews':
                  if (params?.farmstandId) {
                    router.push(`/farm/reviews?farmstandId=${params.farmstandId}`);
                  }
                  break;
                case 'AdminClaims':
                  router.push('/admin/claim-requests');
                  break;
                case 'OwnerDashboard': {
                  const farms = useBootstrapStore.getState().userFarmstands;
                  const targetId = farms[0]?.id;
                  router.push(targetId ? `/owner/my-farmstand?id=${targetId}` : '/owner/my-farmstand');
                  break;
                }
              }
            }, 150);
          }
        } else if (data?.farmstandId) {
          // Farmstand notification: Navigate to farmstand detail
          router.push(`/farm/${data.farmstandId}`);
        }
      }
    );

    return cleanup;
  }, [router]);

  // One-time clear of all reviews (remove this after reviews are cleared)
  useEffect(() => {
    const clearReviewsOnce = async () => {
      const hasCleared = await AsyncStorage.getItem('reviews_cleared_v1');
      if (!hasCleared) {
        await clearAllReviews();
        await AsyncStorage.setItem('reviews_cleared_v1', 'true');
        console.log('All reviews have been cleared');
      }
    };
    clearReviewsOnce().catch((e) => { if (__DEV__) console.log('[Startup] clearReviewsOnce error:', e); });
  }, [clearAllReviews]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="auth/login" options={{ headerShown: false }} />
        <Stack.Screen name="auth/signup" options={{ headerShown: false, presentation: 'transparentModal', animation: 'none' }} />
        <Stack.Screen name="auth/confirm-email" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="auth/reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="farm/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="farm/reviews" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="profile/notifications" options={{ headerShown: false }} />
        <Stack.Screen name="profile/location" options={{ headerShown: false }} />
        <Stack.Screen name="profile/rate-us" options={{ headerShown: false }} />
        <Stack.Screen name="profile/help" options={{ headerShown: false }} />
        <Stack.Screen name="profile/settings" options={{ headerShown: false }} />
        <Stack.Screen name="profile/notification-settings" options={{ headerShown: false }} />
        <Stack.Screen name="profile/visited" options={{ headerShown: false }} />
        <Stack.Screen name="profile/reviews" options={{ headerShown: false }} />
        <Stack.Screen name="profile/edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="profile/change-password" options={{ headerShown: false }} />
        <Stack.Screen name="profile/paywall" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="profile/privacy-policy" options={{ headerShown: false }} />
        <Stack.Screen name="profile/terms" options={{ headerShown: false }} />
        <Stack.Screen name="profile/support" options={{ headerShown: false }} />
        <Stack.Screen name="profile/support-thread" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/onboarding" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="farmer/dashboard" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/settings" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/listing/edit" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/products" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/hours" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/location" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/reviews/index" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/reviews/detail" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/analytics/views" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/analytics/ratings" options={{ headerShown: false }} />
        <Stack.Screen name="farmer/performance" options={{ headerShown: false }} />
        <Stack.Screen name="admin/dashboard" options={{ headerShown: false }} />
        <Stack.Screen name="admin/farmstands" options={{ headerShown: false }} />
        <Stack.Screen name="admin/farmstand-edit" options={{ headerShown: false }} />
        <Stack.Screen name="admin/pending-approvals" options={{ headerShown: false }} />
        <Stack.Screen name="admin/users" options={{ headerShown: false }} />
        <Stack.Screen name="admin/reports" options={{ headerShown: false }} />
        <Stack.Screen name="admin/settings" options={{ headerShown: false }} />
        <Stack.Screen name="admin/approx-locations" options={{ headerShown: false }} />
        <Stack.Screen name="admin/claim-requests" options={{ headerShown: false }} />
        <Stack.Screen name="admin/reports-and-flags" options={{ headerShown: false }} />
        <Stack.Screen name="admin/ticket-thread" options={{ headerShown: false }} />
        <Stack.Screen name="admin/feedback" options={{ headerShown: false }} />
        <Stack.Screen name="owner/edit" options={{ headerShown: false }} />
        <Stack.Screen name="owner/products" options={{ headerShown: false }} />
        <Stack.Screen name="owner/hours" options={{ headerShown: false }} />
        <Stack.Screen name="owner/location" options={{ headerShown: false }} />
        <Stack.Screen name="owner/my-farmstand" options={{ headerShown: false }} />
        <Stack.Screen name="owner/claim-success" options={{ headerShown: false }} />
        <Stack.Screen name="owner/free-vs-premium" options={{ headerShown: false }} />
        <Stack.Screen name="owner/premium" options={{ headerShown: false }} />
        <Stack.Screen name="owner/premium-onboarding" options={{ headerShown: false, presentation: 'transparentModal', animation: 'fade' }} />
        <Stack.Screen name="owner/promotions" options={{ headerShown: false }} />
        <Stack.Screen name="alert-detail" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[threadId]" options={{ headerShown: false }} />
        <Stack.Screen name="chat/direct" options={{ headerShown: false }} />
        <Stack.Screen name="review/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="farmstand/[slug]" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}



export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Lazy-init PostHog inside the component lifecycle (never at module eval time).
  // useState initializer runs once synchronously on first render, safely after
  // all native modules have been loaded.
  const [posthogClient] = useState(() => getPostHog());

  // ── Splash state ──────────────────────────────────────────────────────────
  // splashVisible: keeps the Animated.View in the tree during fade-out
  const [splashVisible, setSplashVisible] = useState(true);
  // splashFading: switches pointerEvents to 'none' so app is interactive during fade
  const [splashFading, setSplashFading] = useState(false);
  const [splashAnimationComplete, setSplashAnimationComplete] = useState(false);
  const dismissFiredRef = useRef(false);
  const splashOpacity = useSharedValue(1);
  const splashFadeStyle = useAnimatedStyle(() => ({ opacity: splashOpacity.value }));

  // Bootstrap state
  const appReady = useBootstrapStore(selectAppReady);
  const bootstrapStatus = useBootstrapStore(selectBootstrapStatus);
  const bootstrap = useBootstrapStore((s) => s.bootstrap);
  const bootstrapStarted = useRef(false);

  const [fontsLoaded] = useFonts({
    LibreBaskerville_400Regular,
  });

  useEffect(() => {
    (async () => {
      try {
        console.log('[BOOT] App starting');

        // Step 1: Notification handler — must be in useEffect, never at module scope.
        // Running at module scope caused SIGABRT on first TestFlight install (build 179).
        console.log('[BOOT] Step 1/4: notification handler');
        try {
          initNotificationHandler();
          console.log('[BOOT] notification handler ok');
        } catch (e) {
          console.warn('[BOOT] notification handler failed (non-fatal):', e instanceof Error ? e.message : String(e));
        }

        // Step 2: Splash screen — preventAutoHideAsync must come before hideAsync.
        console.log('[BOOT] Step 2/4: splash screen');
        try {
          await SplashScreen.preventAutoHideAsync();
          console.log('[BOOT] splash preventAutoHide ok');
        } catch (e) {
          console.warn('[BOOT] splash preventAutoHide failed (non-fatal):', e instanceof Error ? e.message : String(e));
        }
        try {
          await SplashScreen.hideAsync();
          console.log('[BOOT] splash hidden');
        } catch (e) {
          console.warn('[BOOT] splash hideAsync failed (non-fatal):', e instanceof Error ? e.message : String(e));
        }

        // Step 3: RevenueCat — initRevenueCat() is fully self-contained with its own
        // try/catch; it will not throw. Outer catch here is belt-and-suspenders.
        console.log('[BOOT] Step 3/4: RevenueCat');
        initRevenueCat();

        // Step 4: PostHog — getPostHog() never throws; returns undefined on failure.
        console.log('[BOOT] Step 4/4: PostHog');
        const ph = getPostHog();
        console.log('[BOOT] PostHog ready:', ph != null);

        console.log('[BOOT] All startup steps complete');
      } catch (e) {
        console.error('[BOOT ERROR] Unexpected startup failure:', e instanceof Error ? e.message : String(e), e);
      }
    })();
  }, []);

  // Start bootstrap ONCE when fonts are loaded
  useEffect(() => {
    if (fontsLoaded && !bootstrapStarted.current) {
      bootstrapStarted.current = true;
      if (__DEV__) console.log('[Startup] auth bootstrap start');
      (async () => {
        try {
          await bootstrap();
          if (__DEV__) console.log('[Startup] auth bootstrap done');
        } catch (e) {
          if (__DEV__) console.log('[Startup] auth bootstrap fail:', e instanceof Error ? e.message : String(e));
        }
      })().catch((e) => {
        if (__DEV__) console.log('[Startup] auth bootstrap uncaught:', e instanceof Error ? e.message : String(e));
      });
    }
  }, [fontsLoaded, bootstrap]);

  // Handle splash animation complete
  const handleSplashComplete = () => {
    setSplashAnimationComplete(true);
    console.log('[Splash] Minimum time complete — animation done, appReady:', appReady);
  };

  // ── Core dismiss function — fires the fade-out exactly once ───────────────
  const exploreReady = useSplashStore((s) => s.exploreReady);
  const setSplashDismissed = useSplashStore((s) => s.setSplashDismissed);

  // Called on the JS thread once the splash fade-out finishes.
  // Hides the overlay AND broadcasts the splashDismissed signal so
  // downstream screens (e.g. location permission modal) know it's safe to appear.
  const handleSplashGone = useCallback(() => {
    setSplashVisible(false);
    setSplashDismissed();
  }, [setSplashDismissed]);

  const triggerDismiss = useCallback((reason: string) => {
    if (dismissFiredRef.current) return;
    dismissFiredRef.current = true;
    console.log('[Splash] Dismissing —', reason);
    setSplashFading(true);
    splashOpacity.value = withTiming(0, {
      duration: 380,
      easing: Easing.out(Easing.ease),
    }, (finished) => {
      if (finished) runOnJS(handleSplashGone)();
    });
  }, [splashOpacity, handleSplashGone]);

  // Normal dismiss: logo animation done + bootstrap ready + explore ready
  useEffect(() => {
    if (splashAnimationComplete && appReady && exploreReady) {
      console.log('[Splash] All conditions met — explore data ready, dismissing');
      triggerDismiss('all-conditions-met');
    }
  }, [splashAnimationComplete, appReady, exploreReady, triggerDismiss]);

  // Safety cap: never hold splash longer than 3.5s from mount
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('[Splash] Forced dismiss by timeout');
      triggerDismiss('safety-timeout-3500ms');
    }, 3500);
    return () => clearTimeout(timer);
  }, [triggerDismiss]);

  // ── Render: app always mounts (once fonts load), splash overlays on top ───
  return (
    <PostHogProvider client={posthogClient}>
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#F4F1E8' }}>
      <StatusBar style={splashVisible ? 'light' : (colorScheme === 'dark' ? 'light' : 'dark')} />
      {fontsLoaded && (
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              <RootLayoutNav colorScheme={colorScheme} />
            </KeyboardProvider>
          </QueryClientProvider>
        </AuthProvider>
      )}
      {splashVisible && (
        <Animated.View
          pointerEvents={splashFading ? 'none' : 'box-only'}
          style={[StyleSheet.absoluteFill, splashFadeStyle]}
        >
          <AnimatedSplash onAnimationComplete={handleSplashComplete} />
        </Animated.View>
      )}
    </GestureHandlerRootView>
    </PostHogProvider>
  );
}
