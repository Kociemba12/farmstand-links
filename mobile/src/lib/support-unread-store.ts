import { create } from 'zustand';
import { fetchUnreadSupportCount } from './support-api';

interface SupportUnreadState {
  unreadCount: number;
  unreadTicketIds: string[];
  fetchUnreadCount: () => Promise<void>;
  clearUnread: () => void;
  markTicketRead: (ticketId: string) => void;
}

export const useSupportUnreadStore = create<SupportUnreadState>((set) => ({
  unreadCount: 0,
  unreadTicketIds: [],

  fetchUnreadCount: async () => {
    const { count, ticketIds } = await fetchUnreadSupportCount();
    if (__DEV__) console.log('[SupportUnreadStore] fetchUnreadCount — count:', count, '| ticketIds:', ticketIds);
    set({ unreadCount: count, unreadTicketIds: ticketIds });
  },

  clearUnread: () => set({ unreadCount: 0, unreadTicketIds: [] }),

  markTicketRead: (ticketId: string) => set((state) => {
    const newIds = state.unreadTicketIds.filter(id => id !== ticketId);
    if (__DEV__) console.log('[SupportUnreadStore] markTicketRead — ticketId:', ticketId, '| remaining unread:', newIds.length);
    return { unreadTicketIds: newIds, unreadCount: newIds.length };
  }),
}));
