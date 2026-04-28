import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, Switch, Image, Modal, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Leaf,
  ShoppingBag,
  Heart,
  Gift,
  Smartphone,
  MessageSquare,
  Store,
  Trash2,
  Bell,
} from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useUserStore } from '@/lib/user-store';
import { useChatStore, ChatThread } from '@/lib/chat-store';
import * as Haptics from 'expo-haptics';
import { updateNotificationPrefs } from '@/lib/push-notifications';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DELETE_THRESHOLD = 80;
const FULL_SWIPE_THRESHOLD = SCREEN_WIDTH * 0.4;

// Format timestamp for thread display
function formatThreadTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Swipeable thread list item component
function SwipeableThreadListItem({
  thread,
  unreadCount,
  onPress,
  onDelete,
  index,
}: {
  thread: ChatThread;
  unreadCount: number;
  onPress: () => void;
  onDelete: () => void;
  index: number;
}) {
  const hasUnread = unreadCount > 0;
  const translateX = useSharedValue(0);
  const rowHeight = useSharedValue(72);
  const rowOpacity = useSharedValue(1);
  const isDeleting = useSharedValue(false);

  const triggerDelete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDelete();
  }, [onDelete]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((event) => {
      // Only allow left swipe (negative values)
      if (event.translationX < 0) {
        translateX.value = Math.max(event.translationX, -SCREEN_WIDTH * 0.5);
      } else {
        translateX.value = 0;
      }
    })
    .onEnd((event) => {
      // Full swipe - trigger delete
      if (translateX.value < -FULL_SWIPE_THRESHOLD) {
        isDeleting.value = true;
        translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 });
        rowHeight.value = withTiming(0, { duration: 200 });
        rowOpacity.value = withTiming(0, { duration: 200 }, () => {
          runOnJS(triggerDelete)();
        });
      }
      // Partial swipe - snap to show delete button or back
      else if (translateX.value < -DELETE_THRESHOLD / 2) {
        translateX.value = withSpring(-DELETE_THRESHOLD, { damping: 20 });
      } else {
        translateX.value = withSpring(0, { damping: 20 });
      }
    });

  const tapGesture = Gesture.Tap()
    .onStart(() => {
      if (translateX.value < -10) {
        // If swiped, close it
        translateX.value = withSpring(0, { damping: 20 });
      } else {
        // Normal tap
        runOnJS(onPress)();
      }
    });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const rowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    height: rowHeight.value,
    opacity: rowOpacity.value,
    overflow: 'hidden',
  }));

  const deleteButtonAnimatedStyle = useAnimatedStyle(() => {
    const width = interpolate(
      translateX.value,
      [-SCREEN_WIDTH * 0.5, -DELETE_THRESHOLD, 0],
      [SCREEN_WIDTH * 0.5, DELETE_THRESHOLD, 0],
      Extrapolation.CLAMP
    );
    const opacity = interpolate(
      translateX.value,
      [-DELETE_THRESHOLD, -20, 0],
      [1, 0.5, 0],
      Extrapolation.CLAMP
    );
    return {
      width,
      opacity,
    };
  });

  const handleDeleteButtonPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    isDeleting.value = true;
    translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 });
    rowHeight.value = withTiming(0, { duration: 200 });
    rowOpacity.value = withTiming(0, { duration: 200 }, () => {
      runOnJS(triggerDelete)();
    });
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).duration(300)}
      style={containerAnimatedStyle}
    >
      <View className="relative flex-row">
        {/* Delete button behind */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: '#DC2626',
              justifyContent: 'center',
              alignItems: 'center',
            },
            deleteButtonAnimatedStyle,
          ]}
        >
          <Pressable
            onPress={handleDeleteButtonPress}
            className="flex-1 w-full items-center justify-center"
          >
            <Trash2 size={22} color="#FFFFFF" />
            <Text className="text-white text-xs font-semibold mt-1">Delete</Text>
          </Pressable>
        </Animated.View>

        {/* Main row content */}
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            style={[{ width: '100%', backgroundColor: hasUnread ? 'rgba(123, 166, 141, 0.05)' : '#FFFFFF' }, rowAnimatedStyle]}
          >
            <View
              className={`flex-row items-center px-4 py-4 border-b border-stone-100`}
            >
              {/* Farmstand Photo */}
              <View className="relative">
                <View className="w-14 h-14 rounded-full bg-stone-100 items-center justify-center overflow-hidden">
                  {thread.farmstandPhotoUrl ? (
                    <Image
                      source={{ uri: thread.farmstandPhotoUrl }}
                      className="w-14 h-14"
                      resizeMode="cover"
                    />
                  ) : (
                    <Store size={24} color="#78716C" />
                  )}
                </View>
                {/* Unread badge dot */}
                {hasUnread && (
                  <View className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-rust rounded-full items-center justify-center border-2 border-white">
                    {unreadCount > 0 && unreadCount <= 9 && (
                      <Text className="text-white text-[10px] font-bold">{unreadCount}</Text>
                    )}
                  </View>
                )}
              </View>

              {/* Thread Info */}
              <View className="flex-1 ml-3">
                <View className="flex-row items-center justify-between">
                  <Text
                    className={`text-base ${hasUnread ? 'font-bold text-stone-900' : 'font-medium text-stone-800'}`}
                    numberOfLines={1}
                  >
                    {thread.farmstandName}
                  </Text>
                  <Text className={`text-xs ${hasUnread ? 'text-forest font-semibold' : 'text-stone-400'}`}>
                    {formatThreadTime(thread.lastMessageAt)}
                  </Text>
                </View>
                <Text
                  className={`text-sm mt-0.5 ${hasUnread ? 'text-stone-700 font-medium' : 'text-stone-500'}`}
                  numberOfLines={1}
                >
                  {thread.lastMessageText || 'No messages yet'}
                </Text>
              </View>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// Tab button component
