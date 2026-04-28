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
import { Plus, ShoppingCart, Edit3, Trash2, X, Check, Package } from 'lucide-react-native';
import type { Sale, PaymentMethod, DateRange, InventoryItem } from '@/lib/manager-types';
import type { SaleInsert } from '@/lib/manager-types';
import {
  fetchSales,
  createSale,
  updateSale,
  deleteSale,
  fetchInventory,
  formatCurrency,
  formatRelativeDate,
} from '@/lib/manager-service';
import { ListSkeleton } from './ManagerShimmer';
import { ProductSearchPicker } from './ProductSearchPicker';
import type { ProductSuggestion } from './ProductSearchPicker';

interface SalesTabProps {
  farmstandId: string;
  dateRange: DateRange;
  onSaleAdded?: () => void;
  onSaleChanged?: () => void;
}

type PaymentOption = { value: PaymentMethod; label: string };

const PAYMENT_OPTIONS: PaymentOption[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'other', label: 'Other' },
];

// Suggested only — users can always type anything custom
const SUGGESTED_CATEGORIES = [
  'Vegetables', 'Fruit', 'Eggs', 'Honey', 'Flowers',
  'Herbs', 'Baked Goods', 'Meat', 'Dairy', 'Plants',
  'Preserves', 'Bundles', 'Seeds', 'Other',
];

const SUGGESTED_UNITS = [
  'each', 'dozen', 'lb', 'oz', 'bunch', 'pint',
  'quart', 'bag', 'box', 'flat', 'jar', 'bundle',
];

interface SaleFormState {
  // source: 'custom' = free-form entry, 'inventory' = linked to an inventory item
  source: 'custom' | 'inventory';
  item_name_snapshot: string;
  category: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total_amount: string;
  payment_method: PaymentMethod;
  notes: string;
  deduct_from_inventory: boolean;
  selected_inventory_id: string;
}

const emptySaleForm: SaleFormState = {
  source: 'custom',
  item_name_snapshot: '',
  category: '',
  quantity: '',
  unit: '',
  unit_price: '',
  total_amount: '',
  payment_method: 'cash',
  notes: '',
  deduct_from_inventory: false,
  selected_inventory_id: '',
};

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

function paymentBadgeStyle(method: PaymentMethod): { bg: string; color: string } {
  switch (method) {
    case 'cash': return { bg: '#F0FDF4', color: '#16a34a' };
    case 'card': return { bg: '#EFF6FF', color: '#2563EB' };
    case 'venmo': return { bg: '#F3F4FF', color: '#4F46E5' };
    default: return { bg: '#F5F1EC', color: '#7A6F65' };
  }
}

interface ToastState {
  visible: boolean;
  message: string;
  success: boolean;
}

