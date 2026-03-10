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
import { useEffect, useState, useRef } from 'react';
import { SplashScreen as AnimatedSplash } from '@/components/SplashScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, LibreBaskerville_400Regular } from '@expo-google-fonts/libre-baskerville';
import { initAnalytics, logAppOpen } from '@/lib/analytics-events';
import { initializePushNotifications, setupNotificationListeners } from '@/lib/push-notifications';
import { useRouter } from 'expo-router';
import { useBootstrapStore, selectAppReady, selectBootstrapStatus } from '@/lib/bootstrap-store';
import * as Linking from 'expo-linking';
import { AuthProvider } from '@/providers/AuthProvider';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav({ colorScheme }: { colorScheme: 'light' | 'dark' | null | undefined }) {
  const user = useUserStore((s) => s.user);
  const clearAllReviews = useReviewsStore((s) => s.clearAllReviews);
  const router = useRouter();
  const pushNotificationsInitialized = useRef(false);

  // Bootstrap is now handled by RootLayout before this component mounts
  // Keep Supabase session alive with auto-refresh
  useSupabaseAutoRefresh();

  // When the authenticated user changes (login, logout, account switch),
  // immediately wipe userFarmstands from the bootstrap store so stale
  // farmstand data from the previous session can never flash on screen.
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const currentId = user?.id ?? null;
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== currentId) {
      console.log('[RootLayout] User changed from', prevUserIdRef.current, '→', currentId, '— clearing bootstrap store');
      useBootstrapStore.getState().reset();
    }
    prevUserIdRef.current = currentId;
  }, [user?.id]);

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
      console.log('[RootLayout] Deep link received:', url);

      // Parse tokens from URL
      const { accessToken, refreshToken, type } = parseTokensFromUrl(url);
      console.log('[RootLayout] Parsed tokens - hasAccessToken:', !!accessToken, 'hasRefreshToken:', !!refreshToken, 'type:', type);

      // Check if this is an auth callback URL (Supabase password reset with tokens)
      if (url.includes('auth/callback') && (url.includes('type=recovery') || url.includes('access_token'))) {
        console.log('[RootLayout] Detected Supabase recovery deep link, navigating to callback screen');
        // Navigate to the callback screen which will handle the token exchange
        // Use replace to prevent back navigation to the previous screen
        router.replace('/auth/callback');
        return;
      }

      // Handle Universal Links: https://links.farmstand.online/stands/:id
      // and https://links.farmstand.online/share/:id
      const standsMatch = url.match(/links\.farmstand\.online\/(?:stands|share)\/([^/?#]+)/);
      if (standsMatch) {
        const farmstandId = standsMatch[1];
        console.log('[RootLayout] Detected universal link for farmstand:', farmstandId);
        router.push(`/farm/${farmstandId}`);
        return;
      }

      // Check if this is a direct reset-password deep link
      // Matches: farmstand://reset-password or farmstand://reset-password#access_token=xxx
      if (url.includes('reset-password') && !url.includes('auth/')) {
        console.log('[RootLayout] Detected reset-password deep link, navigating to reset password screen');

        // If tokens are present, pass them as route params
        if (accessToken && refreshToken) {
          console.log('[RootLayout] Passing tokens to reset-password screen');
          router.replace({
            pathname: '/reset-password',
            params: {
              access_token: accessToken,
              refresh_token: refreshToken,
              type: type || 'recovery',
            },
          });
        } else {
          router.replace('/reset-password');
        }
        return;
      }
    };

    // Check for initial URL (app was cold started by deep link)
    const checkInitialUrl = async () => {
      if (deepLinkHandled.current) return;

      try {
        const initialUrl = await Linking.getInitialURL();
        console.log('[RootLayout] Checking initial URL:', initialUrl);

        if (initialUrl) {
          deepLinkHandled.current = true;
          handleDeepLink(initialUrl);
        }
      } catch (err) {
        console.log('[RootLayout] Error getting initial URL:', err);
      }
    };

    // Listen for URL events (app was already running when deep link was clicked)
    const urlSubscription = Linking.addEventListener('url', (event) => {
      console.log('[RootLayout] URL event received:', event.url);
      handleDeepLink(event.url);
    });

    // Small delay to ensure router is ready
    setTimeout(checkInitialUrl, 100);

    return () => {
      urlSubscription.remove();
    };
  }, [router]);

  // Initialize analytics and log app_open on app start
  // Note: Analytics is already loaded by bootstrap, this just logs the open event
  useEffect(() => {
    // Log Supabase config at boot to verify correct project is targeted (critical for TestFlight debugging)
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '(not set)';
    const anonKeyPreview = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').slice(0, 20);
    console.log('[App Boot] Supabase URL:', supabaseUrl);
    console.log('[App Boot] Supabase Anon Key prefix:', anonKeyPreview || '(not set)');

    initAnalytics().then(() => {
      logAppOpen(user?.id);
    });
  }, []);

  // Initialize push notifications after user session is available
  useEffect(() => {
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

      } catch (error) {
        console.log('[App] Error initializing push notifications:', error);
        // Don't crash - push notifications are not critical
      }
    };

    initPush();
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
        console.log('[App] Notification tapped:', response.notification.request.content);

        // Handle deep linking based on notification data
        const data = response.notification.request.content.data;
        if (data?.threadId) {
          // Message notification: Navigate to Inbox tab first, then to chat thread
          router.push('/(tabs)/inbox');
          // Small delay to ensure tab is active before navigating to thread
          setTimeout(() => {
            router.push(`/chat/${data.threadId}`);
          }, 100);
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
                case 'OwnerDashboard':
                  router.push('/owner/my-farmstand');
                  break;
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
    clearReviewsOnce();
  }, [clearAllReviews]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="auth/login" options={{ headerShown: false }} />
        <Stack.Screen name="auth/signup" options={{ headerShown: false }} />
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
        <Stack.Screen name="owner/edit" options={{ headerShown: false }} />
        <Stack.Screen name="owner/products" options={{ headerShown: false }} />
        <Stack.Screen name="owner/hours" options={{ headerShown: false }} />
        <Stack.Screen name="owner/location" options={{ headerShown: false }} />
        <Stack.Screen name="owner/my-farmstand" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[threadId]" options={{ headerShown: false }} />
        <Stack.Screen name="review/[id]" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}



