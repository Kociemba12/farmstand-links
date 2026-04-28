import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  ArrowLeft,
  MessageSquare,
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Trash2,
  Inbox,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  SupportTicket,
  TicketStatus,
  fetchSupportTickets,
  deleteSupportTicket,
} from '@/lib/support-api';

// ─── Status helpers ───────────────────────────────────────────────────────────

function getStatusColor(status: TicketStatus): string {
  switch (status) {
    case 'open': return '#3B82F6';
    case 'waiting_on_farmer': return '#F59E0B';
    case 'waiting_on_admin': return '#3B82F6';
    case 'resolved': return '#16A34A';
    case 'reopened': return '#8B5CF6';
    default: return '#6B7280';
  }
}

function getStatusLabel(status: TicketStatus): string {
  switch (status) {
    case 'open': return 'Open';
    case 'waiting_on_farmer': return 'Your Reply Needed';
    case 'waiting_on_admin': return 'Awaiting Response';
    case 'resolved': return 'Resolved';
    case 'reopened': return 'Reopened';
    default: return status;
  }
}

function getStatusIcon(status: TicketStatus) {
  const color = getStatusColor(status);
  switch (status) {
    case 'open':
    case 'waiting_on_admin':
    case 'reopened':
      return <Clock size={20} color={color} />;
    case 'waiting_on_farmer':
      return <AlertCircle size={20} color={color} />;
    case 'resolved':
      return <CheckCircle size={20} color={color} />;
    default:
      return <MessageSquare size={20} color={color} />;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return `${days} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// ─── Ticket Card ──────────────────────────────────────────────────────────────

function TicketRow({
  ticket,
  onPress,
  onDelete,
}: {
  ticket: SupportTicket;
  onPress: () => void;
  onDelete: () => void;
}) {
  const [isPressed, setIsPressed] = useState(false);
  const statusColor = getStatusColor(ticket.status as TicketStatus);
  const needsAttention = ticket.status === 'waiting_on_farmer';

  return (
    // Outer View owns the spacing — completely isolated from press state
    <View style={{ marginBottom: 14 }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => setIsPressed(true)}
        onPressOut={() => setIsPressed(false)}
        style={{
          backgroundColor: isPressed ? '#F6F1EB' : '#FFFFFF',
          borderRadius: 20,
          padding: 16,
          shadowColor: '#1C1917',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.07,
          shadowRadius: 10,
          elevation: 3,
        }}
      >
        {/* Single row: icon | content | actions */}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>

          {/* Left: status icon circle */}
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: needsAttention ? '#FEF3C7' : statusColor + '14',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {getStatusIcon(ticket.status as TicketStatus)}
          </View>

          {/* Centre: title + meta */}
          <View style={{ flex: 1, marginLeft: 14, marginRight: 10 }}>
            {/* Title + status badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: '600',
                  color: '#1C1917',
                  letterSpacing: -0.2,
                }}
                numberOfLines={1}
              >
                {ticket.subject}
              </Text>
              <View
                style={{
                  backgroundColor: needsAttention ? '#FEF3C7' : statusColor + '16',
                  borderRadius: 20,
                  paddingHorizontal: 9,
                  paddingVertical: 4,
                  marginLeft: 8,
                  flexShrink: 0,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: needsAttention ? '#92400E' : statusColor,
                    letterSpacing: 0.1,
                  }}
                >
                  {getStatusLabel(ticket.status as TicketStatus)}
                </Text>
              </View>
            </View>

            {/* Meta line */}
            <Text
              style={{ fontSize: 12.5, color: '#A8906E', marginTop: 5 }}
              numberOfLines={1}
            >
              {ticket.category} · {formatDate(ticket.updated_at)}
            </Text>
          </View>

          {/* Right: delete + chevron */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0 }}>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onDelete();
              }}
              hitSlop={10}
              style={{ padding: 4 }}
            >
              <Trash2 size={15} color="#C4B5A5" />
            </Pressable>
            <ChevronRight size={17} color="#C4B5A5" strokeWidth={2.5} style={{ marginLeft: 8 }} />
          </View>

        </View>
      </Pressable>
    </View>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.7,
        color: '#B5A08C',
        marginBottom: 10,
        marginLeft: 4,
        textTransform: 'uppercase',
      }}
    >
      {label} ({count})
    </Text>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SupportScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSupportTickets();
      console.log(`[support] Loaded ${data.length} ticket(s):`, data.map(t => t.id));
      setTickets(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load tickets';
      console.error('[support] Fetch error:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTickets();
    }, [loadTickets])
  );

  const handleDelete = (ticket: SupportTicket) => {
    Alert.alert(
      'Delete Ticket',
      `Remove "${ticket.subject}" from your tickets?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log(`[support] Deleting ticket ${ticket.id}`);
              await deleteSupportTicket(ticket.id);
              console.log(`[support] Deleted ticket ${ticket.id} — re-fetching`);
              await loadTickets();
            } catch (err) {
              console.error('[support] Delete error:', err);
              Alert.alert('Error', 'Could not delete ticket. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleTicketPress = (ticket: SupportTicket) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/profile/support-thread?ticketId=${ticket.id}`);
  };

  const activeSupport = tickets.filter((t) => t.status !== 'resolved');
  const resolvedSupport = tickets.filter((t) => t.status === 'resolved');

  return (
    <View style={{ flex: 1, backgroundColor: '#FDF8F3' }}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FDF8F3' }}>
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: 14,
            borderBottomWidth: 1,
            borderBottomColor: '#EDE8E0',
          }}
        >
          <Pressable
            onPress={() => router.back()}
            style={{ marginBottom: 10, alignSelf: 'flex-start', padding: 2, marginLeft: -2 }}
          >
            <ArrowLeft size={22} color="#4A7C59" />
          </Pressable>
          <Text
            style={{
              fontSize: 26,
              fontWeight: '700',
              color: '#1C1917',
              letterSpacing: -0.5,
            }}
          >
            My Tickets
          </Text>
        </View>
      </SafeAreaView>

      {/* Content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 52 }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={{ paddingTop: 80, alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#4A7C59" />
          </View>
        ) : error ? (
          <View style={{ paddingTop: 80, alignItems: 'center', gap: 16 }}>
            <Text style={{ fontSize: 14, color: '#B45309', textAlign: 'center', paddingHorizontal: 24 }}>
              {error}
            </Text>
            <Pressable
              onPress={loadTickets}
              style={{ backgroundColor: '#EDF4EF', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#4A7C59' }}>Try Again</Text>
            </Pressable>
          </View>
        ) : tickets.length === 0 ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 72, paddingHorizontal: 32 }}>
            <View
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: '#EDF4EF',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20,
              }}
            >
              <Inbox size={34} color="#4A7C59" />
            </View>
            <Text
              style={{
                fontSize: 20,
                fontWeight: '700',
                color: '#1C1917',
                textAlign: 'center',
                letterSpacing: -0.3,
              }}
            >
              No support requests yet
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: '#A8906E',
                textAlign: 'center',
                marginTop: 8,
                lineHeight: 21,
              }}
            >
              If you need help, submit a request and we'll get back to you.
            </Text>
          </View>
        ) : (
          <>
            {activeSupport.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <SectionLabel label="Active" count={activeSupport.length} />
                {activeSupport.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    onPress={() => handleTicketPress(ticket)}
                    onDelete={() => handleDelete(ticket)}
                  />
                ))}
              </View>
            )}

            {resolvedSupport.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <SectionLabel label="Resolved" count={resolvedSupport.length} />
                {resolvedSupport.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    onPress={() => handleTicketPress(ticket)}
                    onDelete={() => handleDelete(ticket)}
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
