import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  clamp,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { logRadiusChange } from '@/lib/analytics-events';

// Slider constants
const THUMB_SIZE = 28;
const TRACK_HEIGHT = 6;

// Radius bounds
const MIN_RADIUS = 1;
const MAX_RADIUS = 100;
const DEFAULT_RADIUS = 100; // Default to 100 miles on cold start

// Throttle interval for real-time zoom updates (ms)
const ZOOM_THROTTLE_MS = 100;

// In-memory session storage for slider value (resets on app restart)
let sessionRadiusMiles: number | null = null;

interface MapFilterModalProps {
  visible: boolean;
  onClose: () => void;
  radiusMiles: number | null;
  onRadiusMilesChange: (miles: number | null) => void;
  onApplyWithZoom?: (miles: number | null) => void;
  onSliderChange?: (miles: number) => void; // Real-time zoom callback
}

// Calculate position from radius value (logarithmic scale for better UX)
const radiusToPosition = (r: number, trackWidth: number): number => {
  'worklet';
  if (trackWidth <= 0) return 0;
  if (r >= MAX_RADIUS) return trackWidth;
  if (r <= MIN_RADIUS) return 0;

  const minLog = Math.log(MIN_RADIUS);
  const maxLog = Math.log(MAX_RADIUS);
  const scaleVal = (Math.log(r) - minLog) / (maxLog - minLog);
  return scaleVal * trackWidth;
};

// Calculate radius from position
const positionToRadius = (pos: number, trackWidth: number): number => {
  'worklet';
  if (trackWidth <= 0) return MIN_RADIUS;
  if (pos >= trackWidth) return MAX_RADIUS;
  if (pos <= 0) return MIN_RADIUS;

  const minLog = Math.log(MIN_RADIUS);
  const maxLog = Math.log(MAX_RADIUS);
  const scaleVal = pos / trackWidth;
  const logValue = minLog + scaleVal * (maxLog - minLog);
  return Math.round(Math.exp(logValue));
};

// Helper to save radius to session memory (not persisted)
const saveSessionRadius = (miles: number) => {
  sessionRadiusMiles = miles;
};

// Helper to get radius from session memory (defaults to 100 on cold start)
const getSessionRadius = (): number => {
  return sessionRadiusMiles ?? DEFAULT_RADIUS;
};

