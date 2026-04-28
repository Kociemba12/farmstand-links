import React, { useEffect, useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Image, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Store,
  Users,
  Flag,
  Settings,
  ChevronRight,
  ArrowLeft,
  ShieldCheck,
  Shield,
  Sparkles,
  MessageSquare,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { AdminGuard } from '@/components/AdminGuard';
import { useAdminStore } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import { usePromotionsStore } from '@/lib/promotions-store';
import { getValidSession } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';

// Background color constant
const BG_COLOR = '#FAF7F2';
const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

interface DashboardCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  count?: number;
  onPress: () => void;
  iconBgColor: string;
  delay?: number;
}

function DashboardCard({
  title,
  description,
  icon,
  count,
  onPress,
  iconBgColor,
  delay = 0,
}: DashboardCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(400)}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        className="bg-white rounded-[14px] p-5 mb-4 active:scale-[0.98]"
        style={{
          shadowColor: 'rgba(0, 0, 0, 1)',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.10,
          shadowRadius: 8,
          elevation: 3,
        }}
      >
        <View className="flex-row items-center">
          <View
            className="w-12 h-12 rounded-full items-center justify-center mr-4"
            style={{ backgroundColor: iconBgColor }}
          >
            {icon}
          </View>
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-lg font-semibold text-stone-900">{title}</Text>
              {count !== undefined && count > 0 && (
                <View className="ml-2 bg-stone-100 px-2.5 py-0.5 rounded-full">
                  <Text className="text-sm font-semibold text-stone-600">{count}</Text>
                </View>
              )}
            </View>
            <Text className="text-sm text-stone-500 mt-0.5">{description}</Text>
          </View>
          <ChevronRight size={20} color="#A8A29E" />
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

