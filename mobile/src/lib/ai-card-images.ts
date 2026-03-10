/**
 * AI-Generated Card Images for Farmstand Cards (Map + Explore)
 *
 * Image Priority Rules:
 * 1. If Farmstand has an uploaded cover photo → Display that image
 * 2. Else if Farmstand has a cached AI image → Display cached AI image
 * 3. Else if Farmstand has NO uploaded photo → Generate and cache AI image based on products
 * 4. Else → Display neutral farmstand placeholder
 *
 * AI Image Rules (HARD RULES):
 * - ABSOLUTELY NO PEOPLE, faces, hands, silhouettes, or human figures
 * - Based ONLY on what the Farmstand sells (products/categories)
 * - No text, signs, logos, watermarks, or branded items
 * - No stylized, illustrated, or fantasy art
 * - Style: Realistic photography, natural daylight, clean, premium
 * - Composition: Products clearly visible, center-weighted, shallow depth of field
 * - Focus: Farm products, structures, and landscape only
 *
 * Variety System:
 * - Each category has 3+ image variations to prevent duplicate cards
 * - Images selected using farmstand ID as seed for consistent but varied results
 * - Adjacent cards in lists/grids use deduplication logic
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProductCategory } from './products-store';
import type { ClaimStatus, VerificationStatus, Farmstand } from './farmer-store';

const AI_CARD_IMAGES_STORAGE_KEY = 'ai_card_images_cache';

/**
 * Multiple image variations per category - NO HUMANS in any image
 * Each array has 3+ options for variety
 */
export const AI_PRODUCT_IMAGE_VARIANTS: Record<string, string[]> = {
  // Eggs - farm fresh eggs, cartons, nests (no people)
  eggs: [
    'https://images.unsplash.com/photo-1569288052389-dac9b01c9c05?w=1200&q=80', // eggs in carton
    'https://images.unsplash.com/photo-1498654077810-12c21d4d6dc3?w=1200&q=80', // eggs in bowl
    'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=1200&q=80', // brown eggs basket
  ],

  // Produce - vegetables arrangement (no people)
  produce: [
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1200&q=80', // vegetable spread
    'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=1200&q=80', // fresh produce pile
    'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80', // colorful vegetables
  ],

  // Vegetables - market vegetables (no people)
  vegetables: [
    'https://images.unsplash.com/photo-1566385101042-1a0aa0c1268c?w=1200&q=80', // market vegetables
    'https://images.unsplash.com/photo-1597362925123-77861d3fbac7?w=1200&q=80', // garden vegetables
    'https://images.unsplash.com/photo-1518843875459-f738682238a6?w=1200&q=80', // vegetable basket
  ],

  // Fruit - fresh fruit display (no people)
  fruit: [
    'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=1200&q=80', // fruit arrangement
    'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=1200&q=80', // mixed fruits
    'https://images.unsplash.com/photo-1568702846914-96b305d2uj8b?w=1200&q=80', // fruit bowl
  ],

  // Baked goods - breads and pastries (no people)
  baked_goods: [
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=80', // artisan breads
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=1200&q=80', // pastries display
    'https://images.unsplash.com/photo-1517433670267-30f4906e6f73?w=1200&q=80', // fresh baked goods
  ],

  // Bread - sourdough loaves (no people)
  bread: [
    'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=1200&q=80', // rustic loaves
    'https://images.unsplash.com/photo-1585478259715-876acc5be8fc?w=1200&q=80', // bread slices
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=80', // artisan bread
  ],

  // Meat - farm meats (no people)
  meat: [
    'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=1200&q=80', // meat cuts
    'https://images.unsplash.com/photo-1558030006-450675393462?w=1200&q=80', // butcher cuts
    'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=1200&q=80', // fresh meat
  ],

  // Beef - cuts of beef (no people)
  beef: [
    'https://images.unsplash.com/photo-1603048297172-c92544798d5a?w=1200&q=80', // beef cuts
    'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=1200&q=80', // steak cuts
    'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=1200&q=80', // raw beef
  ],

  // Honey - jars and honeycomb (no people)
  honey: [
    'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=1200&q=80', // honey jars
    'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=1200&q=80', // honeycomb
    'https://images.unsplash.com/photo-1471943311424-646960669fbc?w=1200&q=80', // honey dipper
  ],

  // Flowers - bouquets and blooms (no people)
  flowers: [
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&q=80', // flower field
    'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=1200&q=80', // bouquet
    'https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=1200&q=80', // cut flowers
  ],

  // Pumpkins - autumn display (no people)
  pumpkins: [
    'https://images.unsplash.com/photo-1509622905150-fa66d3906e09?w=1200&q=80', // pumpkin patch
    'https://images.unsplash.com/photo-1570586437263-ab629fccc818?w=1200&q=80', // pumpkin display
    'https://images.unsplash.com/photo-1506917728037-b6af01a7d403?w=1200&q=80', // autumn pumpkins
  ],

  // Dairy - milk and cheese (no people)
  dairy: [
    'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=1200&q=80', // dairy products
    'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=1200&q=80', // cheese wheels
    'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=1200&q=80', // milk bottles
  ],

  // Preserves - jams and canned goods (no people)
  preserves: [
    'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=1200&q=80', // mason jars
    'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=1200&q=80', // jam jars
    'https://images.unsplash.com/photo-1597227301620-4c5e33e5a729?w=1200&q=80', // preserves shelf
  ],

  // Plants - potted plants and seedlings (no people)
  plants: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80', // greenhouse plants
    'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=1200&q=80', // seedlings
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80', // potted plants
  ],

  // Crafts - handmade goods (no people)
  crafts: [
    'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=1200&q=80', // handmade items
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80', // craft supplies
    'https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=1200&q=80', // artisan crafts
  ],

  // Berries - fresh berries (no people)
  berries: [
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80', // mixed berries
    'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=1200&q=80', // blueberries
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80', // berry basket
  ],

  // Apples - fresh apples (no people)
  apples: [
    'https://images.unsplash.com/photo-1570913149827-d2ac84ab3f9a?w=1200&q=80', // red apples
    'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=1200&q=80', // apple basket
    'https://images.unsplash.com/photo-1576179635662-9d1983e97e1e?w=1200&q=80', // green apples
  ],

  // Tomatoes - vine tomatoes (no people)
  tomatoes: [
    'https://images.unsplash.com/photo-1592921870789-04563d55041c?w=1200&q=80', // vine tomatoes
    'https://images.unsplash.com/photo-1561136594-7f68413baa99?w=1200&q=80', // heirloom tomatoes
    'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?w=1200&q=80', // cherry tomatoes
  ],

  // Corn - fresh corn (no people)
  corn: [
    'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=1200&q=80', // corn cobs
    'https://images.unsplash.com/photo-1605524927712-5e1f4f0e9a5b?w=1200&q=80', // fresh corn
    'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=1200&q=80', // corn harvest
  ],

  // Mixed/General - farmstand scenes (no people)
  mixed: [
    'https://images.unsplash.com/photo-1595855759920-86582396756a?w=1200&q=80', // produce stand
    'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1200&q=80', // market produce
    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&q=80', // farm market
  ],

  // Default - wooden crates, barn, farm scenes (no people)
  default: [
    'https://images.unsplash.com/photo-1595855759920-86582396756a?w=1200&q=80', // farm produce
    'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200&q=80', // barn exterior
    'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80', // farm landscape
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
    hash = hash & hash; // Convert to 32bit integer
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
 * Get image URL for a category with variety based on farmstand ID
 */
export function getVariedImageForCategory(category: string, farmstandId: string): string {
  const variants = AI_PRODUCT_IMAGE_VARIANTS[category] ?? AI_PRODUCT_IMAGE_VARIANTS.default;
  const index = getVariantIndex(farmstandId, variants.length);
  return variants[index];
}

// Legacy single-image map for backward compatibility
export const AI_PRODUCT_IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(AI_PRODUCT_IMAGE_VARIANTS).map(([key, variants]) => [key, variants[0]])
);

