import React, { useEffect, useRef } from 'react';
import { Tabs } from 'expo-router';
import { trackEvent } from '@/lib/track';
import { Search, Map, Heart, User, MessageCircle } from 'lucide-react-native';
import { View, Text, AppState, type AppStateStatus } from 'react-native';
import { useChatStore } from '@/lib/chat-store';
import { useAlertsStore } from '@/lib/alerts-store';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { useSupportUnreadStore } from '@/lib/support-unread-store';
import { useAdminUnreadStore } from '@/lib/admin-unread-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isUuid(v: string | null | undefined): boolean {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// ─── Global unread-count boot hook ───────────────────────────────────────────
// Fetches unread message + alert counts as soon as a real user is available,
// and re-fetches whenever the app returns to the foreground.
// This ensures the Inbox tab badge is visible immediately on app open,
// without requiring the user to tap the Inbox tab first.

function useInboxBadgeInit() {
  const currentUserId = useUserStore(s => s.user?.id ?? null);
  const loadAlerts = useAlertsStore(s => s.loadAlerts);
  const fetchUnreadMessageCount = useChatStore(s => s.fetchUnreadMessageCount);
  const prevUserIdRef = useRef<string | null>(null);

  const refresh = useRef(() => {
    const uid = useUserStore.getState().user?.id ?? null;
    if (!isUuid(uid)) return;
    console.log('[InboxBadge] Refreshing unread counts for user:', uid);
    loadAlerts(uid ?? undefined);
    fetchUnreadMessageCount();
  });

  // Keep refresh ref up to date
  useEffect(() => {
    refresh.current = () => {
      const uid = useUserStore.getState().user?.id ?? null;
      if (!isUuid(uid)) return;
      console.log('[InboxBadge] Refreshing unread counts for user:', uid);
      loadAlerts(uid ?? undefined);
      fetchUnreadMessageCount();
    };
  }, [loadAlerts, fetchUnreadMessageCount]);

  // Trigger on user change (covers login + cold launch with existing session)
  useEffect(() => {
    if (!isUuid(currentUserId)) return;
    if (currentUserId === prevUserIdRef.current) return;
    prevUserIdRef.current = currentUserId;
    console.log('[InboxBadge] User ready — fetching initial unread counts, userId:', currentUserId);
    loadAlerts(currentUserId ?? undefined);
    fetchUnreadMessageCount();
  }, [currentUserId, loadAlerts, fetchUnreadMessageCount]);

  // Trigger on app foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        console.log('[InboxBadge] App became active — refreshing unread counts');
        refresh.current();
      }
    });
    return () => sub.remove();
  }, []);

  // Poll every 30 seconds so badge updates without requiring navigation
  useEffect(() => {
    const interval = setInterval(() => {
      refresh.current();
    }, 30_000);
    return () => clearInterval(interval);
  }, []);
}

// ─── Support unread boot hook ─────────────────────────────────────────────────
// Fetches unread support reply count on user login and app foreground.

function useSupportUnreadInit() {
  const currentUserId = useUserStore(s => s.user?.id ?? null);
  const fetchUnreadCount = useSupportUnreadStore(s => s.fetchUnreadCount);
  const prevUserIdRef = useRef<string | null>(null);

  const refresh = useRef(() => {
    const uid = useUserStore.getState().user?.id ?? null;
    if (!uid) return;
    fetchUnreadCount();
  });

  useEffect(() => {
    refresh.current = () => {
      const uid = useUserStore.getState().user?.id ?? null;
      if (!uid) return;
      fetchUnreadCount();
    };
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (!currentUserId) return;
    if (currentUserId === prevUserIdRef.current) return;
    prevUserIdRef.current = currentUserId;
    fetchUnreadCount();
  }, [currentUserId, fetchUnreadCount]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refresh.current();
    });
    return () => sub.remove();
  }, []);
}

// ─── Admin unread boot hook ───────────────────────────────────────────────────
// Fetches admin-unread support ticket count when the current user is an admin.

function useAdminUnreadInit() {
  const currentUser = useUserStore(s => s.user);
  const fetchAdminUnreadCount = useAdminUnreadStore(s => s.fetchAdminUnreadCount);
  const prevUserIdRef = useRef<string | null>(null);

  const refresh = useRef(() => {
    const user = useUserStore.getState().user;
    if (!isAdminEmail(user?.email)) return;
    fetchAdminUnreadCount();
  });

  useEffect(() => {
    refresh.current = () => {
      const user = useUserStore.getState().user;
      if (!isAdminEmail(user?.email)) return;
      fetchAdminUnreadCount();
    };
  }, [fetchAdminUnreadCount]);

  useEffect(() => {
    if (!currentUser?.id) return;
    if (!isAdminEmail(currentUser.email)) return;
    if (currentUser.id === prevUserIdRef.current) return;
    prevUserIdRef.current = currentUser.id;
    if (__DEV__) console.log('[AdminUnreadBadge] admin user ready — fetching admin unread count');
    fetchAdminUnreadCount();
  }, [currentUser, fetchAdminUnreadCount]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refresh.current();
    });
    return () => sub.remove();
  }, []);
}

