/**
 * UNIFIED Farmstand Image Helper
 * ===============================
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH for all farmstand image rendering.
 *
 * Use getFarmstandDisplayImage() EVERYWHERE:
 * - Map bottom cards
 * - Explore cards
 * - Trending cards
 * - Farmstand detail hero
 * - Favorites list
 * - Search results
 *
 * RULES:
 * 1. If hero_image_url exists and is not empty -> return hero_image_url (UPLOADED)
 * 2. Else if ai_image_url exists and is not empty -> return ai_image_url (AI GENERATED)
 * 3. Else return null (caller should show placeholder or trigger generation)
 *
 * NO OTHER FALLBACKS. Remove all legacy asparagus/produce seed fallback logic.
 */

/**
 * Main product to image category mapping
 * Maps user-selected main_product values to image categories
 * Add new entries here when users select weird products like "pizza"
 */
export const MAIN_PRODUCT_TO_CATEGORY: Record<string, string> = {
  // Standard farm products
  eggs: 'eggs',
  produce: 'produce',
  vegetables: 'produce',
  fruit: 'fruit',
  honey: 'honey',
  baked_goods: 'baked_goods',
  bakery: 'baked_goods',
  bread: 'baked_goods',
  flowers: 'flowers',
  dairy: 'dairy',
  milk: 'dairy',
  cheese: 'dairy',
  meat: 'meat',
  beef: 'meat',
  pork: 'meat',
  poultry: 'meat',
  herbs: 'herbs',
  preserves: 'preserves',
  jams: 'preserves',
  plants: 'plants',
  seedlings: 'plants',
  crafts: 'crafts',
  handmade: 'crafts',
  berries: 'berries',
  apples: 'fruit',
  tomatoes: 'produce',
  corn: 'produce',
  pumpkins: 'pumpkins',

  // Non-standard products - map to closest category
  pizza: 'baked_goods',
  coffee: 'crafts',
  tea: 'herbs',
  wine: 'fruit',
  cider: 'fruit',
  soap: 'crafts',
  candles: 'crafts',
  pottery: 'crafts',
  art: 'crafts',
  woodwork: 'crafts',

  // Default fallback
  other: 'farm_default',
};

/**
 * Image URLs for each category
 * These are curated Unsplash images with NO HUMANS
 */
export const CATEGORY_IMAGES: Record<string, string[]> = {
  eggs: [
    'https://images.unsplash.com/photo-1569288052389-dac9b01c9c05?w=1200&q=80',
    'https://images.unsplash.com/photo-1498654077810-12c21d4d6dc3?w=1200&q=80',
    'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=1200&q=80',
  ],
  produce: [
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1200&q=80',
    'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=1200&q=80',
    'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80',
  ],
  fruit: [
    'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=1200&q=80',
    'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=1200&q=80',
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80',
  ],
  honey: [
    'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=1200&q=80',
    'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=1200&q=80',
    'https://images.unsplash.com/photo-1471943311424-646960669fbc?w=1200&q=80',
  ],
  baked_goods: [
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=80',
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=1200&q=80',
    'https://images.unsplash.com/photo-1517433670267-30f4906e6f73?w=1200&q=80',
  ],
  flowers: [
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&q=80',
    'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=1200&q=80',
    'https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=1200&q=80',
  ],
  dairy: [
    'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=1200&q=80',
    'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=1200&q=80',
    'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=1200&q=80',
  ],
  meat: [
    'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=1200&q=80',
    'https://images.unsplash.com/photo-1558030006-450675393462?w=1200&q=80',
    'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=1200&q=80',
  ],
  herbs: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80',
    'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=1200&q=80',
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80',
  ],
  preserves: [
    'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=1200&q=80',
    'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=1200&q=80',
    'https://images.unsplash.com/photo-1597227301620-4c5e33e5a729?w=1200&q=80',
  ],
  plants: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80',
    'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=1200&q=80',
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80',
  ],
  crafts: [
    'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=1200&q=80',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80',
    'https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=1200&q=80',
  ],
  berries: [
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80',
    'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=1200&q=80',
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80',
  ],
  pumpkins: [
    'https://images.unsplash.com/photo-1509622905150-fa66d3906e09?w=1200&q=80',
    'https://images.unsplash.com/photo-1570586437263-ab629fccc818?w=1200&q=80',
    'https://images.unsplash.com/photo-1506917728037-b6af01a7d403?w=1200&q=80',
  ],
  farm_default: [
    'https://images.unsplash.com/photo-1595855759920-86582396756a?w=1200&q=80',
    'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200&q=80',
    'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80',
  ],
};

/**
 * Default placeholder image when all else fails
 */
export const DEFAULT_PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200&q=80';

/**
 * Simple hash function for consistent variety selection
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Helper to check if URL is a valid remote URL
 */
function isValidRemoteUrl(url: string | null | undefined): url is string {
  return Boolean(url && url.trim().length > 0 && url.startsWith('http'));
}

/**
 * Derive main_product from offerings/categories if not explicitly set
 */
