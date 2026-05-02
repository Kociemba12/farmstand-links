import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
  Dimensions,
  Image,
  StatusBar,
} from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  MessageSquare,
  Star,
  CheckCircle,
  ChevronRight,
  X,
  Send,
  Trash2,
} from 'lucide-react-native';
import Animated, {
  FadeInDown,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  interpolate,
  Extrapolation,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { AdminGuard } from '@/components/AdminGuard';
import { supabase, type SupabaseError } from '@/lib/supabase';
import { useUserStore } from '@/lib/user-store';
import { useAdminUnreadStore } from '@/lib/admin-unread-store';
import { useAdminStore } from '@/lib/admin-store';

const BG_COLOR = '#FAF7F2';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DELETE_THRESHOLD = 80;
const FULL_SWIPE_THRESHOLD = SCREEN_WIDTH * 0.4;

type FeedbackStatus = 'all' | 'new' | 'read' | 'resolved';

interface FeedbackRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_email: string;
  user_name: string | null;
  rating: number | null;
  category: string;
  message: string;
  status: string;
  admin_notes: string | null;
  handled_by: string | null;
  handled_at: string | null;
  source_screen: string | null;
  screenshot_urls?: string[] | null;
}

interface ThreadMessage {
  id: string;
  feedback_id: string;
  sender_role: 'farmer' | 'admin';
  sender_user_id: string;
  sender_email: string;
  message_text: string;
  created_at: string;
  is_visible_to_farmer: boolean | number;
  attachment_urls?: string[] | null;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    new: { bg: '#FEF9C3', text: '#854D0E', label: 'New' },
    read: { bg: '#DBEAFE', text: '#1E40AF', label: 'Read' },
    resolved: { bg: '#DCFCE7', text: '#166534', label: 'Resolved' },
  }[status] ?? { bg: '#F3F4F6', text: '#374151', label: status };

  return (
    <View style={{ backgroundColor: config.bg }} className="px-2.5 py-1 rounded-full">
      <Text style={{ color: config.text }} className="text-xs font-semibold">{config.label}</Text>
    </View>
  );
}

function StarRow({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <View className="flex-row">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={12}
          color="#D4943A"
          fill={s <= rating ? '#D4943A' : 'transparent'}
          style={{ marginRight: 1 }}
        />
      ))}
    </View>
  );
}

interface FeedbackCardProps {
  item: FeedbackRow;
  onPress: () => void;
  onDelete: () => void;
  delay?: number;
}

function FeedbackCard({ item, onPress, onDelete, delay = 0 }: FeedbackCardProps) {
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
        runOnJS(triggerDelete)();
        runOnJS(resetSwipe)();
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
    <Animated.View entering={FadeInDown.delay(delay).duration(350)} style={{ marginBottom: 12 }}>
      <View style={{ position: 'relative', flexDirection: 'row' }}>
        {/* Delete action revealed on swipe left */}
        <Animated.View style={[{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
          borderRadius: 16,
        }, deleteStyle]}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              translateX.value = withSpring(0, { damping: 20 });
              onDelete();
            }}
            style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <Trash2 size={20} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 3 }}>Delete</Text>
          </Pressable>
        </Animated.View>

        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[{ width: '100%' }, rowStyle]}>
            <View
              className="bg-white rounded-[16px] p-4"
              style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }}
            >
              <View className="flex-row items-start justify-between mb-2">
                <View className="flex-1 mr-3">
                  <View className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-stone-900 font-semibold text-sm" numberOfLines={1}>
                      {item.user_name || item.user_email}
                    </Text>
                    {item.status === 'new' && (
                      <View className="w-2 h-2 rounded-full bg-amber-400" />
                    )}
                  </View>
                  <Text className="text-stone-400 text-xs mt-0.5">{item.user_email}</Text>
                </View>
                <StatusBadge status={item.status} />
              </View>

              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center gap-2">
                  <View className="bg-stone-100 px-2 py-0.5 rounded-full">
                    <Text className="text-stone-600 text-xs">{item.category}</Text>
                  </View>
                  <StarRow rating={item.rating} />
                </View>
                <Text className="text-stone-400 text-xs">{formatDate(item.created_at)}</Text>
              </View>

              <Text className="text-stone-600 text-sm leading-5" numberOfLines={2}>{item.message}</Text>

              <View className="flex-row items-center justify-end mt-2">
                <ChevronRight size={16} color="#A8A29E" />
              </View>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

