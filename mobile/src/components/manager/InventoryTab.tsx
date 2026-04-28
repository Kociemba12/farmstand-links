import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Plus, Minus, Edit3, Trash2, Package, X, Check } from 'lucide-react-native';
import type { InventoryItem } from '@/lib/manager-types';
import { getStockStatus } from '@/lib/manager-types';
import {
  fetchInventory,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  adjustInventoryQuantity,
  formatCurrency,
} from '@/lib/manager-service';
import { ListSkeleton } from './ManagerShimmer';
import { ProductSearchPicker } from './ProductSearchPicker';
import type { ProductSuggestion } from './ProductSearchPicker';

interface InventoryTabProps {
  farmstandId: string;
  onInventoryChanged?: () => void;
}

interface FormState {
  item_name: string;
  category: string;
  quantity: string;
  unit: string;
  price: string;
  low_stock_threshold: string;
  notes: string;
}

const emptyForm: FormState = {
  item_name: '',
  category: '',
  quantity: '0',
  unit: 'each',
  price: '',
  low_stock_threshold: '5',
  notes: '',
};

// Suggested — never mandatory. Users can always type anything.
const SUGGESTED_CATEGORIES = [
  'Vegetables', 'Fruit', 'Eggs', 'Honey', 'Flowers',
  'Herbs', 'Baked Goods', 'Meat', 'Dairy', 'Plants',
  'Preserves', 'Bundles', 'Seeds', 'Other',
];

const SUGGESTED_UNITS = [
  'each', 'dozen', 'lb', 'oz', 'bunch', 'pint',
  'quart', 'bag', 'box', 'flat', 'jar', 'bundle',
];

function StockBadge({ item }: { item: InventoryItem }) {
  const status = getStockStatus(item);
  if (status === 'in_stock') {
    return (
      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#F0FDF4' }}>
        <Text className="text-xs font-semibold" style={{ color: '#16a34a' }}>In Stock</Text>
      </View>
    );
  }
  if (status === 'low') {
    return (
      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#FFFBEB' }}>
        <Text className="text-xs font-semibold" style={{ color: '#D97706' }}>Low</Text>
      </View>
    );
  }
  return (
    <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: '#FEF2F2' }}>
      <Text className="text-xs font-semibold" style={{ color: '#DC2626' }}>Out</Text>
    </View>
  );
}

interface SuggestionChipsProps {
  suggestions: string[];
  selected: string;
  onSelect: (v: string) => void;
}

interface AnimatedChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function AnimatedChip({ label, active, onPress }: AnimatedChipProps) {
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

function SuggestionChips({ suggestions, selected, onSelect }: SuggestionChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginTop: 10 }}
      contentContainerStyle={{ gap: 8, paddingRight: 8 }}
    >
      {suggestions.map((s) => {
        const active = selected.trim().toLowerCase() === s.toLowerCase();
        return (
          <AnimatedChip
            key={s}
            label={s}
            active={active}
            onPress={() => onSelect(active ? '' : s)}
          />
        );
      })}
    </ScrollView>
  );
}

interface ToastState { visible: boolean; message: string; success: boolean; }

