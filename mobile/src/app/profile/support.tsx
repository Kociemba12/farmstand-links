import React, { useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  MessageSquare,
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronRight,
} from 'lucide-react-native';
import { useAdminStore, SupportTicket, TicketStatus } from '@/lib/admin-store';
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

function getStatusIcon(status: TicketStatus) {
  switch (status) {
    case 'open':
    case 'waiting_on_admin':
    case 'reopened':
      return <Clock size={16} color={getStatusColor(status)} />;
    case 'waiting_on_farmer':
      return <AlertCircle size={16} color={getStatusColor(status)} />;
    case 'resolved':
      return <CheckCircle size={16} color={getStatusColor(status)} />;
    default:
      return <MessageSquare size={16} color={getStatusColor(status)} />;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
}

function TicketCard({
  ticket,
  onPress,
}: {
  ticket: SupportTicket;
  onPress: () => void;
}) {
  const needsAttention = ticket.status === 'waiting_on_farmer';

  return (
    <Pressable
      onPress={onPress}
      className={`bg-white rounded-2xl p-4 mb-3 border ${
        needsAttention ? 'border-amber-300' : 'border-gray-200'
      }`}
      style={{
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 1,
      }}
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-3">
          <Text className="text-base font-semibold text-charcoal" numberOfLines={1}>
            {ticket.subject}
          </Text>
          <Text className="text-sm text-wood mt-0.5">{ticket.category}</Text>
        </View>
        <View
          className="flex-row items-center px-2 py-1 rounded-full"
          style={{ backgroundColor: getStatusColor(ticket.status) + '15' }}
        >
          {getStatusIcon(ticket.status)}
          <Text
            className="text-xs font-medium ml-1"
            style={{ color: getStatusColor(ticket.status) }}
          >
            {getStatusLabel(ticket.status)}
          </Text>
        </View>
      </View>

      <Text className="text-sm text-bark" numberOfLines={2}>
        {ticket.lastMessagePreview}
      </Text>

      <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <Text className="text-xs text-wood">
          Last update: {formatDate(ticket.lastMessageAt)}
        </Text>
        <ChevronRight size={16} color="#C4B5A5" />
      </View>
    </Pressable>
  );
}

export default function SupportScreen() {
  const router = useRouter();
  const user = useUserStore((s) => s.user);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const getTicketsByFarmerUserId = useAdminStore(
    (s) => s.getTicketsByFarmerUserId
  );

  useEffect(() => {
    loadAdminData();
  }, []);

  const tickets = user?.id ? getTicketsByFarmerUserId(user.id) : [];

  const activeTickets = tickets.filter(
    (t) => t.status !== 'resolved'
  );
  const resolvedTickets = tickets.filter(
    (t) => t.status === 'resolved'
  );

  const handleTicketPress = (ticket: SupportTicket) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/profile/support-thread?ticketId=${ticket.ticketId}`);
  };

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Support</Text>
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {tickets.length === 0 ? (
          <View className="items-center justify-center py-12">
            <View className="w-20 h-20 bg-forest/10 rounded-full items-center justify-center mb-4">
              <MessageSquare size={40} color="#2D5A3D" />
            </View>
            <Text className="text-xl font-semibold text-charcoal text-center">
              No Support Requests
            </Text>
            <Text className="text-base text-wood text-center mt-2 px-8">
              When you submit feedback or report a problem, your conversations
              with our support team will appear here.
            </Text>
          </View>
        ) : (
          <>
            {/* Active Tickets */}
            {activeTickets.length > 0 && (
              <View className="mb-6">
                <Text className="text-sm font-medium text-bark mb-3 ml-1">
                  ACTIVE ({activeTickets.length})
                </Text>
                {activeTickets.map((ticket) => (
                  <TicketCard
                    key={ticket.ticketId}
                    ticket={ticket}
                    onPress={() => handleTicketPress(ticket)}
                  />
                ))}
              </View>
            )}

            {/* Resolved Tickets */}
            {resolvedTickets.length > 0 && (
              <View>
                <Text className="text-sm font-medium text-bark mb-3 ml-1">
                  RESOLVED ({resolvedTickets.length})
                </Text>
                {resolvedTickets.map((ticket) => (
                  <TicketCard
                    key={ticket.ticketId}
                    ticket={ticket}
                    onPress={() => handleTicketPress(ticket)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
