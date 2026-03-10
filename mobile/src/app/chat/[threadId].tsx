import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Image,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Send, Store } from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useAnimatedKeyboard,
  interpolate,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useChatStore, ChatMessage, SenderRole } from '@/lib/chat-store';
import { useUserStore, isAdminEmail } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

// Format timestamp for message display
function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Message bubble component
function MessageBubble({
  message,
  isOwnMessage,
  showSenderName,
}: {
  message: ChatMessage;
  isOwnMessage: boolean;
  showSenderName: boolean;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      className={`mb-2 max-w-[80%] ${isOwnMessage ? 'self-end' : 'self-start'}`}
    >
      {showSenderName && !isOwnMessage && (
        <Text className="text-xs text-stone-500 mb-1 ml-3">{message.senderName}</Text>
      )}
      <View
        className={`px-4 py-3 rounded-2xl ${
          isOwnMessage
            ? 'bg-forest rounded-br-md'
            : 'bg-white rounded-bl-md border border-stone-100'
        }`}
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
          shadowRadius: 2,
          elevation: 1,
        }}
      >
        <Text
          className={`text-base leading-5 ${isOwnMessage ? 'text-white' : 'text-stone-800'}`}
        >
          {message.text}
        </Text>
      </View>
      <Text
        className={`text-xs mt-1 ${
          isOwnMessage ? 'text-stone-400 text-right mr-1' : 'text-stone-400 ml-3'
        }`}
      >
        {formatMessageTime(message.createdAt)}
      </Text>
    </Animated.View>
  );
}

// Empty state component with keyboard-aware animation
function EmptyState({ displayName }: { displayName: string }) {
  const keyboard = useAnimatedKeyboard();

  const animatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      keyboard.height.value,
      [0, 300],
      [0, -100]
    );
    const opacity = interpolate(
      keyboard.height.value,
      [0, 150],
      [1, 0.2]
    );
    return {
      transform: [{ translateY }],
      opacity,
    };
  });

  return (
    <Animated.View
      entering={FadeIn.delay(200)}
      style={animatedStyle}
      className="items-center justify-center py-20"
    >
      <View className="w-16 h-16 rounded-full bg-stone-100 items-center justify-center mb-4">
        <Store size={32} color="#78716C" />
      </View>
      <Text className="text-stone-600 text-center text-base font-medium">
        Start a conversation
      </Text>
      <Text className="text-stone-400 text-center text-sm mt-1 px-8">
        Ask about products, hours, or availability at {displayName}
      </Text>
    </Animated.View>
  );
}

