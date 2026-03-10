import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabaseAuthUpdateUser, supabaseSignOut, isSupabaseConfigured, hasActiveSession, getValidSession } from './supabase';
import { notifyAuthSessionChanged } from '@/providers/AuthProvider';

export type UserRole = 'admin' | 'farmer' | 'consumer';

export interface UserProfile {
  id: string | null;
  name: string;
  email: string;
  initials: string;
  memberSince: number;
  visitedCount: number;
  reviewsCount: number;
  savedCount: number;
  isFarmer: boolean;
  farmId?: string;
  role: UserRole;
  profilePhoto?: string; // URI to profile photo
}

export interface NotificationSettings {
  messages: boolean;
  newFarmstands: boolean;
  seasonalProducts: boolean;
  savedFarmUpdates: boolean;
  promotions: boolean;
  appUpdates: boolean;
}

export interface LocationSettings {
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  searchRadius: number; // in miles
}

interface UserState {
  user: UserProfile | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  notifications: NotificationSettings;
  location: LocationSettings;
  visitedFarms: string[];
  reviews: { farmId: string; rating: number; text: string; date: string }[];

  // Computed helpers
  isGuest: () => boolean;

  // Actions
  loadUser: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signUp: (name: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  updateUser: (updates: Partial<UserProfile>) => Promise<void>;
  updateNotifications: (settings: Partial<NotificationSettings>) => Promise<void>;
  updateLocation: (location: Partial<LocationSettings>) => Promise<void>;
  addVisitedFarm: (farmId: string) => Promise<void>;
  addReview: (farmId: string, rating: number, text: string) => Promise<void>;
  setFarmerStatus: (isFarmer: boolean, farmId?: string) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  signOut: () => Promise<void>;
}

// Admin email - only this email has admin access
// AUTHORITATIVE: If user email === ADMIN_EMAIL, grant admin access unconditionally
export const ADMIN_EMAIL = 'contact@farmstand.online';

// Helper to check if an email is the admin email
export const isAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  return email.toLowerCase().trim() === ADMIN_EMAIL.toLowerCase();
};

const DEFAULT_USER: UserProfile = {
  id: null, // No hardcoded ID - use real Supabase auth user ID when signed in
  name: 'Admin',
  email: ADMIN_EMAIL,
  initials: 'AD',
  memberSince: 2024,
  visitedCount: 0,
  reviewsCount: 0,
  savedCount: 0,
  isFarmer: false,
  role: 'admin', // Admin role tied to ADMIN_EMAIL
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  messages: true,
  newFarmstands: true,
  seasonalProducts: true,
  savedFarmUpdates: true,
  promotions: false,
  appUpdates: true,
};

