import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { useAdminStatusStore, AdminStatus } from '@/lib/admin-status-store';
import { getValidSession, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * AdminGuard - Protects admin routes
 *
 * SINGLE SOURCE OF TRUTH: Admin access requires BOTH:
 * 1. email === "contact@farmstand.online"
 * 2. A valid Supabase session in SecureStore (so admin actions can actually execute)
 *
 * If the Supabase session is missing, we show "Sign In Required" so the admin
 * can re-authenticate — this prevents the zombie state where isLoggedIn=true
 * (farmstand_logged_in flag) but no session exists, causing all RPCs to fail.
 */
export function AdminGuard({ children }: AdminGuardProps) {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);

  // AuthProvider loading flag — true until SecureStore session has been read on boot
  const { loading: authLoading } = useAuth();

  const adminStatus = useAdminStatusStore((s) => s.status);
  const checkAdminStatus = useAdminStatusStore((s) => s.checkAdminStatus);
  const lastCheckedEmail = useAdminStatusStore((s) => s.lastCheckedEmail);

  // Session validation state
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(false);

  // Check if user email is the admin email (synchronous check)
  const isAdmin = isAdminEmail(user?.email);

  // Verify Supabase session exists (async) whenever the component mounts or user changes.
  // Wait for AuthProvider to finish its boot-time SecureStore read before checking.
  useEffect(() => {
    // Don't start session check until AuthProvider has finished loading
    if (authLoading) return;

    let mounted = true;

    const checkSession = async () => {
      setSessionChecked(false);
      if (!isSupabaseConfigured()) {
        // If Supabase isn't configured, session check is not required
        if (mounted) { setHasValidSession(true); setSessionChecked(true); }
        return;
      }
      const session = await getValidSession();
      console.log('[AdminGuard] Supabase session check: hasSession=' + !!(session?.access_token)
        + ', expires_at=' + (session?.expires_at ?? 'N/A')
        + ', refresh_token exists=' + !!(session?.refresh_token));
      if (mounted) {
        const valid = !!(session?.access_token);
        setHasValidSession(valid);
        setSessionChecked(true);
      }
    };

    if (isAdmin && isLoggedIn) {
      checkSession();
    } else {
      setSessionChecked(true);
      setHasValidSession(false);
    }

    return () => { mounted = false; };
  }, [authLoading, isAdmin, isLoggedIn, user?.email]);

  // Check admin status when user email changes
  useEffect(() => {
    const userEmail = user?.email?.toLowerCase().trim();
    if (userEmail && userEmail !== lastCheckedEmail) {
      checkAdminStatus(user?.email);
    } else if (!user?.email && adminStatus === 'loading') {
      checkAdminStatus(null);
    }
  }, [user?.email, lastCheckedEmail, checkAdminStatus, adminStatus]);

  // Redirect non-admin users to profile
  useEffect(() => {
    if (isLoggedIn && user && !isAdmin && adminStatus === 'not_admin') {
      console.log('[AdminGuard] Non-admin user trying to access admin route, redirecting to profile');
      router.replace('/(tabs)/profile');
    }
  }, [isLoggedIn, user, isAdmin, adminStatus, router]);

  // Boot guard: AuthProvider is still reading SecureStore — hold before making any auth decision
  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-sm text-gray-500 mt-4">Loading session...</Text>
      </View>
    );
  }

  // Not logged in - show login required message
  if (!isLoggedIn || !user) {
    return (
      <View className="flex-1 items-center justify-center bg-white p-6">
        <Text className="text-lg font-semibold text-gray-900 text-center">
          Login Required
        </Text>
        <Text className="text-sm text-gray-500 text-center mt-2">
          Please log in to access the Admin Dashboard.
        </Text>
        <Pressable
          onPress={() => router.replace('/auth/login')}
          className="mt-6 bg-green-700 px-8 py-3 rounded-xl"
        >
          <Text className="text-white font-semibold text-base">Go to Sign In</Text>
        </Pressable>
      </View>
    );
  }

  // User is admin email — but first verify Supabase session
  if (isAdmin) {
    // Still checking session
    if (!sessionChecked) {
      return (
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator size="large" color="#16a34a" />
          <Text className="text-sm text-gray-500 mt-4">Verifying session...</Text>
        </View>
      );
    }

    // Admin email confirmed but NO valid Supabase session — block admin actions
    if (!hasValidSession) {
      return (
        <View className="flex-1 items-center justify-center bg-white p-6">
          <Text className="text-lg font-semibold text-gray-900 text-center">
            Session Expired
          </Text>
          <Text className="text-sm text-gray-500 text-center mt-2">
            Your admin session has expired or is missing from this device.{'\n'}
            Please sign in again to continue.
          </Text>
          <Pressable
            onPress={() => router.replace('/auth/login')}
            className="mt-6 bg-green-700 px-8 py-3 rounded-xl"
          >
            <Text className="text-white font-semibold text-base">Sign In Again</Text>
          </Pressable>
        </View>
      );
    }

    // Valid session confirmed — render admin content
    return <>{children}</>;
  }

  // Still checking (only briefly while email is being processed)
  if (adminStatus === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-sm text-gray-500 mt-4">Checking access...</Text>
      </View>
    );
  }

  // User is NOT admin - show message while redirecting
  return (
    <View className="flex-1 items-center justify-center bg-white p-6">
      <Text className="text-lg font-semibold text-gray-900 text-center">
        Not Authorized
      </Text>
      <Text className="text-sm text-gray-500 text-center mt-2">
        Admin access is restricted to contact@farmstand.online
      </Text>
    </View>
  );
}

/**
 * Helper hook to get admin status
 * ONLY checks email === "contact@farmstand.online"
 */
export function useIsAdmin(): { status: AdminStatus; isAdmin: boolean; isLoading: boolean } {
  const status = useAdminStatusStore((s) => s.status);
  const user = useUserStore((s) => s.user);

  // Admin is determined ONLY by email
  const isAdmin = isAdminEmail(user?.email);

  return {
    status: isAdmin ? 'admin' : status,
    isAdmin,
    isLoading: !isAdmin && status === 'loading',
  };
}
