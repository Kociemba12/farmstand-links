import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Image,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  AppState,
  type AppStateStatus,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { ChevronLeft, Store, ChevronRight, User } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBootstrapStore } from '@/lib/bootstrap-store';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useAnimatedKeyboard,
  interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useChatStore, ChatMessage, SenderRole, DirectMessage } from '@/lib/chat-store';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { getValidSession, isSupabaseConfigured } from '@/lib/supabase';
import { resolveConversationDisplay } from '@/lib/conversation-display';
import { trackEvent } from '@/lib/track';

// ── Constants ──────────────────────────────────────────────────────────────────
const CREAM = '#FDF8F3';
const FOREST = '#2D5A3D';
const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

// ── Types ──────────────────────────────────────────────────────────────────────
interface MsgItem {
  id: string;
  text: string;
  createdAt: string;
  isOwn: boolean;
}

type RenderedItem =
  | { kind: 'timestamp'; time: string; key: string }
  | { kind: 'group'; isOwn: boolean; messages: MsgItem[]; key: string };

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (diffMins < 1) return 'Just now';
  if (diffHours < 24) return timeStr;
  if (diffDays === 1) return `Yesterday ${timeStr}`;
  if (diffDays < 7) return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${timeStr}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

function buildRenderedItems(items: MsgItem[]): RenderedItem[] {
  const result: RenderedItem[] = [];
  let currentGroup: { isOwn: boolean; messages: MsgItem[] } | null = null;
  let lastTime: number | null = null;

  const flushGroup = () => {
    if (currentGroup) {
      result.push({
        kind: 'group',
        isOwn: currentGroup.isOwn,
        messages: currentGroup.messages,
        key: `group-${currentGroup.messages[0].id}`,
      });
      currentGroup = null;
    }
  };

  for (const item of items) {
    const itemTime = new Date(item.createdAt).getTime();

    if (lastTime !== null && itemTime - lastTime > 30 * 60 * 1000) {
      flushGroup();
      result.push({ kind: 'timestamp', time: item.createdAt, key: `ts-${item.id}` });
    }

    if (!currentGroup || currentGroup.isOwn !== item.isOwn) {
      flushGroup();
      currentGroup = { isOwn: item.isOwn, messages: [item] };
    } else {
      currentGroup.messages.push(item);
    }

    lastTime = itemTime;
  }

  flushGroup();
  return result;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TimestampSeparator({ time }: { time: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 24, paddingHorizontal: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: '#EDE8E0' }} />
      <Text style={{ fontSize: 11, color: '#C0B8AE', fontWeight: '500', letterSpacing: 0.4, marginHorizontal: 14 }}>
        {formatTimestamp(time)}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: '#EDE8E0' }} />
    </View>
  );
}

// Messenger-style bubble group — right for own, left for other
function MessageCard({
  isOwn,
  messages,
  contactName,
  contactPhoto,
  delay,
}: {
  isOwn: boolean;
  messages: MsgItem[];
  contactName: string;
  contactPhoto: string | null;
  /** Animation entrance delay in ms. Newest messages get delay=0 so they
   *  appear immediately when the user lands at the bottom of the thread. */
  delay: number;
}) {
  const count = messages.length;

  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(280)}
      style={{
        marginBottom: 12,
        alignItems: isOwn ? 'flex-end' : 'flex-start',
      }}
    >
      {/* Bubble(s) */}
      <View style={{ maxWidth: '78%', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
        {messages.map((msg, i) => (
          <View
            key={msg.id}
            style={{
              backgroundColor: isOwn ? '#2D5A3D' : '#FFFFFF',
              borderRadius: 18,
              borderTopRightRadius: isOwn && i === 0 ? 4 : 18,
              borderTopLeftRadius: !isOwn && i === 0 ? 4 : 18,
              borderBottomRightRadius: isOwn && i === count - 1 ? 4 : 18,
              borderBottomLeftRadius: !isOwn && i === count - 1 ? 4 : 18,
              paddingHorizontal: 14,
              paddingVertical: 10,
              marginBottom: i < count - 1 ? 2 : 0,
              borderWidth: isOwn ? 0 : 1,
              borderColor: '#EDE8E0',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.05,
              shadowRadius: 3,
              elevation: 1,
            }}
          >
            <Text style={{ fontSize: 15, color: isOwn ? '#FFFFFF' : '#1C1917', lineHeight: 22 }}>
              {msg.text}
            </Text>
          </View>
        ))}
      </View>

      {/* Timestamp */}
      <Text
        style={{
          fontSize: 11,
          color: '#C0B8AE',
          marginTop: 4,
          paddingHorizontal: 4,
        }}
      >
        {formatTimestamp(messages[count - 1].createdAt)}
      </Text>
    </Animated.View>
  );
}

