import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Switch,
  Alert,
  LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import {
  ChevronLeft,
  MapPin,
  Sparkles,
  Map,
  Calendar,
  Clock,
  TrendingUp,
  Check,
  Trash2,
  Info,
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';

import { useAdminStore } from '@/lib/admin-store';
import { EXPLORE_CATEGORIES, getPromoStatus, usePromotionsStore } from '@/lib/promotions-store';
import { Farmstand, PromoStatus } from '@/lib/farmer-store';

// Draggable Slider component for priority/weight
interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  helperText?: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

function DraggableSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  helperText,
  onDragStart,
  onDragEnd,
}: SliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbPosition = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const startX = useSharedValue(0);
  const startPosition = useSharedValue(0);

  // Calculate percentage and position from value
  const percentage = ((value - min) / (max - min)) * 100;

  // Update thumb position when value changes externally
  useEffect(() => {
    if (!isDragging.value && trackWidth > 0) {
      thumbPosition.value = (percentage / 100) * trackWidth;
    }
  }, [value, trackWidth, percentage]);

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setTrackWidth(width);
    thumbPosition.value = (percentage / 100) * width;
  }, [percentage]);

  // Snap value to step
  const snapToStep = useCallback((val: number): number => {
    const snapped = Math.round((val - min) / step) * step + min;
    return Math.max(min, Math.min(max, snapped));
  }, [min, max, step]);

  // Update value from position
  const updateValue = useCallback((position: number) => {
    if (trackWidth <= 0) return;
    const ratio = Math.max(0, Math.min(1, position / trackWidth));
    const rawValue = min + ratio * (max - min);
    const snappedValue = snapToStep(rawValue);
    onChange(snappedValue);
  }, [trackWidth, min, max, snapToStep, onChange]);

  // Haptic feedback
  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      isDragging.value = true;
      startX.value = e.x;
      startPosition.value = thumbPosition.value;
      if (onDragStart) {
        runOnJS(onDragStart)();
      }
    })
    .onUpdate((e) => {
      const newPosition = Math.max(0, Math.min(trackWidth, startPosition.value + (e.x - startX.value)));
      thumbPosition.value = newPosition;
      runOnJS(updateValue)(newPosition);
    })
    .onEnd(() => {
      isDragging.value = false;
      runOnJS(triggerHaptic)();
      if (onDragEnd) {
        runOnJS(onDragEnd)();
      }
    })
    .hitSlop({ top: 20, bottom: 20, left: 10, right: 10 });

  // Tap gesture for quick selection
  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      const newPosition = Math.max(0, Math.min(trackWidth, e.x));
      thumbPosition.value = newPosition;
      runOnJS(updateValue)(newPosition);
      runOnJS(triggerHaptic)();
    });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbPosition.value - 14 }],
  }));

  const filledTrackStyle = useAnimatedStyle(() => ({
    width: thumbPosition.value,
  }));

  return (
    <View className="mb-5">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-charcoal font-medium text-sm">{label}</Text>
        <View className="bg-forest/10 px-3 py-1 rounded-lg">
          <Text className="text-forest font-bold text-base">{value}</Text>
        </View>
      </View>
      <GestureDetector gesture={composedGesture}>
        <View
          className="h-14 justify-center"
          onLayout={onTrackLayout}
        >
          {/* Track background */}
          <View className="h-2 bg-sand rounded-full" />
          {/* Filled track */}
          <Animated.View
            className="absolute h-2 bg-forest rounded-full left-0"
            style={filledTrackStyle}
          />
          {/* Thumb */}
          <Animated.View
            className="absolute w-7 h-7 bg-white rounded-full border-2 border-forest items-center justify-center"
            style={[
              thumbStyle,
              {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 4,
                elevation: 4,
              },
            ]}
          >
            <View className="w-2 h-2 bg-forest rounded-full" />
          </Animated.View>
        </View>
      </GestureDetector>
      {/* Min/Max labels */}
      <View className="flex-row justify-between mt-1">
        <Text className="text-wood/50 text-xs">{min}</Text>
        <Text className="text-wood/50 text-xs">{max}</Text>
      </View>
      {helperText && (
        <Text className="text-wood/70 text-xs mt-2">{helperText}</Text>
      )}
    </View>
  );
}

