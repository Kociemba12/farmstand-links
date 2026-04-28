import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Farmstand } from './farmer-store';
import {
  getTrendingCategoriesWithCounts,
  filterFarmstandsByCategory,
  CATEGORY_LABELS,
  CATEGORY_IMAGES,
  CATEGORY_FILTER_KEYWORDS,
} from './category-filter';
import { supabase, isSupabaseConfigured } from './supabase';

// Activity event for tracking trending
export interface ActivityEvent {
  id: string;
  farmstand_id: string;
  event_type: 'view' | 'save' | 'click' | 'direction';
  timestamp: string;
  user_id: string | null;
}

// Category activity for trending categories
export interface CategoryActivity {
  category: string;
  label: string;
  image: string;
  count: number;
}

// Trending score for a farmstand
export interface TrendingScore {
  farmstand_id: string;
  score: number;
  views: number;
  saves: number;
  clicks: number;
  is_new: boolean;
}

interface ExploreState {
  activityEvents: ActivityEvent[];
  trendingScores: { [farmstand_id: string]: TrendingScore };
  // Direct aggregate counts from saved_farmstands table — source of truth for MostSaved row
  saveCounts: Record<string, number>;
  isLoading: boolean;
  lastRefreshed: string | null;
  userLocation: { latitude: number; longitude: number } | null;

  // Actions
  loadExploreData: () => Promise<void>;
  loadSaveCounts: () => Promise<void>;
  logActivity: (
    farmstand_id: string,
    event_type: 'view' | 'save' | 'click' | 'direction',
    user_id: string | null
  ) => Promise<void>;
  setUserLocation: (location: { latitude: number; longitude: number } | null) => void;

  // Computed getters
  getTrendingCategories: (farmstands: Farmstand[], limit?: number) => CategoryActivity[];
  getTrendingFarmstands: (farmstands: Farmstand[], limit?: number) => Farmstand[];
  getNewThisWeek: (farmstands: Farmstand[], limit?: number) => Farmstand[];
  getMostSaved: (farmstands: Farmstand[], userLocation: { latitude: number; longitude: number } | null, limit?: number) => Farmstand[];
  getOpenNow: (farmstands: Farmstand[], limit?: number) => Farmstand[];
  getFarmstandsByCategory: (farmstands: Farmstand[], category: string, limit?: number) => Farmstand[];
  getTopSpots: (farmstands: Farmstand[], limit?: number) => Farmstand[];
  calculateDistance: (lat1: number, lon1: number, lat2: number, lon2: number) => number;
}

// Constants for trending calculation
const ROLLING_WINDOW_DAYS = 7;
const VIEW_WEIGHT = 1;
const SAVE_WEIGHT = 5;
const CLICK_WEIGHT = 2;
const DIRECTION_WEIGHT = 3;
const NEW_LISTING_BOOST = 1.5;

