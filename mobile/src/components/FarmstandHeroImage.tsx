/**
 * FarmstandHeroImage Component
 *
 * Smart hero image component that:
 * - Uses the UNIFIED getFarmstandDisplayImage helper
 * - hero_image_url is THE SINGLE SOURCE OF TRUTH for uploaded photos
 * - ai_image_url is THE SINGLE SOURCE OF TRUTH for AI images
 *
 * STANDARDIZED: This component uses the same image logic as all other places.
 */

import React, { useMemo } from 'react';
import { View, Image, Pressable, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getFarmstandDisplayImage, DEFAULT_PLACEHOLDER_IMAGE } from '@/lib/farmstand-image';
import type { ClaimStatus, VerificationStatus } from '@/lib/farmer-store';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface FarmstandHeroImageProps {
  /** Farmstand ID */
  farmstandId: string;
  /** Farmstand claim status */
  claimStatus: ClaimStatus;
  /** Farmstand verification status */
  verificationStatus: VerificationStatus;
  /** Product categories for AI image selection */
  categories: string[];
  /** Product offerings for additional AI image matching */
  offerings?: string[];
  /** User-uploaded hero image URL (highest priority) */
  heroImageUrl?: string | null;
  /** AI-generated image URL */
  aiImageUrl?: string | null;
  /** Main product for AI image generation */
  mainProduct?: string | null;
  /** Height of the hero image */
  height?: number;
  /** Callback when image is pressed */
  onPress?: () => void;
  /** Optional gradient colors */
  gradientColors?: readonly [string, string, ...string[]];
  /** Optional gradient locations */
  gradientLocations?: readonly [number, number, ...number[]];
  /** Children to render on top of the image (e.g., header buttons) */
  children?: React.ReactNode;
  /** Show photo count badge */
  showPhotoCount?: boolean;
  /** Custom photo count component */
  photoCountBadge?: React.ReactNode;
}

export function FarmstandHeroImage({
  farmstandId,
  categories,
  offerings,
  heroImageUrl,
  aiImageUrl,
  mainProduct,
  height = 340,
  onPress,
  gradientColors = ['rgba(0,0,0,0.4)', 'transparent', 'transparent', 'rgba(0,0,0,0.5)'] as const,
  gradientLocations = [0, 0.3, 0.6, 1] as const,
  children,
  showPhotoCount = true,
  photoCountBadge,
}: FarmstandHeroImageProps) {
  // Get the display image URL using unified helper
  const { imageUrl, isAIGenerated } = useMemo(() => {
    const result = getFarmstandDisplayImage({
      id: farmstandId,
      hero_image_url: heroImageUrl,
      ai_image_url: aiImageUrl,
      main_product: mainProduct,
      offerings: offerings ?? [],
      categories: categories ?? [],
    });

    return {
      imageUrl: result.url,
      isAIGenerated: result.isAI,
    };
  }, [farmstandId, heroImageUrl, aiImageUrl, mainProduct, offerings, categories]);

  const content = (
    <View style={[styles.container, { height }]}>
      <Image
        source={{ uri: imageUrl || DEFAULT_PLACEHOLDER_IMAGE }}
        style={styles.image}
        resizeMode="cover"
      />

      <LinearGradient
        colors={gradientColors}
        locations={gradientLocations}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Photo count badge - only for non-AI images */}
      {!isAIGenerated && showPhotoCount && photoCountBadge}

      {/* Children (header buttons, etc.) */}
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress}>
        {content}
      </Pressable>
    );
  }

  return content;
}

/**
 * Hook to get hero image data for a farmstand
 * STANDARDIZED: Uses unified getFarmstandDisplayImage helper
 */
export function useFarmstandHeroImage(params: {
  farmstandId?: string;
  heroImageUrl?: string | null;
  aiImageUrl?: string | null;
  mainProduct?: string | null;
  categories: string[];
  offerings?: string[];
}): { url: string; isAIGenerated: boolean } {
  return useMemo(() => {
    if (!params.farmstandId) {
      return { url: DEFAULT_PLACEHOLDER_IMAGE, isAIGenerated: true };
    }

    const result = getFarmstandDisplayImage({
      id: params.farmstandId,
      hero_image_url: params.heroImageUrl,
      ai_image_url: params.aiImageUrl,
      main_product: params.mainProduct,
      offerings: params.offerings ?? [],
      categories: params.categories ?? [],
    });

    return {
      url: result.url || DEFAULT_PLACEHOLDER_IMAGE,
      isAIGenerated: result.isAI,
    };
  }, [
    params.farmstandId,
    params.heroImageUrl,
    params.aiImageUrl,
    params.mainProduct,
    params.categories,
    params.offerings,
  ]);
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
