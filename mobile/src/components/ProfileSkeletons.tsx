import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Shared shimmer duration — all bars sweep in sync
const SHIMMER_DURATION = 1600;

// Base color: soft warm gray, low contrast on off-white (#FAF7F2) — Airbnb-style
const BASE_COLOR = '#EDE9E3';
// Highlight: warm white sheen, very low opacity — avoids chrome/metallic look
const HIGHLIGHT = 'rgba(255,252,248,0.65)';

function ShimmerBar({
  width,
  height,
  borderRadius = 8,
  style,
}: {
  width: number;
  height: number;
  borderRadius?: number;
  style?: object;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      false
    );
  }, []);

  // Sweep the highlight across the full card width so narrow bars still catch the light
  const sweepWidth = 120;
  const animStyle = useAnimatedStyle(() => {
    const translateX = interpolate(
      progress.value,
      [0, 1],
      [-sweepWidth, SCREEN_WIDTH]
    );
    return { transform: [{ translateX }] };
  });

  return (
    <View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: BASE_COLOR,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          animStyle,
          { width: sweepWidth },
        ]}
      >
        <LinearGradient
          colors={['transparent', HIGHLIGHT, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

// Skeleton for "My Farmstand" card — matches real card layout exactly
export function ProfileFarmstandSkeleton() {
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 22,
        marginBottom: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 10,
        elevation: 2,
      }}
    >
      {/* Thumbnail */}
      <ShimmerBar width={80} height={80} borderRadius={12} />

      {/* Text lines */}
      <View style={{ flex: 1, marginLeft: 16, gap: 9 }}>
        <ShimmerBar width={148} height={14} borderRadius={7} />
        <ShimmerBar width={104} height={11} borderRadius={6} />
      </View>

      {/* Chevron */}
      <ShimmerBar width={14} height={14} borderRadius={4} style={{ marginLeft: 10 }} />
    </View>
  );
}

// Skeleton for "My Analytics" FeatureCard — same padding/radius as FeatureCard
export function ProfileAnalyticsSkeleton() {
  return (
    <View
      style={{
        backgroundColor: '#F5F2EE',
        borderRadius: 22,
        marginBottom: 16,
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 10,
        elevation: 2,
      }}
    >
      {/* Icon circle */}
      <ShimmerBar width={48} height={48} borderRadius={24} />

      {/* Text lines */}
      <View style={{ flex: 1, marginLeft: 16, gap: 7 }}>
        <ShimmerBar width={112} height={13} borderRadius={7} />
        <ShimmerBar width={172} height={10} borderRadius={5} />
      </View>

      {/* Chevron */}
      <ShimmerBar width={14} height={14} borderRadius={4} style={{ marginLeft: 10 }} />
    </View>
  );
}