const STATUS_FILTERS: { key: FeedbackStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'read', label: 'Read' },
  { key: 'resolved', label: 'Resolved' },
];

function AdminFeedbackContent() {
  const router = useRouter();
  const decrementAdminUnread = useAdminUnreadStore((s) => s.decrementCount);
  const fetchAdminUnreadCount = useAdminUnreadStore((s) => s.fetchAdminUnreadCount);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus>('all');
  const [tableMissing, setTableMissing] = useState(false);

  // Detail modal state
  const [selectedItem, setSelectedItem] = useState<FeedbackRow | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const replyInputRef = useRef<TextInput>(null);

  // Image viewer state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  const openImageViewer = useCallback((urls: string[], index: number) => {
    setViewerImages(urls);
    setViewerIndex(index);
    setViewerVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const loadFeedback = useCallback(async () => {
    if (__DEV__) console.log('[AdminFeedback] loadFeedback — started | activeTab:', statusFilter);
    try {
      const { data, error } = await supabase
        .from<FeedbackRow>('feedback')
        .select('*')
        .neq('source_screen', 'support_dismissed')
        .order('created_at', { ascending: false })
        .requireAuth()
        .execute();

      if (error) {
        const sbErr = error as SupabaseError;
        if (__DEV__) {
          console.warn('[AdminFeedback] loadFeedback Supabase error | code:', sbErr.code ?? 'N/A', '| message:', sbErr.message, '| details:', sbErr.details ?? 'N/A');
        }
        if (sbErr.code === '42P01' || (sbErr.message ?? '').includes('does not exist')) {
          setTableMissing(true);
          setFeedbackItems([]);
        }
        return;
      }

      if (__DEV__) console.log('[AdminFeedback] loadFeedback — rows returned:', data?.length ?? 0, '| activeTab:', statusFilter);
      setTableMissing(false);
      setFeedbackItems(data ?? []);
    } catch (err) {
      if (__DEV__) console.warn('[AdminFeedback] Load error:', err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // All rows fetched once; status tab is filtered client-side

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadFeedback();
      fetchAdminUnreadCount();
    }, [loadFeedback, fetchAdminUnreadCount])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadFeedback();
  }, [loadFeedback]);

  const loadThread = useCallback(async (feedbackId: string) => {
    setIsLoadingThread(true);
    try {
      if (__DEV__) console.log('[AdminFeedback] loadThread — feedbackId:', feedbackId, '| table: feedback_messages');
      const { data, error } = await supabase
        .from<ThreadMessage>('feedback_messages')
        .select('*')
        .eq('feedback_id', feedbackId)
        .order('created_at', { ascending: true })
        .requireAuth()
        .execute();

      if (error) {
        const sbErr = error as SupabaseError;
        if (__DEV__) console.warn('[AdminFeedback] loadThread error | code:', sbErr.code ?? 'N/A', '| message:', sbErr.message, '| details:', sbErr.details ?? 'N/A');
      } else {
        if (__DEV__) console.log('[AdminFeedback] loadThread — messages returned:', data?.length ?? 0);
        setThread(data ?? []);
      }
    } catch (err) {
      if (__DEV__) console.warn('[AdminFeedback] loadThread error:', err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingThread(false);
    }
  }, []);

  const markStatus = useCallback(async (id: string, status: 'read' | 'resolved') => {
    try {
      if (status === 'resolved') {
        const { error } = await supabase.rpc('mark_ticket_resolved', { p_ticket_id: id });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('mark_feedback_read', { p_ticket_id: id });
        if (error) throw error;
      }
      if (__DEV__) console.log('[AdminFeedback] markStatus success — id:', id, '| status:', status);
      setFeedbackItems((prev) => {
        const next = prev.map((f) => (f.id === id ? { ...f, status } : f));
        if (__DEV__) console.log('[Admin Feedback] ticket status counts:', {
          resolved: next.filter((f) => f.status === 'resolved').length,
          open: next.filter((f) => f.status !== 'resolved').length,
        });
        return next;
      });
      if (selectedItem?.id === id) {
        setSelectedItem((prev) => prev ? { ...prev, status } : prev);
      }
    } catch (err) {
      if (__DEV__) console.warn('[AdminFeedback] markStatus error:', err instanceof Error ? err.message : String(err));
    }
  }, [selectedItem]);

  const handleOpenDetail = useCallback((item: FeedbackRow) => {
    if (__DEV__) {
      console.log('[AdminFeedback] handleOpenDetail — ticketId:', item.id);
      console.log('[AdminFeedback] handleOpenDetail — message exists:', !!item.message);
      console.log('[AdminFeedback] handleOpenDetail — screenshot_urls:', JSON.stringify(item.screenshot_urls));
      console.log('[AdminFeedback] handleOpenDetail — image count:', item.screenshot_urls?.length ?? 0);
    }
    setSelectedItem(item);
    setThread([]);
    setReplyText('');
    void loadThread(item.id);
    // Mark as read if new — never touch resolved tickets
    if (item.status === 'resolved') return;
    if (item.status === 'new') {
      if (__DEV__) console.log('[AdminFeedback] marking ticket read — id:', item.id);
      void markStatus(item.id, 'read');
      decrementAdminUnread();
    }
  }, [loadThread, markStatus, decrementAdminUnread]);

  const handleSendReply = useCallback(async () => {
    if (!selectedItem || !replyText.trim()) return;
    const adminUser = useUserStore.getState().user;
    const adminUserId = adminUser?.id ?? '';
    const adminEmail = adminUser?.email ?? '';
    if (__DEV__) console.log('[AdminReply] Send tapped — feedback_id:', selectedItem.id, '| table: feedback_messages via add_feedback_reply RPC');
    setIsSendingReply(true);
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc<{ success: boolean; id?: string; error?: string }>(
        'add_feedback_reply',
        {
          p_feedback_id:     selectedItem.id,
          p_sender_role:     'admin',
          p_sender_user_id:  adminUserId,
          p_sender_email:    adminEmail,
          p_message_text:    replyText.trim(),
          p_attachment_urls: [],
        }
      );

      if (rpcError) {
        const sbErr = rpcError as SupabaseError;
        if (__DEV__) console.warn('[AdminReply] add_feedback_reply RPC error | code:', sbErr.code ?? 'N/A', '| message:', sbErr.message, '| details:', sbErr.details ?? 'N/A');
        Alert.alert('Reply could not be saved. Please try again.');
        return;
      }

      if (__DEV__) console.log('[AdminReply] add_feedback_reply RPC result — success:', rpcData?.success, '| id:', rpcData?.id ?? 'N/A');

      if (!rpcData?.success) {
        if (__DEV__) console.warn('[AdminReply] RPC returned success=false:', rpcData?.error);
        Alert.alert('Reply could not be saved. Please try again.');
        return;
      }

      const newMsg: ThreadMessage = {
        id:                   rpcData.id ?? `${Date.now()}`,
        feedback_id:          selectedItem.id,
        sender_role:          'admin',
        sender_user_id:       adminUserId,
        sender_email:         adminEmail,
        message_text:         replyText.trim(),
        created_at:           new Date().toISOString(),
        is_visible_to_farmer: true,
        attachment_urls:      null,
      };

      setThread((prev) => [...prev, newMsg]);
      setReplyText('');
      setFeedbackItems((prev) =>
        prev.map((f) => (f.id === selectedItem.id ? { ...f, status: 'read' } : f))
      );
      setSelectedItem((prev) => prev ? { ...prev, status: 'read' } : prev);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        if (typeof scrollViewRef.current?.scrollTo === 'function') {
          scrollViewRef.current.scrollTo({ y: 999999, animated: true });
        }
      }, 100);
    } catch (err) {
      if (__DEV__) console.warn('[AdminReply] sendReply threw:', err instanceof Error ? err.message : String(err));
      Alert.alert('Reply could not be saved. Please try again.');
    } finally {
      setIsSendingReply(false);
    }
  }, [selectedItem, replyText]);

  const handleResolve = useCallback(async () => {
    if (!selectedItem) return;
    setIsUpdating(true);
    await markStatus(selectedItem.id, 'resolved');
    setIsUpdating(false);
    setSelectedItem(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [selectedItem, markStatus]);

  const handleDeleteTicket = useCallback((id: string) => {
    const ticketId = id;

    if (!ticketId || ticketId.startsWith('ticket-')) {
      Alert.alert('Error', 'Missing real ticket ID.');
      return;
    }

    Alert.alert(
      'Delete ticket?',
      'This will permanently remove this support/feedback ticket and its conversation.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.rpc('admin_delete_feedback_ticket', {
                p_ticket_id: ticketId,
              });

              if (__DEV__) console.log('[Admin Feedback] delete RPC result:', { data, error });

              if (error) throw error;

              setFeedbackItems((prev) =>
                prev.filter((f) => f.id !== ticketId)
              );
              if (selectedItem?.id === ticketId) setSelectedItem(null);
              useAdminStore.getState().removeSupportTicketLocal(ticketId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              if (__DEV__) console.warn('[AdminFeedback] delete error:', err instanceof Error ? err.message : String(err));
              Alert.alert('Delete failed', err instanceof Error ? err.message : 'Could not delete ticket. Please try again.');
            }
          },
        },
      ]
    );
  }, [selectedItem]);

  const newCount = feedbackItems.filter((f) => f.status === 'new').length;
  const filteredItems = statusFilter === 'all'
    ? feedbackItems
    : feedbackItems.filter((f) => f.status === statusFilter);

  return (
    <View className="flex-1" style={{ backgroundColor: BG_COLOR }}>
      {/* Header */}
      <Animated.View entering={FadeIn.duration(400)}>
        <LinearGradient
          colors={['#2F6F4E', '#4A9E6F']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingBottom: 24, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}
        >
          <SafeAreaView edges={['top']}>
            <View className="px-5 pt-4">
              <Pressable
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
                className="w-10 h-10 bg-white/20 rounded-full items-center justify-center mb-4"
              >
                <ArrowLeft size={22} color="white" />
              </Pressable>

              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-white text-2xl font-bold">Feedback</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.75)' }} className="text-sm mt-0.5">
                    {newCount > 0 ? `${newCount} unread` : 'All up to date'}
                  </Text>
                </View>
                <View
                  className="w-12 h-12 rounded-full items-center justify-center"
                  style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
                >
                  <MessageSquare size={24} color="white" />
                </View>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
      </Animated.View>

      {/* Filter tabs */}
      <View className="px-5 pt-4 pb-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2">
            {STATUS_FILTERS.map(({ key, label }) => {
              const isActive = statusFilter === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStatusFilter(key); }}
                  className={`px-4 py-2 rounded-full ${isActive ? 'bg-forest' : 'bg-white border border-stone-200'}`}
                >
                  <Text className={`text-sm font-medium ${isActive ? 'text-white' : 'text-stone-600'}`}>
                    {label}
                    {key === 'new' && newCount > 0 ? ` (${newCount})` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Content */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2F6F4E" />
        </View>
      ) : tableMissing ? (
        <View className="flex-1 px-5 pt-8 items-center">
          <View className="bg-amber-50 border border-amber-200 rounded-2xl p-6 w-full">
            <Text className="text-amber-800 font-bold text-base text-center mb-2">Feedback Table Not Set Up</Text>
            <Text className="text-amber-700 text-sm text-center leading-5 mb-4">
              Run the following SQL in your Supabase dashboard SQL Editor to create the feedback table:
            </Text>
            <View className="bg-amber-100 rounded-xl p-3">
              <Text className="text-amber-900 text-xs font-mono leading-5">
                {`CREATE TABLE IF NOT EXISTS public.feedback (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n  user_id TEXT,\n  user_email TEXT NOT NULL,\n  user_name TEXT,\n  rating INTEGER CHECK (rating >= 1 AND rating <= 5),\n  category TEXT NOT NULL,\n  message TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'new',\n  admin_notes TEXT,\n  handled_by TEXT,\n  handled_at TIMESTAMPTZ,\n  source_screen TEXT DEFAULT 'rate-us'\n);\nALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "service_all_feedback" ON public.feedback FOR ALL TO service_role USING (true);`}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-5 pt-2"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#2F6F4E"
              colors={['#2F6F4E']}
            />
          }
        >
          {filteredItems.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(400)} className="items-center pt-16">
              <View className="w-16 h-16 rounded-full bg-stone-100 items-center justify-center mb-4">
                <MessageSquare size={28} color="#A8A29E" />
              </View>
              <Text className="text-stone-500 font-medium">No feedback yet</Text>
              <Text className="text-stone-400 text-sm mt-1">
                {statusFilter !== 'all' ? `No ${statusFilter} feedback` : 'Feedback will appear here'}
              </Text>
            </Animated.View>
          ) : (
            filteredItems.map((item, i) => (
              <FeedbackCard
                key={item.id}
                item={item}
                onPress={() => handleOpenDetail(item)}
                onDelete={() => handleDeleteTicket(item.id)}
                delay={i * 40}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* Detail Modal */}
      <Modal
        visible={!!selectedItem}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedItem(null)}
      >
        {selectedItem && (
          <>
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: '#FAF7F2' }}>
              {/* Modal Header */}
              <SafeAreaView edges={['top']} style={{ backgroundColor: '#FAF7F2' }}>
                <View className="px-5 py-4 flex-row items-center justify-between border-b border-stone-100">
                  <View>
                    <Text className="text-stone-900 text-lg font-bold">Support Ticket</Text>
                    <Text className="text-stone-400 text-xs mt-0.5">{selectedItem.category}</Text>
                  </View>
                  <View className="flex-row items-center gap-3">
                    <StatusBadge status={selectedItem.status} />
                    <Pressable
                      onPress={() => setSelectedItem(null)}
                      className="w-8 h-8 rounded-full bg-stone-100 items-center justify-center"
                    >
                      <X size={18} color="#6B7280" />
                    </Pressable>
                  </View>
                </View>
              </SafeAreaView>

              {/* Scrollable conversation content */}
              <KeyboardAwareScrollView
                ref={scrollViewRef}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                onContentSizeChange={(_, contentHeight) => {
                  if (typeof scrollViewRef.current?.scrollTo === 'function') {
                    scrollViewRef.current.scrollTo({ y: contentHeight, animated: false });
                  }
                }}
                bottomOffset={80}
              >
                {/* User Info */}
                <View className="px-5 mb-4">
                  <View className="bg-white rounded-2xl p-4" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 }}>
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-stone-900 font-semibold">
                        {selectedItem.user_name || selectedItem.user_email}
                      </Text>
                      <StarRow rating={selectedItem.rating} />
                    </View>
                    <Text className="text-stone-400 text-xs">{selectedItem.user_email}</Text>
                    <Text className="text-stone-300 text-xs mt-0.5">{formatDate(selectedItem.created_at)}</Text>
                  </View>
                </View>

                {/* Conversation thread */}
                <View className="px-5 mb-2">
                  <Text className="text-stone-400 text-xs font-semibold uppercase tracking-wider mb-3">Conversation</Text>

                  {/* Original submitted message — always shown first, from the feedback row */}
                  <View className="mb-3" style={{ alignItems: 'flex-start' }}>
                    <View style={{ maxWidth: '85%' }}>
                      <View
                        style={{
                          backgroundColor: '#FFFFFF',
                          borderRadius: 16,
                          borderBottomLeftRadius: 4,
                          padding: 12,
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.08,
                          shadowRadius: 4,
                          elevation: 1,
                        }}
                      >
                        <Text style={{ color: '#1C1917', fontSize: 14, lineHeight: 20 }}>
                          {selectedItem.message}
                        </Text>
                        {(selectedItem.screenshot_urls?.length ?? 0) > 0 &&
                          selectedItem.screenshot_urls!.map((url, i) => (
                            <TouchableOpacity
                              key={i}
                              onPress={() => openImageViewer(selectedItem.screenshot_urls ?? [], i)}
                              activeOpacity={0.85}
                            >
                              <Image
                                source={{ uri: url }}
                                style={{
                                  width: '100%',
                                  aspectRatio: 4 / 3,
                                  borderRadius: 10,
                                  marginTop: 8,
                                }}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                          ))
                        }
                      </View>
                      <Text style={{ color: '#A8A29E', fontSize: 11, marginTop: 4, marginLeft: 4 }}>
                        {selectedItem.user_name ?? selectedItem.user_email} · {formatDate(selectedItem.created_at)}
                      </Text>
                    </View>
                  </View>

                  {isLoadingThread ? (
                    <View className="items-center py-4">
                      <ActivityIndicator size="small" color="#2F6F4E" />
                    </View>
                  ) : (
                    thread.map((msg) => {
                      const isAdmin = msg.sender_role === 'admin';
                      const imageUrls: string[] = Array.isArray(msg.attachment_urls)
                        ? msg.attachment_urls.filter((u): u is string => typeof u === 'string')
                        : [];
                      if (__DEV__ && imageUrls.length > 0) console.log(`[AdminFeedback][render] msg ${msg.id} → imageUrls:`, imageUrls);

                      return (
                        <View key={msg.id} className="mb-3" style={{ alignItems: isAdmin ? 'flex-end' : 'flex-start' }}>
                          <View style={{ maxWidth: '85%' }}>
                            <View
                              style={{
                                backgroundColor: isAdmin ? '#2D5A3D' : '#FFFFFF',
                                borderRadius: 16,
                                borderBottomRightRadius: isAdmin ? 4 : 16,
                                borderBottomLeftRadius: isAdmin ? 16 : 4,
                                padding: 12,
                                shadowColor: '#000',
                                shadowOffset: { width: 0, height: 1 },
                                shadowOpacity: 0.08,
                                shadowRadius: 4,
                                elevation: 1,
                              }}
                            >
                              <Text style={{ color: isAdmin ? '#FFFFFF' : '#1C1917', fontSize: 14, lineHeight: 20 }}>
                                {msg.message_text}
                              </Text>
                              {imageUrls.map((url, i) => (
                                <TouchableOpacity
                                  key={i}
                                  onPress={() => openImageViewer(imageUrls, i)}
                                  activeOpacity={0.85}
                                >
                                  <Image
                                    source={{ uri: url }}
                                    style={{
                                      width: '100%',
                                      aspectRatio: 4 / 3,
                                      borderRadius: 10,
                                      marginTop: 8,
                                    }}
                                    resizeMode="cover"
                                  />
                                </TouchableOpacity>
                              ))}
                            </View>
                            <Text style={{ color: '#A8A29E', fontSize: 11, marginTop: 4, textAlign: isAdmin ? 'right' : 'left', marginRight: isAdmin ? 4 : 0, marginLeft: isAdmin ? 0 : 4 }}>
                              {isAdmin ? 'Support Team' : (selectedItem.user_name ?? selectedItem.user_email)} · {formatDate(msg.created_at)}
                            </Text>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>

                {/* Resolve action (inside scroll area) */}
                <View className="px-5 mt-2">
                  {selectedItem.status !== 'resolved' ? (
                    <Pressable
                      onPress={handleResolve}
                      disabled={isUpdating}
                      style={{
                        backgroundColor: isUpdating ? '#A8C4B0' : '#16A34A',
                        borderRadius: 14,
                        paddingVertical: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                    >
                      <CheckCircle size={16} color="white" />
                      <Text style={{ color: 'white', fontWeight: '600', fontSize: 14 }}>
                        {isUpdating ? 'Updating...' : 'Mark as Resolved'}
                      </Text>
                    </Pressable>
                  ) : (
                    <View className="flex-row items-center justify-center gap-2 py-3">
                      <CheckCircle size={16} color="#16A34A" />
                      <Text className="text-green-700 font-medium text-sm">
                        Resolved by {selectedItem.handled_by ?? 'admin'}
                      </Text>
                    </View>
                  )}
                </View>
              </KeyboardAwareScrollView>

              {/* Reply bar — sticks to top of keyboard */}
              <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
                <SafeAreaView
                  edges={['bottom']}
                  style={{
                    backgroundColor: '#FAF7F2',
                    borderTopWidth: 1,
                    borderTopColor: '#E7E5E4',
                  }}
                >
                  <View style={{ paddingTop: 10, paddingBottom: 10, paddingHorizontal: 14 }}>
                    <Pressable
                      onPress={() => replyInputRef.current?.focus()}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'flex-end',
                        backgroundColor: '#FFFFFF',
                        borderRadius: 22,
                        borderWidth: 1,
                        borderColor: '#D6D3D1',
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        gap: 8,
                      }}
                    >
                      <TextInput
                        ref={replyInputRef}
                        value={replyText}
                        onChangeText={setReplyText}
                        placeholder="Reply to user..."
                        placeholderTextColor="#9CA3AF"
                        multiline
                        style={{
                          flex: 1,
                          fontSize: 15,
                          color: '#1C1917',
                          minHeight: 36,
                          maxHeight: 100,
                          paddingTop: 4,
                          paddingBottom: 4,
                        }}
                      />
                      <Pressable
                        onPress={handleSendReply}
                        disabled={isSendingReply || !replyText.trim()}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          backgroundColor: replyText.trim() && !isSendingReply ? '#2D5A3D' : '#D6D3D1',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isSendingReply ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Send size={16} color="#FFFFFF" />
                        )}
                      </Pressable>
                    </Pressable>
                  </View>
                </SafeAreaView>
              </KeyboardStickyView>
            </View>
          </View>

          {/* Image Viewer — inside the pageSheet Modal so it can appear above it on iOS */}
          <Modal
            visible={viewerVisible}
            transparent
            animationType="fade"
            statusBarTranslucent
            onRequestClose={() => setViewerVisible(false)}
          >
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              <StatusBar hidden />

              {/* Close button */}
              <TouchableOpacity
                onPress={() => {
                  setViewerVisible(false);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={{
                  position: 'absolute',
                  top: 52,
                  right: 20,
                  zIndex: 10,
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                hitSlop={10}
              >
                <X size={20} color="#fff" />
              </TouchableOpacity>

              {/* Page indicator */}
              {viewerImages.length > 1 && (
                <View style={{
                  position: 'absolute',
                  top: 58,
                  left: 0,
                  right: 0,
                  alignItems: 'center',
                  zIndex: 10,
                }}>
                  <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                    {viewerIndex + 1} / {viewerImages.length}
                  </Text>
                </View>
              )}

              {/* Horizontally paged image strip */}
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                contentOffset={{ x: viewerIndex * SCREEN_WIDTH, y: 0 }}
                onMomentumScrollEnd={(e) => {
                  const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                  setViewerIndex(page);
                }}
                style={{ flex: 1 }}
              >
                {viewerImages.map((url, i) => (
                  <ScrollView
                    key={i}
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    centerContent
                    style={{ width: SCREEN_WIDTH }}
                    contentContainerStyle={{
                      width: SCREEN_WIDTH,
                      height: '100%',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Image
                      source={{ uri: url }}
                      style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH }}
                      resizeMode="contain"
                    />
                  </ScrollView>
                ))}
              </ScrollView>
            </View>
          </Modal>
          </>
        )}
      </Modal>
    </View>
  );
}

export default function AdminFeedback() {
  return (
    <AdminGuard>
      <AdminFeedbackContent />
    </AdminGuard>
  );
}
