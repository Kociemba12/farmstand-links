/**
 * FarmstandPinMarker - Simple teardrop map pin marker with white center dot
 *
 * DESIGN SPEC:
 * - Green teardrop pin with small white circle centered inside
 * - Transparent background - NO outer circles, rings, halos, or outlines
 * - White dot: ~25-30% of pin width, centered in widest part
 * - NO selection state visuals - pin never changes appearance
 * - NO animations (no pulsing, scaling, bouncing)
 * - Constant size at all times
 * - Anchor at bottom-center of pin tip
 *
 * Use this component for ALL map markers across the app:
 * - Main Map tab
 * - Explore map
 * - Search results map
 * - Filtered map views
 * - Admin dashboard maps
 * - Farmstand approval maps
 * - Farmer profile maps
 * - Guest profile maps
 */

import React from 'react';
import { View } from 'react-native';
import { MapPin } from 'lucide-react-native';

// Brand color - Farmstand green
const FOREST_GREEN = '#2D5A3D';

// Fixed pin size - never changes
const PIN_SIZE = 32;

// White dot size (~38% of pin width, increased for better visibility)
const DOT_SIZE = 12;

// Position the dot in the center of the pin's wide part (upper portion)
// MapPin icon has the wide part at roughly 35% from top
// Adjusted for larger dot size to stay centered
const DOT_TOP_OFFSET = 6;

export interface FarmstandPinMarkerProps {
  /**
   * Optional callback when pin is pressed (handled by parent Marker)
   */
  onPress?: () => void;

  /**
   * Test ID for testing
   */
  testID?: string;
}

/**
 * Teardrop farmstand pin marker with white center dot
 *
 * Usage with react-native-maps Marker:
 * ```tsx
 * <Marker
 *   coordinate={{ latitude, longitude }}
 *   anchor={{ x: 0.5, y: 1 }}
 *   onPress={() => handleSelect(farm.id)}
 * >
 *   <FarmstandPinMarker />
 * </Marker>
 * ```
 */
export function FarmstandPinMarker({
  onPress,
  testID,
}: FarmstandPinMarkerProps) {
  return (
    <View testID={testID} style={{ width: PIN_SIZE, height: PIN_SIZE }}>
      {/* Green teardrop pin */}
      <MapPin
        size={PIN_SIZE}
        color={FOREST_GREEN}
        fill={FOREST_GREEN}
        strokeWidth={1.5}
      />
      {/* White center dot */}
      <View
        style={{
          position: 'absolute',
          top: DOT_TOP_OFFSET,
          left: (PIN_SIZE - DOT_SIZE) / 2,
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: DOT_SIZE / 2,
          backgroundColor: '#FFFFFF',
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.15,
          shadowRadius: 1,
          elevation: 1,
        }}
      />
    </View>
  );
}

/**
 * Cluster marker for grouped farmstands
 * Shows count badge - simple design matching teardrop style
 */
export interface ClusterMarkerProps {
  count: number;
  onPress?: () => void;
}

export function FarmstandClusterMarker({
  count,
}: ClusterMarkerProps) {
  const displayCount = count > 99 ? '99+' : String(count);
  const fontSize = count >= 100 ? 10 : count >= 10 ? 11 : 12;

  return (
    <View
      style={{
        backgroundColor: FOREST_GREEN,
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View>
        <MapPin size={14} color="#FDF8F3" fill="#FDF8F3" />
      </View>
      <View
        style={{
          position: 'absolute',
          top: -6,
          right: -6,
          backgroundColor: '#DC2626',
          minWidth: 18,
          height: 18,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 4,
        }}
      >
        <View>
          <MapPin size={0} color="transparent" />
        </View>
        {/* Count text rendered inline */}
        <View style={{ position: 'absolute' }}>
          <Text style={{ color: '#FFFFFF', fontSize, fontWeight: '700' }}>
            {displayCount}
          </Text>
        </View>
      </View>
    </View>
  );
}

// Need Text import for cluster
import { Text } from 'react-native';

export default FarmstandPinMarker;
