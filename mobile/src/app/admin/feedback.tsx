import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  MessageSquare,
  Star,
  CheckCircle,
  Circle,
  ChevronRight,
  X,
  Filter,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AdminGuard } from '@/components/AdminGuard';
import { getValidSession } from '@/lib/supabase';

const BG_COLOR = '#FAF7F2';
const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

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
  delay?: number;
}

function FeedbackCard({ item, onPress, delay = 0 }: FeedbackCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(350)}>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
        className="bg-white rounded-[16px] p-4 mb-3 active:opacity-80"
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
      </Pressable>
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
  const [feedbackItems, setFeedbackItems] = useState<FeedbackRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus>('all');
  const [tableMissing, setTableMissing] = useState(false);

  // Detail modal state
  const [selectedItem, setSelectedItem] = useState<FeedbackRow | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const loadFeedback = useCallback(async () => {
    try {
      const session = await getValidSession();
      if (!session) return;

      const url = `${BACKEND_URL}/api/feedback${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const json = await resp.json() as { success: boolean; data?: FeedbackRow[]; error?: string };

      if (json.error === 'feedback_table_missing') {
        setTableMissing(true);
        setFeedbackItems([]);
      } else if (json.success && json.data) {
        setTableMissing(false);
        setFeedbackItems(json.data);
      }
    } catch (err) {
      console.error('[AdminFeedback] Load error:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [statusFilter]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadFeedback();
    }, [loadFeedback])
  );

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadFeedback();
  }, [loadFeedback]);

  const handleOpenDetail = useCallback((item: FeedbackRow) => {
    setSelectedItem(item);
    setAdminNote(item.admin_notes ?? '');
    // Mark as read if new
    if (item.status === 'new') {
      void markStatus(item.id, 'read');
    }
  }, []);

  const markStatus = useCallback(async (id: string, status: 'read' | 'resolved') => {
    try {
      const session = await getValidSession();
      if (!session) return;
      await fetch(`${BACKEND_URL}/api/feedback/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status }),
      });
      // Update local state
      setFeedbackItems((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status } : f))
      );
      if (selectedItem?.id === id) {
        setSelectedItem((prev) => prev ? { ...prev, status } : prev);
      }
    } catch (err) {
      console.error('[AdminFeedback] markStatus error:', err);
    }
  }, [selectedItem]);

  const handleSaveNote = useCallback(async () => {
    if (!selectedItem) return;
    setIsUpdating(true);
    try {
      const session = await getValidSession();
      if (!session) return;
      const resp = await fetch(`${BACKEND_URL}/api/feedback/${selectedItem.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ admin_notes: adminNote }),
      });
      const json = await resp.json() as { success: boolean };
      if (json.success) {
        setFeedbackItems((prev) =>
          prev.map((f) => (f.id === selectedItem.id ? { ...f, admin_notes: adminNote } : f))
        );
        setSelectedItem((prev) => prev ? { ...prev, admin_notes: adminNote } : prev);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.error('[AdminFeedback] saveNote error:', err);
    } finally {
      setIsUpdating(false);
    }
  }, [selectedItem, adminNote]);

  const handleResolve = useCallback(async () => {
    if (!selectedItem) return;
    await markStatus(selectedItem.id, 'resolved');
    setSelectedItem(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [selectedItem, markStatus]);

  const newCount = feedbackItems.filter((f) => f.status === 'new').length;

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
          {feedbackItems.length === 0 ? (
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
            feedbackItems.map((item, i) => (
              <FeedbackCard
                key={item.id}
                item={item}
                onPress={() => handleOpenDetail(item)}
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
          <View className="flex-1 bg-white">
            {/* Modal Header */}
            <SafeAreaView edges={['top']} style={{ backgroundColor: '#FAF7F2' }}>
              <View className="px-5 py-4 flex-row items-center justify-between border-b border-stone-100">
                <Text className="text-stone-900 text-lg font-bold">Feedback Detail</Text>
                <Pressable
                  onPress={() => setSelectedItem(null)}
                  className="w-8 h-8 rounded-full bg-stone-100 items-center justify-center"
                >
                  <X size={18} color="#6B7280" />
                </Pressable>
              </View>
            </SafeAreaView>

            <ScrollView
              className="flex-1 px-5"
              contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* User Info */}
              <View className="bg-stone-50 rounded-2xl p-4 mb-4">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-stone-900 font-semibold">
                    {selectedItem.user_name || selectedItem.user_email}
                  </Text>
                  <StatusBadge status={selectedItem.status} />
                </View>
                <Text className="text-stone-500 text-sm">{selectedItem.user_email}</Text>
                <Text className="text-stone-400 text-xs mt-1">{formatDate(selectedItem.created_at)}</Text>
              </View>

              {/* Rating & Category */}
              <View className="flex-row gap-3 mb-4">
                <View className="flex-1 bg-amber-50 rounded-xl p-3">
                  <Text className="text-amber-700 text-xs font-medium mb-1">Rating</Text>
                  <StarRow rating={selectedItem.rating} />
                  {!selectedItem.rating && <Text className="text-stone-400 text-sm">No rating</Text>}
                </View>
                <View className="flex-1 bg-blue-50 rounded-xl p-3">
                  <Text className="text-blue-700 text-xs font-medium mb-1">Category</Text>
                  <Text className="text-stone-700 text-sm font-medium">{selectedItem.category}</Text>
                </View>
              </View>

              {/* Message */}
              <View className="bg-white border border-stone-200 rounded-2xl p-4 mb-4">
                <Text className="text-stone-500 text-xs font-medium mb-2 uppercase tracking-wide">Message</Text>
                <Text className="text-stone-800 text-base leading-6">{selectedItem.message}</Text>
              </View>

              {/* Admin Notes */}
              <View className="bg-white border border-stone-200 rounded-2xl p-4 mb-4">
                <Text className="text-stone-500 text-xs font-medium mb-2 uppercase tracking-wide">Admin Notes</Text>
                <TextInput
                  value={adminNote}
                  onChangeText={setAdminNote}
                  placeholder="Add internal notes..."
                  placeholderTextColor="#9CA3AF"
                  multiline
                  textAlignVertical="top"
                  className="text-stone-800 text-sm min-h-[80px] leading-5"
                />
                <Pressable
                  onPress={handleSaveNote}
                  disabled={isUpdating}
                  className="mt-3 bg-stone-800 py-2.5 rounded-xl items-center"
                >
                  <Text className="text-white text-sm font-semibold">
                    {isUpdating ? 'Saving...' : 'Save Note'}
                  </Text>
                </Pressable>
              </View>

              {/* Actions */}
              {selectedItem.status !== 'resolved' && (
                <Pressable
                  onPress={handleResolve}
                  className="bg-green-600 py-3.5 rounded-2xl items-center flex-row justify-center gap-2"
                >
                  <CheckCircle size={18} color="white" />
                  <Text className="text-white font-semibold">Mark as Resolved</Text>
                </Pressable>
              )}
              {selectedItem.status === 'resolved' && (
                <View className="flex-row items-center justify-center gap-2 py-3">
                  <CheckCircle size={16} color="#16A34A" />
                  <Text className="text-green-700 font-medium text-sm">
                    Resolved by {selectedItem.handled_by ?? 'admin'}
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
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