/**
 * Valid fallback image keys (themes)
 * HARD RULE: NEVER use asparagus images - always use mixed produce
 */
export type FallbackImageKey =
  | 'eggs_fresh_carton_closeup'
  | 'artisan_bread_loaves_rustic'
  | 'honeycomb_jar_drizzle'
  | 'bouquet_field_handpicked'
  | 'farm_ranch_cuts_wrapped'
  | 'mixed_produce_colorful'
  | 'jars_of_jam_on_table'
  | 'fresh_herbs_bundle'
  | 'handmade_goods_table_display'
  | 'dairy_products_display'
  | 'potted_plants_nursery'
  | 'pumpkin_autumn_display'
  | 'fruit_basket_colorful'
  | 'tomatoes_vine_heirloom'
  | 'corn_fresh_harvest'
  | 'berries_fresh_basket'
  | 'farm_default';

/**
 * Mapping from fallback_image_key to actual image arrays
 * These are curated, NO HUMANS images for each theme
 */
export const FALLBACK_IMAGE_URLS: Record<FallbackImageKey, string[]> = {
  eggs_fresh_carton_closeup: [
    'https://images.unsplash.com/photo-1569288052389-dac9b01c9c05?w=1200&q=80',
    'https://images.unsplash.com/photo-1498654077810-12c21d4d6dc3?w=1200&q=80',
    'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=1200&q=80',
  ],
  artisan_bread_loaves_rustic: [
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=80',
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=1200&q=80',
    'https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=1200&q=80',
  ],
  honeycomb_jar_drizzle: [
    'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=1200&q=80',
    'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=1200&q=80',
    'https://images.unsplash.com/photo-1471943311424-646960669fbc?w=1200&q=80',
  ],
  bouquet_field_handpicked: [
    'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=1200&q=80',
    'https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=1200&q=80',
    'https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=1200&q=80',
  ],
  farm_ranch_cuts_wrapped: [
    'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=1200&q=80',
    'https://images.unsplash.com/photo-1558030006-450675393462?w=1200&q=80',
    'https://images.unsplash.com/photo-1602470520998-f4a52199a3d6?w=1200&q=80',
  ],
  // PRODUCE: Mixed vegetables - NO asparagus, use tomatoes/berries/greens
  mixed_produce_colorful: [
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1200&q=80', // vegetable spread
    'https://images.unsplash.com/photo-1590779033100-9f60a05a013d?w=1200&q=80', // fresh produce
    'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80', // colorful vegetables
  ],
  jars_of_jam_on_table: [
    'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=1200&q=80',
    'https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=1200&q=80',
    'https://images.unsplash.com/photo-1597227301620-4c5e33e5a729?w=1200&q=80',
  ],
  fresh_herbs_bundle: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80',
    'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=1200&q=80',
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80',
  ],
  handmade_goods_table_display: [
    'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?w=1200&q=80',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80',
    'https://images.unsplash.com/photo-1544967082-d9d25d867d66?w=1200&q=80',
  ],
  dairy_products_display: [
    'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=1200&q=80',
    'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=1200&q=80',
    'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=1200&q=80',
  ],
  potted_plants_nursery: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80',
    'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=1200&q=80',
    'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=1200&q=80',
  ],
  pumpkin_autumn_display: [
    'https://images.unsplash.com/photo-1509622905150-fa66d3906e09?w=1200&q=80',
    'https://images.unsplash.com/photo-1570586437263-ab629fccc818?w=1200&q=80',
    'https://images.unsplash.com/photo-1506917728037-b6af01a7d403?w=1200&q=80',
  ],
  fruit_basket_colorful: [
    'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=1200&q=80',
    'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=1200&q=80',
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80',
  ],
  tomatoes_vine_heirloom: [
    'https://images.unsplash.com/photo-1592921870789-04563d55041c?w=1200&q=80',
    'https://images.unsplash.com/photo-1561136594-7f68413baa99?w=1200&q=80',
    'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?w=1200&q=80',
  ],
  corn_fresh_harvest: [
    'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=1200&q=80',
    'https://images.unsplash.com/photo-1605524927712-5e1f4f0e9a5b?w=1200&q=80',
    'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=1200&q=80',
  ],
  berries_fresh_basket: [
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80',
    'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=1200&q=80',
    'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=1200&q=80',
  ],
  farm_default: [
    'https://images.unsplash.com/photo-1595855759920-86582396756a?w=1200&q=80',
    'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200&q=80',
    'https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80',
  ],
};

/**
 * Mapping from categories to fallback image keys
 * HARD RULE: Produce NEVER defaults to asparagus - always use mixed_produce_colorful
 */
