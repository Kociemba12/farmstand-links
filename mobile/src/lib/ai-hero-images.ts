/**
 * AI-Generated Hero Images for Unclaimed/Unverified Farmstands
 *
 * These images are used when a Farmstand:
 * - Is unclaimed (ownership_status = "unclaimed")
 * - Is pending verification (verification_status = "PENDING_VERIFICATION")
 * - Has no owner-uploaded hero image
 *
 * HARD RULES:
 * - ABSOLUTELY NO PEOPLE, faces, hands, silhouettes, or human figures
 * - Images are generic and illustrative only
 * - No text, logos, signage, or branded items
 * - Style: Realistic photography, farm products and structures only
 */

import type { ProductCategory } from './products-store';
import type { ClaimStatus, VerificationStatus } from './farmer-store';

/**
 * Multiple image variations per category - NO HUMANS in any image
 */
export const AI_HERO_IMAGE_VARIANTS: Record<string, string[]> = {
  // Flowers - flower fields, bouquets (no people)
  flowers: [
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&q=80',
    'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=1200&q=80',
    'https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=1200&q=80',
  ],

  // Produce - vegetables, harvest scenes (no people)
  produce: [
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1200&q=80',
    'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=1200&q=80',
    'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80',
  ],

  // Eggs - cartons, nests (no people)
  eggs: [
    'https://images.unsplash.com/photo-1569288052389-dac9b01c9c05?w=1200&q=80',
    'https://images.unsplash.com/photo-1498654077810-12c21d4d6dc3?w=1200&q=80',
    'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=1200&q=80',
  ],

  // Meat - farm meats (no people)
  meat: [
    'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=1200&q=80',
    'https://images.unsplash.com/photo-1558030006-450675393462?w=1200&q=80',
    'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=1200&q=80',
  ],

  // Honey - jars, honeycomb (no people)
  honey: [
    'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=1200&q=80',
    'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=1200&q=80',
    'https://images.unsplash.com/photo-1471943311424-646960669fbc?w=1200&q=80',
  ],

  // Dairy - milk, cheese (no people)
  dairy: [
    'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=1200&q=80',
    'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=1200&q=80',
    'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=1200&q=80',
  ],

  // Baked goods - breads, pastries (no people)
  baked_goods: [
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=80',
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=1200&q=80',
    'https://images.unsplash.com/photo-1517433670267-30f4906e6f73?w=1200&q=80',
  ],

  // Preserves - jams, mason jars (no people)
  preserves: [
    'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=1200&q=80',
    'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=1200&q=80',
    'https://images.unsplash.com/photo-1597227301620-4c5e33e5a729?w=1200&q=80',
  ],

  // Plants - seedlings, nursery (no people)
  plants: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80',
    'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=1200&q=80',
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80',
  ],

  // Crafts - handmade goods (no people)
  crafts: [
    'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=1200&q=80',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80',
    'https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=1200&q=80',
  ],

  // Mixed/General - farmstand scenes (no people)
  mixed: [
    'https://images.unsplash.com/photo-1595855759920-86582396756a?w=1200&q=80',
    'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1200&q=80',
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&q=80',
  ],

  // Default - farm scenes (no people)
  default: [
    'https://images.unsplash.com/photo-1595855759920-86582396756a?w=1200&q=80',
    'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200&q=80',
    'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80',
  ],
};

/**
 * Simple hash function to generate consistent seed from farmstand ID
 */
function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Get an image variant index based on farmstand ID for consistent selection
 */
function getVariantIndex(farmstandId: string, variantCount: number): number {
  return hashStringToNumber(farmstandId) % variantCount;
}

/**
 * Get varied image URL for a category based on farmstand ID
 */
export function getVariedHeroImage(category: string, farmstandId: string): string {
  const variants = AI_HERO_IMAGE_VARIANTS[category] ?? AI_HERO_IMAGE_VARIANTS.default;
  const index = getVariantIndex(farmstandId, variants.length);
  return variants[index];
}

// Legacy single-image map for backward compatibility
export const AI_HERO_IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(AI_HERO_IMAGE_VARIANTS).map(([key, variants]) => [key, variants[0]])
);

// Map product categories to AI image keys
export const CATEGORY_TO_IMAGE_KEY: Record<ProductCategory | string, string> = {
  flowers: 'flowers',
  produce: 'produce',
  eggs: 'eggs',
  meat: 'meat',
  honey: 'honey',
  dairy: 'dairy',
  baked_goods: 'baked_goods',
  preserves: 'preserves',
  plants: 'plants',
  crafts: 'crafts',
  other: 'mixed',
};

/**
 * Determines if a farmstand should use an AI-generated hero image
 */
export function shouldUseAIHeroImage(params: {
  claimStatus: ClaimStatus;
  verificationStatus: VerificationStatus;
  photos: string[];
  mainPhotoIndex: number;
}): boolean {
  const { claimStatus, verificationStatus, photos, mainPhotoIndex } = params;

  // Has a valid owner-uploaded photo?
  const hasOwnerPhoto = photos && photos.length > 0 && photos[mainPhotoIndex];

  // Use AI image if:
  // 1. Unclaimed
  // 2. Pending verification
  // 3. No owner-uploaded photo (even if verified)
  if (claimStatus === 'unclaimed') return true;
  if (verificationStatus === 'PENDING_VERIFICATION') return true;
  if (!hasOwnerPhoto) return true;

  // Verified owner with uploaded photo - use their photo
  return false;
}

/**
 * Gets the appropriate AI hero image URL based on farmstand categories
 * Now supports variety with farmstandId
 */
