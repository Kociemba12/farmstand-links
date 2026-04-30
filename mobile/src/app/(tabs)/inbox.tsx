import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, ScrollView, Pressable, Image, Modal, Dimensions, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MessageCircle, Store, Trash2, Bell, CheckCircle, XCircle, Flag,
  Megaphone, Star, Award, Clock, TrendingDown, ShieldAlert, ShieldCheck,
  Info, AlertTriangle, EyeOff, CheckCheck, MessageSquare, User,
} from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import Animated, {
  FadeIn, FadeInDown,
  useAnimatedStyle, useSharedValue, withSpring,
  interpolate, Extrapolation, runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useUserStore } from '@/lib/user-store';
import { useChatStore } from '@/lib/chat-store';
import { useAlertsStore } from '@/lib/alerts-store';
import type { Alert, AlertType } from '@/lib/alerts-store';
import { getValidSession } from '@/lib/supabase';
import { resolveConversationDisplay } from '@/lib/conversation-display';
import * as Haptics from 'expo-haptics';
import { navigateToConversation } from '@/lib/conversation-navigation';
import { trackEvent } from '@/lib/track';

// ─── Constants ────────────────────────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DELETE_THRESHOLD = 80;
const FULL_SWIPE_THRESHOLD = SCREEN_WIDTH * 0.4;
const FOREST = '#2D5A3D';
const CREAM = '#FDF8F3';
const SAND = '#EDE8E0';
const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

// ─── Raw Supabase conversation row ────────────────────────────────────────────
interface ConversationRow {
  id: string;
  farmstand_id: string;
  customer_id: string;
  owner_id: string;
  last_message_text: string | null;
  last_message_at: string | null;
  customer_unread_count: number | null;
  owner_unread_count: number | null;
  created_at: string;
  updated_at: string;
  deleted_by_owner_at?: string | null;
  deleted_by_customer_at?: string | null;
  farmstands?: {
    name?: string | null;
    photos?: string[] | null;
    photo_url?: string | null;
    deleted_at?: string | null;
  } | null;
}

// ─── Conversation type ────────────────────────────────────────────────────────
interface Conversation {
  farmstand_id: string;
  other_user_id: string;
  last_message_text: string | null;
  last_message_at: string | null;
  farmstand_name?: string;
  farmstand_photo_url?: string | null;
  /** True when the farmstand tied to this thread has been soft-deleted. */
  farmstand_deleted?: boolean;
  other_user_name?: string | null;
  other_user_avatar_url?: string | null;
  viewer_is_owner?: boolean;
  /** Per-conversation unread message count from backend (source of truth). */
  unread_count?: number;
}

