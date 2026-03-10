/**
 * Photo Store - Persistent storage for photo metadata with category tags
 *
 * This store manages photo data separate from the farmstand photos array,
 * allowing us to store category tags and other metadata that persists.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PHOTO_STORE_KEY = '@farmstand_photo_metadata';

/**
 * STRICT Category Keywords - Only tag when confidence is clear
 * These keywords ONLY match photo captions/filenames, NOT farmstand name/description
 */
const STRICT_CATEGORY_KEYWORDS: Record<string, string[]> = {
  eggs: ['egg', 'eggs', 'dozen', 'carton'],
  baked_goods: ['bread', 'sourdough', 'loaf', 'pastry', 'pastries', 'pie', 'pies', 'cookie', 'cookies', 'muffin', 'muffins', 'baked', 'bakery', 'scone', 'scones', 'croissant', 'bagel', 'cake', 'cakes'],
  jams: ['jam', 'jams', 'jelly', 'jellies', 'preserve', 'preserves', 'marmalade', 'canned', 'canning'],
  honey: ['honey', 'honeycomb', 'comb', 'beeswax'],
  fruit: ['apple', 'apples', 'pear', 'pears', 'peach', 'peaches', 'plum', 'plums', 'berry', 'berries', 'grape', 'grapes', 'cherry', 'cherries', 'strawberry', 'strawberries', 'blueberry', 'blueberries', 'raspberry', 'raspberries', 'blackberry', 'blackberries', 'melon', 'watermelon', 'cantaloupe', 'citrus', 'orange', 'oranges', 'lemon', 'lemons'],
  produce: ['pepper', 'peppers', 'tomato', 'tomatoes', 'cucumber', 'cucumbers', 'squash', 'zucchini', 'corn', 'lettuce', 'onion', 'onions', 'garlic', 'produce', 'vegetable', 'vegetables', 'veggie', 'veggies', 'carrot', 'carrots', 'potato', 'potatoes', 'beet', 'beets', 'spinach', 'kale', 'cabbage', 'broccoli'],
  flowers: ['flower', 'flowers', 'bouquet', 'bouquets', 'bloom', 'blooms', 'floral', 'arrangement', 'sunflower', 'sunflowers', 'rose', 'roses', 'tulip', 'tulips', 'dahlia', 'dahlias', 'lavender'],
  meat: ['beef', 'pork', 'chicken', 'turkey', 'lamb', 'sausage', 'bacon', 'ham', 'steak', 'meat', 'poultry', 'butcher'],
  dairy: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'dairy'],
  plants: ['plant', 'plants', 'seedling', 'seedlings', 'starter', 'starters', 'herb', 'herbs', 'nursery', 'potted', 'succulent', 'succulents'],
  seasonal: ['pumpkin', 'pumpkins', 'christmas', 'halloween', 'thanksgiving', 'easter', 'wreath', 'wreaths', 'corn maze', 'hayride'],
  soap: ['soap', 'soaps', 'lotion', 'balm', 'salve', 'skincare', 'candle', 'candles'],
  crafts: ['craft', 'crafts', 'handmade', 'artisan', 'woodwork', 'pottery', 'basket', 'baskets', 'woven'],
};

// Photo category key type - stable keys for filtering (not display labels)
export type PhotoCategoryKey =
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
  | 'seasonal'
  | 'dairy'
  | 'plants'
  | 'soap'
  | 'crafts'
  | 'uncategorized';

// Photo data with persistent category tags
export interface PhotoData {
  id: string; // Unique ID (can be URL hash or generated)
  url: string;
  farmstandId: string;
  categoryKeys: PhotoCategoryKey[]; // Tags stored as stable keys
  caption?: string;
  createdAt: string;
  taggedAt?: string; // When tags were assigned (for backfill tracking)
  isBackfilled?: boolean; // True if tags were auto-assigned
}

// Map of farmstandId -> array of PhotoData
type PhotoMetadataMap = Record<string, PhotoData[]>;

interface PhotoStore {
  // State
  photoMetadata: PhotoMetadataMap;
  isLoaded: boolean;

  // Actions
  loadPhotoMetadata: () => Promise<void>;
  savePhotoMetadata: () => Promise<void>;

  // Get photos for a farmstand (with backfill if needed)
  getPhotosForFarmstand: (
    farmstandId: string,
    photoUrls: string[],
    productText?: string
  ) => PhotoData[];

