import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Farmstand, PromoStatus } from './farmer-store';

// ─── Constants ──────────────────────────────────────────────────────────────

// Popularity calculation weights
const CLICK_WEIGHT = 1;
const SAVE_WEIGHT = 3;
const MESSAGE_WEIGHT = 4;
const REVIEW_WEIGHT = 5;
const HIGH_RATING_MULTIPLIER = 1.15; // Applied when avgRating >= 4.5

// Slot limits
const EXPLORE_ROW_PROMOTED_SLOTS = 1;      // 1 promoted slot per category row on Explore homepage
const CATEGORY_RESULTS_PROMOTED_SLOTS = 3; // Up to 3 promoted slots on category results page
const MAP_PROMO_SLOTS = 5;
const AUTO_FILL_TOTAL = 10; // Total top positions filled by promos + auto-featured

// Rotation window duration in milliseconds (2 hours)
const ROTATION_WINDOW_MS = 2 * 60 * 60 * 1000;

// Fairness: prefer farmstands not shown in last N windows
const RECENCY_PENALTY_WINDOWS = 2;

// Earth radius in miles for distance calculation
const EARTH_RADIUS_MILES = 3959;

// ─── Explore categories ──────────────────────────────────────────────────────

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

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface PromotionSummary {
  activeCount: number;
  scheduledCount: number;
  expiredCount: number;
  autoFeaturedCount: number;
}

/**
 * Metadata tracked per farmstand per window for fairness rotation.
 * Stored in memory only (not persisted) — resets on app restart.
 * Key: `${farmstandId}:${category}`
 */
interface RotationHistory {
  lastServedWindow: number;    // Epoch ms of last window it was served
  servedCountToday: number;    // How many times served today
  servedDate: string;          // YYYY-MM-DD of servedCountToday
}

// ─── Pure helper functions ────────────────────────────────────────────────────

/** Check if a promotion is currently active based on schedule dates */
export const isPromotionActive = (farmstand: Farmstand): boolean => {
  if (!farmstand.promoActive) return false;
  const now = new Date();
  if (farmstand.promoStartAt) {
    if (now < new Date(farmstand.promoStartAt)) return false;
  }
  if (farmstand.promoEndAt) {
    if (now > new Date(farmstand.promoEndAt)) return false;
  }
  return true;
};

/** Get the current promo status based on schedule dates */
export const getPromoStatus = (farmstand: Farmstand): PromoStatus => {
  if (!farmstand.promoActive) return 'none';
  const now = new Date();
  if (farmstand.promoStartAt) {
    if (now < new Date(farmstand.promoStartAt)) return 'scheduled';
  }
  if (farmstand.promoEndAt) {
    if (now > new Date(farmstand.promoEndAt)) return 'expired';
  }
  return 'active';
};

/** Calculate popularity score for a farmstand */
export const calculatePopularityScore = (farmstand: Farmstand): number => {
  const baseScore =
    (farmstand.clicks30d * CLICK_WEIGHT) +
    (farmstand.saves30d * SAVE_WEIGHT) +
    (farmstand.messages30d * MESSAGE_WEIGHT) +
    (farmstand.reviewCount * REVIEW_WEIGHT);
  if (farmstand.avgRating >= 4.5) {
    return Math.round(baseScore * HIGH_RATING_MULTIPLIER);
  }
  return baseScore;
};

/**
 * Get the current 2-hour rotation window index.
 * Changes every 2 hours. Stable within the window.
 */
const getCurrentWindowIndex = (): number => {
  return Math.floor(Date.now() / ROTATION_WINDOW_MS);
};

/**
 * Get today's date string YYYY-MM-DD for daily reset of servedCountToday.
 */
const getTodayString = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Seeded pseudo-random: deterministic for same seed, different per item.
 * Uses a simple multiplicative hash.
 */
const seededRandom = (seed: number): number => {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
};

/**
 * Compute a stable numeric seed from the window index, category, and farmstand ID.
 * This is what changes every 2 hours, rotating which promos win.
 */
