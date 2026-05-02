import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Send,
  CheckCircle,
  RotateCcw,
  Edit3,
  X,
  Star,
  Clock,
  User,
  MessageSquare,
} from 'lucide-react-native';
import { AdminGuard } from '@/components/AdminGuard';
import {
  useAdminStore,
  SupportTicket,
  SupportMessage,
  TicketStatus,
} from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import { supabase } from '@/lib/supabase';
import * as Haptics from 'expo-haptics';

function getStatusColor(status: TicketStatus): string {
  switch (status) {
    case 'open':
      return '#3B82F6';
    case 'waiting_on_farmer':
      return '#F59E0B';
    case 'waiting_on_admin':
      return '#EF4444';
    case 'resolved':
      return '#16A34A';
    case 'reopened':
      return '#8B5CF6';
    default:
      return '#6B7280';
  }
}

function getStatusLabel(status: TicketStatus): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'waiting_on_farmer':
      return 'Waiting on Farmer';
    case 'waiting_on_admin':
      return 'Waiting on Admin';
    case 'resolved':
      return 'Resolved';
    case 'reopened':
      return 'Reopened';
    default:
      return status;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MessageBubble({
  message,
  isAdmin,
  onEdit,
}: {
  message: SupportMessage;
  isAdmin: boolean;
  onEdit: (message: SupportMessage) => void;
}) {
  const isSenderAdmin = message.senderRole === 'admin';

  return (
    <View
      className={`mb-3 ${isSenderAdmin ? 'items-end' : 'items-start'}`}
    >
      <View
        className={`max-w-[85%] rounded-2xl p-4 ${
          isSenderAdmin
            ? 'bg-forest rounded-br-md'
            : 'bg-white border border-gray-200 rounded-bl-md'
        }`}
      >
        <View className="flex-row items-center mb-1">
          <Text
            className={`text-xs font-medium ${
              isSenderAdmin ? 'text-white/70' : 'text-gray-500'
            }`}
          >
            {isSenderAdmin ? 'Admin' : message.senderEmail}
          </Text>
          {message.isEdited && (
            <Text
              className={`text-xs ml-2 ${
                isSenderAdmin ? 'text-white/50' : 'text-gray-400'
              }`}
            >
              (edited)
            </Text>
          )}
        </View>
        <Text
          className={`text-base ${
            isSenderAdmin ? 'text-white' : 'text-gray-800'
          }`}
        >
          {message.messageText}
        </Text>
        <Text
          className={`text-xs mt-2 ${
            isSenderAdmin ? 'text-white/50' : 'text-gray-400'
          }`}
        >
          {formatDate(message.createdAt)}
        </Text>
      </View>
      {isSenderAdmin && isAdmin && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onEdit(message);
          }}
          className="mt-1 px-2 py-1 flex-row items-center"
        >
          <Edit3 size={12} color="#6B7280" />
          <Text className="text-xs text-gray-500 ml-1">Edit</Text>
        </Pressable>
      )}
    </View>
  );
}

