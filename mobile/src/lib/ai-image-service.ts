/**
 * AI Image Generation Service
 *
 * Handles generating unique AI images for farmstands based on their main product.
 * Images are generated once and stored in the database.
 *
 * RULES:
 * 1. If hero_image_url exists -> ALWAYS display it (uploaded photo takes priority)
 * 2. If hero_image_url is null/empty AND main_product is set -> Generate AI image
 * 3. AI image seed = `{farmstand.id}:{main_product}` for uniqueness
 * 4. Never overwrite hero_image_url with AI logic
 */

import { supabase, isSupabaseConfigured } from './supabase';
import Constants from 'expo-constants';

// Get backend URL from environment
const BACKEND_URL = Constants.expoConfig?.extra?.BACKEND_URL ||
  process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL ||
  'http://localhost:3000';

export interface AIImageGenerationResult {
  success: boolean;
  aiImageUrl?: string;
  aiImageSeed?: string;
  aiImageUpdatedAt?: string;
  mainProduct?: string;
  error?: string;
}

/**
 * Generate AI image for a farmstand based on main product
 * Only call this when hero_image_url is null/empty
 */
export async function generateAIImageForFarmstand(
  farmstandId: string,
  mainProduct: string
): Promise<AIImageGenerationResult> {
  console.log(`[AIImageService] Starting AI image generation for farmstand ${farmstandId}`);
  console.log(`[AIImageService] Main product: ${mainProduct}`);

  if (!farmstandId || !mainProduct) {
    console.error('[AIImageService] Missing farmstandId or mainProduct');
    return { success: false, error: 'Missing farmstandId or mainProduct' };
  }

  // Build deterministic seed
  const aiImageSeed = `${farmstandId}:${mainProduct}`;
  console.log(`[AIImageService] Generated ai_image_seed: ${aiImageSeed}`);

  try {
    console.log(`[AIImageService] Calling backend at ${BACKEND_URL}/api/ai-image/generate`);

    const response = await fetch(`${BACKEND_URL}/api/ai-image/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        farmstandId,
        mainProduct,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AIImageService] API error: ${response.status} - ${errorText}`);
      return { success: false, error: `API error: ${response.status}` };
    }

    const aict = response.headers.get('content-type') ?? '';
    if (!aict.includes('application/json')) {
      console.log('[AIImageService] Non-JSON response from ai-image/generate (HTTP', response.status, '), content-type:', aict);
      return { success: false, error: `Unexpected response from server (HTTP ${response.status})` };
    }
    const data = await response.json();

    if (!data.success || !data.aiImageUrl) {
      console.error('[AIImageService] No image URL in response:', data);
      return { success: false, error: data.error || 'No image URL returned' };
    }

    console.log(`[AIImageService] Successfully generated AI image`);
    console.log(`[AIImageService] AI Image URL: ${data.aiImageUrl.substring(0, 80)}...`);

    return {
      success: true,
      aiImageUrl: data.aiImageUrl,
      aiImageSeed: data.aiImageSeed,
      aiImageUpdatedAt: data.aiImageUpdatedAt,
      mainProduct: data.mainProduct,
    };
  } catch (error) {
    console.error('[AIImageService] Generation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Generate AI image and save to Supabase
 * This is the main function to call when a farmstand needs an AI image
 */
export async function generateAndSaveAIImage(
  farmstandId: string,
  mainProduct: string
): Promise<AIImageGenerationResult> {
  console.log(`[AIImageService] Generate and save AI image for farmstand ${farmstandId}`);

  // Generate the image
  const result = await generateAIImageForFarmstand(farmstandId, mainProduct);

  if (!result.success || !result.aiImageUrl) {
    console.error('[AIImageService] Failed to generate AI image:', result.error);
    return result;
  }

  // Save to Supabase
  if (isSupabaseConfigured()) {
    console.log('[AIImageService] Saving AI image to Supabase...');

    const { error: updateError } = await supabase
      .from('farmstands')
      .update({
        ai_image_url: result.aiImageUrl,
        ai_image_seed: result.aiImageSeed,
        ai_image_updated_at: result.aiImageUpdatedAt,
        main_product: mainProduct,
      })
      .eq('id', farmstandId)
      .execute();

    if (updateError) {
      console.error('[AIImageService] Supabase update error:', updateError);
      // Still return success since we have the image URL
      return { ...result, error: `DB update failed: ${updateError.message}` };
    }

    console.log('[AIImageService] Successfully saved AI image to Supabase');
  } else {
    console.warn('[AIImageService] Supabase not configured, skipping DB save');
  }

  return result;
}

/**
 * Check if farmstand needs AI image generation
 * Returns true if:
 * - hero_image_url is null/empty (no uploaded photo)
 * - main_product is set
 * - ai_image_url is null/empty OR main_product changed
 */
export function needsAIImageGeneration(farmstand: {
  heroImageUrl?: string | null;
  mainProduct?: string | null;
  aiImageUrl?: string | null;
  aiImageSeed?: string | null;
}): boolean {
  // If there's an uploaded photo, no AI image needed
  if (farmstand.heroImageUrl && farmstand.heroImageUrl.trim().length > 0) {
    console.log('[AIImageService] Has uploaded photo, skipping AI generation');
    return false;
  }

  // If no main product selected, can't generate AI image
  if (!farmstand.mainProduct) {
    console.log('[AIImageService] No main product selected, skipping AI generation');
    return false;
  }

  // If already has AI image with same seed, no need to regenerate
  if (farmstand.aiImageUrl && farmstand.aiImageSeed) {
    const expectedSeed = `${farmstand.aiImageSeed?.split(':')[0]}:${farmstand.mainProduct}`;
    if (farmstand.aiImageSeed === expectedSeed) {
      console.log('[AIImageService] AI image already exists with matching seed');
      return false;
    }
  }

  console.log('[AIImageService] AI image generation needed');
  return true;
}

/**
 * Get the display image URL for a farmstand
 * Priority:
 * 1. hero_image_url (uploaded photo) - ALWAYS takes priority
 * 2. ai_image_url (generated AI image)
 * 3. null (no image available)
 */
export function getFarmstandDisplayImage(farmstand: {
  heroImageUrl?: string | null;
  aiImageUrl?: string | null;
}): { url: string | null; isUploaded: boolean; isAI: boolean } {
  // Priority 1: Uploaded photo
  if (farmstand.heroImageUrl && farmstand.heroImageUrl.trim().length > 0) {
    console.log('[AIImageService] Using UPLOADED photo');
    return {
      url: farmstand.heroImageUrl,
      isUploaded: true,
      isAI: false,
    };
  }

  // Priority 2: AI generated image
  if (farmstand.aiImageUrl && farmstand.aiImageUrl.trim().length > 0) {
    console.log('[AIImageService] Using AI fallback');
    return {
      url: farmstand.aiImageUrl,
      isUploaded: false,
      isAI: true,
    };
  }

  // No image available
  console.log('[AIImageService] No image available');
  return {
    url: null,
    isUploaded: false,
    isAI: false,
  };
}
