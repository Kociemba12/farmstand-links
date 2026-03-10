import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { getValidSession } from './supabase';

const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

// Types for chat system
export type SenderRole = 'guest' | 'farmer' | 'admin';

export interface ChatThread {
  id: string;
  farmstandId: string;
  farmstandName: string; // denormalized for fast list display
  farmstandPhotoUrl: string | null; // denormalized
  participantUserIds: string[]; // includes sender userId + farmstand owner userId
  createdAt: string;
  updatedAt: string;
  lastMessageText: string;
  lastMessageAt: string;
  lastMessageSenderId: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  farmstandId: string;
  senderUserId: string;
  recipientId: string | null;
  senderRole: SenderRole;
  senderName: string;
  text: string;
  read: boolean;
  createdAt: string;
}

export interface ChatThreadState {
  threadId: string;
  userId: string;
  lastReadAt: string;
  unreadCount: number;
  hiddenAt?: string; // Soft delete - thread hidden for this user
}

interface ChatStoreState {
  threads: ChatThread[];
  messages: ChatMessage[];
  threadStates: ChatThreadState[]; // Track unread per user
  isLoading: boolean;

  // Actions
  loadChatData: (userId?: string) => Promise<void>;

  // Thread actions
  getOrCreateThread: (
    farmstandId: string,
    farmstandName: string,
    farmstandPhotoUrl: string | null,
    currentUserId: string,
    farmstandOwnerUserId: string
  ) => Promise<ChatThread>;
  getThreadById: (threadId: string) => ChatThread | undefined;
  getThreadsForUser: (userId: string) => ChatThread[];
  getThreadByFarmstandAndUser: (farmstandId: string, userId: string) => ChatThread | undefined;

  // Message actions
  sendMessage: (
    threadId: string,
    farmstandId: string,
    senderUserId: string,
    senderRole: SenderRole,
    senderName: string,
    text: string
  ) => Promise<ChatMessage>;
  getMessagesForThread: (threadId: string) => ChatMessage[];
  loadMessagesForThread: (threadId: string) => Promise<void>;

  // Unread tracking
  markThreadAsRead: (threadId: string, userId: string) => Promise<void>;
  getUnreadCountForUser: (userId: string) => number;
  getUnreadCountForThread: (threadId: string, userId: string) => number;
  getTotalUnreadCount: (userId: string) => number;

  // Soft delete (hide thread for user)
  hideThreadForUser: (threadId: string, userId: string) => Promise<void>;
  unhideThreadForUser: (threadId: string, userId: string) => Promise<void>;
  isThreadHiddenForUser: (threadId: string, userId: string) => boolean;

  // Helper
  getThreadStateForUser: (threadId: string, userId: string) => ChatThreadState | undefined;
}

// ─── Supabase row types ───────────────────────────────────────────────────────
interface SupabaseThread {
  id: string;
  farmstand_id: string;
  farmstand_name: string;
  farmstand_photo_url: string | null;
  participant_user_ids: string[];
  last_message_text: string;
  last_message_at: string;
  last_message_sender_id: string;
  created_at: string;
  updated_at: string;
}

interface SupabaseMessage {
  id: string;
  thread_id: string;
  farmstand_id: string;
  sender_user_id: string;
  recipient_id: string | null;
  sender_role: string;
  sender_name: string;
  text: string;
  read: boolean;
  created_at: string;
}

interface SupabaseThreadState {
  thread_id: string;
  user_id: string;
  last_read_at: string;
  unread_count: number;
  hidden_at: string | null;
}

// ─── Conversion helpers ───────────────────────────────────────────────────────
function toThread(r: SupabaseThread): ChatThread {
  return {
    id: r.id,
    farmstandId: r.farmstand_id,
    farmstandName: r.farmstand_name,
    farmstandPhotoUrl: r.farmstand_photo_url,
    participantUserIds: r.participant_user_ids,
    lastMessageText: r.last_message_text,
    lastMessageAt: r.last_message_at,
    lastMessageSenderId: r.last_message_sender_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toMessage(r: SupabaseMessage): ChatMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    farmstandId: r.farmstand_id,
    senderUserId: r.sender_user_id,
    recipientId: r.recipient_id,
    senderRole: r.sender_role as SenderRole,
    senderName: r.sender_name,
    text: r.text,
    read: r.read,
    createdAt: r.created_at,
  };
}

