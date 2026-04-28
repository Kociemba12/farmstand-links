/**
 * UNIFIED Farmstand Image Helper
 * ===============================
 *
 * Simple rules:
 * 1. If hero_image_url exists → use it (uploaded photo, always wins)
 * 2. Otherwise → FARMSTAND_FALLBACK_IMAGE (single branded fallback)
 *
 * No AI generation. No product-based selection. No keyword matching.
 */

/**
 * Remote fallback removed — use local require('../assets/images/farmstand-final-fallback.png')
 * in UI components instead.
 */
export const FARMSTAND_FALLBACK_IMAGE = '';

/** @deprecated Use local fallbackHero asset in UI components */
export const DEFAULT_PLACEHOLDER_IMAGE = '';

/**
 * Normalize a Supabase Storage image URL for display.
 *
 * Rules:
 * 1. /render/image/ URLs → strip params, apply fresh width/quality transform.
 * 2. /object/public/ URLs → convert to /render/image/public/ so the original
 *    (potentially multi-megapixel) upload is never sent to the client raw.
 * 3. Non-Supabase URLs → pass through unchanged.
 *
 * @param width  Target display width in CSS pixels (default 1200 for heroes).
 *               Use 800 for card thumbnails via getCardThumbnailUrl().
 */
export function normalizeSupabaseHeroImageUrl(url: string, width: number = 1200): string {
  if (!url || !url.includes('supabase.co')) return url;

  let workingUrl = url;

  if (workingUrl.includes('/storage/v1/render/image/')) {
    // Already a transform URL — strip stale params and re-apply with requested width.
    workingUrl = `${workingUrl.split('?')[0]}?width=${width}&quality=90`;
  } else if (workingUrl.includes('/storage/v1/object/public/')) {
    // Raw Supabase Storage URL — route through the image transform API so the
    // original upload is resized/compressed before delivery.  Supabase's imgproxy
    // layer handles JPEG, PNG, WebP, HEIC, and other common photo formats.
    workingUrl = workingUrl
      .split('?')[0]
      .replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    workingUrl = `${workingUrl}?width=${width}&quality=90`;
  }

  return workingUrl;
}

/**
 * Like normalizeSupabaseHeroImageUrl but sized for card thumbnails.
 * 800 CSS px covers 3× Retina for cards up to ~267 px wide — enough for all
 * Explore/Map/Favorites cards while sending ~55% less data than width=1200.
 */
export function getCardThumbnailUrl(url: string): string {
  return normalizeSupabaseHeroImageUrl(url, 800);
}

/**
 * Helper to check if URL is a valid remote URL
 */
function isValidRemoteUrl(url: string | null | undefined): url is string {
  return Boolean(url && url.trim().length > 0 && url.startsWith('http'));
}

/**
 * Result type for getFarmstandDisplayImage
 */
export interface FarmstandDisplayImageResult {
  /** The image URL to display */
  url: string;
  /**
   * true  = fallback image (no uploaded photo)
   * false = real uploaded photo
   */
  isAI: boolean;
  /** Source of the image */
  source: 'hero_image_url' | 'fallback';
}

/**
 * UNIFIED FUNCTION — use this everywhere to get the farmstand display image.
 *
 * Priority:
 * 1. photos[mainPhotoIndex] → photos[0] (user-selected main photo from photos array)
 * 2. heroPhotoUrl / hero_photo_url (legacy upload field)
 * 3. hero_image_url / heroImageUrl (legacy field, may have stale/AI URL)
 * 4. FARMSTAND_FALLBACK_IMAGE
 *
 * Extra props (ai_image_url, main_product, offerings, categories, etc.)
 * are accepted for backward compat but ignored.
 */
export function getFarmstandDisplayImage(farmstand: {
  id?: string;
  /** photos array from DB — used to find the main photo via mainPhotoIndex */
  photos?: string[] | null;
  /** index of the selected main photo in the photos array; defaults to 0 */
  mainPhotoIndex?: number | null;
  /** hero_photo_url DB column — actual user-uploaded photo */
  heroPhotoUrl?: string | null;
  /** snake_case alias for heroPhotoUrl */
  hero_photo_url?: string | null;
  /** hero_image_url DB column — legacy field, may have stale/AI URL */
  hero_image_url?: string | null;
  heroImageUrl?: string | null;
  // accepted for backward compat, intentionally ignored:
  ai_image_url?: string | null;
  aiImageUrl?: string | null;
  main_product?: string | null;
  mainProduct?: string | null;
  offerings?: string[];
  categories?: string[];
}): FarmstandDisplayImageResult {
  // 1. photos[mainPhotoIndex] → photos[0] — user-selected main photo (source of truth)
  const photos = farmstand.photos;
  if (photos && photos.length > 0) {
    const idx = farmstand.mainPhotoIndex ?? 0;
    const mainPhoto = photos[idx] ?? photos[0];
    if (isValidRemoteUrl(mainPhoto)) {
      return {
        url: mainPhoto,
        isAI: false,
        source: 'hero_image_url',
      };
    }
  }

  // 2. heroPhotoUrl / hero_photo_url → 3. hero_image_url / heroImageUrl
  const heroPhotoUrl = farmstand.heroPhotoUrl ?? farmstand.hero_photo_url;
  const heroImageUrl = farmstand.hero_image_url ?? farmstand.heroImageUrl;
  const effectiveUrl = (heroPhotoUrl && heroPhotoUrl.startsWith('http') ? heroPhotoUrl : null)
    ?? (heroImageUrl && heroImageUrl.startsWith('http') ? heroImageUrl : null);

  if (isValidRemoteUrl(effectiveUrl)) {
    return {
      url: effectiveUrl,
      isAI: false,
      source: 'hero_image_url',
    };
  }

  return {
    url: '',
    isAI: true,
    source: 'fallback',
  };
}

/** @deprecated Use local fallbackHero asset in UI components */
export function getPlaceholderImage(): string {
  return '';
}

/**
 * Always returns false — AI image generation has been removed.
 * Kept for backward compat; callers can safely be cleaned up over time.
 */
export function needsAIImageGeneration(_farmstand: {
  heroPhotoUrl?: string | null;
  hero_photo_url?: string | null;
  hero_image_url?: string | null;
  heroImageUrl?: string | null;
  ai_image_url?: string | null;
  aiImageUrl?: string | null;
}): boolean {
  return false;
}