export default function PromotionEditScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();

  // Stores
  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);
  const updateFarmstand = useAdminStore((s) => s.updateFarmstand);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  // State
  const [farmstand, setFarmstand] = useState<Farmstand | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // Form state
  const [promoActive, setPromoActive] = useState(false);
  const [promoExploreCategories, setPromoExploreCategories] = useState<string[]>([]);
  const [promoMapBoost, setPromoMapBoost] = useState(false);
  const [promoPriority, setPromoPriority] = useState(50);
  const [promoRotationWeight, setPromoRotationWeight] = useState(1);
  const [scheduleType, setScheduleType] = useState<'forever' | 'scheduled'>('forever');
  const [promoStartAt, setPromoStartAt] = useState<Date | null>(null);
  const [promoEndAt, setPromoEndAt] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Load farmstand data
  useEffect(() => {
    loadAdminData();
  }, []);

  useEffect(() => {
    if (params.id) {
      const fs = getFarmstandById(params.id);
      if (fs) {
        setFarmstand(fs);
        setPromoActive(fs.promoActive);
        setPromoExploreCategories(fs.promoExploreCategories || []);
        setPromoMapBoost(fs.promoMapBoost);
        setPromoPriority(fs.promoPriority || 50);
        setPromoRotationWeight(fs.promoRotationWeight || 1);

        if (fs.promoStartAt || fs.promoEndAt) {
          setScheduleType('scheduled');
          setPromoStartAt(fs.promoStartAt ? new Date(fs.promoStartAt) : null);
          setPromoEndAt(fs.promoEndAt ? new Date(fs.promoEndAt) : null);
        }
      }
    }
  }, [params.id, getFarmstandById]);

  const mainPhoto = useMemo(() => {
    if (!farmstand) return null;
    return (
      farmstand.photos[farmstand.mainPhotoIndex ?? 0] ??
      farmstand.photos[0] ??
      'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=800'
    );
  }, [farmstand]);

  const currentPromoStatus = useMemo(() => {
    if (!farmstand) return 'none';
    return getPromoStatus({
      ...farmstand,
      promoActive,
      promoStartAt: promoStartAt?.toISOString() || null,
      promoEndAt: promoEndAt?.toISOString() || null,
    });
  }, [farmstand, promoActive, promoStartAt, promoEndAt]);

  const toggleCategory = (categoryId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPromoExploreCategories((prev) => {
      if (prev.includes(categoryId)) {
        return prev.filter((c) => c !== categoryId);
      }
      // Limit to 3 categories
      if (prev.length >= 3) {
        Alert.alert(
          'Category Limit',
          'A farmstand can be promoted in up to 3 categories at a time.'
        );
        return prev;
      }
      return [...prev, categoryId];
    });
  };

  const handleSave = async () => {
    if (!farmstand) return;

    // Validation for scheduled promotions
    if ((promoActive || promoMapBoost) && scheduleType === 'scheduled') {
      if (!promoStartAt) {
        Alert.alert('Missing Start Date', 'Please select a start date for the scheduled promotion.');
        return;
      }
      if (!promoEndAt) {
        Alert.alert('Missing End Date', 'Please select an end date for the scheduled promotion.');
        return;
      }
      if (promoEndAt <= promoStartAt) {
        Alert.alert('Invalid Dates', 'End date must be after the start date.');
        return;
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsSaving(true);

    try {
      // Calculate the promo status based on schedule
      let promoStatus: PromoStatus = 'none';
      if (promoActive || promoMapBoost) {
        const now = new Date();
        const effectiveStartAt = scheduleType === 'scheduled' ? promoStartAt : null;
        const effectiveEndAt = scheduleType === 'scheduled' ? promoEndAt : null;

        if (effectiveStartAt && now < effectiveStartAt) {
          promoStatus = 'scheduled';
        } else if (effectiveEndAt && now > effectiveEndAt) {
          promoStatus = 'expired';
        } else {
          promoStatus = 'active';
        }
      }

      await updateFarmstand(farmstand.id, {
        promoActive,
        promoExploreCategories,
        promoMapBoost,
        promoPriority,
        promoRotationWeight,
        promoStartAt: scheduleType === 'scheduled' && promoStartAt
          ? promoStartAt.toISOString()
          : null,
        promoEndAt: scheduleType === 'scheduled' && promoEndAt
          ? promoEndAt.toISOString()
          : null,
        promoStatus,
      });

      router.back();
    } catch (error) {
      console.error('Error saving promotion:', error);
      Alert.alert('Error', 'Failed to save promotion. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemovePromotion = () => {
    Alert.alert(
      'Remove Promotion',
      'Are you sure you want to remove this promotion? The farmstand will no longer be featured.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!farmstand) return;

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setIsSaving(true);

            try {
              await updateFarmstand(farmstand.id, {
                promoActive: false,
                promoExploreCategories: [],
                promoMapBoost: false,
                promoPriority: 50,
                promoRotationWeight: 1,
                promoStartAt: null,
                promoEndAt: null,
                promoStatus: 'none',
              });

              router.back();
            } catch (error) {
              console.error('Error removing promotion:', error);
              Alert.alert('Error', 'Failed to remove promotion. Please try again.');
            } finally {
              setIsSaving(false);
            }
          },
        },
      ]
    );
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'Not set';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (!farmstand) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <Text className="text-wood">Loading...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      {/* Hide the default navigation header */}
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView edges={['top']} className="bg-cream">
        {/* Header */}
        <View className="flex-row items-center px-5 py-3">
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full bg-white items-center justify-center border border-sand"
            hitSlop={10}
          >
            <ChevronLeft size={24} color="#3D3D3D" />
          </Pressable>
          <Text className="flex-1 text-xl font-bold text-charcoal ml-4">
            Edit Promotion
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        scrollEnabled={scrollEnabled}
      >
        {/* Farmstand Header Card */}
        <Animated.View
          entering={FadeIn.delay(100).duration(400)}
          className="mx-5 mt-2"
        >
          <View className="bg-white rounded-2xl overflow-hidden border border-sand/50 shadow-sm">
            <View className="flex-row p-4">
              <Image
                source={{ uri: mainPhoto! }}
                className="w-20 h-20 rounded-xl"
                resizeMode="cover"
              />
              <View className="flex-1 ml-4 justify-center">
                <Text className="text-charcoal font-bold text-lg" numberOfLines={1}>
                  {farmstand.name}
                </Text>
                <View className="flex-row items-center mt-1">
                  <MapPin size={14} color="#8B6F4E" />
                  <Text className="text-wood text-sm ml-1">
                    {farmstand.city || 'Oregon'}
                  </Text>
                </View>
                {/* Status badge */}
                <View className="flex-row mt-2">
                  <View
                    className="px-2 py-1 rounded-md"
                    style={{
                      backgroundColor:
                        currentPromoStatus === 'active'
                          ? '#E8F5E9'
                          : currentPromoStatus === 'scheduled'
                          ? '#FFF3E0'
                          : currentPromoStatus === 'expired'
                          ? '#EEEEEE'
                          : '#F5F5F5',
                    }}
                  >
                    <Text
                      className="text-xs font-semibold"
                      style={{
                        color:
                          currentPromoStatus === 'active'
                            ? '#2D5A3D'
                            : currentPromoStatus === 'scheduled'
                            ? '#F57C00'
                            : currentPromoStatus === 'expired'
                            ? '#757575'
                            : '#9E9E9E',
                      }}
                    >
                      {promoActive
                        ? currentPromoStatus === 'active'
                          ? 'Promoted'
                          : currentPromoStatus === 'scheduled'
                          ? 'Scheduled'
                          : 'Expired'
                        : 'Not Promoted'}
                    </Text>
                  </View>
                  {farmstand.popularityScore > 0 && (
                    <View className="flex-row items-center ml-2 px-2 py-1 rounded-md bg-purple-50">
                      <TrendingUp size={12} color="#7B1FA2" />
                      <Text className="text-xs font-semibold text-purple-700 ml-1">
                        Score: {farmstand.popularityScore}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Section 1: Placement */}
        <Animated.View
          entering={FadeInDown.delay(200).duration(400)}
          className="mx-5 mt-6"
        >
          <Text className="text-charcoal font-bold text-base mb-3">Placement</Text>

          {/* Feature on Explore */}
          <View className="bg-white rounded-2xl p-4 border border-sand/50 mb-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 rounded-full bg-forest/10 items-center justify-center mr-3">
                  <Sparkles size={20} color="#2D5A3D" />
                </View>
                <View className="flex-1">
                  <Text className="text-charcoal font-semibold">Feature on Explore</Text>
                  <Text className="text-wood text-xs mt-0.5">
                    Show in Explore category carousels
                  </Text>
                </View>
              </View>
              <Switch
                value={promoActive}
                onValueChange={(value) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPromoActive(value);
                }}
                trackColor={{ false: '#E8DDD4', true: '#2D5A3D' }}
                thumbColor="#FFF"
              />
            </View>
          </View>

          {/* Boost on Map */}
          <View className="bg-white rounded-2xl p-4 border border-sand/50">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center flex-1">
                <View className="w-10 h-10 rounded-full bg-blue-50 items-center justify-center mr-3">
                  <Map size={20} color="#1976D2" />
                </View>
                <View className="flex-1">
                  <Text className="text-charcoal font-semibold">Boost on Map Cards</Text>
                  <Text className="text-wood text-xs mt-0.5">
                    Show at top of Map bottom cards
                  </Text>
                </View>
              </View>
              <Switch
                value={promoMapBoost}
                onValueChange={(value) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPromoMapBoost(value);
                }}
                trackColor={{ false: '#E8DDD4', true: '#1976D2' }}
                thumbColor="#FFF"
              />
            </View>
          </View>
        </Animated.View>

        {/* Section 2: Categories (only if Explore promotion is active) */}
        {promoActive && (
          <Animated.View
            entering={FadeInDown.delay(250).duration(400)}
            className="mx-5 mt-6"
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-charcoal font-bold text-base">
                Explore Categories
              </Text>
              <Text className="text-wood text-xs">
                {promoExploreCategories.length}/3 selected
              </Text>
            </View>

            <View className="bg-white rounded-2xl p-4 border border-sand/50">
              <View className="flex-row flex-wrap">
                {EXPLORE_CATEGORIES.map((cat) => {
                  const isSelected = promoExploreCategories.includes(cat.id);
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => toggleCategory(cat.id)}
                      className={`mr-2 mb-2 px-3 py-2 rounded-full border flex-row items-center ${
                        isSelected
                          ? 'bg-forest border-forest'
                          : 'bg-white border-sand'
                      }`}
                    >
                      {isSelected && (
                        <Check size={14} color="#FFF" style={{ marginRight: 4 }} />
                      )}
                      <Text
                        className={`text-sm font-medium ${
                          isSelected ? 'text-white' : 'text-charcoal'
                        }`}
                      >
                        {cat.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View className="flex-row items-start mt-3 p-3 bg-amber-50 rounded-xl">
                <Info size={16} color="#F57C00" style={{ marginTop: 1 }} />
                <Text className="text-amber-800 text-xs ml-2 flex-1">
                  If no categories are selected, the farmstand will appear in all
                  relevant categories based on its offerings.
                </Text>
              </View>
            </View>
          </Animated.View>
        )}

        {/* Section 3: Schedule */}
        {(promoActive || promoMapBoost) && (
          <Animated.View
            entering={FadeInDown.delay(300).duration(400)}
            className="mx-5 mt-6"
          >
            <Text className="text-charcoal font-bold text-base mb-3">Schedule</Text>

            <View className="bg-white rounded-2xl p-4 border border-sand/50">
              {/* Forever / Scheduled toggle */}
              <View className="flex-row mb-4">
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setScheduleType('forever');
                  }}
                  className={`flex-1 py-3 rounded-xl mr-2 ${
                    scheduleType === 'forever' ? 'bg-forest' : 'bg-sand/30'
                  }`}
                >
                  <Text
                    className={`text-center font-semibold ${
                      scheduleType === 'forever' ? 'text-white' : 'text-charcoal'
                    }`}
                  >
                    Always On
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setScheduleType('scheduled');
                  }}
                  className={`flex-1 py-3 rounded-xl ml-2 ${
                    scheduleType === 'scheduled' ? 'bg-forest' : 'bg-sand/30'
                  }`}
                >
                  <Text
                    className={`text-center font-semibold ${
                      scheduleType === 'scheduled' ? 'text-white' : 'text-charcoal'
                    }`}
                  >
                    Scheduled
                  </Text>
                </Pressable>
              </View>

              {/* Date pickers */}
              {scheduleType === 'scheduled' && (
                <View>
                  {/* Start Date */}
                  <Pressable
                    onPress={() => setShowStartPicker(true)}
                    className="flex-row items-center justify-between py-3 border-b border-sand/30"
                  >
                    <View className="flex-row items-center">
                      <Calendar size={18} color="#8B6F4E" />
                      <Text className="text-charcoal ml-3">Start Date</Text>
                    </View>
                    <Text className="text-forest font-medium">
                      {formatDate(promoStartAt)}
                    </Text>
                  </Pressable>

                  {/* End Date */}
                  <Pressable
                    onPress={() => setShowEndPicker(true)}
                    className="flex-row items-center justify-between py-3"
                  >
                    <View className="flex-row items-center">
                      <Clock size={18} color="#8B6F4E" />
                      <Text className="text-charcoal ml-3">End Date</Text>
                    </View>
                    <Text className="text-forest font-medium">
                      {formatDate(promoEndAt)}
                    </Text>
                  </Pressable>

                  {showStartPicker && (
                    <DateTimePicker
                      value={promoStartAt || new Date()}
                      mode="date"
                      display="spinner"
                      onChange={(event, date) => {
                        setShowStartPicker(false);
                        if (date) setPromoStartAt(date);
                      }}
                    />
                  )}

                  {showEndPicker && (
                    <DateTimePicker
                      value={promoEndAt || new Date()}
                      mode="date"
                      display="spinner"
                      minimumDate={promoStartAt || new Date()}
                      onChange={(event, date) => {
                        setShowEndPicker(false);
                        if (date) setPromoEndAt(date);
                      }}
                    />
                  )}
                </View>
              )}
            </View>
          </Animated.View>
        )}

        {/* Section 4: Rotation Settings */}
        {(promoActive || promoMapBoost) && (
          <Animated.View
            entering={FadeInDown.delay(350).duration(400)}
            className="mx-5 mt-6"
          >
            <Text className="text-charcoal font-bold text-base mb-3">
              Rotation Settings
            </Text>

            <View className="bg-white rounded-2xl p-4 border border-sand/50">
              <DraggableSlider
                label="Priority"
                value={promoPriority}
                min={0}
                max={100}
                step={10}
                onChange={setPromoPriority}
                helperText="Higher priority = appears higher in lists"
                onDragStart={() => setScrollEnabled(false)}
                onDragEnd={() => setScrollEnabled(true)}
              />

              <DraggableSlider
                label="Rotation Weight"
                value={promoRotationWeight}
                min={1}
                max={10}
                step={1}
                onChange={setPromoRotationWeight}
                helperText="Higher weight = appears more often when many are promoted"
                onDragStart={() => setScrollEnabled(false)}
                onDragEnd={() => setScrollEnabled(true)}
              />
            </View>
          </Animated.View>
        )}

        {/* Remove Promotion Button */}
        {farmstand.promoActive && (
          <Animated.View
            entering={FadeInDown.delay(400).duration(400)}
            className="mx-5 mt-6"
          >
            <Pressable
              onPress={handleRemovePromotion}
              className="flex-row items-center justify-center py-4 rounded-2xl border border-red-200 bg-red-50"
            >
              <Trash2 size={18} color="#DC2626" />
              <Text className="text-red-600 font-semibold ml-2">
                Remove Promotion
              </Text>
            </Pressable>
          </Animated.View>
        )}
      </ScrollView>

      {/* Save Button */}
      <SafeAreaView edges={['bottom']} className="bg-cream border-t border-sand/50">
        <View className="px-5 py-4">
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className={`py-4 rounded-2xl items-center ${
              isSaving ? 'bg-forest/50' : 'bg-forest'
            }`}
          >
            <Text className="text-white font-bold text-base">
              {isSaving ? 'Saving...' : 'Save Promotion'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
