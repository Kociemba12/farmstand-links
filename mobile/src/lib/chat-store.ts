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

// Message shape from the real public.messages table
export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  farmstand_id: string;
  body: string;
  created_at: string;
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

  // Unread message count from backend (source of truth)
  totalUnreadMessages: number;
  unreadLoaded: boolean; // true after the first successful fetch
  setTotalUnreadMessages: (count: number) => void;
  fetchUnreadMessageCount: () => Promise<void>;

  // Timestamp (ms) of the last markConversationRead call — used to prevent
  // background polls from re-flashing stale badge counts.
  lastMarkReadAt: number | null;

  // Mark a conversation as read (updates local backend read-tracking)
  markConversationRead: (farmstandId: string, otherUserId: string) => Promise<void>;

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
  ) => Promise<{ message: ChatMessage; chatMsgOk: boolean; chatMsgError: string | null; publicMsgOk: boolean | null; publicMsgStatus: number | null; publicMsgBody: string | null; publicMsgError: string | null } | null>;
  getMessagesForThread: (threadId: string) => ChatMessage[];
  loadMessagesForThread: (threadId: string) => Promise<void>;

  // Direct messages from public.messages table
  loadDirectMessages: (farmstandId: string, currentUserId: string, otherUserId: string) => Promise<DirectMessage[]>;
  sendDirectMessage: (farmstandId: string, senderId: string, receiverId: string, body: string) => Promise<DirectMessage | null>;

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

  // ─── Unread message count from public.conversations ────────────────────────
  totalUnreadMessages: 0,
  unreadLoaded: false,
  lastMarkReadAt: null,

  setTotalUnreadMessages: (count: number) => {
    set({ totalUnreadMessages: count });
  },

  fetchUnreadMessageCount: async () => {
    const session = await getValidSession();
    if (!session?.access_token) {
      console.log('[ChatStore][unread] No valid session, skipping message count fetch');
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/messages/unread-count`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const ct = res.headers.get('content-type') ?? '';

      if (res.status === 401) {
        // Badge-only endpoint — a 401 must never affect inbox messages or conversations.
        // Log once and return; the badge will stay at its previous value.
        console.log('[ChatStore][unread] 401 from unread-count — badge unavailable, inbox unaffected');
        return;
      }

      if (res.ok && ct.includes('application/json')) {
        const data = await res.json() as { unreadCount?: number };
        const count = data.unreadCount ?? 0;
        console.log('[ChatStore][unread] unreadConversations from backend:', count);

        // Anti-flicker guard: if a mark-read just fired (within 5s), don't let a
        // background poll restore a stale higher count before the backend has
        // processed the mark-read. The reconciliation call inside
        // markConversationRead will set the correct count once complete.
        const lastMarkRead = get().lastMarkReadAt;
        const msSince = lastMarkRead != null ? Date.now() - lastMarkRead : Infinity;
        if (msSince < 5000 && count > get().totalUnreadMessages) {
          console.log('[ChatStore][unread] Skipping stale count from poll (mark-read in flight), staleCount:', count, 'currentCount:', get().totalUnreadMessages, 'msSince:', msSince);
          return;
        }

        set({ totalUnreadMessages: count, unreadLoaded: true });
      } else {
        console.log('[ChatStore][unread] unread-count fetch error:', res.status);
      }
    } catch (err) {
      console.log('[ChatStore][unread] unread-count fetch exception:', err instanceof Error ? err.message : String(err));
    }
  },

  markConversationRead: async (farmstandId: string, otherUserId: string) => {
    // Stamp the time so background polls are suppressed for 5s while the
    // backend processes the mark-read and we refetch the real count.
    set({ lastMarkReadAt: Date.now() });
    // Optimistic update: immediately drop badge by 1 so it clears without
    // waiting for the backend round-trip. fetchUnreadMessageCount below
    // will correct the exact count once the server responds.
    const current = get().totalUnreadMessages;
    if (current > 0) set({ totalUnreadMessages: current - 1 });
    console.log('[ChatStore] markConversationRead: stamping lastMarkReadAt, current unreadConversations:', current);

    const session = await getValidSession();
    if (!session?.access_token) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/messages/mark-read`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ farmstand_id: farmstandId, other_user_id: otherUserId }),
      });
      if (res.ok) {
        console.log('[ChatStore] markConversationRead: backend marked read, reconciling badge');
        // Reconcile with server — sets the correct remaining unread count
        await get().fetchUnreadMessageCount();
      } else {
        console.log('[ChatStore] markConversationRead error:', res.status);
      }
    } catch (err) {
      console.log('[ChatStore] markConversationRead exception:', err);
    }
  },

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
          .requireAuth()
          .select('*')
          .eq('user_id', userId)
          .execute();

        if (stateErr) {
          console.log('[ChatStore] Error loading thread states from Supabase:', stateErr.message);
        }

        const threadStates: ChatThreadState[] = (stateRows ?? []).map(toThreadState);

        // chat_messages table does not exist; preserve whatever messages are already cached
        const messages: ChatMessage[] = get().messages;

        // Persist to AsyncStorage as offline cache
        await Promise.all([
          AsyncStorage.setItem(STORAGE_KEY_THREADS, JSON.stringify(threads)),
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

  loadMessagesForThread: async (_threadId: string) => {
    // chat_messages table does not exist; messages are loaded via loadDirectMessages instead
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
  ): Promise<{ message: ChatMessage; chatMsgOk: boolean; chatMsgError: string | null; publicMsgOk: boolean | null; publicMsgStatus: number | null; publicMsgBody: string | null; publicMsgError: string | null } | null> => {
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

    // Track insert results to return to caller
    let chatMsgOk = false;
    let chatMsgError: string | null = null;
    let publicMsgOk: boolean | null = null;
    let publicMsgStatus: number | null = null;
    let publicMsgBody: string | null = null;
    let publicMsgError: string | null = null;

    // Persist to Supabase
    if (isSupabaseConfigured()) {
      // chat_messages table does not exist — skip that insert entirely

      chatMsgOk = true;
      chatMsgError = null;

      // Insert into public.messages using standard Supabase JS client
      if (recipientId) {
        const publicMsgPayload = {
          sender_id: senderUserId,
          receiver_id: recipientId,
          farmstand_id: farmstandId,
          body: text,
          created_at: now,
        };
        console.log('[sendMessage] STANDARD_INSERT_PATH=TRUE — INSERT public.messages payload:', JSON.stringify(publicMsgPayload));

        const { data: pmData, error: pmErr } = await supabase
          .from('messages')
          .insert([publicMsgPayload])
          .execute();

        if (pmErr) {
          publicMsgOk = false;
          publicMsgStatus = null;
          publicMsgBody = pmErr.message;
          publicMsgError = pmErr.message;
          console.log('[sendMessage] public.messages INSERT FAILED:', pmErr.message);
        } else {
          publicMsgOk = true;
          publicMsgStatus = 201;
          publicMsgBody = JSON.stringify(pmData);
          publicMsgError = null;
          console.log('[sendMessage] public.messages INSERT SUCCESS — row:', JSON.stringify(pmData));
        }
      } else {
        publicMsgOk = false;
        publicMsgError = 'No recipientId — insert skipped';
        console.log('[sendMessage] No recipientId — skipping public.messages insert');
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

    return { message: newMessage, chatMsgOk, chatMsgError, publicMsgOk, publicMsgStatus, publicMsgBody, publicMsgError };
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

        // chat_messages table does not exist; read-marking skipped

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

  // ─── Direct messages from public.messages table ───────────────────────────
  // otherUserId param kept for call-site compatibility but not used in the filter.
  // .requireAuth() is REQUIRED — this custom client defaults GET queries to allowAnon=true,
  // which makes RLS see an unauthenticated request and return no rows.
  // No limit/range/cursor/cutoff — fetch all matching rows in ascending order.
  loadDirectMessages: async (farmstandId: string, currentUserId: string, _otherUserId: string): Promise<DirectMessage[]> => {
    if (!isSupabaseConfigured()) return [];

    try {
      const session = await getValidSession();
      console.log('[loadDirectMessages AUTH CHECK]', {
        hasSession: !!session,
      });

      const { data, error } = await supabase
        .from('messages')
        .select('id, sender_id, receiver_id, farmstand_id, body, created_at')
        .eq('farmstand_id', farmstandId)
        .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
        .order('created_at', { ascending: true })
        .requireAuth();

      console.log('[loadDirectMessages RESULT]', {
        count: data?.length || 0,
        error,
        first: (data as DirectMessage[] | null)?.[0]
          ? { body: (data as DirectMessage[])[0].body, created_at: (data as DirectMessage[])[0].created_at }
          : null,
        latest: (data as DirectMessage[] | null)?.[data!.length - 1]
          ? { body: (data as DirectMessage[])[data!.length - 1].body, created_at: (data as DirectMessage[])[data!.length - 1].created_at }
          : null,
      });

      if (error) {
        console.log('[loadDirectMessages] ERROR:', error.message, error);
        return [];
      }

      const messages: DirectMessage[] = ((data ?? []) as DirectMessage[]).map(row => ({
        id: row.id,
        sender_id: row.sender_id,
        receiver_id: row.receiver_id,
        farmstand_id: row.farmstand_id,
        body: row.body,
        created_at: row.created_at,
      }));

      if (__DEV__) {
        console.log('[loadDirectMessages] returned', messages.length, 'messages');
        if (messages.length > 0) {
          console.log('[loadDirectMessages] latest body:', messages[messages.length - 1].body,
            'created_at:', messages[messages.length - 1].created_at);
        }
      }
      return messages;
    } catch (err) {
      console.log('[loadDirectMessages] EXCEPTION:', err instanceof Error ? err.message : String(err));
      return [];
    }
  },

  sendDirectMessage: async (farmstandId: string, senderId: string, receiverId: string, body: string): Promise<DirectMessage | null> => {
    if (!isSupabaseConfigured()) return null;
    const session = await getValidSession();
    if (!session?.access_token) {
      if (__DEV__) console.log('[sendDirectMessage] ABORT: no valid session');
      return null;
    }

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

    if (__DEV__) console.log('[sendDirectMessage] INSERT into public.messages farmstandId:', farmstandId, 'sender:', senderId, 'receiver:', receiverId);

    try {
      const payload = {
        sender_id: senderId,
        receiver_id: receiverId,
        farmstand_id: farmstandId,
        body,
      };

      const res = await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (__DEV__) console.log('[sendDirectMessage] INSERT FAILED status:', res.status, errText.slice(0, 200));
        return null;
      }

      const rows = await res.json() as DirectMessage[];
      const inserted = rows?.[0] ?? null;
      if (__DEV__) console.log('[sendDirectMessage] INSERT SUCCESS id:', inserted?.id);
      return inserted;
    } catch (err) {
      if (__DEV__) console.log('[sendDirectMessage] EXCEPTION:', err instanceof Error ? err.message : String(err));
      return null;
    }
  },
}));
