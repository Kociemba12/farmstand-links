import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Image, Modal, Dimensions, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MessageSquare,
  Store,
  Trash2,
  Bell,
  CheckCircle,
  XCircle,
  Star,
  Flag,
  Megaphone,
  HandMetal,
} from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolate,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useUserStore } from '@/lib/user-store';
import { useChatStore } from '@/lib/chat-store';
import { useAlertsStore, Alert, AlertType, formatAlertTime, getAlertColor } from '@/lib/alerts-store';
import { getSupabaseConfigStatus, supabase, isSupabaseConfigured, getValidSession } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';

// ─── Conversation row from the `conversations` Supabase table ────────────────
interface Conversation {
  id: string;
  farmstand_id: string;
  farmstand_name: string;
  farmstand_photo_url: string | null;
  owner_id: string;
  customer_id: string;
  last_message_text: string;
  last_message_at: string;
  owner_unread_count: number;
  customer_unread_count: number;
  thread_id: string | null; // link to chat_threads.id if present
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DELETE_THRESHOLD = 80;
const FULL_SWIPE_THRESHOLD = SCREEN_WIDTH * 0.4;

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
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getAlertIconComponent(type: AlertType | null) {
  switch (type) {
    case 'claim_request': return HandMetal;
    case 'claim_approved': return CheckCircle;
    case 'claim_denied': return XCircle;
    case 'review_new': return Star;
    case 'listing_flagged': return Flag;
    case 'platform_announcement': return Megaphone;
    default: return Bell;
  }
}

// ─── Tab Button ──────────────────────────────────────────────────────────────
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
      style={{
        flex: 1,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderBottomWidth: 2,
        borderBottomColor: isActive ? '#2D5A3D' : 'transparent',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text
          style={{
            fontSize: 15,
            fontWeight: isActive ? '600' : '500',
            color: isActive ? '#2D5A3D' : '#A8A29E',
            letterSpacing: 0.1,
          }}
        >
          {label}
        </Text>
        {badge !== undefined && badge > 0 && (
          <View
            style={{
              marginLeft: 6,
              backgroundColor: '#4A7C59',
              borderRadius: 10,
              minWidth: 18,
              height: 18,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 5,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
              {badge > 99 ? '99+' : badge}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ─── Swipeable Thread Row ─────────────────────────────────────────────────────
function SwipeableThreadListItem({
  conversation,
  unreadCount,
  onPress,
  onDelete,
  index,
}: {
  conversation: Conversation;
  unreadCount: number;
  onPress: () => void;
  onDelete: () => void;
  index: number;
}) {
  const hasUnread = unreadCount > 0;
  const translateX = useSharedValue(0);
  const rowHeight = useSharedValue(76);
  const rowOpacity = useSharedValue(1);

  const triggerDelete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDelete();
  }, [onDelete]);

  const resetSwipe = useCallback(() => {
    translateX.value = withSpring(0, { damping: 20 });
  }, [translateX]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((e) => {
      if (e.translationX < 0) {
        translateX.value = Math.max(e.translationX, -SCREEN_WIDTH * 0.5);
      } else {
        translateX.value = 0;
      }
    })
    .onEnd(() => {
      if (translateX.value < -FULL_SWIPE_THRESHOLD) {
        runOnJS(triggerDelete)();
        runOnJS(resetSwipe)();
      } else if (translateX.value < -DELETE_THRESHOLD / 2) {
        translateX.value = withSpring(-DELETE_THRESHOLD, { damping: 20 });
      } else {
        translateX.value = withSpring(0, { damping: 20 });
      }
    });

  const tapGesture = Gesture.Tap().onStart(() => {
    if (translateX.value < -10) {
      translateX.value = withSpring(0, { damping: 20 });
    } else {
      runOnJS(onPress)();
    }
  });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const containerStyle = useAnimatedStyle(() => ({ height: rowHeight.value, opacity: rowOpacity.value, overflow: 'hidden' }));
  const deleteStyle = useAnimatedStyle(() => ({
    width: interpolate(translateX.value, [-SCREEN_WIDTH * 0.5, -DELETE_THRESHOLD, 0], [SCREEN_WIDTH * 0.5, DELETE_THRESHOLD, 0], Extrapolation.CLAMP),
    opacity: interpolate(translateX.value, [-DELETE_THRESHOLD, -20, 0], [1, 0.5, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View entering={FadeInDown.delay(index * 50).duration(300)} style={containerStyle}>
      <View style={{ position: 'relative', flexDirection: 'row' }}>
        {/* Delete action */}
        <Animated.View
          style={[{
            position: 'absolute', right: 0, top: 0, bottom: 0,
            backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
          }, deleteStyle]}
        >
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); translateX.value = withSpring(0, { damping: 20 }); onDelete(); }}
            style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={20} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 3 }}>Delete</Text>
          </Pressable>
        </Animated.View>

        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[{ width: '100%', backgroundColor: hasUnread ? 'rgba(74,124,89,0.04)' : '#FFFFFF' }, rowStyle]}>
            <View
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 20, paddingVertical: 14,
                borderBottomWidth: 1, borderBottomColor: '#F5F0EA',
              }}
            >
              {/* Avatar */}
              <View style={{ position: 'relative' }}>
                <View style={{
                  width: 52, height: 52, borderRadius: 26,
                  backgroundColor: '#F0EBE3', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {conversation.farmstand_photo_url ? (
                    <Image source={{ uri: conversation.farmstand_photo_url }} style={{ width: 52, height: 52 }} resizeMode="cover" />
                  ) : (
                    <Store size={22} color="#A8906E" />
                  )}
                </View>
                {hasUnread && (
                  <View style={{
                    position: 'absolute', top: -1, right: -1,
                    width: 14, height: 14, borderRadius: 7,
                    backgroundColor: '#4A7C59', borderWidth: 2, borderColor: '#fff',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {unreadCount <= 9 && (
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>{unreadCount}</Text>
                    )}
                  </View>
                )}
              </View>

              {/* Text */}
              <View style={{ flex: 1, marginLeft: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text
                    style={{ fontSize: 15, fontWeight: hasUnread ? '700' : '500', color: hasUnread ? '#1C1917' : '#44403C', flex: 1 }}
                    numberOfLines={1}
                  >
                    {conversation.farmstand_name}
                  </Text>
                  <Text style={{ fontSize: 12, color: hasUnread ? '#4A7C59' : '#A8A29E', fontWeight: hasUnread ? '600' : '400', marginLeft: 8 }}>
                    {formatThreadTime(conversation.last_message_at)}
                  </Text>
                </View>
                <Text
                  style={{ fontSize: 13, marginTop: 3, color: hasUnread ? '#57534E' : '#A8A29E', fontWeight: hasUnread ? '500' : '400' }}
                  numberOfLines={1}
                >
                  {conversation.last_message_text || 'No messages yet'}
                </Text>
              </View>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// ─── Swipeable Alert Row ──────────────────────────────────────────────────────
function SwipeableAlertListItem({
  alert,
  onPress,
  onDelete,
  index,
}: {
  alert: Alert;
  onPress: () => void;
  onDelete: () => void;
  index: number;
}) {
  const isUnread = alert.read_at === null;
  const IconComponent = getAlertIconComponent(alert.type);
  const iconColor = getAlertColor(alert.type);

  const translateX = useSharedValue(0);

  const triggerDelete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDelete();
  }, [onDelete]);

  const resetSwipe = useCallback(() => {
    translateX.value = withSpring(0, { damping: 20 });
  }, [translateX]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((e) => {
      if (e.translationX < 0) translateX.value = Math.max(e.translationX, -SCREEN_WIDTH * 0.5);
      else translateX.value = 0;
    })
    .onEnd(() => {
      if (translateX.value < -FULL_SWIPE_THRESHOLD) {
        runOnJS(triggerDelete)(); runOnJS(resetSwipe)();
      } else if (translateX.value < -DELETE_THRESHOLD / 2) {
        translateX.value = withSpring(-DELETE_THRESHOLD, { damping: 20 });
      } else {
        translateX.value = withSpring(0, { damping: 20 });
      }
    });

  const tapGesture = Gesture.Tap().onStart(() => {
    if (translateX.value < -10) translateX.value = withSpring(0, { damping: 20 });
    else runOnJS(onPress)();
  });

  const composedGesture = Gesture.Race(panGesture, tapGesture);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const deleteStyle = useAnimatedStyle(() => ({
    width: interpolate(translateX.value, [-SCREEN_WIDTH * 0.5, -DELETE_THRESHOLD, 0], [SCREEN_WIDTH * 0.5, DELETE_THRESHOLD, 0], Extrapolation.CLAMP),
    opacity: interpolate(translateX.value, [-DELETE_THRESHOLD, -20, 0], [1, 0.5, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
      <View style={{ position: 'relative', flexDirection: 'row' }}>
        <Animated.View
          style={[{
            position: 'absolute', right: 0, top: 0, bottom: 0,
            backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
          }, deleteStyle]}
        >
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); translateX.value = withSpring(0, { damping: 20 }); onDelete(); }}
            style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={20} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 3 }}>Delete</Text>
          </Pressable>
        </Animated.View>

        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[{ width: '100%', backgroundColor: isUnread ? 'rgba(74,124,89,0.04)' : '#FFFFFF' }, rowStyle]}>
            <View
              style={{
                flexDirection: 'row', alignItems: 'flex-start',
                paddingHorizontal: 20, paddingVertical: 16,
                borderBottomWidth: 1, borderBottomColor: '#F5F0EA',
              }}
            >
              {/* Icon bubble */}
              <View style={{
                width: 42, height: 42, borderRadius: 21,
                backgroundColor: `${iconColor}18`,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <IconComponent size={19} color={iconColor} />
              </View>

              <View style={{ flex: 1, marginLeft: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <Text
                    style={{ fontSize: 14, fontWeight: isUnread ? '600' : '500', color: isUnread ? '#1C1917' : '#57534E', flex: 1, marginRight: 8 }}
                    numberOfLines={2}
                  >
                    {alert.title}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {isUnread && (
                      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#4A7C59', marginRight: 6 }} />
                    )}
                    <Text style={{ fontSize: 12, color: isUnread ? '#4A7C59' : '#A8A29E', fontWeight: isUnread ? '600' : '400' }}>
                      {formatAlertTime(alert.created_at)}
                    </Text>
                  </View>
                </View>
                <Text
                  style={{ fontSize: 13, marginTop: 4, color: isUnread ? '#78716C' : '#A8A29E', lineHeight: 18 }}
                  numberOfLines={2}
                >
                  {alert.body}
                </Text>
              </View>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────
function DeleteConfirmationModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }} onPress={onCancel}>
        <Pressable
          style={{ backgroundColor: '#fff', borderRadius: 20, marginHorizontal: 32, overflow: 'hidden', width: '85%', maxWidth: 320 }}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={{ padding: 24 }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: '#1C1917', textAlign: 'center' }}>
              Delete conversation?
            </Text>
            <Text style={{ fontSize: 14, color: '#78716C', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
              This will remove the conversation from your inbox.
            </Text>
          </View>
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#F5F0EA' }}>
            <Pressable onPress={onCancel} style={{ flex: 1, paddingVertical: 16, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#F5F0EA' }}>
              <Text style={{ fontSize: 16, fontWeight: '500', color: '#78716C' }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={{ flex: 1, paddingVertical: 16, alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#EF4444' }}>Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <Animated.View
      entering={FadeIn.delay(150).duration(400)}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 80 }}
    >
      <View style={{
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: '#F0EBE3',
        alignItems: 'center', justifyContent: 'center', marginBottom: 20,
      }}>
        {icon}
      </View>
      <Text style={{ fontSize: 19, fontWeight: '700', color: '#2C2420', textAlign: 'center', marginBottom: 8 }}>
        {title}
      </Text>
      <Text style={{ fontSize: 14, color: '#A8906E', textAlign: 'center', lineHeight: 21 }}>
        {description}
      </Text>
    </Animated.View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function InboxScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'messages' | 'alerts'>('messages');
  const [alertFilter, setAlertFilter] = useState<'all' | 'unread'>('all');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [convToDelete, setConvToDelete] = useState<Conversation | null>(null);

  const user = useUserStore(s => s.user);

  const loadChatData = useChatStore(s => s.loadChatData);
  const hideThreadForUser = useChatStore(s => s.hideThreadForUser);

  const [conversations, setConversations] = useState<Conversation[]>([]);

  const alerts = useAlertsStore(s => s.alerts);
  const alertsLoading = useAlertsStore(s => s.isLoading);
  const loadAlerts = useAlertsStore(s => s.loadAlerts);
  const getUnreadAlertCount = useAlertsStore(s => s.getUnreadCount);
  const markAlertAsRead = useAlertsStore(s => s.markAsRead);
  const deleteAlert = useAlertsStore(s => s.deleteAlert);
  const alertsDebugInfo = useAlertsStore(s => s.debugInfo);

  const loadConversations = useCallback(async () => {
    if (!user?.id || !isSupabaseConfigured()) return;
    const session = await getValidSession();
    if (!session?.access_token) return;
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
    try {
      const url = new URL(`${supabaseUrl}/rest/v1/conversations`);
      url.searchParams.set('or', `customer_id.eq.${user.id},owner_id.eq.${user.id}`);
      url.searchParams.set('order', 'last_message_at.desc');
      url.searchParams.set('select', '*');
      const res = await fetch(url.toString(), {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (res.ok) {
        const rows = await res.json() as Conversation[];
        setConversations(rows);
      } else {
        console.log('[Inbox] conversations fetch error:', res.status, await res.text());
      }
    } catch (err) {
      console.log('[Inbox] conversations fetch exception:', err);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadChatData(user?.id ?? undefined);
      loadAlerts();
      loadConversations();
    }, [loadChatData, loadAlerts, loadConversations])
  );

  const totalUnreadMessages = conversations.reduce((sum, conv) => {
    const isOwner = conv.owner_id === user?.id;
    return sum + (isOwner ? (conv.owner_unread_count ?? 0) : (conv.customer_unread_count ?? 0));
  }, 0);
  const totalUnreadAlerts = getUnreadAlertCount();

  const filteredAlerts = alertFilter === 'unread'
    ? alerts.filter(a => a.read_at === null)
    : alerts;

  const handleTabChange = (tab: 'messages' | 'alerts') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  };

  const handleThreadPress = (conv: Conversation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (conv.thread_id) {
      router.push(`/chat/${conv.thread_id}`);
    } else {
      router.push(`/chat/new?farmstandId=${conv.farmstand_id}&farmstandName=${encodeURIComponent(conv.farmstand_name)}`);
    }
  };

  const handleAlertPress = async (alert: Alert) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await markAlertAsRead(alert.id);
    if (alert.action_route && alert.action_params) {
      const params = alert.action_params;
      switch (alert.action_route) {
        case 'FarmstandDetail':
          if (params.farmstandId) router.push(`/farm/${params.farmstandId}`);
          break;
        case 'Reviews':
          if (params.farmstandId) router.push(`/farm/reviews?farmstandId=${params.farmstandId}`);
          break;
        case 'AdminClaims':
          router.push('/admin/claim-requests');
          break;
        case 'OwnerDashboard':
          router.push('/owner/my-farmstand');
          break;
      }
    }
  };

  const handleDeleteRequest = (conv: Conversation) => {
    setConvToDelete(conv);
    setDeleteModalVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!convToDelete || !user?.id) return;
    if (convToDelete.thread_id) {
      await hideThreadForUser(convToDelete.thread_id, user.id);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDeleteModalVisible(false);
    setConvToDelete(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FDF8F3' }}>
      {/* ── Header (matches Saved page) ─────────────────────────────── */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FDF8F3' }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}>
          <Text style={{ fontSize: 26, fontWeight: '700', color: '#2C2420', letterSpacing: -0.3 }}>Inbox</Text>
          <Text style={{ fontSize: 14, color: '#A8906E', marginTop: 2 }}>
            Messages and alerts from farm stands
          </Text>
        </View>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', backgroundColor: '#FDF8F3', borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}>
          <TabButton label="Messages" isActive={activeTab === 'messages'} onPress={() => handleTabChange('messages')} badge={totalUnreadMessages} />
          <TabButton label="Alerts" isActive={activeTab === 'alerts'} onPress={() => handleTabChange('alerts')} badge={totalUnreadAlerts} />
        </View>
      </SafeAreaView>

      {/* ── Content ─────────────────────────────────────────────────── */}
      {activeTab === 'messages' ? (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          {conversations.length === 0 ? (
            <EmptyState
              icon={<MessageSquare size={36} color="#A8906E" />}
              title="No messages yet"
              description="Message a farm stand to ask about products, hours, or availability."
            />
          ) : (
            <View style={{ backgroundColor: '#fff' }}>
              {conversations.map((conv, index) => {
                const isOwner = conv.owner_id === user?.id;
                const unreadCount = isOwner ? (conv.owner_unread_count ?? 0) : (conv.customer_unread_count ?? 0);
                return (
                  <SwipeableThreadListItem
                    key={conv.id}
                    conversation={conv}
                    unreadCount={unreadCount}
                    onPress={() => handleThreadPress(conv)}
                    onDelete={() => handleDeleteRequest(conv)}
                    index={index}
                  />
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {/* DEV debug panel */}
          {__DEV__ && (
            <View style={{ backgroundColor: '#1a1a2e', padding: 10, borderBottomWidth: 1, borderBottomColor: '#333' }}>
              <Text style={{ color: '#00ff88', fontFamily: 'monospace', fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>
                [DEBUG] ALERTS DIAGNOSTICS
              </Text>
              {(() => {
                const cfg = getSupabaseConfigStatus();
                return (
                  <>
                    <Text style={{ color: '#aaffcc', fontFamily: 'monospace', fontSize: 9, lineHeight: 14 }}>
                      {`SUPABASE_URL: ${cfg.hasUrl ? cfg.projectRef + '.supabase.co ✓' : 'MISSING ✗'}`}
                    </Text>
                    <Text style={{ color: '#aaffcc', fontFamily: 'monospace', fontSize: 9, lineHeight: 14 }}>
                      {`SUPABASE_ANON_KEY: len=${alertsDebugInfo.anonKeyLength}${alertsDebugInfo.anonKeyLength > 0 ? ' ✓' : ' ✗ MISSING'}`}
                    </Text>
                    <Text style={{ color: cfg.configured ? '#aaffcc' : '#ff6666', fontFamily: 'monospace', fontSize: 9, lineHeight: 14 }}>
                      {`Configured: ${cfg.configured ? 'YES' : 'NO — ' + (cfg.errorMessage ?? 'unknown')}`}
                    </Text>
                  </>
                );
              })()}
              <Text style={{ color: '#aaffcc', fontFamily: 'monospace', fontSize: 9, lineHeight: 14 }}>
                {`UID: ${alertsDebugInfo.authUid || 'null (not loaded yet)'}`}
              </Text>
              <Text style={{ color: '#aaffcc', fontFamily: 'monospace', fontSize: 9, lineHeight: 14 }}>
                {`Alert count: ${alertsDebugInfo.lastLoadAt ? alertsDebugInfo.alertCount : '(tap Alerts tab to load)'}`}
              </Text>
              <Text style={{ color: '#aaffcc', fontFamily: 'monospace', fontSize: 9, lineHeight: 14 }}>
                {alertsDebugInfo.firstAlert
                  ? `First: type=${alertsDebugInfo.firstAlert.type} at=${alertsDebugInfo.firstAlert.created_at}`
                  : 'First alert: none'}
              </Text>
              <Text style={{ color: '#666', fontFamily: 'monospace', fontSize: 8, lineHeight: 12, marginTop: 2 }}>
                {alertsDebugInfo.lastLoadAt ? `Last load: ${alertsDebugInfo.lastLoadAt}` : 'Not yet loaded'}
              </Text>
            </View>
          )}

          {/* Alerts filter chips */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#FDF8F3', borderBottomWidth: 1, borderBottomColor: '#EDE8E0', gap: 8 }}>
            {(['all', 'unread'] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => setAlertFilter(f)}
                style={{
                  paddingHorizontal: 16, paddingVertical: 7,
                  borderRadius: 20,
                  backgroundColor: alertFilter === f ? '#4A7C59' : '#F0EBE3',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: alertFilter === f ? '#fff' : '#78716C' }}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {alertsLoading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80 }}>
                <ActivityIndicator size="large" color="#4A7C59" />
              </View>
            ) : filteredAlerts.length === 0 ? (
              <EmptyState
                icon={<Bell size={36} color="#A8906E" />}
                title={alertFilter === 'unread' ? 'All caught up' : 'No alerts yet'}
                description={
                  alertFilter === 'unread'
                    ? "You've read everything. Check back later."
                    : 'Important updates from Farmstand and your saved stands will appear here.'
                }
              />
            ) : (
              <View style={{ backgroundColor: '#fff' }}>
                {filteredAlerts.map((alert, index) => (
                  <SwipeableAlertListItem
                    key={alert.id}
                    alert={alert}
                    onPress={() => handleAlertPress(alert)}
                    onDelete={() => deleteAlert(alert.id)}
                    index={index}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      )}

      <DeleteConfirmationModal
        visible={deleteModalVisible}
        onCancel={() => { setDeleteModalVisible(false); setConvToDelete(null); }}
        onConfirm={handleDeleteConfirm}
      />
    </View>
  );
}
