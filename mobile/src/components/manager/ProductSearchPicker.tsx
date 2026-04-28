/**
 * ProductSearchPicker — Searchable item name field with product chips below.
 *
 * UX: Clean text input + tappable chips directly underneath.
 * No dropdown. Chips filter in real-time as the user types.
 * Tapping a chip autofills the input. Custom free-text always works.
 *
 * Data source: Products tab only (AsyncStorage `farmstand_products`),
 * filtered to the current farmstand and active products only.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Search, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Product } from '@/lib/products-store';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ProductSuggestion {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  unit_price: number | null;
}

export interface ProductSearchPickerProps {
  farmstandId: string;
  value: string;
  onChange: (name: string) => void;
  /** Called when user taps an existing product chip */
  onSuggestionSelect?: (suggestion: ProductSuggestion) => void;
  placeholder?: string;
}

// ─── Animated chip (matches Category/Unit/Payment chips exactly) ──────────────

function AnimatedChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { scale.value = withSpring(0.95, { damping: 15, stiffness: 300 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 300 }); }}
    >
      <Animated.View
        style={[
          {
            paddingHorizontal: 20,
            paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: active ? '#2F5D3A' : '#E3DED6',
            borderWidth: active ? 0 : 1,
            borderColor: '#CFC7BB',
            shadowColor: active ? '#2F5D3A' : '#000',
            shadowOpacity: active ? 0.25 : 0.06,
            shadowRadius: active ? 6 : 3,
            shadowOffset: { width: 0, height: active ? 3 : 1 },
            elevation: active ? 4 : 1,
          },
          animStyle,
        ]}
      >
        <Text style={{ fontSize: 14, fontWeight: '600', color: active ? '#FFFFFF' : '#4A4540' }}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Data loader ──────────────────────────────────────────────────────────────

async function loadProductsForFarmstand(farmstandId: string): Promise<ProductSuggestion[]> {
  try {
    const raw = await AsyncStorage.getItem('farmstand_products');
    const all: Product[] = raw ? (JSON.parse(raw) as Product[]) : [];
    return all
      .filter((p) => p.farmstand_id === farmstandId && p.is_active)
      .map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category ?? null,
        unit: p.unit ?? null,
        unit_price: p.price ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProductSearchPicker({
  farmstandId,
  value,
  onChange,
  onSuggestionSelect,
  placeholder = 'Search or enter item name...',
}: ProductSearchPickerProps) {
  const [query, setQuery] = useState(value);
  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const inputRef = useRef<TextInput>(null);

  // Keep local query in sync when parent resets value (e.g. form clear)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Load products whenever the farmstand changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadProductsForFarmstand(farmstandId).then((fresh) => {
      if (!cancelled) {
        setProducts(fresh);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [farmstandId]);

  // Chips visible based on current query
  const visibleChips = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, query]);

  // Which chip (if any) currently matches the selected value exactly
  const selectedChipId = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return null;
    return products.find((p) => p.name.toLowerCase() === q)?.id ?? null;
  }, [products, value]);

  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      onChange(text);
    },
    [onChange]
  );

  const handleChipPress = useCallback(
    (product: ProductSuggestion) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setQuery(product.name);
      onChange(product.name);
      onSuggestionSelect?.(product);
      inputRef.current?.blur();
    },
    [onChange, onSuggestionSelect]
  );

  const handleClear = useCallback(() => {
    setQuery('');
    onChange('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [onChange]);

  const hasProducts = products.length > 0;
  const noChipsMatch = hasProducts && visibleChips.length === 0 && query.trim().length > 0;

  return (
    <View>
      {/* ── Text input ─────────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#FAF8F4',
          borderRadius: 14,
          paddingHorizontal: 14,
          borderWidth: 1.5,
          borderColor: isFocused ? '#2F5D3A' : '#D4C9C0',
          height: 50,
          gap: 10,
          shadowColor: '#000',
          shadowOpacity: isFocused ? 0.08 : 0.03,
          shadowRadius: isFocused ? 6 : 4,
          shadowOffset: { width: 0, height: 2 },
          elevation: 1,
        }}
      >
        <Search size={16} color={isFocused ? '#2F5D3A' : '#A89E96'} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={handleChangeText}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          placeholderTextColor="#B8AFA7"
          style={{ flex: 1, fontSize: 15, color: '#1F1F1F', height: 50 }}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
        />
        {query.length > 0 && (
          <Pressable onPress={handleClear} hitSlop={8}>
            <X size={16} color="#A89E96" />
          </Pressable>
        )}
      </View>

      {/* ── Product chips ──────────────────────────────────────────────────── */}
      {loading ? (
        <View style={{ paddingTop: 10, paddingLeft: 2 }}>
          <ActivityIndicator size="small" color="#2F5D3A" />
        </View>
      ) : !hasProducts ? (
        <Text style={{ marginTop: 8, fontSize: 12, color: '#A89E96', fontStyle: 'italic' }}>
          No products yet. Add products in your Farmstand.
        </Text>
      ) : noChipsMatch ? (
        <Text style={{ marginTop: 8, fontSize: 12, color: '#A89E96', fontStyle: 'italic' }}>
          No matches — your typed name will be saved as-is.
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {visibleChips.map((product) => (
            <AnimatedChip
              key={product.id}
              label={product.name}
              active={selectedChipId === product.id}
              onPress={() => handleChipPress(product)}
            />
          ))}
        </View>
      )}
    </View>
  );
}
