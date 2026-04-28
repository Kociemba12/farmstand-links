/**
 * Search Store - Shared search state and Supabase search functionality
 * Used by both Explore and Map pages for consistent search behavior
 */

import { create } from 'zustand';
import { supabase, isSupabaseConfigured } from './supabase';
import { Farmstand } from './farmer-store';
import { CATEGORY_FILTER_KEYWORDS, CATEGORY_LABELS, farmstandMatchesCategory } from './category-filter';

// Search result type (farmstand with optional match context)
export interface SearchResult {
  farmstand: Farmstand;
  matchedFields: string[]; // Which fields matched the query
  matchedProducts?: string[]; // Products that matched (if any)
}

// Search tier for ranking results
export type SearchTier = 1 | 2 | 3;

// Search type classification
export type SearchType = 'name' | 'product' | 'location' | 'general';

// Search result with tier information
export interface TieredSearchResult {
  farmstandId: string;
  tier: SearchTier;
}

// Search context passed from Explore to Map
export interface SearchContext {
  queryText: string;
  searchType: SearchType;
  categoryKey?: string; // For product/category searches
  targetLocation?: { latitude: number; longitude: number }; // For location searches
  matchedFarmstandId?: string; // For exact name match (single result)
}

// Search state
interface SearchState {
  // Current search query
  query: string;

  // Search results (filtered farmstand IDs with tier info)
  searchResults: string[];

  // Tiered results for ranking display
  tieredResults: TieredSearchResult[];

  // Whether search is active (query is non-empty)
  isSearchActive: boolean;

  // Loading state
  isSearching: boolean;

  // Error state
  searchError: string | null;

  // Last search timestamp (for debounce coordination)
  lastSearchTimestamp: number;

  // Actions
  setQuery: (query: string) => void;
  clearSearch: () => void;

  // Perform search against Supabase
  performSearch: (query: string, allFarmstands: Farmstand[]) => Promise<void>;

  // Get filtered farmstands based on current search (sorted by tier)
  getSearchFilteredFarmstands: (allFarmstands: Farmstand[]) => Farmstand[];
}

/**
 * Map Supabase snake_case response to camelCase Farmstand type (simplified for search)
 */
