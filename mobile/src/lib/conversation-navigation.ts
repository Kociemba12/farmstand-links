import { router } from 'expo-router';

export interface ConversationNavParams {
  farmstandId: string;
  otherUserId: string;
  farmstandName?: string;
  otherUserName?: string;
  otherUserAvatarUrl?: string;
  /** Stable conversation UUID from the backend. When present, the chat
   *  screen can skip its own lookup. When absent, '/chat/new' is used and
   *  the screen resolves the thread from farmstandId + otherUserId. */
  conversationId?: string;
}

/**
 * Navigate to a conversation thread, always routing THROUGH the Inbox tab.
 *
 * This is the single source of truth for opening any conversation, whether
 * from a manual inbox tap or a push-notification tap. Both paths must call
 * this function so back-navigation always returns to Inbox and duplicate
 * screens are never pushed.
 *
 * Pattern:
 *   1. router.navigate('/(tabs)/inbox')  — no-op if already on Inbox,
 *      otherwise switches to the Inbox tab without adding a stack entry.
 *   2. router.push('/chat/...')          — pushes the thread on top of the
 *      Inbox tab so the back arrow returns to Inbox.
 */
export function navigateToConversation(params: ConversationNavParams): void {
  const {
    farmstandId,
    otherUserId,
    farmstandName,
    otherUserName,
    otherUserAvatarUrl,
    conversationId,
  } = params;

  // Build query params in the same shape the chat screen expects
  const chatParams: Record<string, string> = { farmstandId, otherUserId };
  if (farmstandName) chatParams.farmstandName = farmstandName;
  if (otherUserName) chatParams.otherUserName = otherUserName;
  if (otherUserAvatarUrl) chatParams.otherUserAvatarUrl = otherUserAvatarUrl;

  // Use stable conversationId as the threadId when available, else 'new'
  const threadId = conversationId ?? 'new';
  const chatPath = `/chat/${threadId}?${new URLSearchParams(chatParams).toString()}`;

  // Step 1: Ensure Inbox tab is active in the navigation state.
  //         router.navigate is a no-op when the target is already focused,
  //         so this is safe to call from within the Inbox screen too.
  router.navigate('/(tabs)/inbox' as any);

  // Step 2: Push the chat thread on top of the Inbox tab.
  //         Back arrow from the thread will pop back to Inbox.
  router.push(chatPath as any);
}