export const CATEGORY_TO_FALLBACK_KEY: Record<string, FallbackImageKey> = {
  eggs: 'eggs_fresh_carton_closeup',
  baked_goods: 'artisan_bread_loaves_rustic',
  bread: 'artisan_bread_loaves_rustic',
  bakery: 'artisan_bread_loaves_rustic',
  honey: 'honeycomb_jar_drizzle',
  flowers: 'bouquet_field_handpicked',
  meat: 'farm_ranch_cuts_wrapped',
  beef: 'farm_ranch_cuts_wrapped',
  pork: 'farm_ranch_cuts_wrapped',
  lamb: 'farm_ranch_cuts_wrapped',
  poultry: 'farm_ranch_cuts_wrapped',
  produce: 'mixed_produce_colorful',
  vegetables: 'mixed_produce_colorful',
  preserves: 'jars_of_jam_on_table',
  jam: 'jars_of_jam_on_table',
  jams: 'jars_of_jam_on_table',
  herbs: 'fresh_herbs_bundle',
  crafts: 'handmade_goods_table_display',
  soap: 'handmade_goods_table_display',
  soaps: 'handmade_goods_table_display',
  candles: 'handmade_goods_table_display',
  dairy: 'dairy_products_display',
  milk: 'dairy_products_display',
  cheese: 'dairy_products_display',
  plants: 'potted_plants_nursery',
  seedlings: 'potted_plants_nursery',
  nursery: 'potted_plants_nursery',
  pumpkins: 'pumpkin_autumn_display',
  gourds: 'pumpkin_autumn_display',
  squash: 'pumpkin_autumn_display',
  fruit: 'fruit_basket_colorful',
  fruits: 'fruit_basket_colorful',
  tomatoes: 'tomatoes_vine_heirloom',
  corn: 'corn_fresh_harvest',
  berries: 'berries_fresh_basket',
  strawberries: 'berries_fresh_basket',
  blueberries: 'berries_fresh_basket',
  apples: 'fruit_basket_colorful',
  peaches: 'fruit_basket_colorful',
};

/**
 * HIGH-PRIORITY CATEGORIES
 * These categories ALWAYS take precedence over generic categories like 'produce'.
 * If ANY offering or category contains these keywords, force that fallback key.
 * Order matters: first match wins.
 *
 * CRITICAL: Eggs MUST be first - a farmstand selling "Eggs, Produce" should ALWAYS show eggs
 */
const HIGH_PRIORITY_CATEGORY_RULES: Array<{ keywords: string[]; fallbackKey: FallbackImageKey }> = [
  // EGGS - HIGHEST priority, ALWAYS override produce/vegetables/asparagus
  { keywords: ['eggs', 'egg', 'farm fresh eggs', 'chicken eggs', 'duck eggs', 'quail eggs', 'free range eggs', 'pasture raised eggs', 'fresh eggs'], fallbackKey: 'eggs_fresh_carton_closeup' },
  // HONEY - specific product
  { keywords: ['honey', 'honeycomb', 'raw honey', 'local honey', 'beeswax'], fallbackKey: 'honeycomb_jar_drizzle' },
  // BEEF - specific meat (check before generic meat)
  { keywords: ['beef', 'grass-fed beef', 'ground beef', 'steaks', 'roast beef', 'beef cuts'], fallbackKey: 'farm_ranch_cuts_wrapped' },
  // PORK - specific meat
  { keywords: ['pork', 'bacon', 'ham', 'pork chops', 'sausage', 'pork cuts'], fallbackKey: 'farm_ranch_cuts_wrapped' },
  // POULTRY - specific meat (chicken meat, not eggs)
  { keywords: ['poultry', 'chicken meat', 'turkey', 'duck meat', 'game birds'], fallbackKey: 'farm_ranch_cuts_wrapped' },
  // MEAT - generic meat
  { keywords: ['meat', 'lamb', 'goat meat', 'venison', 'roasts', 'butcher'], fallbackKey: 'farm_ranch_cuts_wrapped' },
  // DAIRY - milk, cheese, etc
  { keywords: ['dairy', 'milk', 'cheese', 'yogurt', 'butter', 'cream', 'goat cheese', 'raw milk', 'goat milk', 'cow milk'], fallbackKey: 'dairy_products_display' },
  // FLOWERS - specific product
  { keywords: ['flowers', 'flower', 'bouquet', 'sunflowers', 'tulips', 'cut flowers', 'roses', 'dahlias', 'zinnias', 'dried flowers', 'lavender'], fallbackKey: 'bouquet_field_handpicked' },
  // BAKED GOODS - specific product
  { keywords: ['baked', 'baked goods', 'bakery', 'bread', 'sourdough', 'pastries', 'cookies', 'pies', 'muffins', 'cakes', 'scones', 'rolls', 'baguettes'], fallbackKey: 'artisan_bread_loaves_rustic' },
  // PRESERVES - specific product
  { keywords: ['preserves', 'jams', 'jam', 'canned', 'pickles', 'salsa', 'sauces', 'jellies', 'marmalade'], fallbackKey: 'jars_of_jam_on_table' },
  // PUMPKINS - seasonal specific
  { keywords: ['pumpkins', 'pumpkin', 'gourds', 'squash', 'winter squash'], fallbackKey: 'pumpkin_autumn_display' },
  // BERRIES - specific produce
  { keywords: ['berries', 'strawberries', 'blueberries', 'raspberries', 'blackberries', 'marionberries'], fallbackKey: 'berries_fresh_basket' },
  // TOMATOES - specific produce
  { keywords: ['tomatoes', 'tomato', 'heirloom tomatoes', 'cherry tomatoes'], fallbackKey: 'tomatoes_vine_heirloom' },
  // CORN - specific produce
  { keywords: ['corn', 'sweet corn'], fallbackKey: 'corn_fresh_harvest' },
  // FRUIT - specific produce
  { keywords: ['fruit', 'fruits', 'apples', 'apple', 'peaches', 'peach', 'cherries', 'pears', 'plums', 'nectarines', 'grapes', 'melons'], fallbackKey: 'fruit_basket_colorful' },
  // PLANTS - specific product
  { keywords: ['plants', 'seedlings', 'nursery', 'potted plants', 'succulents', 'starter plants'], fallbackKey: 'potted_plants_nursery' },
  // HERBS - specific product
  { keywords: ['herbs', 'herb'], fallbackKey: 'fresh_herbs_bundle' },
  // CRAFTS - specific product
  { keywords: ['crafts', 'handmade', 'artisan', 'soaps', 'candles', 'pottery', 'woodwork'], fallbackKey: 'handmade_goods_table_display' },
  // PRODUCE/VEGETABLES - generic (LAST in priority, use mixed produce NOT asparagus)
  { keywords: ['produce', 'vegetables', 'veggies', 'greens', 'lettuce', 'kale', 'spinach'], fallbackKey: 'mixed_produce_colorful' },
];