function TicketThreadContent() {
  const router = useRouter();
  const { ticketId, reportId } = useLocalSearchParams<{
    ticketId?: string;
    reportId?: string;
  }>();
  const scrollViewRef = useRef<ScrollView>(null);

  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingMessage, setEditingMessage] = useState<SupportMessage | null>(
    null
  );
  const [editText, setEditText] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  // Local status override so UI updates immediately after resolve/reopen
  // without waiting for a full store reload.
  const [localStatus, setLocalStatus] = useState<TicketStatus | null>(null);

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const getTicketById = useAdminStore((s) => s.getTicketById);
  const getTicketByReportId = useAdminStore((s) => s.getTicketByReportId);
  const getMessagesByTicketId = useAdminStore((s) => s.getMessagesByTicketId);
  const sendAdminMessage = useAdminStore((s) => s.sendAdminMessage);
  const resolveTicket = useAdminStore((s) => s.resolveTicket);
  const reopenTicket = useAdminStore((s) => s.reopenTicket);
  const editAdminMessage = useAdminStore((s) => s.editAdminMessage);
  const createSupportTicket = useAdminStore((s) => s.createSupportTicket);
  const markSupportTicketResolvedLocal = useAdminStore((s) => s.markSupportTicketResolvedLocal);
  const reportsAndFlags = useAdminStore((s) => s.reportsAndFlags);
  const user = useUserStore((s) => s.user);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadAdminData();
  }, []);

  // Get ticket - either by ticketId or by reportId
  let ticket: SupportTicket | undefined;
  if (ticketId) {
    ticket = getTicketById(ticketId);
  } else if (reportId) {
    ticket = getTicketByReportId(reportId);
  }

  // If ticket doesn't exist for a report, we might need to create it
  const report = reportId
    ? reportsAndFlags.find((r) => r.id === reportId)
    : null;

  const messages = ticket ? getMessagesByTicketId(ticket.ticketId) : [];

  const handleCreateTicketForReport = async () => {
    if (!report || !user) return;

    setIsLoading(true);
    try {
      await createSupportTicket(
        report.id,
        report.submittedByUserId,
        report.submittedByUserEmail,
        `Support request: ${report.reason}`,
        report.reason,
        report.rating,
        report.comments
      );
      await loadAdminData();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error creating ticket:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !ticket || !user) return;

    setIsLoading(true);
    try {
      await sendAdminMessage(
        ticket.ticketId,
        user.id ?? '',
        user.email,
        replyText.trim()
      );
      setReplyText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error('Error sending reply:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolve = async () => {
    if (!ticket) return;

    console.log('[Resolve Ticket] ticket ids:', {
      id: ticket?.id,
      ticketId: ticket?.ticketId,
      feedbackId: ticket?.feedbackId,
    });

    const ticketId = ticket?.feedbackId ?? ticket?.id ?? ticket?.ticketId;

    if (!ticketId || ticketId.startsWith('ticket-')) {
      console.warn('[Resolve Ticket] Missing real feedback id', {
        id: ticket?.id,
        ticketId: ticket?.ticketId,
        feedbackId: ticket?.feedbackId,
      });
      Alert.alert(
        'Error',
        'This ticket is missing its real database ID. Please refresh tickets and try again.'
      );
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc('mark_ticket_resolved', {
        p_ticket_id: ticketId,
      });

      console.log('[Resolve Ticket] RPC result:', { data, error });

      if (error) {
        Alert.alert('Error', error?.message ?? 'Failed to mark ticket as resolved.');
        return;
      }

      setLocalStatus('resolved');
      markSupportTicketResolvedLocal(ticketId);
      if (__DEV__) console.log('[Resolve Ticket] resolved locally:', ticketId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[Resolve Ticket] Error:', err);
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to mark ticket as resolved.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReopen = async () => {
    if (!ticket || !user) return;

    setIsLoading(true);
    try {
      await reopenTicket(ticket.ticketId, user.id ?? '');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error reopening ticket:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditMessage = (message: SupportMessage) => {
    setEditingMessage(message);
    setEditText(message.messageText);
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingMessage || !editText.trim()) return;

    setIsLoading(true);
    try {
      await editAdminMessage(editingMessage.messageId, editText.trim());
      setShowEditModal(false);
      setEditingMessage(null);
      setEditText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error editing message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // localStatus takes precedence; falls back to store value.
  // Resolves to 'open' if ticket has no status yet (defensive).
  const effectiveStatus: TicketStatus = localStatus ?? ticket?.status ?? 'open';

  // If no ticket exists but we have a report, show create ticket option
  if (!ticket && report) {
    return (
      <View className="flex-1 bg-gray-50">
        <SafeAreaView edges={['top']} className="bg-white">
          <View className="flex-row items-center px-5 py-4 border-b border-gray-100">
            <Pressable onPress={() => router.back()} className="p-2 -ml-2">
              <ArrowLeft size={24} color="#111827" />
            </Pressable>
            <Text className="text-lg font-semibold text-gray-900 ml-2">
              Support Ticket
            </Text>
          </View>
        </SafeAreaView>

        <View className="flex-1 items-center justify-center p-8">
          <View className="w-20 h-20 bg-blue-100 rounded-full items-center justify-center mb-4">
            <MessageSquare size={40} color="#3B82F6" />
          </View>
          <Text className="text-xl font-semibold text-gray-900 text-center">
            No Ticket Yet
          </Text>
          <Text className="text-base text-gray-500 text-center mt-2 mb-6">
            This report doesn't have a support ticket. Create one to start
            a conversation.
          </Text>
          <Pressable
            onPress={handleCreateTicketForReport}
            disabled={isLoading}
            className="bg-forest py-3 px-6 rounded-xl"
          >
            {isLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold">Create Ticket</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  if (!ticket) {
    return (
      <View className="flex-1 bg-gray-50 items-center justify-center">
        <Text className="text-gray-500">Ticket not found</Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 bg-gray-200 py-2 px-4 rounded-lg"
        >
          <Text className="text-gray-700">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
      keyboardVerticalOffset={insets.top}
    >
      <View className="flex-1 bg-gray-50">
        <SafeAreaView edges={['top']} className="bg-white">
          <View className="flex-row items-center px-5 py-4 border-b border-gray-100">
            <Pressable onPress={() => router.back()} className="p-2 -ml-2">
              <ArrowLeft size={24} color="#111827" />
            </Pressable>
            <View className="flex-1 ml-2">
              <Text className="text-lg font-semibold text-gray-900" numberOfLines={1}>
                {ticket.subject}
              </Text>
              <View className="flex-row items-center mt-0.5">
                <View
                  className="px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: getStatusColor(effectiveStatus) + '20' }}
                >
                  <Text
                    className="text-xs font-medium"
                    style={{ color: getStatusColor(effectiveStatus) }}
                  >
                    {getStatusLabel(effectiveStatus)}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </SafeAreaView>

        {/* Ticket Info Header */}
        <View className="bg-white border-b border-gray-100 px-5 py-3">
          <View className="flex-row items-center mb-2">
            <User size={14} color="#6B7280" />
            <Text className="text-sm text-gray-600 ml-2">
              {ticket.farmerEmail}
            </Text>
          </View>
          <View className="flex-row items-center mb-2">
            <Clock size={14} color="#6B7280" />
            <Text className="text-sm text-gray-600 ml-2">
              Created: {formatDate(ticket.createdAt)}
            </Text>
          </View>
          {ticket.rating && (
            <View className="flex-row items-center">
              <Star size={14} color="#D4943A" fill="#D4943A" />
              <Text className="text-sm text-gray-600 ml-2">
                Rating: {ticket.rating}/5
              </Text>
            </View>
          )}
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollViewRef}
          className="flex-1 px-4 py-4"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 16 }}
          onContentSizeChange={() =>
            scrollViewRef.current?.scrollToEnd({ animated: false })
          }
        >
          {messages.map((message) => (
            <MessageBubble
              key={message.messageId}
              message={message}
              isAdmin={true}
              onEdit={handleEditMessage}
            />
          ))}
        </ScrollView>

        {/* Action Buttons + Reply Input */}
        <View style={{
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#F3F4F6',
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 12) + 4,
        }}>
          <View className="flex-row gap-2 mb-3">
            {effectiveStatus !== 'resolved' ? (
              <Pressable
                onPress={handleResolve}
                disabled={isLoading}
                className="flex-1 flex-row items-center justify-center bg-green-600 py-2.5 rounded-xl"
              >
                <CheckCircle size={16} color="white" />
                <Text className="text-white font-medium ml-2">
                  Mark Resolved
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={handleReopen}
                disabled={isLoading}
                className="flex-1 flex-row items-center justify-center bg-purple-600 py-2.5 rounded-xl"
              >
                <RotateCcw size={16} color="white" />
                <Text className="text-white font-medium ml-2">Reopen</Text>
              </Pressable>
            )}
          </View>

          {/* Reply Input */}
          <View className="flex-row items-end gap-2">
            <TextInput
              className="flex-1 bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-800 max-h-[100px]"
              placeholder="Type your reply..."
              placeholderTextColor="#9CA3AF"
              multiline
              value={replyText}
              onChangeText={setReplyText}
            />
            <Pressable
              onPress={handleSendReply}
              disabled={isLoading || !replyText.trim()}
              className={`w-12 h-12 rounded-xl items-center justify-center ${
                replyText.trim() ? 'bg-forest' : 'bg-gray-200'
              }`}
            >
              {isLoading ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Send
                  size={20}
                  color={replyText.trim() ? 'white' : '#9CA3AF'}
                />
              )}
            </Pressable>
          </View>
        </View>

        {/* Edit Message Modal */}
        <Modal
          visible={showEditModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowEditModal(false)}
        >
          <SafeAreaView edges={['top']} className="flex-1 bg-white">
            <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100">
              <Pressable
                onPress={() => {
                  setShowEditModal(false);
                  setEditingMessage(null);
                  setEditText('');
                }}
                className="p-2 -ml-2"
              >
                <X size={24} color="#111827" />
              </Pressable>
              <Text className="text-lg font-semibold text-gray-900">
                Edit Message
              </Text>
              <Pressable
                onPress={handleSaveEdit}
                disabled={isLoading || !editText.trim()}
                className="p-2 -mr-2"
              >
                {isLoading ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text
                    className={`font-semibold ${
                      editText.trim() ? 'text-forest' : 'text-gray-400'
                    }`}
                  >
                    Save
                  </Text>
                )}
              </Pressable>
            </View>

            <View className="flex-1 p-5">
              <TextInput
                className="flex-1 bg-gray-50 rounded-xl p-4 text-base text-gray-800"
                placeholder="Edit your message..."
                placeholderTextColor="#9CA3AF"
                multiline
                textAlignVertical="top"
                value={editText}
                onChangeText={setEditText}
                autoFocus
              />
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function TicketThread() {
  return (
    <AdminGuard>
      <TicketThreadContent />
    </AdminGuard>
  );
}
