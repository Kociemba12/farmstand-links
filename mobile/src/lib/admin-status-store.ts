import { create } from 'zustand';
import { isAdminEmail } from './user-store';

/**
 * Admin status states:
 * - 'loading': Still checking admin status
 * - 'admin': User is confirmed admin (email === ADMIN_EMAIL)
 * - 'not_admin': User is confirmed NOT admin
 */
export type AdminStatus = 'loading' | 'admin' | 'not_admin';

interface AdminStatusState {
  status: AdminStatus;
  lastCheckedEmail: string | null;

  // Actions
  checkAdminStatus: (email: string | null | undefined) => void;
  resetStatus: () => void;
}

/**
 * Admin Status Store
 *
 * SINGLE SOURCE OF TRUTH: Admin access is determined ONLY by email.
 * If email === "contact@farmstand.online" -> Admin
 * Otherwise -> Not Admin
 *
 * NO database lookups, NO role checks, NO profiles.is_admin field.
 */
export const useAdminStatusStore = create<AdminStatusState>((set) => ({
  status: 'loading',
  lastCheckedEmail: null,

  /**
   * Check if the given email is admin
   * ONLY checks if email === ADMIN_EMAIL ("contact@farmstand.online")
   */
  checkAdminStatus: (email: string | null | undefined) => {
    if (!email) {
      console.log('[AdminStatus] No email provided, not admin');
      set({ status: 'not_admin', lastCheckedEmail: null });
      return;
    }

    const emailLower = email.toLowerCase().trim();
    const isAdmin = isAdminEmail(email);

    console.log('[AdminStatus] Checking email:', emailLower, '-> isAdmin:', isAdmin);

    set({
      status: isAdmin ? 'admin' : 'not_admin',
      lastCheckedEmail: emailLower,
    });
  },

  /**
   * Reset status (e.g., on logout)
   */
  resetStatus: () => {
    set({
      status: 'loading',
      lastCheckedEmail: null,
    });
  },
}));
