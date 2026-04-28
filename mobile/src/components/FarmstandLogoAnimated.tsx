import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, G, Defs, Filter, FeDropShadow } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { useEffect } from 'react';

interface FarmstandLogoAnimatedProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
  animated?: boolean;
}

const LOGO_COLOR = '#FFFFFF';

export function FarmstandLogoAnimated({
  size = 'medium',
  color = LOGO_COLOR,
  animated = true
}: FarmstandLogoAnimatedProps) {
  const scale = useSharedValue(1);
  const shadowOpacity = useSharedValue(0.3);

  const sizeConfig = {
    small: { mainFont: 28, taglineFont: 7, branchWidth: 50, spacing: 3, shadowOffset: 2 },
    medium: { mainFont: 40, taglineFont: 9, branchWidth: 70, spacing: 5, shadowOffset: 3 },
    large: { mainFont: 52, taglineFont: 11, branchWidth: 90, spacing: 7, shadowOffset: 4 },
  };

  const { mainFont, taglineFont, branchWidth, spacing, shadowOffset } = sizeConfig[size];

  useEffect(() => {
    if (animated) {
      // Subtle breathing animation like Yelp
      scale.value = withRepeat(
        withSequence(
          withTiming(1.02, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );

      // Animate shadow for depth effect
      shadowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.4, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.25, { duration: 1500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    }
  }, [animated]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const shadowStyle = useAnimatedStyle(() => ({
    opacity: shadowOpacity.value,
  }));

  // Decorative branch with leaves
  const DecorativeBranch = ({ flip = false }: { flip?: boolean }) => (
    <Svg
      width={branchWidth}
      height={branchWidth * 0.35}
      viewBox="0 0 100 35"
      style={{ transform: [{ scaleX: flip ? -1 : 1 }] }}
    >
      <Path
        d="M50 20 Q45 20 42 17 Q38 12 30 15"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M30 15 Q20 12 5 18"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <G>
        <Path d="M28 14 Q22 8 18 10 Q22 14 28 14" fill={color} />
        <Path d="M24 16 Q20 22 16 20 Q20 16 24 16" fill={color} />
        <Path d="M20 13 Q14 7 10 9 Q14 13 20 13" fill={color} />
        <Path d="M16 16 Q12 22 8 20 Q12 16 16 16" fill={color} />
        <Path d="M12 14 Q8 9 5 11 Q8 14 12 14" fill={color} />
        <Path d="M8 16 Q5 21 2 19 Q5 16 8 16" fill={color} />
      </G>
    </Svg>
  );

  const ThreeDots = () => (
    <Svg width={18} height={10} viewBox="0 0 20 10">
      <Circle cx="4" cy="5" r="2" fill={color} />
      <Circle cx="10" cy="5" r="2" fill={color} />
      <Circle cx="16" cy="5" r="2" fill={color} />
    </Svg>
  );

  return (
    <View style={styles.container}>
      {/* Shadow layer for depth - offset behind main logo */}
      <Animated.View
        style={[
          styles.shadowContainer,
          shadowStyle,
          {
            top: shadowOffset,
            left: shadowOffset,
          }
        ]}
      >
        <Text
          style={[
            styles.mainText,
            {
              fontSize: mainFont,
              color: 'rgba(0,0,0,0.3)',
            },
          ]}
        >
          Farmstand
        </Text>
      </Animated.View>

      {/* Main logo with animation */}
      <Animated.View style={[styles.logoContainer, animatedStyle]}>
        {/* Main "Farmstand" text with text shadow for depth */}
        <View style={styles.textWrapper}>
          <Text
            style={[
              styles.mainText,
              {
                fontSize: mainFont,
                color: color,
                textShadowColor: 'rgba(0, 0, 0, 0.25)',
                textShadowOffset: { width: shadowOffset, height: shadowOffset },
                textShadowRadius: shadowOffset * 2,
              },
            ]}
          >
            Farmstand
          </Text>
        </View>

        {/* Tagline with decorative elements */}
        <View style={[styles.taglineContainer, { marginTop: spacing }]}>
          <DecorativeBranch />
          <View style={styles.taglineCenter}>
            <Text
              style={[
                styles.taglineText,
                {
                  fontSize: taglineFont,
                  color: color,
                  textShadowColor: 'rgba(0, 0, 0, 0.2)',
                  textShadowOffset: { width: 1, height: 1 },
                  textShadowRadius: 2,
                },
              ]}
            >
              FRESH & LOCAL
            </Text>
            <View style={styles.dotsContainer}>
              <ThreeDots />
            </View>
          </View>
          <DecorativeBranch flip />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadowContainer: {
    position: 'absolute',
  },
  logoContainer: {
    alignItems: 'center',
  },
  textWrapper: {
    // Container for main text
  },
  mainText: {
    fontWeight: '400',
    fontStyle: 'italic',
    letterSpacing: 1,
  },
  taglineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taglineCenter: {
    alignItems: 'center',
    marginHorizontal: 4,
  },
  taglineText: {
    fontWeight: '600',
    letterSpacing: 3,
  },
  dotsContainer: {
    marginTop: 2,
  },
});
