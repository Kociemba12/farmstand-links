import { create } from 'zustand';

export interface PendingNotificationRedirect {
  type: 'message_thread';
  farmstandId?: string | null;
  otherUserId?: string | null;
  conversationId?: string | null;
  /** Legacy threadId for payloads without farmstandId/otherUserId */
  threadId?: string | null;
}

interface PendingNotificationState {
  pending: PendingNotificationRedirect | null;
  set: (redirect: PendingNotificationRedirect) => void;
  clear: () => void;
}

/**
 * Holds a pending notification redirect target that survives auth state changes.
 *
 * Lifecycle:
 *   1. A message push notification is tapped while the user is logged out.
 *   2. The tap handler (or cold-start handler) saves the destination here instead
 *      of navigating immediately.
 *   3. When the user logs in, the post-auth redirect effect in _layout.tsx reads
 *      this store, fires the navigation, then calls clear().
 */
export const usePendingNotificationStore = create<PendingNotificationState>((set) => ({
  pending: null,
  set: (redirect) => {
    console.log('[PendingNotification] Saving redirect:', JSON.stringify(redirect));
    set({ pending: redirect });
  },
  clear: () => set({ pending: null }),
}));
