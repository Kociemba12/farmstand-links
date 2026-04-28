/**
 * Farmstand Manager Service
 * Isolated Supabase queries for the Farmstand Manager module.
 * DO NOT use these functions in existing claim/approval/listing/messaging flows.
 */

import { supabase } from './supabase';
import type { SupabaseError } from './supabase';
import { notifyStandUpdate } from './stand-update-notifier';
import {
  InventoryItem,
  InventoryItemInsert,
  InventoryItemUpdate,
  Sale,
  SaleInsert,
  SaleUpdate,
  Expense,
  ExpenseCategory,
  ExpenseInsert,
  ExpenseUpdate,
  ManagerSummary,
  TopSellingItem,
  ExpenseBreakdown,
  RecentActivity,
  FarmstandReportData,
  DateRange,
  DateRangePreset,
  getDateRangeForPreset,
  EXPENSE_CATEGORIES,
  DATE_RANGE_LABELS,
} from './manager-types';

// ============================================================
// INVENTORY
// ============================================================

export async function fetchInventory(farmstandId: string): Promise<InventoryItem[]> {
  try {
    const { data, error } = await supabase
      .from<Record<string, unknown>>('farmstand_inventory')
      .select('*')
      .eq('farmstand_id', farmstandId)
      .eq('is_active', true)
      .order('item_name', { ascending: true })
      .requireAuth()
      .execute();

    if (error) {
      console.log('[Manager] fetchInventory error:', error);
      return [];
    }
    return (data ?? []).map(mapInventoryItem);
  } catch (err) {
    console.log('[Manager] fetchInventory exception:', err);
    return [];
  }
}