// Profile tab icon with support unread badge
function ProfileTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const user = useUserStore(s => s.user);
  const userUnreadCount = useSupportUnreadStore(s => s.unreadCount);
  const adminUnreadCount = useAdminUnreadStore(s => s.adminUnreadCount);

  const isAdmin = isAdminEmail(user?.email);
  const badgeCount = isAdmin ? adminUnreadCount : userUnreadCount;

  if (__DEV__ && isAdmin) console.log('[ProfileTabBadge] admin=true | adminUnreadCount:', adminUnreadCount, '| showing badge:', badgeCount > 0);

  return (
    <View style={{ position: 'relative' }}>
      <View className={`p-1.5 rounded-xl ${focused ? 'bg-mint/30' : ''}`}>
        <User size={22} color={color} />
      </View>
      {badgeCount > 0 && (
        <View
          className="absolute -top-1 -right-1 bg-red-500 rounded-full items-center justify-center"
          style={{ minWidth: 18, height: 18, paddingHorizontal: 4 }}
        >
          <Text className="text-white text-[10px] font-bold">
            {badgeCount > 9 ? '9+' : badgeCount}
          </Text>
        </View>
      )}
    </View>
  );
}

// Inbox tab icon with unread badge (messages + alerts combined, no unreadLoaded gate)
function InboxTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const totalUnreadMessages = useChatStore(s => s.totalUnreadMessages);
  const alerts = useAlertsStore(s => s.alerts);
  const unreadAlerts = alerts.filter(a => a.read_at === null).length;
  const totalUnread = (totalUnreadMessages ?? 0) + unreadAlerts;

  if (__DEV__) console.log('[InboxTabBadge]', { totalUnreadMessages, unreadAlerts, totalUnread });

  return (
    <View className="relative">
      <View className={`p-1.5 rounded-xl ${focused ? 'bg-mint/30' : ''}`}>
        <MessageCircle size={22} color={color} />
      </View>
      {totalUnread > 0 && (
        <View
          className="absolute -top-1 -right-1 bg-red-500 rounded-full items-center justify-center"
          style={{ minWidth: 18, height: 18, paddingHorizontal: 4 }}
        >
          <Text className="text-white text-[10px] font-bold">
            {totalUnread > 9 ? '9+' : totalUnread}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  useInboxBadgeInit();
  useSupportUnreadInit();
  useAdminUnreadInit();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2D5A3D', // forest
        tabBarInactiveTintColor: '#8B6F4E', // wood
        tabBarStyle: {
          backgroundColor: '#FDF8F3', // cream
          borderTopColor: '#E8DDD4', // sand
          borderTopWidth: 1,
          paddingTop: 8,
          paddingBottom: 8,
          height: 88,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, focused }) => (
            <View className={`p-1.5 rounded-xl ${focused ? 'bg-mint/30' : ''}`}>
              <Search size={22} color={color} />
            </View>
          ),
        }}
        listeners={{ tabPress: () => trackEvent('navigation_tapped', { destination: 'explore' }) }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, focused }) => (
            <View className={`p-1.5 rounded-xl ${focused ? 'bg-mint/30' : ''}`}>
              <Map size={22} color={color} />
            </View>
          ),
        }}
        listeners={{ tabPress: () => trackEvent('navigation_tapped', { destination: 'map' }) }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color, focused }) => (
            <View className={`p-1.5 rounded-xl ${focused ? 'bg-mint/30' : ''}`}>
              <Heart size={22} color={color} />
            </View>
          ),
        }}
        listeners={{ tabPress: () => trackEvent('navigation_tapped', { destination: 'saved' }) }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, focused }) => (
            <InboxTabIcon color={color} focused={focused} />
          ),
        }}
        listeners={{ tabPress: () => trackEvent('navigation_tapped', { destination: 'inbox' }) }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <ProfileTabIcon color={color} focused={focused} />
          ),
        }}
        listeners={{ tabPress: () => trackEvent('navigation_tapped', { destination: 'profile' }) }}
      />
    </Tabs>
  );
}
