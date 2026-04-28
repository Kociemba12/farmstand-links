import React from 'react';
import { View, Text } from 'react-native';
import { Award } from 'lucide-react-native';

// Gold color matching the app's gold theme
const GOLD_COLOR = '#D4943A';

interface GoldVerifiedRibbonProps {
  /** Size of the ribbon icon (default: 14) */
  size?: number;
}

/**
 * A small gold ribbon icon that indicates a farmstand is Gold Verified.
 * Used inline next to farmstand names throughout the app.
 */
export function GoldVerifiedRibbon({ size = 14 }: GoldVerifiedRibbonProps) {
  return (
    <View style={{ marginLeft: 4, justifyContent: 'center' }}>
      <Award size={size} color={GOLD_COLOR} fill={GOLD_COLOR} strokeWidth={2} />
    </View>
  );
}

interface FarmstandNameWithBadgeProps {
  /** The farmstand name to display */
  name: string;
  /** Whether the farmstand is gold verified */
  goldVerified?: boolean;
  /** Text style class names (NativeWind) */
  textClassName?: string;
  /** Additional text style */
  textStyle?: object;
  /** Number of lines before truncating (default: 1) */
  numberOfLines?: number;
  /** Size of the gold ribbon icon (default: 14) */
  ribbonSize?: number;
}

/**
 * A farmstand name with an optional gold verified ribbon.
 * Use this component to display farmstand names consistently across the app.
 */
export function FarmstandNameWithBadge({
  name,
  goldVerified = false,
  textClassName = 'text-charcoal font-bold text-base',
  textStyle,
  numberOfLines = 1,
  ribbonSize = 14,
}: FarmstandNameWithBadgeProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
      <Text
        className={textClassName}
        style={[{ flexShrink: 1 }, textStyle]}
        numberOfLines={numberOfLines}
      >
        {name}
      </Text>
      {goldVerified && <GoldVerifiedRibbon size={ribbonSize} />}
    </View>
  );
}