/**
 * Determine the fallback_image_key based on farmstand categories/offerings
 * This is the SINGLE SOURCE OF TRUTH for what image a farmstand should show
 *
 * PRIORITY ORDER:
 * 1. HIGH_PRIORITY_CATEGORY_RULES - specific products (eggs, honey, etc.) ALWAYS win
 * 2. Direct match in CATEGORY_TO_FALLBACK_KEY
 * 3. Partial match in CATEGORY_TO_FALLBACK_KEY
 * 4. Default to farm_default
 *
 * HARD RULE: Eggs ALWAYS takes priority over produce - a farmstand selling "Eggs, Produce"
 * will ALWAYS show an eggs image, never asparagus/vegetables.
 */
export function determineFallbackImageKey(
  offerings: string[],
  categories: string[]
): FallbackImageKey {
  // Combine all items for searching
  const allItems = [...offerings, ...categories];
  const allItemsLower = allItems.map((item) => item.toLowerCase());
  const combinedText = allItemsLower.join(' ');

  // PRIORITY 1: Check high-priority category rules first
  // This ensures eggs ALWAYS beats produce, honey ALWAYS beats mixed, etc.
  for (const rule of HIGH_PRIORITY_CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      // Check if any item contains this keyword OR keyword is contained in any item
      if (allItemsLower.some((item) => item.includes(keyword) || keyword.includes(item))) {
        return rule.fallbackKey;
      }
      // Also check if keyword appears in combined text (handles multi-word matches)
      if (combinedText.includes(keyword)) {
        return rule.fallbackKey;
      }
    }
  }

  // PRIORITY 2: Direct match in CATEGORY_TO_FALLBACK_KEY (for anything not in high-priority)
  for (const item of allItems) {
    const lowerItem = item.toLowerCase();
    if (CATEGORY_TO_FALLBACK_KEY[lowerItem]) {
      return CATEGORY_TO_FALLBACK_KEY[lowerItem];
    }
  }

  // PRIORITY 3: Partial match - check if any keyword is contained (legacy fallback)
  for (const item of allItems) {
    const lowerItem = item.toLowerCase();
    for (const [keyword, key] of Object.entries(CATEGORY_TO_FALLBACK_KEY)) {
      if (lowerItem.includes(keyword) || keyword.includes(lowerItem)) {
        return key;
      }
    }
  }

  // PRIORITY 4: Default fallback (generic farm scene)
  return 'farm_default';
}

/**
 * Get image URL from fallback_image_key with consistent variety based on farmstand ID
 */
export function getImageFromFallbackKey(
  fallbackKey: FallbackImageKey,
  farmstandId: string
): string {
  const images = FALLBACK_IMAGE_URLS[fallbackKey] ?? FALLBACK_IMAGE_URLS.farm_default;
  const index = hashStringToNumber(farmstandId) % images.length;
  return images[index];
}

// Map product keywords to image categories (expanded for better matching)
// NOTE: asparagus is excluded - always maps to 'produce' which uses mixed_produce_colorful
const PRODUCT_KEYWORD_MAP: Record<string, string> = {
  // Eggs
  eggs: 'eggs',
  egg: 'eggs',
  'farm fresh eggs': 'eggs',
  'chicken eggs': 'eggs',
  'duck eggs': 'eggs',
  'quail eggs': 'eggs',
  'free range eggs': 'eggs',
  'pasture raised eggs': 'eggs',

  // Produce - NOTE: No asparagus-specific mapping, all go to 'produce' which uses mixed vegetables
  produce: 'produce',
  vegetables: 'vegetables',
  veggies: 'vegetables',
  greens: 'produce',
  lettuce: 'produce',
  kale: 'produce',
  spinach: 'produce',
  arugula: 'produce',
  chard: 'produce',

  // Fruit
  fruit: 'fruit',
  fruits: 'fruit',
  berries: 'berries',
  strawberries: 'berries',
  blueberries: 'berries',
  raspberries: 'berries',
  blackberries: 'berries',
  apples: 'apples',
  apple: 'apples',
  peaches: 'fruit',
  peach: 'fruit',
  cherries: 'fruit',
  cherry: 'fruit',
  pears: 'fruit',
  pear: 'fruit',
  plums: 'fruit',
  nectarines: 'fruit',
  grapes: 'fruit',
  melons: 'fruit',
  watermelon: 'fruit',
  cantaloupe: 'fruit',

  // Baked goods
  baked: 'baked_goods',
  'baked goods': 'baked_goods',
  bakery: 'baked_goods',
  bread: 'bread',
  sourdough: 'bread',
  pastries: 'baked_goods',
  cookies: 'baked_goods',
  pies: 'baked_goods',
  pie: 'baked_goods',
  muffins: 'baked_goods',
  cakes: 'baked_goods',
  scones: 'baked_goods',
  rolls: 'bread',
  baguettes: 'bread',

  // Meat
  meat: 'meat',
  beef: 'beef',
  pork: 'meat',
  lamb: 'meat',
  chicken: 'meat',
  turkey: 'meat',
  sausage: 'meat',
  bacon: 'meat',
  'ground beef': 'beef',
  steaks: 'beef',
  roasts: 'meat',
  poultry: 'meat',

  // Honey
  honey: 'honey',
  honeycomb: 'honey',
  'raw honey': 'honey',
  'local honey': 'honey',
  beeswax: 'honey',

  // Flowers
  flowers: 'flowers',
  flower: 'flowers',
  bouquet: 'flowers',
  sunflowers: 'flowers',
  tulips: 'flowers',
  'cut flowers': 'flowers',
  roses: 'flowers',
  dahlias: 'flowers',
  zinnias: 'flowers',
  'dried flowers': 'flowers',
  lavender: 'flowers',

  // Pumpkins
  pumpkins: 'pumpkins',
  pumpkin: 'pumpkins',
  gourds: 'pumpkins',
  squash: 'pumpkins',
  'winter squash': 'pumpkins',

  // Dairy
  dairy: 'dairy',
  milk: 'dairy',
  cheese: 'dairy',
  yogurt: 'dairy',
  butter: 'dairy',
  cream: 'dairy',
  'goat cheese': 'dairy',
  'raw milk': 'dairy',

  // Preserves
  preserves: 'preserves',
  jams: 'preserves',
  jam: 'preserves',
  canned: 'preserves',
  pickles: 'preserves',
  salsa: 'preserves',
  sauces: 'preserves',
  jellies: 'preserves',
  marmalade: 'preserves',

  // Plants
  plants: 'plants',
  seedlings: 'plants',
  nursery: 'plants',
  'potted plants': 'plants',
  herbs: 'plants',
  succulents: 'plants',
  'starter plants': 'plants',

  // Crafts
  crafts: 'crafts',
  handmade: 'crafts',
  artisan: 'crafts',
  soaps: 'crafts',
  candles: 'crafts',
  pottery: 'crafts',
  woodwork: 'crafts',

  // Vegetables - NOTE: asparagus maps to 'produce' which uses mixed vegetables (NO asparagus images)
  tomatoes: 'tomatoes',
  tomato: 'tomatoes',
  'heirloom tomatoes': 'tomatoes',
  'cherry tomatoes': 'tomatoes',
  corn: 'corn',
  'sweet corn': 'corn',
  peppers: 'produce',
  zucchini: 'produce',
  cucumbers: 'produce',
  carrots: 'produce',
  potatoes: 'produce',
  onions: 'produce',
  garlic: 'produce',
  beans: 'produce',
  peas: 'produce',
  beets: 'produce',
  radishes: 'produce',
  cabbage: 'produce',
  broccoli: 'produce',
  cauliflower: 'produce',
  asparagus: 'produce', // IMPORTANT: Maps to 'produce' which uses mixed_produce_colorful (NO asparagus)
  eggplant: 'produce',
};

