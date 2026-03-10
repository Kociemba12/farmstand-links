/**
 * Hero Image Service
 *
 * Centralized service for generating and managing farmstand hero images.
 *
 * KEY RULES:
 * 1. NEVER generate images during render - only when hero_image_url is NULL
 * 2. Generate image ONCE and store permanently in DB
 * 3. Images are based on farmstand offerings (not random)
 * 4. NO HUMANS in any AI images
 * 5. Seeds ensure variety between neighboring farmstands
 * 6. Once saved, image never changes automatically
 */

import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Valid hero image themes based on farmstand offerings
 */
export type HeroImageTheme =
  | 'eggs'
  | 'produce'
  | 'vegetables'
  | 'fruit'
  | 'honey'
  | 'baked_goods'
  | 'flowers'
  | 'dairy'
  | 'meat'
  | 'herbs'
  | 'preserves'
  | 'plants'
  | 'crafts'
  | 'farm_produce'; // fallback

/**
 * Theme image variants - NO HUMANS in any image
 * Each theme has 3+ variants for variety
 */
const THEME_IMAGE_VARIANTS: Record<HeroImageTheme, string[]> = {
  eggs: [
    'https://images.unsplash.com/photo-1569288052389-dac9b01c9c05?w=1200&q=80', // eggs in carton
    'https://images.unsplash.com/photo-1498654077810-12c21d4d6dc3?w=1200&q=80', // eggs in bowl
    'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=1200&q=80', // brown eggs basket
  ],
  produce: [
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1200&q=80', // vegetable spread
    'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=1200&q=80', // fresh produce pile
    'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80', // colorful vegetables
  ],
  vegetables: [
    'https://images.unsplash.com/photo-1566385101042-1a0aa0c1268c?w=1200&q=80', // market vegetables
    'https://images.unsplash.com/photo-1597362925123-77861d3fbac7?w=1200&q=80', // garden vegetables
    'https://images.unsplash.com/photo-1518843875459-f738682238a6?w=1200&q=80', // vegetable basket
  ],
  fruit: [
    'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=1200&q=80', // fruit arrangement
    'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=1200&q=80', // mixed fruits
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80', // berries
  ],
  honey: [
    'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=1200&q=80', // honey jars
    'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=1200&q=80', // honeycomb
    'https://images.unsplash.com/photo-1471943311424-646960669fbc?w=1200&q=80', // honey dipper
  ],
  baked_goods: [
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=80', // artisan breads
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=1200&q=80', // pastries display
    'https://images.unsplash.com/photo-1517433670267-30f4906e6f73?w=1200&q=80', // fresh baked goods
  ],
  flowers: [
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&q=80', // flower field
    'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=1200&q=80', // bouquet
    'https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=1200&q=80', // cut flowers
  ],
  dairy: [
    'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=1200&q=80', // dairy products
    'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=1200&q=80', // cheese wheels
    'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=1200&q=80', // milk bottles
  ],
  meat: [
    'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=1200&q=80', // meat cuts
    'https://images.unsplash.com/photo-1558030006-450675393462?w=1200&q=80', // butcher cuts
    'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=1200&q=80', // fresh meat
  ],
  herbs: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80', // herb plants
    'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=1200&q=80', // herb seedlings
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80', // potted herbs
  ],
  preserves: [
    'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=1200&q=80', // mason jars
    'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=1200&q=80', // jam jars
    'https://images.unsplash.com/photo-1597227301620-4c5e33e5a729?w=1200&q=80', // preserves shelf
  ],
  plants: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80', // greenhouse plants
    'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=1200&q=80', // seedlings
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80', // potted plants
  ],
  crafts: [
    'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=1200&q=80', // handmade items
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80', // craft supplies
    'https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=1200&q=80', // artisan crafts
  ],
  farm_produce: [
    'https://images.unsplash.com/photo-1595855759920-86582396756a?w=1200&q=80', // farm produce
    'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200&q=80', // barn exterior
    'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80', // farm landscape
  ],
};

/**
 * Keyword to theme mapping for detecting theme from offerings
 */
