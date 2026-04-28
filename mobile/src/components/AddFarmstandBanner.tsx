import React, { useEffect, useCallback } from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

// Storage key for dismiss timestamp — bump the suffix to reset dismiss state for existing users
const BANNER_DISMISSED_KEY = 'add_farmstand_banner_dismissed_v2';
// 7 days in milliseconds
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
// Auto-hide after 9 seconds
const AUTO_HIDE_DELAY_MS = 9000;

interface AddFarmstandBannerProps {
  visible: boolean;
  onPress: () => void;
  onDismiss: () => void;
  /** @deprecated no longer used — positioning is handled by the parent row */
  bottomOffset?: number;
}

export function AddFarmstandBanner({
  visible,
  onPress,
  onDismiss,
}: AddFarmstandBannerProps) {
  const translateY = useSharedValue(20);
  const opacity = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const animateIn = useCallback(() => {
    translateY.value = withTiming(0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
    opacity.value = withTiming(1, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
    });
  }, [translateY, opacity]);

  const animateOut = useCallback((callback?: () => void) => {
    translateY.value = withTiming(16, {
      duration: 220,
      easing: Easing.in(Easing.cubic),
    });
    opacity.value = withTiming(0, {
      duration: 200,
      easing: Easing.in(Easing.cubic),
    }, () => {
      if (callback) runOnJS(callback)();
    });
  }, [translateY, opacity]);

  useEffect(() => {
    if (visible) animateIn();
  }, [visible, animateIn]);

  // Auto-hide after delay
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      animateOut(onDismiss);
    }, AUTO_HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, animateOut, onDismiss]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateOut(onPress);
  }, [animateOut, onPress]);

  if (!visible) return null;

  return (
    /*
     * Animated.View is an inline flex child — flex: 1 fills the remaining
     * width in the floatingActionRow (left of the FAB).
     */
    <Animated.View style={[styles.card, animatedStyle]}>
      <Pressable onPress={handlePress} style={styles.banner}>
        <Text style={styles.title}>Add a Farmstand</Text>
        <Text style={styles.subtitle}>Add a local stand in 30 seconds</Text>
      </Pressable>
    </Animated.View>
  );
}

// Helper to check if banner should be shown
export async function shouldShowAddFarmstandBanner(): Promise<boolean> {
  try {
    const dismissedUntil = await AsyncStorage.getItem(BANNER_DISMISSED_KEY);
    if (!dismissedUntil) return true;
    const dismissTime = parseInt(dismissedUntil, 10);
    return Date.now() > dismissTime;
  } catch (error) {
    console.log('Error checking banner dismissal:', error);
    return true;
  }
}

const styles = StyleSheet.create({
  card: {
  },
  banner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 28,
    paddingVertical: 14,
    minHeight: 70,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: '#1C1C1E',
    opacity: 0.65,
    marginTop: 3,
    letterSpacing: -0.1,
    textAlign: 'center',
  },
});
