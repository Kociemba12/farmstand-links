import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Farmstand, PromoStatus } from './farmer-store';

// Constants for popularity calculation
const CLICK_WEIGHT = 1;
const SAVE_WEIGHT = 3;
const MESSAGE_WEIGHT = 4;
const REVIEW_WEIGHT = 5;
const HIGH_RATING_MULTIPLIER = 1.15; // Applied when avgRating >= 4.5

// Max limits for fairness
const MAX_CATEGORIES_PER_FARMSTAND = 3;
const MAX_MANUAL_PROMOS_IN_TOP_10 = 5;
const MAP_PROMO_SLOTS = 5;
const TOP_10_SLOTS = 10;

// Explore categories for promotions
export const EXPLORE_CATEGORIES = [
  { id: 'eggs', name: 'Fresh Eggs', icon: 'egg' },
  { id: 'produce', name: 'Produce', icon: 'carrot' },
  { id: 'baked_goods', name: 'Baked Goods', icon: 'croissant' },
  { id: 'upick', name: 'U-Pick', icon: 'apple' },
  { id: 'pumpkins', name: 'Pumpkins', icon: 'squash' },
  { id: 'meat', name: 'Farm Fresh Meat', icon: 'beef' },
  { id: 'berries', name: 'Berries', icon: 'cherry' },
  { id: 'honey', name: 'Honey', icon: 'droplet' },
  { id: 'flowers', name: 'Flowers', icon: 'flower' },
  { id: 'dairy', name: 'Dairy', icon: 'milk' },
  { id: 'seasonal', name: 'Seasonal', icon: 'leaf' },
  { id: 'best_near_you', name: 'Best Near You', icon: 'map-pin' },
];

// Promotion summary for admin dashboard
export interface PromotionSummary {
  activeCount: number;
  scheduledCount: number;
  expiredCount: number;
  autoFeaturedCount: number;
}

// Helper to check if a promotion is currently active based on schedule
export const isPromotionActive = (farmstand: Farmstand): boolean => {
  if (!farmstand.promoActive) return false;

  const now = new Date();

  // Check start date
  if (farmstand.promoStartAt) {
    const startDate = new Date(farmstand.promoStartAt);
    if (now < startDate) return false;
  }

  // Check end date
  if (farmstand.promoEndAt) {
    const endDate = new Date(farmstand.promoEndAt);
    if (now > endDate) return false;
  }

  return true;
};

// Get the current promo status based on dates
export const getPromoStatus = (farmstand: Farmstand): PromoStatus => {
  if (!farmstand.promoActive) return 'none';

  const now = new Date();

  // Check if scheduled (hasn't started yet)
  if (farmstand.promoStartAt) {
    const startDate = new Date(farmstand.promoStartAt);
    if (now < startDate) return 'scheduled';
  }

  // Check if expired
  if (farmstand.promoEndAt) {
    const endDate = new Date(farmstand.promoEndAt);
    if (now > endDate) return 'expired';
  }

  return 'active';
};

// Calculate popularity score for a farmstand
export const calculatePopularityScore = (farmstand: Farmstand): number => {
  const baseScore =
    (farmstand.clicks30d * CLICK_WEIGHT) +
    (farmstand.saves30d * SAVE_WEIGHT) +
    (farmstand.messages30d * MESSAGE_WEIGHT) +
    (farmstand.reviewCount * REVIEW_WEIGHT);

  // Apply high rating multiplier
  if (farmstand.avgRating >= 4.5) {
    return Math.round(baseScore * HIGH_RATING_MULTIPLIER);
  }

  return baseScore;
};

/**
 * Seeded random number generator for consistent daily rotation
 * Uses a simple but effective hash function
 */
const seededRandom = (seed: number): number => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

/**
 * Generate a stable daily seed from date string and category
 * This ensures the same rotation throughout the day for a given category
 */
const getDailySeed = (category: string): number => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const seedString = `${today}-${category}`;
  let hash = 0;
  for (let i = 0; i < seedString.length; i++) {
    const char = seedString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};

/**
 * Weighted shuffle algorithm that respects both Priority and Rotation Weight
 *
 * How it works:
 * 1. Each item gets a "selection score" = (priority * 10) + (rotationWeight * randomFactor)
 * 2. Higher priority items naturally rank higher
 * 3. Rotation weight affects how much the random factor influences selection
 * 4. Items with higher rotation weight have more variance, appearing more often across rotations
 *
 * @param items - Array of farmstands to shuffle
 * @param seed - Seed for deterministic randomness (changes daily)
 * @param maxItems - Maximum items to return
 */