// ─── Time formatter ───────────────────────────────────────────────────────────
function formatTime(dateStr: string | null): string {
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

// ─── Alert icon helper ─────────────────────────────────────────────────────────
function AlertIcon({ type, size = 18, color }: { type: AlertType | null; size?: number; color: string }) {
  const props = { size, color };
  switch (type) {
    case 'claim_approved':    return <CheckCircle {...props} />;
    case 'claim_denied':      return <XCircle {...props} />;
    case 'claim_request':     return <Bell {...props} />;
    case 'review_new':        return <Star {...props} />;
    case 'review_reply':      return <MessageSquare {...props} />;
    case 'listing_flagged':   return <Flag {...props} />;
    case 'listing_attention': return <AlertTriangle {...props} />;
    case 'listing_hidden':    return <EyeOff {...props} />;
    case 'platform_announcement': return <Megaphone {...props} />;
    case 'premium_approved':  return <Award {...props} />;
    case 'premium_expired':   return <Clock {...props} />;
    case 'premium_downgraded':return <TrendingDown {...props} />;
    case 'report_received':   return <ShieldAlert {...props} />;
    case 'report_resolved':   return <ShieldCheck {...props} />;
    case 'app_notice':        return <Info {...props} />;
    case 'message':           return <MessageSquare {...props} />;
    case 'farmstand_update':  return <Store {...props} />;
    default:                  return <Bell {...props} />;
  }
}

function getAlertAccentColor(type: AlertType | null): string {
  switch (type) {
    case 'claim_approved':
    case 'premium_approved':
    case 'report_resolved':   return '#10B981';
    case 'claim_denied':
    case 'listing_flagged':
    case 'listing_hidden':
    case 'premium_expired':   return '#EF4444';
    case 'claim_request':
    case 'listing_attention':
    case 'premium_downgraded':
    case 'report_received':   return '#F59E0B';
    case 'review_new':        return '#8B5CF6';
    case 'review_reply':      return '#D4943A';
    case 'platform_announcement':
    case 'app_notice':        return '#3B82F6';
    case 'message':           return '#2D5A3D';
    case 'farmstand_update':  return '#A8906E';
    default:                  return '#6B7280';
  }
}

// ─── Alert Row Content ────────────────────────────────────────────────────────
function AlertRowContent({ alert, onDismiss }: { alert: Alert; onDismiss: (id: string) => void }) {
  const isUnread = alert.read_at === null;
  const accentColor = getAlertAccentColor(alert.type);

  return (
    <View style={{
      backgroundColor: isUnread ? '#FFFDF7' : '#FFFFFF',
      borderRadius: 14, borderWidth: 1,
      borderColor: isUnread ? '#E8E0CC' : '#F0EBE3',
      overflow: 'hidden',
    }}>
      {/* Left accent bar */}
      <View style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: 3, backgroundColor: isUnread ? accentColor : 'transparent',
        borderTopLeftRadius: 14, borderBottomLeftRadius: 14,
      }} />

      <View style={{ flexDirection: 'row', padding: 14, paddingLeft: 17, alignItems: 'flex-start' }}>
        {/* Icon bubble */}
        <View style={{
          width: 38, height: 38, borderRadius: 19,
          backgroundColor: `${accentColor}15`,
          alignItems: 'center', justifyContent: 'center',
          marginRight: 12, marginTop: 1, flexShrink: 0,
        }}>
          <AlertIcon type={alert.type} size={17} color={accentColor} />
        </View>

        {/* Text */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Text
              style={{
                fontSize: 14, fontWeight: isUnread ? '700' : '600',
                color: isUnread ? '#1C1917' : '#44403C',
                flex: 1, marginRight: 8, lineHeight: 19,
              }}
              numberOfLines={2}
            >
              {alert.title}
            </Text>
            <Text style={{ fontSize: 11, color: '#A8A29E', marginTop: 1, flexShrink: 0 }}>
              {formatTime(alert.created_at)}
            </Text>
          </View>

          <Text
            style={{ fontSize: 13, color: '#78716C', marginTop: 3, lineHeight: 18 }}
            numberOfLines={2}
          >
            {alert.body}
          </Text>

          {/* Footer row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            {isUnread && (
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accentColor, marginRight: 6 }} />
            )}
            <Text style={{ fontSize: 11, color: isUnread ? accentColor : '#C7BDB4', fontWeight: isUnread ? '600' : '400' }}>
              {isUnread ? 'Unread' : 'Read'}
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={(e) => { e.stopPropagation(); onDismiss(alert.id); }}
              hitSlop={12}
              style={{ padding: 2 }}
            >
              <Text style={{ fontSize: 12, color: '#C7BDB4' }}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Swipeable Alert Card ────────────────────────────────────────────────────
function SwipeableAlertCard({ alert, index, onPress, onDismiss }: {
  alert: Alert;
  index: number;
  onPress: (a: Alert) => void;
  onDismiss: (id: string) => void;
}) {
  const translateX = useSharedValue(0);

  const triggerDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDismiss(alert.id);
  }, [alert.id, onDismiss]);

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
        // Don't reset translateX here — triggerDismiss unmounts this component,
        // so writing to translateX.value after unmount causes the native crash.
        runOnJS(triggerDismiss)();
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
      runOnJS(onPress)(alert);
    }
  });

  const composedGesture = Gesture.Race(panGesture, tapGesture);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const deleteStyle = useAnimatedStyle(() => ({
    width: interpolate(translateX.value, [-SCREEN_WIDTH * 0.5, -DELETE_THRESHOLD, 0], [SCREEN_WIDTH * 0.5, DELETE_THRESHOLD, 0], Extrapolation.CLAMP),
    opacity: interpolate(translateX.value, [-DELETE_THRESHOLD, -20, 0], [1, 0.5, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View entering={FadeInDown.delay(index * 40).duration(280)}>
      <View style={{ position: 'relative', marginHorizontal: 16, marginVertical: 5 }}>
        {/* Delete background */}
        <Animated.View style={[{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          backgroundColor: '#EF4444', borderRadius: 14,
          justifyContent: 'center', alignItems: 'center',
          overflow: 'hidden',
        }, deleteStyle]}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); translateX.value = withSpring(0, { damping: 20 }); onDismiss(alert.id); }}
            style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={19} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 3 }}>Delete</Text>
          </Pressable>
        </Animated.View>

        {/* Alert row */}
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[{ borderRadius: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 }, rowStyle]}>
            <AlertRowContent alert={alert} onDismiss={onDismiss} />
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// ─── Swipeable Thread Row ─────────────────────────────────────────────────────
function SwipeableThreadListItem({
  conversation, unreadCount, onPress, onDelete, index,
}: {
  conversation: Conversation;
  unreadCount: number;
  onPress: () => void;
  onDelete: () => void;
  index: number;
}) {
  const hasUnread = unreadCount > 0;
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
        // Don't reset translateX here — triggerDelete unmounts this component,
        // so writing to translateX.value after unmount causes the native crash.
        runOnJS(triggerDelete)();
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
        <Animated.View style={[{ position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center' }, deleteStyle]}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F0EA' }}>
              {(() => {
                const display = resolveConversationDisplay({
                  viewerIsFarmstandOwner: conversation.viewer_is_owner ?? false,
                  farmstandName: conversation.farmstand_name,
                  farmstandPhoto: conversation.farmstand_photo_url,
                  customerName: conversation.other_user_name,
                  customerPhoto: conversation.other_user_avatar_url,
                });
                return (
                  <>
                    <View style={{ position: 'relative' }}>
                      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#F0EBE3', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {display.displayPhoto ? (
                          <Image source={{ uri: display.displayPhoto }} style={{ width: 52, height: 52 }} resizeMode="cover" />
                        ) : display.displayType === 'farmstand' ? (
                          <Store size={22} color="#A8906E" />
                        ) : (
                          <User size={22} color="#A8906E" />
                        )}
                      </View>
                      {hasUnread && (
                        <View style={{ position: 'absolute', top: -1, right: -1, width: 14, height: 14, borderRadius: 7, backgroundColor: FOREST, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                          {unreadCount <= 9 && <Text style={{ color: '#fff', fontSize: 8, fontWeight: '800' }}>{unreadCount}</Text>}
                        </View>
                      )}
                    </View>

                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 15, fontWeight: hasUnread ? '700' : '500', color: hasUnread ? '#1C1917' : '#44403C', flex: 1 }} numberOfLines={1}>
                          {display.displayName}
                        </Text>
                        <Text style={{ fontSize: 12, color: hasUnread ? FOREST : '#A8A29E', fontWeight: hasUnread ? '600' : '400', marginLeft: 8 }}>
                          {formatTime(conversation.last_message_at)}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 13, marginTop: 3, color: hasUnread ? '#57534E' : '#A8A29E', fontWeight: hasUnread ? '500' : '400' }} numberOfLines={1}>
                        {conversation.last_message_text || 'No messages yet'}
                      </Text>
                      {conversation.farmstand_deleted && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
                          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#B45309' }} />
                          <Text style={{ fontSize: 11, color: '#B45309', fontWeight: '500' }}>
                            Farmstand no longer available
                          </Text>
                        </View>
                      )}
                    </View>
                  </>
                );
              })()}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// ─── Delete Modal ──────────────────────────────────────────────────────────────
