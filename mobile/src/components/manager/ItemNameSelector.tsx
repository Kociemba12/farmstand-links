/**
 * ItemNameSelector — Bottom sheet item picker for the Record Sale form.
 * Loads live inventory from Supabase, supports real-time search filtering,
 * custom item entry, and auto-fills category/unit/price on selection.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  FlatList,
  Platform,
  ListRenderItemInfo,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolateColor,
} from 'react-native-reanimated';
import { Search, X, Check, ChevronDown, Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { fetchInventory } from '@/lib/manager-service';
import type { InventoryItem } from '@/lib/manager-types';

// ─── Props ──────────────────────────────────────────────────────────────────
export interface ItemNameSelectorProps {
  farmstandId: string;
  value: string;
  onChange: (name: string) => void;
  onInventorySelect?: (item: InventoryItem) => void;
  placeholder?: string;
}

// ─── List item types ────────────────────────────────────────────────────────
type ListItem =
  | { type: 'custom_suggestion'; text: string }
  | { type: 'section_header'; title: string }
  | { type: 'inventory'; item: InventoryItem }
  | { type: 'empty'; query: string };

// ─── Component ──────────────────────────────────────────────────────────────
export function ItemNameSelector({
  farmstandId,
  value,
  onChange,
  onInventorySelect,
  placeholder = 'Select or enter item name…',
}: ItemNameSelectorProps) {
  const { height: screenHeight } = useWindowDimensions();
  const sheetHeight = Math.min(screenHeight * 0.82, 640);

  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const searchRef = useRef<TextInput>(null);

  // ─── Animation values ───────────────────────────────────────────────────
  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // ─── Load inventory ─────────────────────────────────────────────────────
  const loadInventory = useCallback(async () => {
    setLoading(true);
    try {
      const items = await fetchInventory(farmstandId);
      // Only active items, sorted by name
      const active = items
        .filter((i) => i.is_active)
        .sort((a, b) => a.item_name.localeCompare(b.item_name));
      setInventory(active);
    } catch (err) {
      console.log('[ItemNameSelector] loadInventory error:', err);
      setInventory([]);
    } finally {
      setLoading(false);
    }
  }, [farmstandId]);

  // ─── Open / Close ────────────────────────────────────────────────────────
  const openPicker = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearch('');
    translateY.value = sheetHeight;
    backdropOpacity.value = 0;
    setModalVisible(true);
    translateY.value = withSpring(0, { damping: 26, stiffness: 220 });
    backdropOpacity.value = withTiming(1, { duration: 200 });
    // Load inventory when sheet opens
    loadInventory();
    // Focus search after sheet animates in
    setTimeout(() => searchRef.current?.focus(), 350);
  }, [sheetHeight, translateY, backdropOpacity, loadInventory]);

  const closePicker = useCallback(() => {
    translateY.value = withTiming(sheetHeight, { duration: 260 });
    backdropOpacity.value = withTiming(0, { duration: 220 }, (finished) => {
      'worklet';
      if (finished) {
        runOnJS(setModalVisible)(false);
        runOnJS(setSearch)('');
      }
    });
  }, [sheetHeight, translateY, backdropOpacity]);

  // ─── Selection handlers ──────────────────────────────────────────────────
  const handleSelectInventory = useCallback(
    (item: InventoryItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onChange(item.item_name);
      onInventorySelect?.(item);
      closePicker();
    },
    [onChange, onInventorySelect, closePicker]
  );

  const handleSelectCustom = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onChange(trimmed);
      closePicker();
    },
    [onChange, closePicker]
  );

  // ─── Filtered list data ──────────────────────────────────────────────────
  const listData = useMemo<ListItem[]>(() => {
    const q = search.toLowerCase().trim();
    const items: ListItem[] = [];

    const filtered = inventory.filter(
      (i) => !q || i.item_name.toLowerCase().includes(q)
    );

    const hasExactMatch = q && filtered.some(
      (i) => i.item_name.toLowerCase() === q
    );

    // "Use custom item" suggestion appears at top when typed text doesn't match
    if (q && !hasExactMatch) {
      items.push({ type: 'custom_suggestion', text: search.trim() });
    }

    if (filtered.length > 0) {
      items.push({ type: 'section_header', title: 'Your Inventory' });
      filtered.forEach((i) => items.push({ type: 'inventory', item: i }));
    } else if (q && hasExactMatch === false && inventory.length > 0) {
      // no matches at all
    } else if (!q && inventory.length === 0 && !loading) {
      items.push({ type: 'empty', query: '' });
    }

    return items;
  }, [inventory, search, loading]);

  const hasValue = value.trim().length > 0;

  // ─── Row renderers ────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) => {
      if (item.type === 'section_header') {
        return (
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              color: '#A89E96',
              letterSpacing: 0.9,
              textTransform: 'uppercase',
              paddingTop: 14,
              paddingBottom: 6,
              paddingHorizontal: 2,
            }}
          >
            {item.title}
          </Text>
        );
      }

      if (item.type === 'custom_suggestion') {
        return (
          <Pressable
            onPress={() => handleSelectCustom(item.text)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: pressed ? '#E3EEE6' : '#EEF5EF',
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 13,
              marginBottom: 4,
              gap: 12,
              borderWidth: 1,
              borderColor: '#C8DFD0',
            })}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: '#2D5A3D',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Plus size={17} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontSize: 11, color: '#5A8A6A', fontWeight: '600', marginBottom: 2 }}
              >
                Use custom item
              </Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#1A1A1A' }}>
                "{item.text}"
              </Text>
            </View>
          </Pressable>
        );
      }

      if (item.type === 'inventory') {
        const isSelected = value === item.item.item_name;
        const priceText = item.item.price != null ? ` · $${item.item.price.toFixed(2)}` : '';
        const unitText = item.item.unit ? `/${item.item.unit}` : '';
        const subtitle = item.item.category
          ? `${item.item.category}${priceText}${unitText}`
          : priceText
          ? `$${item.item.price?.toFixed(2)}${unitText}`
          : '';

        return (
          <Pressable
            onPress={() => handleSelectInventory(item.item)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: pressed ? '#F0EDE9' : isSelected ? '#EEF5EF' : '#FFF',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
              marginBottom: 2,
              borderWidth: 1,
              borderColor: isSelected ? '#B5D4BC' : 'transparent',
              gap: 12,
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: isSelected ? '#D4EDD9' : '#EDE8E3',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 20 }}>📦</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: isSelected ? '600' : '400',
                  color: isSelected ? '#2D5A3D' : '#1A1A1A',
                }}
              >
                {item.item.item_name}
              </Text>
              {subtitle ? (
                <Text
                  style={{ fontSize: 13, color: '#8A8078', marginTop: 1 }}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {isSelected && <Check size={17} color="#2D5A3D" />}
          </Pressable>
        );
      }

      if (item.type === 'empty') {
        return (
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <Text style={{ fontSize: 15, color: '#A89E96', textAlign: 'center' }}>
              No inventory items yet.{'\n'}Type a name below to use a custom item.
            </Text>
          </View>
        );
      }

      return null;
    },
    [value, handleSelectInventory, handleSelectCustom]
  );

  const keyExtractor = useCallback((item: ListItem, index: number): string => {
    if (item.type === 'inventory') return `inv-${item.item.id}`;
    if (item.type === 'custom_suggestion') return 'custom_suggestion';
    if (item.type === 'section_header') return `header-${item.title}-${index}`;
    return `empty-${index}`;
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* Tappable trigger field */}
      <Pressable
        onPress={openPicker}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: pressed ? '#F5F0EC' : '#FFF',
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderWidth: 1,
          borderColor: '#E8DDD4',
          minHeight: 48,
        })}
      >
        <Text
          style={{ flex: 1, fontSize: 16, color: hasValue ? '#1A1A1A' : '#C0B8B0' }}
          numberOfLines={1}
        >
          {hasValue ? value : placeholder}
        </Text>
        <ChevronDown size={18} color="#7A6F65" />
      </Pressable>

      {/* Bottom sheet modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="none"
        onRequestClose={closePicker}
        statusBarTranslucent
      >
        {/* Full-screen container */}
        <View style={{ flex: 1 }}>
          {/* Dimmed backdrop */}
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.45)',
              },
              backdropStyle,
            ]}
          />
          {/* Tap-to-dismiss area */}
          <Pressable
            style={{ flex: 1 }}
            onPress={closePicker}
          />

          {/* Sheet — explicit height so flex children work correctly */}
          <Animated.View
            style={[
              {
                height: sheetHeight,
                backgroundColor: '#FAF7F4',
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                paddingBottom: Platform.OS === 'ios' ? 34 : 16,
              },
              sheetStyle,
            ]}
          >
            {/* Inner layout — explicit flex:1 works because parent has explicit height */}
            <View style={{ flex: 1 }}>
              {/* Drag handle */}
              <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
                <View
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: '#D4C9C0',
                  }}
                />
              </View>

              {/* Header: title + close button */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 20,
                  paddingTop: 8,
                  paddingBottom: 10,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 20,
                    fontWeight: '700',
                    color: '#1A1A1A',
                    letterSpacing: -0.5,
                  }}
                >
                  Select Item
                </Text>
                <Pressable
                  onPress={closePicker}
                  hitSlop={12}
                  style={({ pressed }) => ({
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: pressed ? '#D4C9C0' : '#EDE8E3',
                    alignItems: 'center',
                    justifyContent: 'center',
                  })}
                >
                  <X size={15} color="#7A6F65" />
                </Pressable>
              </View>

              {/* Search bar */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginHorizontal: 16,
                  marginBottom: 6,
                  paddingHorizontal: 12,
                  backgroundColor: '#FFF',
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: '#E8DDD4',
                  gap: 8,
                  height: 46,
                }}
              >
                <Search size={16} color="#A89E96" />
                <TextInput
                  ref={searchRef}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search or type item name…"
                  placeholderTextColor="#C0B8B0"
                  style={{ flex: 1, fontSize: 16, color: '#1A1A1A', height: 46 }}
                  autoCapitalize="words"
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    if (search.trim()) handleSelectCustom(search.trim());
                  }}
                />
              </View>

              {/* Loading indicator */}
              {loading ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="small" color="#2D5A3D" />
                  <Text style={{ marginTop: 8, fontSize: 13, color: '#A89E96' }}>
                    Loading inventory…
                  </Text>
                </View>
              ) : (
                /* Scrollable item list */
                <FlatList
                  data={listData}
                  keyExtractor={keyExtractor}
                  renderItem={renderItem}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={{ flex: 1 }}
                  contentContainerStyle={{
                    paddingHorizontal: 16,
                    paddingTop: 2,
                    paddingBottom: 20,
                  }}
                  ListFooterComponent={
                    /* "Use custom item" hint when no search query */
                    !search.trim() ? (
                      <View
                        style={{
                          marginTop: 16,
                          paddingTop: 14,
                          borderTopWidth: 1,
                          borderTopColor: '#EDE8E3',
                          alignItems: 'center',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            color: '#A89E96',
                            textAlign: 'center',
                          }}
                        >
                          Type a name above to use a custom item
                        </Text>
                      </View>
                    ) : null
                  }
                />
              )}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}
