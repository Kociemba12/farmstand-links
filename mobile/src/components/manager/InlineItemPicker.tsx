/**
 * InlineItemPicker — Searchable item name input with inline dropdown.
 * Renders as a search bar; tapping opens a dropdown below the field.
 * Data comes from Products (AsyncStorage) + optionally Inventory (Supabase).
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Search, X, Plus, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchInventory } from '@/lib/manager-service';
import type { Product } from '@/lib/products-store';

// ─── Unified suggestion type ─────────────────────────────────────────────────
export interface ItemSuggestion {
  id: string;
  name: string;
  source: 'product' | 'inventory';
  category?: string | null;
  unit?: string | null;
  unit_price?: number | null;
  inventory_item_id?: string | null;
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface InlineItemPickerProps {
  farmstandId: string;
  value: string;
  onChange: (name: string) => void;
  onSuggestionSelect?: (suggestion: ItemSuggestion) => void;
  /** Also include inventory items as suggestions (for Sales page) */
  includeInventory?: boolean;
  placeholder?: string;
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────
function rankMatch(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return 3;
}

function sortSuggestions(items: ItemSuggestion[], q: string): ItemSuggestion[] {
  const trimmed = q.trim().toLowerCase();
  if (!trimmed) return [...items].sort((a, b) => a.name.localeCompare(b.name));
  return [...items]
    .filter((i) => i.name.toLowerCase().includes(trimmed))
    .sort((a, b) => {
      const ra = rankMatch(a.name, trimmed);
      const rb = rankMatch(b.name, trimmed);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
}

// ─── Component ────────────────────────────────────────────────────────────────
export function InlineItemPicker({
  farmstandId,
  value,
  onChange,
  onSuggestionSelect,
  includeInventory = false,
  placeholder = 'Search or enter item name…',
}: InlineItemPickerProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>(value);
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const inputRef = useRef<TextInput>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Keep local query in sync when value resets (form reset) ────────────
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // ─── Load suggestions ────────────────────────────────────────────────────
  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      // Products from AsyncStorage (Products tab)
      const raw = await AsyncStorage.getItem('farmstand_products');
      const allProducts: Product[] = raw ? (JSON.parse(raw) as Product[]) : [];
      const farmProducts = allProducts.filter(
        (p) => p.farmstand_id === farmstandId && p.is_active
      );

      const productSuggestions: ItemSuggestion[] = farmProducts.map((p) => ({
        id: `prod-${p.id}`,
        name: p.name,
        source: 'product' as const,
        category: p.category ?? null,
        unit: p.unit ?? null,
        unit_price: p.price ?? null,
        inventory_item_id: null,
      }));

      let combined: ItemSuggestion[] = [...productSuggestions];

      // Inventory items from Supabase (optional, for Sales page)
      if (includeInventory) {
        const invItems = await fetchInventory(farmstandId);
        const activeInv = invItems.filter((i) => i.is_active);

        // Deduplicate — products win, inventory fills the rest
        const seen = new Set(combined.map((s) => s.name.toLowerCase().trim()));
        for (const inv of activeInv) {
          const normalised = inv.item_name.toLowerCase().trim();
          if (!seen.has(normalised)) {
            combined.push({
              id: `inv-${inv.id}`,
              name: inv.item_name,
              source: 'inventory',
              category: inv.category ?? null,
              unit: inv.unit ?? null,
              unit_price: inv.price ?? null,
              inventory_item_id: inv.id,
            });
            seen.add(normalised);
          }
        }
      }

      setSuggestions(combined);
    } catch (err) {
      console.log('[InlineItemPicker] loadSuggestions error:', err);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [farmstandId, includeInventory]);

  // ─── Open / close logic ───────────────────────────────────────────────────
  const handleFocus = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setIsOpen(true);
    if (suggestions.length === 0) {
      loadSuggestions();
    }
  }, [suggestions.length, loadSuggestions]);

  const handleBlur = useCallback(() => {
    // Short delay so item-tap registers before we close the dropdown
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 200);
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    onChange('');
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [onChange]);

  // ─── Text input ───────────────────────────────────────────────────────────
  const handleChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      onChange(text);
      if (!isOpen) setIsOpen(true);
    },
    [isOpen, onChange]
  );

  // ─── Select existing suggestion ───────────────────────────────────────────
  const handleSelect = useCallback(
    (suggestion: ItemSuggestion) => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setQuery(suggestion.name);
      onChange(suggestion.name);
      onSuggestionSelect?.(suggestion);
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onChange, onSuggestionSelect]
  );

  // ─── Create new item from typed text ──────────────────────────────────────
  const handleAddNew = useCallback(
    (name: string) => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      const trimmed = name.trim();
      if (!trimmed) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setQuery(trimmed);
      onChange(trimmed);
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onChange]
  );

  // ─── Filtered + sorted list ───────────────────────────────────────────────
  const filteredSuggestions = useMemo(
    () => sortSuggestions(suggestions, query),
    [suggestions, query]
  );

  const hasExactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q.length > 0 && filteredSuggestions.some((s) => s.name.toLowerCase() === q);
  }, [filteredSuggestions, query]);

  const showAddRow = query.trim().length > 0 && !hasExactMatch;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View>
      {/* ── Search input ── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          paddingHorizontal: 14,
          borderWidth: 1,
          borderColor: isOpen ? '#2D5A3D' : '#E8DDD4',
          height: 48,
          gap: 10,
        }}
      >
        <Search size={16} color={isOpen ? '#2D5A3D' : '#A89E96'} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={handleChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor="#C0B8B0"
          style={{
            flex: 1,
            fontSize: 16,
            color: '#1A1A1A',
            height: 48,
          }}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (query.trim()) handleAddNew(query.trim());
          }}
        />
        {query.length > 0 && (
          <Pressable onPress={handleClear} hitSlop={8}>
            <X size={16} color="#A89E96" />
          </Pressable>
        )}
      </View>

      {/* ── Inline dropdown ── */}
      {isOpen && (
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#E8DDD4',
            marginTop: 4,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.1,
            shadowRadius: 12,
            elevation: 6,
          }}
        >
          {loading ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#2D5A3D" />
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              style={{ maxHeight: 248 }}
            >
              {/* ── Add new item row ── */}
              {showAddRow && (
                <Pressable
                  onPress={() => handleAddNew(query.trim())}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    backgroundColor: pressed ? '#DCF0E3' : '#EEF8F2',
                    borderBottomWidth: filteredSuggestions.length > 0 ? 1 : 0,
                    borderBottomColor: '#D0E9D8',
                    gap: 12,
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
                    <Plus size={16} color="#FFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 11,
                        color: '#5A8A6A',
                        fontWeight: '600',
                        letterSpacing: 0.3,
                        marginBottom: 2,
                        textTransform: 'uppercase',
                      }}
                    >
                      Add new item
                    </Text>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#1A1A1A' }}>
                      "{query.trim()}"
                    </Text>
                  </View>
                </Pressable>
              )}

              {/* ── Suggestion rows ── */}
              {filteredSuggestions.map((suggestion) => {
                const isSelected =
                  value.trim().toLowerCase() === suggestion.name.toLowerCase();
                const parts: string[] = [];
                if (suggestion.category) parts.push(suggestion.category);
                if (suggestion.unit_price != null)
                  parts.push(`$${suggestion.unit_price.toFixed(2)}`);
                if (suggestion.unit) parts.push(`/${suggestion.unit}`);
                const subtitle = parts.join(' · ');

                return (
                  <Pressable
                    key={suggestion.id}
                    onPress={() => handleSelect(suggestion)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 14,
                      paddingVertical: 13,
                      backgroundColor: pressed
                        ? '#F0EDE9'
                        : isSelected
                        ? '#EEF5EF'
                        : '#FFFFFF',
                      borderBottomWidth: 1,
                      borderBottomColor: '#F4F1EE',
                      gap: 12,
                    })}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: isSelected ? '#D4EDD9' : '#F0EDE9',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 17 }}>
                        {suggestion.source === 'inventory' ? '📦' : '🏷️'}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 15,
                          fontWeight: isSelected ? '600' : '500',
                          color: isSelected ? '#2D5A3D' : '#1A1A1A',
                        }}
                      >
                        {suggestion.name}
                      </Text>
                      {subtitle ? (
                        <Text
                          style={{ fontSize: 12, color: '#9A9089', marginTop: 2 }}
                          numberOfLines={1}
                        >
                          {subtitle}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected && <Check size={15} color="#2D5A3D" />}
                  </Pressable>
                );
              })}

              {/* ── Empty state ── */}
              {filteredSuggestions.length === 0 && !showAddRow && (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, color: '#A89E96', textAlign: 'center' }}>
                    {query.trim()
                      ? 'No matches. Tap above to add.'
                      : 'Start typing an item name.'}
                  </Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