export function InventoryTab({ farmstandId, onInventoryChanged }: InventoryTabProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: '', success: true });
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const showToast = useCallback((message: string, success = true) => {
    setToast({ visible: true, message, success });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchInventory(farmstandId);
    setItems(data);
    setLoading(false);
  }, [farmstandId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = useCallback(() => {
    setEditingItem(null);
    setForm(emptyForm);
    setModalVisible(true);
  }, []);

  const openEdit = useCallback((item: InventoryItem) => {
    setEditingItem(item);
    setForm({
      item_name: item.item_name,
      category: item.category ?? '',
      quantity: String(item.quantity),
      unit: item.unit,
      price: item.price != null ? String(item.price) : '',
      low_stock_threshold: String(item.low_stock_threshold),
      notes: item.notes ?? '',
    });
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingItem(null);
    setForm(emptyForm);
  }, []);

  const updateForm = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSuggestionSelect = useCallback((suggestion: ProductSuggestion) => {
    setForm((prev) => ({
      ...prev,
      category: prev.category.trim() ? prev.category : (suggestion.category ?? prev.category),
      unit: prev.unit.trim() && prev.unit !== 'each' ? prev.unit : (suggestion.unit ?? prev.unit),
      price: prev.price.trim() ? prev.price : (suggestion.unit_price != null ? String(suggestion.unit_price) : prev.price),
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.item_name.trim()) {
      showToast('Item name is required', false);
      return;
    }
    setSaving(true);
    try {
      if (editingItem) {
        const ok = await updateInventoryItem(editingItem.id, {
          item_name: form.item_name.trim(),
          category: form.category.trim() || null,
          quantity: parseFloat(form.quantity) || 0,
          unit: form.unit.trim() || 'each',
          price: form.price.trim() ? parseFloat(form.price) : null,
          low_stock_threshold: parseInt(form.low_stock_threshold) || 5,
          notes: form.notes.trim() || null,
        }, { farmstand_id: farmstandId });
        if (ok) { showToast('Item updated'); await load(); closeModal(); onInventoryChanged?.(); }
        else showToast('Failed to update item', false);
      } else {
        const created = await createInventoryItem({
          farmstand_id: farmstandId,
          item_name: form.item_name.trim(),
          category: form.category.trim() || null,
          quantity: parseFloat(form.quantity) || 0,
          unit: form.unit.trim() || 'each',
          price: form.price.trim() ? parseFloat(form.price) : null,
          low_stock_threshold: parseInt(form.low_stock_threshold) || 5,
          notes: form.notes.trim() || null,
          is_active: true,
        });
        if (created) { showToast('Item added'); await load(); closeModal(); onInventoryChanged?.(); }
        else showToast('Failed to add item', false);
      }
    } finally {
      setSaving(false);
    }
  }, [form, editingItem, farmstandId, load, closeModal, showToast, onInventoryChanged]);

  const handleDelete = useCallback((item: InventoryItem) => {
    Alert.alert('Delete Item', `Remove "${item.item_name}" from inventory?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const ok = await deleteInventoryItem(item.id);
          if (ok) { showToast('Item deleted'); setItems((prev) => prev.filter((i) => i.id !== item.id)); onInventoryChanged?.(); }
          else showToast('Failed to delete', false);
        },
      },
    ]);
  }, [showToast, onInventoryChanged]);

  const handleAdjust = useCallback(async (item: InventoryItem, delta: number) => {
    const ok = await adjustInventoryQuantity(item.id, delta, item.quantity, farmstandId);
    if (ok) {
      setItems((prev) =>
        prev.map((i) => i.id === item.id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
      );
      onInventoryChanged?.();
    }
  }, [onInventoryChanged]);

  return (
    <View className="flex-1" style={{ backgroundColor: '#FAF7F2' }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-lg font-bold" style={{ color: '#2D5A3D' }}>
          Inventory ({items.length})
        </Text>
        <Pressable
          onPress={openAdd}
          className="flex-row items-center gap-1.5 rounded-full px-4 py-2"
          style={{ backgroundColor: '#2D5A3D' }}
        >
          <Plus size={16} color="#FAF7F2" />
          <Text className="text-sm font-semibold" style={{ color: '#FAF7F2' }}>Add Item</Text>
        </Pressable>
      </View>

      {/* Toast */}
      {toast.visible && (
        <View
          className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl px-4 py-3"
          style={{ backgroundColor: toast.success ? '#2D5A3D' : '#DC2626' }}
        >
          <Check size={16} color="white" />
          <Text className="text-sm font-medium text-white">{toast.message}</Text>
        </View>
      )}

      {loading ? <ListSkeleton /> : items.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 px-8" style={{ paddingTop: 60 }}>
          <Package size={48} color="#E8DDD4" />
          <Text className="text-base font-semibold text-center" style={{ color: '#A0A0A0' }}>No inventory yet</Text>
          <Text className="text-sm text-center" style={{ color: '#B0B0B0' }}>
            Add any item — eggs, tomatoes, flower bundles, baked goods, whatever you sell.
          </Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 10 }}>
          {items.map((item) => (
            <View
              key={item.id}
              className="bg-white rounded-2xl p-4"
              style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1 mr-2">
                  <Text className="text-base font-bold" style={{ color: '#1A1A1A' }}>{item.item_name}</Text>
                  {item.category ? (
                    <View className="mt-1 self-start rounded-full px-2 py-0.5" style={{ backgroundColor: '#F5F1EC' }}>
                      <Text className="text-xs" style={{ color: '#7A6F65' }}>{item.category}</Text>
                    </View>
                  ) : null}
                </View>
                <StockBadge item={item} />
              </View>

              <View className="flex-row items-center mt-3 gap-4">
                <View>
                  <Text className="text-xs" style={{ color: '#A0A0A0' }}>Quantity</Text>
                  <Text className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>
                    {item.quantity} {item.unit}
                  </Text>
                </View>
                {item.price != null && (
                  <View>
                    <Text className="text-xs" style={{ color: '#A0A0A0' }}>Price</Text>
                    <Text className="text-sm font-semibold" style={{ color: '#2D5A3D' }}>
                      {formatCurrency(item.price)}/{item.unit}
                    </Text>
                  </View>
                )}
              </View>

              {item.notes ? (
                <Text className="mt-2 text-xs" style={{ color: '#9A9A9A' }} numberOfLines={2}>{item.notes}</Text>
              ) : null}

              <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <View className="flex-row items-center gap-3">
                  <Pressable
                    onPress={() => handleAdjust(item, -1)}
                    className="w-8 h-8 rounded-full items-center justify-center"
                    style={{ backgroundColor: '#FEF2F2' }}
                  >
                    <Minus size={14} color="#DC2626" />
                  </Pressable>
                  <Text className="text-sm font-bold w-8 text-center" style={{ color: '#1A1A1A' }}>
                    {item.quantity}
                  </Text>
                  <Pressable
                    onPress={() => handleAdjust(item, 1)}
                    className="w-8 h-8 rounded-full items-center justify-center"
                    style={{ backgroundColor: '#F0FDF4' }}
                  >
                    <Plus size={14} color="#16a34a" />
                  </Pressable>
                </View>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => openEdit(item)}
                    className="w-8 h-8 rounded-full items-center justify-center"
                    style={{ backgroundColor: '#F5F1EC' }}
                  >
                    <Edit3 size={15} color="#5A5A5A" />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(item)}
                    className="w-8 h-8 rounded-full items-center justify-center"
                    style={{ backgroundColor: '#FEF2F2' }}
                  >
                    <Trash2 size={15} color="#DC2626" />
                  </Pressable>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Add/Edit Modal */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: '#F5F2ED' }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingVertical: 14,
              backgroundColor: '#FFFFFF',
              borderBottomWidth: 1, borderBottomColor: '#EAE4DC',
            }}
          >
            <Pressable
              onPress={closeModal}
              style={{
                width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
                borderRadius: 20, backgroundColor: '#F5F1EC',
                borderWidth: 1, borderColor: '#E5E1D8',
              }}
            >
              <X size={18} color="#5A5A5A" />
            </Pressable>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1A1A1A' }}>
              {editingItem ? 'Edit Item' : 'Add Item'}
            </Text>
            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={{
                paddingHorizontal: 20, paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: saving ? '#A0A0A0' : '#2F5D3A',
                shadowColor: saving ? 'transparent' : '#2F5D3A',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: saving ? 0 : 0.2,
                shadowRadius: 4,
                elevation: saving ? 0 : 3,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>
                {saving ? 'Saving...' : 'Save'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 14, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 52 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Item Name */}
            <View style={cardStyle}>
              <Text style={labelStyle}>Item Name *</Text>
              <ProductSearchPicker
                farmstandId={farmstandId}
                value={form.item_name}
                onChange={(v: string) => updateForm('item_name', v)}
                onSuggestionSelect={handleSuggestionSelect}
                placeholder="Search or enter item name…"
              />
            </View>

            {/* Category */}
            <View style={cardStyle}>
              <Text style={labelStyle}>Category</Text>
              <TextInput
                value={form.category}
                onChangeText={(v) => updateForm('category', v)}
                onFocus={() => setFocusedField('category')}
                onBlur={() => setFocusedField(null)}
                placeholder="Type or tap a suggestion"
                placeholderTextColor="#B8AFA7"
                style={[inputStyle, focusedField === 'category' && inputFocusStyle]}
                autoCapitalize="words"
              />
              <SuggestionChips
                suggestions={SUGGESTED_CATEGORIES}
                selected={form.category}
                onSelect={(v) => updateForm('category', v)}
              />
            </View>

            {/* Quantity + Unit */}
            <View style={cardStyle}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Quantity</Text>
                  <TextInput
                    value={form.quantity}
                    onChangeText={(v) => updateForm('quantity', v)}
                    onFocus={() => setFocusedField('quantity')}
                    onBlur={() => setFocusedField(null)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#B8AFA7"
                    style={[inputStyle, numberInputStyle, focusedField === 'quantity' && inputFocusStyle]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Unit</Text>
                  <TextInput
                    value={form.unit}
                    onChangeText={(v) => updateForm('unit', v)}
                    onFocus={() => setFocusedField('unit')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="each, lb, dozen…"
                    placeholderTextColor="#B8AFA7"
                    style={[inputStyle, focusedField === 'unit' && inputFocusStyle]}
                    autoCapitalize="none"
                  />
                </View>
              </View>
              <SuggestionChips
                suggestions={SUGGESTED_UNITS}
                selected={form.unit}
                onSelect={(v) => updateForm('unit', v)}
              />
            </View>

            {/* Price + Low Stock */}
            <View style={cardStyle}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Price (optional)</Text>
                  <View style={[moneyRowStyle, focusedField === 'price' && inputFocusStyle]}>
                    <Text style={dollarStyle}>$</Text>
                    <TextInput
                      value={form.price}
                      onChangeText={(v) => updateForm('price', v)}
                      onFocus={() => setFocusedField('price')}
                      onBlur={() => setFocusedField(null)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor="#B8AFA7"
                      style={{ flex: 1, paddingRight: 14, paddingVertical: 13, fontSize: 18, fontWeight: '600', color: '#1F1F1F' }}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Low Stock Alert</Text>
                  <TextInput
                    value={form.low_stock_threshold}
                    onChangeText={(v) => updateForm('low_stock_threshold', v)}
                    onFocus={() => setFocusedField('lowstock')}
                    onBlur={() => setFocusedField(null)}
                    keyboardType="numeric"
                    placeholder="5"
                    placeholderTextColor="#B8AFA7"
                    style={[inputStyle, numberInputStyle, focusedField === 'lowstock' && inputFocusStyle]}
                  />
                </View>
              </View>
            </View>

            {/* Notes */}
            <View style={cardStyle}>
              <Text style={labelStyle}>Notes</Text>
              <TextInput
                value={form.notes}
                onChangeText={(v) => updateForm('notes', v)}
                onFocus={() => setFocusedField('notes')}
                onBlur={() => setFocusedField(null)}
                placeholder="Optional notes…"
                placeholderTextColor="#B8AFA7"
                multiline
                numberOfLines={3}
                style={[inputStyle, focusedField === 'notes' && inputFocusStyle, { minHeight: 88, textAlignVertical: 'top' }]}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Shared style tokens ──────────────────────────────────────────────────────

const cardStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 14,
  gap: 8,
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

const labelStyle = {
  fontSize: 11,
  fontWeight: '700' as const,
  color: '#8A7E74',
  letterSpacing: 0.8,
  textTransform: 'uppercase' as const,
  marginBottom: 2,
};

const inputStyle = {
  backgroundColor: '#FAF8F4',
  borderWidth: 1.5,
  borderColor: '#D4C9C0',
  borderRadius: 14,
  paddingHorizontal: 14,
  paddingVertical: 13,
  fontSize: 15,
  color: '#1F1F1F',
  shadowColor: '#000',
  shadowOpacity: 0.03,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
} as const;

const inputFocusStyle = {
  borderColor: '#2F5D3A',
  shadowOpacity: 0.08,
  shadowRadius: 6,
} as const;

const numberInputStyle = {
  fontSize: 18,
  fontWeight: '600' as const,
  color: '#1F1F1F',
} as const;

const moneyRowStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  backgroundColor: '#FAF8F4',
  borderWidth: 1.5,
  borderColor: '#D4C9C0',
  borderRadius: 14,
  shadowColor: '#000',
  shadowOpacity: 0.03,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
} as const;

const dollarStyle = {
  fontSize: 18,
  fontWeight: '700' as const,
  color: '#8A7E74',
  paddingLeft: 14,
  paddingRight: 4,
} as const;