const mapSearchResult = (row: Record<string, unknown>): Partial<Farmstand> => {
  const get = <T>(snakeKey: string, camelKey: string, defaultValue: T): T => {
    if (row[snakeKey] !== undefined && row[snakeKey] !== null) return row[snakeKey] as T;
    if (row[camelKey] !== undefined && row[camelKey] !== null) return row[camelKey] as T;
    return defaultValue;
  };

  return {
    id: get('id', 'id', ''),
    name: get('name', 'name', ''),
    city: get('city', 'city', null),
    state: get('state', 'state', null),
    zip: get('zip', 'zip', null),
    addressLine1: get('street_address', 'addressLine1', null),
    crossStreet1: get('cross_street1', 'crossStreet1', null),
    crossStreet2: get('cross_street2', 'crossStreet2', null),
    description: get('description', 'description', ''),
    offerings: get('offerings', 'offerings', []),
    latitude: get('latitude', 'latitude', null),
    longitude: get('longitude', 'longitude', null),
  };
};

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  searchResults: [],
  tieredResults: [],
  isSearchActive: false,
  isSearching: false,
  searchError: null,
  lastSearchTimestamp: 0,

  setQuery: (query: string) => {
    set({
      query,
      isSearchActive: query.trim().length > 0,
    });
  },

  clearSearch: () => {
    set({
      query: '',
      searchResults: [],
      tieredResults: [],
      isSearchActive: false,
      isSearching: false,
      searchError: null,
    });
  },

  performSearch: async (query: string, allFarmstands: Farmstand[]) => {
    const trimmedQuery = query.trim().toLowerCase();
    const timestamp = Date.now();

    set({ lastSearchTimestamp: timestamp, isSearching: true, searchError: null });

    // If empty query, clear results
    if (!trimmedQuery) {
      set({
        searchResults: [],
        tieredResults: [],
        isSearchActive: false,
        isSearching: false,
      });
      return;
    }

    try {
      // Perform tiered search (works with both Supabase and local)
      const tieredResults = await searchFarmstandsTiered(trimmedQuery, allFarmstands);

      // Check if this is still the latest search request
      if (get().lastSearchTimestamp !== timestamp) {
        return; // Newer search in progress, discard these results
      }

      // Extract just the IDs for backward compatibility
      const matchedIds = tieredResults.map(r => r.farmstandId);

      set({
        searchResults: matchedIds,
        tieredResults,
        isSearchActive: true,
        isSearching: false,
      });
    } catch (error) {
      console.error('[SearchStore] Search error:', error);

      if (get().lastSearchTimestamp !== timestamp) {
        return;
      }

      // Fall back to local search on error
      const tieredResults = searchFarmstandsTieredLocal(trimmedQuery, allFarmstands);
      const matchedIds = tieredResults.map(r => r.farmstandId);

      set({
        searchResults: matchedIds,
        tieredResults,
        isSearchActive: true,
        isSearching: false,
        searchError: 'Search service unavailable, using local results',
      });
    }
  },

  getSearchFilteredFarmstands: (allFarmstands: Farmstand[]) => {
    const { isSearchActive, tieredResults, query } = get();

    if (!isSearchActive || !query.trim()) {
      return allFarmstands;
    }

    // If we have tiered results, filter and sort by tier
    if (tieredResults.length > 0) {
      // Create a map of farmstand ID to tier for sorting
      const tierMap = new Map(tieredResults.map(r => [r.farmstandId, r.tier]));
      const resultSet = new Set(tieredResults.map(r => r.farmstandId));

      return allFarmstands
        .filter(f => resultSet.has(f.id))
        .sort((a, b) => {
          const tierA = tierMap.get(a.id) ?? 3;
          const tierB = tierMap.get(b.id) ?? 3;
          return tierA - tierB; // Lower tier = better match = first
        });
    }

    // If search is active but no results, return empty array
    return [];
  },
}));

/**
 * Helper: Check if a name matches query with Tier 1 (exact/starts-with) logic
 * Returns true if name equals query OR name starts with query (prefix match)
 */
function matchesTier1(name: string, query: string): boolean {
  const normalizedName = name.toLowerCase().trim();
  const normalizedQuery = query.toLowerCase().trim();

  // Exact match
  if (normalizedName === normalizedQuery) return true;

  // Name starts with query
  if (normalizedName.startsWith(normalizedQuery)) return true;

  return false;
}

/**
 * Helper: Check if a name matches query with Tier 2 (whole-word starts-with) logic
 * Returns true if any word in the name starts with the query
 */
function matchesTier2(name: string, query: string): boolean {
  const normalizedName = name.toLowerCase().trim();
  const normalizedQuery = query.toLowerCase().trim();

  // Split name into words and check if any word starts with query
  const words = normalizedName.split(/\s+/);
  return words.some(word => word.startsWith(normalizedQuery));
}

/**
 * Helper: Check if text contains query (Tier 3 - contains match)
 * Only used as fallback for queries 3+ characters
 */
