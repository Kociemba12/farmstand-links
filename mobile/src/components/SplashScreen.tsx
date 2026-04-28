import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { FarmstandLogoPng } from './FarmstandLogoPng';
import { SPLASH_GRADIENT, SPLASH_OVERLAY } from '@/lib/brand-colors';

interface SplashScreenProps {
  onAnimationComplete: () => void;
}

export function SplashScreen({ onAnimationComplete }: SplashScreenProps) {
  const logoOpacity = useSharedValue(0);

  useEffect(() => {
    // Fade in the logo over 2 seconds
    logoOpacity.value = withTiming(1, {
      duration: 2000,
      easing: Easing.inOut(Easing.ease)
    });

    // After fade in completes (2s), transition to explore page
    setTimeout(() => {
      runOnJS(onAnimationComplete)();
    }, 2000);
  }, []);

  const logoAnimatedStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
  }));

  return (
    <View style={styles.container}>
      {/* Smooth centered green gradient */}
      <LinearGradient
        colors={SPLASH_GRADIENT}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Subtle dark overlay to match login screen depth */}
      <View style={styles.overlay} />

      {/* Farmstand Logo with fade in - white tinted */}
      <Animated.View style={[styles.logoContainer, logoAnimatedStyle]}>
        <FarmstandLogoPng />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_OVERLAY,
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    marginTop: 24,
    marginBottom: 12,
  },
});