// Map standard categories to image keys
const CATEGORY_IMAGE_MAP: Record<string, string> = {
  produce: 'produce',
  eggs: 'eggs',
  dairy: 'dairy',
  meat: 'meat',
  baked_goods: 'baked_goods',
  preserves: 'preserves',
  honey: 'honey',
  flowers: 'flowers',
  plants: 'plants',
  crafts: 'crafts',
  other: 'mixed',
};

// Cached AI image record
interface CachedAIImage {
  farmstandId: string;
  imageUrl: string;
  basedOnOfferings: string[]; // Store what offerings were used to generate
  generatedAt: string;
}

interface AICardImagesState {
  cache: Map<string, CachedAIImage>;
  isLoaded: boolean;

  // Actions
  loadCache: () => Promise<void>;
  getCachedImage: (farmstandId: string) => CachedAIImage | undefined;
  cacheImage: (farmstandId: string, imageUrl: string, offerings: string[]) => Promise<void>;
  invalidateCache: (farmstandId: string) => Promise<void>;
  shouldRegenerateImage: (farmstandId: string, currentOfferings: string[]) => boolean;
}

export const useAICardImagesStore = create<AICardImagesState>((set, get) => ({
  cache: new Map(),
  isLoaded: false,

  loadCache: async () => {
    try {
      const data = await AsyncStorage.getItem(AI_CARD_IMAGES_STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data) as CachedAIImage[];
        const cacheMap = new Map<string, CachedAIImage>();
        parsed.forEach((item) => {
          cacheMap.set(item.farmstandId, item);
        });
        set({ cache: cacheMap, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch (error) {
      console.error('Error loading AI card images cache:', error);
      set({ isLoaded: true });
    }
  },

  getCachedImage: (farmstandId) => {
    return get().cache.get(farmstandId);
  },

  cacheImage: async (farmstandId, imageUrl, offerings) => {
    const newCacheItem: CachedAIImage = {
      farmstandId,
      imageUrl,
      basedOnOfferings: offerings,
      generatedAt: new Date().toISOString(),
    };

    const newCache = new Map(get().cache);
    newCache.set(farmstandId, newCacheItem);

    // Persist to AsyncStorage
    const cacheArray = Array.from(newCache.values());
    await AsyncStorage.setItem(AI_CARD_IMAGES_STORAGE_KEY, JSON.stringify(cacheArray));

    set({ cache: newCache });
  },

  invalidateCache: async (farmstandId) => {
    const newCache = new Map(get().cache);
    newCache.delete(farmstandId);

    // Persist to AsyncStorage
    const cacheArray = Array.from(newCache.values());
    await AsyncStorage.setItem(AI_CARD_IMAGES_STORAGE_KEY, JSON.stringify(cacheArray));

    set({ cache: newCache });
  },

  shouldRegenerateImage: (farmstandId, currentOfferings) => {
    const cached = get().cache.get(farmstandId);
    if (!cached) return true;

    // Check if offerings have changed
    const cachedSet = new Set(cached.basedOnOfferings.map((o) => o.toLowerCase()));
    const currentSet = new Set(currentOfferings.map((o) => o.toLowerCase()));

    // If size differs or any item doesn't match, regenerate
    if (cachedSet.size !== currentSet.size) return true;
    for (const item of cachedSet) {
      if (!currentSet.has(item)) return true;
    }

    return false;
  },
}));

/**
 * Gets the best AI image URL based on farmstand offerings/products
 * Uses farmstandId for consistent variety selection
 *
 * IMPORTANT: This now uses the HIGH_PRIORITY_CATEGORY_RULES to ensure
 * eggs, honey, beef, pork, dairy, etc. ALWAYS take priority over generic categories.
 * This prevents the "asparagus on egg farmstands" bug.
 */
export function getAIImageForOfferings(offerings: string[], farmstandId?: string): string {
  if (!offerings || offerings.length === 0) {
    return farmstandId
      ? getVariedImageForCategory('default', farmstandId)
      : AI_PRODUCT_IMAGES.default;
  }

  // Use the centralized determineFallbackImageKey which respects HIGH_PRIORITY_CATEGORY_RULES
  const fallbackKey = determineFallbackImageKey(offerings, []);

  // Map fallback key to AI_PRODUCT_IMAGE_VARIANTS category
  const categoryMap: Record<FallbackImageKey, string> = {
    'eggs_fresh_carton_closeup': 'eggs',
    'artisan_bread_loaves_rustic': 'baked_goods',
    'honeycomb_jar_drizzle': 'honey',
    'bouquet_field_handpicked': 'flowers',
    'farm_ranch_cuts_wrapped': 'meat',
    'mixed_produce_colorful': 'produce',
    'jars_of_jam_on_table': 'preserves',
    'fresh_herbs_bundle': 'plants', // herbs use plants images
    'handmade_goods_table_display': 'crafts',
    'dairy_products_display': 'dairy',
    'potted_plants_nursery': 'plants',
    'pumpkin_autumn_display': 'pumpkins',
    'fruit_basket_colorful': 'fruit',
    'tomatoes_vine_heirloom': 'tomatoes',
    'corn_fresh_harvest': 'corn',
    'berries_fresh_basket': 'berries',
    'farm_default': 'default',
  };

  const category = categoryMap[fallbackKey] ?? 'default';

  // Return varied image if farmstandId provided, else first variant
  return farmstandId
    ? getVariedImageForCategory(category, farmstandId)
    : AI_PRODUCT_IMAGES[category] ?? AI_PRODUCT_IMAGES.default;
}

/**
 * Determines if a farmstand should use an AI-generated card image
 */
export function shouldUseAICardImage(params: {
  claimStatus?: ClaimStatus;
  verificationStatus?: VerificationStatus;
  photos: string[];
  mainPhotoIndex?: number;
}): boolean {
  const { photos, mainPhotoIndex = 0 } = params;

  // Has a valid owner-uploaded photo?
  const hasOwnerPhoto = photos && photos.length > 0 && photos[mainPhotoIndex];

  // If there's a real photo, don't use AI image
  if (hasOwnerPhoto) return false;

  // No photo available - use AI image
  return true;
}

/**
 * Main function to get the card image URL for a farmstand
 * Implements the priority rules:
 * 1. Uploaded cover photo
 * 2. Stored hero_image_url from database
 * 3. Generate AI image based on products
 * 4. Default placeholder
 */
export function getCardImageUrl(params: {
  farmstandId: string;
  photos: string[];
  mainPhotoIndex?: number;
  offerings: string[];
  categories?: string[];
  claimStatus?: ClaimStatus;
  verificationStatus?: VerificationStatus;
  heroImageUrl?: string | null;
  heroImageTheme?: string | null;
  heroImageSeed?: number | null;
}): { url: string; isAIGenerated: boolean } {
  const {
    farmstandId,
    photos,
    mainPhotoIndex = 0,
    offerings,
    categories = [],
    heroImageUrl,
    heroImageTheme,
    heroImageSeed,
  } = params;

  // Priority 1: Has uploaded cover photo
  const hasOwnerPhoto = photos && photos.length > 0 && photos[mainPhotoIndex];
  if (hasOwnerPhoto) {
    return {
      url: photos[mainPhotoIndex],
      isAIGenerated: false,
    };
  }

  // Priority 2: Has stored hero_image_url from database
  if (heroImageUrl) {
    return {
      url: heroImageUrl,
      isAIGenerated: true,
    };
  }

  // Priority 3: Has stored theme and seed - regenerate consistently
  if (heroImageTheme && heroImageSeed !== null && heroImageSeed !== undefined) {
    const variants = AI_PRODUCT_IMAGE_VARIANTS[heroImageTheme] ?? AI_PRODUCT_IMAGE_VARIANTS.default;
    const index = heroImageSeed % variants.length;
    return {
      url: variants[index],
      isAIGenerated: true,
    };
  }

  // Priority 4: Use AI image based on offerings with variety
  // Combine offerings and categories for better matching
  const allProducts = [...offerings, ...categories];
  const aiImageUrl = getAIImageForOfferings(allProducts, farmstandId);

  return {
    url: aiImageUrl,
    isAIGenerated: true,
  };
}

/**
 * Hook-friendly function to get card image with caching
 * Call this from components - it handles cache checking internally
 */
export async function getSmartCardImage(
  farmstand: Farmstand,
  cacheStore: AICardImagesState
): Promise<{ url: string; isAIGenerated: boolean }> {
  // Priority 1: Has uploaded cover photo - use it immediately
  const hasOwnerPhoto =
    farmstand.photos &&
    farmstand.photos.length > 0 &&
    farmstand.photos[farmstand.mainPhotoIndex ?? 0];

  if (hasOwnerPhoto) {
    // If owner added a real photo, invalidate any cached AI image
    const cached = cacheStore.getCachedImage(farmstand.id);
    if (cached) {
      await cacheStore.invalidateCache(farmstand.id);
    }
    return {
      url: farmstand.photos[farmstand.mainPhotoIndex ?? 0],
      isAIGenerated: false,
    };
  }

  // Priority 2: Check cache
  const cached = cacheStore.getCachedImage(farmstand.id);
  if (cached && !cacheStore.shouldRegenerateImage(farmstand.id, farmstand.offerings)) {
    return {
      url: cached.imageUrl,
      isAIGenerated: true,
    };
  }

  // Priority 3: Generate and cache AI image with variety based on farmstand ID
  const allProducts = [...farmstand.offerings, ...farmstand.categories];
  const aiImageUrl = getAIImageForOfferings(allProducts, farmstand.id);

  // Cache the generated image
  await cacheStore.cacheImage(farmstand.id, aiImageUrl, farmstand.offerings);

  return {
    url: aiImageUrl,
    isAIGenerated: true,
  };
}

/**
 * Synchronous version for immediate rendering (doesn't wait for cache)
 * Updated to prioritize heroImageUrl from database
 */
export function getCardImageSync(farmstand: {
  id: string;
  photos: string[];
  mainPhotoIndex?: number;
  offerings: string[];
  categories?: string[];
  heroImageUrl?: string | null;
  heroImageTheme?: string | null;
  heroImageSeed?: number | null;
}): { url: string; isAIGenerated: boolean } {
  return getCardImageUrl({
    farmstandId: farmstand.id,
    photos: farmstand.photos,
    mainPhotoIndex: farmstand.mainPhotoIndex ?? 0,
    offerings: farmstand.offerings,
    categories: farmstand.categories,
    heroImageUrl: farmstand.heroImageUrl,
    heroImageTheme: farmstand.heroImageTheme,
    heroImageSeed: farmstand.heroImageSeed,
  });
}

/**
 * Get images for a list of farmstands with deduplication for adjacent cards
 * Ensures no two adjacent farmstands have the same AI image
 * Updated to use centralized getFarmstandCardImage for consistency
 * This ensures eggs farmstands ALWAYS show eggs images
 */
export function getDeduplicatedCardImages(
  farmstands: Array<{
    id: string;
    photos: string[];
    mainPhotoIndex?: number;
    offerings: string[];
    categories?: string[];
    primaryImageMode?: 'uploaded' | 'ai_fallback';
    fallbackImageKey?: string | null;
    heroImageUrl?: string | null;
    heroImageTheme?: string | null;
    heroImageSeed?: number | null;
  }>
): Map<string, { url: string; isAIGenerated: boolean }> {
  const results = new Map<string, { url: string; isAIGenerated: boolean }>();
  let lastAIImageUrl = '';

  for (const farmstand of farmstands) {
    // Use the centralized getFarmstandCardImage which respects all priority rules
    const cardImage = getFarmstandCardImage({
      id: farmstand.id,
      photos: farmstand.photos,
      mainPhotoIndex: farmstand.mainPhotoIndex ?? 0,
      offerings: farmstand.offerings,
      categories: farmstand.categories ?? [],
      primaryImageMode: farmstand.primaryImageMode,
      fallbackImageKey: farmstand.fallbackImageKey,
      heroImageUrl: farmstand.heroImageUrl,
      heroImageTheme: farmstand.heroImageTheme,
      heroImageSeed: farmstand.heroImageSeed,
    });

    // If it's a real photo, no deduplication needed
    if (!cardImage.isAIGenerated) {
      results.set(farmstand.id, {
        url: cardImage.url,
        isAIGenerated: false,
      });
      lastAIImageUrl = ''; // Reset since this isn't an AI image
    } else {
      // AI image - check for duplicates with previous card
      let aiImageUrl = cardImage.url;

      // If same as last AI image, try to get an alternative variant
      if (aiImageUrl === lastAIImageUrl && cardImage.fallbackKey) {
        const images = FALLBACK_IMAGE_URLS[cardImage.fallbackKey] ?? FALLBACK_IMAGE_URLS.farm_default;
        const currentIndex = images.findIndex(url => aiImageUrl.includes(url.split('?')[0]));
        if (currentIndex !== -1 && images.length > 1) {
          // Use next variant in the array
          aiImageUrl = cacheBust(images[(currentIndex + 1) % images.length]);
        }
      }

      results.set(farmstand.id, {
        url: aiImageUrl,
        isAIGenerated: true,
      });
      lastAIImageUrl = aiImageUrl;
    }
  }

  return results;
}

/**
 * Helper to get best category for offerings (used by deduplication)
 * Uses the same HIGH_PRIORITY_CATEGORY_RULES for consistency
 */
function getBestCategoryForOfferings(offerings: string[]): string {
  if (!offerings || offerings.length === 0) return 'default';

  // Use the centralized determineFallbackImageKey which respects HIGH_PRIORITY_CATEGORY_RULES
  const fallbackKey = determineFallbackImageKey(offerings, []);

  // Map fallback key to AI_PRODUCT_IMAGE_VARIANTS category
  const categoryMap: Record<FallbackImageKey, string> = {
    'eggs_fresh_carton_closeup': 'eggs',
    'artisan_bread_loaves_rustic': 'baked_goods',
    'honeycomb_jar_drizzle': 'honey',
    'bouquet_field_handpicked': 'flowers',
    'farm_ranch_cuts_wrapped': 'meat',
    'mixed_produce_colorful': 'produce',
    'jars_of_jam_on_table': 'preserves',
    'fresh_herbs_bundle': 'plants',
    'handmade_goods_table_display': 'crafts',
    'dairy_products_display': 'dairy',
    'potted_plants_nursery': 'plants',
    'pumpkin_autumn_display': 'pumpkins',
    'fruit_basket_colorful': 'fruit',
    'tomatoes_vine_heirloom': 'tomatoes',
    'corn_fresh_harvest': 'corn',
    'berries_fresh_basket': 'berries',
    'farm_default': 'default',
  };

  return categoryMap[fallbackKey] ?? 'default';
}

/**
 * FAILSAFE FALLBACK IMAGE
 * Used when all else fails or image fails to load
 * Neutral farm scene with no products (so it works for any farmstand)
 */
export const FAILSAFE_FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1500076656116-558758c991c1?w=1200&q=80&v=2';

/**
 * DEFAULT_FARM_IMAGE - The single fallback for any card without an image
 * Use this constant everywhere for consistency
 */
export const DEFAULT_FARM_IMAGE = FAILSAFE_FALLBACK_IMAGE;

/**
 * Add cache bust to URL
 */
function cacheBust(url: string): string {
  if (url.includes('?')) {
    return url.includes('v=') ? url : `${url}&v=2`;
  }
  return `${url}?v=2`;
}

/**
 * Check if farmstand sells eggs (case-insensitive)
 */
function hasEggsInOfferings(offerings: string[], categories: string[]): boolean {
  const all = [...offerings, ...categories].map(s => s.toLowerCase()).join(' ');
  return all.includes('egg');
}

/**
 * CENTRALIZED FUNCTION: Get card image for a Farmstand
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH for all card images.
 * Use this function in ALL components that display farmstand cards:
 * - Explore screen
 * - Map screen
 * - Favorites screen
 * - Search results
 *
 * STANDARDIZED Priority Order (hero_image_url is THE source):
 * 1. hero_image_url from database (THE SINGLE SOURCE OF TRUTH)
 * 2. Category-based AI fallback image (based on offerings)
 * 3. DEFAULT_FARM_IMAGE (never blank)
 *
 * NOTE: heroPhotoUrl, aiPhotoUrl, photoUrl, imageUrl are DEPRECATED.
 * All uploaded images should be saved to hero_image_url ONLY.
 */
export function getFarmstandCardImage(farmstand: {
  id: string;
  photos: string[];
  mainPhotoIndex?: number;
  offerings: string[];
  categories?: string[];
  primaryImageMode?: 'uploaded' | 'ai_fallback';
  fallbackImageKey?: string | null;
  heroPhotoUrl?: string | null;
  aiPhotoUrl?: string | null;
  heroImageUrl?: string | null;
  heroImageTheme?: string | null;
  heroImageSeed?: number | null;
  // NEW: Main product AI image fields
  mainProduct?: string | null;
  aiImageUrl?: string | null;
  aiImageSeed?: string | null;
}): { url: string; isAIGenerated: boolean; fallbackKey: FallbackImageKey | null } {
  const {
    id,
    photos,
    mainPhotoIndex = 0,
    offerings,
    categories = [],
    primaryImageMode,
    fallbackImageKey,
    heroPhotoUrl,
    aiPhotoUrl,
    heroImageUrl,
    heroImageTheme,
    heroImageSeed,
    // NEW fields
    mainProduct,
    aiImageUrl,
    aiImageSeed,
  } = farmstand;

  // Helper to check if URL is a valid remote URL (not a local file:// URI)
  const isValidRemoteUrl = (url: string | null | undefined): url is string => {
    return Boolean(url && url.startsWith('http'));
  };

  // PRIORITY 1: hero_image_url - THE SINGLE SOURCE OF TRUTH
  // This is where ALL uploaded photos should be stored
  if (isValidRemoteUrl(heroImageUrl)) {
    console.log(`[CardImage] Using UPLOADED photo for farmstand ${id}`);
    return {
      url: heroImageUrl,
      isAIGenerated: false,
      fallbackKey: null,
    };
  }

  // LEGACY FALLBACK: heroPhotoUrl (deprecated - migrate to hero_image_url)
  if (isValidRemoteUrl(heroPhotoUrl)) {
    console.log(`[CardImage] Using UPLOADED photo (legacy heroPhotoUrl) for farmstand ${id}`);
    return {
      url: heroPhotoUrl,
      isAIGenerated: false,
      fallbackKey: null,
    };
  }

  // LEGACY FALLBACK: First photo from photos array (deprecated)
  const mainPhoto = photos?.[mainPhotoIndex];
  if (isValidRemoteUrl(mainPhoto) && primaryImageMode !== 'ai_fallback') {
    console.log(`[CardImage] Using UPLOADED photo (legacy photos array) for farmstand ${id}`);
    return {
      url: mainPhoto,
      isAIGenerated: false,
      fallbackKey: null,
    };
  }

  // PRIORITY 2: NEW ai_image_url - Unique AI image based on main_product
  // This is the new system: unique AI image per farmstand based on main_product
  if (isValidRemoteUrl(aiImageUrl)) {
    console.log(`[CardImage] Using AI image (main_product: ${mainProduct}, seed: ${aiImageSeed}) for farmstand ${id}`);
    return {
      url: aiImageUrl,
      isAIGenerated: true,
      fallbackKey: null,
    };
  }

  // PRIORITY 3: Category-based AI image (determined by offerings/categories)
  // This ensures eggs farmstands show eggs, honey shows honey, etc.
  const derivedFallbackKey = determineFallbackImageKey(offerings, categories);
  if (derivedFallbackKey !== 'farm_default') {
    const url = cacheBust(getImageFromFallbackKey(derivedFallbackKey, id));
    console.log(`[CardImage] Using AI fallback (${derivedFallbackKey}) for farmstand ${id}`);
    return {
      url,
      isAIGenerated: true,
      fallbackKey: derivedFallbackKey,
    };
  }

  // LEGACY: Stored ai_photo_url from database
  if (isValidRemoteUrl(aiPhotoUrl)) {
    console.log(`[CardImage] Using AI fallback (legacy aiPhotoUrl) for farmstand ${id}`);
    return {
      url: cacheBust(aiPhotoUrl),
      isAIGenerated: true,
      fallbackKey: null,
    };
  }

  // LEGACY: Has stored fallback_image_key
  if (fallbackImageKey && FALLBACK_IMAGE_URLS[fallbackImageKey as FallbackImageKey]) {
    const url = cacheBust(getImageFromFallbackKey(fallbackImageKey as FallbackImageKey, id));
    console.log(`[CardImage] Using AI fallback (legacy fallbackImageKey: ${fallbackImageKey}) for farmstand ${id}`);
    return {
      url,
      isAIGenerated: true,
      fallbackKey: fallbackImageKey as FallbackImageKey,
    };
  }

  // LEGACY: Has stored heroImageTheme + heroImageSeed
  if (heroImageTheme && heroImageSeed !== null && heroImageSeed !== undefined) {
    const variants = AI_PRODUCT_IMAGE_VARIANTS[heroImageTheme] ?? AI_PRODUCT_IMAGE_VARIANTS.default;
    const index = heroImageSeed % variants.length;
    console.log(`[CardImage] Using AI fallback (legacy heroImageTheme: ${heroImageTheme}) for farmstand ${id}`);
    return {
      url: cacheBust(variants[index]),
      isAIGenerated: true,
      fallbackKey: null,
    };
  }

  // PRIORITY 4: Default farm fallback - NEVER return blank
  console.log(`[CardImage] Using AI fallback (farm_default) for farmstand ${id}`);
  return {
    url: DEFAULT_FARM_IMAGE,
    isAIGenerated: true,
    fallbackKey: 'farm_default',
  };
}

/**
 * Get the failsafe fallback image for when an image fails to load
 * Uses the farmstand's offerings to pick a relevant fallback
 */
export function getFailsafeFallback(farmstand: {
  id: string;
  offerings: string[];
  categories?: string[];
  fallbackImageKey?: string | null;
}): string {
  // If we have a stored fallback key, use it
  if (farmstand.fallbackImageKey && FALLBACK_IMAGE_URLS[farmstand.fallbackImageKey as FallbackImageKey]) {
    return getImageFromFallbackKey(farmstand.fallbackImageKey as FallbackImageKey, farmstand.id);
  }

  // Otherwise derive from offerings
  const fallbackKey = determineFallbackImageKey(farmstand.offerings, farmstand.categories ?? []);
  return getImageFromFallbackKey(fallbackKey, farmstand.id);
}
