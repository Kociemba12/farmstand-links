import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  LayoutChangeEvent,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native';
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
import { Star, Leaf, Heart, Clock, RotateCcw } from 'lucide-react-native';
import { logRadiusChange } from '@/lib/analytics-events';
import { useMapFiltersStore } from '@/lib/map-filters-store';
import { CATEGORY_LABELS } from '@/lib/category-filter';

// ── Slider constants ───────────────────────────────────────────────────────
const THUMB_SIZE = 28;
const TRACK_HEIGHT = 6;
const MIN_RADIUS = 1;
const MAX_RADIUS = 100;
const DEFAULT_RADIUS = 100;
const ZOOM_THROTTLE_MS = 100;

let sessionRadiusMiles: number | null = null;
const saveSessionRadius = (miles: number) => { sessionRadiusMiles = miles; };
const getSessionRadius = () => sessionRadiusMiles ?? DEFAULT_RADIUS;

const radiusToPosition = (r: number, trackWidth: number): number => {
  'worklet';
  if (trackWidth <= 0) return 0;
  if (r >= MAX_RADIUS) return trackWidth;
  if (r <= MIN_RADIUS) return 0;
  const minLog = Math.log(MIN_RADIUS);
  const maxLog = Math.log(MAX_RADIUS);
  return ((Math.log(r) - minLog) / (maxLog - minLog)) * trackWidth;
};

const positionToRadius = (pos: number, trackWidth: number): number => {
  'worklet';
  if (trackWidth <= 0) return MIN_RADIUS;
  if (pos >= trackWidth) return MAX_RADIUS;
  if (pos <= 0) return MIN_RADIUS;
  const minLog = Math.log(MIN_RADIUS);
  const maxLog = Math.log(MAX_RADIUS);
  return Math.round(Math.exp(minLog + (pos / trackWidth) * (maxLog - minLog)));
};

// ── Category display order ─────────────────────────────────────────────────
const CATEGORY_KEYS = [
  'produce', 'eggs', 'baked_goods', 'honey', 'flowers', 'berries',
  'dairy', 'meat', 'herbs', 'preserves', 'plants', 'upick',
  'seasonal', 'pumpkins', 'crafts',
];

// ── Props ──────────────────────────────────────────────────────────────────
interface MapFilterModalProps {
  visible: boolean;
  onClose: () => void;
  onApply?: () => void;
  onSliderChange?: (miles: number) => void;
  resultCount?: number;
}