const getWindowSeed = (windowIndex: number, category: string, farmstandId: string): number => {
  const base = `${windowIndex}-${category}-${farmstandId}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    const char = base.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

/**
 * Haversine distance between two coordinates in miles.
 */
const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Category matching logic: returns true if a farmstand sells the given category.
 */
const matchesCategory = (f: Farmstand, category: string): boolean => {
  if (category === 'best_near_you') return true;

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

  const normalizedCategory = category.toLowerCase().replace(/_/g, ' ');
  const terms = categoryTerms[category] || categoryTerms[normalizedCategory] || [normalizedCategory];

  const categoriesMatch = f.categories?.some(cat => {
    const normalizedCat = cat.toLowerCase();
    return terms.some(term => normalizedCat.includes(term) || term.includes(normalizedCat));
  });

  const offeringsMatch = f.offerings?.some(offering => {
    const normalizedOffering = offering.toLowerCase();
    return terms.some(term => normalizedOffering.includes(term) || term.includes(normalizedOffering));
  });

  const descriptionMatch = f.description?.toLowerCase().split(/\s+/).some(word =>
    terms.some(term => word.includes(term))
  );

  return !!(categoriesMatch || offeringsMatch || descriptionMatch);
};

/**
 * 2-hour window rotation selection with fairness.
 *
 * Algorithm:
 * 1. For each eligible promoted farmstand, compute a "selection score":
 *    - Base: promoPriority × 100 (ensures high-priority promos rank higher)
 *    - Rotation bonus: promoRotationWeight × windowRandom × 250 (provides per-window variance)
 *    - Fairness penalty: if served in recent windows, apply penalty proportional to recency
 * 2. Sort by selection score descending, take top N
 * 3. Final display order: sort selected items by priority (stable within window)
 */
const windowRotationSelect = <T extends {
  id: string;
  promoPriority: number;
  promoRotationWeight: number;
}>(
  items: T[],
  windowIndex: number,
  category: string,
  maxItems: number,
  rotationHistory: Map<string, RotationHistory>
): T[] => {
  if (items.length === 0) return [];
  if (items.length <= maxItems) {
    // Fewer candidates than slots — just sort by priority with stable tiebreak
    return [...items].sort((a, b) => {
      if (b.promoPriority !== a.promoPriority) return b.promoPriority - a.promoPriority;
      return a.id.localeCompare(b.id);
    });
  }

  const today = getTodayString();

  const scored = items.map((item) => {
    // Deterministic random per window+category+farmstand — changes every 2 hours
    const seed = getWindowSeed(windowIndex, category, item.id);
    const windowRandom = seededRandom(seed);

    // Base score from priority
    const priorityScore = item.promoPriority * 100;

    // Rotation bonus from rotation weight (adds variance)
    const rotationBonus = item.promoRotationWeight * windowRandom * 250;

    // Fairness penalty: penalize farmstands served in the last N windows
    const historyKey = `${item.id}:${category}`;
    const history = rotationHistory.get(historyKey);
    let fairnessPenalty = 0;
    if (history) {
      const windowsAgo = windowIndex - history.lastServedWindow;
      if (windowsAgo <= RECENCY_PENALTY_WINDOWS) {
        // Stronger penalty the more recent the last serve
        const recencyFactor = (RECENCY_PENALTY_WINDOWS - windowsAgo + 1) / (RECENCY_PENALTY_WINDOWS + 1);
        // Penalty up to 30% of a typical selection score
        fairnessPenalty = recencyFactor * 750;
      }
    }

    const selectionScore = priorityScore + rotationBonus - fairnessPenalty;
    return { item, selectionScore };
  });

  // Sort by selection score descending, stable tiebreak by id
  scored.sort((a, b) => {
    if (Math.abs(b.selectionScore - a.selectionScore) > 0.001) {
      return b.selectionScore - a.selectionScore;
    }
    return a.item.id.localeCompare(b.item.id);
  });

  // Take top N
  const selected = scored.slice(0, maxItems).map((s) => s.item);

  // Final display order within window: sort by priority for stable presentation
  selected.sort((a, b) => {
    if (b.promoPriority !== a.promoPriority) return b.promoPriority - a.promoPriority;
    return a.id.localeCompare(b.id);
  });

  return selected;
};

// ─── Store interface ──────────────────────────────────────────────────────────

interface PromotionsState {
  isLoading: boolean;

  /**
   * In-memory rotation history for fairness tracking.
   * Key: `${farmstandId}:${category}`, Value: RotationHistory
   * Not persisted — resets each app session.
   */
  rotationHistory: Map<string, RotationHistory>;

  // Actions
  loadPromotionsData: () => Promise<void>;

  // Summary counts for admin dashboard
  getPromotionSummary: (farmstands: Farmstand[]) => PromotionSummary;

  // Filtered lists by status
  getActivePromotions: (farmstands: Farmstand[]) => Farmstand[];
  getScheduledPromotions: (farmstands: Farmstand[]) => Farmstand[];
  getExpiredPromotions: (farmstands: Farmstand[]) => Farmstand[];
  getAutoFeatured: (farmstands: Farmstand[], limit?: number) => Farmstand[];

  /**
   * Get promoted farmstands for the Explore homepage category rows.
   *
   * Rules:
   * - Only promoted farmstands within `radiusMiles` of `userLocation` compete
   * - Returns 1 promoted slot (+ auto-fill to top 10 + rest)
   * - Rotation window changes every 2 hours
   * - Fairness: prefer farmstands not served in recent windows
   *
   * When `userLocation` is null, radius filtering is skipped.
   */
  getPromotedForExploreRow: (
    farmstands: Farmstand[],
    category: string,
    userLocation: { latitude: number; longitude: number } | null,
    radiusMiles: number,
    totalLimit?: number
  ) => Farmstand[];

  /**
   * Get promoted farmstands for the full category results screen.
   *
   * Rules:
   * - Only promoted farmstands within `radiusMiles` compete
   * - Returns up to 3 promoted slots near top
   * - Fairness rotation every 2 hours
   */
  getPromotedForCategoryResults: (
    farmstands: Farmstand[],
    category: string,
    userLocation: { latitude: number; longitude: number } | null,
    radiusMiles: number,
    totalLimit?: number
  ) => Farmstand[];

  /**
   * Legacy: kept for backward compatibility with Explore screen useMemo calls.
   * Internally calls getPromotedForExploreRow with no radius filtering.
   * Prefer getPromotedForExploreRow for new code.
   */
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

  // Mark farmstands as served in current window (call after rendering promoted slots)
  markServedInWindow: (farmstandIds: string[], category: string) => void;

  // Popularity increment helpers
  updatePopularityScore: (
    farmstand: Farmstand,
    updateFarmstand: (id: string, updates: Partial<Farmstand>) => Promise<void>
  ) => Promise<void>;
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
}

// ─── Core logic: get promoted + auto-fill result list ─────────────────────────

/**
 * Shared internal logic for computing a promoted + auto-filled list.
 *
 * @param farmstands - All active farmstands (pre-filtered to status=active)
 * @param category - Category key for matching and rotation seeding
 * @param userLocation - Shopper's location (null = no radius filter)
 * @param radiusMiles - Max radius for promo competition (0 = no limit)
 * @param promotedSlots - How many promoted slots to fill (1 for rows, 3 for results)
 * @param totalLimit - Total items to return
 * @param windowIndex - Current 2-hour window index
 * @param rotationHistory - Fairness history map
 */
function buildPromotedList(
  farmstands: Farmstand[],
  category: string,
  userLocation: { latitude: number; longitude: number } | null,
  radiusMiles: number,
  promotedSlots: number,
  totalLimit: number,
  windowIndex: number,
  rotationHistory: Map<string, RotationHistory>
): Farmstand[] {
  const activeFarmstands = farmstands.filter(
    (f) => f.status === 'active' && f.showOnMap
  );

  // Filter to category-matching farmstands
  const categoryMatched = activeFarmstands.filter((f) => matchesCategory(f, category));

  if (categoryMatched.length === 0) return [];

  // ── Radius filter for PROMOTION COMPETITION only ──
  // Promotions only compete within the shopper's selected radius.
  // Non-promoted farmstands are NOT radius-filtered here (that's done by the screen).
  const inRadiusForPromo = (f: Farmstand): boolean => {
    if (!userLocation || radiusMiles <= 0) return true;
    if (!f.latitude || !f.longitude) return false;
    const dist = haversineDistance(
      userLocation.latitude,
      userLocation.longitude,
      f.latitude,
      f.longitude
    );
    return dist <= radiusMiles;
  };

  // ── Step 1: Eligible promoted candidates (within radius) ──
  const eligiblePromos = categoryMatched.filter((f) => {
    if (!f.promoActive) return false;
    if (getPromoStatus(f) !== 'active') return false;
    // Must be in this category or have no specific category restriction
    const inCategory = f.promoExploreCategories.includes(category);
    const generalPromo = f.promoExploreCategories.length === 0;
    if (!inCategory && !generalPromo) return false;
    return inRadiusForPromo(f);
  });

  // ── Step 2: Fairness-weighted 2-hour window rotation selection ──
  const selectedPromos = windowRotationSelect(
    eligiblePromos,
    windowIndex,
    category,
    promotedSlots,
    rotationHistory
  );

  // ── Step 3: Auto-featured fills remaining top slots (no radius restriction) ──
  const promoIds = new Set(selectedPromos.map((f) => f.id));
  const remainingAutoSlots = AUTO_FILL_TOTAL - selectedPromos.length;

  const autoFeatured = categoryMatched
    .filter((f) => !promoIds.has(f.id))
    .sort((a, b) => b.popularityScore - a.popularityScore)
    .slice(0, Math.max(0, remainingAutoSlots));

  // ── Step 4: Rest of category-matched farmstands ──
  const topIds = new Set([
    ...selectedPromos.map((f) => f.id),
    ...autoFeatured.map((f) => f.id),
  ]);

  const rest = categoryMatched
    .filter((f) => !topIds.has(f.id))
    .sort((a, b) => b.popularityScore - a.popularityScore);

  return [...selectedPromos, ...autoFeatured, ...rest].slice(0, totalLimit);
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePromotionsStore = create<PromotionsState>((set, get) => ({
  isLoading: false,
  rotationHistory: new Map(),

  loadPromotionsData: async () => {
    set({ isLoading: true });
    try {
      // Nothing to load from storage for 2-hour window rotation —
      // the window is derived from the current time, so it's always correct.
      set({ isLoading: false });
    } catch {
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

    const autoFeaturedCount = farmstands
      .filter((f) => f.status === 'active' && !f.promoActive && f.popularityScore > 0)
      .length;

    return {
      activeCount,
      scheduledCount,
      expiredCount,
      autoFeaturedCount: Math.min(autoFeaturedCount, 20),
    };
  },

  getActivePromotions: (farmstands) => {
    return farmstands
      .filter((f) => f.promoActive && getPromoStatus(f) === 'active')
      .sort((a, b) => {
        if (b.promoPriority !== a.promoPriority) return b.promoPriority - a.promoPriority;
        if (b.promoRotationWeight !== a.promoRotationWeight) return b.promoRotationWeight - a.promoRotationWeight;
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
        return bEnd - aEnd;
      });
  },

  getAutoFeatured: (farmstands, limit = 20) => {
    return farmstands
      .filter((f) => f.status === 'active' && f.showOnMap && !f.promoActive)
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, limit);
  },

  getPromotedForExploreRow: (farmstands, category, userLocation, radiusMiles, totalLimit = 30) => {
    const windowIndex = getCurrentWindowIndex();
    const { rotationHistory } = get();
    return buildPromotedList(
      farmstands,
      category,
      userLocation,
      radiusMiles,
      EXPLORE_ROW_PROMOTED_SLOTS,
      totalLimit,
      windowIndex,
      rotationHistory
    );
  },

  getPromotedForCategoryResults: (farmstands, category, userLocation, radiusMiles, totalLimit = 50) => {
    const windowIndex = getCurrentWindowIndex();
    const { rotationHistory } = get();
    return buildPromotedList(
      farmstands,
      category,
      userLocation,
      radiusMiles,
      CATEGORY_RESULTS_PROMOTED_SLOTS,
      totalLimit,
      windowIndex,
      rotationHistory
    );
  },

  // Legacy method: no radius filtering, uses explore-row slot count
  getPromotedForCategory: (farmstands, category, limit = 30) => {
    const windowIndex = getCurrentWindowIndex();
    const { rotationHistory } = get();
    return buildPromotedList(
      farmstands,
      category,
      null,
      0,
      EXPLORE_ROW_PROMOTED_SLOTS,
      limit,
      windowIndex,
      rotationHistory
    );
  },

  getBoostedForMap: (farmstands, bounds, limit = 50) => {
    const windowIndex = getCurrentWindowIndex();
    const { rotationHistory } = get();

    let activeFarmstands = farmstands.filter(
      (f) => f.status === 'active' && f.showOnMap && f.latitude && f.longitude
    );

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

    const allMapBoosted = activeFarmstands.filter((f) => {
      if (!f.promoActive || !f.promoMapBoost) return false;
      return getPromoStatus(f) === 'active';
    });

    const selectedBoosted = windowRotationSelect(
      allMapBoosted,
      windowIndex,
      'map_boost',
      MAP_PROMO_SLOTS,
      rotationHistory
    );

    const boostedIds = new Set(selectedBoosted.map((f) => f.id));
    const remainingTopSlots = AUTO_FILL_TOTAL - selectedBoosted.length;

    const autoFeatured = activeFarmstands
      .filter((f) => !boostedIds.has(f.id))
      .sort((a, b) => b.popularityScore - a.popularityScore)
      .slice(0, remainingTopSlots);

    const topIds = new Set([
      ...selectedBoosted.map((f) => f.id),
      ...autoFeatured.map((f) => f.id),
    ]);

    const rest = activeFarmstands
      .filter((f) => !topIds.has(f.id))
      .sort((a, b) => b.popularityScore - a.popularityScore);

    return [...selectedBoosted, ...autoFeatured, ...rest].slice(0, limit);
  },

  markServedInWindow: (farmstandIds, category) => {
    const windowIndex = getCurrentWindowIndex();
    const today = getTodayString();
    const { rotationHistory } = get();
    const updated = new Map(rotationHistory);

    for (const id of farmstandIds) {
      const key = `${id}:${category}`;
      const existing = updated.get(key);
      const prevCount = (existing && existing.servedDate === today)
        ? existing.servedCountToday
        : 0;
      updated.set(key, {
        lastServedWindow: windowIndex,
        servedCountToday: prevCount + 1,
        servedDate: today,
      });
    }

    set({ rotationHistory: updated });
  },

  updatePopularityScore: async (farmstand, updateFarmstand) => {
    const newScore = calculatePopularityScore(farmstand);
    if (newScore !== farmstand.popularityScore) {
      await updateFarmstand(farmstand.id, { popularityScore: newScore });
    }
  },

  incrementClick: async (farmstand, updateFarmstand) => {
    const newClicks = (farmstand.clicks30d || 0) + 1;
    const newScore = calculatePopularityScore({ ...farmstand, clicks30d: newClicks });
    await updateFarmstand(farmstand.id, {
      clicks30d: newClicks,
      popularityScore: newScore,
      lastActivityAt: new Date().toISOString(),
    });
  },

  incrementSave: async (farmstand, updateFarmstand) => {
    const newSaves = (farmstand.saves30d || 0) + 1;
    const newScore = calculatePopularityScore({ ...farmstand, saves30d: newSaves });
    await updateFarmstand(farmstand.id, {
      saves30d: newSaves,
      popularityScore: newScore,
      lastActivityAt: new Date().toISOString(),
    });
  },

  incrementMessage: async (farmstand, updateFarmstand) => {
    const newMessages = (farmstand.messages30d || 0) + 1;
    const newScore = calculatePopularityScore({ ...farmstand, messages30d: newMessages });
    await updateFarmstand(farmstand.id, {
      messages30d: newMessages,
      popularityScore: newScore,
      lastActivityAt: new Date().toISOString(),
    });
  },
}));