function FarmstandContextCard({
  name,
  photo,
  onPress,
}: {
  name: string;
  photo: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ alignItems: 'center', paddingTop: 32, paddingBottom: 28, paddingHorizontal: 24 }}
    >
      {/* Glow rings like Alert hero */}
      <View
        style={{
          width: 92, height: 92, borderRadius: 46,
          backgroundColor: `${FOREST}10`,
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <View
          style={{
            width: 68, height: 68, borderRadius: 34,
            backgroundColor: '#E8E0D5', overflow: 'hidden',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.08,
            shadowRadius: 6,
            elevation: 2,
          }}
        >
          {photo ? (
            <Image source={{ uri: photo }} style={{ width: 68, height: 68 }} resizeMode="cover" />
          ) : (
            <Store size={28} color="#A8906E" />
          )}
        </View>
      </View>
      <Text style={{ fontSize: 19, fontWeight: '700', color: '#1C1917', marginBottom: 6, letterSpacing: -0.3 }}>
        {name}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontSize: 13, color: '#4A7C59', fontWeight: '600' }}>View farmstand</Text>
        <ChevronRight size={13} color="#4A7C59" strokeWidth={2.5} style={{ marginLeft: 2 }} />
      </View>
    </Pressable>
  );
}

function ConversationDivider() {
  return (
    <View style={{ marginHorizontal: 0, marginBottom: 28 }}>
      <View style={{ height: 1, backgroundColor: '#EDE8E0' }} />
      <Text
        style={{
          fontSize: 11, color: '#C0B8AE', fontWeight: '500',
          letterSpacing: 0.5, textAlign: 'center', marginTop: 12,
        }}
      >
        START OF CONVERSATION
      </Text>
    </View>
  );
}

function EmptyState({ displayName }: { displayName: string }) {
  const keyboard = useAnimatedKeyboard();
  const animatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(keyboard.height.value, [0, 150], [1, 0.2]);
    return { opacity };
  });

  return (
    <Animated.View
      entering={FadeIn.delay(200)}
      style={[animatedStyle, { alignItems: 'center', paddingHorizontal: 32, paddingBottom: 24 }]}
    >
      <Text style={{ fontSize: 13, color: '#B8B0A8', textAlign: 'center', lineHeight: 19 }}>
        Ask about products, hours, or availability
      </Text>
    </Animated.View>
  );
}

function DeletedFarmstandBanner() {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: '#FFFBF5',
        borderTopWidth: 1,
        borderTopColor: '#FDE68A',
        paddingHorizontal: 20,
        paddingTop: 14,
        paddingBottom: Math.max(insets.bottom, 14),
        alignItems: 'center',
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Store size={15} color="#B45309" />
        <Text style={{ fontSize: 14, fontWeight: '600', color: '#B45309' }}>
          This Farmstand has been deleted
        </Text>
      </View>
      <Text style={{ fontSize: 13, color: '#92400E', textAlign: 'center', lineHeight: 19 }}>
        You can view past messages, but new messages can no longer be sent.
      </Text>
    </View>
  );
}


