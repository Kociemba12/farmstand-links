/**
 * Photo Category Mapping Utility
 * Maps products and photos to categories for dynamic chip generation
 *
 * Priority for chip generation:
 * 1. Build chips from farmstand's products first (always show chips for categories with products)
 * 2. Assign photos to chips using photoCategoryTags (primary) or keyword matching (fallback)
 * 3. Never hide a chip just because no photos match - show all photos with a message instead
 */

import { Product, ProductCategory } from './products-store';

// Chip category type - these are the selectable photo category tags
export type ChipCategory =
  | 'all'
  | 'eggs'
  | 'produce'
  | 'fruit'
  | 'vegetables'
  | 'honey'
  | 'flowers'
  | 'meat'
  | 'baked_goods'
  | 'jams'
  | 'soap'
  | 'seasonal'
  | 'dairy'
  | 'plants'
  | 'crafts';

// All available photo category tags for farmer upload UI
export const PHOTO_CATEGORY_TAGS: ChipCategory[] = [
  'eggs',
  'fruit',
  'vegetables',
  'produce',
  'baked_goods',
  'honey',
  'jams',
  'flowers',
  'meat',
  'dairy',
  'plants',
  'seasonal',
  'soap',
  'crafts',
];

// Chip display configuration
export interface ChipConfig {
  id: ChipCategory;
  label: string;
  keywords: string[];
  productCategories: ProductCategory[];
}

// Keyword-to-category mapping
export const CHIP_CONFIGS: ChipConfig[] = [
  {
    id: 'all',
    label: 'All',
    keywords: [],
    productCategories: [],
  },
  {
    id: 'eggs',
    label: 'Eggs',
    keywords: ['egg', 'eggs', 'dozen', 'farm fresh eggs', 'free range', 'chicken eggs', 'duck eggs'],
    productCategories: ['eggs'],
  },
  {
    id: 'produce',
    label: 'Produce',
    keywords: ['produce', 'fresh', 'veggies', 'vegetables', 'garden', 'harvest'],
    productCategories: ['produce'],
  },
  {
    id: 'fruit',
    label: 'Fruit',
    keywords: ['apple', 'apples', 'pear', 'pears', 'berries', 'berry', 'peach', 'peaches', 'plum', 'plums', 'cherry', 'cherries', 'strawberry', 'strawberries', 'blueberry', 'blueberries', 'raspberry', 'raspberries', 'blackberry', 'blackberries', 'melon', 'watermelon', 'cantaloupe', 'grapes', 'citrus', 'orange', 'oranges', 'lemon', 'lemons', 'lime', 'limes', 'fruit', 'orchard'],
    productCategories: [],
  },
  {
    id: 'vegetables',
    label: 'Vegetables',
    keywords: ['pepper', 'peppers', 'tomato', 'tomatoes', 'corn', 'squash', 'cucumber', 'cucumbers', 'zucchini', 'carrot', 'carrots', 'potato', 'potatoes', 'onion', 'onions', 'garlic', 'lettuce', 'spinach', 'kale', 'cabbage', 'broccoli', 'cauliflower', 'beans', 'peas', 'beet', 'beets', 'radish', 'radishes', 'turnip', 'turnips', 'greens', 'celery', 'asparagus', 'artichoke'],
    productCategories: [],
  },
  {
    id: 'honey',
    label: 'Honey',
    keywords: ['honey', 'honeycomb', 'raw honey', 'local honey', 'bee', 'bees', 'apiary', 'beeswax'],
    productCategories: ['honey'],
  },
  {
    id: 'flowers',
    label: 'Flowers',
    keywords: ['flower', 'flowers', 'bouquet', 'bouquets', 'floral', 'bloom', 'blooms', 'arrangement', 'daisy', 'sunflower', 'rose', 'roses', 'tulip', 'tulips', 'dahlia', 'dahlias', 'lavender', 'wildflowers'],
    productCategories: ['flowers'],
  },
  {
    id: 'meat',
    label: 'Meat',
    keywords: ['beef', 'pork', 'chicken', 'turkey', 'lamb', 'sausage', 'bacon', 'ham', 'steak', 'ground', 'roast', 'meat', 'poultry', 'butcher'],
    productCategories: ['meat'],
  },
  {
    id: 'baked_goods',
    label: 'Baked Goods',
    keywords: ['bread', 'sourdough', 'cookies', 'cookie', 'pastries', 'pastry', 'pie', 'pies', 'cake', 'cakes', 'muffin', 'muffins', 'scone', 'scones', 'biscuit', 'biscuits', 'croissant', 'bagel', 'loaf', 'baked', 'bakery', 'roll', 'rolls'],
    productCategories: ['baked_goods'],
  },
  {
    id: 'jams',
    label: 'Jams',
    keywords: ['jam', 'jams', 'jelly', 'jellies', 'preserves', 'marmalade', 'spread', 'canned', 'canning', 'pickles', 'pickled', 'salsa', 'sauce', 'relish'],
    productCategories: ['preserves'],
  },
  {
    id: 'soap',
    label: 'Soap',
    keywords: ['soap', 'soaps', 'tallow', 'handmade', 'lotion', 'balm', 'salve', 'body', 'skincare', 'bath', 'candle', 'candles'],
    productCategories: ['crafts'],
  },
  {
    id: 'seasonal',
    label: 'Seasonal',
    keywords: ['seasonal', 'pumpkin', 'pumpkins', 'christmas', 'fall', 'spring', 'summer', 'winter', 'holiday', 'thanksgiving', 'halloween', 'easter', 'autumn', 'harvest festival', 'corn maze', 'hayride', 'wreath', 'wreaths', 'tree', 'trees'],
    productCategories: [],
  },
  {
    id: 'dairy',
    label: 'Dairy',
    keywords: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'dairy', 'raw milk', 'goat milk', 'goat cheese'],
    productCategories: ['dairy'],
  },
  {
    id: 'plants',
    label: 'Plants',
    keywords: ['plant', 'plants', 'seedling', 'seedlings', 'starter', 'starters', 'herb', 'herbs', 'nursery', 'potted', 'succulent', 'succulents', 'transplant', 'transplants'],
    productCategories: ['plants'],
  },
  {
    id: 'crafts',
    label: 'Crafts',
    keywords: ['craft', 'crafts', 'handmade', 'artisan', 'woodwork', 'pottery', 'textile', 'knit', 'knitted', 'crochet', 'woven', 'basket', 'baskets'],
    productCategories: ['crafts'],
  },
];

