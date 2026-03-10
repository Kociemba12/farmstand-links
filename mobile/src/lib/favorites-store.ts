import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Callback type for popularity tracking
type OnSaveCallback = (farmstandId: string, isSaving: boolean) => void;

interface FavoritesState {
  favorites: Set<string>;
  isLoaded: boolean;
  onSaveCallback: OnSaveCallback | null;
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  loadFavorites: () => Promise<void>;
  setOnSaveCallback: (callback: OnSaveCallback | null) => void;
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: new Set<string>(),
  isLoaded: false,
  onSaveCallback: null,

  toggleFavorite: (id: string) => {
    const { favorites, onSaveCallback } = get();
    const newFavorites = new Set(favorites);
    const isSaving = !newFavorites.has(id);

    if (newFavorites.has(id)) {
      newFavorites.delete(id);
    } else {
      newFavorites.add(id);
    }

    set({ favorites: newFavorites });

    // Persist to AsyncStorage
    AsyncStorage.setItem('farmstand-favorites', JSON.stringify([...newFavorites]));

    // Call callback for popularity tracking (only when saving, not unsaving)
    if (isSaving && onSaveCallback) {
      onSaveCallback(id, isSaving);
    }
  },

  isFavorite: (id: string) => {
    return get().favorites.has(id);
  },

  loadFavorites: async () => {
    try {
      const stored = await AsyncStorage.getItem('farmstand-favorites');
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
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