export function getAIHeroImageForCategories(categories: string[], farmstandId?: string): string {
  if (!categories || categories.length === 0) {
    return farmstandId
      ? getVariedHeroImage('default', farmstandId)
      : AI_HERO_IMAGES.default;
  }

  // Priority order for category matching
  const priorityCategories: (keyof typeof AI_HERO_IMAGES)[] = [
    'flowers',
    'produce',
    'eggs',
    'honey',
    'meat',
    'dairy',
    'baked_goods',
    'preserves',
    'plants',
    'crafts',
  ];

  // Find the first matching category
  for (const priorityCat of priorityCategories) {
    const found = categories.find(
      cat => cat.toLowerCase().includes(priorityCat) ||
             CATEGORY_TO_IMAGE_KEY[cat.toLowerCase()] === priorityCat
    );
    if (found) {
      return farmstandId
        ? getVariedHeroImage(priorityCat, farmstandId)
        : AI_HERO_IMAGES[priorityCat];
    }
  }

  // If multiple categories or no specific match, use mixed/general
  if (categories.length > 2) {
    return farmstandId
      ? getVariedHeroImage('mixed', farmstandId)
      : AI_HERO_IMAGES.mixed;
  }

  return farmstandId
    ? getVariedHeroImage('default', farmstandId)
    : AI_HERO_IMAGES.default;
}

/**
 * Gets the hero image URL for a farmstand, considering ownership and verification status
 * Now supports variety with farmstandId
 *
 * STANDARDIZED: hero_image_url is THE SINGLE SOURCE OF TRUTH
 */
export function getHeroImageUrl(params: {
  farmstandId?: string;
  claimStatus: ClaimStatus;
  verificationStatus: VerificationStatus;
  photos: string[];
  mainPhotoIndex: number;
  categories: string[];
  offerings?: string[];
  heroPhotoUrl?: string | null;
  aiPhotoUrl?: string | null;
  heroImageUrl?: string | null;
  // NEW: Main product AI image fields
  mainProduct?: string | null;
  aiImageUrl?: string | null;
  aiImageSeed?: string | null;
}): { url: string; isAIGenerated: boolean } {
  const { farmstandId, claimStatus, verificationStatus, photos, mainPhotoIndex, categories, offerings, heroPhotoUrl, aiPhotoUrl, heroImageUrl, mainProduct, aiImageUrl, aiImageSeed } = params;

  // Helper to check if URL is a valid remote URL (not a local file:// URI)
  const isValidRemoteUrl = (url: string | null | undefined): url is string => {
    return Boolean(url && url.startsWith('http'));
  };

  // PRIORITY 1: hero_image_url - THE SINGLE SOURCE OF TRUTH
  // All uploaded photos should be stored here
  if (isValidRemoteUrl(heroImageUrl)) {
    console.log(`[HeroImage] Using UPLOADED photo for farmstand ${farmstandId}`);
    return {
      url: heroImageUrl,
      isAIGenerated: false,
    };
  }

  // LEGACY: heroPhotoUrl (deprecated - migrate to hero_image_url)
  if (isValidRemoteUrl(heroPhotoUrl)) {
    console.log(`[HeroImage] Using UPLOADED photo (legacy heroPhotoUrl) for farmstand ${farmstandId}`);
    return {
      url: heroPhotoUrl,
      isAIGenerated: false,
    };
  }

  // LEGACY: First photo from photos array (deprecated)
  const mainPhoto = photos?.[mainPhotoIndex];
  const hasOwnerPhoto = isValidRemoteUrl(mainPhoto);
  if (hasOwnerPhoto) {
    console.log(`[HeroImage] Using UPLOADED photo (legacy photos array) for farmstand ${farmstandId}`);
    return {
      url: mainPhoto,
      isAIGenerated: false,
    };
  }

  // PRIORITY 2: NEW ai_image_url - Unique AI image based on main_product
  if (isValidRemoteUrl(aiImageUrl)) {
    console.log(`[HeroImage] Using AI image (main_product: ${mainProduct}, seed: ${aiImageSeed}) for farmstand ${farmstandId}`);
    return {
      url: aiImageUrl,
      isAIGenerated: true,
    };
  }

  // PRIORITY 3: Category-based image (generated dynamically)
  const allCategories = [...(categories || []), ...(offerings || [])];
  const categoryImage = getAIHeroImageForCategories(allCategories, farmstandId);
  if (categoryImage && categoryImage !== AI_HERO_IMAGES.default) {
    console.log(`[HeroImage] Using AI fallback (category-based) for farmstand ${farmstandId}`);
    return {
      url: categoryImage,
      isAIGenerated: true,
    };
  }

  // LEGACY: Stored ai_photo_url from database (only if valid remote URL)
  if (isValidRemoteUrl(aiPhotoUrl)) {
    console.log(`[HeroImage] Using AI fallback (legacy aiPhotoUrl) for farmstand ${farmstandId}`);
    return {
      url: aiPhotoUrl,
      isAIGenerated: true,
    };
  }

  // Fallback: Default AI image
  console.log(`[HeroImage] Using AI fallback (default) for farmstand ${farmstandId}`);
  return {
    url: farmstandId
      ? getVariedHeroImage('default', farmstandId)
      : AI_HERO_IMAGES.default,
    isAIGenerated: true,
  };
}

/**
 * Text content for the illustrative image tooltip/info
 */
export const ILLUSTRATIVE_IMAGE_INFO = {
  label: 'Illustrative Image',
  description: 'This image represents the type of products sold here. Photos will be updated once the Farmstand is claimed or verified.',
  claimCTA: 'Claim this Farmstand to add real photos',
};
