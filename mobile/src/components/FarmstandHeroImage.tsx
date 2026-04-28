/**
 * FarmstandHeroImage Component
 *
 * Displays the farmstand hero image:
 * - Uploaded photo → shown as-is
 * - No uploaded photo → branded Farmstand fallback with overlay
 *
 * Always shows the Farmstand logo centered at the top of the hero.
 */

import React, { useMemo } from 'react';
import { View, Pressable, StyleSheet, Dimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getFarmstandDisplayImage } from '@/lib/farmstand-image';

const fallbackHero = require('../assets/images/farmstand-final-fallback.png') as number;
import { FarmstandLogoPng } from './FarmstandLogoPng';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface FarmstandHeroImageProps {
  /** Farmstand ID */
  farmstandId: string;
  /** User-uploaded hero image URL (highest priority) */
  heroImageUrl?: string | null;
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
  /** Show photo count badge (only shown for uploaded photos) */
  showPhotoCount?: boolean;
  /** Custom photo count component */
  photoCountBadge?: React.ReactNode;
}

export function FarmstandHeroImage({
  farmstandId,
  heroImageUrl,
  height = 340,
  onPress,
  gradientColors = ['rgba(0,0,0,0.4)', 'transparent', 'transparent', 'rgba(0,0,0,0.55)'] as const,
  gradientLocations = [0, 0.3, 0.6, 1] as const,
  children,
  showPhotoCount = true,
  photoCountBadge,
}: FarmstandHeroImageProps) {
  const insets = useSafeAreaInsets();

  const { imageUrl, isFallback } = useMemo(() => {
    const result = getFarmstandDisplayImage({
      id: farmstandId,
      hero_image_url: heroImageUrl,
    });
    return { imageUrl: result.url, isFallback: result.isAI };
  }, [farmstandId, heroImageUrl]);

  // Top position for logo: safe area top + ~20px — places it in the sky/sun area
  const logoTop = insets.top + 20;

  const content = (
    <View style={[styles.container, { height }]}>
      {/* Background hero image */}
      <ExpoImage
        source={isFallback ? fallbackHero : { uri: imageUrl }}
        style={styles.image}
        contentFit="cover"
        transition={250}
        cachePolicy="memory-disk"

        recyclingKey={isFallback ? 'fallback' : imageUrl}
      />

      {/* Bottom gradient overlay (existing) */}
      <LinearGradient
        colors={gradientColors}
        locations={gradientLocations}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Top gradient overlay — ensures logo is always readable on bright images */}
      <LinearGradient
        colors={['rgba(0,0,0,0.35)', 'transparent']}
        style={[styles.topGradient]}
      />

      {/* Farmstand logo — only shown on fallback (non-uploaded) hero images */}
      {isFallback && (
        <View style={[styles.logoContainer, { top: logoTop }]}>
          <FarmstandLogoPng width={240} height={93} tintColor={null} />
        </View>
      )}

      {/* Photo count badge — only for uploaded photos */}
      {!isFallback && showPhotoCount && photoCountBadge}

      {children}
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }

  return content;
}

/**
 * Hook to get hero image data for a farmstand
 */
export function useFarmstandHeroImage(params: {
  farmstandId?: string;
  heroImageUrl?: string | null;
}): { url: string; isAIGenerated: boolean } {
  return useMemo(() => {
    if (!params.farmstandId) {
      return { url: '', isAIGenerated: true };
    }
    const result = getFarmstandDisplayImage({
      id: params.farmstandId,
      hero_image_url: params.heroImageUrl,
    });
    return { url: result.isAI ? '' : result.url, isAIGenerated: result.isAI };
  }, [params.farmstandId, params.heroImageUrl]);
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
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  logoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    opacity: 1,
  },

});