// Category definitions with images - now imported from category-filter.ts
// Kept here for backward compatibility but deprecated
const CATEGORY_DEFINITIONS: { [key: string]: { label: string; image: string; keywords: string[] } } = {
  eggs: {
    label: CATEGORY_LABELS.eggs ?? 'Fresh Eggs',
    image: CATEGORY_IMAGES.eggs ?? 'https://images.unsplash.com/photo-1518569656558-1f25e69d93d7?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.eggs ?? ['eggs', 'egg', 'farm fresh eggs'],
  },
  produce: {
    label: CATEGORY_LABELS.produce ?? 'Produce',
    image: CATEGORY_IMAGES.produce ?? 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.produce ?? ['produce', 'vegetables', 'tomatoes', 'greens', 'lettuce', 'peppers', 'corn'],
  },
  baked_goods: {
    label: CATEGORY_LABELS.baked_goods ?? 'Sourdough & Baked Goods',
    image: CATEGORY_IMAGES.baked_goods ?? 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.baked_goods ?? ['bread', 'baked', 'bakery', 'sourdough', 'pastries', 'pie', 'pies', 'cookies', 'donuts'],
  },
  upick: {
    label: CATEGORY_LABELS.upick ?? 'U-Pick',
    image: CATEGORY_IMAGES.upick ?? 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.upick ?? ['u-pick', 'upick', 'pick your own'],
  },
  pumpkins: {
    label: CATEGORY_LABELS.pumpkins ?? 'Pumpkin Stands',
    image: CATEGORY_IMAGES.pumpkins ?? 'https://images.unsplash.com/photo-1509622905150-fa66d3906e09?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.pumpkins ?? ['pumpkin', 'pumpkins', 'gourds', 'fall'],
  },
  meat: {
    label: CATEGORY_LABELS.meat ?? 'Farm Fresh Meat',
    image: CATEGORY_IMAGES.meat ?? 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.meat ?? ['meat', 'beef', 'lamb', 'pork', 'chicken', 'grass-fed'],
  },
  berries: {
    label: CATEGORY_LABELS.berries ?? 'Berries',
    image: CATEGORY_IMAGES.berries ?? 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.berries ?? ['berries', 'strawberries', 'blueberries', 'raspberries', 'marionberries', 'blackberries'],
  },
  honey: {
    label: CATEGORY_LABELS.honey ?? 'Honey',
    image: CATEGORY_IMAGES.honey ?? 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.honey ?? ['honey', 'bee', 'bees'],
  },
  flowers: {
    label: CATEGORY_LABELS.flowers ?? 'Flowers',
    image: CATEGORY_IMAGES.flowers ?? 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.flowers ?? ['flowers', 'flower', 'tulips', 'sunflowers', 'lavender'],
  },
  dairy: {
    label: CATEGORY_LABELS.dairy ?? 'Dairy',
    image: CATEGORY_IMAGES.dairy ?? 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.dairy ?? ['milk', 'cheese', 'dairy', 'yogurt', 'butter'],
  },
  seasonal: {
    label: CATEGORY_LABELS.seasonal ?? 'Seasonal Produce',
    image: CATEGORY_IMAGES.seasonal ?? 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=800',
    keywords: CATEGORY_FILTER_KEYWORDS.seasonal ?? ['seasonal', 'apple', 'apples', 'peach', 'peaches', 'cherry', 'cherries', 'pear', 'pears'],
  },
};

// Helper to get days ago
const getDaysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

// Generate initial demo activity data
const generateDemoActivityData = (farmstands: Farmstand[]): ActivityEvent[] => {
  const events: ActivityEvent[] = [];

  // Generate random activity for each farmstand
  farmstands.forEach((farmstand) => {
    const baseActivity = Math.floor(Math.random() * 30) + 5;

    for (let i = 0; i < baseActivity; i++) {
      const daysAgo = Math.floor(Math.random() * 7);
      const timestamp = new Date(getDaysAgo(daysAgo).getTime() + Math.random() * 24 * 60 * 60 * 1000);

      const eventTypes: ('view' | 'save' | 'click' | 'direction')[] = ['view', 'view', 'view', 'click', 'save', 'direction'];
      const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

      events.push({
        id: `evt-${farmstand.id}-${i}`,
        farmstand_id: farmstand.id,
        event_type: eventType,
        timestamp: timestamp.toISOString(),
        user_id: Math.random() > 0.3 ? `user-${Math.floor(Math.random() * 100)}` : null,
      });
    }
  });

  return events;
};