function DeleteConfirmationModal({ visible, onCancel, onConfirm }: { visible: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }} onPress={onCancel}>
        <Pressable style={{ backgroundColor: '#fff', borderRadius: 20, marginHorizontal: 32, overflow: 'hidden', width: '85%', maxWidth: 420 }} onPress={(e) => e.stopPropagation()}>
          <View style={{ padding: 24 }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: '#1C1917', textAlign: 'center' }}>Delete conversation?</Text>
            <Text style={{ fontSize: 14, color: '#78716C', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>This will remove the conversation from your inbox.</Text>
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

// ─── Empty States ──────────────────────────────────────────────────────────────
function MessagesEmpty() {
  return (
    <Animated.View entering={FadeIn.delay(150).duration(400)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 80 }}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#F0EBE3', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <MessageCircle size={36} color="#A8906E" />
      </View>
      <Text style={{ fontSize: 19, fontWeight: '700', color: '#2C2420', textAlign: 'center', marginBottom: 8 }}>No messages yet</Text>
      <Text style={{ fontSize: 14, color: '#A8906E', textAlign: 'center', lineHeight: 21 }}>
        Message a farm stand to ask about products, hours, or availability.
      </Text>
    </Animated.View>
  );
}

function AlertsEmpty() {
  return (
    <Animated.View entering={FadeIn.delay(150).duration(400)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 80 }}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#F0EBE3', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <Bell size={36} color="#A8906E" />
      </View>
      <Text style={{ fontSize: 19, fontWeight: '700', color: '#2C2420', textAlign: 'center', marginBottom: 8 }}>No alerts</Text>
      <Text style={{ fontSize: 14, color: '#A8906E', textAlign: 'center', lineHeight: 21 }}>
        Official notices about your farmstand, account, and platform updates will appear here.
      </Text>
    </Animated.View>
  );
}