const weightedRotationSelect = <T extends { id: string; promoPriority: number; promoRotationWeight: number }>(
  items: T[],
  seed: number,
  maxItems: number
): T[] => {
  if (items.length <= maxItems) {
    // If we have fewer items than slots, just sort by priority
    return [...items].sort((a, b) => {
      if (b.promoPriority !== a.promoPriority) {
        return b.promoPriority - a.promoPriority;
      }
      // Stable tie-breaker by ID
      return a.id.localeCompare(b.id);
    });
  }

  // Calculate selection scores for each item
  const scored = items.map((item, index) => {
    // Get a unique random value for this item based on seed + item ID
    let itemSeed = seed;
    for (let i = 0; i < item.id.length; i++) {
      itemSeed += item.id.charCodeAt(i) * (i + 1);
    }
    const randomFactor = seededRandom(itemSeed);

    // Selection score formula:
    // - Base: priority * 100 (so priority 100 = 10000, priority 0 = 0)
    // - Rotation bonus: rotationWeight * randomFactor * 250
    //   (weight 10 can add up to 2500, weight 1 adds up to 250)
    // This means high priority items are more likely to appear,
    // but rotation weight provides variance
    const priorityScore = item.promoPriority * 100;
    const rotationBonus = item.promoRotationWeight * randomFactor * 250;
    const selectionScore = priorityScore + rotationBonus;

    return { item, selectionScore, randomFactor };
  });

  // Sort by selection score (highest first)
  scored.sort((a, b) => {
    if (Math.abs(b.selectionScore - a.selectionScore) > 0.001) {
      return b.selectionScore - a.selectionScore;
    }
    // Final tie-breaker by ID for stability
    return a.item.id.localeCompare(b.item.id);
  });

  // Take top items
  const selected = scored.slice(0, maxItems).map((s) => s.item);

  // Final sort of selected items by priority (so display order respects priority)
  selected.sort((a, b) => {
    if (b.promoPriority !== a.promoPriority) {
      return b.promoPriority - a.promoPriority;
    }
    return a.id.localeCompare(b.id);
  });

  return selected;
};

interface PromotionsState {
  isLoading: boolean;
  lastRotationDate: string | null;
  rotationSeed: number; // For consistent rotation within a session

  // Actions
  loadPromotionsData: () => Promise<void>;

  // Get promotion summary counts
  getPromotionSummary: (farmstands: Farmstand[]) => PromotionSummary;

  // Get farmstands by promotion status
  getActivePromotions: (farmstands: Farmstand[]) => Farmstand[];
  getScheduledPromotions: (farmstands: Farmstand[]) => Farmstand[];
  getExpiredPromotions: (farmstands: Farmstand[]) => Farmstand[];

  // Get auto-featured (top by popularity score)
  getAutoFeatured: (farmstands: Farmstand[], limit?: number) => Farmstand[];

  // Get promoted farmstands for a specific Explore category
  // Returns: Manual promos (up to 5) + Auto-featured (fill to 10) + rest
  getPromotedForCategory: (
    farmstands: Farmstand[],
    category: string,
    limit?: number
  ) => Farmstand[];

  // Get boosted farmstands for Map (within bounds)
  getBoostedForMap: (
    farmstands: Farmstand[],
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null,
    limit?: number
  ) => Farmstand[];

  // Update popularity score for a farmstand (call after interactions)
  updatePopularityScore: (
    farmstand: Farmstand,
    updateFarmstand: (id: string, updates: Partial<Farmstand>) => Promise<void>
  ) => Promise<void>;

  // Increment interaction counters
  incrementClick: (
    farmstand: Farmstand,
    updateFarmstand: (id: string, updates: Partial<Farmstand>) => Promise<void>
  ) => Promise<void>;
  incrementSave: (
    farmstand: Farmstand,
    updateFarmstand: (id: string, updates: Partial<Farmstand>) => Promise<void>
  ) => Promise<void>;
  incrementMessage: (
    farmstand: Farmstand,
    updateFarmstand: (id: string, updates: Partial<Farmstand>) => Promise<void>
  ) => Promise<void>;