export async function createInventoryItem(item: InventoryItemInsert): Promise<InventoryItem | null> {
  try {
    const now = new Date().toISOString();
    const insertPayload = {
      farmstand_id: item.farmstand_id,
      item_name: item.item_name,
      category: item.category ?? null,
      quantity: item.quantity,
      unit: item.unit ?? 'each',
      price: item.price ?? null,
      low_stock_threshold: item.low_stock_threshold ?? 5,
      notes: item.notes ?? null,
      is_active: true,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from<Record<string, unknown>>('farmstand_inventory')
      .insert(insertPayload)
      .execute();

    if (error) {
      const e = error as SupabaseError;
      console.log('[Manager] createInventoryItem FAILED:', JSON.stringify({
        farmstand_id: item.farmstand_id,
        message: e.message,
        code: e.code ?? null,
        details: e.details ?? null,
        hint: e.hint ?? null,
        status: e.status ?? null,
      }));
      return null;
    }
    const rows = data as unknown[];
    // Supabase REST may return [] on success when RLS prevents read-back
    if (!rows || rows.length === 0) {
      console.log('[Manager] createInventoryItem: insert succeeded but no row returned — reconstructing from payload');
      const result: InventoryItem = {
        id: '',
        farmstand_id: item.farmstand_id,
        item_name: item.item_name,
        category: item.category ?? null,
        quantity: item.quantity,
        unit: item.unit ?? 'each',
        price: item.price ?? null,
        low_stock_threshold: item.low_stock_threshold ?? 5,
        notes: item.notes ?? null,
        is_active: true,
        created_at: now,
        updated_at: now,
      };
      // Notify followers — fire-and-forget
      notifyStandUpdate(item.farmstand_id, item.quantity > 0);
      return result;
    }
    const created = mapInventoryItem(rows[0] as Record<string, unknown>);
    // Notify followers — fire-and-forget
    notifyStandUpdate(item.farmstand_id, item.quantity > 0);
    return created;
  } catch (err) {
    console.log('[Manager] createInventoryItem exception:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export interface UpdateInventoryOptions {
  /** Pre-resolved farmstand_id — skips the DB lookup when already known. */
  farmstand_id?: string;
  /**
   * Set true for silent system updates (e.g. automatic sale deductions)
   * that should NOT trigger follower notifications.
   */
  silent?: boolean;
}

export async function updateInventoryItem(
  id: string,
  updates: InventoryItemUpdate,
  options?: UpdateInventoryOptions
): Promise<boolean> {
  try {
    const now = new Date().toISOString();

    // ── Fetch current item if we need to detect a stock transition ────────
    // We only need the pre-update state when quantity is changing and
    // notifications are not suppressed.
    let prevItem: InventoryItem | null = null;
    if (!options?.silent && typeof updates.quantity === 'number') {
      const { data: prevRows, error: fetchErr } = await supabase
        .from<Record<string, unknown>>('farmstand_inventory')
        .select('*')
        .eq('id', id)
        .execute();
      if (!fetchErr && prevRows && prevRows.length > 0) {
        prevItem = mapInventoryItemLocal(prevRows[0] as Record<string, unknown>);
      }
    }

    // ── Apply the update ──────────────────────────────────────────────────
    const { error } = await supabase
      .from<Record<string, unknown>>('farmstand_inventory')
      .update({ ...updates, updated_at: now })
      .eq('id', id)
      .execute();

    if (error) {
      console.log('[Manager] updateInventoryItem error:', error);
      return false;
    }

    // ── Notify followers on real stock transitions ────────────────────────
    if (!options?.silent && typeof updates.quantity === 'number') {
      const standId = options?.farmstand_id ?? prevItem?.farmstand_id;
      if (standId) {
        const prevQty = prevItem?.quantity ?? 0;
        const newQty = updates.quantity;
        const wentInStock = prevQty <= 0 && newQty > 0;
        const wentOutOfStock = prevQty > 0 && newQty <= 0;
        const quantityChanged = prevQty !== newQty;

        if (wentInStock || wentOutOfStock || quantityChanged) {
          notifyStandUpdate(standId, wentInStock);
        }
      } else {
        console.log('[Manager] updateInventoryItem: no farmstand_id available for notification, skipping');
      }
    }

    return true;
  } catch (err) {
    console.log('[Manager] updateInventoryItem exception:', err);
    return false;
  }
}

/** Internal mapper used before the main mapInventoryItem helper is defined. */
function mapInventoryItemLocal(row: Record<string, unknown>): InventoryItem {
  return {
    id: String(row['id'] ?? ''),
    farmstand_id: String(row['farmstand_id'] ?? ''),
    item_name: String(row['item_name'] ?? ''),
    category: row['category'] != null ? String(row['category']) : null,
    quantity: Number(row['quantity'] ?? 0),
    unit: String(row['unit'] ?? 'each'),
    price: row['price'] != null ? Number(row['price']) : null,
    low_stock_threshold: Number(row['low_stock_threshold'] ?? 5),
    notes: row['notes'] != null ? String(row['notes']) : null,
    is_active: Boolean(row['is_active'] ?? true),
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  };
}

export async function deleteInventoryItem(id: string): Promise<boolean> {
  try {
    // Soft-delete by setting is_active = false
    const { error } = await supabase
      .from<Record<string, unknown>>('farmstand_inventory')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .execute();

    if (error) {
      console.log('[Manager] deleteInventoryItem error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.log('[Manager] deleteInventoryItem exception:', err);
    return false;
  }
}

export async function adjustInventoryQuantity(
  id: string,
  delta: number,
  currentQuantity: number,
  farmstand_id?: string
): Promise<boolean> {
  const newQuantity = Math.max(0, currentQuantity + delta);
  return updateInventoryItem(id, { quantity: newQuantity }, farmstand_id ? { farmstand_id } : undefined);
}

// ============================================================
// SALES
// ============================================================

export async function fetchSales(
  farmstandId: string,
  dateRange?: DateRange
): Promise<Sale[]> {
  try {
    let query = supabase
      .from<Record<string, unknown>>('farmstand_sales')
      .select('*')
      .eq('farmstand_id', farmstandId)
      .requireAuth()
      .order('sold_at', { ascending: false });

    // Apply date filters if provided
    if (dateRange?.start) {
      query = query.gte('sold_at', dateRange.start.toISOString());
    }
    if (dateRange?.end) {
      query = query.lte('sold_at', dateRange.end.toISOString());
    }

    const { data, error } = await query.execute();

    if (error) {
      console.log('[Manager] fetchSales error:', error);
      return [];
    }
    return (data ?? []).map(mapSale);
  } catch (err) {
    console.log('[Manager] fetchSales exception:', err);
    return [];
  }
}

export interface CreateSaleResult {
  sale: Sale | null;
  errorInfo?: {
    table: string;
    farmstand_id: string;
    user_id: string | null;
    message: string;
    code: string | null;
    details: string | null;
    hint: string | null;
    status: number | null;
    payload: Record<string, unknown>;
  };
}

export async function createSale(sale: SaleInsert): Promise<CreateSaleResult> {
  try {
    const now = new Date().toISOString();
    const insertPayload: Record<string, unknown> = {
      farmstand_id: sale.farmstand_id,
      inventory_item_id: sale.inventory_item_id ?? null,
      item_name_snapshot: sale.item_name_snapshot,
      category: sale.category ?? null,
      quantity: sale.quantity ?? null,
      unit: sale.unit ?? null,
      unit_price: sale.unit_price ?? null,
      total_amount: sale.total_amount,
      payment_method: sale.payment_method ?? 'cash',
      sold_at: sale.sold_at ?? now,
      notes: sale.notes ?? null,
      updated_at: now,
    };

    // Get current user id for debug logging (best-effort, no auth accessor available)
    const userId: string | null = null;

    console.log('[Manager] createSale payload:', JSON.stringify(insertPayload));

    const { data, error } = await supabase
      .from<Record<string, unknown>>('farmstand_sales')
      .insert(insertPayload)
      .execute();

    if (error) {
      const e = error as SupabaseError;
      const errorInfo = {
        table: 'farmstand_sales',
        farmstand_id: sale.farmstand_id,
        user_id: userId,
        message: e.message ?? 'unknown',
        code: (e as unknown as Record<string, unknown>).code as string ?? null,
        details: (e as unknown as Record<string, unknown>).details as string ?? null,
        hint: (e as unknown as Record<string, unknown>).hint as string ?? null,
        status: (e as unknown as Record<string, unknown>).status as number ?? null,
        payload: insertPayload,
      };
      // Consolidated debug log
      console.log('[Manager] createSale FAILED:', JSON.stringify(errorInfo));
      return { sale: null, errorInfo };
    }

    // If inventory deduction is requested and an inventory item is linked,
    // deduct the sold quantity from that inventory item.
    if (sale.inventory_item_id && sale.quantity != null && sale.quantity > 0) {
      console.log('[Manager] createSale: deducting', sale.quantity, 'from inventory item', sale.inventory_item_id);
      try {
        // Fetch current quantity first
        const { data: invData, error: invFetchError } = await supabase
          .from<Record<string, unknown>>('farmstand_inventory')
          .select('*')
          .eq('id', sale.inventory_item_id)
          .requireAuth()
          .execute();

        if (invFetchError) {
          console.log('[Manager] createSale: failed to fetch inventory for deduction:', invFetchError.message);
        } else if (invData && invData.length > 0) {
          const currentQty = Number((invData[0] as Record<string, unknown>)['quantity'] ?? 0);
          const newQty = Math.max(0, currentQty - sale.quantity);
          console.log('[Manager] createSale: inventory deduction', currentQty, '->', newQty);
          await updateInventoryItem(sale.inventory_item_id, { quantity: newQty });
        } else {
          console.log('[Manager] createSale: inventory item not found for deduction, id:', sale.inventory_item_id);
        }
      } catch (deductErr) {
        // Non-fatal: sale is already recorded, log the deduction failure
        console.log('[Manager] createSale: inventory deduction exception (non-fatal):', deductErr instanceof Error ? deductErr.message : String(deductErr));
      }
    }

    const rows = data as unknown[];
    // Supabase REST with return=representation may return [] on a successful insert
    // when RLS prevents the server from reading back the newly inserted row.
    // In that case, reconstruct the Sale from the input payload rather than failing.
    if (!rows || rows.length === 0) {
      console.log('[Manager] createSale: insert succeeded but no row returned (RLS read restriction or empty response) — reconstructing from payload');
      return {
        sale: {
          id: '',
          farmstand_id: sale.farmstand_id,
          inventory_item_id: sale.inventory_item_id ?? null,
          item_name_snapshot: sale.item_name_snapshot,
          category: sale.category ?? null,
          quantity: sale.quantity ?? null,
          unit: sale.unit ?? null,
          unit_price: sale.unit_price ?? null,
          total_amount: sale.total_amount,
          payment_method: sale.payment_method ?? 'cash',
          sold_at: sale.sold_at ?? now,
          notes: sale.notes ?? null,
          created_at: now,
          updated_at: now,
        },
      };
    }
    return { sale: mapSale(rows[0] as Record<string, unknown>) };
  } catch (err) {
    console.log('[Manager] createSale exception:', err instanceof Error ? err.message : String(err));
    return { sale: null, errorInfo: { table: 'farmstand_sales', farmstand_id: sale.farmstand_id, user_id: null, message: err instanceof Error ? err.message : String(err), code: null, details: null, hint: null, status: null, payload: {} } };
  }
}

export async function updateSale(id: string, updates: SaleUpdate): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from<Record<string, unknown>>('farmstand_sales')
      .update({ ...updates, updated_at: now })
      .eq('id', id)
      .execute();

    if (error) {
      console.log('[Manager] updateSale error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.log('[Manager] updateSale exception:', err);
    return false;
  }
}

export async function deleteSale(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from<Record<string, unknown>>('farmstand_sales')
      .delete()
      .eq('id', id)
      .execute();

    if (error) {
      console.log('[Manager] deleteSale error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.log('[Manager] deleteSale exception:', err);
    return false;
  }
}

// ============================================================
// EXPENSES
// ============================================================

export async function fetchExpenses(
  farmstandId: string,
  dateRange?: DateRange
): Promise<Expense[]> {
  try {
    let query = supabase
      .from<Record<string, unknown>>('farmstand_expenses')
      .select('*')
      .eq('farmstand_id', farmstandId)
      .requireAuth()
      .order('spent_at', { ascending: false });

    if (dateRange?.start) {
      query = query.gte('spent_at', dateRange.start.toISOString());
    }
    if (dateRange?.end) {
      query = query.lte('spent_at', dateRange.end.toISOString());
    }

    const { data, error } = await query.execute();

    if (error) {
      console.log('[Manager] fetchExpenses error:', error);
      return [];
    }
    return (data ?? []).map(mapExpense);
  } catch (err) {
    console.log('[Manager] fetchExpenses exception:', err);
    return [];
  }
}

export async function createExpense(expense: ExpenseInsert): Promise<Expense | null> {
  try {
    const now = new Date().toISOString();
    const insertPayload = {
      farmstand_id: expense.farmstand_id,
      category: expense.category ?? 'other',
      vendor: expense.vendor ?? null,
      amount: expense.amount,
      spent_at: expense.spent_at ?? now,
      notes: expense.notes ?? null,
      updated_at: now,
    };

    console.log('[Manager] createExpense payload:', JSON.stringify(insertPayload));

    const { data, error } = await supabase
      .from<Record<string, unknown>>('farmstand_expenses')
      .insert(insertPayload)
      .execute();

    if (error) {
      const e = error as SupabaseError;
      console.log('[Manager] createExpense FAILED:', JSON.stringify({
        farmstand_id: expense.farmstand_id,
        message: e.message,
        code: e.code ?? null,
        details: e.details ?? null,
        hint: e.hint ?? null,
        status: e.status ?? null,
      }));
      return null;
    }

    const rows = data as unknown[];
    // Supabase REST may return [] on success when RLS prevents read-back of the inserted row
    if (!rows || rows.length === 0) {
      console.log('[Manager] createExpense: insert succeeded but no row returned — reconstructing from payload');
      return {
        id: '',
        farmstand_id: expense.farmstand_id,
        category: expense.category ?? 'other',
        vendor: expense.vendor ?? null,
        amount: expense.amount,
        spent_at: expense.spent_at ?? now,
        notes: expense.notes ?? null,
        created_at: now,
        updated_at: now,
      };
    }
    return mapExpense(rows[0] as Record<string, unknown>);
  } catch (err) {
    console.log('[Manager] createExpense exception:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function updateExpense(id: string, updates: ExpenseUpdate): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from<Record<string, unknown>>('farmstand_expenses')
      .update({ ...updates, updated_at: now })
      .eq('id', id)
      .execute();

    if (error) {
      console.log('[Manager] updateExpense error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.log('[Manager] updateExpense exception:', err);
    return false;
  }
}

export async function deleteExpense(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from<Record<string, unknown>>('farmstand_expenses')
      .delete()
      .eq('id', id)
      .execute();

    if (error) {
      console.log('[Manager] deleteExpense error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.log('[Manager] deleteExpense exception:', err);
    return false;
  }
}

// ============================================================
// SUMMARY & REPORTS
// ============================================================

export async function fetchFarmstandManagerSummary(
  farmstandId: string,
  preset: DateRangePreset = 'this_month'
): Promise<ManagerSummary> {
  const { start, end } = getDateRangeForPreset(preset);
  const dateRange: DateRange = { start, end, preset };

  const todayRange = getDateRangeForPreset('this_week');
  const weekRange = getDateRangeForPreset('this_week');
  const monthRange = getDateRangeForPreset('this_month');

  const [sales, expenses, inventory] = await Promise.all([
    fetchSales(farmstandId, dateRange),
    fetchExpenses(farmstandId, dateRange),
    fetchInventory(farmstandId),
  ]);

  const revenue = sales.reduce((sum, s) => sum + s.total_amount, 0);
  const expensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = revenue - expensesTotal;
  const inventoryValue = inventory.reduce((sum, item) => {
    if (item.price != null) return sum + item.quantity * item.price;
    return sum;
  }, 0);

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const salesToday = (await fetchSales(farmstandId, {
    start: todayStart,
    end: new Date(),
    preset: 'this_week',
  })).reduce((sum, s) => sum + s.total_amount, 0);

  const salesThisWeek = (await fetchSales(farmstandId, {
    start: weekRange.start,
    end: weekRange.end,
    preset: 'this_week',
  })).reduce((sum, s) => sum + s.total_amount, 0);

  const salesThisMonth = (await fetchSales(farmstandId, {
    start: monthRange.start,
    end: monthRange.end,
    preset: 'this_month',
  })).reduce((sum, s) => sum + s.total_amount, 0);

  return {
    revenue,
    expenses: expensesTotal,
    netProfit,
    inventoryValue,
    salesToday,
    salesThisWeek,
    salesThisMonth,
  };
}

export async function buildFarmstandReportData(
  farmstandId: string,
  farmstandName: string,
  preset: DateRangePreset
): Promise<FarmstandReportData> {
  const { start, end } = getDateRangeForPreset(preset);
  const dateRange: DateRange = { start, end, preset };

  const [sales, expenses, inventory] = await Promise.all([
    fetchSales(farmstandId, dateRange),
    fetchExpenses(farmstandId, dateRange),
    fetchInventory(farmstandId),
  ]);

  // Calculate summary
  const revenue = sales.reduce((sum, s) => sum + s.total_amount, 0);
  const expensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netProfit = revenue - expensesTotal;
  const inventoryValue = inventory.reduce((sum, item) => {
    if (item.price != null) return sum + item.quantity * item.price;
    return sum;
  }, 0);

  const summary: ManagerSummary = {
    revenue,
    expenses: expensesTotal,
    netProfit,
    inventoryValue,
    salesToday: 0,
    salesThisWeek: 0,
    salesThisMonth: 0,
  };

  // Top selling items
  const itemMap = new Map<string, { totalRevenue: number; totalQuantity: number }>();
  for (const sale of sales) {
    const key = sale.item_name_snapshot;
    const existing = itemMap.get(key) ?? { totalRevenue: 0, totalQuantity: 0 };
    itemMap.set(key, {
      totalRevenue: existing.totalRevenue + sale.total_amount,
      totalQuantity: existing.totalQuantity + (sale.quantity ?? 1),
    });
  }
  const topSellingItems: TopSellingItem[] = Array.from(itemMap.entries())
    .map(([item_name, vals]) => ({ item_name, ...vals }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 10);

  // Expense breakdown
  const expenseMap = new Map<string, number>();
  for (const expense of expenses) {
    const cat = expense.category;
    expenseMap.set(cat, (expenseMap.get(cat) ?? 0) + expense.amount);
  }
  const expenseBreakdown: ExpenseBreakdown[] = Array.from(expenseMap.entries())
    .map(([category, total]) => {
      const label = EXPENSE_CATEGORIES.find((c) => c.value === category)?.label ?? category;
      return {
        category: category as ExpenseCategory,
        label,
        total,
        percentage: expensesTotal > 0 ? Math.round((total / expensesTotal) * 100) : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Recent activity feed (last 20, merged)
  const saleActivities: RecentActivity[] = sales.slice(0, 10).map((s) => ({
    id: s.id,
    type: 'sale' as const,
    label: `Sold ${s.quantity != null ? `${s.quantity} ${s.unit ?? ''} ` : ''}${s.item_name_snapshot} for $${s.total_amount.toFixed(2)}`,
    amount: s.total_amount,
    timestamp: s.sold_at,
  }));

  const expenseActivities: RecentActivity[] = expenses.slice(0, 10).map((e) => ({
    id: e.id,
    type: 'expense' as const,
    label: `$${e.amount.toFixed(2)} expense for ${EXPENSE_CATEGORIES.find((c) => c.value === e.category)?.label ?? e.category}${e.vendor ? ` (${e.vendor})` : ''}`,
    amount: e.amount,
    timestamp: e.spent_at,
  }));

  const recentActivity: RecentActivity[] = [...saleActivities, ...expenseActivities]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15);

  return {
    farmstandName,
    dateRange,
    summary,
    topSellingItems,
    expenseBreakdown,
    recentActivity,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================
// INTERNAL MAPPERS
// ============================================================

function mapInventoryItem(row: Record<string, unknown>): InventoryItem {
  return {
    id: String(row['id'] ?? ''),
    farmstand_id: String(row['farmstand_id'] ?? ''),
    item_name: String(row['item_name'] ?? ''),
    category: row['category'] != null ? String(row['category']) : null,
    quantity: Number(row['quantity'] ?? 0),
    unit: String(row['unit'] ?? 'each'),
    price: row['price'] != null ? Number(row['price']) : null,
    low_stock_threshold: Number(row['low_stock_threshold'] ?? 5),
    notes: row['notes'] != null ? String(row['notes']) : null,
    is_active: Boolean(row['is_active'] ?? true),
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  };
}

function mapSale(row: Record<string, unknown>): Sale {
  return {
    id: String(row['id'] ?? ''),
    farmstand_id: String(row['farmstand_id'] ?? ''),
    inventory_item_id: row['inventory_item_id'] != null ? String(row['inventory_item_id']) : null,
    item_name_snapshot: String(row['item_name_snapshot'] ?? ''),
    category: row['category'] != null ? String(row['category']) : null,
    quantity: row['quantity'] != null ? Number(row['quantity']) : null,
    unit: row['unit'] != null ? String(row['unit']) : null,
    unit_price: row['unit_price'] != null ? Number(row['unit_price']) : null,
    total_amount: Number(row['total_amount'] ?? 0),
    payment_method: (row['payment_method'] as Sale['payment_method']) ?? 'cash',
    sold_at: String(row['sold_at'] ?? ''),
    notes: row['notes'] != null ? String(row['notes']) : null,
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  };
}

function mapExpense(row: Record<string, unknown>): Expense {
  return {
    id: String(row['id'] ?? ''),
    farmstand_id: String(row['farmstand_id'] ?? ''),
    category: (row['category'] as Expense['category']) ?? 'other',
    vendor: row['vendor'] != null ? String(row['vendor']) : null,
    amount: Number(row['amount'] ?? 0),
    spent_at: String(row['spent_at'] ?? ''),
    notes: row['notes'] != null ? String(row['notes']) : null,
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  };
}

// ============================================================
// CURRENCY FORMAT HELPER
// ============================================================

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatCurrencyShort(amount: number): string {
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return `$${amount.toFixed(0)}`;
}

// ============================================================
// DATE HELPERS
// ============================================================

export function formatRelativeDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateLabel(preset: DateRangePreset): string {
  return DATE_RANGE_LABELS[preset];
}
