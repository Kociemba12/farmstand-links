import React, { useEffect, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MapPinPlus, X, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

// Storage key for dismiss timestamp
const BANNER_DISMISSED_KEY = 'add_farmstand_banner_dismissed_until';
// 7 days in milliseconds
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
// Auto-hide after 9 seconds
const AUTO_HIDE_DELAY_MS = 9000;

interface AddFarmstandBannerProps {
  visible: boolean;
  onPress: () => void;
  onDismiss: () => void;
  bottomOffset?: number;
}

export function AddFarmstandBanner({
  visible,
  onPress,
  onDismiss,
  bottomOffset = 88,
}: AddFarmstandBannerProps) {
  // Animation values
  const translateY = useSharedValue(20);
  const opacity = useSharedValue(0);

  // Animated style
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  // Show animation
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

  // Hide animation with callback
  const animateOut = useCallback((callback?: () => void) => {
    translateY.value = withTiming(16, {
      duration: 220,
      easing: Easing.in(Easing.cubic),
    });
    opacity.value = withTiming(0, {
      duration: 200,
      easing: Easing.in(Easing.cubic),
    }, () => {
      if (callback) {
        runOnJS(callback)();
      }
    });
  }, [translateY, opacity]);

  // Handle visibility changes
  useEffect(() => {
    if (visible) {
      animateIn();
    }
  }, [visible, animateIn]);

  // Auto-hide after delay
  useEffect(() => {
    if (!visible) return;

    const timer = setTimeout(() => {
      animateOut(onDismiss);
    }, AUTO_HIDE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [visible, animateOut, onDismiss]);

  // Handle press on banner
  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateOut(onPress);
  }, [animateOut, onPress]);

  // Handle dismiss (X button)
  const handleDismiss = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Save dismiss timestamp
    const dismissUntil = Date.now() + DISMISS_DURATION_MS;
    try {
      await AsyncStorage.setItem(BANNER_DISMISSED_KEY, dismissUntil.toString());
    } catch (error) {
      console.log('Error saving banner dismissal:', error);
    }

    animateOut(onDismiss);
  }, [animateOut, onDismiss]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        { bottom: bottomOffset },
        animatedStyle,
      ]}
    >
      <Pressable
        onPress={handlePress}
        style={styles.banner}
      >
        {/* Left Icon */}
        <View style={styles.iconContainer}>
          <MapPinPlus size={20} color="#2D5A3D" strokeWidth={2} />
        </View>

        {/* Text Content */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>Add a Farmstand</Text>
          <Text style={styles.subtitle}>Know a local stand? Add it in 30 seconds.</Text>
        </View>

        {/* Chevron */}
        <ChevronRight size={18} color="#8B6F4E" style={styles.chevron} />

        {/* Dismiss Button */}
        <Pressable
          onPress={handleDismiss}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
          style={styles.dismissButton}
        >
          <X size={16} color="#8B6F4E" />
        </Pressable>
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
  container: {
    position: 'absolute',
    left: 12,
    right: 80, // Leave space for FAB button (56 + 16 + 8 margin)
    zIndex: 100,
  },
  banner: {
    backgroundColor: '#FEFDFB',
    borderRadius: 20,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    // Subtle Airbnb-style shadow
    shadowColor: 'rgba(0, 0, 0, 1)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(45, 90, 61, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#3D3D3D',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 13,
    color: '#8B6F4E',
    marginTop: 2,
    letterSpacing: -0.1,
  },
  chevron: {
    marginRight: 4,
  },
  dismissButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(139, 111, 78, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