// Input bar component
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

  return (
    <View
      className="bg-white border-t border-stone-100"
      style={{
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: Math.max(insets.bottom, 12),
      }}
    >
      <View className="flex-row items-end">
        <View
          className={`flex-1 bg-stone-50 rounded-2xl border px-4 py-3 mr-3 ${
            isInputFocused ? 'border-forest/40' : 'border-stone-200'
          }`}
        >
          <TextInput
            value={messageText}
            onChangeText={setMessageText}
            placeholder="Type a message..."
            placeholderTextColor="#A8A29E"
            multiline
            maxLength={1000}
            className="text-stone-800 text-base"
            style={{ minHeight: 24, maxHeight: 96 }}
            onFocus={() => {
              setIsInputFocused(true);
              onFocus();
            }}
            onBlur={() => setIsInputFocused(false)}
          />
        </View>
        <Pressable
          onPress={onSend}
          disabled={!messageText.trim() || isSending}
          className={`w-12 h-12 rounded-full items-center justify-center ${
            messageText.trim() && !isSending ? 'bg-forest' : 'bg-stone-200'
          }`}
          style={{
            shadowColor: messageText.trim() ? '#2D5A3D' : 'transparent',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 4,
            elevation: messageText.trim() ? 3 : 0,
          }}
        >
          <Send
            size={20}
            color={messageText.trim() && !isSending ? '#FDF8F3' : '#A8A29E'}
          />
        </Pressable>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { threadId, farmstandId, farmstandName } = useLocalSearchParams<{
    threadId: string;
    farmstandId?: string;
    farmstandName?: string;
  }>();
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);

  // Stores
  const user = useUserStore(s => s.user);
  const loadChatData = useChatStore(s => s.loadChatData);
  const getThreadById = useChatStore(s => s.getThreadById);
  const getMessagesForThread = useChatStore(s => s.getMessagesForThread);
  const loadMessagesForThread = useChatStore(s => s.loadMessagesForThread);
  const sendMessage = useChatStore(s => s.sendMessage);
  const markThreadAsRead = useChatStore(s => s.markThreadAsRead);
  const getOrCreateThread = useChatStore(s => s.getOrCreateThread);
  const allFarmstands = useAdminStore(s => s.allFarmstands);
  const loadAdminData = useAdminStore(s => s.loadAdminData);

  // State
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [actualThreadId, setActualThreadId] = useState<string | null>(threadId === 'new' ? null : threadId ?? null);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Get thread and messages
  const thread = actualThreadId ? getThreadById(actualThreadId) : null;
  const messages = actualThreadId ? getMessagesForThread(actualThreadId) : [];

  // Get farmstand info for header
  const farmstand = allFarmstands.find(f =>
    f.id === (thread?.farmstandId ?? farmstandId)
  );
  const displayName = thread?.farmstandName ?? farmstandName ?? farmstand?.name ?? 'Chat';
  const displayPhoto = thread?.farmstandPhotoUrl ?? farmstand?.photos?.[0] ?? null;

  // Load data on mount
  useFocusEffect(
    useCallback(() => {
      loadChatData(user?.id ?? undefined);
      loadAdminData();
    }, [loadChatData, loadAdminData, user?.id])
  );

  // Load messages fresh from Supabase when the thread is known
  useEffect(() => {
    if (actualThreadId) {
      loadMessagesForThread(actualThreadId);
    }
  }, [actualThreadId, loadMessagesForThread]);

  // Create thread if new chat
  useEffect(() => {
    const initThread = async () => {
      if (threadId === 'new' && farmstandId && farmstand && user && user.id) {
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
  }, [threadId, farmstandId, farmstand, user, getOrCreateThread]);

  // Mark thread as read when viewing
  useEffect(() => {
    if (actualThreadId && user?.id) {
      markThreadAsRead(actualThreadId, user.id);
    }
  }, [actualThreadId, user?.id, markThreadAsRead, messages.length]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  const handleSend = async () => {
    if (!messageText.trim() || !actualThreadId || !user || !user.id || !thread) return;

    setIsSending(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Determine sender role
    let senderRole: SenderRole = 'guest';
    if (isAdminEmail(user.email)) {
      senderRole = 'admin';
    } else if (user.isFarmer || farmstand?.ownerUserId === user.id) {
      senderRole = 'farmer';
    }

    await sendMessage(
      actualThreadId,
      thread.farmstandId,
      user.id!,
      senderRole,
      user.name,
      messageText.trim()
    );

    setMessageText('');
    setIsSending(false);

    // Scroll to bottom after sending
    scrollToBottom();
  };

  const isOwnMessage = (msg: ChatMessage) => msg.senderUserId === user?.id;

  return (
    <View className="flex-1 bg-cream">
      {/* Header */}
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            className="p-2 -ml-2 active:opacity-70"
          >
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>

          {/* Farmstand info */}
          <Pressable
            onPress={() => {
              if (thread?.farmstandId || farmstandId) {
                router.push(`/farm/${thread?.farmstandId ?? farmstandId}`);
              }
            }}
            className="flex-1 flex-row items-center ml-2 active:opacity-80"
          >
            <View className="w-10 h-10 rounded-full bg-white/20 items-center justify-center overflow-hidden">
              {displayPhoto ? (
                <Image
                  source={{ uri: displayPhoto }}
                  className="w-10 h-10"
                  resizeMode="cover"
                />
              ) : (
                <Store size={20} color="#FDF8F3" />
              )}
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-cream text-lg font-semibold" numberOfLines={1}>
                {displayName}
              </Text>
              <Text className="text-cream/70 text-xs">Tap to view farmstand</Text>
            </View>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Messages ScrollView - Takes remaining space */}
      <ScrollView
        ref={scrollViewRef}
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 16,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {messages.length === 0 ? (
          <View className="flex-1 justify-center">
            <EmptyState displayName={displayName} />
          </View>
        ) : (
          <View className="flex-1 justify-end">
            {messages.map((msg, index) => {
              const showSenderName =
                index === 0 || messages[index - 1].senderUserId !== msg.senderUserId;

              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwnMessage={isOwnMessage(msg)}
                  showSenderName={showSenderName}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Input Bar - Sticks above keyboard */}
      <KeyboardStickyView
        offset={{
          closed: 0,
          opened: Platform.OS === 'ios' ? 0 : 0,
        }}
      >
        <InputBar
          messageText={messageText}
          setMessageText={setMessageText}
          onSend={handleSend}
          isSending={isSending}
          isInputFocused={isInputFocused}
          setIsInputFocused={setIsInputFocused}
          onFocus={scrollToBottom}
        />
      </KeyboardStickyView>
    </View>
  );
}