export function SalesTab({ farmstandId, dateRange, onSaleAdded, onSaleChanged }: SalesTabProps) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [form, setForm] = useState<SaleFormState>(emptySaleForm);
  const [saving, setSaving] = useState<boolean>(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: '', success: true });
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const showToast = useCallback((message: string, success = true) => {
    setToast({ visible: true, message, success });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchSales(farmstandId, dateRange);
    setSales(data);
    setLoading(false);
  }, [farmstandId, dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = useCallback(async () => {
    setEditingSale(null);
    setForm(emptySaleForm);
    setModalVisible(true);
    const inv = await fetchInventory(farmstandId);
    setInventoryItems(inv);
  }, [farmstandId]);

  const openEdit = useCallback(async (sale: Sale) => {
    setEditingSale(sale);
    setForm({
      source: sale.inventory_item_id ? 'inventory' : 'custom',
      item_name_snapshot: sale.item_name_snapshot,
      category: sale.category ?? '',
      quantity: sale.quantity != null ? String(sale.quantity) : '',
      unit: sale.unit ?? '',
      unit_price: sale.unit_price != null ? String(sale.unit_price) : '',
      total_amount: String(sale.total_amount),
      payment_method: sale.payment_method,
      notes: sale.notes ?? '',
      deduct_from_inventory: false,
      selected_inventory_id: sale.inventory_item_id ?? '',
    });
    setModalVisible(true);
    const inv = await fetchInventory(farmstandId);
    setInventoryItems(inv);
  }, [farmstandId]);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingSale(null);
    setForm(emptySaleForm);
  }, []);

  const updateForm = useCallback(<K extends keyof SaleFormState>(field: K, value: SaleFormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-calculate total if qty and unit_price are both set
      if (field === 'quantity' || field === 'unit_price') {
        const qty = parseFloat(field === 'quantity' ? (value as string) : prev.quantity);
        const price = parseFloat(field === 'unit_price' ? (value as string) : prev.unit_price);
        if (!isNaN(qty) && !isNaN(price)) {
          next.total_amount = (qty * price).toFixed(2);
        }
      }
      return next;
    });
  }, []);

  const selectInventoryItem = useCallback((item: InventoryItem) => {
    setForm((prev) => ({
      ...prev,
      selected_inventory_id: item.id,
      item_name_snapshot: item.item_name,
      unit: item.unit,
      unit_price: item.price != null ? String(item.price) : prev.unit_price,
    }));
  }, []);

  // Auto-fill from inventory when an item is selected in the picker.
  // Background-matches the product name against loaded inventory items for deduction linking.
  const handleProductSelect = useCallback((suggestion: ProductSuggestion) => {
    console.log('[SalesTab] product selected:', suggestion.name, '| category:', suggestion.category, '| unit:', suggestion.unit);
    const matchingInv = inventoryItems.find(
      (inv) => inv.item_name.toLowerCase().trim() === suggestion.name.toLowerCase().trim() && inv.is_active
    );
    setForm((prev) => {
      const next = {
        ...prev,
        selected_inventory_id: matchingInv?.id ?? prev.selected_inventory_id,
        item_name_snapshot: suggestion.name,
        unit: suggestion.unit ?? prev.unit,
        unit_price: suggestion.unit_price != null ? String(suggestion.unit_price) : prev.unit_price,
        category: suggestion.category ?? prev.category,
      };
      console.log('[SalesTab] form.item_name_snapshot after set:', next.item_name_snapshot);
      return next;
    });
  }, [inventoryItems]);

  const handleSave = useCallback(async () => {
    if (!form.item_name_snapshot.trim()) {
      showToast('Item name is required', false);
      return;
    }
    const total = parseFloat(form.total_amount);
    if (isNaN(total) || total <= 0) {
      showToast('Total amount is required', false);
      return;
    }
    setSaving(true);
    try {
      if (editingSale) {
        const ok = await updateSale(editingSale.id, {
          item_name_snapshot: form.item_name_snapshot.trim(),
          category: form.category.trim() || null,
          quantity: form.quantity ? parseFloat(form.quantity) : null,
          unit: form.unit.trim() || null,
          unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
          total_amount: total,
          payment_method: form.payment_method,
          notes: form.notes.trim() || null,
        });
        if (ok) {
          showToast('Sale updated');
          await load();
          closeModal();
          onSaleChanged?.();
        } else {
          showToast('Failed to update sale', false);
        }
      } else {
        const saleInsert: SaleInsert = {
          farmstand_id: farmstandId,
          inventory_item_id: form.deduct_from_inventory && form.selected_inventory_id
            ? form.selected_inventory_id
            : null,
          item_name_snapshot: form.item_name_snapshot.trim(),
          category: form.category.trim() || null,
          quantity: form.quantity ? parseFloat(form.quantity) : null,
          unit: form.unit.trim() || null,
          unit_price: form.unit_price ? parseFloat(form.unit_price) : null,
          total_amount: total,
          payment_method: form.payment_method,
          sold_at: new Date().toISOString(),
          notes: form.notes.trim() || null,
        };
        const result = await createSale(saleInsert);
        if (result.sale) {
          showToast('Sale recorded');
          await load();
          closeModal();
          onSaleAdded?.();
          onSaleChanged?.();
        } else {
          const e = result.errorInfo;
          if (e) {
            const body =
              `Message: ${e.message}\n` +
              `Code: ${e.code ?? 'n/a'}\n` +
              `Details: ${e.details ?? 'n/a'}\n` +
              `Hint: ${e.hint ?? 'n/a'}\n` +
              `Status: ${e.status ?? 'n/a'}`;
            Alert.alert('Record Sale Failed', body);
          } else {
            showToast('Failed to record sale', false);
          }
        }
      }
    } finally {
      setSaving(false);
    }
  }, [form, editingSale, farmstandId, load, closeModal, onSaleAdded, onSaleChanged, showToast]);

  const handleDelete = useCallback((sale: Sale) => {
    Alert.alert(
      'Delete Sale',
      `Delete this sale of "${sale.item_name_snapshot}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const ok = await deleteSale(sale.id);
            if (ok) {
              showToast('Sale deleted');
              setSales((prev) => prev.filter((s) => s.id !== sale.id));
              onSaleChanged?.();
            } else {
              showToast('Failed to delete', false);
            }
          },
        },
      ]
    );
  }, [showToast, onSaleChanged]);

  const todayTotal = sales.reduce((sum, s) => {
    const today = new Date();
    const saleDate = new Date(s.sold_at);
    if (
      saleDate.getDate() === today.getDate() &&
      saleDate.getMonth() === today.getMonth() &&
      saleDate.getFullYear() === today.getFullYear()
    ) {
      return sum + s.total_amount;
    }
    return sum;
  }, 0);

  const periodTotal = sales.reduce((sum, s) => sum + s.total_amount, 0);

  return (
    <View className="flex-1" style={{ backgroundColor: '#FAF7F2' }}>
      {/* Totals header */}
      <View className="flex-row gap-3 px-4 pt-4 pb-2">
        <View
          className="flex-1 rounded-xl bg-white p-3"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 4,
            elevation: 2,
          }}
        >
          <Text className="text-xs" style={{ color: '#A0A0A0' }}>Today</Text>
          <Text className="text-base font-bold" style={{ color: '#16a34a' }}>
            {formatCurrency(todayTotal)}
          </Text>
        </View>
        <View
          className="flex-1 rounded-xl bg-white p-3"
          style={{
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 4,
            elevation: 2,
          }}
        >
          <Text className="text-xs" style={{ color: '#A0A0A0' }}>Period Total</Text>
          <Text className="text-base font-bold" style={{ color: '#2D5A3D' }}>
            {formatCurrency(periodTotal)}
          </Text>
        </View>
        <Pressable
          onPress={openAdd}
          className="rounded-xl px-4 items-center justify-center"
          style={{ backgroundColor: '#2D5A3D' }}
        >
          <Plus size={20} color="#FAF7F2" />
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

      {/* Content */}
      {loading ? (
        <ListSkeleton />
      ) : sales.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <ShoppingCart size={48} color="#E8DDD4" />
          <Text className="text-base font-semibold" style={{ color: '#A0A0A0' }}>
            No sales recorded yet
          </Text>
          <Text className="text-sm text-center" style={{ color: '#B0B0B0' }}>
            Tap the + button to record your first sale
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 10 }}
        >
          {sales.map((sale) => {
            const badge = paymentBadgeStyle(sale.payment_method);
            return (
              <View
                key={sale.id}
                className="bg-white rounded-2xl p-4"
                style={{
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.06,
                  shadowRadius: 8,
                  elevation: 3,
                }}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 mr-2">
                    <Text className="text-base font-bold" style={{ color: '#1A1A1A' }}>
                      {sale.item_name_snapshot}
                    </Text>
                    {sale.quantity != null && (
                      <Text className="text-sm mt-0.5" style={{ color: '#7A6F65' }}>
                        {sale.quantity} {sale.unit ?? ''}
                      </Text>
                    )}
                  </View>
                  <Text className="text-lg font-bold" style={{ color: '#2D5A3D' }}>
                    {formatCurrency(sale.total_amount)}
                  </Text>
                </View>

                <View className="flex-row items-center justify-between mt-3">
                  <View className="flex-row items-center gap-2">
                    <View
                      className="rounded-full px-2 py-0.5"
                      style={{ backgroundColor: badge.bg }}
                    >
                      <Text className="text-xs font-semibold capitalize" style={{ color: badge.color }}>
                        {sale.payment_method}
                      </Text>
                    </View>
                    <Text className="text-xs" style={{ color: '#A0A0A0' }}>
                      {formatRelativeDate(sale.sold_at)}
                    </Text>
                  </View>
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => openEdit(sale)}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#F5F1EC' }}
                    >
                      <Edit3 size={13} color="#5A5A5A" />
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(sale)}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#FEF2F2' }}
                    >
                      <Trash2 size={13} color="#DC2626" />
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
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
              {editingSale ? 'Edit Sale' : 'Record Sale'}
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
            {/* Deduct from inventory toggle */}
            {!editingSale && (
              <View style={[saleCardStyle, { gap: 12 }]}>
                <Pressable
                  onPress={() => updateForm('deduct_from_inventory', !form.deduct_from_inventory)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <View>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#1A1A1A' }}>
                      Deduct from Inventory
                    </Text>
                    <Text style={{ fontSize: 12, marginTop: 2, color: '#A0A0A0' }}>
                      Link this sale to an inventory item
                    </Text>
                  </View>
                  <View
                    style={{
                      width: 48, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: form.deduct_from_inventory ? '#2F5D3A' : '#E8DDD4',
                    }}
                  >
                    <View
                      style={{
                        width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF',
                        transform: [{ translateX: form.deduct_from_inventory ? 10 : -10 }],
                        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.2, shadowRadius: 2, elevation: 2,
                      }}
                    />
                  </View>
                </Pressable>

                {form.deduct_from_inventory && inventoryItems.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={{ gap: 8, paddingRight: 8 }}
                  >
                    {inventoryItems.map((inv) => (
                      <AnimatedChip
                        key={inv.id}
                        label={inv.item_name}
                        active={form.selected_inventory_id === inv.id}
                        onPress={() => selectInventoryItem(inv)}
                      />
                    ))}
                  </ScrollView>
                )}
              </View>
            )}

            {/* Item Name */}
            <View style={saleCardStyle}>
              <Text style={saleLabelStyle}>Item Name *</Text>
              <ProductSearchPicker
                farmstandId={farmstandId}
                value={form.item_name_snapshot}
                onChange={(v: string) => updateForm('item_name_snapshot', v)}
                onSuggestionSelect={handleProductSelect}
                placeholder="Search or enter item name…"
              />
            </View>

            {/* Category */}
            <View style={saleCardStyle}>
              <Text style={saleLabelStyle}>Category</Text>
              <TextInput
                value={form.category}
                onChangeText={(v) => updateForm('category', v)}
                onFocus={() => setFocusedField('category')}
                onBlur={() => setFocusedField(null)}
                placeholder="Type or tap a suggestion"
                placeholderTextColor="#B8AFA7"
                style={[saleInputStyle, focusedField === 'category' && saleInputFocusStyle]}
                autoCapitalize="words"
              />
              <SuggestionChips
                suggestions={SUGGESTED_CATEGORIES}
                selected={form.category}
                onSelect={(v) => updateForm('category', v)}
              />
            </View>

            {/* Qty + Unit */}
            <View style={saleCardStyle}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={saleLabelStyle}>Quantity</Text>
                  <TextInput
                    value={form.quantity}
                    onChangeText={(v) => updateForm('quantity', v)}
                    onFocus={() => setFocusedField('quantity')}
                    onBlur={() => setFocusedField(null)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor="#B8AFA7"
                    style={[saleInputStyle, saleNumberStyle, focusedField === 'quantity' && saleInputFocusStyle]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={saleLabelStyle}>Unit</Text>
                  <TextInput
                    value={form.unit}
                    onChangeText={(v) => updateForm('unit', v)}
                    onFocus={() => setFocusedField('unit')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="each, lb, dozen…"
                    placeholderTextColor="#B8AFA7"
                    style={[saleInputStyle, focusedField === 'unit' && saleInputFocusStyle]}
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

            {/* Unit Price + Total */}
            <View style={saleCardStyle}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={saleLabelStyle}>Unit Price</Text>
                  <View style={[saleMoneyRowStyle, focusedField === 'unit_price' && saleInputFocusStyle]}>
                    <Text style={saleDollarStyle}>$</Text>
                    <TextInput
                      value={form.unit_price}
                      onChangeText={(v) => updateForm('unit_price', v)}
                      onFocus={() => setFocusedField('unit_price')}
                      onBlur={() => setFocusedField(null)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor="#B8AFA7"
                      style={{ flex: 1, paddingRight: 12, paddingVertical: 13, fontSize: 18, fontWeight: '600', color: '#1F1F1F' }}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={saleLabelStyle}>Total Amount *</Text>
                  <View style={[saleMoneyRowStyle, focusedField === 'total' && saleInputFocusStyle]}>
                    <Text style={saleDollarStyle}>$</Text>
                    <TextInput
                      value={form.total_amount}
                      onChangeText={(v) => updateForm('total_amount', v)}
                      onFocus={() => setFocusedField('total')}
                      onBlur={() => setFocusedField(null)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor="#B8AFA7"
                      style={{ flex: 1, paddingRight: 12, paddingVertical: 13, fontSize: 18, fontWeight: '600', color: '#1F1F1F' }}
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* Payment Method */}
            <View style={saleCardStyle}>
              <Text style={saleLabelStyle}>Payment Method</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {PAYMENT_OPTIONS.map((opt) => (
                  <AnimatedChip
                    key={opt.value}
                    label={opt.label}
                    active={form.payment_method === opt.value}
                    onPress={() => updateForm('payment_method', opt.value)}
                  />
                ))}
              </View>
            </View>

            {/* Date row */}
            <View
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: '#F1EEE8',
                borderRadius: 12,
                paddingVertical: 10, paddingHorizontal: 12,
                borderWidth: 1, borderColor: '#E0DBD2',
              }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#8A7E74' }} />
              <Text style={{ fontSize: 14, fontWeight: '500', color: '#6A5E54' }}>
                Date: Today ({new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})
              </Text>
            </View>

            {/* Notes */}
            <View style={saleCardStyle}>
              <Text style={saleLabelStyle}>Notes</Text>
              <TextInput
                value={form.notes}
                onChangeText={(v) => updateForm('notes', v)}
                onFocus={() => setFocusedField('notes')}
                onBlur={() => setFocusedField(null)}
                placeholder="Optional notes..."
                placeholderTextColor="#B8AFA7"
                multiline
                numberOfLines={3}
                style={[saleInputStyle, focusedField === 'notes' && saleInputFocusStyle, { minHeight: 88, textAlignVertical: 'top' }]}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Shared style tokens ──────────────────────────────────────────────────────

const saleCardStyle = {
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

const saleLabelStyle = {
  fontSize: 11,
  fontWeight: '700' as const,
  color: '#8A7E74',
  letterSpacing: 0.8,
  textTransform: 'uppercase' as const,
  marginBottom: 2,
};

const saleInputStyle = {
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

const saleInputFocusStyle = {
  borderColor: '#2F5D3A',
  shadowOpacity: 0.08,
  shadowRadius: 6,
} as const;

const saleNumberStyle = {
  fontSize: 18,
  fontWeight: '600' as const,
  color: '#1F1F1F',
} as const;

const saleMoneyRowStyle = {
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

const saleDollarStyle = {
  fontSize: 18,
  fontWeight: '700' as const,
  color: '#8A7E74',
  paddingLeft: 14,
  paddingRight: 4,
} as const;