// ── Component ──────────────────────────────────────────────────────────────
export function MapFilterModal({ visible, onClose, onApply, onSliderChange, resultCount }: MapFilterModalProps) {
  // Filter store
  const minRating = useMapFiltersStore((s) => s.minRating);
  const storeRadiusMiles = useMapFiltersStore((s) => s.radiusMiles);
  const storeMinPrice = useMapFiltersStore((s) => s.minPrice);
  const storeMaxPrice = useMapFiltersStore((s) => s.maxPrice);
  const openNow = useMapFiltersStore((s) => s.openNow);
  const inStockOnly = useMapFiltersStore((s) => s.inStockOnly);
  const selectedCategories = useMapFiltersStore((s) => s.selectedCategories);
  const savedOnly = useMapFiltersStore((s) => s.savedOnly);
  const activeFilterCount = useMapFiltersStore((s) => s.activeFilterCount);
  const setMinRating = useMapFiltersStore((s) => s.setMinRating);
  const setRadiusMiles = useMapFiltersStore((s) => s.setRadiusMiles);
  const setMinPrice = useMapFiltersStore((s) => s.setMinPrice);
  const setMaxPrice = useMapFiltersStore((s) => s.setMaxPrice);
  const setOpenNow = useMapFiltersStore((s) => s.setOpenNow);
  const setInStockOnly = useMapFiltersStore((s) => s.setInStockOnly);
  const toggleCategory = useMapFiltersStore((s) => s.toggleCategory);
  const setSavedOnly = useMapFiltersStore((s) => s.setSavedOnly);
  const resetFilters = useMapFiltersStore((s) => s.reset);

  // Local price input state
  const [localMinPrice, setLocalMinPrice] = useState<string>('');
  const [localMaxPrice, setLocalMaxPrice] = useState<string>('');

  // Radius slider state
  const [localMiles, setLocalMiles] = useState(DEFAULT_RADIUS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const lastHapticRadius = useRef<number>(0);
  const lastZoomUpdate = useRef<number>(0);

  // Animations
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const scale = useSharedValue(1);
  const backdropOpacity = useSharedValue(0);
  const sheetTranslateY = useSharedValue(0);
  const trackWidthShared = useSharedValue(0);

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setTrackWidth(width);
    trackWidthShared.value = width;
    translateX.value = radiusToPosition(localMiles, width);
  }, [translateX, trackWidthShared, localMiles]);

  useEffect(() => {
    if (visible) {
      // Initialize from store so slider always reflects the committed filter value
      const savedMiles = storeRadiusMiles;
      saveSessionRadius(savedMiles);
      setLocalMiles(savedMiles);
      setIsLoaded(true);
      if (trackWidth > 0) {
        translateX.value = withTiming(radiusToPosition(savedMiles, trackWidth), { duration: 150 });
      }
      backdropOpacity.value = withTiming(1, { duration: 200 });
      sheetTranslateY.value = 0;
    } else {
      setIsLoaded(false);
    }
  }, [visible, trackWidth, storeRadiusMiles]);

  useEffect(() => {
    if (isLoaded && trackWidth > 0) {
      translateX.value = radiusToPosition(localMiles, trackWidth);
    }
  }, [isLoaded, localMiles, trackWidth]);

  const triggerHaptic = useCallback((newRadius: number) => {
    const milestones = [1, 5, 10, 25, 50, 75, 100];
    if (milestones.includes(newRadius) && lastHapticRadius.current !== newRadius) {
      lastHapticRadius.current = newRadius;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const updateRadius = useCallback((newRadius: number) => {
    setLocalMiles(newRadius);
    triggerHaptic(newRadius);
    const now = Date.now();
    if (now - lastZoomUpdate.current >= ZOOM_THROTTLE_MS) {
      lastZoomUpdate.current = now;
      onSliderChange?.(newRadius);
    }
  }, [triggerHaptic, onSliderChange]);

  const finalizeZoom = useCallback((finalRadius: number) => {
    saveSessionRadius(finalRadius);
    setRadiusMiles(finalRadius);
    onSliderChange?.(finalRadius);
  }, [onSliderChange, setRadiusMiles]);

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
      const finalRadius = positionToRadius(translateX.value, trackWidthShared.value);
      runOnJS(finalizeZoom)(finalRadius);
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { scale: scale.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({ width: translateX.value }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const handleTrackPress = useCallback((event: { nativeEvent: { locationX: number } }) => {
    if (trackWidth <= 0) return;
    const tapX = clamp(event.nativeEvent.locationX, 0, trackWidth);
    const newRadius = positionToRadius(tapX, trackWidth);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLocalMiles(newRadius);
    translateX.value = withSpring(radiusToPosition(newRadius, trackWidth), { damping: 20, stiffness: 300 });
    saveSessionRadius(newRadius);
    setRadiusMiles(newRadius);
    onSliderChange?.(newRadius);
  }, [trackWidth, translateX, onSliderChange, setRadiusMiles]);

  const handleApply = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    logRadiusChange(localMiles);
    saveSessionRadius(localMiles);
    setRadiusMiles(localMiles);
    // Silently swap inverted price range
    const parsedMin = localMinPrice.trim() !== '' ? parseFloat(localMinPrice) : null;
    const parsedMax = localMaxPrice.trim() !== '' ? parseFloat(localMaxPrice) : null;
    if (parsedMin !== null && parsedMax !== null && parsedMin > parsedMax) {
      setMinPrice(parsedMax);
      setMaxPrice(parsedMin);
    }
    // Signal to the parent that the CTA was pressed (not just a swipe-to-close),
    // so it can auto-zoom the map to the filtered results.
    onApply?.();
    backdropOpacity.value = withTiming(0, { duration: 150 });
    setTimeout(onClose, 150);
  }, [localMiles, localMinPrice, localMaxPrice, onClose, onApply, backdropOpacity, setRadiusMiles, setMinPrice, setMaxPrice]);

  const handleClose = useCallback(() => {
    backdropOpacity.value = withTiming(0, { duration: 150 });
    setTimeout(onClose, 150);
  }, [onClose, backdropOpacity]);

  const swipeGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (event.translationY > 0) {
        sheetTranslateY.value = event.translationY;
      }
    })
    .onEnd((event) => {
      if (event.translationY > 100 || event.velocityY > 500) {
        sheetTranslateY.value = withTiming(500, { duration: 150 });
        backdropOpacity.value = withTiming(0, { duration: 150 });
        runOnJS(onClose)();
      } else {
        sheetTranslateY.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  // Sync local price state from store when modal opens
  useEffect(() => {
    if (visible) {
      setLocalMinPrice(storeMinPrice !== null ? String(storeMinPrice) : '');
      setLocalMaxPrice(storeMaxPrice !== null ? String(storeMaxPrice) : '');
    }
  }, [visible]);

  const priceError =
    localMinPrice !== '' && localMaxPrice !== '' &&
    parseFloat(localMinPrice) > parseFloat(localMaxPrice)
      ? 'Max price must be greater than min price'
      : null;

  const handleReset = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetFilters(); // resets store including radiusMiles → DEFAULT_RADIUS
    setLocalMinPrice('');
    setLocalMaxPrice('');
    setLocalMiles(DEFAULT_RADIUS);
    saveSessionRadius(DEFAULT_RADIUS);
    if (trackWidth > 0) {
      translateX.value = withTiming(radiusToPosition(DEFAULT_RADIUS, trackWidth), { duration: 200 });
    }
  }, [resetFilters, trackWidth, translateX]);

  if (!visible) return null;

  const resultLabel = resultCount !== undefined
    ? `Show ${resultCount} Farmstand${resultCount !== 1 ? 's' : ''}`
    : 'Done';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <GestureHandlerRootView style={styles.gestureRoot}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.backdropPressable} onPress={handleClose} />
        </Animated.View>

        <View style={styles.container}>
          <GestureDetector gesture={swipeGesture}>
            <Animated.View style={[styles.sheet, sheetStyle]}>
              {/* Handle + Header */}
              <View style={styles.handleArea}>
                <View style={styles.handleBar} />
              </View>
              <View style={styles.header}>
                <Text style={styles.headerTitle}>Filters</Text>
                {activeFilterCount > 0 && (
                  <Pressable onPress={handleReset} style={styles.resetButton}>
                    <RotateCcw size={14} color="#2D5A3D" />
                    <Text style={styles.resetText}>Reset all</Text>
                  </Pressable>
                )}
              </View>

              {/* Scrollable content */}
              <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {/* ── RATINGS ─────────────────────────────────── */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>RATINGS</Text>
                  <View style={styles.ratingChipRow}>
                    {[
                      { value: null, label: 'Any' },
                      { value: 3.5, label: '3.5★+' },
                      { value: 4.0, label: '4.0★+' },
                      { value: 4.5, label: '4.5★+' },
                    ].map((opt) => (
                      <Pressable
                        key={String(opt.value)}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setMinRating(opt.value);
                        }}
                        style={[styles.ratingChip, minRating === opt.value && styles.chipActive]}
                      >
                        {opt.value !== null && <Star size={12} color={minRating === opt.value ? '#FFFFFF' : '#6B7280'} fill={minRating === opt.value ? '#FFFFFF' : 'transparent'} style={{ marginRight: 3 }} />}
                        <Text style={[styles.chipText, minRating === opt.value && styles.chipTextActive]}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.divider} />

                {/* ── DISTANCE ────────────────────────────────── */}
                <View style={styles.section}>
                  <View style={styles.sectionRow}>
                    <Text style={styles.sectionLabel}>DISTANCE</Text>
                    <Text style={styles.sectionValue}>{localMiles} mile{localMiles !== 1 ? 's' : ''}</Text>
                  </View>
                  <Text style={styles.sectionHint}>Zooms the map to this radius</Text>
                  <View style={styles.sliderContainer}>
                    <View style={styles.trackWrapper}>
                      <Pressable onPress={handleTrackPress} style={styles.trackPressable}>
                        <View style={styles.track} onLayout={handleTrackLayout}>
                          <Animated.View style={[styles.trackFill, fillStyle]} />
                        </View>
                      </Pressable>
                      <GestureDetector gesture={panGesture}>
                        <Animated.View style={[styles.thumb, thumbStyle]}>
                          <View style={styles.thumbInner} />
                        </Animated.View>
                      </GestureDetector>
                    </View>
                    <View style={styles.scaleMarkers}>
                      <Text style={styles.scaleText}>1 mi</Text>
                      <Text style={styles.scaleText}>25 mi</Text>
                      <Text style={styles.scaleText}>50 mi</Text>
                      <Text style={styles.scaleText}>100 mi</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.divider} />

                {/* ── PRICE RANGE ─────────────────────────────── */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>PRICE RANGE</Text>
                  <View style={styles.priceRow}>
                    <View style={styles.priceInputWrapper}>
                      <Text style={styles.priceCurrency}>$</Text>
                      <TextInput
                        style={styles.priceInput}
                        value={localMinPrice}
                        onChangeText={(text) => {
                          setLocalMinPrice(text);
                          const num = parseFloat(text);
                          setMinPrice(text.trim() === '' || isNaN(num) ? null : num);
                        }}
                        placeholder="0"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <Text style={styles.priceDash}>—</Text>
                    <View style={styles.priceInputWrapper}>
                      <Text style={styles.priceCurrency}>$</Text>
                      <TextInput
                        style={styles.priceInput}
                        value={localMaxPrice}
                        onChangeText={(text) => {
                          setLocalMaxPrice(text);
                          const num = parseFloat(text);
                          setMaxPrice(text.trim() === '' || isNaN(num) ? null : num);
                        }}
                        placeholder="20"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                  {priceError ? (
                    <Text style={styles.priceError}>{priceError}</Text>
                  ) : (
                    <Text style={styles.sectionHint}>Shows farmstands with at least one product in this price range</Text>
                  )}
                </View>

                <View style={styles.divider} />

                {/* ── AVAILABILITY ────────────────────────────── */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>AVAILABILITY</Text>
                  <View style={styles.toggleRow}>
                    <View style={styles.toggleLeft}>
                      <Clock size={16} color="#2D5A3D" />
                      <View style={styles.toggleTextGroup}>
                        <Text style={styles.toggleLabel}>Open Now</Text>
                        <Text style={styles.toggleSubLabel}>Based on listed hours</Text>
                      </View>
                    </View>
                    <Switch
                      value={openNow}
                      onValueChange={(v) => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setOpenNow(v);
                      }}
                      trackColor={{ false: '#E5E7EB', true: '#86EFAC' }}
                      thumbColor={openNow ? '#2D5A3D' : '#9CA3AF'}
                    />
                  </View>
                </View>

                <View style={styles.divider} />

                {/* ── CATEGORIES ──────────────────────────────── */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>CATEGORIES</Text>
                  <View style={styles.categoryGrid}>
                    {CATEGORY_KEYS.map((key) => {
                      const label = CATEGORY_LABELS[key] ?? key;
                      const isSelected = selectedCategories.includes(key);
                      return (
                        <Pressable
                          key={key}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            if (__DEV__) {
                              const willSelect = !isSelected;
                              console.log(
                                '[ChipToggle] key:', key,
                                '| before:', JSON.stringify(selectedCategories),
                                '| action:', willSelect ? 'SELECT' : 'DESELECT',
                                '| resultCount:', resultCount
                              );
                            }
                            toggleCategory(key);
                          }}
                          style={[styles.categoryChip, isSelected && styles.chipActive]}
                        >
                          <Text style={[styles.chipText, isSelected && styles.chipTextActive]} numberOfLines={1}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.divider} />

                {/* ── SAVED ───────────────────────────────────── */}
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>SAVED</Text>
                  <View style={styles.toggleRow}>
                    <View style={styles.toggleLeft}>
                      <Heart size={16} color="#EF4444" fill={savedOnly ? '#EF4444' : 'transparent'} />
                      <View style={styles.toggleTextGroup}>
                        <Text style={styles.toggleLabel}>Saved Farmstands Only</Text>
                        <Text style={styles.toggleSubLabel}>Only show stands you've saved</Text>
                      </View>
                    </View>
                    <Switch
                      value={savedOnly}
                      onValueChange={(v) => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSavedOnly(v);
                      }}
                      trackColor={{ false: '#E5E7EB', true: '#FCA5A5' }}
                      thumbColor={savedOnly ? '#EF4444' : '#9CA3AF'}
                    />
                  </View>
                </View>

                {/* Bottom padding */}
                <View style={{ height: 8 }} />
              </ScrollView>

              {/* Apply Button */}
              <View style={styles.applyContainer}>
                <Pressable onPress={handleApply} style={styles.applyButton}>
                  <Text style={styles.applyButtonText}>{resultLabel}</Text>
                </Pressable>
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const FOREST = '#2D5A3D';
const GRAY_100 = '#F3F4F6';
const GRAY_500 = '#6B7280';

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backdropPressable: { flex: 1 },
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 24,
  },
  handleArea: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handleBar: {
    width: 36, height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.5,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  resetText: {
    fontSize: 13,
    color: FOREST,
    fontWeight: '600',
    marginLeft: 4,
  },
  scrollView: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 20 },

  // Section
  section: { paddingVertical: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sectionValue: {
    fontSize: 15,
    fontWeight: '600',
    color: FOREST,
  },
  sectionHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },

  // Chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ratingChipRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap' as const,
    gap: 8,
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: GRAY_100,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: GRAY_100,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  chipWide: {
    minWidth: 56,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: FOREST,
    borderColor: FOREST,
  },
  chipText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  chipTextBold: {
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  chipTextActive: { color: '#FFFFFF' },

  // Category grid (wrap 2-3 per row)
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: GRAY_100,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },

  // Toggle rows
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  toggleTextGroup: { marginLeft: 10, flex: 1 },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  toggleSubLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 1,
  },

  // Slider
  sliderContainer: { marginTop: 8 },
  trackWrapper: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  trackPressable: { height: 40, justifyContent: 'center' },
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
    backgroundColor: FOREST,
    borderRadius: TRACK_HEIGHT / 2,
  },
  thumb: {
    position: 'absolute',
    top: (40 - THUMB_SIZE) / 2,
    left: -THUMB_SIZE / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: FOREST,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  thumbInner: {
    width: 10, height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  scaleMarkers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 2,
  },
  scaleText: { fontSize: 12, color: '#9CA3AF', fontWeight: '500' },

  // Price range inputs
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priceInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  priceCurrency: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    marginRight: 4,
  },
  priceInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    fontWeight: '500',
    padding: 0,
  },
  priceDash: {
    fontSize: 16,
    color: '#9CA3AF',
    fontWeight: '400',
  },
  priceError: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 6,
  },

  // Apply button
  applyContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  applyButton: {
    backgroundColor: FOREST,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