export function deriveMainProduct(
  mainProduct: string | null | undefined,
  offerings: string[],
  categories: string[]
): string {
  // If main_product is already set and valid, use it
  if (mainProduct && mainProduct.trim().length > 0 && mainProduct !== 'other') {
    return mainProduct.toLowerCase().trim();
  }

  // Derive from first offering
  if (offerings && offerings.length > 0) {
    const firstOffering = offerings[0].toLowerCase().trim();
    // Check if we have a mapping for it
    if (MAIN_PRODUCT_TO_CATEGORY[firstOffering]) {
      return firstOffering;
    }
    // Try to find a partial match
    for (const [product] of Object.entries(MAIN_PRODUCT_TO_CATEGORY)) {
      if (firstOffering.includes(product) || product.includes(firstOffering)) {
        return product;
      }
    }
  }

  // Derive from first category
  if (categories && categories.length > 0) {
    const firstCategory = categories[0].toLowerCase().trim();
    if (MAIN_PRODUCT_TO_CATEGORY[firstCategory]) {
      return firstCategory;
    }
  }

  // Default fallback
  return 'other';
}

/**
 * Get category for a main_product
 */
export function getCategoryForMainProduct(mainProduct: string): string {
  const lower = mainProduct.toLowerCase().trim();
  return MAIN_PRODUCT_TO_CATEGORY[lower] ?? 'farm_default';
}

/**
 * Generate a deterministic AI image URL based on farmstand ID and main_product
 * The seed ensures unique images per farmstand while being reproducible
 */
export function generateAIImageUrl(
  farmstandId: string,
  mainProduct: string
): string {
  const category = getCategoryForMainProduct(mainProduct);
  const images = CATEGORY_IMAGES[category] ?? CATEGORY_IMAGES.farm_default;

  // Use farmstand ID + main_product as seed for consistent selection
  const seed = hashString(`${farmstandId}:${mainProduct}`);
  const index = seed % images.length;

  return images[index];
}

/**
 * Result type for getFarmstandDisplayImage
 */
export interface FarmstandDisplayImageResult {
  /** The image URL to display */
  url: string;
  /** Whether this is an uploaded photo (false) or AI-generated (true) */
  isAI: boolean;
  /** Source of the image for debugging */
  source: 'hero_image_url' | 'ai_image_url' | 'generated' | 'placeholder';
}

/**
 * UNIFIED FUNCTION - Use this EVERYWHERE to get the farmstand display image
 *
 * Priority:
 * 1. hero_image_url (user uploaded photo)
 * 2. ai_image_url (previously generated AI image)
 * 3. Generate based on main_product/offerings (returns placeholder-like URL)
 *
 * @param farmstand - Farmstand data with image fields
 * @returns Image URL and metadata
 */
export function getFarmstandDisplayImage(farmstand: {
  id: string;
  hero_image_url?: string | null;
  heroImageUrl?: string | null; // camelCase alias
  ai_image_url?: string | null;
  aiImageUrl?: string | null; // camelCase alias
  main_product?: string | null;
  mainProduct?: string | null; // camelCase alias
  offerings?: string[];
  categories?: string[];
}): FarmstandDisplayImageResult {
  // Normalize field names (handle both snake_case and camelCase)
  const heroImageUrl = farmstand.hero_image_url ?? farmstand.heroImageUrl;
  const aiImageUrl = farmstand.ai_image_url ?? farmstand.aiImageUrl;
  const mainProduct = farmstand.main_product ?? farmstand.mainProduct;

  // Priority 1: Uploaded photo (hero_image_url)
  if (isValidRemoteUrl(heroImageUrl)) {
    console.log(
      `[FarmstandImage] Using UPLOADED photo for ${farmstand.id}`
    );
    return {
      url: heroImageUrl,
      isAI: false,
      source: 'hero_image_url',
    };
  }

  // Priority 2: Previously generated AI image (ai_image_url)
  if (isValidRemoteUrl(aiImageUrl)) {
    console.log(
      `[FarmstandImage] Using stored AI image for ${farmstand.id}`
    );
    return {
      url: aiImageUrl,
      isAI: true,
      source: 'ai_image_url',
    };
  }

  // Priority 3: Generate based on main_product/offerings
  // This generates a consistent URL based on the farmstand ID and products
  const derivedProduct = deriveMainProduct(
    mainProduct,
    farmstand.offerings ?? [],
    farmstand.categories ?? []
  );

  const generatedUrl = generateAIImageUrl(farmstand.id, derivedProduct);

  console.log(
    `[FarmstandImage] Generated AI image (${derivedProduct}) for ${farmstand.id}`
  );

  return {
    url: generatedUrl,
    isAI: true,
    source: 'generated',
  };
}

/**
 * Get placeholder image for loading states
 */
export function getPlaceholderImage(): string {
  return DEFAULT_PLACEHOLDER_IMAGE;
}

/**
 * Check if a farmstand needs an AI image generated
 * Returns true if hero_image_url is empty AND ai_image_url is empty
 */
export function needsAIImageGeneration(farmstand: {
  hero_image_url?: string | null;
  heroImageUrl?: string | null;
  ai_image_url?: string | null;
  aiImageUrl?: string | null;
}): boolean {
  const heroImageUrl = farmstand.hero_image_url ?? farmstand.heroImageUrl;
  const aiImageUrl = farmstand.ai_image_url ?? farmstand.aiImageUrl;

  // Don't need AI image if we have an uploaded photo
  if (isValidRemoteUrl(heroImageUrl)) {
    return false;
  }

  // Need AI image if ai_image_url is not set
  return !isValidRemoteUrl(aiImageUrl);
}