export function MapFilterModal({
  visible,
  onClose,
  radiusMiles,
  onRadiusMilesChange,
  onApplyWithZoom,
  onSliderChange,
}: MapFilterModalProps) {
  // ============================================
  // SINGLE SOURCE OF TRUTH: radiusMiles state
  // ============================================
  const [localMiles, setLocalMiles] = useState<number>(DEFAULT_RADIUS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Track width measured from layout
  const [trackWidth, setTrackWidth] = useState(0);

  // Track last haptic radius to avoid repeated haptics
  const lastHapticRadius = useRef<number>(0);

  // Throttle ref for zoom updates
  const lastZoomUpdate = useRef<number>(0);

  // Shared values for smooth animations
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const scale = useSharedValue(1);
  const backdropOpacity = useSharedValue(0);

  // Sheet position for swipe-to-dismiss
  const sheetTranslateY = useSharedValue(0);

  // Shared value for track width (for worklet access)
  const trackWidthShared = useSharedValue(0);

  // Handle track layout measurement
  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setTrackWidth(width);
    trackWidthShared.value = width;
    // Update thumb position after measurement (no animation on initial layout)
    translateX.value = radiusToPosition(localMiles, width);
  }, [translateX, trackWidthShared, localMiles]);

  // Load saved radius when modal opens
  useEffect(() => {
    if (visible) {
      // Get radius from session memory (defaults to 100 on cold start)
      const savedMiles = getSessionRadius();
      setLocalMiles(savedMiles);
      setIsLoaded(true);
      if (trackWidth > 0) {
        translateX.value = withTiming(radiusToPosition(savedMiles, trackWidth), { duration: 150 });
      }
      backdropOpacity.value = withTiming(1, { duration: 200 });
      sheetTranslateY.value = 0;
    } else {
      // Reset loaded state when modal closes
      setIsLoaded(false);
    }
  }, [visible, trackWidth, translateX, backdropOpacity, sheetTranslateY]);

  // Update slider position when localMiles changes and track is ready
  useEffect(() => {
    if (isLoaded && trackWidth > 0) {
      translateX.value = radiusToPosition(localMiles, trackWidth);
    }
  }, [isLoaded, localMiles, trackWidth, translateX]);

  // Helper to trigger haptics at milestones
  const triggerHaptic = useCallback((newRadius: number) => {
    const milestones = [1, 5, 10, 25, 50, 75, 100];
    if (milestones.includes(newRadius) && lastHapticRadius.current !== newRadius) {
      lastHapticRadius.current = newRadius;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  // ============================================
  // Update radius (called during slider drag)
  // ============================================
  const updateRadius = useCallback((newRadius: number) => {
    setLocalMiles(newRadius);
    triggerHaptic(newRadius);

    // Throttle zoom updates to prevent too many map animations
    const now = Date.now();
    if (now - lastZoomUpdate.current >= ZOOM_THROTTLE_MS) {
      lastZoomUpdate.current = now;
      onSliderChange?.(newRadius);
    }
  }, [triggerHaptic, onSliderChange]);

  // Final zoom update when drag ends (ensures last value is applied)
  const finalizeZoom = useCallback((finalRadius: number) => {
    saveSessionRadius(finalRadius);
    // Always send final zoom value regardless of throttle
    onSliderChange?.(finalRadius);
  }, [onSliderChange]);

  // ============================================
  // Pan gesture for slider thumb
  // ============================================
  const panGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = translateX.value;
      scale.value = withSpring(1.2, { damping: 15, stiffness: 400 });
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
    })
    .onUpdate((event) => {
      const newX = clamp(startX.value + event.translationX, 0, trackWidthShared.value);
      translateX.value = newX;
      const newRadius = positionToRadius(newX, trackWidthShared.value);
      runOnJS(updateRadius)(newRadius);
    })
    .onEnd(() => {
      scale.value = withSpring(1, { damping: 15, stiffness: 400 });
      // Save and finalize zoom when user finishes dragging
      const finalRadius = positionToRadius(translateX.value, trackWidthShared.value);
      runOnJS(finalizeZoom)(finalRadius);
    });

  // Animated styles
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { scale: scale.value },
    ],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: translateX.value,
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  // ============================================
  // Handle track tap to jump slider
  // ============================================
  const handleTrackPress = useCallback((event: { nativeEvent: { locationX: number } }) => {
    if (trackWidth <= 0) return;

    const tapX = clamp(event.nativeEvent.locationX, 0, trackWidth);
    const newRadius = positionToRadius(tapX, trackWidth);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalMiles(newRadius);
    translateX.value = withSpring(radiusToPosition(newRadius, trackWidth), {
      damping: 20,
      stiffness: 300,
    });
    // Save the radius when user taps track
    saveSessionRadius(newRadius);
    // Trigger real-time zoom update
    onSliderChange?.(newRadius);
  }, [trackWidth, translateX, onSliderChange]);

  // ============================================
  // Apply button - just close (zoom already happened)
  // ============================================
  const handleApply = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logRadiusChange(localMiles);
    // Save the radius when user closes
    saveSessionRadius(localMiles);
    backdropOpacity.value = withTiming(0, { duration: 150 });
    setTimeout(onClose, 150);
  }, [localMiles, onClose, backdropOpacity]);

  // Handle close with animation
  const handleClose = useCallback(() => {
    backdropOpacity.value = withTiming(0, { duration: 150 });
    setTimeout(onClose, 150);
  }, [onClose, backdropOpacity]);

  // Swipe down gesture to dismiss
  const swipeGesture = Gesture.Pan()
    .onUpdate((event) => {
      // Only allow dragging down
      if (event.translationY > 0) {
        sheetTranslateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      // If dragged down more than 100px or fast swipe, dismiss
      if (event.translationY > 100 || event.velocityY > 500) {
        sheetTranslateY.value = withTiming(400, { duration: 150 });
        backdropOpacity.value = withTiming(0, { duration: 150 });
        runOnJS(onClose)();
      } else {
        // Snap back
        sheetTranslateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <GestureHandlerRootView style={styles.gestureRoot}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.backdropPressable} onPress={handleClose} />
        </Animated.View>

        <View style={styles.container}>
          <GestureDetector gesture={swipeGesture}>
            <Animated.View style={[styles.content, sheetStyle]}>
              {/* Handle bar */}
              <View style={styles.handleBarContainer}>
                <View style={styles.handleBar} />
              </View>

              {/* Header with radius display */}
              <View style={styles.header}>
                <Text style={styles.radiusValue}>{localMiles}</Text>
                <Text style={styles.radiusUnit}>mile{localMiles !== 1 ? 's' : ''}</Text>
              </View>
              <Text style={styles.subtitle}>Drag to zoom the map</Text>

              {/* Slider */}
              <View style={styles.sliderContainer}>
                {/* Track wrapper */}
                <View style={styles.trackWrapper}>
                  <Pressable onPress={handleTrackPress} style={styles.trackPressable}>
                    <View
                      style={styles.track}
                      onLayout={handleTrackLayout}
                    >
                      <Animated.View style={[styles.trackFill, fillStyle]} />
                    </View>
                  </Pressable>

                  {/* Thumb with gesture */}
                  <GestureDetector gesture={panGesture}>
                    <Animated.View style={[styles.thumb, thumbStyle]}>
                      <View style={styles.thumbInner} />
                    </Animated.View>
                  </GestureDetector>
                </View>

                {/* Scale markers */}
                <View style={styles.scaleMarkers}>
                  <Text style={styles.scaleText}>1 mi</Text>
                  <Text style={styles.scaleText}>25 mi</Text>
                  <Text style={styles.scaleText}>50 mi</Text>
                  <Text style={styles.scaleText}>100 mi</Text>
                </View>
              </View>

              {/* Done Button */}
              <Pressable onPress={handleApply} style={styles.applyButton}>
                <Text style={styles.applyButtonText}>Done</Text>
              </Pressable>
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  backdropPressable: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 20,
  },
  handleBarContainer: {
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
  },
  handleBar: {
    width: 36,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: 4,
  },
  radiusValue: {
    fontSize: 48,
    fontWeight: '700',
    color: '#2D5A3D',
    letterSpacing: -2,
  },
  radiusUnit: {
    fontSize: 20,
    fontWeight: '500',
    color: '#2D5A3D',
    marginLeft: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#8B8B8B',
    textAlign: 'center',
    marginBottom: 24,
  },
  sliderContainer: {
    marginBottom: 24,
  },
  trackWrapper: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  trackPressable: {
    height: 40,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    backgroundColor: '#E8E8E8',
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: '100%',
    backgroundColor: '#2D5A3D',
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    top: (40 - THUMB_SIZE) / 2,
    left: -THUMB_SIZE / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#2D5A3D',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  thumbInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  scaleMarkers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  scaleText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  applyButton: {
    backgroundColor: '#2D5A3D',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