export const useExploreStore = create<ExploreState>((set, get) => ({
  activityEvents: [],
  trendingScores: {},
  saveCounts: {},
  isLoading: false,
  lastRefreshed: null,
  userLocation: null,

  loadSaveCounts: async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const { data, error } = await supabase
        .from<{ farmstand_id: string }>('saved_farmstands')
        .select('farmstand_id');

      if (error || !data) {
        console.warn('[MostSaved] loadSaveCounts error:', error?.message);
        return;
      }

      // Aggregate: count saves per farmstand_id
      const counts: Record<string, number> = {};
      for (const row of data) {
        counts[row.farmstand_id] = (counts[row.farmstand_id] ?? 0) + 1;
      }

      console.log('[MostSaved] loadSaveCounts: found', Object.keys(counts).length,
        'farmstands with saves:', Object.entries(counts).map(([id, count]) => ({ id, count }))
      );
      set({ saveCounts: counts });
    } catch (e) {
      console.warn('[MostSaved] loadSaveCounts exception:', e);
    }
  },

  loadExploreData: async () => {
    set({ isLoading: true });
    try {
      const storedEvents = await AsyncStorage.getItem('explore_activity_events');
      const storedScores = await AsyncStorage.getItem('explore_trending_scores');
      const storedRefresh = await AsyncStorage.getItem('explore_last_refreshed');

      if (storedEvents && storedScores) {
        set({
          activityEvents: JSON.parse(storedEvents),
          trendingScores: JSON.parse(storedScores),
          lastRefreshed: storedRefresh,
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('Error loading explore data:', error);
      set({ isLoading: false });
    }
  },

  logActivity: async (farmstand_id, event_type, user_id) => {
    const newEvent: ActivityEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      farmstand_id,
      event_type,
      timestamp: new Date().toISOString(),
      user_id,
    };

    const state = get();
    const events = [...state.activityEvents, newEvent];

    // Update trending score
    const cutoff = getDaysAgo(ROLLING_WINDOW_DAYS).toISOString();
    const recentEvents = events.filter(
      (e) => e.farmstand_id === farmstand_id && e.timestamp >= cutoff
    );

    const views = recentEvents.filter((e) => e.event_type === 'view').length;
    const saves = recentEvents.filter((e) => e.event_type === 'save').length;
    const clicks = recentEvents.filter((e) => e.event_type === 'click').length;
    const directions = recentEvents.filter((e) => e.event_type === 'direction').length;

    const score =
      views * VIEW_WEIGHT +
      saves * SAVE_WEIGHT +
      clicks * CLICK_WEIGHT +
      directions * DIRECTION_WEIGHT;

    const trendingScores = {
      ...state.trendingScores,
      [farmstand_id]: {
        farmstand_id,
        score,
        views,
        saves,
        clicks,
        is_new: false,
      },
    };

    await AsyncStorage.setItem('explore_activity_events', JSON.stringify(events));
    await AsyncStorage.setItem('explore_trending_scores', JSON.stringify(trendingScores));

    set({ activityEvents: events, trendingScores });
  },

  setUserLocation: (location) => {
    set({ userLocation: location });
  },

  calculateDistance: (lat1, lon1, lat2, lon2) => {
    const R = 3959; // Earth's radius in miles
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  getTrendingCategories: (farmstands, limit = 8) => {
    // Use the unified category filter for accurate counts
    return getTrendingCategoriesWithCounts(farmstands, limit);
  },

  getTrendingFarmstands: (farmstands, limit = 10) => {
    const state = get();
    const cutoff = getDaysAgo(ROLLING_WINDOW_DAYS).toISOString();

    // Calculate scores for all farmstands
    const scoredFarmstands = farmstands.map((farmstand) => {
      const recentEvents = state.activityEvents.filter(
        (e) => e.farmstand_id === farmstand.id && e.timestamp >= cutoff
      );

      const views = recentEvents.filter((e) => e.event_type === 'view').length;
      const saves = recentEvents.filter((e) => e.event_type === 'save').length;
      const clicks = recentEvents.filter((e) => e.event_type === 'click').length;
      const directions = recentEvents.filter((e) => e.event_type === 'direction').length;

      let score =
        views * VIEW_WEIGHT +
        saves * SAVE_WEIGHT +
        clicks * CLICK_WEIGHT +
        directions * DIRECTION_WEIGHT;

      // Boost new listings
      const createdDate = new Date(farmstand.createdAt);
      const isNew = createdDate >= getDaysAgo(7);
      if (isNew) {
        score *= NEW_LISTING_BOOST;
      }

      // Add some base score randomization for variety
      score += Math.random() * 5;

      return { farmstand, score };
    });

    // Sort by score and return top farmstands
    return scoredFarmstands
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.farmstand);
  },

  getNewThisWeek: (farmstands, limit = 10) => {
    const oneWeekAgo = getDaysAgo(7);

    return farmstands
      .filter((f) => new Date(f.createdAt) >= oneWeekAgo)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  },

  getMostSaved: (farmstands, userLocation, limit = 10) => {
    const MAX_MILES = 25;
    const { calculateDistance, saveCounts } = get();

    if (!userLocation) {
      console.log('[MostSaved] No anchorLocation — section hidden');
      return [];
    }

    // Effective save count: direct aggregate from saved_farmstands (most accurate),
    // falling back to the saved_count column on the farmstand row.
    const effectiveCount = (f: Farmstand) =>
      saveCounts[f.id] ?? f.saved_count ?? 0;

    // Debug: show all active farmstands with at least 1 effective save
    const withSaves = farmstands.filter((f) => effectiveCount(f) > 0);
    console.log('[MostSaved] Active farmstands with saves > 0:', withSaves.length,
      withSaves.map((f) => ({ id: f.id, name: f.name, saved_count: effectiveCount(f), operatingStatus: f.operatingStatus }))
    );

    const candidates = farmstands.filter((f) => {
      // Must have valid coordinates
      if (f.latitude == null || f.longitude == null) return false;

      // Only exclude permanently closed stands
      if (f.operatingStatus === 'permanently_closed') return false;

      // Must have at least 1 real save
      if (effectiveCount(f) <= 0) return false;

      // Hard 25-mile cap
      const miles = calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        f.latitude,
        f.longitude
      );
      if (miles > MAX_MILES) return false;

      return true;
    });

    console.log('[MostSaved] Candidates after 25mi + saves filter:', candidates.length,
      candidates.map((f) => ({ id: f.id, name: f.name, saved_count: effectiveCount(f) }))
    );

    const result = candidates
      .sort((a, b) => {
        // 1. effective save count DESC
        const diff = effectiveCount(b) - effectiveCount(a);
        if (diff !== 0) return diff;
        // 2. distance ASC
        const aDist = calculateDistance(userLocation.latitude, userLocation.longitude, a.latitude ?? 0, a.longitude ?? 0);
        const bDist = calculateDistance(userLocation.latitude, userLocation.longitude, b.latitude ?? 0, b.longitude ?? 0);
        if (aDist !== bDist) return aDist - bDist;
        // 3. stable name tie-breaker
        return (a.name ?? '').localeCompare(b.name ?? '');
      })
      .slice(0, limit);

    console.log('[MostSaved] Final rows:', result.length,
      result.map((f) => ({ id: f.id, name: f.name, saved_count: effectiveCount(f) }))
    );
    return result;
  },

  getOpenNow: (farmstands, limit = 10) => {
    const now = new Date();
    const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()] as
      | 'mon'
      | 'tue'
      | 'wed'
      | 'thu'
      | 'fri'
      | 'sat'
      | 'sun';
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    return farmstands
      .filter((farmstand) => {
        // operating_status is the primary gate — must be 'open' to appear here.
        // Allow undefined/null for legacy rows that predate the column, but any
        // explicit non-open value (temporarily_closed, seasonal, permanently_closed)
        // is an immediate disqualifier regardless of hours.
        const opStatus = (farmstand as any).operatingStatus;
        if (opStatus && opStatus !== 'open') return false;

        if (!farmstand.hours) return farmstand.isActive;

        const todayHours = farmstand.hours[dayOfWeek];
        if (todayHours.closed || !todayHours.open || !todayHours.close) return false;

        const [openHour, openMin] = todayHours.open.split(':').map(Number);
        const [closeHour, closeMin] = todayHours.close.split(':').map(Number);
        const openMinutes = openHour * 60 + openMin;
        const closeMinutes = closeHour * 60 + closeMin;

        return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
      })
      .slice(0, limit);
  },

  getFarmstandsByCategory: (farmstands, category, limit = 10) => {
    // Use the unified category filter
    return filterFarmstandsByCategory(farmstands, category).slice(0, limit);
  },

  getTopSpots: (farmstands, limit = 10) => {
    const state = get();

    // If we have user location, sort by distance
    if (state.userLocation) {
      return farmstands
        .map((f) => ({
          farmstand: f,
          distance: state.calculateDistance(
            state.userLocation!.latitude,
            state.userLocation!.longitude,
            f.latitude ?? 0,
            f.longitude ?? 0
          ),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((item) => item.farmstand);
    }

    // Otherwise return random top spots
    return [...farmstands].sort(() => Math.random() - 0.5).slice(0, limit);
  },
}));

// Export category definitions for use in components
export { CATEGORY_DEFINITIONS };
