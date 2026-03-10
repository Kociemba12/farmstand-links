import React, { useCallback } from 'react';
import { Tabs, useFocusEffect } from 'expo-router';
import { Search, Map, Heart, User, MessageCircle } from 'lucide-react-native';
import { View, Text } from 'react-native';
import { useChatStore } from '@/lib/chat-store';
import { useUserStore } from '@/lib/user-store';
import { useAlertsStore } from '@/lib/alerts-store';

// Inbox tab icon with unread badge (messages + alerts)
function InboxTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const user = useUserStore(s => s.user);
  const loadChatData = useChatStore(s => s.loadChatData);
  const getTotalUnreadCount = useChatStore(s => s.getTotalUnreadCount);
  const loadAlerts = useAlertsStore(s => s.loadAlerts);
  const getUnreadAlertCount = useAlertsStore(s => s.getUnreadCount);

  // Load chat and alerts data when tab layout mounts
  useFocusEffect(
    useCallback(() => {
      loadChatData(user?.id ?? undefined);
      loadAlerts();
    }, [loadChatData, loadAlerts, user?.id])
  );

  const unreadMessages = user?.id ? getTotalUnreadCount(user.id) : 0;
  const unreadAlerts = getUnreadAlertCount();
  const totalUnread = unreadMessages + unreadAlerts;

  return (
    <View className="relative">
      <View className={`p-1.5 rounded-xl ${focused ? 'bg-mint/30' : ''}`}>
        <MessageCircle size={22} color={color} />
      </View>
      {totalUnread > 0 && (
        <View
          className="absolute -top-1 -right-1 bg-red-500 rounded-full items-center justify-center"
          style={{
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
          }}
        >
          <Text className="text-white text-[10px] font-bold">
            {totalUnread > 99 ? '99+' : totalUnread}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
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
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, focused }) => (
            <InboxTabIcon color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <View className={`p-1.5 rounded-xl ${focused ? 'bg-mint/30' : ''}`}>
              <User size={22} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
