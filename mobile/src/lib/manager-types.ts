/**
 * Farmstand Manager Types
 * Isolated types for the Farmstand Manager module.
 * DO NOT import or use these in existing claim/approval/listing/messaging logic.
 */

// ============================================================
// INVENTORY
// ============================================================

export type InventoryStockStatus = 'in_stock' | 'low' | 'out';

export interface InventoryItem {
  id: string;
  farmstand_id: string;
  item_name: string;
  category: string | null;
  quantity: number;
  unit: string;
  price: number | null;
  low_stock_threshold: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type InventoryItemInsert = Omit<InventoryItem, 'id' | 'created_at' | 'updated_at'>;
export type InventoryItemUpdate = Partial<Omit<InventoryItem, 'id' | 'farmstand_id' | 'created_at'>>;

export function getStockStatus(item: InventoryItem): InventoryStockStatus {
  if (item.quantity <= 0) return 'out';
  if (item.quantity <= item.low_stock_threshold) return 'low';
  return 'in_stock';
}

// ============================================================
// SALES
// ============================================================

export type PaymentMethod = 'cash' | 'card' | 'venmo' | 'paypal' | 'zelle' | 'cash_app' | 'other';

export interface Sale {
  id: string;
  farmstand_id: string;
  inventory_item_id: string | null;
  item_name_snapshot: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_amount: number;
  payment_method: PaymentMethod;
  sold_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type SaleInsert = Omit<Sale, 'id' | 'created_at' | 'updated_at'>;
export type SaleUpdate = Partial<Omit<Sale, 'id' | 'farmstand_id' | 'created_at'>>;

// ============================================================
// EXPENSES
// ============================================================

export type ExpenseCategory =
  | 'feed'
  | 'seed'
  | 'packaging'
  | 'supplies'
  | 'labor'
  | 'fees'
  | 'utilities'
  | 'other';

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'feed', label: 'Feed' },
  { value: 'seed', label: 'Seed & Plants' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'labor', label: 'Labor' },
  { value: 'fees', label: 'Fees & Licenses' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'other', label: 'Other' },
];

export interface Expense {
  id: string;
  farmstand_id: string;
  category: ExpenseCategory;
  vendor: string | null;
  amount: number;
  spent_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ExpenseInsert = Omit<Expense, 'id' | 'created_at' | 'updated_at'>;
export type ExpenseUpdate = Partial<Omit<Expense, 'id' | 'farmstand_id' | 'created_at'>>;

// ============================================================
// DATE RANGE
// ============================================================

export type DateRangePreset = 'this_week' | 'this_month' | 'this_season' | 'all_time';

export interface DateRange {
  start: Date | null;
  end: Date | null;
  preset: DateRangePreset;
}

export function getDateRangeForPreset(preset: DateRangePreset): { start: Date | null; end: Date | null } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (preset) {
    case 'this_week': {
      const start = new Date(now);
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case 'this_season': {
      // Season = last 3 months
      const start = new Date(now);
      start.setMonth(start.getMonth() - 3);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case 'all_time':
    default:
      return { start: null, end: null };
  }
}

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  this_week: 'This Week',
  this_month: 'This Month',
  this_season: 'This Season',
  all_time: 'All Time',
};

// ============================================================
// SUMMARY / REPORTS
// ============================================================

export interface ManagerSummary {
  revenue: number;
  expenses: number;
  netProfit: number;
  inventoryValue: number;
  salesToday: number;
  salesThisWeek: number;
  salesThisMonth: number;
}

export interface TopSellingItem {
  item_name: string;
  totalRevenue: number;
  totalQuantity: number;
}

export interface ExpenseBreakdown {
  category: ExpenseCategory;
  label: string;
  total: number;
  percentage: number;
}

export interface RecentActivity {
  id: string;
  type: 'sale' | 'expense' | 'inventory';
  label: string;
  amount: number | null;
  timestamp: string;
}

export interface FarmstandReportData {
  farmstandName: string;
  dateRange: DateRange;
  summary: ManagerSummary;
  topSellingItems: TopSellingItem[];
  expenseBreakdown: ExpenseBreakdown[];
  recentActivity: RecentActivity[];
  generatedAt: string;
}
