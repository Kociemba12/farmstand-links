import { create } from 'zustand';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { useUserStore } from './user-store';

type OnSaveCallback = (farmstandId: string, isSaving: boolean) => void;

const isUuid = (v?: string | null): boolean =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const log = (...args: unknown[]) => { if (__DEV__) console.log('[FAVORITES]', ...args); };

type ToggleFavoriteRpcResult = {
  success: boolean;
  is_saved?: boolean;
  favorites?: string[];
  // Failure fields — all three present on every error path
  error?: string;
  code?: string;
  details?: string;
};

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

    // Optimistic update — applied immediately so UI is instant
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

    log('ATTEMPT', {
      userId: userId ?? '(no user)',
      farmstandId: id,
      action: isSaving ? 'save' : 'unsave',
      timestamp: Date.now(),
    });

    // Guest / unauthenticated: keep optimistic local state, no server call
    if (!isUuid(userId)) {
      log('UNAUTHENTICATED', { farmstandId: id, timestamp: Date.now() });
      const gi = new Set(get().inFlight); gi.delete(id);
      set({ inFlight: gi });
      AsyncStorage.setItem('farmstand-favorites', JSON.stringify([...optimisticFavorites]));
      return;
    }

    if (!isSupabaseConfigured()) {
      log('SUPABASE_NOT_CONFIGURED', { farmstandId: id, timestamp: Date.now() });
      const gi = new Set(get().inFlight); gi.delete(id);
      set({ favorites: new Set(favorites), inFlight: gi });
      return;
    }

    try {
      // Use a SECURITY DEFINER RPC so FK constraint check (which needs SELECT on
      // farmstands) doesn't block the authenticated role — no backend needed.
      const { data: rpcData, error: rpcError } = await supabase.rpc<ToggleFavoriteRpcResult>(
        'toggle_favorite',
        { p_farmstand_id: id }
      );

      const fi = new Set(get().inFlight); fi.delete(id);
      const currentVersion = get().version;

      if (rpcError) {
        const errCode    = (rpcError as { code?: string }).code ?? '(no code)';
        const errDetails = (rpcError as { details?: string }).details ?? '(no details)';
        log('RPC_ERROR', {
          farmstandId: id,
          code:    errCode,
          message: rpcError.message,
          details: errDetails,
          responseVersion: v,
          currentVersion,
          timestamp: Date.now(),
        });
        if (__DEV__) {
          Alert.alert(
            '[DEV] Favorites HTTP error',
            `error:   ${rpcError.message}\ncode:    ${errCode}\ndetails: ${errDetails}`
          );
        }
        if (currentVersion === v) {
          log('STORE_WRITE', { source: 'revert_rpc_error', favorites: Array.from(favorites), version: v, timestamp: Date.now() });
          set({ favorites: new Set(favorites), inFlight: fi });
        } else {
          set({ inFlight: fi });
        }
        return;
      }

      // rpcData is the JSON object returned by the function.
      // Cast carefully — it may be null (empty 204 body) or a mis-shaped object.
      const result = rpcData as ToggleFavoriteRpcResult | null;

      if (!result?.success) {
        const errMsg     = result?.error   ?? '(no error field)';
        const errCode    = result?.code    ?? '(no code)';
        const errDetails = result?.details ?? '(no details)';
        const rawJson    = JSON.stringify(rpcData);
        log('RPC_FAIL', {
          farmstandId: id,
          error:   errMsg,
          code:    errCode,
          details: errDetails,
          raw:     rawJson,
          responseVersion: v,
          currentVersion,
          timestamp: Date.now(),
        });
        if (__DEV__) {
          Alert.alert(
            '[DEV] Favorites RPC returned success=false',
            `error:   ${errMsg}\ncode:    ${errCode}\ndetails: ${errDetails}\n\nraw: ${rawJson}`
          );
        }
        if (currentVersion === v) {
          log('STORE_WRITE', { source: 'revert_rpc_fail', favorites: Array.from(favorites), version: v, timestamp: Date.now() });
          set({ favorites: new Set(favorites), inFlight: fi });
        } else {
          set({ inFlight: fi });
        }
        return;
      }

      const returnedIds: string[] = Array.isArray(result.favorites) ? result.favorites : [];
      log('RPC_SUCCESS', {
        farmstandId: id,
        action: isSaving ? 'save' : 'unsave',
        isSaved: result.is_saved,
        returnedIds,
        responseVersion: v,
        currentVersion,
        timestamp: Date.now(),
      });

      if (isSaving && !returnedIds.includes(id)) {
        log('VALIDATION_FAIL', { type: 'SAVE_NOT_IN_RESPONSE', farmstandId: id, returnedIds });
      }
      if (!isSaving && returnedIds.includes(id)) {
        log('VALIDATION_FAIL', { type: 'UNSAVE_STILL_IN_RESPONSE', farmstandId: id, returnedIds });
      }

      if (currentVersion === v) {
        const serverFavorites = new Set(returnedIds);
        log('STORE_WRITE', { source: 'rpc_success', favorites: Array.from(serverFavorites), version: v, timestamp: Date.now() });
        set({ favorites: serverFavorites, isLoaded: true, inFlight: fi });
      } else {
        log('STORE_WRITE_SKIPPED', { reason: 'stale_response', responseVersion: v, currentVersion, farmstandId: id, timestamp: Date.now() });
        set({ inFlight: fi });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log('EXCEPTION', { farmstandId: id, error: errMsg, timestamp: Date.now() });
      if (__DEV__ && errMsg.includes('AUTH_REQUIRED')) {
        Alert.alert('[DEV] Favorites: No valid session', 'Session expired or missing. User must sign in again.');
      }
      const ri = new Set(get().inFlight); ri.delete(id);
      if (get().version === v) {
        log('STORE_WRITE', { source: 'revert_exception', favorites: Array.from(favorites), version: v, timestamp: Date.now() });
        set({ favorites: new Set(favorites), inFlight: ri });
      } else {
        set({ inFlight: ri });
      }
    }

    // Fire-and-forget save count refresh — OUTSIDE try/catch so it cannot trigger revert
    try {
      const { useExploreStore } = await import('./explore-store');
      useExploreStore.getState().loadSaveCounts();
    } catch (countErr) {
      log('LOAD_SAVE_COUNTS_ERROR', { error: String(countErr) });
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
          .requireAuth()
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