  // Refresh rotation seed (call daily or on app refresh)
  refreshRotation: () => void;
}

export const usePromotionsStore = create<PromotionsState>((set, get) => ({
  isLoading: false,
  lastRotationDate: null,
  rotationSeed: Date.now(),

  loadPromotionsData: async () => {
    set({ isLoading: true });
    try {
      const storedRotationDate = await AsyncStorage.getItem('promo_last_rotation_date');
      const storedSeed = await AsyncStorage.getItem('promo_rotation_seed');
      const today = new Date().toDateString();

      // If it's a new day, update rotation seed
      if (storedRotationDate !== today) {
        const newSeed = Date.now();
        await AsyncStorage.setItem('promo_last_rotation_date', today);
        await AsyncStorage.setItem('promo_rotation_seed', String(newSeed));
        set({
          lastRotationDate: today,
          rotationSeed: newSeed,
          isLoading: false
        });
      } else {
        // Use stored seed to maintain consistency throughout the day
        const seed = storedSeed ? parseInt(storedSeed, 10) : Date.now();
        set({
          lastRotationDate: storedRotationDate,
          rotationSeed: seed,
          isLoading: false
        });
      }
    } catch (error) {
      console.error('Error loading promotions data:', error);
      set({ isLoading: false });
    }
  },

  getPromotionSummary: (farmstands) => {
    let activeCount = 0;
    let scheduledCount = 0;
    let expiredCount = 0;

    farmstands.forEach((f) => {
      if (f.promoActive) {
        const status = getPromoStatus(f);
        if (status === 'active') activeCount++;
        else if (status === 'scheduled') scheduledCount++;
        else if (status === 'expired') expiredCount++;
      }
    });

    // Count auto-featured (top by popularity, not manually promoted)
    const autoFeaturedCount = farmstands
      .filter((f) => f.status === 'active' && !f.promoActive && f.popularityScore > 0)
      .length;

    return {
      activeCount,
      scheduledCount,
      expiredCount,
      autoFeaturedCount: Math.min(autoFeaturedCount, 20)
    };
  },

  getActivePromotions: (farmstands) => {
    return farmstands
      .filter((f) => f.promoActive && getPromoStatus(f) === 'active')
      .sort((a, b) => {
        // Sort by priority first
        if (b.promoPriority !== a.promoPriority) {
          return b.promoPriority - a.promoPriority;
        }
        // Then by rotation weight
        if (b.promoRotationWeight !== a.promoRotationWeight) {
          return b.promoRotationWeight - a.promoRotationWeight;
        }
        // Stable tie-breaker
        return a.id.localeCompare(b.id);
      });
  },

  getScheduledPromotions: (farmstands) => {
    return farmstands
      .filter((f) => f.promoActive && getPromoStatus(f) === 'scheduled')
      .sort((a, b) => {
        const aStart = a.promoStartAt ? new Date(a.promoStartAt).getTime() : 0;
        const bStart = b.promoStartAt ? new Date(b.promoStartAt).getTime() : 0;
        return aStart - bStart;
      });
  },

  getExpiredPromotions: (farmstands) => {
    return farmstands
      .filter((f) => f.promoActive && getPromoStatus(f) === 'expired')
      .sort((a, b) => {
        const aEnd = a.promoEndAt ? new Date(a.promoEndAt).getTime() : 0;
        const bEnd = b.promoEndAt ? new Date(b.promoEndAt).getTime() : 0;
        return bEnd - aEnd; // Most recently expired first
      });
  },

  getAutoFeatured: (farmstands, limit = 20) => {
    return farmstands
      .filter((f) => f.status === 'active' && f.showOnMap && !f.promoActive)
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, limit);
  },

  getPromotedForCategory: (farmstands, category, limit = 30) => {
    // Get daily seed for this category (changes daily for rotation)
    const dailySeed = getDailySeed(category);

    const activeFarmstands = farmstands.filter(
      (f) => f.status === 'active' && f.showOnMap
    );

    // Helper to check if farmstand matches category based on its products/tags
    const matchesCategory = (f: Farmstand): boolean => {
      // Special case: 'best_near_you' shows all farmstands (no category filter)
      if (category === 'best_near_you') return true;

      // Normalize category for comparison
      const normalizedCategory = category.toLowerCase().replace(/_/g, ' ');

      // Map category IDs to searchable terms
      const categoryTerms: Record<string, string[]> = {
        'eggs': ['eggs', 'egg', 'fresh eggs', 'farm eggs', 'chicken eggs', 'duck eggs'],
        'produce': ['produce', 'vegetables', 'veggies', 'fruit', 'fruits', 'vegetable'],
        'baked_goods': ['baked goods', 'baked', 'bakery', 'bread', 'pastry', 'pastries', 'sourdough', 'cookies', 'pies', 'cakes'],
        'baked goods': ['baked goods', 'baked', 'bakery', 'bread', 'pastry', 'pastries', 'sourdough', 'cookies', 'pies', 'cakes'],
        'upick': ['u-pick', 'upick', 'u pick', 'pick your own', 'pyo'],
        'pumpkins': ['pumpkins', 'pumpkin', 'gourds', 'squash', 'fall harvest'],
        'meat': ['meat', 'beef', 'pork', 'chicken', 'lamb', 'sausage', 'bacon', 'farm meat'],
        'berries': ['berries', 'berry', 'strawberries', 'blueberries', 'raspberries', 'blackberries'],
        'honey': ['honey', 'honeycomb', 'bees', 'beekeeping', 'raw honey'],
        'flowers': ['flowers', 'flower', 'bouquet', 'bouquets', 'cut flowers', 'floral'],
        'dairy': ['dairy', 'milk', 'cheese', 'butter', 'cream', 'yogurt'],
        'seasonal': ['seasonal', 'season', 'holiday', 'christmas', 'thanksgiving', 'fall', 'spring', 'summer', 'winter'],
        'preserves': ['preserves', 'jam', 'jams', 'jelly', 'jellies', 'canned', 'pickles', 'canning'],
        'plants': ['plants', 'seedlings', 'nursery', 'starts', 'potted'],
      };

      const terms = categoryTerms[category] || categoryTerms[normalizedCategory] || [normalizedCategory];

      // Check categories array (lowercase tags like 'eggs', 'produce')
      const categoriesMatch = f.categories?.some(cat => {
        const normalizedCat = cat.toLowerCase();
        return terms.some(term => normalizedCat.includes(term) || term.includes(normalizedCat));
      });

      // Check offerings array (display names like 'Eggs', 'Produce', 'Baked Goods')
      const offeringsMatch = f.offerings?.some(offering => {
        const normalizedOffering = offering.toLowerCase();
        return terms.some(term => normalizedOffering.includes(term) || term.includes(normalizedOffering));
      });

      // Also check description for category terms as fallback
      const descriptionMatch = f.description?.toLowerCase().split(/\s+/).some(word =>
        terms.some(term => word.includes(term))
      );

      return categoriesMatch || offeringsMatch || descriptionMatch;
    };

    // FIRST: Filter to only farmstands that match the category
    const categoryMatchedFarmstands = activeFarmstands.filter(matchesCategory);

    // If no farmstands match this category, return empty array (don't fill with unrelated ones)
    if (categoryMatchedFarmstands.length === 0) {
      return [];
    }

    // Step 1: Get all manual promoted farmstands for this category FROM the matched farmstands
    const allManualPromos = categoryMatchedFarmstands.filter((f) => {
      if (!f.promoActive) return false;
      if (getPromoStatus(f) !== 'active') return false;
      // Check if promoted in this category or on Explore in general (no specific categories)
      const inCategory = f.promoExploreCategories.includes(category);
      const generalPromo = f.promoExploreCategories.length === 0;
      return inCategory || generalPromo;
    });

    // Step 2: Apply weighted rotation to select top promos
    // This respects both Priority (higher = more likely to be selected)
    // and Rotation Weight (higher = more variance, appears more often when many promos)
    const selectedManualPromos = weightedRotationSelect(
      allManualPromos,
      dailySeed,
      MAX_MANUAL_PROMOS_IN_TOP_10
    );

    // Step 3: Get auto-featured (by popularity score) to fill remaining top 10 slots
    const manualIds = new Set(selectedManualPromos.map((f) => f.id));
    const remainingSlots = TOP_10_SLOTS - selectedManualPromos.length;

    const autoFeatured = categoryMatchedFarmstands
      .filter((f) => !manualIds.has(f.id))
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, remainingSlots);

    // Step 4: Get the rest of the farmstands (not in top 10)
    const topIds = new Set([
      ...selectedManualPromos.map((f) => f.id),
      ...autoFeatured.map((f) => f.id),
    ]);

    const rest = categoryMatchedFarmstands
      .filter((f) => !topIds.has(f.id))
      .sort((a, b) => b.popularityScore - a.popularityScore);

    // Combine: manual promos (sorted by priority) + auto-featured + rest
    const result = [...selectedManualPromos, ...autoFeatured, ...rest];
    return result.slice(0, limit);
  },

  getBoostedForMap: (farmstands, bounds, limit = 50) => {
    // Get daily seed for map rotation
    const dailySeed = getDailySeed('map_boost');

    // Filter to active farmstands
    let activeFarmstands = farmstands.filter(
      (f) => f.status === 'active' && f.showOnMap && f.latitude && f.longitude
    );

    // Apply bounds filter if provided
    if (bounds) {
      activeFarmstands = activeFarmstands.filter((f) => {
        const lat = f.latitude!;
        const lng = f.longitude!;
        return (
          lat >= bounds.minLat &&
          lat <= bounds.maxLat &&
          lng >= bounds.minLng &&
          lng <= bounds.maxLng
        );
      });
    }

    // Step 1: Get all map-boosted farmstands
    const allMapBoosted = activeFarmstands.filter((f) => {
      if (!f.promoActive || !f.promoMapBoost) return false;
      return getPromoStatus(f) === 'active';
    });

    // Step 2: Apply weighted rotation to select top boosted
    const selectedBoosted = weightedRotationSelect(
      allMapBoosted,
      dailySeed,
      MAP_PROMO_SLOTS
    );

    // Step 3: Get auto-featured by popularity (fill remaining top slots)
    const boostedIds = new Set(selectedBoosted.map((f) => f.id));
    const remainingTopSlots = TOP_10_SLOTS - selectedBoosted.length;

    const autoFeatured = activeFarmstands
      .filter((f) => !boostedIds.has(f.id))
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, remainingTopSlots);

    // Step 4: Get the rest
    const topIds = new Set([
      ...selectedBoosted.map((f) => f.id),
      ...autoFeatured.map((f) => f.id),
    ]);

    const rest = activeFarmstands
      .filter((f) => !topIds.has(f.id))
      .sort((a, b) => b.popularityScore - a.popularityScore);

    // Combine: boosted (sorted by priority) + auto-featured + rest
    const result = [...selectedBoosted, ...autoFeatured, ...rest];
    return result.slice(0, limit);
  },

  updatePopularityScore: async (farmstand, updateFarmstand) => {
    const newScore = calculatePopularityScore(farmstand);
    if (newScore !== farmstand.popularityScore) {
      await updateFarmstand(farmstand.id, { popularityScore: newScore });
    }
  },

  incrementClick: async (farmstand, updateFarmstand) => {
    const newClicks = (farmstand.clicks30d || 0) + 1;
    const newScore = calculatePopularityScore({
      ...farmstand,
      clicks30d: newClicks,
    });
    await updateFarmstand(farmstand.id, {
      clicks30d: newClicks,
      popularityScore: newScore,
      lastActivityAt: new Date().toISOString(),
    });
  },

  incrementSave: async (farmstand, updateFarmstand) => {
    const newSaves = (farmstand.saves30d || 0) + 1;
    const newScore = calculatePopularityScore({
      ...farmstand,
      saves30d: newSaves,
    });
    await updateFarmstand(farmstand.id, {
      saves30d: newSaves,
      popularityScore: newScore,
      lastActivityAt: new Date().toISOString(),
    });
  },

  incrementMessage: async (farmstand, updateFarmstand) => {
    const newMessages = (farmstand.messages30d || 0) + 1;
    const newScore = calculatePopularityScore({
      ...farmstand,
      messages30d: newMessages,
    });
    await updateFarmstand(farmstand.id, {
      messages30d: newMessages,
      popularityScore: newScore,
      lastActivityAt: new Date().toISOString(),
    });
  },

  refreshRotation: () => {
    const newSeed = Date.now();
    set({ rotationSeed: newSeed });
    // Also persist the new seed
    AsyncStorage.setItem('promo_rotation_seed', String(newSeed));
  },
}));
