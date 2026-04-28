/**
 * FarmstandLogoPng — single source of truth for the Farmstand PNG brand logo.
 *
 * Used by SplashScreen (loading screen) and FarmstandHeroImage (fallback hero)
 * so both screens always render the exact same asset with the exact same values.
 *
 * tight=true: clips the built-in transparent padding from the PNG (302 transparent
 * rows at top, 379 at bottom, out of 1024 total). At the default 360×140 render
 * size this trims ~41px above and ~52px below, leaving only the 47px of visible art.
 */

import React from 'react';
import { Image, View, StyleSheet } from 'react-native';

export const LOGO_WIDTH = 360;
export const LOGO_HEIGHT = 140;

// Transparent rows in the PNG asset (verified by pixel scan):
//   top: 302 rows, bottom: 379 rows, content: 343 rows (out of 1024 total)
// At contain-render height of 140px → scale = 140/1024:
const TIGHT_TOP_CLIP = 41;    // Math.round(302 * 140/1024)
const TIGHT_CONTENT_H = 47;   // Math.ceil(343 * 140/1024)

interface FarmstandLogoPngProps {
  width?: number;
  height?: number;
  /** Pass a color string to tint, or undefined/null for original asset colors */
  tintColor?: string | null;
  /**
   * When true, wraps the image in an overflow:hidden container that clips the
   * built-in transparent padding so the layout box hugs the visible artwork.
   * Only calibrated for the default 360×140 size.
   */
  tight?: boolean;
}

export function FarmstandLogoPng({
  width = LOGO_WIDTH,
  height = LOGO_HEIGHT,
  tintColor = '#FFFFFF',
  tight = false,
}: FarmstandLogoPngProps) {
  if (tight) {
    // Scale clip values proportionally to the requested width so tight works at any size.
    const scale = width / LOGO_WIDTH;
    const scaledHeight = Math.round(LOGO_HEIGHT * scale);
    const scaledTopClip = Math.round(TIGHT_TOP_CLIP * scale);
    const scaledContentH = Math.ceil(TIGHT_CONTENT_H * scale);
    // Use position:absolute instead of overflow:hidden to avoid forcing an offscreen
    // compositing buffer on iOS, which softens edges. Transparent padding extends beyond
    // the View bounds but is invisible, so visual output is identical.
    return (
      <View style={{ width, height: scaledContentH }}>
        <Image
          source={require('../../assets/farmstand-logo.png')}
          style={[styles.logo, { width, height: scaledHeight, position: 'absolute', top: -scaledTopClip }]}
          resizeMode="contain"
          tintColor={tintColor ?? undefined}
          fadeDuration={0}
        />
      </View>
    );
  }

  return (
    <Image
      source={require('../../assets/farmstand-logo.png')}
      style={[styles.logo, { width, height }]}
      resizeMode="contain"
      tintColor={tintColor ?? undefined}
      fadeDuration={0}
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    flexShrink: 0,
  },
});