function TabButton({
  label,
  isActive,
  onPress,
  badge,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 py-3 items-center justify-center ${
        isActive ? 'border-b-2 border-forest' : 'border-b-2 border-transparent'
      }`}
    >
      <View className="flex-row items-center">
        <Text
          className={`text-base ${isActive ? 'text-forest font-semibold' : 'text-stone-500 font-medium'}`}
        >
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View className="ml-2 bg-rust rounded-full px-1.5 py-0.5 min-w-[20px] items-center">
            <Text className="text-white text-xs font-bold">{badge > 99 ? '99+' : badge}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

// Delete confirmation modal
function DeleteConfirmationModal({
  visible,
  onCancel,
  onConfirm,
  farmstandName,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  farmstandName: string;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        className="flex-1 bg-black/40 items-center justify-center"
        onPress={onCancel}
      >
        <Pressable
          className="bg-white rounded-2xl mx-8 overflow-hidden w-[85%] max-w-[420px]"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="p-6">
            <Text className="text-lg font-semibold text-stone-900 text-center">
              Delete conversation?
            </Text>
            <Text className="text-sm text-stone-500 text-center mt-2 leading-5">
              This will remove the conversation with {farmstandName} from your inbox.
            </Text>
          </View>
          <View className="flex-row border-t border-stone-100">
            <Pressable
              onPress={onCancel}
              className="flex-1 py-4 items-center border-r border-stone-100 active:bg-stone-50"
            >
              <Text className="text-base font-medium text-stone-600">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              className="flex-1 py-4 items-center active:bg-red-50"
            >
              <Text className="text-base font-semibold text-red-600">Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'messages' | 'alerts'>('messages');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [threadToDelete, setThreadToDelete] = useState<ChatThread | null>(null);

  // User store
  const user = useUserStore(s => s.user);
  const notifications = useUserStore(s => s.notifications);
  const updateNotifications = useUserStore(s => s.updateNotifications);

  // Chat store
  const loadChatData = useChatStore(s => s.loadChatData);
  const getThreadsForUser = useChatStore(s => s.getThreadsForUser);
  const getUnreadCountForThread = useChatStore(s => s.getUnreadCountForThread);
  const getTotalUnreadCount = useChatStore(s => s.getTotalUnreadCount);
  const hideThreadForUser = useChatStore(s => s.hideThreadForUser);

  // Load chat data on focus
  useFocusEffect(
    useCallback(() => {
      loadChatData(user?.id ?? undefined);
    }, [loadChatData, user?.id])
  );

  // Get user's threads
  const threads = user?.id ? getThreadsForUser(user.id) : [];
  const totalUnread = user?.id ? getTotalUnreadCount(user.id) : 0;

  const notificationItems = [
    {
      key: 'messages' as const,
      icon: Bell,
      title: 'Message Notifications',
      description: 'Get notified when someone messages your farmstand',
      isPrimary: true,
    },
    {
      key: 'newFarmstands' as const,
      icon: Leaf,
      title: 'New Farm Stands',
      description: 'Get notified when new farm stands open near you',
    },
    {
      key: 'seasonalProducts' as const,
      icon: ShoppingBag,
      title: 'Seasonal Products',
      description: 'Alerts for seasonal produce availability',
    },
    {
      key: 'savedFarmUpdates' as const,
      icon: Heart,
      title: 'Saved Farm Updates',
      description: 'Updates from your saved farm stands',
    },
    {
      key: 'promotions' as const,
      icon: Gift,
      title: 'Promotions & Deals',
      description: 'Special offers and discounts',
    },
    {
      key: 'appUpdates' as const,
      icon: Smartphone,
      title: 'App Updates',
      description: 'New features and improvements',
    },
  ];

  const handleToggle = async (key: keyof typeof notifications) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newValue = !notifications[key];

    // Update local state
    updateNotifications({ [key]: newValue });

    // Sync to Supabase (fire and forget - don't block UI)
    if (user?.id && user.id !== 'guest') {
      // Map local key names to Supabase column names (snake_case)
      const supabaseKeyMap: Record<string, string> = {
        messages: 'messages',
        newFarmstands: 'new_farmstands',
        seasonalProducts: 'seasonal_products',
        savedFarmUpdates: 'saved_farm_updates',
        promotions: 'promotions',
        appUpdates: 'app_updates',
      };

      const supabaseKey = supabaseKeyMap[key];
      if (supabaseKey) {
        updateNotificationPrefs(user.id, { [supabaseKey]: newValue }).catch((err) => {
          console.log('[Notifications] Failed to sync pref to Supabase:', err);
        });
      }
    }
  };

  const handleTabChange = (tab: 'messages' | 'alerts') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  };

  const handleThreadPress = (thread: ChatThread) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/chat/${thread.id}`);
  };

  const handleDeleteRequest = (thread: ChatThread) => {
    setThreadToDelete(thread);
    setDeleteModalVisible(true);
  };

  const handleDeleteCancel = () => {
    setDeleteModalVisible(false);
    setThreadToDelete(null);
  };

  const handleDeleteConfirm = async () => {
    if (!threadToDelete || !user || !user.id) return;

    await hideThreadForUser(threadToDelete.id, user.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDeleteModalVisible(false);
    setThreadToDelete(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FDF8F3' }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FDF8F3' }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}>
          <Pressable onPress={() => router.back()} style={{ marginBottom: 12, alignSelf: 'flex-start', padding: 2, marginLeft: -2 }}>
            <ArrowLeft size={22} color="#4A7C59" />
          </Pressable>
          <Text style={{ fontSize: 26, fontWeight: '700', color: '#2C2420', letterSpacing: -0.3 }}>Notifications</Text>
          <Text style={{ fontSize: 14, color: '#A8906E', marginTop: 2 }}>Manage your notification preferences</Text>
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: 'row', backgroundColor: '#FDF8F3', borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}>
          <TabButton
            label="Messages"
            isActive={activeTab === 'messages'}
            onPress={() => handleTabChange('messages')}
            badge={totalUnread}
          />
          <TabButton
            label="Alerts"
            isActive={activeTab === 'alerts'}
            onPress={() => handleTabChange('alerts')}
          />
        </View>
      </SafeAreaView>

      {/* Content */}
      {activeTab === 'messages' ? (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {threads.length === 0 ? (
            <Animated.View
              entering={FadeIn.delay(200)}
              className="flex-1 items-center justify-center py-20 px-8"
            >
              <View className="w-20 h-20 rounded-full bg-stone-100 items-center justify-center mb-4">
                <MessageSquare size={40} color="#78716C" />
              </View>
              <Text className="text-stone-700 text-lg font-semibold text-center">
                No messages yet
              </Text>
              <Text className="text-stone-500 text-sm text-center mt-2 leading-5">
                Message a farmstand to ask about products, hours, or availability.
              </Text>
            </Animated.View>
          ) : (
            <View className="bg-white">
              {threads.map((thread, index) => (
                <SwipeableThreadListItem
                  key={thread.id}
                  thread={thread}
                  unreadCount={user?.id ? getUnreadCountForThread(thread.id, user.id) : 0}
                  onPress={() => handleThreadPress(thread)}
                  onDelete={() => handleDeleteRequest(thread)}
                  index={index}
                />
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 }}>
            <Text style={{ fontSize: 13, color: '#A8906E', marginBottom: 14 }}>
              Choose which notifications you'd like to receive
            </Text>
            <View style={{ backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', shadowColor: 'rgba(0,0,0,0.05)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 }}>
              {notificationItems.map((item, index) => (
                <View
                  key={item.key}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 18, paddingVertical: 15,
                    ...(index !== notificationItems.length - 1 ? { borderBottomWidth: 1, borderBottomColor: '#F5F0EA' } : {}),
                  }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDF4EF', alignItems: 'center', justifyContent: 'center' }}>
                    <item.icon size={19} color="#4A7C59" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 14, marginRight: 12 }}>
                    <Text style={{ fontSize: 15, fontWeight: '500', color: '#2C2420' }}>{item.title}</Text>
                    <Text style={{ fontSize: 13, color: '#A8906E', marginTop: 2 }}>{item.description}</Text>
                  </View>
                  <Switch
                    value={notifications[item.key]}
                    onValueChange={() => handleToggle(item.key)}
                    trackColor={{ false: '#E8DDD4', true: '#7BA68D' }}
                    thumbColor={notifications[item.key] ? '#4A7C59' : '#C4B5A5'}
                  />
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        visible={deleteModalVisible}
        onCancel={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        farmstandName={threadToDelete?.farmstandName ?? ''}
      />
    </View>
  );
}