function matchesTier3(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

/**
 * Perform tiered search on farmstands
 * Uses local data with optional Supabase augmentation for non-name fields
 */
async function searchFarmstandsTiered(query: string, farmstands: Farmstand[]): Promise<TieredSearchResult[]> {
  const trimmedQuery = query.trim().toLowerCase();
  const queryLength = trimmedQuery.length;

  console.log('[Search] Performing tiered search for:', trimmedQuery, 'length:', queryLength);

  // Filter to valid farmstands first
  const validFarmstands = farmstands.filter(farm => {
    if (farm.status !== 'active' && farm.status !== 'pending') return false;
    if (farm.deletedAt) return false;
    if (farm.showOnMap === false) return false; // respect public visibility toggle
    return true;
  });

  const tier1Results: TieredSearchResult[] = [];
  const tier2Results: TieredSearchResult[] = [];
  const tier3Results: TieredSearchResult[] = [];
  const seenIds = new Set<string>();

  // ============ NAME SEARCH (Tiered) ============
  for (const farm of validFarmstands) {
    const name = farm.name || '';

    // Tier 1: Exact or starts-with on name
    if (matchesTier1(name, trimmedQuery)) {
      if (!seenIds.has(farm.id)) {
        tier1Results.push({ farmstandId: farm.id, tier: 1 });
        seenIds.add(farm.id);
      }
      continue;
    }

    // Tier 2: Any word in name starts with query
    if (matchesTier2(name, trimmedQuery)) {
      if (!seenIds.has(farm.id)) {
        tier2Results.push({ farmstandId: farm.id, tier: 2 });
        seenIds.add(farm.id);
      }
      continue;
    }

    // Tier 3: Contains match (only for queries 3+ chars)
    if (queryLength >= 3 && matchesTier3(name, trimmedQuery)) {
      if (!seenIds.has(farm.id)) {
        tier3Results.push({ farmstandId: farm.id, tier: 3 });
        seenIds.add(farm.id);
      }
    }
  }

  // ============ NON-NAME FIELD SEARCH ============
  // Search city, state, zip, address, products, etc.
  // These don't use tiered name logic - they use contains matching
  // but are added as Tier 2 since they're direct field matches

  for (const farm of validFarmstands) {
    if (seenIds.has(farm.id)) continue;

    const searchableFields = [
      farm.city,
      farm.state,
      farm.zip,
      farm.addressLine1,
      farm.crossStreet1,
      farm.crossStreet2,
      farm.description,
      ...(farm.offerings || []),
      ...(farm.categories || []),
    ].filter(Boolean).join(' ').toLowerCase();

    // For non-name fields, use contains but only for 3+ char queries
    if (queryLength >= 3 && searchableFields.includes(trimmedQuery)) {
      tier2Results.push({ farmstandId: farm.id, tier: 2 });
      seenIds.add(farm.id);
    }
  }

  // ============ PRODUCT SEARCH (via Supabase if available) ============
  if (queryLength >= 3 && isSupabaseConfigured()) {
    try {
      const productSearch = await supabase
        .from<Record<string, unknown>>('farmstand_products')
        .select('farmstand_id')
        .ilike('name', `%${trimmedQuery}%`)
        .eq('is_active', true)
        .limit(200)
        .execute();

      if (productSearch.data) {
        for (const row of productSearch.data) {
          const farmstandId = row.farmstand_id as string;
          if (farmstandId && !seenIds.has(farmstandId)) {
            // Check if this farmstand is in our valid set
            const isValid = validFarmstands.some(f => f.id === farmstandId);
            if (isValid) {
              tier2Results.push({ farmstandId, tier: 2 });
              seenIds.add(farmstandId);
            }
          }
        }
      }
    } catch (error) {
      console.log('[Search] Product search skipped:', error);
    }
  }

  // ============ DETERMINE FINAL RESULTS ============
  // If Tier 1 or Tier 2 has results, don't include Tier 3
  if (tier1Results.length > 0 || tier2Results.length > 0) {
    console.log('[Search] Tier 1:', tier1Results.length, 'Tier 2:', tier2Results.length, '(excluding Tier 3)');
    return [...tier1Results, ...tier2Results];
  }

  // Only use Tier 3 as fallback when no Tier 1/2 results AND query is 3+ chars
  if (queryLength >= 3 && tier3Results.length > 0) {
    console.log('[Search] Using Tier 3 fallback:', tier3Results.length, 'results');
    return tier3Results;
  }

  console.log('[Search] No results found');
  return [];
}

/**
 * Local-only tiered search (fallback when Supabase unavailable)
 */
function searchFarmstandsTieredLocal(query: string, farmstands: Farmstand[]): TieredSearchResult[] {
  const trimmedQuery = query.trim().toLowerCase();
  const queryLength = trimmedQuery.length;

  // Filter to valid farmstands first
  const validFarmstands = farmstands.filter(farm => {
    if (farm.status !== 'active' && farm.status !== 'pending') return false;
    if (farm.deletedAt) return false;
    if (farm.showOnMap === false) return false; // respect public visibility toggle
    return true;
  });

  const tier1Results: TieredSearchResult[] = [];
  const tier2Results: TieredSearchResult[] = [];
  const tier3Results: TieredSearchResult[] = [];
  const seenIds = new Set<string>();

  for (const farm of validFarmstands) {
    const name = farm.name || '';

    // Tier 1: Exact or starts-with on name
    if (matchesTier1(name, trimmedQuery)) {
      tier1Results.push({ farmstandId: farm.id, tier: 1 });
      seenIds.add(farm.id);
      continue;
    }

    // Tier 2: Any word in name starts with query
    if (matchesTier2(name, trimmedQuery)) {
      tier2Results.push({ farmstandId: farm.id, tier: 2 });
      seenIds.add(farm.id);
      continue;
    }

    // Tier 3: Contains match in name (only for 3+ chars)
    if (queryLength >= 3 && matchesTier3(name, trimmedQuery)) {
      tier3Results.push({ farmstandId: farm.id, tier: 3 });
      seenIds.add(farm.id);
      continue;
    }

    // Check other fields (Tier 2 for direct matches)
    if (queryLength >= 3) {
      const searchableFields = [
        farm.city,
        farm.state,
        farm.zip,
        farm.addressLine1,
        farm.crossStreet1,
        farm.crossStreet2,
        farm.description,
        ...(farm.offerings || []),
        ...(farm.categories || []),
      ].filter(Boolean).join(' ').toLowerCase();

      if (searchableFields.includes(trimmedQuery) && !seenIds.has(farm.id)) {
        tier2Results.push({ farmstandId: farm.id, tier: 2 });
        seenIds.add(farm.id);
      }
    }
  }

  // If Tier 1 or Tier 2 has results, don't include Tier 3
  if (tier1Results.length > 0 || tier2Results.length > 0) {
    return [...tier1Results, ...tier2Results];
  }

  // Only use Tier 3 as fallback when query is 3+ chars
  if (queryLength >= 3) {
    return tier3Results;
  }

  return [];
}

/**
 * Check if search results suggest a location-based query
 * Used to determine if map should auto-zoom to results
 */
export function isLocationQuery(query: string): boolean {
  const trimmed = query.trim().toLowerCase();

  // Check if query looks like a city, state, or zip
  // Zip codes: 5 digits
  if (/^\d{5}$/.test(trimmed)) {
    return true;
  }

  // State abbreviations
  const stateAbbreviations = [
    'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga',
    'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md',
    'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj',
    'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc',
    'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy',
  ];

  if (stateAbbreviations.includes(trimmed)) {
    return true;
  }

  // Common city patterns (capitalized word)
  if (/^[A-Za-z\s]+$/.test(trimmed) && trimmed.length > 2) {
    // Could be a city name - return true for location-based zoom
    return true;
  }

  return false;
}

/**
 * Detect what category a search query matches
 * Returns the category key if the query is a product/category search
 */
export function detectCategoryFromQuery(query: string): string | null {
  const trimmed = query.trim().toLowerCase();

  // Require minimum length to avoid accidental single-char matches
  if (trimmed.length < 2) return null;

  // Check if query matches any category label (substring match)
  // e.g. "egg" matches "Fresh Eggs", "sourdough" matches "Sourdough & Baked Goods"
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    if (label.toLowerCase() === trimmed || label.toLowerCase().includes(trimmed)) {
      return key;
    }
  }

  // Check if query exactly matches any category keyword
  for (const [key, keywords] of Object.entries(CATEGORY_FILTER_KEYWORDS)) {
    for (const keyword of keywords) {
      if (keyword.toLowerCase() === trimmed || trimmed === key) {
        return key;
      }
    }
  }

  // For multi-word queries (e.g. "sourdough bread"), check if any significant
  // keyword (4+ chars) appears as a whole word within the query
  const queryWords = trimmed.split(/\s+/);
  if (queryWords.length > 1) {
    for (const [key, keywords] of Object.entries(CATEGORY_FILTER_KEYWORDS)) {
      for (const keyword of keywords) {
        const lowerKeyword = keyword.toLowerCase();
        if (lowerKeyword.length >= 4) {
          const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${escaped}\\b`, 'i').test(trimmed)) {
            return key;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Classify search query into a search type
 * Priority: product/category → location → farmstand name → general
 *
 * Category MUST come before name so that "eggs" resolves to a product search
 * even when farmstands happen to have "eggs" in their name.
 */
export function classifySearchQuery(
  query: string,
  farmstands: Farmstand[]
): SearchContext {
  const trimmed = query.trim();
  const lowerQuery = trimmed.toLowerCase();

  // 1) Check for product/category search FIRST
  const categoryKey = detectCategoryFromQuery(trimmed);
  if (categoryKey) {
    return {
      queryText: trimmed,
      searchType: 'product',
      categoryKey,
    };
  }

  // 2) Check for location search (zip code)
  if (/^\d{5}$/.test(trimmed)) {
    const zipMatch = farmstands.find((f) => f.zip === trimmed);
    return {
      queryText: trimmed,
      searchType: 'location',
      targetLocation: zipMatch
        ? { latitude: zipMatch.latitude ?? 0, longitude: zipMatch.longitude ?? 0 }
        : undefined,
    };
  }

  // 3) Check for city/location match
  const cityMatch = farmstands.find(
    (f) => f.city?.toLowerCase() === lowerQuery
  );
  if (cityMatch) {
    return {
      queryText: trimmed,
      searchType: 'location',
      targetLocation: {
        latitude: cityMatch.latitude ?? 0,
        longitude: cityMatch.longitude ?? 0,
      },
    };
  }

  // Check for partial city match (city name starts with query)
  const partialCityMatch = farmstands.find(
    (f) =>
      f.city?.toLowerCase().startsWith(lowerQuery) && lowerQuery.length >= 3
  );
  if (partialCityMatch) {
    return {
      queryText: trimmed,
      searchType: 'location',
      targetLocation: {
        latitude: partialCityMatch.latitude ?? 0,
        longitude: partialCityMatch.longitude ?? 0,
      },
    };
  }

  // 4) Check for farmstand name match
  const exactNameMatch = farmstands.find(
    (f) => f.name?.toLowerCase() === lowerQuery
  );
  if (exactNameMatch) {
    return {
      queryText: trimmed,
      searchType: 'name',
      matchedFarmstandId: exactNameMatch.id,
    };
  }

  const startsWithMatch = farmstands.find(
    (f) => f.name?.toLowerCase().startsWith(lowerQuery) && lowerQuery.length >= 2
  );
  if (startsWithMatch) {
    return {
      queryText: trimmed,
      searchType: 'name',
      matchedFarmstandId: startsWithMatch.id,
    };
  }

  // 5) Default to general search (will use text-based name search on Map)
  return {
    queryText: trimmed,
    searchType: 'general',
  };
}

/**
 * Find farmstands matching by NAME with tiered priority
 * Returns farmstands sorted by match quality (best first)
 */
export function findFarmstandsByName(
  query: string,
  farmstands: Farmstand[]
): { farmstands: Farmstand[]; bestMatchId: string | null } {
  const trimmed = query.trim();
  const lowerQuery = trimmed.toLowerCase();
  const queryLength = lowerQuery.length;

  if (!trimmed) {
    return { farmstands: [], bestMatchId: null };
  }

  // Filter to valid farmstands
  const validFarmstands = farmstands.filter((farm) => {
    if (farm.status !== 'active' && farm.status !== 'pending') return false;
    if (farm.deletedAt) return false;
    return true;
  });

  // Tier 1: Exact match (case-insensitive)
  const exactMatches = validFarmstands.filter(
    (f) => f.name?.toLowerCase() === lowerQuery
  );

  // Tier 2: Starts-with match
  const startsWithMatches = validFarmstands.filter(
    (f) =>
      f.name?.toLowerCase().startsWith(lowerQuery) &&
      f.name?.toLowerCase() !== lowerQuery // Exclude exact matches
  );

  // Tier 3: Whole-word starts-with match
  const wordStartsWithMatches = validFarmstands.filter((f) => {
    const name = f.name?.toLowerCase() || '';
    // Already matched in tier 1 or 2
    if (name === lowerQuery || name.startsWith(lowerQuery)) return false;
    // Check if any word starts with query
    const words = name.split(/\s+/);
    return words.some((word) => word.startsWith(lowerQuery));
  });

  // Tier 4: Contains match (only for 3+ char queries)
  const containsMatches =
    queryLength >= 3
      ? validFarmstands.filter((f) => {
          const name = f.name?.toLowerCase() || '';
          // Already matched in earlier tiers
          if (name === lowerQuery || name.startsWith(lowerQuery)) return false;
          const words = name.split(/\s+/);
          if (words.some((word) => word.startsWith(lowerQuery))) return false;
          // Contains match
          return name.includes(lowerQuery);
        })
      : [];

  // Combine results in tier order
  const allMatches = [
    ...exactMatches,
    ...startsWithMatches,
    ...wordStartsWithMatches,
    ...containsMatches,
  ];

  // Determine best match ID
  const bestMatchId =
    exactMatches[0]?.id ||
    startsWithMatches[0]?.id ||
    wordStartsWithMatches[0]?.id ||
    containsMatches[0]?.id ||
    null;

  return {
    farmstands: allMatches,
    bestMatchId,
  };
}

/**
 * Get smart radius filtered results for product/category searches
 * Starts at 25mi, expands to 50mi then 100mi if needed
 */
export function filterBySmartRadiusForSearch(
  farmstands: Farmstand[],
  anchorLocation: { latitude: number; longitude: number } | null,
  categoryKey?: string,
  maxResults: number = 50
): Farmstand[] {
  // Apply category filter if specified
  let filtered = categoryKey
    ? farmstands.filter((f) =>
        farmstandMatchesCategory(
          {
            offerings: f.offerings,
            categories: f.categories,
            mainProduct: f.mainProduct,
            products: f.offerings,
          },
          categoryKey
        )
      )
    : farmstands;

  // If no anchor location, return all filtered results
  if (!anchorLocation) {
    return filtered.slice(0, maxResults);
  }

  // Calculate distances
  const withDistance = filtered.map((f) => ({
    farmstand: f,
    distance: calculateDistance(
      anchorLocation.latitude,
      anchorLocation.longitude,
      f.latitude ?? 0,
      f.longitude ?? 0
    ),
  }));

  // Sort by distance
  withDistance.sort((a, b) => a.distance - b.distance);

  // Smart radius expansion: 25mi -> 50mi -> 100mi
  const radiusTiers = [25, 50, 100];
  const minResults = 8;

  for (const radius of radiusTiers) {
    const inRadius = withDistance.filter((item) => item.distance <= radius);
    if (inRadius.length >= minResults || radius === 100) {
      return inRadius.slice(0, maxResults).map((item) => item.farmstand);
    }
  }

  // Fallback: return all sorted by distance
  return withDistance.slice(0, maxResults).map((item) => item.farmstand);
}

// Helper to calculate distance (Haversine formula)
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
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
}
