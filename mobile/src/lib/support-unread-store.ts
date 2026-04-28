import { create } from 'zustand';
import { fetchUnreadSupportCount } from './support-api';

interface SupportUnreadState {
  unreadCount: number;
  fetchUnreadCount: () => Promise<void>;
  clearUnread: () => void;
}

export const useSupportUnreadStore = create<SupportUnreadState>((set) => ({
  unreadCount: 0,

  fetchUnreadCount: async () => {
    const count = await fetchUnreadSupportCount();
    set({ unreadCount: count });
  },

  clearUnread: () => set({ unreadCount: 0 }),
}));