function InputBar({
  messageText,
  setMessageText,
  onSend,
  isSending,
  isInputFocused,
  setIsInputFocused,
  onFocus,
}: {
  messageText: string;
  setMessageText: (text: string) => void;
  onSend: () => void;
  isSending: boolean;
  isInputFocused: boolean;
  setIsInputFocused: (focused: boolean) => void;
  onFocus: () => void;
}) {
  const insets = useSafeAreaInsets();
  const canSend = messageText.trim().length > 0;

  return (
    <View
      style={{
        backgroundColor: CREAM,
        borderTopWidth: 1,
        borderTopColor: '#EDE8E0',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: Math.max(insets.bottom, 10),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <TextInput
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Write a message..."
          placeholderTextColor="#C0B8AE"
          multiline
          maxLength={1000}
          textAlignVertical="top"
          style={{
            flex: 1,
            minHeight: 42,
            maxHeight: 110,
            paddingHorizontal: 18,
            paddingTop: 12,
            paddingBottom: 12,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: '#EDE8E0',
            backgroundColor: '#FFFFFF',
            fontSize: 15,
            color: '#1C1917',
          }}
          autoCorrect={true}
          spellCheck={true}
          autoCapitalize="sentences"
          autoComplete="off"
          blurOnSubmit={false}
          onFocus={() => {
            setIsInputFocused(true);
            onFocus();
          }}
          onBlur={() => setIsInputFocused(false)}
        />
        <TouchableOpacity
          onPress={() => { if (!canSend) return; onSend(); }}
          disabled={!canSend || isSending}
          activeOpacity={0.8}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            marginLeft: 10,
            marginBottom: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSend ? FOREST : '#E8E0D5',
            shadowColor: canSend ? FOREST : 'transparent',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: canSend ? 0.25 : 0,
            shadowRadius: 6,
            elevation: canSend ? 4 : 0,
          }}
        >
          <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const { threadId, farmstandId, farmstandName, otherUserId, otherUserName, otherUserAvatarUrl } = useLocalSearchParams<{
    threadId: string;
    farmstandId?: string;
    farmstandName?: string;
    otherUserId?: string;
    otherUserName?: string;
    otherUserAvatarUrl?: string;
  }>();
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const flatListRef = useRef<FlatList<RenderedItem>>(null);

  const user = useUserStore(s => s.user);
  const loadChatData = useChatStore(s => s.loadChatData);
  const getThreadById = useChatStore(s => s.getThreadById);
  const getMessagesForThread = useChatStore(s => s.getMessagesForThread);
  const loadMessagesForThread = useChatStore(s => s.loadMessagesForThread);
  const sendMessage = useChatStore(s => s.sendMessage);
  const markThreadAsRead = useChatStore(s => s.markThreadAsRead);
  const markConversationRead = useChatStore(s => s.markConversationRead);
  const getOrCreateThread = useChatStore(s => s.getOrCreateThread);
  const loadDirectMessages = useChatStore(s => s.loadDirectMessages);
  const sendDirectMessage = useChatStore(s => s.sendDirectMessage);
  const allFarmstands = useAdminStore(s => s.allFarmstands);
  const loadAdminData = useAdminStore(s => s.loadAdminData);
  const ownedFarmstands = useBootstrapStore(s => s.userFarmstands);

  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [actualThreadId, setActualThreadId] = useState<string | null>(
    threadId === 'new' || threadId === 'direct' ? null : (threadId ?? null)
  );
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [counterpartyName, setCounterpartyName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [otherUserProfile, setOtherUserProfile] = useState<{ full_name: string | null; avatar_url: string | null } | null>(
    // Seed from nav params so the header is correct on first render (no async fetch needed)
    (otherUserName || otherUserAvatarUrl) ? { full_name: otherUserName ?? null, avatar_url: otherUserAvatarUrl ?? null } : null
  );

  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const directMessagesRef = useRef<DirectMessage[]>([]);
  useEffect(() => { directMessagesRef.current = directMessages; }, [directMessages]);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const isDirectMode = !!otherUserId && !!farmstandId;

  const thread = actualThreadId ? getThreadById(actualThreadId) : null;
  const threadMessages = actualThreadId ? getMessagesForThread(actualThreadId) : [];

  const farmstand = allFarmstands.find(f => f.id === (thread?.farmstandId ?? farmstandId));

  const activeFarmstandId = thread?.farmstandId ?? farmstandId ?? null;
  const currentUserIsFarmer = !!(activeFarmstandId && ownedFarmstands.some(f => f.id === activeFarmstandId));

  const [fetchedFarmstand, setFetchedFarmstand] = useState<{
    name: string;
    photos?: string[] | null;
    photo_url?: string | null;
    deleted_at?: string | null;
  } | null>(null);

  useEffect(() => {
    const fId = thread?.farmstandId ?? farmstandId;
    if (!fId || !isSupabaseConfigured()) return;
    (async () => {
      const session = await getValidSession();
      if (!session?.access_token) return;
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
      const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
      try {
        // Note: bypass deleted_at filter intentionally — we need to know if it's deleted
        // so we can show history and disable the composer.
        const res = await fetch(
          `${supabaseUrl}/rest/v1/farmstands?id=eq.${fId}&select=id,name,photos,photo_url,deleted_at&limit=1`,
          {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );
        if (res.ok) {
          const rows = await res.json();
          if (rows?.[0]) setFetchedFarmstand(rows[0]);
        }
      } catch {}
    })();
  }, [thread?.farmstandId, farmstandId]);

  // True if the farmstand tied to this thread has been soft-deleted.
  // Source of truth: fetchedFarmstand.deleted_at (always fetched, includes deleted rows).
  // The admin store filters out deleted farmstands, so farmstand === undefined is also a hint
  // but deleted_at is more reliable.
  const farmstandDeleted = !!(fetchedFarmstand?.deleted_at);

  const resolvedFarmstandName = farmstandName && farmstandName !== 'Farmstand' ? farmstandName : null;
  const farmstandDisplayName =
    thread?.farmstandName ??
    resolvedFarmstandName ??
    fetchedFarmstand?.name ??
    farmstand?.name ??
    farmstandName ??
    'Chat';
  const farmstandDisplayPhoto =
    thread?.farmstandPhotoUrl ??
    fetchedFarmstand?.photos?.[0] ??
    fetchedFarmstand?.photo_url ??
    farmstand?.photos?.[0] ??
    null;

  useEffect(() => {
    if (!currentUserIsFarmer || isDirectMode) return;
    const otherMsg = threadMessages.find((m: ChatMessage) => m.senderUserId !== user?.id);
    if (otherMsg?.senderName) setCounterpartyName(otherMsg.senderName);
  }, [currentUserIsFarmer, isDirectMode, threadMessages, user?.id]);

  // chat_messages table does not exist; counterpartyName is resolved from thread participants instead

  // Determine the other participant's userId
  const resolvedOtherUserId = useMemo(() => {
    // Prefer explicit route param
    if (otherUserId) return otherUserId;
    // Fall back to thread participants
    if (thread?.participantUserIds && user?.id) {
      return thread.participantUserIds.find((id: string) => id !== user.id) ?? null;
    }
    // For direct messages, derive from messages
    if (isDirectMode && directMessages.length > 0) {
      const dm = directMessages[0];
      return dm.sender_id !== user?.id ? dm.sender_id : dm.receiver_id;
    }
    return null;
  }, [otherUserId, thread?.participantUserIds, user?.id, isDirectMode, directMessages]);

  // Fetch the other user's profile from Supabase profiles table
  useEffect(() => {
    if (!resolvedOtherUserId || !isSupabaseConfigured()) return;
    (async () => {
      const session = await getValidSession();
      if (!session?.access_token) return;
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
      const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
      try {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/profiles?uid=eq.${resolvedOtherUserId}&select=uid,full_name,avatar_url&limit=1`,
          {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${session.access_token}`,
            },
          }
        );
        if (res.ok) {
          const rows = await res.json() as { full_name: string | null; avatar_url: string | null }[];
          if (rows?.[0]) setOtherUserProfile(rows[0]);
        }
      } catch {}
    })();
  }, [resolvedOtherUserId]);

  const { displayName, displayPhoto, displayType } = resolveConversationDisplay({
    viewerIsFarmstandOwner: currentUserIsFarmer,
    farmstandName: farmstandDisplayName,
    farmstandPhoto: farmstandDisplayPhoto,
    customerName: otherUserProfile?.full_name ?? counterpartyName,
    customerPhoto: otherUserProfile?.avatar_url,
  });
  const canNavigateToFarmstand = !currentUserIsFarmer;

  useFocusEffect(
    useCallback(() => {
      trackEvent('conversation_screen_opened', {
        farmstand_id: farmstandId ?? null,
        farmstand_name: farmstandName ?? null,
        source: isDirectMode ? 'direct' : 'thread',
      });
      loadChatData(user?.id ?? undefined);
      loadAdminData();
    }, [loadChatData, loadAdminData, user?.id, farmstandId, farmstandName, isDirectMode])
  );

  const refreshDirectMessages = useCallback(async () => {
    if (!isDirectMode || !user?.id || !farmstandId || !otherUserId) {
      if (__DEV__) console.log('[ThreadScreen] DIRECT THREAD OPEN FETCH skipped — isDirectMode:', isDirectMode, 'userId:', user?.id, 'farmstandId:', farmstandId, 'otherUserId:', otherUserId);
      return;
    }
    if (__DEV__) console.log('[ThreadScreen] DIRECT THREAD OPEN FETCH — farmstandId:', farmstandId, 'currentUserId:', user.id, 'otherUserId:', otherUserId);
    setIsLoading(true);
    setDirectMessages([]); // discard all previous / cached state before fetching
    const msgs = await loadDirectMessages(farmstandId, user.id, otherUserId);
    if (__DEV__) {
      console.log('[ThreadScreen] DIRECT THREAD OPEN FETCH returned', msgs.length, 'messages');
      if (msgs.length > 0) {
        console.log('[ThreadScreen] first body:', msgs[0].body);
        console.log('[ThreadScreen] latest body:', msgs[msgs.length - 1].body);
      }
      console.log('[ThreadScreen] message state replaced: true');
    }
    setDirectMessages(msgs); // full replace — no merging with old state
    setIsLoading(false);
  }, [isDirectMode, user?.id, farmstandId, otherUserId, loadDirectMessages]);

  // Silent poll — no loading spinner, merges server results with any pending optimistic messages
  const pollDirectMessages = useCallback(async () => {
    if (!isDirectMode || !user?.id || !farmstandId || !otherUserId) return;
    try {
      const msgs = await loadDirectMessages(farmstandId, user.id, otherUserId);
      if (msgs) {
        // Compute hasNewIncoming using the ref BEFORE calling setState, because React
        // state updater functions run asynchronously during the render phase — checking
        // a variable set inside the updater immediately after setState always sees the
        // pre-update (false) value.
        const currentIds = new Set(directMessagesRef.current.map((m: DirectMessage) => m.id));
        const hasNewIncoming = msgs.some(
          (m: DirectMessage) => !currentIds.has(m.id) && m.sender_id !== user?.id
        );

        setDirectMessages(prev => {
          const prevIds = new Set(prev.map((m: DirectMessage) => m.id));
          const serverIds = new Set(msgs.map((m: DirectMessage) => m.id));
          // Retain any optimistic messages from the current user not yet confirmed by server
          const pendingOptimistic = prev.filter(
            (m: DirectMessage) => !serverIds.has(m.id) && m.sender_id === user?.id
          );
          const combined = [...msgs, ...pendingOptimistic];
          combined.sort(
            (a: DirectMessage, b: DirectMessage) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          return combined;
        });

        // Mark conversation as read if new incoming messages appeared while the thread is open
        if (hasNewIncoming) {
          markConversationRead(farmstandId, otherUserId);
        }
      }
    } catch {
      // silent — don't surface poll errors to the user
    }
  }, [isDirectMode, user?.id, farmstandId, otherUserId, loadDirectMessages, markConversationRead]);

  // Fire on initial mount and whenever key params change (covers async user.id load).
  // useFocusEffect alone is not enough because it only fires on focus events, not
  // when deps change while the screen is already focused.
  useEffect(() => {
    if (!isDirectMode || !user?.id || !farmstandId || !otherUserId) return;
    if (__DEV__) console.log('[ThreadScreen] mount/param direct refresh — farmstandId:', farmstandId, 'currentUserId:', user.id, 'otherUserId:', otherUserId);
    refreshDirectMessages();
  }, [isDirectMode, user?.id, farmstandId, otherUserId, refreshDirectMessages]);

  // Fire on every screen re-focus (returning from another screen).
  useFocusEffect(
    useCallback(() => {
      if (!isDirectMode || !user?.id || !farmstandId || !otherUserId) return;
      if (__DEV__) console.log('[ThreadScreen] focus direct refresh — farmstandId:', farmstandId, 'currentUserId:', user.id, 'otherUserId:', otherUserId);
      refreshDirectMessages();
    }, [isDirectMode, user?.id, farmstandId, otherUserId, refreshDirectMessages])
  );

  // Live-refresh: poll every 5 s + refresh on foreground + refresh on in-app push for this thread
  useFocusEffect(
    useCallback(() => {
      // 1. Poll for new messages while the screen is open
      const intervalId = isDirectMode
        ? setInterval(pollDirectMessages, 5000)
        : actualThreadId
          ? setInterval(() => loadMessagesForThread(actualThreadId), 5000)
          : null;

      // 2. Refresh when the app returns from background (e.g. user switched apps)
      const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next !== 'active') return;
        if (isDirectMode) {
          pollDirectMessages();
        } else if (actualThreadId) {
          loadMessagesForThread(actualThreadId);
        }
      });

      // 3. Immediately refresh when a push notification arrives for THIS conversation
      //    so the message appears without waiting for the next poll cycle
      const notifSub = Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data;
        if (!data) return;
        if (isDirectMode && farmstandId && otherUserId) {
          // Payload keys may be camelCase or snake_case depending on backend version
          const pushFarmstandId = (data.farmstandId ?? data.farmstand_id) as string | undefined;
          const pushOtherUserId = (data.otherUserId ?? data.other_user_id) as string | undefined;
          if (pushFarmstandId === farmstandId && pushOtherUserId === otherUserId) {
            pollDirectMessages();
          }
        } else if (!isDirectMode && actualThreadId) {
          const pushThreadId = (data.threadId ?? data.thread_id) as string | undefined;
          if (pushThreadId === actualThreadId) {
            loadMessagesForThread(actualThreadId);
          }
        }
      });

      return () => {
        if (intervalId) clearInterval(intervalId);
        appStateSub.remove();
        if (notifSub && typeof notifSub.remove === 'function') notifSub.remove();
      };
    }, [isDirectMode, pollDirectMessages, actualThreadId, loadMessagesForThread, farmstandId, otherUserId])
  );

  // Mark direct-mode conversation as read whenever this screen is focused
  useFocusEffect(
    useCallback(() => {
      if (isDirectMode && farmstandId && otherUserId) {
        markConversationRead(farmstandId, otherUserId);
      }
    }, [isDirectMode, farmstandId, otherUserId, markConversationRead])
  );

  useEffect(() => {
    if (actualThreadId && !isDirectMode) {
      loadMessagesForThread(actualThreadId);
    }
  }, [actualThreadId, loadMessagesForThread, isDirectMode]);

  useEffect(() => {
    const initThread = async () => {
      if (threadId === 'new' && farmstandId && farmstand && user && user.id && !isDirectMode) {
        const newThread = await getOrCreateThread(
          farmstandId,
          farmstand.name,
          farmstand.photos?.[0] ?? null,
          user.id,
          farmstand.ownerUserId
        );
        setActualThreadId(newThread.id);
      }
    };
    initThread();
  }, [threadId, farmstandId, farmstand, user, getOrCreateThread, isDirectMode]);

  useEffect(() => {
    if (actualThreadId && user?.id && !isDirectMode) {
      markThreadAsRead(actualThreadId, user.id);
    }
  }, [actualThreadId, user?.id, markThreadAsRead, threadMessages.length, isDirectMode]);

  // Single source of truth for the rendered message list.
  // In direct mode: exclusively directMessages (never thread store cache).
  // In thread mode: legacy ChatMessage rows from the store.
  const displayedMessages = useMemo<MsgItem[]>(() => {
    if (isDirectMode) {
      return directMessages.map(msg => ({
        id: msg.id,
        text: msg.body,
        createdAt: msg.created_at,
        isOwn: msg.sender_id === user?.id,
      }));
    }
    return threadMessages.map((msg: ChatMessage) => ({
      id: msg.id,
      text: msg.text,
      createdAt: msg.createdAt,
      isOwn: msg.senderUserId === user?.id,
    }));
  }, [isDirectMode, directMessages, threadMessages, user?.id]);

  const renderedItems = useMemo(() => buildRenderedItems(displayedMessages), [displayedMessages]);
  const isEmpty = displayedMessages.length === 0;
  const messageCount = displayedMessages.length;
  // Total group count used to compute reverse-stagger delays below
  const groupCount = useMemo(
    () => renderedItems.filter(r => r.kind === 'group').length,
    [renderedItems]
  );

  const lastMessageRef = useRef<View>(null);

  const scrollToBottom = useCallback((animated = true) => {
    scrollViewRef.current?.scrollToEnd({ animated });
  }, []);

  // Render a single item inside the inverted FlatList (direct mode only).
  // All items use delay=0 — the inverted list already shows newest content first.
  const renderDirectItem = useCallback(({ item }: { item: RenderedItem }) => {
    if (item.kind === 'timestamp') {
      return <TimestampSeparator time={item.time} />;
    }
    return (
      <MessageCard
        isOwn={item.isOwn}
        messages={item.messages}
        contactName={displayName}
        contactPhoto={displayPhoto}
        delay={0}
      />
    );
  }, [displayName, displayPhoto]);

  // Non-direct mode: scroll to bottom when thread messages load.
  useEffect(() => {
    if (isDirectMode || displayedMessages.length === 0) return;
    const frameId = requestAnimationFrame(() => scrollToBottom(false));
    const timerId = setTimeout(() => scrollToBottom(false), 250);
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
    };
  }, [isDirectMode, displayedMessages, scrollToBottom]);

  const handleSend = async () => {
    if (!messageText.trim() || !user?.id || farmstandDeleted) return;

    setIsSending(true);
    setSendStatus(null);
    trackEvent('message_send_tapped', {
      farmstand_id: activeFarmstandId ?? null,
      farmstand_name: farmstandName ?? farmstand?.name ?? null,
      source: isDirectMode ? 'direct' : 'thread',
    });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (isDirectMode && farmstandId && otherUserId) {
      if (__DEV__) {
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '(not set)';
        const payload = {
          sender_id: user.id,
          receiver_id: otherUserId,
          farmstand_id: farmstandId,
          body: messageText.trim(),
        };
        const debugLines = [
          `AUTH USER ID: ${user.id}`,
          `RECEIVER ID: ${otherUserId}`,
          `FARMSTAND ID: ${farmstandId}`,
          `BODY: ${messageText.trim()}`,
          `SUPABASE URL: ${supabaseUrl}`,
          `TABLE: public.messages`,
          `PAYLOAD: ${JSON.stringify(payload)}`,
        ];
        console.log('[DEBUG handleSend]', debugLines.join(' | '));
        setDebugLog(debugLines);
      }

      const msgText = messageText.trim();
      const sent = await sendDirectMessage(farmstandId, user.id, otherUserId, msgText);
      if (sent) {
        trackEvent('message_sent', { farmstand_id: farmstandId, farmstand_name: farmstandName ?? null, source: 'direct' });
        setDirectMessages(prev => [...prev, sent]);
        // Mark any prior incoming messages as read now that the user has replied
        markConversationRead(farmstandId, otherUserId);
        // Silently refresh thread from server to pick up any concurrent incoming messages
        pollDirectMessages();
        if (__DEV__) {
          setSendStatus({ ok: true, msg: `message insert success — id: ${sent.id}` });
          console.log('[DEBUG handleSend] INSERT SUCCESS row:', JSON.stringify(sent));
        }
        // Fire push notification to recipient (non-blocking, mirrors legacy sendMessage path)
        ;(async () => {
          try {
            const session = await getValidSession();
            if (!session?.access_token) return;

            // Attempt to fetch the stable conversation_id from the conversations table
            // so the recipient's push tap can navigate directly to this thread.
            let conversationId: string | undefined;
            try {
              const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
              const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
              const orFilter = encodeURIComponent(
                `(and(customer_id.eq.${user.id},owner_id.eq.${otherUserId}),and(customer_id.eq.${otherUserId},owner_id.eq.${user.id}))`
              );
              const convRes = await fetch(
                `${supabaseUrl}/rest/v1/conversations?farmstand_id=eq.${farmstandId}&or=${orFilter}&select=id&limit=1`,
                { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${session.access_token}` } }
              );
              if (convRes.ok) {
                const rows = await convRes.json() as Array<{ id: string }>;
                if (rows?.[0]?.id) conversationId = rows[0].id;
              }
            } catch {
              // non-fatal — push will still route via farmstand_id + other_user_id fallback
            }

            await fetch(`${BACKEND_URL}/api/send-chat-push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                recipient_user_ids: [otherUserId],
                sender_user_id: user.id,
                sender_name: user.name,
                farmstand_name: farmstandDisplayName,
                message_text: msgText,
                thread_id: farmstandId,
                // Direct-message routing: lets the recipient's push tap open this exact conversation
                farmstand_id: farmstandId,
                other_user_id: user.id, // from recipient's view, the other user is the sender
                ...(conversationId ? { conversation_id: conversationId } : {}),
              }),
            });
          } catch (err) {
            console.log('[ChatScreen] Direct message push error (non-fatal):', err);
          }
        })();
      } else {
        trackEvent('message_send_failed', { farmstand_id: farmstandId, farmstand_name: farmstandName ?? null, source: 'direct' });
        if (__DEV__) {
          setSendStatus({ ok: false, msg: 'message insert FAILED — see console for Supabase error' });
          console.log('[DEBUG handleSend] INSERT FAILED — sendDirectMessage returned null');
        }
      }
    } else if (actualThreadId && thread) {
      let senderRole: SenderRole = 'guest';
      if (isAdminEmail(user.email)) {
        senderRole = 'admin';
      } else if (user.isFarmer || farmstand?.ownerUserId === user.id) {
        senderRole = 'farmer';
      }

      const recipientId = thread.participantUserIds?.find((id: string) => id !== user.id) ?? null;
      if (__DEV__) {
        const legacyDebugLines = [
          `MODE: legacy thread`,
          `AUTH USER ID: ${user.id}`,
          `RECEIVER ID: ${recipientId ?? '(none — will skip public.messages)'}`,
          `FARMSTAND ID: ${thread.farmstandId}`,
          `BODY: ${messageText.trim()}`,
          `TABLE (primary): chat_messages`,
          `TABLE (also): public.messages`,
        ];
        console.log('[DEBUG handleSend legacy]', legacyDebugLines.join(' | '));
        setDebugLog(legacyDebugLines);
      }

      const result = await sendMessage(
        actualThreadId,
        thread.farmstandId,
        user.id,
        senderRole,
        user.name,
        messageText.trim()
      );
      if (result) {
        trackEvent('message_sent', { farmstand_id: thread.farmstandId ?? null, farmstand_name: farmstand?.name ?? farmstandName ?? null, source: 'thread' });
        if (__DEV__) {
          const pmLine = result.publicMsgOk === true
            ? `public.messages INSERT SUCCESS`
            : result.publicMsgOk === false
            ? `public.messages INSERT FAILED: ${result.publicMsgError ?? result.publicMsgBody ?? 'unknown error'}`
            : 'public.messages: skipped (no recipientId)';
          setDebugLog(prev => [
            ...prev,
            'STANDARD_INSERT_PATH=TRUE',
            'USING STANDARD SUPABASE INSERT FOR public.messages',
            pmLine,
          ]);
          const overallOk = result.publicMsgOk === true;
          setSendStatus({
            ok: overallOk,
            msg: overallOk
              ? `public.messages INSERT SUCCESS`
              : `FAILED — public.messages:${result.publicMsgOk === true ? 'OK' : 'FAIL'}`,
          });
        }
      } else {
        trackEvent('message_send_failed', { farmstand_id: thread.farmstandId ?? null, farmstand_name: farmstand?.name ?? farmstandName ?? null, source: 'thread' });
        if (__DEV__) {
          setSendStatus({ ok: false, msg: 'sendMessage returned null — check console' });
        }
      }
    }

    setMessageText('');
    setIsSending(false);
    if (isDirectMode) {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    } else {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  };

  const openFarmstand = () => {
    const fId = thread?.farmstandId ?? farmstandId;
    if (fId) router.push(`/farm/${fId}`);
  };

  console.log('[ThreadScreen RENDER CHECK]', {
    isDirectMode,
    directMessagesLength: directMessages.length,
    displayedMessagesLength: displayedMessages.length,
    latestDirect: directMessages[directMessages.length - 1],
    latestDisplayed: displayedMessages[displayedMessages.length - 1],
  });

  // Track card indices for staggered animation
  let cardIndex = 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: CREAM }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header — centered title, matches Alert detail */}
      <SafeAreaView
        edges={['top']}
        style={{ backgroundColor: CREAM, borderBottomWidth: 1, borderBottomColor: '#EDE8E0' }}
      >
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 8, paddingVertical: 4,
        }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={{ padding: 10, borderRadius: 20 }}
          >
            <ChevronLeft size={24} color="#44403C" />
          </Pressable>

          {/* Centered name + avatar */}
          <Pressable
            onPress={canNavigateToFarmstand ? openFarmstand : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <View
              style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: '#EDE8E0', overflow: 'hidden',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              {displayPhoto ? (
                <Image source={{ uri: displayPhoto }} style={{ width: 28, height: 28 }} resizeMode="cover" />
              ) : displayType === 'customer' ? (
                <User size={14} color="#A8906E" />
              ) : (
                <Store size={14} color="#A8906E" />
              )}
            </View>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#44403C' }} numberOfLines={1}>
              {displayName}
            </Text>
          </Pressable>

          {/* Right side spacer to keep title centered */}
          <View style={{ width: 44 }} />
        </View>
      </SafeAreaView>

      {/* Message list */}
      {isDirectMode ? (
        isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color="#4A7C59" />
          </View>
        ) : (
          <FlatList<RenderedItem>
            ref={flatListRef}
            data={[...renderedItems].reverse()}
            keyExtractor={item => item.key}
            inverted={true}
            renderItem={renderDirectItem}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            ListFooterComponent={
              <>
                {canNavigateToFarmstand && (
                  <FarmstandContextCard
                    name={displayName}
                    photo={displayPhoto}
                    onPress={openFarmstand}
                  />
                )}
                <ConversationDivider />
                {isEmpty && <EmptyState displayName={displayName} />}
              </>
            }
          />
        )
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 20,
            paddingBottom: 16,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 20 }}
        >
          {isLoading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color="#4A7C59" />
            </View>
          ) : (
            <>
              {canNavigateToFarmstand && (
                <FarmstandContextCard
                  name={displayName}
                  photo={displayPhoto}
                  onPress={openFarmstand}
                />
              )}
              <ConversationDivider />
              {isEmpty ? (
                <EmptyState displayName={displayName} />
              ) : (
                <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                  {renderedItems.map((item, index) => {
                    const isLast = index === renderedItems.length - 1;
                    if (item.kind === 'timestamp') {
                      return (
                        <View key={item.key} ref={isLast ? lastMessageRef : null}>
                          <TimestampSeparator time={item.time} />
                        </View>
                      );
                    }
                    const idx = cardIndex++;
                    const delay = Math.min(Math.max(0, groupCount - 1 - idx), 5) * 40;
                    return (
                      <View key={item.key} ref={isLast ? lastMessageRef : null}>
                        <MessageCard
                          isOwn={item.isOwn}
                          messages={item.messages}
                          contactName={displayName}
                          contactPhoto={displayPhoto}
                          delay={delay}
                        />
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Input bar / deleted banner */}
      <View>
        {farmstandDeleted ? (
          <DeletedFarmstandBanner />
        ) : (
          <>
            {/* DEBUG PANEL — dev only */}
            {__DEV__ && (debugLog.length > 0 || sendStatus) && (
              <View
                style={{
                  backgroundColor: '#111',
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderTopWidth: 1,
                  borderTopColor: '#333',
                }}
              >
                {sendStatus && (
                  <Text style={{ color: sendStatus.ok ? '#4ade80' : '#f87171', fontWeight: 'bold', fontSize: 13, marginBottom: 4 }}>
                    {sendStatus.ok ? '✓ ' : '✗ '}{sendStatus.msg}
                  </Text>
                )}
                {debugLog.map((line, i) => (
                  <Text key={i} style={{ color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace', lineHeight: 16 }}>{line}</Text>
                ))}
              </View>
            )}
            <InputBar
              messageText={messageText}
              setMessageText={setMessageText}
              onSend={handleSend}
              isSending={isSending}
              isInputFocused={isInputFocused}
              setIsInputFocused={setIsInputFocused}
              onFocus={isDirectMode
                ? () => flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
                : scrollToBottom
              }
            />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