export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [showSplash, setShowSplash] = useState(true);
  const [splashAnimationComplete, setSplashAnimationComplete] = useState(false);

  // Bootstrap state
  const appReady = useBootstrapStore(selectAppReady);
  const bootstrapStatus = useBootstrapStore(selectBootstrapStatus);
  const bootstrap = useBootstrapStore((s) => s.bootstrap);
  const bootstrapStarted = useRef(false);

  const [fontsLoaded] = useFonts({
    LibreBaskerville_400Regular,
  });

  useEffect(() => {
    // Hide the native splash screen immediately since we show our custom one
    SplashScreen.hideAsync();
  }, []);

  // Start bootstrap ONCE when fonts are loaded
  useEffect(() => {
    if (fontsLoaded && !bootstrapStarted.current) {
      bootstrapStarted.current = true;
      console.log('[RootLayout] Starting bootstrap...');
      bootstrap();
    }
  }, [fontsLoaded, bootstrap]);

  // Handle splash animation complete
  const handleSplashComplete = () => {
    setSplashAnimationComplete(true);
    console.log('[RootLayout] Splash animation complete, appReady:', appReady);
  };

  // Only hide splash when BOTH animation is complete AND bootstrap is ready
  useEffect(() => {
    if (splashAnimationComplete && appReady) {
      console.log('[RootLayout] Both splash and bootstrap complete - showing app');
      setShowSplash(false);
    }
  }, [splashAnimationComplete, appReady]);

  // Show splash while loading fonts OR during bootstrap
  if (showSplash || !fontsLoaded) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="light" />
        <AnimatedSplash onAnimationComplete={handleSplashComplete} />
      </GestureHandlerRootView>
    );
  }

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
            <RootLayoutNav colorScheme={colorScheme} />
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </AuthProvider>
  );
}