const OFFERING_TO_THEME: Record<string, HeroImageTheme> = {
  // Eggs
  eggs: 'eggs',
  egg: 'eggs',
  'farm fresh eggs': 'eggs',
  'chicken eggs': 'eggs',
  'duck eggs': 'eggs',
  'quail eggs': 'eggs',
  'free range eggs': 'eggs',
  'pasture raised eggs': 'eggs',

  // Produce
  produce: 'produce',
  vegetables: 'vegetables',
  veggies: 'vegetables',
  greens: 'produce',
  lettuce: 'produce',
  kale: 'produce',
  spinach: 'produce',
  tomatoes: 'produce',
  peppers: 'produce',
  zucchini: 'produce',
  cucumbers: 'produce',
  carrots: 'produce',
  potatoes: 'produce',
  onions: 'produce',
  garlic: 'produce',
  beans: 'produce',
  peas: 'produce',
  corn: 'produce',
  squash: 'produce',

  // Fruit
  fruit: 'fruit',
  fruits: 'fruit',
  berries: 'fruit',
  strawberries: 'fruit',
  blueberries: 'fruit',
  raspberries: 'fruit',
  blackberries: 'fruit',
  apples: 'fruit',
  peaches: 'fruit',
  cherries: 'fruit',
  pears: 'fruit',
  grapes: 'fruit',
  melons: 'fruit',
  watermelon: 'fruit',

  // Honey
  honey: 'honey',
  honeycomb: 'honey',
  'raw honey': 'honey',
  'local honey': 'honey',
  beeswax: 'honey',

  // Baked goods
  'baked goods': 'baked_goods',
  baked: 'baked_goods',
  bakery: 'baked_goods',
  bread: 'baked_goods',
  sourdough: 'baked_goods',
  pastries: 'baked_goods',
  cookies: 'baked_goods',
  pies: 'baked_goods',
  muffins: 'baked_goods',
  cakes: 'baked_goods',

  // Flowers
  flowers: 'flowers',
  flower: 'flowers',
  bouquet: 'flowers',
  sunflowers: 'flowers',
  tulips: 'flowers',
  'cut flowers': 'flowers',
  roses: 'flowers',
  dahlias: 'flowers',
  lavender: 'flowers',

  // Dairy
  dairy: 'dairy',
  milk: 'dairy',
  cheese: 'dairy',
  yogurt: 'dairy',
  butter: 'dairy',
  cream: 'dairy',
  'goat cheese': 'dairy',
  'raw milk': 'dairy',

  // Meat
  meat: 'meat',
  beef: 'meat',
  pork: 'meat',
  lamb: 'meat',
  chicken: 'meat',
  turkey: 'meat',
  sausage: 'meat',
  bacon: 'meat',
  poultry: 'meat',

  // Herbs
  herbs: 'herbs',
  basil: 'herbs',
  mint: 'herbs',
  rosemary: 'herbs',
  thyme: 'herbs',
  oregano: 'herbs',
  parsley: 'herbs',
  cilantro: 'herbs',

  // Preserves
  preserves: 'preserves',
  jams: 'preserves',
  jam: 'preserves',
  jellies: 'preserves',
  pickles: 'preserves',
  salsa: 'preserves',
  canned: 'preserves',

  // Plants
  plants: 'plants',
  seedlings: 'plants',
  nursery: 'plants',
  'potted plants': 'plants',
  succulents: 'plants',
  'starter plants': 'plants',

  // Crafts
  crafts: 'crafts',
  handmade: 'crafts',
  artisan: 'crafts',
  soaps: 'crafts',
  candles: 'crafts',
  pottery: 'crafts',
};

/**
 * Determine theme from farmstand data
 * Priority: offerings[0] > primary_category > 'farm_produce'
 */
export function determineThemeFromFarmstand(
  offerings?: string[],
  categories?: string[]
): HeroImageTheme {
  // Try offerings first (in order)
  if (offerings && offerings.length > 0) {
    for (const offering of offerings) {
      const lowerOffering = offering.toLowerCase();

      // Direct match
      if (OFFERING_TO_THEME[lowerOffering]) {
        return OFFERING_TO_THEME[lowerOffering];
      }

      // Partial match
      for (const [keyword, theme] of Object.entries(OFFERING_TO_THEME)) {
        if (lowerOffering.includes(keyword) || keyword.includes(lowerOffering)) {
          return theme;
        }
      }
    }
  }

  // Try categories
  if (categories && categories.length > 0) {
    for (const category of categories) {
      const lowerCategory = category.toLowerCase();

      // Direct match
      if (OFFERING_TO_THEME[lowerCategory]) {
        return OFFERING_TO_THEME[lowerCategory];
      }

      // Check if it's a valid theme directly
      if (lowerCategory in THEME_IMAGE_VARIANTS) {
        return lowerCategory as HeroImageTheme;
      }
    }
  }

  // Fallback
  return 'farm_produce';
}

/**
 * Generate a random seed for image variety (0-999999)
 */
export function generateImageSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * Get image URL for a theme and seed
 * The seed ensures the same farmstand always gets the same image variant
 */
