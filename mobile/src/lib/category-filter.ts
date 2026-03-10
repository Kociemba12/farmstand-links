/**
 * Category Filter Utility
 * =======================
 *
 * SINGLE SOURCE OF TRUTH for filtering farmstands by category.
 *
 * Used by:
 * - Trending card counts
 * - Trending card tap navigation
 * - Map category filtering
 *
 * RULES:
 * 1. A farmstand matches a category if:
 *    - ANY of its products/offerings contain a matching keyword
 *    - OR its main_product matches the category key
 * 2. Same logic is used for counting AND filtering
 * 3. No farmstand shown in a category unless it actually matches
 */

import { Farmstand } from './farmer-store';

/**
 * Category definitions with keywords for matching
 * Keys are the category identifiers (e.g., "eggs", "meat")
 * Keywords are terms that indicate a farmstand sells that category
 *
 * IMPORTANT: Keywords are matched as whole words to avoid false positives
 * e.g., "chicken" in eggs context shouldn't match meat category
 */
export const CATEGORY_FILTER_KEYWORDS: Record<string, string[]> = {
  eggs: [
    'eggs',
    'egg',
    'farm fresh eggs',
    'chicken eggs',
    'duck eggs',
    'quail eggs',
    'free range eggs',
    'pasture raised eggs',
  ],
  meat: [
    // Generic meat terms
    'meat',
    'farm fresh meat',
    'pasture raised meat',
    // Beef
    'beef',
    'steak',
    'brisket',
    'ground beef',
    'burger',
    // Pork
    'pork',
    'bacon',
    'ham',
    'sausage',
    // Poultry
    'chicken',
    'whole chicken',
    'broiler',
    'turkey',
    'duck meat',
    'poultry',
    // Other meats
    'lamb',
    'mutton',
    'goat',
    'rabbit',
    'venison',
  ],
  flowers: [
    'flowers',
    'flower',
    'bouquets',
    'bouquet',
    'u-pick flowers',
    'cut flowers',
    'tulips',
    'sunflowers',
    'lavender',
    'dahlias',
    'roses',
  ],
  honey: [
    'honey',
    'raw honey',
    'local honey',
    'honeycomb',
    'bee',
    'bees',
    'beeswax',
    'hive products',
  ],
  produce: [
    'produce',
    'vegetables',
    'veggies',
    'fruit',
    'fruits',
    'tomatoes',
    'greens',
    'lettuce',
    'peppers',
    'corn',
    'squash',
    'zucchini',
    'cucumber',
    'carrots',
    'onions',
    'garlic',
    'potatoes',
    'kale',
    'spinach',
    'beans',
    'peas',
  ],
  baked_goods: [
    'baked',
    'bakery',
    'bread',
    'sourdough',
    'pastries',
    'pastry',
    'pie',
    'pies',
    'cake',
    'cakes',
    'cookies',
    'muffins',
    'scones',
    'donuts',
    'cinnamon rolls',
    'croissant',
    'brownies',
  ],
  dairy: [
    'milk',
    'cheese',
    'dairy',
    'yogurt',
    'butter',
    'cream',
    'goat cheese',
    'raw milk',
  ],
  berries: [
    'berries',
    'strawberries',
    'blueberries',
    'raspberries',
    'blackberries',
    'marionberries',
  ],
  upick: [
    'u-pick',
    'upick',
    'pick your own',
    'pyo',
  ],
  pumpkins: [
    'pumpkin',
    'pumpkins',
    'gourds',
    'fall',
  ],
  seasonal: [
    'seasonal',
    'apple',
    'apples',
    'peach',
    'peaches',
    'cherry',
    'cherries',
    'pear',
    'pears',
  ],
  herbs: [
    'herbs',
    'basil',
    'mint',
    'rosemary',
    'thyme',
    'oregano',
    'parsley',
    'cilantro',
  ],
  preserves: [
    'preserves',
    'jams',
    'jam',
    'jellies',
    'jelly',
    'pickles',
    'salsa',
    'canned',
  ],
  plants: [
    'plants',
    'seedlings',
    'nursery',
    'potted plants',
    'succulents',
    'starter plants',
  ],
  crafts: [
    'crafts',
    'handmade',
    'artisan',
    'soaps',
    'candles',
    'pottery',
  ],
};

