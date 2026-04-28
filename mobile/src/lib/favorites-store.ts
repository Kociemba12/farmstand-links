import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured, loadSessionFromStorage, getValidSession } from './supabase';
import { useUserStore } from './user-store';

type OnSaveCallback = (farmstandId: string, isSaving: boolean) => void;

const isUuid = (v?: string | null): boolean =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';

const log = (...args: unknown[]) => console.log('[FAVORITES]', ...args);

interface FavoritesState {
  favorites: Set<string>;
  isLoaded: boolean;
  version: number;
  inFlight: Set<string>;
  onSaveCallback: OnSaveCallback | null;
  toggleFavorite: (id: string) => Promise<void>;
  isFavorite: (id: string) => boolean;
  isToggling: (id: string) => boolean;
  loadFavorites: () => Promise<void>;
  setOnSaveCallback: (callback: OnSaveCallback | null) => void;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: new Set<string>(),
  inFlight: new Set<string>(),
  isLoaded: false,
  version: 0,
  onSaveCallback: null,

  toggleFavorite: async (id: string) => {
    const { favorites, inFlight, onSaveCallback } = get();

    log('PRESS', { farmstandId: id, currentlySaved: favorites.has(id), timestamp: Date.now() });

    if (inFlight.has(id)) {
      log('PRESS_IGNORED', { farmstandId: id, reason: 'already in flight', timestamp: Date.now() });
      return;
    }

    const wasAlreadySaved = favorites.has(id);
    const isSaving = !wasAlreadySaved;

    // Increment version BEFORE any async work
    const v = get().version + 1;
    const newInFlight = new Set(get().inFlight);
    newInFlight.add(id);
    set({ version: v, inFlight: newInFlight });

    // Optimistic update
    const optimisticFavorites = new Set(get().favorites);
    if (wasAlreadySaved) {
      optimisticFavorites.delete(id);
    } else {
      optimisticFavorites.add(id);
    }
    log('STORE_WRITE', { source: 'optimistic', favorites: Array.from(optimisticFavorites), version: v, timestamp: Date.now() });
    set({ favorites: optimisticFavorites });

    const user = useUserStore.getState().user;
    const userId = user?.id;

    if (isUuid(userId) && isSupabaseConfigured()) {
      await loadSessionFromStorage();
      const session = await getValidSession();

      if (!session?.access_token) {
        log('STORE_WRITE', { source: 'revert_no_session', favorites: Array.from(favorites), version: v, timestamp: Date.now() });
        const ri = new Set(get().inFlight); ri.delete(id);
        set({ favorites: new Set(favorites), inFlight: ri });
        return;
      }

      const requestId = Math.random().toString(36).slice(2);
      log('REQUEST_START', {
        requestId,
        farmstandId: id,
        action: wasAlreadySaved ? 'unsave' : 'save',
        currentFavorites: Array.from(get().favorites),
        version: v,
        timestamp: Date.now(),
      });

      try {
        const resp = await fetch(`${backendUrl}/api/favorites/toggle`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ farmstand_id: id, action: wasAlreadySaved ? 'unsave' : 'save' }),
        });

        const fct = resp.headers.get('content-type') ?? '';
        if (!fct.includes('application/json')) {
          console.log('[FAVORITES] Non-JSON response from favorites/toggle (HTTP', resp.status, '), content-type:', fct);
          const ri = new Set(get().inFlight); ri.delete(id);
          set({ favorites: new Set(favorites), inFlight: ri });
          return;
        }
        const result = (await resp.json()) as { success: boolean; favorites: string[]; error?: string };
        const returnedIds = result.favorites ?? [];

        const fi = new Set(get().inFlight); fi.delete(id);
        const currentVersion = get().version;

        if (!result.success) {
          log('REQUEST_ERROR', { requestId, farmstandId: id, error: result.error ?? 'unknown', responseVersion: v, currentVersion, timestamp: Date.now() });
          if (currentVersion === v) {
            log('STORE_WRITE', { source: 'revert_backend_fail', favorites: Array.from(favorites), version: v, timestamp: Date.now() });
            set({ favorites: new Set(favorites), inFlight: fi });
          } else {
            set({ inFlight: fi });
          }
          return;
        }

        log('REQUEST_SUCCESS', { requestId, farmstandId: id, returnedIds, responseVersion: v, currentVersion, timestamp: Date.now() });

