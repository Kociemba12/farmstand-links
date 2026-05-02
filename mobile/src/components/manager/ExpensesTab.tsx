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
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Plus, Receipt, Edit3, Trash2, X, Check, Calendar } from 'lucide-react-native';
import type { Expense, DateRange } from '@/lib/manager-types';
import type { ExpenseInsert } from '@/lib/manager-types';
import { EXPENSE_CATEGORIES } from '@/lib/manager-types';
import {
  fetchExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  formatCurrency,
  formatRelativeDate,
} from '@/lib/manager-service';
import { ListSkeleton } from './ManagerShimmer';

interface ExpensesTabProps {
  farmstandId: string;
  dateRange: DateRange;
  onExpenseAdded?: () => void;
  onExpenseChanged?: () => void;
}

// Form uses plain string for category — no rigid enum, user can type anything
interface ExpenseFormState {
  category: string;
  vendor: string;
  amount: string;
  notes: string;
}

const emptyExpenseForm: ExpenseFormState = {
  category: '',
  vendor: '',
  amount: '',
  notes: '',
};

// Suggested quick-pick categories (just the labels, always overridable by typing)
const SUGGESTED_EXPENSE_CATEGORIES = [
  'Feed', 'Seed & Plants', 'Packaging', 'Supplies', 'Labor',
  'Fees & Licenses', 'Utilities', 'Equipment', 'Repairs',
  'Fuel', 'Irrigation', 'Marketing', 'Other',
];

function categoryBadgeColor(category: string): { bg: string; color: string } {
  const lower = category.toLowerCase();
  if (lower.includes('feed'))        return { bg: '#FFF7ED', color: '#EA580C' };
  if (lower.includes('seed') || lower.includes('plant')) return { bg: '#F0FDF4', color: '#16a34a' };
  if (lower.includes('pack'))        return { bg: '#EFF6FF', color: '#2563EB' };
  if (lower.includes('suppl'))       return { bg: '#F5F3FF', color: '#7C3AED' };
  if (lower.includes('labor'))       return { bg: '#FEF9C3', color: '#CA8A04' };
  if (lower.includes('fee') || lower.includes('licens')) return { bg: '#FEF2F2', color: '#DC2626' };
  if (lower.includes('util'))        return { bg: '#F0F9FF', color: '#0284C7' };
  if (lower.includes('equip'))       return { bg: '#FDF4FF', color: '#9333EA' };
  if (lower.includes('repair'))      return { bg: '#FFF7ED', color: '#C2410C' };
  if (lower.includes('fuel'))        return { bg: '#FFFBEB', color: '#B45309' };
  if (lower.includes('market'))      return { bg: '#FDF2F8', color: '#DB2777' };
  return                               { bg: '#F5F1EC', color: '#7A6F65' };
}

interface ToastState { visible: boolean; message: string; success: boolean; }

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

const isToday = (date: Date): boolean => {
  const t = new Date();
  return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear();
};

