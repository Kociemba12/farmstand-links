import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface ManagerShimmerProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
}

export function ManagerShimmer({
  width = '100%',
  height = 16,
  borderRadius = 8,
}: ManagerShimmerProps) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.7, {
        duration: 900,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  // React Native's native renderer requires numeric width/height for Animated.View.
  // String percentages (e.g. "100%") must be handled via alignSelf/flexGrow on a wrapper.
  const isFullWidth = width === '100%';

  if (isFullWidth) {
    return (
      <View style={{ alignSelf: 'stretch' }}>
        <Animated.View
          style={[
            {
              height: typeof height === 'number' ? height : 16,
              borderRadius,
              backgroundColor: '#EDE9E3',
            },
            animStyle,
          ]}
        />
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        {
          width: typeof width === 'number' ? width : undefined,
          height: typeof height === 'number' ? height : 16,
          borderRadius,
          backgroundColor: '#EDE9E3',
        },
        animStyle,
      ]}
    />
  );
}

export function SummaryCardsSkeleton() {
  return (
    <View className="flex-row flex-wrap gap-3 px-4 py-2">
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          className="rounded-2xl bg-white p-4"
          style={{
            width: '47%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 3,
          }}
        >
          <ManagerShimmer width={32} height={32} borderRadius={8} />
          <View className="mt-3 gap-2">
            <ManagerShimmer width={60} height={11} borderRadius={6} />
            <ManagerShimmer width={80} height={18} borderRadius={6} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ListSkeleton() {
  return (
    <View className="px-4 gap-3 py-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          className="rounded-2xl bg-white p-4"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 3,
          }}
        >
          <View className="flex-row items-center gap-3">
            <ManagerShimmer width={44} height={44} borderRadius={12} />
            <View className="flex-1 gap-2">
              <ManagerShimmer width={120} height={14} borderRadius={6} />
              <ManagerShimmer width={80} height={11} borderRadius={5} />
            </View>
            <ManagerShimmer width={56} height={24} borderRadius={8} />
          </View>
        </View>
      ))}
    </View>
  );
}