/**
 * Category labels for display
 */
export const CATEGORY_LABELS: Record<string, string> = {
  eggs: 'Fresh Eggs',
  meat: 'Farm Fresh Meat',
  flowers: 'Flowers',
  honey: 'Honey',
  produce: 'Produce',
  baked_goods: 'Sourdough & Baked Goods',
  dairy: 'Dairy',
  berries: 'Berries',
  upick: 'U-Pick',
  pumpkins: 'Pumpkin Stands',
  seasonal: 'Seasonal Produce',
  herbs: 'Herbs',
  preserves: 'Preserves',
  plants: 'Plants',
  crafts: 'Crafts',
};

/**
 * Category images for display
 */
export const CATEGORY_IMAGES: Record<string, string> = {
  eggs: 'https://images.unsplash.com/photo-1518569656558-1f25e69d93d7?w=800',
  meat: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=800',
  flowers: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800',
  honey: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=800',
  produce: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800',
  baked_goods: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800',
  dairy: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=800',
  berries: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=800',
  upick: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=800',
  pumpkins: 'https://images.unsplash.com/photo-1509622905150-fa66d3906e09?w=800',
  seasonal: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=800',
  herbs: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800',
  preserves: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800',
  plants: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=800',
  crafts: 'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=800',
};

/**
 * Exclusion terms for categories
 * If a product/item matches an exclusion term, it should NOT be counted as matching the category
 * This prevents false positives like "chicken eggs" matching the "meat" category
 */
export const CATEGORY_EXCLUSIONS: Record<string, string[]> = {
  meat: [
    'eggs',
    'egg',
    'chicken eggs',
    'duck eggs',
    'quail eggs',
    'farm fresh eggs',
    'free range eggs',
    'pasture raised eggs',
  ],
};

/**
 * Check if a farmstand matches a category
 *
 * @param farmstand - The farmstand to check
 * @param categoryKey - The category key (e.g., "eggs", "meat")
 * @returns true if the farmstand sells products in this category
 */
export function farmstandMatchesCategory(
  farmstand: {
    offerings?: string[];
    categories?: string[];
    mainProduct?: string | null;
    main_product?: string | null;
    products?: string[];
    features?: string[];
  },
  categoryKey: string
): boolean {
  const keywords = CATEGORY_FILTER_KEYWORDS[categoryKey];
  if (!keywords || keywords.length === 0) {
    return false;
  }

  const exclusions = CATEGORY_EXCLUSIONS[categoryKey] || [];

  // Normalize main_product (handle both camelCase and snake_case)
  const mainProduct = (farmstand.mainProduct ?? farmstand.main_product ?? '').toLowerCase().trim();

  // Check if main_product matches the category key directly
  if (mainProduct === categoryKey) {
    return true;
  }

  // Check if main_product is one of the keywords (exact match)
  if (mainProduct && keywords.some((kw) => kw.toLowerCase() === mainProduct)) {
    // But make sure it's not an exclusion
    if (!exclusions.some((ex) => ex.toLowerCase() === mainProduct)) {
      return true;
    }
  }

  // Collect all individual product/offering items as separate strings
  const allItems: string[] = [];

  // Add offerings (Farmstand type uses this)
  if (farmstand.offerings && Array.isArray(farmstand.offerings)) {
    allItems.push(...farmstand.offerings);
  }

  // Add categories (Farmstand type uses this)
  if (farmstand.categories && Array.isArray(farmstand.categories)) {
    allItems.push(...farmstand.categories);
  }

  // Add products (FarmStand/map type uses this)
  if (farmstand.products && Array.isArray(farmstand.products)) {
    allItems.push(...farmstand.products);
  }

  // Add features (FarmStand/map type uses this)
  if (farmstand.features && Array.isArray(farmstand.features)) {
    allItems.push(...farmstand.features);
  }

  // Check each individual item against keywords
  for (const item of allItems) {
    const lowerItem = item.toLowerCase().trim();

    // First check if this item is an exclusion - if so, skip it entirely
    const isExcluded = exclusions.some((ex) => {
      const lowerEx = ex.toLowerCase();
      // Check for exact match or if the item contains the exclusion phrase
      return lowerItem === lowerEx || lowerItem.includes(lowerEx);
    });

    if (isExcluded) {
      // This item is excluded (e.g., "chicken eggs" for meat category)
      // Skip it - don't let it match even if it contains a keyword
      continue;
    }

    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();

      // Exact match - the item is exactly the keyword
      if (lowerItem === lowerKeyword) {
        return true;
      }

      // For single-word keywords, check for word boundary match
      if (!lowerKeyword.includes(' ')) {
        // Single word keyword - check for word boundary
        const regex = new RegExp(`\\b${escapeRegex(lowerKeyword)}\\b`, 'i');
        if (regex.test(lowerItem)) {
          return true;
        }
      } else {
        // Multi-word keyword - check if item contains the full phrase
        if (lowerItem.includes(lowerKeyword)) {
          return true;
        }
      }
    }
  }

  return false;
}