// ─── Tab Pill ─────────────────────────────────────────────────────────────────
type InboxTab = 'messages' | 'alerts';

function TabPills({ active, onSelect, messagesBadge, alertsBadge }: {
  active: InboxTab;
  onSelect: (t: InboxTab) => void;
  messagesBadge: number;
  alertsBadge: number;
}) {
  return (
    <View style={{
      flexDirection: 'row', marginHorizontal: 20, marginTop: 14, marginBottom: 2,
      backgroundColor: '#EDE8E0', borderRadius: 12, padding: 3,
    }}>
      {(['messages', 'alerts'] as InboxTab[]).map((tab) => {
        const isActive = active === tab;
        const badge = tab === 'messages' ? messagesBadge : alertsBadge;
        return (
          <Pressable
            key={tab}
            onPress={() => { Haptics.selectionAsync(); onSelect(tab); }}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              paddingVertical: 9, borderRadius: 10,
              backgroundColor: isActive ? '#FFFFFF' : 'transparent',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: isActive ? 0.06 : 0,
              shadowRadius: 3,
              elevation: isActive ? 2 : 0,
            }}
          >
            <Text style={{
              fontSize: 14, fontWeight: isActive ? '700' : '500',
              color: isActive ? FOREST : '#8B6F4E',
            }}>
              {tab === 'messages' ? 'Messages' : 'Alerts'}
            </Text>
            {badge > 0 && (
              <View style={{
                marginLeft: 6,
                backgroundColor: isActive ? FOREST : '#A8906E',
                borderRadius: 8, minWidth: 18, height: 18,
                paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                  {badge > 9 ? '9+' : badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function InboxScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const hPad = isTablet ? 40 : 20;
  const [activeTab, setActiveTab] = useState<InboxTab>('messages');
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [convToDelete, setConvToDelete] = useState<Conversation | null>(null);

  const user = useUserStore(s => s.user);
  const loadChatData = useChatStore(s => s.loadChatData);
  const fetchUnreadMessageCount = useChatStore(s => s.fetchUnreadMessageCount);
  const setTotalUnreadMessages = useChatStore(s => s.setTotalUnreadMessages);
  const totalUnreadMessages = useChatStore(s => s.totalUnreadMessages);
  const markConversationRead = useChatStore(s => s.markConversationRead);
  const alerts = useAlertsStore(s => s.alerts);
  const alertsLoading = useAlertsStore(s => s.isLoading);
  const loadAlerts = useAlertsStore(s => s.loadAlerts);
  const markAsRead = useAlertsStore(s => s.markAsRead);
  const markAllAsRead = useAlertsStore(s => s.markAllAsRead);
  const deleteAlert = useAlertsStore(s => s.deleteAlert);
  const unreadAlertCount = alerts.filter(a => a.read_at === null).length;
  console.log('[Inbox] unreadAlertCount:', unreadAlertCount, '| totalUnreadMessages (conversations):', totalUnreadMessages);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-user map of dismissed conversation keys ("farmstand_id__other_user_id") → dismissedAt ISO string.
  // Persisted in AsyncStorage. When a new message arrives after the dismissedAt timestamp, the
  // thread is automatically revealed again so the user can see the new message.
  const [dismissedConvData, setDismissedConvData] = useState<Map<string, string>>(new Map());
  // Ref mirror of dismissedConvData — always holds the latest value so loadConversations
  // closures captured earlier still see the current dismissed set (fixes stale-closure repopulation bug).
  const dismissedConvDataRef = useRef<Map<string, string>>(new Map());
  useEffect(() => { dismissedConvDataRef.current = dismissedConvData; }, [dismissedConvData]);

  const dismissedStorageKey = user?.id ? `dismissed_convs_v2_${user.id}` : null;
  // Ref mirror of dismissedStorageKey for the same stale-closure reason.
  const dismissedStorageKeyRef = useRef<string | null>(null);
  useEffect(() => { dismissedStorageKeyRef.current = dismissedStorageKey; }, [dismissedStorageKey]);

  // Tracks conversation keys that were optimistically zeroed when the user tapped them open.
  // Prevents a background poll returning stale unread_count from briefly re-showing the badge
  // before the mark-read POST has propagated back to the server.
  const recentlyReadRef = useRef<Map<string, number>>(new Map()); // key → Date.now() ms

  // Load persisted dismissed data on mount / user change
  useEffect(() => {
    if (!dismissedStorageKey) return;
    AsyncStorage.getItem(dismissedStorageKey)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, string>;
          const entries = Object.entries(parsed);
          console.log(`[Inbox][DismissedKeys] loaded ${entries.length} dismissed key(s) for user ${user?.id}`);
          setDismissedConvData(new Map(entries));
        }
      })
      .catch(() => {});
  }, [dismissedStorageKey, user?.id]);

  const persistDismissedEntry = useCallback((convKey: string) => {
    const dismissedAt = new Date().toISOString();
    // Build the next map and update the ref synchronously FIRST, so any
    // already-captured loadConversations closures (e.g. the one inside
    // handleDeleteConfirm) immediately see the new key without waiting for
    // a React re-render cycle to commit the state update and run useEffect.
    const next = new Map(dismissedConvDataRef.current);
    next.set(convKey, dismissedAt);
    dismissedConvDataRef.current = next;
    // Now schedule the async state update (triggers re-render) and persist.
    setDismissedConvData(next);
    const storageKey = dismissedStorageKeyRef.current;
    if (storageKey) {
      AsyncStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(next))).catch(() => {});
    }
    console.log(`[Inbox][DismissedKeys] persisted entry: ${convKey} @ ${dismissedAt} — total dismissed: ${next.size}`);
  }, []);

  const loadConversations = useCallback(async (silent = false) => {
    if (!user?.id) return;
    const session = await getValidSession();
    if (!session?.access_token) return;
    if (!silent) setConvLoading(true);
    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
      const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
      if (__DEV__) console.log('[Inbox] Loading conversations from public.conversations for user:', user.id);

      const convUrl = new URL(`${supabaseUrl}/rest/v1/conversations`);
      convUrl.searchParams.set('or', `(customer_id.eq.${user.id},owner_id.eq.${user.id})`);
      convUrl.searchParams.set('order', 'last_message_at.desc.nullslast,updated_at.desc');
      convUrl.searchParams.set('select', '*,farmstands(name,photos,photo_url,deleted_at)');

      const res = await fetch(convUrl.toString(), {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (res.ok) {
        const rawRows = await res.json() as ConversationRow[];
        if (__DEV__) console.log('[Inbox] rows from public.conversations before soft-delete filter:', rawRows.length);

        // Filter out rows soft-deleted by this user. Auto-unhide if a new message
        // arrived after the deletion timestamp (matches backend auto-unhide behavior).
        const rows = rawRows.filter(row => {
          const isOwner = row.owner_id === user!.id;
          const deletedAt = isOwner ? (row.deleted_by_owner_at ?? null) : (row.deleted_by_customer_at ?? null);
          if (!deletedAt) return true;
          // Auto-unhide: new message arrived after user deleted the thread
          if (row.last_message_at && row.last_message_at > deletedAt) {
            if (__DEV__) console.log(`[Inbox] auto-unhide: new message after soft-delete — clearing column for conversation id=${row.id}`);
            const patchCol = isOwner ? 'deleted_by_owner_at' : 'deleted_by_customer_at';
            const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
            fetch(`${supabaseUrl}/rest/v1/conversations?id=eq.${row.id}`, {
              method: 'PATCH',
              headers: {
                apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({ [patchCol]: null }),
            }).catch(() => {});
            return true;
          }
          if (__DEV__) console.log(`[Inbox] filtering out soft-deleted conversation id=${row.id} role=${isOwner ? 'owner' : 'customer'} deletedAt=${deletedAt}`);
          return false;
        });
        if (__DEV__) console.log('[Inbox] inbox conversation count after soft-delete filter:', rows.length, '(filtered out:', rawRows.length - rows.length, ')');

        const convs: Conversation[] = rows.map(row => {
          const viewerIsOwner = row.owner_id === user.id;
          const otherUserId = viewerIsOwner ? row.customer_id : row.owner_id;
          const unreadCount = viewerIsOwner
            ? (row.owner_unread_count ?? 0)
            : (row.customer_unread_count ?? 0);
          const fs = row.farmstands;
          const farmstandPhoto = fs?.photos?.[0] ?? fs?.photo_url ?? null;
          return {
            farmstand_id: row.farmstand_id,
            other_user_id: otherUserId,
            last_message_text: row.last_message_text,
            last_message_at: row.last_message_at,
            farmstand_name: fs?.name ?? undefined,
            farmstand_photo_url: farmstandPhoto,
            farmstand_deleted: !!(fs?.deleted_at),
            unread_count: unreadCount,
            viewer_is_owner: viewerIsOwner,
          };
        });

        // Always read from the ref — not from the closure — so even a stale callback
        // (e.g. the one captured inside handleDeleteConfirm before state updated) uses
        // the latest dismissed set. This is the fix for deleted-thread repopulation.
        const activeDismissedData = new Map(dismissedConvDataRef.current);

        // If a previously-dismissed thread reappears from the backend with a
        // last_message_at NEWER than our dismissal timestamp, a new message arrived
        // after we hid it — clear the local suppression so the thread shows again.
        const keysToReveal: string[] = [];
        for (const conv of convs) {
          const key = `${conv.farmstand_id}__${conv.other_user_id}`;
          const dismissedAt = activeDismissedData.get(key);
          if (dismissedAt && conv.last_message_at && conv.last_message_at > dismissedAt) {
            activeDismissedData.delete(key);
            keysToReveal.push(key);
          }
        }
        if (keysToReveal.length > 0) {
          setDismissedConvData(activeDismissedData);
          const storageKey = dismissedStorageKeyRef.current;
          if (storageKey) {
            AsyncStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(activeDismissedData))).catch(() => {});
          }
          console.log(`[Inbox][DismissedKeys] auto-revealed ${keysToReveal.length} key(s) — new messages after dismissal: ${keysToReveal.join(', ')}`);
        }

        const beforeFilter = convs.length;
        const now = Date.now();
        const filtered = convs
          .filter((c) => !activeDismissedData.has(`${c.farmstand_id}__${c.other_user_id}`))
          .map((c) => {
            // If the user tapped this thread open recently, keep unread_count at 0 even if the
            // server hasn't yet reflected the mark-read POST (fixes unread-stays-after-reading).
            const key = `${c.farmstand_id}__${c.other_user_id}`;
            const readAt = recentlyReadRef.current.get(key);
            if (readAt !== undefined) {
              if (now - readAt < 10_000) {
                return { ...c, unread_count: 0 };
              }
              // Guard expired — drop the entry so it doesn't persist forever
              recentlyReadRef.current.delete(key);
            }
            return c;
          });
        console.log(`[Inbox] after dismissed-key filter: ${filtered.length}/${beforeFilter} (skipped ${beforeFilter - filtered.length} dismissed)`);
        setConversations(filtered);
        // Fallback: if inbox has no visible threads, the badge must be 0.
        if (filtered.length === 0) {
          console.log('[Inbox] 0 conversations visible after filter — forcing badge to 0');
          setTotalUnreadMessages(0);
        }
      } else {
        const errText = await res.text();
        if (__DEV__) console.log('[Inbox] conversations fetch error:', res.status, errText.slice(0, 200));
      }
    } catch (err) {
      if (__DEV__) console.log('[Inbox] conversations fetch exception:', err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setConvLoading(false);
    }
    // Deps: only user?.id and setTotalUnreadMessages. dismissedConvData and dismissedStorageKey
    // are intentionally read from refs (not closure) so stale captures always see current state.
  }, [user?.id, setTotalUnreadMessages]);

  // Load both on focus — also refresh badge count so it stays accurate
  useFocusEffect(
    useCallback(() => {
      trackEvent('inbox_opened');
      loadChatData(user?.id ?? undefined);
      loadConversations(false);
      // Force-reload alerts every time the inbox gets focus so alerts created
      // while on another screen (or after returning from alert-detail) appear immediately.
      loadAlerts(user?.id ?? undefined);
      // Refresh badge count from backend on every focus to prevent stale values.
      // markConversationRead in the chat screen already fires on thread entry,
      // but calling here ensures the badge is always authoritative on inbox open.
      fetchUnreadMessageCount();
    }, [loadChatData, loadConversations, loadAlerts, fetchUnreadMessageCount, user?.id])
  );

  // Poll messages every 15s
  useEffect(() => {
    if (!user?.id) return;
    const id = setInterval(() => loadConversations(true), 15_000);
    return () => { clearInterval(id); if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [user?.id, loadConversations]);

  // Track empty inbox state once loading resolves with no conversations
  useEffect(() => {
    if (!convLoading && conversations.length === 0) {
      trackEvent('inbox_empty_viewed');
    }
  }, [convLoading, conversations.length]);

  // ── Message handlers ───────────────────────────────────────────────────────
  const handleThreadPress = (conv: Conversation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    trackEvent('inbox_thread_opened', { farmstand_id: conv.farmstand_id, farmstand_name: conv.farmstand_name ?? null, had_unread: (conv.unread_count ?? 0) > 0 });

    // Optimistically clear the per-conversation unread badge the moment the user taps.
    // This covers the race where the background poll returns stale server data before the
    // mark-read POST has round-tripped (mark-read fires on the chat screen's useFocusEffect).
    const convKey = `${conv.farmstand_id}__${conv.other_user_id}`;
    if ((conv.unread_count ?? 0) > 0) {
      recentlyReadRef.current.set(convKey, Date.now());
      setConversations(prev =>
        prev.map(c =>
          c.farmstand_id === conv.farmstand_id && c.other_user_id === conv.other_user_id
            ? { ...c, unread_count: 0 }
            : c
        )
      );
    }

    navigateToConversation({
      farmstandId: conv.farmstand_id,
      otherUserId: conv.other_user_id,
      farmstandName: conv.farmstand_name ?? 'Farmstand',
      otherUserName: conv.other_user_name ?? undefined,
      otherUserAvatarUrl: conv.other_user_avatar_url ?? undefined,
    });
  };

  const handleDeleteRequest = (conv: Conversation) => { setConvToDelete(conv); setDeleteModalVisible(true); };

  const handleDeleteConfirm = async () => {
    if (!convToDelete) return;
    const deleted = convToDelete;
    setDeleteModalVisible(false);
    setConvToDelete(null);

    const convKey = `${deleted.farmstand_id}__${deleted.other_user_id}`;
    console.log(`[Inbox] dismissing conversation: userId=${user?.id} farmstand_id=${deleted.farmstand_id} other_user_id=${deleted.other_user_id} farmstand_deleted=${deleted.farmstand_deleted}`);

    // If the conversation had unread messages, mark it read BEFORE hiding it.
    // This ensures message_reads.db is updated even if hide-thread fails —
    // preventing the badge from staying high for conversations the user deleted.
    if ((deleted.unread_count ?? 0) > 0) {
      markConversationRead(deleted.farmstand_id, deleted.other_user_id);
    }

    // Persist locally first — guarantees the thread stays gone even if the API
    // call fails or the next poll fires before the server row is committed.
    persistDismissedEntry(convKey);

    // Optimistically remove from local state immediately
    setConversations(prev => prev.filter(c => `${c.farmstand_id}__${c.other_user_id}` !== convKey));
    trackEvent('inbox_thread_deleted', { farmstand_id: deleted.farmstand_id, farmstand_name: deleted.farmstand_name ?? null });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const session = await getValidSession();
      if (session?.access_token) {
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
        const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
        const isOwner = deleted.viewer_is_owner ?? false;
        const ownerId  = isOwner ? user!.id : deleted.other_user_id;
        const customerId = isOwner ? deleted.other_user_id : user!.id;
        const patchCol = isOwner ? 'deleted_by_owner_at' : 'deleted_by_customer_at';
        const deletedAt = new Date().toISOString();
        if (__DEV__) console.log(`[Inbox] soft-delete PATCH — col=${patchCol} userId=${user?.id} role=${isOwner ? 'owner' : 'customer'} conversationKey=${convKey} deletedAt=${deletedAt}`);

        // ── Soft-delete in conversations table (primary persistence) ───────────
        try {
          const patchUrl = `${supabaseUrl}/rest/v1/conversations?farmstand_id=eq.${deleted.farmstand_id}&customer_id=eq.${customerId}&owner_id=eq.${ownerId}`;
          const patchRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ [patchCol]: deletedAt }),
          });
          if (__DEV__) {
            if (patchRes.ok) {
              console.log(`[Inbox] soft-delete PATCH succeeded for conversationKey=${convKey}`);
            } else {
              const errText = await patchRes.text();
              console.log(`[Inbox] soft-delete PATCH failed: ${patchRes.status} ${errText.slice(0, 200)}`);
            }
          }
        } catch (patchErr) {
          if (__DEV__) console.log('[Inbox] soft-delete PATCH exception:', patchErr instanceof Error ? patchErr.message : String(patchErr));
        }

        // ── Backend hide-thread (belt-and-suspenders for SQLite + hidden_threads) ──
        if (BACKEND_URL) {
          const res = await fetch(`${BACKEND_URL}/api/messages/hide-thread`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              farmstand_id: deleted.farmstand_id,
              other_user_id: deleted.other_user_id,
            }),
          });
          if (__DEV__) {
            if (res.ok) {
              console.log(`[Inbox] hide-thread API succeeded for key=${convKey}`);
            } else {
              const errText = await res.text();
              console.log(`[Inbox] hide-thread API error: ${res.status} ${errText}`);
            }
          }
        }
      }
    } catch (err) {
      if (__DEV__) console.log('[Inbox] delete exception:', err instanceof Error ? err.message : String(err));
    }

    // Refetch from server — dismissed key filter will catch any that slip through
    await loadConversations(true);
    console.log(`[Inbox] inbox count after dismiss refetch: ${conversations.length}`);
  };

  // ── Alert handlers ─────────────────────────────────────────────────────────
  const handleAlertPress = (alert: Alert) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (alert.read_at === null) markAsRead(alert.id);
    router.push(`/alert-detail?id=${alert.id}`);
  };

  const handleAlertDismiss = (alertId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    deleteAlert(alertId);
  };

  const handleMarkAllAlertsRead = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    markAllAsRead(user?.id ?? undefined);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: CREAM }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: CREAM }}>
        {/* Header */}
        <View style={{ paddingHorizontal: hPad, paddingTop: 4, paddingBottom: 0, borderBottomWidth: 1, borderBottomColor: SAND }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 26, fontWeight: '700', color: '#2C2420', letterSpacing: -0.3 }}>Inbox</Text>
            {activeTab === 'alerts' && unreadAlertCount > 0 && (
              <Pressable onPress={handleMarkAllAlertsRead} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <CheckCheck size={15} color={FOREST} />
                <Text style={{ fontSize: 13, color: FOREST, fontWeight: '600' }}>Mark all read</Text>
              </Pressable>
            )}
          </View>

          {/* Tab pills */}
          <TabPills
            active={activeTab}
            onSelect={setActiveTab}
            messagesBadge={totalUnreadMessages}
            alertsBadge={unreadAlertCount}
          />
        </View>
      </SafeAreaView>

      {/* Content */}
      {activeTab === 'messages' ? (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          {convLoading ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 80 }}>
              <ActivityIndicator size="large" color={FOREST} />
            </View>
          ) : conversations.length === 0 ? (
            <MessagesEmpty />
          ) : (
            <View style={{ backgroundColor: '#fff', marginTop: 10, borderRadius: 14, marginHorizontal: hPad, overflow: 'hidden', borderWidth: 1, borderColor: SAND }}>
              {conversations.map((conv, index) => (
                <SwipeableThreadListItem
                  key={`${conv.farmstand_id}_${conv.other_user_id}`}
                  conversation={conv}
                  unreadCount={conv.unread_count ?? 0}
                  onPress={() => handleThreadPress(conv)}
                  onDelete={() => handleDeleteRequest(conv)}
                  index={index}
                />
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10, paddingBottom: 40, paddingHorizontal: isTablet ? hPad : 0 }}>
          {alertsLoading ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 80 }}>
              <ActivityIndicator size="large" color={FOREST} />
            </View>
          ) : alerts.length === 0 ? (
            <AlertsEmpty />
          ) : (
            alerts.map((alert, index) => {
              console.log(`[InboxAlerts] rendering alert[${index}]: id=${alert.id} type=${alert.type} title="${alert.title}" read=${!!alert.read_at} deleted=${!!alert.deleted_at}`);
              return (
                <SwipeableAlertCard
                  key={alert.id}
                  alert={alert}
                  index={index}
                  onPress={handleAlertPress}
                  onDismiss={handleAlertDismiss}
                />
              );
            })
          )}
        </ScrollView>
      )}

      <DeleteConfirmationModal
        visible={deleteModalVisible}
        onCancel={() => { setDeleteModalVisible(false); setConvToDelete(null); }}
        onConfirm={handleDeleteConfirm}
      />
    </View>
  );
}
