import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  ChevronRight,
  HelpCircle,
  MessageSquare,
  Mail,
  Clock,
  CheckCircle,
  AlertCircle,
  Ticket,
  Send,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAdminStore, SupportTicket, TicketStatus } from '@/lib/admin-store';
import { useUserStore } from '@/lib/user-store';

const SUPPORT_EMAIL = 'contact@farmstand.online';

const FAQ_ITEMS = [
  {
    question: 'How do I find farm stands near me?',
    answer: 'Use the Map tab to see farm stands in your area. You can also search by city, product, or farm name.',
  },
  {
    question: 'How do I save a farm stand?',
    answer: 'Tap the heart icon on any farm stand to save it to your favorites. Access saved farms from the Favorites tab.',
  },
  {
    question: 'How do I leave a review?',
    answer: 'Visit a farm stand page and scroll down to the Reviews section. Tap "Write a Review" to share your experience.',
  },
  {
    question: 'How do I list my farm stand?',
    answer: 'Go to Profile > "Are you a farmer?" and follow the onboarding process to create your farm stand listing.',
  },
  {
    question: 'Is the app free to use?',
    answer: 'Yes! Farmstand is free for customers. Farmers may have optional premium features available.',
  },
];

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
      return <Clock size={14} color={getStatusColor(status)} />;
    case 'waiting_on_farmer':
      return <AlertCircle size={14} color={getStatusColor(status)} />;
    case 'resolved':
      return <CheckCircle size={14} color={getStatusColor(status)} />;
    default:
      return <MessageSquare size={14} color={getStatusColor(status)} />;
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

// Mini Ticket Card for inline display
function MiniTicketCard({
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
      className={`bg-cream/60 rounded-xl p-3 mb-2 border ${
        needsAttention ? 'border-amber-300' : 'border-sand/60'
      }`}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-sm font-medium text-charcoal" numberOfLines={1}>
            {ticket.subject}
          </Text>
          <Text className="text-xs text-wood mt-0.5">
            {formatDate(ticket.lastMessageAt)}
          </Text>
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
    </Pressable>
  );
}