const DEFAULT_LOCATION: LocationSettings = {
  city: 'Portland',
  state: 'OR',
  latitude: 45.5152,
  longitude: -122.6784,
  searchRadius: 50,
};

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  isLoggedIn: false,
  isLoading: false,
  notifications: DEFAULT_NOTIFICATIONS,
  location: DEFAULT_LOCATION,
  visitedFarms: [],
  reviews: [],

  // Helper to check if user is a guest (not logged in OR logged in as guest)
  isGuest: () => {
    const { user, isLoggedIn } = get();
    return !isLoggedIn || user === null || user.id === 'guest';
  },

  loadUser: async () => {
    set({ isLoading: true });
    try {
      const userData = await AsyncStorage.getItem('farmstand_user');
      const notifData = await AsyncStorage.getItem('farmstand_notifications');
      const locData = await AsyncStorage.getItem('farmstand_location');
      const visitedData = await AsyncStorage.getItem('farmstand_visited');
      const reviewsData = await AsyncStorage.getItem('farmstand_reviews');
      const isLoggedIn = await AsyncStorage.getItem('farmstand_logged_in');

      // Supabase session is loaded from SecureStore by bootstrap — no AsyncStorage read needed here

      if (isLoggedIn === 'true' && userData) {
        let user: UserProfile = JSON.parse(userData);

        // === SESSION GATE: If user has a real Supabase UUID (not local/guest) AND
        // Supabase is configured, verify the Supabase session still exists.
        // If the session is gone (keychain wiped, reinstall, etc.) force sign-out
        // so the farmstand_logged_in flag doesn't create a zombie "logged in" state
        // that lets the admin screen render but breaks all authenticated API calls.
        const hasRealSupabaseId = user.id && user.id !== 'guest' && !user.id.startsWith('user-');
        if (hasRealSupabaseId && isSupabaseConfigured()) {
          const supabaseSession = await getValidSession();
          if (!supabaseSession) {
            // Session gone — clear the stale flag so user sees login screen
            console.log('[UserStore] loadUser: Supabase session missing for user', user.id, '— clearing stale farmstand_logged_in flag');
            await AsyncStorage.removeItem('farmstand_logged_in');
            set({ isLoggedIn: false, isLoading: false, user: null });
            return;
          }
          console.log('[UserStore] loadUser: Supabase session confirmed for user', user.id);
        }

        // Check for approved claims that should grant farmer status
        const approvedClaimsData = await AsyncStorage.getItem('approved_claims');
        if (approvedClaimsData && !user.isFarmer) {
          const approvedClaims = JSON.parse(approvedClaimsData);
          const matchingClaim = approvedClaims.find(
            (claim: { requesterEmail: string; requesterUserId: string | null; farmstandId: string }) =>
              claim.requesterEmail === user.email.toLowerCase() ||
              claim.requesterUserId === user.id
          );

          if (matchingClaim) {
            // Grant farmer status
            user = {
              ...user,
              isFarmer: true,
              farmId: matchingClaim.farmstandId,
              role: 'farmer' as UserRole,
            };
            await AsyncStorage.setItem('farmstand_user', JSON.stringify(user));

            // Remove the processed claim
            const remainingClaims = approvedClaims.filter(
              (claim: { farmstandId: string }) => claim.farmstandId !== matchingClaim.farmstandId
            );
            await AsyncStorage.setItem('approved_claims', JSON.stringify(remainingClaims));
          }
        }

        set({
          user,
          notifications: notifData ? JSON.parse(notifData) : DEFAULT_NOTIFICATIONS,
          location: locData ? JSON.parse(locData) : DEFAULT_LOCATION,
          visitedFarms: visitedData ? JSON.parse(visitedData) : [],
          reviews: reviewsData ? JSON.parse(reviewsData) : [],
          isLoggedIn: true,
          isLoading: false,
        });
      } else {
        set({ isLoggedIn: false, isLoading: false, user: null });
      }
    } catch (error) {
      console.error('Error loading user:', error);
      set({ isLoading: false });
    }
  },

  signIn: async (email: string, password: string) => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if this is a registered user
    const registeredUsersData = await AsyncStorage.getItem('farmstand_registered_users');
    const registeredUsers: Array<{ email: string; password: string; name: string; id?: string }> =
      registeredUsersData ? JSON.parse(registeredUsersData) : [];

    const foundUser = registeredUsers.find(
      u => u.email.toLowerCase() === email.toLowerCase()
    );

    if (foundUser) {
      if (foundUser.password !== password) {
        return { success: false, error: 'Incorrect password' };
      }

      // Determine role based on email using helper function
      const userIsAdmin = isAdminEmail(email);
      const names = foundUser.name.split(' ');
      const initials = names.map(n => n[0]).join('').toUpperCase().slice(0, 2);

      // Use existing user ID if available, or generate a consistent one based on email
      const userId = foundUser.id || `user-${email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

      // Update registered user with persistent ID if it didn't have one
      if (!foundUser.id) {
        const updatedUsers = registeredUsers.map(u =>
          u.email.toLowerCase() === email.toLowerCase() ? { ...u, id: userId } : u
        );
        await AsyncStorage.setItem('farmstand_registered_users', JSON.stringify(updatedUsers));
      }

      const user: UserProfile = {
        id: userId,
        name: foundUser.name,
        email: foundUser.email,
        initials,
        memberSince: new Date().getFullYear(),
        visitedCount: 0,
        reviewsCount: 0,
        savedCount: 0,
        isFarmer: false,
        role: userIsAdmin ? 'admin' : 'consumer',
      };

      await AsyncStorage.setItem('farmstand_user', JSON.stringify(user));
      await AsyncStorage.setItem('farmstand_logged_in', 'true');
      set({ user, isLoggedIn: true });
      return { success: true };
    }

    // For demo purposes, allow admin email to login with any password
    if (isAdminEmail(email)) {
      const user: UserProfile = {
        id: null, // No hardcoded ID - will be set from Supabase auth when properly signed in
        name: 'Admin',
        email: ADMIN_EMAIL,
        initials: 'AD',
        memberSince: 2024,
        visitedCount: 0,
        reviewsCount: 0,
        savedCount: 0,
        isFarmer: false,
        role: 'admin',
      };

      await AsyncStorage.setItem('farmstand_user', JSON.stringify(user));
      await AsyncStorage.setItem('farmstand_logged_in', 'true');
      set({ user, isLoggedIn: true });
      return { success: true };
    }

    return { success: false, error: 'No account found with this email' };
  },

  signUp: async (name: string, email: string, password: string) => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if user already exists
    const registeredUsersData = await AsyncStorage.getItem('farmstand_registered_users');
    const registeredUsers: Array<{ email: string; password: string; name: string; id?: string }> =
      registeredUsersData ? JSON.parse(registeredUsersData) : [];

    const existingUser = registeredUsers.find(
      u => u.email.toLowerCase() === email.toLowerCase()
    );

    if (existingUser) {
      return { success: false, error: 'An account with this email already exists' };
    }

    // Generate a consistent user ID based on email
    const userId = `user-${email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    // Register new user with persistent ID
    registeredUsers.push({ email, password, name, id: userId });
    await AsyncStorage.setItem('farmstand_registered_users', JSON.stringify(registeredUsers));

    // Determine role based on email using helper function
    const userIsAdmin = isAdminEmail(email);
    const names = name.split(' ');
    const initials = names.map(n => n[0]).join('').toUpperCase().slice(0, 2);

    const user: UserProfile = {
      id: userId,
      name,
      email,
      initials,
      memberSince: new Date().getFullYear(),
      visitedCount: 0,
      reviewsCount: 0,
      savedCount: 0,
      isFarmer: false,
      role: userIsAdmin ? 'admin' : 'consumer',
    };

    await AsyncStorage.setItem('farmstand_user', JSON.stringify(user));
    await AsyncStorage.setItem('farmstand_logged_in', 'true');
    set({ user, isLoggedIn: true });
    return { success: true };
  },

  updateUser: async (updates) => {
    const currentUser = get().user;
    if (!currentUser) return;

    const updatedUser = { ...currentUser, ...updates };
    if (updates.name) {
      const names = updates.name.split(' ');
      updatedUser.initials = names.map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }

    // Save to AsyncStorage (local state)
    await AsyncStorage.setItem('farmstand_user', JSON.stringify(updatedUser));
    set({ user: updatedUser });

    // CRITICAL: If name changed, also update:
    // 1. Supabase Auth user_metadata (so it persists across logout/login)
    // 2. Local registered users list (fallback for non-Supabase users)
    if (updates.name) {
      // Update Supabase Auth metadata if we have an active session
      if (isSupabaseConfigured() && hasActiveSession()) {
        console.log('[UserStore] Updating Supabase user metadata with new name');
        const { error } = await supabaseAuthUpdateUser({ full_name: updates.name });
        if (error) {
          console.log('[UserStore] Failed to update Supabase metadata:', error.message);
          // Don't fail the update - local storage is already updated
        } else {
          console.log('[UserStore] Supabase user metadata updated successfully');
        }
      }

      // Update local registered users list (for non-Supabase fallback)
      try {
        const registeredUsersData = await AsyncStorage.getItem('farmstand_registered_users');
        if (registeredUsersData) {
          const registeredUsers: Array<{ email: string; password: string; name: string; id?: string }> =
            JSON.parse(registeredUsersData);

          const updatedUsers = registeredUsers.map(u =>
            u.email.toLowerCase() === currentUser.email.toLowerCase()
              ? { ...u, name: updates.name! }
              : u
          );

          await AsyncStorage.setItem('farmstand_registered_users', JSON.stringify(updatedUsers));
          console.log('[UserStore] Updated registered users list with new name');
        }
      } catch (e) {
        console.log('[UserStore] Failed to update registered users list:', e);
      }
    }
  },

  updateNotifications: async (settings) => {
    const current = get().notifications;
    const updated = { ...current, ...settings };
    await AsyncStorage.setItem('farmstand_notifications', JSON.stringify(updated));
    set({ notifications: updated });
  },

  updateLocation: async (location) => {
    const current = get().location;
    const updated = { ...current, ...location };
    await AsyncStorage.setItem('farmstand_location', JSON.stringify(updated));
    set({ location: updated });
  },

  addVisitedFarm: async (farmId) => {
    const current = get().visitedFarms;
    if (current.includes(farmId)) return;

    const updated = [...current, farmId];
    await AsyncStorage.setItem('farmstand_visited', JSON.stringify(updated));

    const user = get().user;
    if (user) {
      const updatedUser = { ...user, visitedCount: updated.length };
      await AsyncStorage.setItem('farmstand_user', JSON.stringify(updatedUser));
      set({ visitedFarms: updated, user: updatedUser });
    } else {
      set({ visitedFarms: updated });
    }
  },

  addReview: async (farmId, rating, text) => {
    const current = get().reviews;
    const newReview = { farmId, rating, text, date: new Date().toISOString() };
    const updated = [...current, newReview];
    await AsyncStorage.setItem('farmstand_reviews', JSON.stringify(updated));

    const user = get().user;
    if (user) {
      const updatedUser = { ...user, reviewsCount: updated.length };
      await AsyncStorage.setItem('farmstand_user', JSON.stringify(updatedUser));
      set({ reviews: updated, user: updatedUser });
    } else {
      set({ reviews: updated });
    }
  },

  setFarmerStatus: async (isFarmer, farmId) => {
    const user = get().user;
    if (!user) return;

    const updatedUser = { ...user, isFarmer, farmId };
    await AsyncStorage.setItem('farmstand_user', JSON.stringify(updatedUser));
    set({ user: updatedUser });
  },

  continueAsGuest: async () => {
    const guestUser: UserProfile = {
      id: 'guest',
      name: 'Guest',
      email: '',
      initials: 'G',
      memberSince: new Date().getFullYear(),
      visitedCount: 0,
      reviewsCount: 0,
      savedCount: 0,
      isFarmer: false,
      role: 'consumer',
    };

    await AsyncStorage.setItem('farmstand_user', JSON.stringify(guestUser));
    await AsyncStorage.setItem('farmstand_logged_in', 'true');
    set({ user: guestUser, isLoggedIn: true });
  },

  signOut: async () => {
    const userId = get().user?.id;
    await AsyncStorage.removeItem('farmstand_logged_in');
    // Clear the per-user farmstand card cache so the next user never sees stale cards.
    if (userId) {
      await AsyncStorage.removeItem(`profile_my_farmstand_v1:${userId}`);
    }
    await supabaseSignOut(); // Clears in-memory session + SecureStore
    // Immediately notify AuthProvider so it re-syncs to null session
    // without waiting for the 1-second polling interval.
    notifyAuthSessionChanged();
    // Clear bootstrap store so no stale farmstand data flashes after logout.
    // Use require() to avoid circular import (bootstrap-store imports user-store).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useBootstrapStore } = require('./bootstrap-store') as { useBootstrapStore: { getState: () => { reset: () => void } } };
    useBootstrapStore.getState().reset();
    set({
      user: null,
      isLoggedIn: false,
      visitedFarms: [],
      reviews: [],
    });
  },
}));
