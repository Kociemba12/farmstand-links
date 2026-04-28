import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SortMode = 'relevance' | 'rating' | 'most_viewed' | 'most_saved' | 'recently_active';

export interface MapFiltersState {
  // Sort
  sortBy: SortMode;

  // Rating
  minRating: number | null; // null = Any, 3.5, 4.0, 4.5

  // Price range (product-based)
  minPrice: number | null; // null = no min
  maxPrice: number | null; // null = no max

  // Availability
  openNow: boolean;
  inStockOnly: boolean;

  // Categories
  selectedCategories: string[]; // empty = all

  // Saved
  savedOnly: boolean;

  // Computed
  activeFilterCount: number;

  // Actions
  setSortBy: (sort: SortMode) => void;
  setMinRating: (rating: number | null) => void;
  setMinPrice: (value: number | null) => void;
  setMaxPrice: (value: number | null) => void;
  setOpenNow: (value: boolean) => void;
  setInStockOnly: (value: boolean) => void;
  toggleCategory: (category: string) => void;
  setSavedOnly: (value: boolean) => void;
  reset: () => void;
  loadFilters: () => Promise<void>;
}

const STORAGE_KEY = 'map-filters-v2';

const DEFAULT_STATE = {
  sortBy: 'relevance' as SortMode,
  minRating: null as number | null,
  minPrice: null as number | null,
  maxPrice: null as number | null,
  openNow: false,
  inStockOnly: false,
  selectedCategories: [] as string[],
  savedOnly: false,
};

function computeFilterCount(state: typeof DEFAULT_STATE): number {
  let count = 0;
  if (state.minRating !== null) count++;
  if (state.minPrice !== null || state.maxPrice !== null) count++;
  if (state.openNow) count++;
  if (state.inStockOnly) count++;
  if (state.selectedCategories.length > 0) count++;
  if (state.savedOnly) count++;
  if (state.sortBy !== 'relevance') count++;
  return count;
}

async function persist(state: typeof DEFAULT_STATE): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal
  }
}

export const useMapFiltersStore = create<MapFiltersState>((set, get) => ({
  ...DEFAULT_STATE,
  activeFilterCount: 0,

  setSortBy: (sortBy) => {
    const next = { ...get(), sortBy };
    set({ sortBy, activeFilterCount: computeFilterCount(next) });
    persist(next);
  },

  setMinRating: (minRating) => {
    const next = { ...get(), minRating };
    set({ minRating, activeFilterCount: computeFilterCount(next) });
    persist(next);
  },

  setMinPrice: (minPrice) => {
    const next = { ...get(), minPrice };
    set({ minPrice, activeFilterCount: computeFilterCount(next) });
    persist(next);
  },

  setMaxPrice: (maxPrice) => {
    const next = { ...get(), maxPrice };
    set({ maxPrice, activeFilterCount: computeFilterCount(next) });
    persist(next);
  },

  setOpenNow: (openNow) => {
    const next = { ...get(), openNow };
    set({ openNow, activeFilterCount: computeFilterCount(next) });
    persist(next);
  },

  setInStockOnly: (inStockOnly) => {
    const next = { ...get(), inStockOnly };
    set({ inStockOnly, activeFilterCount: computeFilterCount(next) });
    persist(next);
  },

  toggleCategory: (category) => {
    const current = get().selectedCategories;
    const selectedCategories = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    const next = { ...get(), selectedCategories };
    set({ selectedCategories, activeFilterCount: computeFilterCount(next) });
    persist(next);
  },

  setSavedOnly: (savedOnly) => {
    const next = { ...get(), savedOnly };
    set({ savedOnly, activeFilterCount: computeFilterCount(next) });
    persist(next);
  },

  reset: () => {
    set({ ...DEFAULT_STATE, activeFilterCount: 0 });
    persist(DEFAULT_STATE);
  },

  loadFilters: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<typeof DEFAULT_STATE>;
        const merged = { ...DEFAULT_STATE, ...parsed };
        set({ ...merged, activeFilterCount: computeFilterCount(merged) });
      }
    } catch {
      // Ignore errors — start with defaults
    }
  },
}));