export function ExpensesTab({ farmstandId, dateRange, onExpenseAdded, onExpenseChanged }: ExpensesTabProps) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [modalVisible, setModalVisible] = useState<boolean>(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseFormState>(emptyExpenseForm);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: '', success: true });
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const showToast = useCallback((message: string, success = true) => {
    setToast({ visible: true, message, success });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchExpenses(farmstandId, dateRange);
    setExpenses(data);
    setLoading(false);
  }, [farmstandId, dateRange]);

  useEffect(() => { load(); }, [load]);

  const openAdd = useCallback(() => {
    setEditingExpense(null);
    setForm(emptyExpenseForm);
    setSelectedDate(new Date());
    setShowDatePicker(false);
    setModalVisible(true);
  }, []);

  const openEdit = useCallback((expense: Expense) => {
    setEditingExpense(expense);
    const catLabel = EXPENSE_CATEGORIES.find((c) => c.value === expense.category)?.label ?? expense.category;
    setForm({
      category: catLabel,
      vendor: expense.vendor ?? '',
      amount: String(expense.amount),
      notes: expense.notes ?? '',
    });
    setSelectedDate(new Date(expense.spent_at));
    setShowDatePicker(false);
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingExpense(null);
    setForm(emptyExpenseForm);
    setSelectedDate(new Date());
    setShowDatePicker(false);
  }, []);

  const updateForm = useCallback(<K extends keyof ExpenseFormState>(field: K, value: ExpenseFormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Normalize category: if the user typed a label that matches a preset, store as the preset value.
  // Otherwise store the raw typed string so nothing is ever lost.
  const normalizeCategory = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return 'other';
    const match = EXPENSE_CATEGORIES.find(
      (c) => c.label.toLowerCase() === trimmed.toLowerCase() || c.value === trimmed.toLowerCase()
    );
    return match ? match.value : trimmed;
  };

  const handleSave = useCallback(async () => {
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      showToast('Amount is required', false);
      return;
    }
    const category = normalizeCategory(form.category);
    setSaving(true);
    try {
      if (editingExpense) {
        const ok = await updateExpense(editingExpense.id, {
          // Cast to Expense['category'] — the DB column is TEXT so any string is accepted
          category: category as Expense['category'],
          vendor: form.vendor.trim() || null,
          amount,
          spent_at: selectedDate.toISOString(),
          notes: form.notes.trim() || null,
        });
        if (ok) { showToast('Expense updated'); await load(); closeModal(); onExpenseChanged?.(); }
        else showToast('Failed to update expense', false);
      } else {
        const insert: ExpenseInsert = {
          farmstand_id: farmstandId,
          category: category as Expense['category'],
          vendor: form.vendor.trim() || null,
          amount,
          spent_at: selectedDate.toISOString(),
          notes: form.notes.trim() || null,
        };
        const created = await createExpense(insert);
        if (created) {
          showToast('Expense recorded');
          await load();
          closeModal();
          onExpenseAdded?.();
          onExpenseChanged?.();
        } else {
          showToast('Failed to record expense', false);
        }
      }
    } finally {
      setSaving(false);
    }
  }, [form, editingExpense, farmstandId, load, closeModal, onExpenseAdded, onExpenseChanged, showToast]);

  const handleDelete = useCallback((expense: Expense) => {
    const catLabel = EXPENSE_CATEGORIES.find((c) => c.value === expense.category)?.label ?? expense.category;
    Alert.alert('Delete Expense', `Delete this ${catLabel} expense of ${formatCurrency(expense.amount)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const ok = await deleteExpense(expense.id);
          if (ok) { showToast('Expense deleted'); setExpenses((prev) => prev.filter((e) => e.id !== expense.id)); onExpenseChanged?.(); }
          else showToast('Failed to delete', false);
        },
      },
    ]);
  }, [showToast, onExpenseChanged]);

  const periodTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <View className="flex-1" style={{ backgroundColor: '#FAF7F2' }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <View>
          <Text className="text-xs" style={{ color: '#A0A0A0' }}>Period Total</Text>
          <Text className="text-xl font-bold" style={{ color: '#DC2626' }}>{formatCurrency(periodTotal)}</Text>
        </View>
        <Pressable
          onPress={openAdd}
          className="flex-row items-center gap-1.5 rounded-full px-4 py-2"
          style={{ backgroundColor: '#2D5A3D' }}
        >
          <Plus size={16} color="#FAF7F2" />
          <Text className="text-sm font-semibold" style={{ color: '#FAF7F2' }}>Add Expense</Text>
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
      {loading ? <ListSkeleton /> : expenses.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3 px-8" style={{ paddingTop: 60 }}>
          <Receipt size={48} color="#E8DDD4" />
          <Text className="text-base font-semibold" style={{ color: '#A0A0A0' }}>No expenses yet</Text>
          <Text className="text-sm text-center" style={{ color: '#B0B0B0' }}>
            Track any farm cost — feed, fuel, market fees, repairs, anything you spend.
          </Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 10 }}>
          {expenses.map((expense) => {
            const catLabel = EXPENSE_CATEGORIES.find((c) => c.value === expense.category)?.label ?? expense.category;
            const colors = categoryBadgeColor(expense.category);
            return (
              <View
                key={expense.id}
                className="bg-white rounded-2xl p-4"
                style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 mr-2">
                    <View className="rounded-full self-start px-2 py-0.5" style={{ backgroundColor: colors.bg }}>
                      <Text className="text-xs font-semibold" style={{ color: colors.color }}>{catLabel}</Text>
                    </View>
                    {expense.vendor ? (
                      <Text className="text-sm mt-1 font-medium" style={{ color: '#5A5A5A' }}>{expense.vendor}</Text>
                    ) : null}
                    {expense.notes ? (
                      <Text className="text-xs mt-1" style={{ color: '#9A9A9A' }} numberOfLines={2}>{expense.notes}</Text>
                    ) : null}
                  </View>
                  <Text className="text-lg font-bold" style={{ color: '#DC2626' }}>{formatCurrency(expense.amount)}</Text>
                </View>
                <View className="flex-row items-center justify-between mt-3">
                  <Text className="text-xs" style={{ color: '#A0A0A0' }}>{formatRelativeDate(expense.spent_at)}</Text>
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={() => openEdit(expense)}
                      className="w-7 h-7 rounded-full items-center justify-center"
                      style={{ backgroundColor: '#F5F1EC' }}
                    >
                      <Edit3 size={13} color="#5A5A5A" />
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(expense)}
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
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
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
              {editingExpense ? 'Edit Expense' : 'Add Expense'}
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
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 14, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 52 }}
          >
            {/* Category */}
            <View style={expCardStyle}>
              <Text style={expLabelStyle}>Category</Text>
              <TextInput
                value={form.category}
                onChangeText={(v) => updateForm('category', v)}
                onFocus={() => setFocusedField('category')}
                onBlur={() => setFocusedField(null)}
                placeholder="Type anything — Feed, Repairs, Market Fees…"
                placeholderTextColor="#B8AFA7"
                style={[expInputStyle, focusedField === 'category' && expInputFocusStyle]}
                autoCapitalize="words"
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0, marginTop: 4 }}
                contentContainerStyle={{ gap: 8, paddingRight: 8 }}
              >
                {SUGGESTED_EXPENSE_CATEGORIES.map((label) => {
                  const active = form.category.trim().toLowerCase() === label.toLowerCase();
                  return (
                    <AnimatedChip
                      key={label}
                      label={label}
                      active={active}
                      onPress={() => updateForm('category', active ? '' : label)}
                    />
                  );
                })}
              </ScrollView>
            </View>

            {/* Amount */}
            <View style={expCardStyle}>
              <Text style={expLabelStyle}>Amount *</Text>
              <View style={[expMoneyRowStyle, focusedField === 'amount' && expInputFocusStyle]}>
                <Text style={expDollarStyle}>$</Text>
                <TextInput
                  value={form.amount}
                  onChangeText={(v) => updateForm('amount', v)}
                  onFocus={() => setFocusedField('amount')}
                  onBlur={() => setFocusedField(null)}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#B8AFA7"
                  style={{ flex: 1, paddingRight: 14, paddingVertical: 13, fontSize: 18, fontWeight: '600', color: '#1F1F1F' }}
                />
              </View>
            </View>

            {/* Vendor */}
            <View style={expCardStyle}>
              <Text style={expLabelStyle}>Vendor / Source (optional)</Text>
              <TextInput
                value={form.vendor}
                onChangeText={(v) => updateForm('vendor', v)}
                onFocus={() => setFocusedField('vendor')}
                onBlur={() => setFocusedField(null)}
                placeholder="e.g. Farm Supply Co., local co-op, online…"
                placeholderTextColor="#B8AFA7"
                style={[expInputStyle, focusedField === 'vendor' && expInputFocusStyle]}
              />
            </View>

            {/* Date row */}
            <View>
              <Pressable
                onPress={() => setShowDatePicker((v) => !v)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  backgroundColor: showDatePicker ? '#E8F0E9' : '#F1EEE8',
                  borderRadius: 12,
                  paddingVertical: 10, paddingHorizontal: 12,
                  borderWidth: 1, borderColor: showDatePicker ? '#2F5D3A' : '#E0DBD2',
                }}
              >
                <Calendar size={14} color="#8A7E74" />
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#6A5E54', flex: 1 }}>
                  {isToday(selectedDate)
                    ? `Today · ${selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
                    : selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#2F5D3A' }}>
                  {showDatePicker ? 'Done' : 'Change'}
                </Text>
              </Pressable>
              {showDatePicker && (
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display="spinner"
                  maximumDate={new Date()}
                  onChange={(_: DateTimePickerEvent, date?: Date) => { if (date) setSelectedDate(date); }}
                  style={{ backgroundColor: '#FFFFFF', borderRadius: 12, marginTop: 4 }}
                />
              )}
            </View>

            {/* Notes */}
            <View style={expCardStyle}>
              <Text style={expLabelStyle}>Notes</Text>
              <TextInput
                value={form.notes}
                onChangeText={(v) => updateForm('notes', v)}
                onFocus={() => setFocusedField('notes')}
                onBlur={() => setFocusedField(null)}
                placeholder="Optional notes…"
                placeholderTextColor="#B8AFA7"
                multiline
                numberOfLines={3}
                style={[expInputStyle, focusedField === 'notes' && expInputFocusStyle, { minHeight: 88, textAlignVertical: 'top' }]}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Shared style tokens ──────────────────────────────────────────────────────

const expCardStyle = {
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

const expLabelStyle = {
  fontSize: 11,
  fontWeight: '700' as const,
  color: '#8A7E74',
  letterSpacing: 0.8,
  textTransform: 'uppercase' as const,
  marginBottom: 2,
};

const expInputStyle = {
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

const expInputFocusStyle = {
  borderColor: '#2F5D3A',
  shadowOpacity: 0.08,
  shadowRadius: 6,
} as const;

const expMoneyRowStyle = {
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

const expDollarStyle = {
  fontSize: 18,
  fontWeight: '700' as const,
  color: '#8A7E74',
  paddingLeft: 14,
  paddingRight: 4,
} as const;