  // Update tags for a specific photo
  updatePhotoTags: (
    farmstandId: string,
    photoUrl: string,
    categoryKeys: PhotoCategoryKey[]
  ) => void;

  // Backfill tags for photos missing them
  backfillPhotoTags: (
    farmstandId: string,
    photoUrls: string[],
    productText?: string
  ) => PhotoData[];

  // RETAG: Clear and re-tag all photos for a farmstand using strict rules
  retagAllPhotos: (
    farmstandId: string,
    photoUrls: string[]
  ) => PhotoData[];
}

// Generate a stable ID from URL
function generatePhotoId(url: string): string {
  // Simple hash function for URL
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `photo_${Math.abs(hash).toString(36)}`;
}

// Extract searchable text from URL for keyword matching
function extractTextFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    // Remove extension and split by common separators
    return pathname
      .replace(/\.[^/.]+$/, '')
      .split(/[/_-]/)
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * STRICT keyword matching - only returns categories with clear confidence
 * IMPORTANT: Do NOT use farmstand name/description for matching - only photo-specific text
 */
function strictMatchCategory(text: string, categoryKey: string): boolean {
  const keywords = STRICT_CATEGORY_KEYWORDS[categoryKey];
  if (!keywords) return false;

  const lowerText = text.toLowerCase();

  // Use word boundary matching to avoid partial matches
  return keywords.some(keyword => {
    const lowerKeyword = keyword.toLowerCase();
    // Check for whole word match (with word boundaries)
    const regex = new RegExp(`\\b${lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(lowerText);
  });
}

/**
 * Infer category keys from text using STRICT keyword matching
 * Only tags when confidence is clear - defaults to 'uncategorized' if no match
 */
function inferCategoryKeysStrict(text: string): PhotoCategoryKey[] {
  const keys: PhotoCategoryKey[] = [];

  // Only check against the strict keywords
  for (const categoryKey of Object.keys(STRICT_CATEGORY_KEYWORDS)) {
    if (strictMatchCategory(text, categoryKey)) {
      keys.push(categoryKey as PhotoCategoryKey);
    }
  }

  // If no matches found, mark as uncategorized - do NOT guess
  if (keys.length === 0) {
    keys.push('uncategorized');
  }

  return keys;
}

export const usePhotoStore = create<PhotoStore>((set, get) => ({
  photoMetadata: {},
  isLoaded: false,

  loadPhotoMetadata: async () => {
    try {
      const stored = await AsyncStorage.getItem(PHOTO_STORE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PhotoMetadataMap;
        set({ photoMetadata: parsed, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch (error) {
      console.error('Failed to load photo metadata:', error);
      set({ isLoaded: true });
    }
  },

  savePhotoMetadata: async () => {
    try {
      const { photoMetadata } = get();
      await AsyncStorage.setItem(PHOTO_STORE_KEY, JSON.stringify(photoMetadata));
    } catch (error) {
      console.error('Failed to save photo metadata:', error);
    }
  },

  getPhotosForFarmstand: (farmstandId, photoUrls, productText) => {
    const { photoMetadata, backfillPhotoTags } = get();
    const existingPhotos = photoMetadata[farmstandId] || [];

    // Check if we have all photos with tags
    const existingUrls = new Set(existingPhotos.map(p => p.url));
    const missingUrls = photoUrls.filter(url => !existingUrls.has(url));
    const needsBackfill = existingPhotos.some(p => !p.categoryKeys || p.categoryKeys.length === 0);

    if (missingUrls.length > 0 || needsBackfill) {
      // Backfill missing/untagged photos
      return backfillPhotoTags(farmstandId, photoUrls, productText);
    }

    // Return existing photos in the order of photoUrls
    return photoUrls.map(url => {
      const existing = existingPhotos.find(p => p.url === url);
      if (existing) return existing;
      // Shouldn't happen, but create placeholder
      return {
        id: generatePhotoId(url),
        url,
        farmstandId,
        categoryKeys: ['uncategorized'] as PhotoCategoryKey[],
        createdAt: new Date().toISOString(),
      };
    });
  },

  updatePhotoTags: (farmstandId, photoUrl, categoryKeys) => {
    const { photoMetadata, savePhotoMetadata } = get();
    const photos = photoMetadata[farmstandId] || [];

    const photoIndex = photos.findIndex(p => p.url === photoUrl);
    if (photoIndex >= 0) {
      photos[photoIndex] = {
        ...photos[photoIndex],
        categoryKeys,
        taggedAt: new Date().toISOString(),
        isBackfilled: false, // Manual tagging overrides backfill
      };
    } else {
      // Create new photo entry
      photos.push({
        id: generatePhotoId(photoUrl),
        url: photoUrl,
        farmstandId,
        categoryKeys,
        createdAt: new Date().toISOString(),
        taggedAt: new Date().toISOString(),
        isBackfilled: false,
      });
    }

    set({
      photoMetadata: {
        ...photoMetadata,
        [farmstandId]: photos,
      },
    });

    // Save to persistent storage
    savePhotoMetadata();
  },

  backfillPhotoTags: (farmstandId, photoUrls, productText) => {
    const { photoMetadata, savePhotoMetadata } = get();
    const existingPhotos = photoMetadata[farmstandId] || [];
    const existingByUrl = new Map(existingPhotos.map(p => [p.url, p]));

    const updatedPhotos: PhotoData[] = photoUrls.map((url, index) => {
      const existing = existingByUrl.get(url);

      // If already has valid tags, keep them
      if (existing?.categoryKeys && existing.categoryKeys.length > 0) {
        return existing;
      }

      // Infer tags from URL ONLY - do NOT use productText (farmstand name/description)
      // This prevents over-tagging where all photos get tagged based on farmstand offerings
      const urlText = extractTextFromUrl(url);
      const inferredKeys = inferCategoryKeysStrict(urlText);

      return {
        id: existing?.id || generatePhotoId(url),
        url,
        farmstandId,
        categoryKeys: inferredKeys,
        caption: existing?.caption,
        createdAt: existing?.createdAt || new Date().toISOString(),
        taggedAt: new Date().toISOString(),
        isBackfilled: true,
      };
    });

    // Update store
    set({
      photoMetadata: {
        ...photoMetadata,
        [farmstandId]: updatedPhotos,
      },
    });

    // Save to persistent storage
    savePhotoMetadata();

    return updatedPhotos;
  },

  /**
   * RETAG ALL PHOTOS - One-time migration to fix incorrectly tagged photos
   * Clears existing categoryKeys and re-tags using strict URL-only matching
   */
  retagAllPhotos: (farmstandId, photoUrls) => {
    const { photoMetadata, savePhotoMetadata } = get();
    const existingPhotos = photoMetadata[farmstandId] || [];
    const existingByUrl = new Map(existingPhotos.map(p => [p.url, p]));

    console.log(`[PhotoStore] Retagging ${photoUrls.length} photos for farmstand ${farmstandId}`);

    const retaggedPhotos: PhotoData[] = photoUrls.map((url) => {
      const existing = existingByUrl.get(url);

      // ALWAYS re-infer tags from URL only - ignore previous tags
      const urlText = extractTextFromUrl(url);
      const inferredKeys = inferCategoryKeysStrict(urlText);

      console.log(`[PhotoStore] URL: ${url.substring(0, 50)}... -> Tags: ${inferredKeys.join(', ')}`);

      return {
        id: existing?.id || generatePhotoId(url),
        url,
        farmstandId,
        categoryKeys: inferredKeys,
        caption: existing?.caption,
        createdAt: existing?.createdAt || new Date().toISOString(),
        taggedAt: new Date().toISOString(),
        isBackfilled: true, // Mark as auto-tagged
      };
    });

    // Update store with fresh tags
    set({
      photoMetadata: {
        ...photoMetadata,
        [farmstandId]: retaggedPhotos,
      },
    });

    // Save to persistent storage
    savePhotoMetadata();

    console.log(`[PhotoStore] Retag complete for ${farmstandId}`);
    return retaggedPhotos;
  },
}));

// Category key to display label mapping
const CATEGORY_LABELS: Record<PhotoCategoryKey, string> = {
  all: 'All',
  eggs: 'Eggs',
  produce: 'Produce',
  fruit: 'Fruit',
  vegetables: 'Vegetables',
  honey: 'Honey',
  flowers: 'Flowers',
  meat: 'Meat',
  baked_goods: 'Baked Goods',
  jams: 'Jams',
  seasonal: 'Seasonal',
  dairy: 'Dairy',
  plants: 'Plants',
  soap: 'Soap',
  crafts: 'Crafts',
  uncategorized: 'Uncategorized',
};

// Helper to get the label for a category key
export function getCategoryLabel(key: PhotoCategoryKey): string {
  return CATEGORY_LABELS[key] || key;
}

// All available category keys for tagging UI (excluding 'all')
export const TAGGABLE_CATEGORY_KEYS: PhotoCategoryKey[] = [
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