// Helper to escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Filter farmstands by category
 *
 * @param farmstands - Array of farmstands to filter
 * @param categoryKey - The category key (e.g., "eggs", "meat")
 * @returns Filtered array of farmstands that match the category
 */
export function filterFarmstandsByCategory<T extends {
  offerings?: string[];
  categories?: string[];
  mainProduct?: string | null;
  main_product?: string | null;
  products?: string[];
  features?: string[];
}>(farmstands: T[], categoryKey: string): T[] {
  return farmstands.filter((f) => farmstandMatchesCategory(f, categoryKey));
}

/**
 * Count farmstands that match a category
 *
 * @param farmstands - Array of farmstands to count
 * @param categoryKey - The category key (e.g., "eggs", "meat")
 * @returns Number of farmstands that match the category
 */
export function countFarmstandsInCategory(
  farmstands: Array<{
    offerings?: string[];
    categories?: string[];
    mainProduct?: string | null;
    main_product?: string | null;
    products?: string[];
    features?: string[];
  }>,
  categoryKey: string
): number {
  return farmstands.filter((f) => farmstandMatchesCategory(f, categoryKey)).length;
}

/**
 * Get trending categories with accurate counts
 *
 * @param farmstands - Array of active farmstands
 * @param limit - Maximum number of categories to return
 * @returns Array of category info with accurate counts
 */
export function getTrendingCategoriesWithCounts(
  farmstands: Array<{
    offerings?: string[];
    categories?: string[];
    mainProduct?: string | null;
    main_product?: string | null;
    products?: string[];
    features?: string[];
  }>,
  limit: number = 8
): Array<{ category: string; label: string; image: string; count: number }> {
  const categoryCounts: Array<{ category: string; count: number }> = [];

  // Count farmstands for each category
  for (const categoryKey of Object.keys(CATEGORY_FILTER_KEYWORDS)) {
    const count = countFarmstandsInCategory(farmstands, categoryKey);
    if (count > 0) {
      categoryCounts.push({ category: categoryKey, count });
    }
  }

  // Sort by count (descending) and take top categories
  return categoryCounts
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ category, count }) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      image: CATEGORY_IMAGES[category] ?? 'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=800',
      count,
    }));
}

/**
 * Get category key from label (reverse lookup)
 *
 * @param label - The display label (e.g., "Fresh Eggs")
 * @returns The category key (e.g., "eggs") or null if not found
 */
export function getCategoryKeyFromLabel(label: string): string | null {
  const lowerLabel = label.toLowerCase();
  for (const [key, categoryLabel] of Object.entries(CATEGORY_LABELS)) {
    if (categoryLabel.toLowerCase() === lowerLabel) {
      return key;
    }
  }
  return null;
}