function toThreadState(r: SupabaseThreadState): ChatThreadState {
  const state: ChatThreadState = {
    threadId: r.thread_id,
    userId: r.user_id,
    lastReadAt: r.last_read_at,
    unreadCount: r.unread_count,
  };
  if (r.hidden_at) state.hiddenAt = r.hidden_at;
  return state;
}

// ─── AsyncStorage fallback keys ───────────────────────────────────────────────
const STORAGE_KEY_THREADS = 'chat_threads';
const STORAGE_KEY_MESSAGES = 'chat_messages';
const STORAGE_KEY_THREAD_STATES = 'chat_thread_states';

// ─── Store ────────────────────────────────────────────────────────────────────
export const useChatStore = create<ChatStoreState>((set, get) => ({
  threads: [],
  messages: [],
  threadStates: [],
  isLoading: false,

  loadChatData: async (userId?: string) => {
    set({ isLoading: true });
    try {
      if (isSupabaseConfigured() && userId) {
        // ── Supabase path ──────────────────────────────────────────────────
        // Load threads where the user is a participant.
        // We use a direct fetch because the array-contains operator (cs) is
        // not surfaced as a dedicated method on SupabaseQueryBuilder.
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
        const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
        const session = await getValidSession();
        const authKey = session?.access_token ?? supabaseAnonKey;

        let threads: ChatThread[] = [];
        try {
          const threadsUrl = new URL(`${supabaseUrl}/rest/v1/chat_threads`);
          // cs (contains) operator: array field contains the given element
          threadsUrl.searchParams.set('participant_user_ids', `cs.{"${userId}"}`);
          threadsUrl.searchParams.set('order', 'last_message_at.desc');
          threadsUrl.searchParams.set('select', '*');

          const threadsRes = await fetch(threadsUrl.toString(), {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${authKey}`,
            },
          });

          if (threadsRes.ok) {
            const rows = await threadsRes.json() as SupabaseThread[];
            threads = rows.map(toThread);
          } else {
            const errText = await threadsRes.text();
            console.log('[ChatStore] Error loading threads from Supabase:', threadsRes.status, errText);
          }
        } catch (err) {
          console.log('[ChatStore] Exception loading threads:', err);
        }

        // Load thread states for this user
        const { data: stateRows, error: stateErr } = await supabase
          .from<SupabaseThreadState>('chat_thread_states')
          .select('*')
          .eq('user_id', userId)
          .execute();

        if (stateErr) {
          console.log('[ChatStore] Error loading thread states from Supabase:', stateErr.message);
        }

        const threadStates: ChatThreadState[] = (stateRows ?? []).map(toThreadState);

        // Load messages for all loaded threads
        const threadIds = threads.map(t => t.id);
        let messages: ChatMessage[] = [];
        if (threadIds.length > 0) {
          const { data: msgRows, error: msgErr } = await supabase
            .from<SupabaseMessage>('chat_messages')
            .select('*')
            .in('thread_id', threadIds)
            .order('created_at', { ascending: true })
            .execute();

          if (msgErr) {
            console.log('[ChatStore] Error loading messages from Supabase:', msgErr.message);
          }
          messages = (msgRows ?? []).map(toMessage);
        }

        // Persist to AsyncStorage as offline cache
        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEY_THREADS, JSON.stringify(threads)),
          AsyncStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages)),
          AsyncStorage.setItem(STORAGE_KEY_THREAD_STATES, JSON.stringify(threadStates)),
        ]);

        set({ threads, messages, threadStates, isLoading: false });
      } else {
        // ── AsyncStorage fallback ──────────────────────────────────────────
        const [threadsData, messagesData, threadStatesData] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_THREADS),
          AsyncStorage.getItem(STORAGE_KEY_MESSAGES),
          AsyncStorage.getItem(STORAGE_KEY_THREAD_STATES),
        ]);

        set({
          threads: threadsData ? JSON.parse(threadsData) : [],
          messages: messagesData ? JSON.parse(messagesData) : [],
          threadStates: threadStatesData ? JSON.parse(threadStatesData) : [],
          isLoading: false,
        });
      }
    } catch (error) {
      console.error('[ChatStore] Error loading chat data:', error);
      // Fallback to AsyncStorage on error
      try {
        const [threadsData, messagesData, threadStatesData] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_THREADS),
          AsyncStorage.getItem(STORAGE_KEY_MESSAGES),
          AsyncStorage.getItem(STORAGE_KEY_THREAD_STATES),
        ]);
        set({
          threads: threadsData ? JSON.parse(threadsData) : [],
          messages: messagesData ? JSON.parse(messagesData) : [],
          threadStates: threadStatesData ? JSON.parse(threadStatesData) : [],
        });
      } catch {
        // ignore
      }
      set({ isLoading: false });
    }
  },

  loadMessagesForThread: async (threadId: string) => {
    if (!isSupabaseConfigured()) return;
    try {
      const { data: msgRows, error } = await supabase
        .from<SupabaseMessage>('chat_messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .execute();

      if (error) {
        console.log('[ChatStore] Error loading messages for thread:', error.message);
        return;
      }

      const newMessages = (msgRows ?? []).map(toMessage);
      const existingMessages = get().messages.filter(m => m.threadId !== threadId);
      const allMessages = [...existingMessages, ...newMessages];

      await AsyncStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(allMessages));
      set({ messages: allMessages });
    } catch (err) {
      console.log('[ChatStore] loadMessagesForThread error:', err);
    }
  },

  getOrCreateThread: async (
    farmstandId: string,
    farmstandName: string,
    farmstandPhotoUrl: string | null,
    currentUserId: string,
    farmstandOwnerUserId: string
  ) => {
    // Check if thread already exists between this user and this farmstand
    const existingThread = get().threads.find(
      t => t.farmstandId === farmstandId && t.participantUserIds.includes(currentUserId)
    );

    if (existingThread) {
      return existingThread;
    }

    // Create new thread
    const now = new Date().toISOString();
    const newThread: ChatThread = {
      id: `thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      farmstandId,
      farmstandName,
      farmstandPhotoUrl,
      participantUserIds: [currentUserId, farmstandOwnerUserId].filter(Boolean),
      createdAt: now,
      updatedAt: now,
      lastMessageText: '',
      lastMessageAt: now,
      lastMessageSenderId: '',
    };

    // Create initial thread states for both participants
    const newThreadStates: ChatThreadState[] = [
      {
        threadId: newThread.id,
        userId: currentUserId,
        lastReadAt: now,
        unreadCount: 0,
      },
    ];

    if (farmstandOwnerUserId && farmstandOwnerUserId !== currentUserId) {
      newThreadStates.push({
        threadId: newThread.id,
        userId: farmstandOwnerUserId,
        lastReadAt: now,
        unreadCount: 0,
      });
    }

    // Persist to Supabase
    if (isSupabaseConfigured()) {
      const { error: threadErr } = await supabase
        .from('chat_threads')
        .insert({
          id: newThread.id,
          farmstand_id: farmstandId,
          farmstand_name: farmstandName,
          farmstand_photo_url: farmstandPhotoUrl,
          participant_user_ids: newThread.participantUserIds,
          last_message_text: '',
          last_message_at: now,
          last_message_sender_id: '',
          created_at: now,
          updated_at: now,
        })
        .execute();

      if (threadErr) {
        console.log('[ChatStore] Error inserting thread to Supabase:', threadErr.message);
      }

      // Insert thread states
      for (const ts of newThreadStates) {
        const { error: stateErr } = await supabase
          .from('chat_thread_states')
          .insert({
            thread_id: ts.threadId,
            user_id: ts.userId,
            last_read_at: ts.lastReadAt,
            unread_count: 0,
          })
          .execute();
        if (stateErr) {
          console.log('[ChatStore] Error inserting thread state:', stateErr.message);
        }
      }
    }

    const threads = [...get().threads, newThread];
    const threadStates = [...get().threadStates, ...newThreadStates];

    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_THREADS, JSON.stringify(threads)),
      AsyncStorage.setItem(STORAGE_KEY_THREAD_STATES, JSON.stringify(threadStates)),
    ]);

    set({ threads, threadStates });
    return newThread;
  },

  getThreadById: (threadId: string) => {
    return get().threads.find(t => t.id === threadId);
  },

  getThreadsForUser: (userId: string) => {
    const { threads, threadStates } = get();
    return threads
      .filter(t => {
        if (!t.participantUserIds.includes(userId)) return false;
        const state = threadStates.find(
          ts => ts.threadId === t.id && ts.userId === userId
        );
        if (state?.hiddenAt) {
          return new Date(t.lastMessageAt) > new Date(state.hiddenAt);
        }
        return true;
      })
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  },

  getThreadByFarmstandAndUser: (farmstandId: string, userId: string) => {
    return get().threads.find(
      t => t.farmstandId === farmstandId && t.participantUserIds.includes(userId)
    );
  },

  sendMessage: async (
    threadId: string,
    farmstandId: string,
    senderUserId: string,
    senderRole: SenderRole,
    senderName: string,
    text: string
  ) => {
    const now = new Date().toISOString();
    const thread = get().threads.find(t => t.id === threadId);
    const recipientId = thread?.participantUserIds.find(id => id !== senderUserId) ?? null;

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      threadId,
      farmstandId,
      senderUserId,
      recipientId,
      senderRole,
      senderName,
      text,
      read: false,
      createdAt: now,
    };

    // Update thread with last message info
    const threads = get().threads.map(t =>
      t.id === threadId
        ? {
            ...t,
            lastMessageText: text,
            lastMessageAt: now,
            lastMessageSenderId: senderUserId,
            updatedAt: now,
          }
        : t
    );

    // Increment unread count for all other participants
    let threadStates = get().threadStates;

    if (thread) {
      thread.participantUserIds.forEach(participantId => {
        if (participantId !== senderUserId) {
          const existingState = threadStates.find(
            ts => ts.threadId === threadId && ts.userId === participantId
          );

          if (existingState) {
            threadStates = threadStates.map(ts =>
              ts.threadId === threadId && ts.userId === participantId
                ? { ...ts, unreadCount: ts.unreadCount + 1 }
                : ts
            );
          } else {
            threadStates = [
              ...threadStates,
              {
                threadId,
                userId: participantId,
                lastReadAt: now,
                unreadCount: 1,
              },
            ];
          }
        }
      });
    }

    const messages = [...get().messages, newMessage];

    // Persist to Supabase
    if (isSupabaseConfigured()) {
      const { error: msgErr } = await supabase
        .from('chat_messages')
        .insert({
          id: newMessage.id,
          thread_id: threadId,
          farmstand_id: farmstandId,
          sender_user_id: senderUserId,
          recipient_id: recipientId,
          sender_role: senderRole,
          sender_name: senderName,
          text,
          read: false,
          created_at: now,
        })
        .execute();

      if (msgErr) {
        console.log('[ChatStore] Error inserting message to Supabase:', msgErr.message);
      }

      // Update thread in Supabase
      const updatedThread = threads.find(t => t.id === threadId);
      if (updatedThread) {
        const { error: threadErr } = await supabase
          .from('chat_threads')
          .update({
            last_message_text: text,
            last_message_at: now,
            last_message_sender_id: senderUserId,
            updated_at: now,
          })
          .eq('id', threadId)
          .execute();

        if (threadErr) {
          console.log('[ChatStore] Error updating thread in Supabase:', threadErr.message);
        }
      }

      // Update unread counts in Supabase for each non-sender participant
      if (thread) {
        for (const participantId of thread.participantUserIds) {
          if (participantId === senderUserId) continue;

          // Upsert thread state: increment unread count
          // We do this via a raw fetch to call the REST API with a custom conflict handler
          // because SupabaseQueryBuilder doesn't support upsert natively
          const session = await getValidSession();
          if (session?.access_token) {
            const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
            const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

            const existingState = threadStates.find(
              ts => ts.threadId === threadId && ts.userId === participantId
            );
            const newUnread = existingState ? existingState.unreadCount : 1;

            await fetch(`${supabaseUrl}/rest/v1/chat_thread_states`, {
              method: 'POST',
              headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates,return=minimal',
              },
              body: JSON.stringify({
                thread_id: threadId,
                user_id: participantId,
                last_read_at: now,
                unread_count: newUnread,
              }),
            }).catch(err => console.log('[ChatStore] Upsert thread state error:', err));
          }
        }
      }
    }

    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages)),
      AsyncStorage.setItem(STORAGE_KEY_THREADS, JSON.stringify(threads)),
      AsyncStorage.setItem(STORAGE_KEY_THREAD_STATES, JSON.stringify(threadStates)),
    ]);

    set({ messages, threads, threadStates });

    // Fire push notification to all participants except the sender (non-blocking)
    if (thread) {
      const sendPush = async () => {
        try {
          const session = await getValidSession();
          if (!session?.access_token) return;

          await fetch(`${BACKEND_URL}/api/send-chat-push`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              recipient_user_ids: thread.participantUserIds,
              sender_user_id: senderUserId,
              sender_name: senderName,
              farmstand_name: thread.farmstandName,
              message_text: text,
              thread_id: threadId,
            }),
          });
        } catch (err) {
          console.log('[ChatStore] Push notification error (non-fatal):', err);
        }
      };
      sendPush();
    }

    return newMessage;
  },

  getMessagesForThread: (threadId: string) => {
    return get().messages
      .filter(m => m.threadId === threadId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  markThreadAsRead: async (threadId: string, userId: string) => {
    const now = new Date().toISOString();
    let threadStates = get().threadStates;

    const existingState = threadStates.find(
      ts => ts.threadId === threadId && ts.userId === userId
    );

    if (existingState) {
      threadStates = threadStates.map(ts =>
        ts.threadId === threadId && ts.userId === userId
          ? { ...ts, unreadCount: 0, lastReadAt: now }
          : ts
      );
    } else {
      threadStates = [
        ...threadStates,
        {
          threadId,
          userId,
          lastReadAt: now,
          unreadCount: 0,
        },
      ];
    }

    // Persist to Supabase
    if (isSupabaseConfigured()) {
      const session = await getValidSession();
      if (session?.access_token) {
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
        const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

        // Update thread state (unread count → 0)
        await fetch(`${supabaseUrl}/rest/v1/chat_thread_states`, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            thread_id: threadId,
            user_id: userId,
            last_read_at: now,
            unread_count: 0,
          }),
        }).catch(err => console.log('[ChatStore] markThreadAsRead Supabase error:', err));

        // Mark all messages sent to this user in this thread as read
        const markReadUrl = new URL(`${supabaseUrl}/rest/v1/chat_messages`);
        markReadUrl.searchParams.set('thread_id', `eq.${threadId}`);
        markReadUrl.searchParams.set('recipient_id', `eq.${userId}`);
        markReadUrl.searchParams.set('read', 'eq.false');
        await fetch(markReadUrl.toString(), {
          method: 'PATCH',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ read: true }),
        }).catch(err => console.log('[ChatStore] markMessagesRead Supabase error:', err));

        // Reset the unread count in the conversations table.
        // Determine whether the current user is the owner or the customer by
        // inspecting the thread's participant list.
        const thread = get().threads.find(t => t.id === threadId);
        if (thread) {
          const otherUserId = thread.participantUserIds.find(id => id !== userId);
          const convUrl = new URL(`${supabaseUrl}/rest/v1/conversations`);
          convUrl.searchParams.set('farmstand_id', `eq.${thread.farmstandId}`);

          // We don't store which participant is the owner vs. customer in the
          // thread object, so we attempt both updates and let Supabase's RLS /
          // row-matching silently no-op the one that doesn't match.
          const now2 = new Date().toISOString();

          // Attempt as owner
          const ownerUrl = new URL(convUrl.toString());
          ownerUrl.searchParams.set('owner_id', `eq.${userId}`);
          if (otherUserId) ownerUrl.searchParams.set('customer_id', `eq.${otherUserId}`);
          fetch(ownerUrl.toString(), {
            method: 'PATCH',
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ owner_unread_count: 0, updated_at: now2 }),
          }).catch(err => console.log('[ChatStore] conversations owner reset error:', err));

          // Attempt as customer
          const customerUrl = new URL(convUrl.toString());
          customerUrl.searchParams.set('customer_id', `eq.${userId}`);
          if (otherUserId) customerUrl.searchParams.set('owner_id', `eq.${otherUserId}`);
          fetch(customerUrl.toString(), {
            method: 'PATCH',
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ customer_unread_count: 0, updated_at: now2 }),
          }).catch(err => console.log('[ChatStore] conversations customer reset error:', err));
        }
      }
    }

    // Update local message cache to reflect read state
    const messages = get().messages.map(m =>
      m.threadId === threadId && m.recipientId === userId
        ? { ...m, read: true }
        : m
    );
    await AsyncStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    await AsyncStorage.setItem(STORAGE_KEY_THREAD_STATES, JSON.stringify(threadStates));
    set({ threadStates, messages });
  },

  getUnreadCountForUser: (userId: string) => {
    return get().threadStates
      .filter(ts => ts.userId === userId && ts.unreadCount > 0)
      .reduce((total, ts) => total + ts.unreadCount, 0);
  },

  getUnreadCountForThread: (threadId: string, userId: string) => {
    const state = get().threadStates.find(
      ts => ts.threadId === threadId && ts.userId === userId
    );
    return state?.unreadCount ?? 0;
  },

  getTotalUnreadCount: (userId: string) => {
    const { threadStates, threads } = get();
    return threadStates
      .filter(ts => {
        if (ts.userId !== userId) return false;
        if (ts.hiddenAt) {
          const thread = threads.find(t => t.id === ts.threadId);
          if (!thread || new Date(thread.lastMessageAt) <= new Date(ts.hiddenAt)) {
            return false;
          }
        }
        return true;
      })
      .reduce((total, ts) => total + ts.unreadCount, 0);
  },

  getThreadStateForUser: (threadId: string, userId: string) => {
    return get().threadStates.find(
      ts => ts.threadId === threadId && ts.userId === userId
    );
  },

  hideThreadForUser: async (threadId: string, userId: string) => {
    const now = new Date().toISOString();
    let threadStates = get().threadStates;

    const existingState = threadStates.find(
      ts => ts.threadId === threadId && ts.userId === userId
    );

    if (existingState) {
      threadStates = threadStates.map(ts =>
        ts.threadId === threadId && ts.userId === userId
          ? { ...ts, hiddenAt: now, unreadCount: 0 }
          : ts
      );
    } else {
      threadStates = [
        ...threadStates,
        {
          threadId,
          userId,
          lastReadAt: now,
          unreadCount: 0,
          hiddenAt: now,
        },
      ];
    }

    // Persist to Supabase
    if (isSupabaseConfigured()) {
      const session = await getValidSession();
      if (session?.access_token) {
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
        const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

        await fetch(`${supabaseUrl}/rest/v1/chat_thread_states`, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({
            thread_id: threadId,
            user_id: userId,
            last_read_at: now,
            unread_count: 0,
            hidden_at: now,
          }),
        }).catch(err => console.log('[ChatStore] hideThreadForUser Supabase error:', err));
      }
    }

    await AsyncStorage.setItem(STORAGE_KEY_THREAD_STATES, JSON.stringify(threadStates));
    set({ threadStates });
  },

  unhideThreadForUser: async (threadId: string, userId: string) => {
    let threadStates = get().threadStates;

    threadStates = threadStates.map(ts =>
      ts.threadId === threadId && ts.userId === userId
        ? { ...ts, hiddenAt: undefined }
        : ts
    );

    // Persist to Supabase
    if (isSupabaseConfigured()) {
      const { error } = await supabase
        .from('chat_thread_states')
        .update({ hidden_at: null })
        .eq('thread_id', threadId)
        .eq('user_id', userId)
        .execute();

      if (error) {
        console.log('[ChatStore] unhideThreadForUser Supabase error:', error.message);
      }
    }

    await AsyncStorage.setItem(STORAGE_KEY_THREAD_STATES, JSON.stringify(threadStates));
    set({ threadStates });
  },

  isThreadHiddenForUser: (threadId: string, userId: string) => {
    const state = get().threadStates.find(
      ts => ts.threadId === threadId && ts.userId === userId
    );
    return !!state?.hiddenAt;
  },
}));
