import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowLeft,
  Send,
  Clock,
  CheckCircle,
  Star,
} from 'lucide-react-native';
import {
  useAdminStore,
  SupportTicket,
  SupportMessage,
  TicketStatus,
} from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';

function getStatusColor(status: TicketStatus): string {
  switch (status) {
    case 'open':
      return '#3B82F6';
    case 'waiting_on_farmer':
      return '#F59E0B';
    case 'waiting_on_admin':
      return '#3B82F6';
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
      return 'Your Reply Needed';
    case 'waiting_on_admin':
      return 'Awaiting Response';
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

function MessageBubble({ message }: { message: SupportMessage }) {
  const isFromAdmin = message.senderRole === 'admin';

  return (
    <View className={`mb-3 ${isFromAdmin ? 'items-start' : 'items-end'}`}>
      <View
        className={`max-w-[85%] rounded-2xl p-4 ${
          isFromAdmin
            ? 'bg-white border border-gray-200 rounded-bl-md'
            : 'bg-forest rounded-br-md'
        }`}
      >
        <View className="flex-row items-center mb-1">
          <Text
            className={`text-xs font-medium ${
              isFromAdmin ? 'text-gray-500' : 'text-white/70'
            }`}
          >
            {isFromAdmin ? 'Farmstand Support' : 'You'}
          </Text>
          {message.isEdited && (
            <Text
              className={`text-xs ml-2 ${
                isFromAdmin ? 'text-gray-400' : 'text-white/50'
              }`}
            >
              (edited)
            </Text>
          )}
        </View>
        <Text
          className={`text-base ${
            isFromAdmin ? 'text-gray-800' : 'text-white'
          }`}
        >
          {message.messageText}
        </Text>
        <Text
          className={`text-xs mt-2 ${
            isFromAdmin ? 'text-gray-400' : 'text-white/50'
          }`}
        >
          {formatDate(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

export default function SupportThreadScreen() {
  const router = useRouter();
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const scrollViewRef = useRef<ScrollView>(null);

  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const getTicketById = useAdminStore((s) => s.getTicketById);
  const getMessagesByTicketId = useAdminStore((s) => s.getMessagesByTicketId);
  const sendFarmerMessage = useAdminStore((s) => s.sendFarmerMessage);
  const user = useUserStore((s) => s.user);

  useEffect(() => {
    loadAdminData();
  }, []);

  const ticket = ticketId ? getTicketById(ticketId) : undefined;
  const messages = ticket
    ? getMessagesByTicketId(ticket.ticketId).filter((m) => m.isVisibleToFarmer)
    : [];

  const handleSendReply = async () => {
    if (!replyText.trim() || !ticket || !user || !user.id) return;

    setIsLoading(true);
    try {
      await sendFarmerMessage(
        ticket.ticketId,
        user.id,
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

  if (!ticket) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <Text className="text-wood">Ticket not found</Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 bg-sand py-2 px-4 rounded-lg"
        >
          <Text className="text-charcoal">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
      keyboardVerticalOffset={0}
    >
      <View className="flex-1 bg-cream">
        <SafeAreaView edges={['top']} className="bg-forest">
          <View className="flex-row items-center px-4 py-4">
            <Pressable onPress={() => router.back()} className="p-2 -ml-2">
              <ArrowLeft size={24} color="#FDF8F3" />
            </Pressable>
            <View className="flex-1 ml-2">
              <Text
                className="text-cream text-lg font-bold"
                numberOfLines={1}
              >
                {ticket.subject}
              </Text>
              <View className="flex-row items-center mt-0.5">
                <View
                  className="px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: getStatusColor(ticket.status) + '30',
                  }}
                >
                  <Text
                    className="text-xs font-medium text-cream"
                  >
                    {getStatusLabel(ticket.status)}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </SafeAreaView>

        {/* Ticket Info Header */}
        <View className="bg-white border-b border-sand px-4 py-3">
          <View className="flex-row items-center mb-1">
            <Clock size={14} color="#8B6F4E" />
            <Text className="text-sm text-wood ml-2">
              Created: {formatDate(ticket.createdAt)}
            </Text>
          </View>
          {ticket.rating && (
            <View className="flex-row items-center">
              <Star size={14} color="#D4943A" fill="#D4943A" />
              <Text className="text-sm text-wood ml-2">
                Your rating: {ticket.rating}/5
              </Text>
            </View>
          )}
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollViewRef}
          className="flex-1 px-4 py-4"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() =>
            scrollViewRef.current?.scrollToEnd({ animated: false })
          }
        >
          {messages.map((message) => (
            <MessageBubble key={message.messageId} message={message} />
          ))}

          {/* Resolved Notice */}
          {ticket.status === 'resolved' && (
            <View className="bg-green-50 rounded-xl p-4 mt-2 items-center">
              <CheckCircle size={24} color="#16A34A" />
              <Text className="text-green-800 font-medium mt-2">
                This ticket has been resolved
              </Text>
              <Text className="text-green-600 text-sm text-center mt-1">
                If you still need help, send a message to reopen this ticket.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Reply Input */}
        <View className="bg-white border-t border-sand px-4 py-3">
          <View className="flex-row items-end gap-2">
            <TextInput
              className="flex-1 bg-cream rounded-xl px-4 py-3 text-base text-charcoal max-h-[100px]"
              placeholder={
                ticket.status === 'resolved'
                  ? 'Send a message to reopen...'
                  : 'Type your message...'
              }
              placeholderTextColor="#8B6F4E"
              multiline
              value={replyText}
              onChangeText={setReplyText}
            />
            <Pressable
              onPress={handleSendReply}
              disabled={isLoading || !replyText.trim()}
              className={`w-12 h-12 rounded-xl items-center justify-center ${
                replyText.trim() ? 'bg-forest' : 'bg-sand'
              }`}
            >
              {isLoading ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Send
                  size={20}
                  color={replyText.trim() ? 'white' : '#8B6F4E'}
                />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
