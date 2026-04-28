import React from 'react';
import { View, Text } from 'react-native';

// Premium status types that indicate active premium
type PremiumStatus = 'free' | 'trial' | 'active' | 'expired' | null | undefined;

/**
 * Returns true when a farmstand has an active Premium membership
 * (either a paid subscription or a free trial).
 *
 * Safely handles null/undefined premium_status values.
 */
export function isPremiumFarmstand(premiumStatus: PremiumStatus): boolean {
  return premiumStatus === 'trial' || premiumStatus === 'active';
}

interface PremiumBadgeProps {
  /** Size variant for the badge */
  size?: 'small' | 'default';
}

/**
 * A small, clean pill badge displayed on Premium Farmstands.
 * Only render this when isPremiumFarmstand() returns true.
 *
 * Usage:
 *   {isPremiumFarmstand(farmstand.premiumStatus) && <PremiumBadge />}
 */
export function PremiumBadge({ size = 'default' }: PremiumBadgeProps) {
  const isSmall = size === 'small';

  return (
    <View
      style={{
        backgroundColor: '#E8F0E9',
        borderRadius: 20,
        paddingHorizontal: isSmall ? 7 : 9,
        paddingVertical: isSmall ? 2 : 3,
        borderWidth: 1,
        borderColor: '#B8D4BB',
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color: '#2D5A3D',
          fontSize: isSmall ? 9 : 11,
          fontWeight: '600',
          letterSpacing: 0.2,
        }}
      >
        Premium
      </Text>
    </View>
  );
}
