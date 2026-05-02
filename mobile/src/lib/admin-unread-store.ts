import { create } from 'zustand';
import { supabase } from './supabase';

interface AdminUnreadState {
  adminUnreadCount: number;
  fetchAdminUnreadCount: () => Promise<void>;
  decrementCount: () => void;
}

export const useAdminUnreadStore = create<AdminUnreadState>((set) => ({
  adminUnreadCount: 0,

  fetchAdminUnreadCount: async () => {
    try {
      const { data, error } = await supabase
        .from<Record<string, unknown>>('feedback')
        .select('id, status')
        .eq('status', 'new')
        .neq('source_screen', 'support_dismissed')
        .requireAuth()
        .execute();
      if (error) {
        if (__DEV__) console.warn('[AdminUnread] fetchAdminUnreadCount error:', (error as { message?: string }).message ?? error);
        return;
      }
      const count = data?.length ?? 0;
      if (__DEV__) console.log('[AdminUnread] admin unread support tickets:', count);
      set({ adminUnreadCount: count });
    } catch (err) {
      if (__DEV__) console.warn('[AdminUnread] fetchAdminUnreadCount exception:', err instanceof Error ? err.message : String(err));
    }
  },

  decrementCount: () => set((state) => ({
    adminUnreadCount: Math.max(0, state.adminUnreadCount - 1),
  })),
}));