        if (currentVersion === v) {
          const serverFavorites = new Set(returnedIds);
          log('STORE_WRITE', { source: 'toggle', favorites: Array.from(serverFavorites), version: v, timestamp: Date.now() });
          set({ favorites: serverFavorites, isLoaded: true, inFlight: fi });

          if (isSaving && !serverFavorites.has(id)) {
            log('VALIDATION_FAIL', { type: 'SAVE_NOT_IN_RESPONSE', farmstandId: id, returnedIds });
          }
          if (!isSaving && serverFavorites.has(id)) {
            log('VALIDATION_FAIL', { type: 'UNSAVE_STILL_IN_RESPONSE', farmstandId: id, returnedIds });
          }
        } else {
          log('STORE_WRITE_SKIPPED', { reason: 'stale_response', responseVersion: v, currentVersion, farmstandId: id, timestamp: Date.now() });
          set({ inFlight: fi });
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        log('REQUEST_ERROR', { requestId, farmstandId: id, error: errMsg, timestamp: Date.now() });
        const ri = new Set(get().inFlight); ri.delete(id);
        if (get().version === v) {
          log('STORE_WRITE', { source: 'revert_exception', favorites: Array.from(favorites), version: v, timestamp: Date.now() });
          set({ favorites: new Set(favorites), inFlight: ri });
        } else {
          set({ inFlight: ri });
        }
      }

      // Fire-and-forget save count refresh — outside the try/catch so it
      // CANNOT trigger the revert handler if it throws.
      try {
        const { useExploreStore } = await import('./explore-store');
        useExploreStore.getState().loadSaveCounts();
      } catch (countErr) {
        log('LOAD_SAVE_COUNTS_ERROR', { error: String(countErr) });
      }
    } else {
      log('UNAUTHENTICATED', { farmstandId: id, timestamp: Date.now() });
      const gi = new Set(get().inFlight); gi.delete(id);
      set({ inFlight: gi });
      AsyncStorage.setItem('farmstand-favorites', JSON.stringify([...optimisticFavorites]));
    }

    if (isSaving && onSaveCallback) {
      onSaveCallback(id, isSaving);
    }
  },

  isFavorite: (id: string) => get().favorites.has(id),

  isToggling: (id: string) => get().inFlight.has(id),

  loadFavorites: async () => {
    const user = useUserStore.getState().user;
    const userId = user?.id;

    if (isUuid(userId) && isSupabaseConfigured()) {
      const v = get().version;
      log('LOAD_START', { capturedVersion: v, userId, timestamp: Date.now() });

      try {
        const { data, error } = await supabase
          .from<{ farmstand_id: string }>('saved_farmstands')
          .select('farmstand_id')
          .eq('user_id', userId!)
          .execute();

        if (error) {
          log('LOAD_END', { error: error.message, timestamp: Date.now() });
          set({ isLoaded: true });
          return;
        }

        const ids = (data ?? []).map((row) => row.farmstand_id);
        const currentVersion = get().version;
        log('LOAD_END', { favorites: ids, capturedVersion: v, currentVersion, willApply: currentVersion === v, timestamp: Date.now() });

        if (currentVersion === v) {
          log('STORE_WRITE', { source: 'loadFavorites', favorites: ids, version: v, timestamp: Date.now() });
          set({ favorites: new Set(ids), isLoaded: true });
        } else {
          log('STORE_WRITE_SKIPPED', { reason: 'version_advanced_during_load', capturedVersion: v, currentVersion, timestamp: Date.now() });
          set({ isLoaded: true });
        }
      } catch (e) {
        log('LOAD_EXCEPTION', { error: String(e), timestamp: Date.now() });
        set({ isLoaded: true });
      }
      return;
    }

    // Guest: AsyncStorage
    log('LOAD_START', { source: 'AsyncStorage', timestamp: Date.now() });
    try {
      const stored = await AsyncStorage.getItem('farmstand-favorites');
      const parsed = stored ? (JSON.parse(stored) as string[]) : [];
      log('LOAD_END', { favorites: parsed, source: 'AsyncStorage', timestamp: Date.now() });
      if (stored) {
        log('STORE_WRITE', { source: 'loadFavorites', favorites: parsed, timestamp: Date.now() });
        set({ favorites: new Set(parsed), isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setOnSaveCallback: (callback) => {
    set({ onSaveCallback: callback });
  },
}));
