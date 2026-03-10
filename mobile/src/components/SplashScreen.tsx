import React, { useEffect } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

// Logo dimensions - consistent across all screens
const LOGO_WIDTH = 360;
const LOGO_HEIGHT = 140;

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
        colors={['#2F5D3A', '#3A6B46', '#2F5D3A']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Subtle dark overlay to match login screen depth */}
      <View style={styles.overlay} />

      {/* Farmstand Logo with fade in - white tinted */}
      <Animated.View style={[styles.logoContainer, logoAnimatedStyle]}>
        <Image
          source={require('../../assets/farmstand-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          tintColor="#FFFFFF"
        />
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
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    marginTop: 24,
    marginBottom: 12,
  },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    flexShrink: 0,
  },
});