export default function HelpScreen() {
  const router = useRouter();
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  // Support tickets
  const user = useUserStore((s) => s.user);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);
  const getTicketsByFarmerUserId = useAdminStore((s) => s.getTicketsByFarmerUserId);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const tickets = user?.id ? getTicketsByFarmerUserId(user.id) : [];
  const activeTickets = tickets.filter((t) => t.status !== 'resolved');
  const hasTickets = tickets.length > 0;

  const handleContactSupport = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=Farmstand Support Request`);
  };

  const handleSubmitTicket = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/profile/rate-us');
  };

  const handleViewAllTickets = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/profile/support');
  };

  const handleTicketPress = (ticket: SupportTicket) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/profile/support-thread?ticketId=${ticket.ticketId}`);
  };

  const toggleFaq = async (index: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#FDF8F3' }}>
      {/* Light header matching Saved/Inbox style */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#FDF8F3' }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}>
          <Pressable onPress={() => router.back()} style={{ marginBottom: 12, alignSelf: 'flex-start', padding: 2, marginLeft: -2 }}>
            <ArrowLeft size={22} color="#4A7C59" />
          </Pressable>
          <Text style={{ fontSize: 26, fontWeight: '700', color: '#2C2420', letterSpacing: -0.3 }}>Feedback & Support</Text>
          <Text style={{ fontSize: 14, color: '#A8906E', marginTop: 2 }}>
            Get help or send us a message
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48 }}>

          {/* Two Big Cards */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 28 }}>
            {/* Get Help */}
            <Animated.View entering={FadeInDown.delay(0).duration(400)} style={{ flex: 1 }}>
              <Pressable
                onPress={handleSubmitTicket}
                style={{
                  backgroundColor: '#fff', borderRadius: 18, padding: 20, height: 140,
                  shadowColor: 'rgba(0,0,0,0.06)', shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 1, shadowRadius: 8, elevation: 2,
                }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#EDF4EF', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  <Send size={20} color="#4A7C59" />
                </View>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#2C2420' }}>Get Help</Text>
                <Text style={{ fontSize: 13, color: '#A8906E', marginTop: 3 }}>Submit a request</Text>
              </Pressable>
            </Animated.View>

            {/* My Tickets */}
            <Animated.View entering={FadeInDown.delay(80).duration(400)} style={{ flex: 1 }}>
              <Pressable
                onPress={handleViewAllTickets}
                style={{
                  backgroundColor: '#fff', borderRadius: 18, padding: 20, height: 140,
                  shadowColor: 'rgba(0,0,0,0.06)', shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 1, shadowRadius: 8, elevation: 2,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#EBF0FB', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <Ticket size={20} color="#3B82F6" />
                  </View>
                  {activeTickets.length > 0 && (
                    <View style={{ backgroundColor: '#4A7C59', borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                        {activeTickets.length > 9 ? '9+' : activeTickets.length}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#2C2420' }}>My Tickets</Text>
                <Text style={{ fontSize: 13, color: '#A8906E', marginTop: 3 }}>
                  {hasTickets ? `${tickets.length} conversation${tickets.length !== 1 ? 's' : ''}` : 'No tickets yet'}
                </Text>
              </Pressable>
            </Animated.View>
          </View>

          {/* Active Tickets Preview */}
          {activeTickets.length > 0 && (
            <Animated.View entering={FadeInDown.delay(150).duration(400)} style={{ marginBottom: 28 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: '#2C2420' }}>Active Tickets</Text>
                <Pressable onPress={handleViewAllTickets} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: '#4A7C59', fontWeight: '500', marginRight: 2 }}>View All</Text>
                  <ChevronRight size={15} color="#4A7C59" />
                </Pressable>
              </View>
              <View style={{ backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', shadowColor: 'rgba(0,0,0,0.05)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 }}>
                {activeTickets.slice(0, 3).map((ticket) => (
                  <MiniTicketCard
                    key={ticket.ticketId}
                    ticket={ticket}
                    onPress={() => handleTicketPress(ticket)}
                  />
                ))}
                {activeTickets.length > 3 && (
                  <Pressable onPress={handleViewAllTickets} style={{ paddingVertical: 14, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F5F0EA' }}>
                    <Text style={{ color: '#4A7C59', fontWeight: '600', fontSize: 14 }}>
                      +{activeTickets.length - 3} more
                    </Text>
                  </Pressable>
                )}
              </View>
            </Animated.View>
          )}

          {/* Quick Actions */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginBottom: 28 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#2C2420', marginBottom: 12 }}>Quick Actions</Text>
            <View style={{ backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', shadowColor: 'rgba(0,0,0,0.05)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 }}>
              <Pressable
                onPress={handleContactSupport}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDF4EF', alignItems: 'center', justifyContent: 'center' }}>
                  <Mail size={18} color="#4A7C59" />
                </View>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: '#2C2420', marginLeft: 14 }}>Email Support</Text>
                <ChevronRight size={17} color="#C4B5A5" />
              </Pressable>
            </View>
          </Animated.View>

          {/* FAQs */}
          <Animated.View entering={FadeInDown.delay(240).duration(400)} style={{ marginBottom: 28 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#2C2420', marginBottom: 12 }}>
              Frequently Asked Questions
            </Text>
            <View style={{ backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden', shadowColor: 'rgba(0,0,0,0.05)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 }}>
              {FAQ_ITEMS.map((faq, index) => (
                <View
                  key={index}
                  style={index !== FAQ_ITEMS.length - 1 ? { borderBottomWidth: 1, borderBottomColor: '#F5F0EA' } : {}}
                >
                  <Pressable
                    onPress={() => toggleFaq(index)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 }}
                  >
                    <HelpCircle size={17} color="#4A7C59" />
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: '#2C2420', marginLeft: 12, lineHeight: 20 }}>
                      {faq.question}
                    </Text>
                    <ChevronRight
                      size={17}
                      color="#C4B5A5"
                      style={{ transform: [{ rotate: expandedFaq === index ? '90deg' : '0deg' }] }}
                    />
                  </Pressable>
                  {expandedFaq === index && (
                    <View style={{ paddingHorizontal: 18, paddingBottom: 16, paddingTop: 0 }}>
                      <Text style={{ fontSize: 14, color: '#78716C', lineHeight: 21, marginLeft: 29 }}>{faq.answer}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </Animated.View>

          {/* Contact footer */}
          <Animated.View entering={FadeInDown.delay(280).duration(400)}>
            <View style={{ padding: 18, backgroundColor: '#F0EBE3', borderRadius: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Mail size={18} color="#A8906E" />
                <Text style={{ fontSize: 14, color: '#78716C', marginLeft: 8 }}>Need more help?</Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#2C2420', marginTop: 6 }}>
                {SUPPORT_EMAIL}
              </Text>
              <Text style={{ fontSize: 13, color: '#A8906E', marginTop: 3 }}>
                We typically respond within 24 hours
              </Text>
            </View>
          </Animated.View>

        </View>
      </ScrollView>
    </View>
  );
}