function AdminDashboardContent() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const loadAnalytics = useAdminStore((s) => s.loadAnalytics);
  const loadManagedUsers = useAdminStore((s) => s.loadManagedUsers);
  const allFarmstands = useAdminStore((s) => s.allFarmstands);
  // managedUsers is the single source of truth for the user count —
  // it's populated by loadManagedUsers() and shared with the Manage Users screen.
  const managedUsers = useAdminStore((s) => s.managedUsers);
  const isLoading = useAdminStore((s) => s.isLoading);
  const getReportsAndFlagsByStatus = useAdminStore((s) => s.getReportsAndFlagsByStatus);
  const getPromotionSummary = usePromotionsStore((s) => s.getPromotionSummary);

  // Analytics state - separate from allFarmstands to prevent flicker
  const totalFarmstands = useAdminStore((s) => s.analytics.totalFarmstands);
  const pendingApprovals = useAdminStore((s) => s.analytics.pendingApprovals);
  const analyticsLoading = useAdminStore((s) => s.analytics.isLoading);

  const [refreshing, setRefreshing] = useState(false);
  const [claimRequestCount, setClaimRequestCount] = useState(0);
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);

  // Fetch awaiting-review ownership claim count via backend API (service role key, bypasses RLS)
  // Uses same endpoint as the Claim Requests screen so both show the same count
  const loadClaimRequestCount = useCallback(async () => {
    try {
      console.log('[Dashboard] Loading ownership claim count via backend API...');
      const session = await getValidSession();
      if (!session?.access_token) {
        console.log('[Dashboard] loadClaimRequestCount: no session, skipping');
        setClaimRequestCount(0);
        return;
      }
      const resp = await fetch(`${BACKEND_URL}/api/admin/pending-claims`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!resp.ok) {
        console.log('[Dashboard] loadClaimRequestCount backend error:', resp.status);
        setClaimRequestCount(0);
        return;
      }
      const dct1 = resp.headers.get('content-type') ?? '';
      if (!dct1.includes('application/json')) {
        console.log('[Dashboard] loadClaimRequestCount non-JSON response (HTTP', resp.status, '), content-type:', dct1);
        setClaimRequestCount(0);
        return;
      }
      const json = await resp.json() as { success: boolean; claims?: unknown[] };
      const count = json.claims?.length ?? 0;
      console.log('[Dashboard] Pending ownership claim count:', count);
      setClaimRequestCount(count);
    } catch (err) {
      console.error('[Dashboard] loadClaimRequestCount exception:', err);
      setClaimRequestCount(0);
    }
  }, []);

  // Fetch unread feedback count from backend
  const loadNewFeedbackCount = useCallback(async () => {
    try {
      const session = await getValidSession();
      if (!session) return;
      const resp = await fetch(`${BACKEND_URL}/api/feedback?status=new`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) return;
      const dct2 = resp.headers.get('content-type') ?? '';
      if (!dct2.includes('application/json')) {
        console.log('[Dashboard] loadNewFeedbackCount non-JSON response (HTTP', resp.status, '), content-type:', dct2);
        return;
      }
      const json = await resp.json() as { success: boolean; data?: unknown[] };
      if (json.success && Array.isArray(json.data)) {
        setNewFeedbackCount(json.data.length);
      }
    } catch {
      // non-critical — silently ignore
    }
  }, []);

  // Load analytics ONLY on focus (single lifecycle hook, not both useEffect and useFocusEffect)
  useFocusEffect(
    useCallback(() => {
      console.log('[Dashboard] Screen focused - loading analytics');
      loadAnalytics();
      loadAdminData();
      loadManagedUsers();
      loadClaimRequestCount();
      loadNewFeedbackCount();
    }, [loadAnalytics, loadAdminData, loadManagedUsers, loadClaimRequestCount, loadNewFeedbackCount])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadAnalytics(), loadAdminData(), loadManagedUsers(), loadClaimRequestCount(), loadNewFeedbackCount()]);
    setRefreshing(false);
  }, [loadAnalytics, loadAdminData, loadManagedUsers, loadClaimRequestCount, loadNewFeedbackCount]);

  // Use analytics for main counts (prevents flicker)
  const userCount = managedUsers.length;
  const reportCount = getReportsAndFlagsByStatus('pending').length;
  const promoSummary = getPromotionSummary(allFarmstands);
  const activePromosCount = promoSummary.activeCount;

  return (
    <View className="flex-1" style={{ backgroundColor: BG_COLOR }}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#2F6F4E"
            colors={['#2F6F4E']}
          />
        }
      >
        {/* Hero Header */}
        <Animated.View entering={FadeIn.duration(500)}>
          <LinearGradient
            colors={['#2F6F4E', '#6FAF8E']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              paddingTop: 0,
              paddingBottom: 60,
              borderBottomLeftRadius: 28,
              borderBottomRightRadius: 28,
            }}
          >
            <SafeAreaView edges={['top']}>
              <View className="px-5 pt-4">
                {/* Back Button */}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.back();
                  }}
                  className="w-10 h-10 bg-white/20 rounded-full items-center justify-center mb-4"
                >
                  <ArrowLeft size={22} color="white" />
                </Pressable>

                {/* Admin Info */}
                <View className="items-center pb-4">
                  <View
                    className="w-16 h-16 rounded-full items-center justify-center mb-4"
                    style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
                  >
                    <Shield size={32} color="white" />
                  </View>
                  <Text className="text-white text-2xl font-bold">Admin Dashboard</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.85)' }} className="text-sm mt-1">
                    {user?.email || 'Administrator'}
                  </Text>
                </View>
              </View>
            </SafeAreaView>
          </LinearGradient>
        </Animated.View>

        {/* Stats Cards - overlapping hero */}
        <View className="px-5 -mt-10">
          <Animated.View
            entering={FadeInDown.delay(100).duration(400)}
            className="flex-row"
            style={{ gap: 12 }}
          >
            <View
              className="flex-1 bg-white rounded-2xl p-4"
              style={{
                shadowColor: 'rgba(0, 0, 0, 1)',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.10,
                shadowRadius: 8,
                elevation: 3,
              }}
            >
              <Text className="text-3xl font-bold text-green-600">{totalFarmstands}</Text>
              <Text className="text-sm text-stone-500 mt-1">Total Farmstands</Text>
            </View>
            <View
              className="flex-1 bg-white rounded-2xl p-4"
              style={{
                shadowColor: 'rgba(0, 0, 0, 1)',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.10,
                shadowRadius: 8,
                elevation: 3,
              }}
            >
              <Text className="text-3xl font-bold text-amber-500">{pendingApprovals}</Text>
              <Text className="text-sm text-stone-500 mt-1">Pending Approval</Text>
            </View>
          </Animated.View>
        </View>

        {/* Main Content */}
        <View className="px-5 pt-6">
          <SectionHeader title="Management" delay={200} />

          <DashboardCard
            title="Manage Farmstands"
            description="Approve, edit, and manage farmstand listings"
            icon={<Store size={24} color="#16a34a" />}
            count={totalFarmstands}
            onPress={() => router.push('/admin/farmstands')}
            iconBgColor="#DCFCE7"
            delay={250}
          />

          <DashboardCard
            title="Ownership Claims"
            description="Review requests to own an existing farmstand"
            icon={<ShieldCheck size={24} color="#8b5cf6" />}
            count={claimRequestCount}
            onPress={() => router.push('/admin/claim-requests')}
            iconBgColor="#EDE9FE"
            delay={350}
          />

          <DashboardCard
            title="Promotions"
            description="Feature farmstands on Explore & Map"
            icon={<Sparkles size={24} color="#f97316" />}
            count={activePromosCount}
            onPress={() => router.push('/admin/promotions')}
            iconBgColor="#FFEDD5"
            delay={375}
          />

          <SectionHeader title="Users & Content" delay={400} />

          <DashboardCard
            title="Manage Users"
            description="View and manage user accounts"
            icon={<Users size={24} color="#3b82f6" />}
            count={userCount}
            onPress={() => router.push('/admin/users')}
            iconBgColor="#DBEAFE"
            delay={450}
          />

          <DashboardCard
            title="Reports & Flags"
            description="Review flagged content and reports"
            icon={<Flag size={24} color="#ef4444" />}
            count={reportCount}
            onPress={() => router.push('/admin/reports-and-flags')}
            iconBgColor="#FEE2E2"
            delay={500}
          />

          <DashboardCard
            title="Feedback & Support"
            description="View user feedback and help requests"
            icon={<MessageSquare size={24} color="#0891b2" />}
            count={newFeedbackCount}
            onPress={() => router.push('/admin/feedback')}
            iconBgColor="#CFFAFE"
            delay={525}
          />

          <SectionHeader title="Settings" delay={550} />

          <DashboardCard
            title="Admin Settings"
            description="Admin settings and preferences"
            icon={<Settings size={24} color="#6b7280" />}
            onPress={() => router.push('/admin/settings')}
            iconBgColor="#F3F4F6"
            delay={600}
          />
        </View>
      </ScrollView>
    </View>
  );
}

export default function AdminDashboard() {
  return (
    <AdminGuard>
      <AdminDashboardContent />
    </AdminGuard>
  );
}