export function getImageUrlForTheme(theme: HeroImageTheme, seed: number): string {
  const variants = THEME_IMAGE_VARIANTS[theme] ?? THEME_IMAGE_VARIANTS.farm_produce;
  const index = seed % variants.length;
  return variants[index];
}

/**
 * Generate hero image data for a farmstand
 * Returns the image URL, theme, and seed to be saved
 */
export function generateHeroImageData(
  offerings?: string[],
  categories?: string[]
): {
  heroImageUrl: string;
  heroImageTheme: HeroImageTheme;
  heroImageSeed: number;
  heroImageGeneratedAt: string;
} {
  const theme = determineThemeFromFarmstand(offerings, categories);
  const seed = generateImageSeed();
  const url = getImageUrlForTheme(theme, seed);

  return {
    heroImageUrl: url,
    heroImageTheme: theme,
    heroImageSeed: seed,
    heroImageGeneratedAt: new Date().toISOString(),
  };
}

/**
 * Save hero image to database for a farmstand
 * This should ONLY be called when hero_image_url is NULL
 */
export async function saveHeroImageToDatabase(
  farmstandId: string,
  heroImageData: {
    heroImageUrl: string;
    heroImageTheme: string;
    heroImageSeed: number;
    heroImageGeneratedAt: string;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    console.warn('[HeroImage] Supabase not configured, cannot save hero image');
    return { success: false, error: 'Supabase not configured' };
  }

  console.log('[HeroImage] Saving hero image for farmstand:', farmstandId);
  console.log('[HeroImage] Theme:', heroImageData.heroImageTheme);

  const { error } = await supabase
    .from<Record<string, unknown>>('farmstands')
    .update({
      hero_image_url: heroImageData.heroImageUrl,
      hero_image_theme: heroImageData.heroImageTheme,
      hero_image_seed: heroImageData.heroImageSeed,
      hero_image_generated_at: heroImageData.heroImageGeneratedAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', farmstandId)
    .execute();

  if (error) {
    console.error('[HeroImage] Failed to save hero image:', error);
    return { success: false, error: error.message };
  }

  console.log('[HeroImage] Hero image saved successfully');
  return { success: true };
}

/**
 * Generate and save hero image for a farmstand if it doesn't have one
 * This is the main function to call when displaying a farmstand
 *
 * IMPORTANT: Only call this OUTSIDE of render - use it in useEffect or event handlers
 */
export async function ensureHeroImage(
  farmstandId: string,
  currentHeroImageUrl: string | null,
  offerings?: string[],
  categories?: string[]
): Promise<string | null> {
  // If farmstand already has a hero image, return it - DO NOT generate AI image
  if (currentHeroImageUrl && currentHeroImageUrl.trim().length > 0) {
    console.log(`[HeroImageService] Farmstand ${farmstandId} has UPLOADED photo, skipping AI generation`);
    return currentHeroImageUrl;
  }

  console.log(`[HeroImageService] Farmstand ${farmstandId} has NO uploaded photo, generating AI fallback`);

  // Generate hero image data
  const heroImageData = generateHeroImageData(offerings, categories);

  // Save to database (fire and forget for now, but could await if needed)
  saveHeroImageToDatabase(farmstandId, heroImageData).catch((err) => {
    console.error('[HeroImage] Background save failed:', err);
  });

  // Return the URL immediately
  return heroImageData.heroImageUrl;
}

/**
 * Get a fallback image URL for when loading fails
 * This is a neutral farm texture that doesn't imply specific products
 */
export const FALLBACK_PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200&q=80';

/**
 * Synchronous function to get the hero image URL for rendering
 * If heroImageUrl is null, returns a generated URL based on offerings
 * Does NOT save to database - use ensureHeroImage for that
 */
export function getHeroImageUrlSync(
  heroImageUrl: string | null,
  heroImageTheme: string | null,
  heroImageSeed: number | null,
  offerings?: string[],
  categories?: string[]
): string {
  // If we have a stored hero image, use it - this is an UPLOADED photo
  if (heroImageUrl && heroImageUrl.trim().length > 0) {
    return heroImageUrl;
  }

  // If we have stored theme and seed, regenerate consistently (AI fallback)
  if (heroImageTheme && heroImageSeed !== null) {
    return getImageUrlForTheme(heroImageTheme as HeroImageTheme, heroImageSeed);
  }

  // Generate based on offerings (AI fallback - this will be different each time,
  // but we'll save it in the background via ensureHeroImage)
  const data = generateHeroImageData(offerings, categories);
  return data.heroImageUrl;
}