// Get chip config by ID
export function getChipConfig(chipId: ChipCategory): ChipConfig | undefined {
  return CHIP_CONFIGS.find((c) => c.id === chipId);
}

// Check if text matches any keywords for a category
export function textMatchesCategory(text: string, chipId: ChipCategory): boolean {
  if (chipId === 'all') return true;

  const config = getChipConfig(chipId);
  if (!config) return false;

  const lowerText = text.toLowerCase();
  return config.keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

// Check if a product matches a chip category
export function productMatchesCategory(product: Product, chipId: ChipCategory): boolean {
  if (chipId === 'all') return true;

  const config = getChipConfig(chipId);
  if (!config) return false;

  // Check if product category directly matches
  if (config.productCategories.includes(product.category)) {
    return true;
  }

  // Check keywords in product name and description
  const searchText = `${product.name} ${product.description || ''}`;
  return textMatchesCategory(searchText, chipId);
}

// Derive categories from farmstand products
export function getCategoriesFromProducts(products: Product[]): Set<ChipCategory> {
  const categories = new Set<ChipCategory>();
  categories.add('all'); // Always include 'All'

  for (const product of products) {
    for (const config of CHIP_CONFIGS) {
      if (config.id === 'all') continue;
      if (productMatchesCategory(product, config.id)) {
        categories.add(config.id);
      }
    }
  }

  return categories;
}

// Derive categories from farmstand offerings (fallback when no products)
export function getCategoriesFromOfferings(offerings: string[]): Set<ChipCategory> {
  const categories = new Set<ChipCategory>();
  categories.add('all');

  const combinedText = offerings.join(' ');

  for (const config of CHIP_CONFIGS) {
    if (config.id === 'all') continue;
    if (textMatchesCategory(combinedText, config.id)) {
      categories.add(config.id);
    }
  }

  return categories;
}

// Keywords that suggest a photo contains human faces - skip these for chip thumbnails
const FACE_KEYWORDS = [
  'portrait',
  'selfie',
  'family',
  'farmer',
  'person',
  'people',
  'staff',
  'team',
  'owner',
  'me',
  'us',
  'smile',
  'face',
  'headshot',
  'profile',
  'group',
  'kids',
  'children',
  'baby',
  'customer',
  'customers',
  'vendor',
  'vendors',
];

// Check if text suggests the photo contains a human face
export function textSuggestsFace(text: string): boolean {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return FACE_KEYWORDS.some((keyword) => lowerText.includes(keyword));
}

// Photo with associated metadata for filtering
export interface PhotoWithMetadata {
  url: string;
  index: number;
  categories: ChipCategory[];
  caption?: string;
  tags?: string[];
  // Primary way to categorize photos - farmer-selected tags during upload
  photoCategoryTags?: ChipCategory[];
  // Flag for face detection - photos with faces should not be used as chip thumbnails
  hasFace?: boolean;
}

// Extract searchable text from a URL (filename, path segments)
function extractTextFromUrl(url: string): string {
  try {
    // Get the pathname and filename
    const pathname = new URL(url).pathname;
    // Remove extension and split by common separators
    const textParts = pathname
      .replace(/\.[^/.]+$/, '') // Remove extension
      .split(/[/_-]/) // Split by common separators
      .filter(Boolean)
      .join(' ');
    return textParts.toLowerCase();
  } catch {
    // If URL parsing fails, just use the whole string
    return url.toLowerCase();
  }
}

// Assign categories to a photo based on its metadata
// Priority: photoCategoryTags > caption/tag keyword matching > URL keyword matching > fallback to 'all'
export function assignPhotoCategories(
  photoUrl: string,
  index: number,
  caption?: string,
  tags?: string[],
  products?: Product[],
  photoCategoryTags?: ChipCategory[]
): PhotoWithMetadata {
  const categories: ChipCategory[] = ['all'];

  // Build search text from caption and tags
  const captionTagsText = [caption, ...(tags || [])].filter(Boolean).join(' ');
  const hasFace = textSuggestsFace(captionTagsText);

  // Priority 1: Use photoCategoryTags if provided (farmer-selected)
  if (photoCategoryTags && photoCategoryTags.length > 0) {
    for (const tag of photoCategoryTags) {
      if (tag !== 'all' && !categories.includes(tag)) {
        categories.push(tag);
      }
    }
  } else {
    // Priority 2: Keyword matching from caption/tags
    if (captionTagsText) {
      for (const config of CHIP_CONFIGS) {
        if (config.id === 'all') continue;
        if (textMatchesCategory(captionTagsText, config.id)) {
          categories.push(config.id);
        }
      }
    }

    // Priority 3: If no matches from caption/tags, try URL extraction
    if (categories.length === 1) {
      const urlText = extractTextFromUrl(photoUrl);
      for (const config of CHIP_CONFIGS) {
        if (config.id === 'all') continue;
        if (textMatchesCategory(urlText, config.id)) {
          categories.push(config.id);
        }
      }
    }
  }

  return {
    url: photoUrl,
    index,
    categories,
    caption,
    tags,
    photoCategoryTags,
    hasFace,
  };
}

// Generate dynamic chips for a farmstand
export interface DynamicChip {
  id: ChipCategory;
  label: string;
  thumbnailUrl: string;
  photoCount: number;
  hasMatchingPhotos: boolean; // True if photos are tagged for this category
}

/**
 * Generate dynamic chips based on products first, then match photos
 *
 * Key behaviors:
 * 1. Always show chips for categories that the stand has products for
 * 2. Never hide a chip just because no photos match
 * 3. Each chip gets a unique thumbnail (no reuse)
 * 4. Skip photos with faces for thumbnails
 * 5. Fallback to hero image if no category-specific photo exists
 */
export function generateDynamicChips(
  photos: string[],
  photoMetadata: PhotoWithMetadata[],
  products: Product[],
  offerings: string[],
  maxChips: number = 8
): DynamicChip[] {
  // No photos = no chips to show
  if (photos.length === 0) {
    return [];
  }

  // Step 1: Get relevant categories from PRODUCTS first (not photos)
  let relevantCategories: Set<ChipCategory>;

  if (products.length > 0) {
    relevantCategories = getCategoriesFromProducts(products);
  } else {
    relevantCategories = getCategoriesFromOfferings(offerings);
  }

  // Always include 'all'
  relevantCategories.add('all');

  // Track which photo URLs have been used as thumbnails to avoid reuse
  const usedThumbnailUrls = new Set<string>();

  // Hero image (first photo) - used as fallback thumbnail
  const heroImageUrl = photos[0];

  // Helper: Find a valid thumbnail for a category
  // Returns first matching photo that hasn't been used and doesn't have a face
  const findValidThumbnail = (
    matchingPhotos: PhotoWithMetadata[],
    categoryId: ChipCategory
  ): string => {
    // First pass: find unused non-face photo that matches the category
    for (const photo of matchingPhotos) {
      if (!usedThumbnailUrls.has(photo.url) && !photo.hasFace) {
        return photo.url;
      }
    }

    // Second pass: for 'all' category, try any unused non-face photo
    if (categoryId === 'all') {
      for (const photo of photoMetadata) {
        if (!usedThumbnailUrls.has(photo.url) && !photo.hasFace) {
          return photo.url;
        }
      }
    }

    // Third pass: find any unused photo from all photos (for categories with no matches)
    for (const photo of photoMetadata) {
      if (!usedThumbnailUrls.has(photo.url) && !photo.hasFace) {
        return photo.url;
      }
    }

    // Fallback: use hero image (even if used or has face) as last resort
    return heroImageUrl;
  };

  // Build chips
  const chips: DynamicChip[] = [];

  for (const config of CHIP_CONFIGS) {
    // Only include categories that are relevant for this stand
    if (!relevantCategories.has(config.id)) continue;

    // Find matching photos for this category
    let matchingPhotos: PhotoWithMetadata[];

    if (config.id === 'all') {
      matchingPhotos = photoMetadata;
    } else {
      // Check both photoCategoryTags (primary) and inferred categories (fallback)
      matchingPhotos = photoMetadata.filter((p) => {
        // Primary: check photoCategoryTags
        if (p.photoCategoryTags && p.photoCategoryTags.includes(config.id)) {
          return true;
        }
        // Fallback: check inferred categories
        return p.categories.includes(config.id);
      });
    }

    const photoCount = config.id === 'all' ? photos.length : matchingPhotos.length;
    const hasMatchingPhotos = config.id === 'all' || matchingPhotos.length > 0;

    // Find thumbnail - prioritize category-matched photos, fallback to hero
    const thumbnailUrl = findValidThumbnail(matchingPhotos, config.id);

    // Mark thumbnail as used
    usedThumbnailUrls.add(thumbnailUrl);

    chips.push({
      id: config.id,
      label: config.label,
      thumbnailUrl,
      photoCount: config.id === 'all' ? photos.length : photoCount,
      hasMatchingPhotos,
    });
  }

  // Sort: 'all' first, then by photo count (descending), then alphabetically
  chips.sort((a, b) => {
    if (a.id === 'all') return -1;
    if (b.id === 'all') return 1;
    // Prioritize chips with matching photos
    if (a.hasMatchingPhotos !== b.hasMatchingPhotos) {
      return a.hasMatchingPhotos ? -1 : 1;
    }
    if (a.photoCount !== b.photoCount) return b.photoCount - a.photoCount;
    return a.label.localeCompare(b.label);
  });

  // Limit to maxChips
  return chips.slice(0, maxChips);
}

// Filter result with metadata about whether matches were found
export interface FilterResult {
  photos: PhotoWithMetadata[];
  hasMatchingPhotos: boolean;
  category: ChipCategory;
}

// Filter photos by category - returns ONLY matching photos (empty array if none match)
export function filterPhotosByCategory(
  photoMetadata: PhotoWithMetadata[],
  category: ChipCategory
): FilterResult {
  if (category === 'all') {
    return {
      photos: photoMetadata,
      hasMatchingPhotos: true,
      category,
    };
  }

  // Find photos that match this category (via tags or inferred categories)
  // Uses the stable key (e.g., 'baked_goods') not the display label ('Baked Goods')
  const directMatches = photoMetadata.filter((p) => {
    // Primary: check photoCategoryTags (farmer-selected, stored as keys)
    if (p.photoCategoryTags && p.photoCategoryTags.includes(category)) {
      return true;
    }
    // Fallback: check inferred categories (also stored as keys)
    return p.categories.includes(category);
  });

  // Return ONLY matching photos - NO fallback to all photos
  // If no matches, return empty array so UI can show proper empty state
  return {
    photos: directMatches,
    hasMatchingPhotos: directMatches.length > 0,
    category,
  };
}

// ============================================================================
// NEW: PhotoData-based filtering (uses persistent categoryKeys)
// ============================================================================

import type { PhotoData, PhotoCategoryKey } from './photo-store';

// Filter result for PhotoData-based filtering
export interface PhotoDataFilterResult {
  photos: PhotoData[];
  hasMatchingPhotos: boolean;
  category: PhotoCategoryKey;
}

/**
 * Filter PhotoData by category key - STRICT filtering, no fallbacks
 * @param photos - Array of PhotoData with categoryKeys
 * @param categoryKey - The category key to filter by (e.g., 'baked_goods', not 'Baked Goods')
 * @returns Only photos that match the category, or all photos if categoryKey is 'all'
 */
export function filterPhotoDataByCategory(
  photos: PhotoData[],
  categoryKey: PhotoCategoryKey
): PhotoDataFilterResult {
  if (categoryKey === 'all') {
    return {
      photos,
      hasMatchingPhotos: true,
      category: categoryKey,
    };
  }

  // STRICT filtering: Only return photos that have this category key
  const matches = photos.filter(p =>
    p.categoryKeys && p.categoryKeys.includes(categoryKey)
  );

  return {
    photos: matches,
    hasMatchingPhotos: matches.length > 0,
    category: categoryKey,
  };
}

/**
 * Generate chips from PhotoData with proper thumbnails
 * STRICT RULES:
 * 1. Thumbnail for each chip comes ONLY from photos that have that category key
 * 2. If no photos have the category key, don't show that chip (except 'all')
 * 3. Never use a mismatched photo as a thumbnail
 */
export function generateChipsFromPhotoData(
  photos: PhotoData[],
  products: Product[],
  offerings: string[],
  maxChips: number = 8
): DynamicChip[] {
  if (photos.length === 0) {
    return [];
  }

  // Build chips ONLY from categories that photos are actually tagged with
  // This ensures we never show a chip with 0 matching photos
  const categoriesWithPhotos = new Set<ChipCategory>();
  categoriesWithPhotos.add('all'); // Always include 'all'

  for (const photo of photos) {
    for (const key of photo.categoryKeys || []) {
      if (key !== 'uncategorized' && key !== 'all') {
        categoriesWithPhotos.add(key as ChipCategory);
      }
    }
  }

  const usedThumbnailUrls = new Set<string>();
  const chips: DynamicChip[] = [];

  for (const config of CHIP_CONFIGS) {
    // STRICT: Only include chips for categories that have matching photos
    if (!categoriesWithPhotos.has(config.id)) continue;

    // Find photos that have this category key
    const matchingPhotos = config.id === 'all'
      ? photos
      : photos.filter(p => p.categoryKeys?.includes(config.id as PhotoCategoryKey));

    const photoCount = matchingPhotos.length;

    // Skip categories with no matching photos (except 'all')
    if (config.id !== 'all' && photoCount === 0) continue;

    // Find thumbnail - MUST be from a photo that has this category key
    let thumbnailUrl = '';

    // Find first unused photo from matching set
    for (const photo of matchingPhotos) {
      if (!usedThumbnailUrls.has(photo.url)) {
        thumbnailUrl = photo.url;
        break;
      }
    }

    // If all matching photos are used, reuse the first matching photo
    if (!thumbnailUrl && matchingPhotos.length > 0) {
      thumbnailUrl = matchingPhotos[0].url;
    }

    // Skip if we can't find ANY matching photo (shouldn't happen but be safe)
    if (!thumbnailUrl) continue;

    usedThumbnailUrls.add(thumbnailUrl);

    chips.push({
      id: config.id,
      label: config.label, // Always use the config label, never truncated
      thumbnailUrl,
      photoCount: config.id === 'all' ? photos.length : photoCount,
      hasMatchingPhotos: true, // Always true since we skip empty categories
    });
  }

  // Sort: 'all' first, then by photo count (descending), then alphabetically
  chips.sort((a, b) => {
    if (a.id === 'all') return -1;
    if (b.id === 'all') return 1;
    if (a.photoCount !== b.photoCount) return b.photoCount - a.photoCount;
    return a.label.localeCompare(b.label);
  });

  return chips.slice(0, maxChips);
}
