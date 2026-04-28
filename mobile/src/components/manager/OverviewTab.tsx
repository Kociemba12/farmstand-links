import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { ShoppingCart, Receipt, Package, AlertCircle, TrendingUp } from 'lucide-react-native';
import type { DateRange, DateRangePreset, RecentActivity, TopSellingItem, InventoryItem } from '@/lib/manager-types';
import { getStockStatus, DATE_RANGE_LABELS } from '@/lib/manager-types';
import {
  fetchSales,
  fetchExpenses,
  fetchInventory,
  formatCurrency,
  formatRelativeDate,
} from '@/lib/manager-service';
import { SummaryCards } from './SummaryCards';
import { SummaryCardsSkeleton, ListSkeleton, ManagerShimmer } from './ManagerShimmer';

interface OverviewTabProps {
  farmstandId: string;
  farmstandName: string;
  dateRange: DateRange;
  onDateRangeChange: (preset: DateRangePreset) => void;
}

const DATE_PRESETS: DateRangePreset[] = ['this_week', 'this_month', 'this_season', 'all_time'];

interface OverviewData {
  revenue: number;
  expenses: number;
  netProfit: number;
  inventoryValue: number;
  recentActivity: RecentActivity[];
  topItems: TopSellingItem[];
  lowStockItems: InventoryItem[];
}

export function OverviewTab({
  farmstandId,
  farmstandName,
  dateRange,
  onDateRangeChange,
}: OverviewTabProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
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

      // Recent activity: last 5 sales + last 5 expenses merged
      const saleActivities: RecentActivity[] = sales.slice(0, 5).map((s) => ({
        id: s.id,
        type: 'sale' as const,
        label: s.item_name_snapshot,
        amount: s.total_amount,
        timestamp: s.sold_at,
      }));
      const expenseActivities: RecentActivity[] = expenses.slice(0, 5).map((e) => ({
        id: e.id,
        type: 'expense' as const,
        label: e.category,
        amount: e.amount,
        timestamp: e.spent_at,
      }));
      const recentActivity = [...saleActivities, ...expenseActivities]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 8);

      // Top selling items
      const itemMap = new Map<string, { totalRevenue: number; totalQuantity: number }>();
      for (const s of sales) {
        const key = s.item_name_snapshot;
        const existing = itemMap.get(key) ?? { totalRevenue: 0, totalQuantity: 0 };
        itemMap.set(key, {
          totalRevenue: existing.totalRevenue + s.total_amount,
          totalQuantity: existing.totalQuantity + (s.quantity ?? 1),
        });
      }
      const topItems: TopSellingItem[] = Array.from(itemMap.entries())
        .map(([item_name, vals]) => ({ item_name, ...vals }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, 3);

      // Low stock items
      const lowStockItems = inventory.filter((item) => {
        const status = getStockStatus(item);
        return status === 'low' || status === 'out';
      });

      setData({
        revenue,
        expenses: expensesTotal,
        netProfit,
        inventoryValue,
        recentActivity,
        topItems,
        lowStockItems,
      });
    } finally {
      setLoading(false);
    }
  }, [farmstandId, dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: '#FAF7F2' }}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      {/* Date range selector */}
      <View className="px-4 pt-4 pb-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {DATE_PRESETS.map((preset) => (
            <Pressable
              key={preset}
              onPress={() => onDateRangeChange(preset)}
              className="rounded-full px-4 py-2"
              style={{
                backgroundColor:
                  dateRange.preset === preset ? '#2D5A3D' : '#E8DDD4',
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{
                  color: dateRange.preset === preset ? '#FAF7F2' : '#5A5A5A',
                }}
              >
                {DATE_RANGE_LABELS[preset]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Summary Cards */}
      {loading ? (
        <SummaryCardsSkeleton />
      ) : data ? (
        <SummaryCards
          revenue={data.revenue}
          expenses={data.expenses}
          netProfit={data.netProfit}
          inventoryValue={data.inventoryValue}
        />
      ) : null}

      {/* Recent Activity */}
      <View className="px-4 mt-5">
        <Text className="text-base font-bold mb-3" style={{ color: '#1A1A1A' }}>
          Recent Activity
        </Text>
        {loading ? (
          <View className="gap-2">
            {[0, 1, 2, 3].map((i) => (
              <View key={i} className="flex-row items-center gap-3">
                <ManagerShimmer width={36} height={36} borderRadius={18} />
                <View className="flex-1 gap-1">
                  <ManagerShimmer width={120} height={13} borderRadius={6} />
                  <ManagerShimmer width={72} height={10} borderRadius={5} />
                </View>
                <ManagerShimmer width={52} height={14} borderRadius={6} />
              </View>
            ))}
          </View>
        ) : !data || data.recentActivity.length === 0 ? (
          <View
            className="rounded-2xl bg-white p-6 items-center gap-2"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.04,
              shadowRadius: 6,
              elevation: 2,
            }}
          >
            <AlertCircle size={32} color="#E8DDD4" />
            <Text className="text-sm" style={{ color: '#A0A0A0' }}>No activity yet</Text>
          </View>
        ) : (
          <View
            className="rounded-2xl bg-white overflow-hidden"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: 3,
            }}
          >
            {data.recentActivity.map((activity, idx) => (
              <View key={activity.id}>
                {idx > 0 && <View className="h-px mx-4" style={{ backgroundColor: '#F5F1EC' }} />}
                <View className="flex-row items-center px-4 py-3 gap-3">
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center"
                    style={{
                      backgroundColor: activity.type === 'sale' ? '#F0FDF4' : '#FEF2F2',
                    }}
                  >
                    {activity.type === 'sale' ? (
                      <ShoppingCart size={16} color="#16a34a" />
                    ) : (
                      <Receipt size={16} color="#DC2626" />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-semibold capitalize" style={{ color: '#1A1A1A' }} numberOfLines={1}>
                      {activity.label}
                    </Text>
                    <Text className="text-xs" style={{ color: '#A0A0A0' }}>
                      {formatRelativeDate(activity.timestamp)}
                    </Text>
                  </View>
                  {activity.amount != null && (
                    <Text
                      className="text-sm font-bold"
                      style={{ color: activity.type === 'sale' ? '#2D5A3D' : '#DC2626' }}
                    >
                      {activity.type === 'sale' ? '+' : '-'}{formatCurrency(activity.amount)}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Top Selling Items */}
      <View className="px-4 mt-5">
        <Text className="text-base font-bold mb-3" style={{ color: '#1A1A1A' }}>
          Top Selling Items
        </Text>
        {loading ? (
          <View className="gap-2">
            {[0, 1, 2].map((i) => (
              <View key={i} className="flex-row items-center gap-3">
                <ManagerShimmer width={28} height={28} borderRadius={8} />
                <ManagerShimmer width={120} height={13} borderRadius={6} />
                <View className="flex-1" />
                <ManagerShimmer width={60} height={14} borderRadius={6} />
              </View>
            ))}
          </View>
        ) : !data || data.topItems.length === 0 ? (
          <View
            className="rounded-2xl bg-white p-6 items-center gap-2"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.04,
              shadowRadius: 6,
              elevation: 2,
            }}
          >
            <TrendingUp size={32} color="#E8DDD4" />
            <Text className="text-sm" style={{ color: '#A0A0A0' }}>No sales data yet</Text>
          </View>
        ) : (
          <View
            className="rounded-2xl bg-white overflow-hidden"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: 3,
            }}
          >
            {data.topItems.map((item, idx) => (
              <View key={item.item_name}>
                {idx > 0 && <View className="h-px mx-4" style={{ backgroundColor: '#F5F1EC' }} />}
                <View className="flex-row items-center px-4 py-3 gap-3">
                  <View
                    className="w-7 h-7 rounded-lg items-center justify-center"
                    style={{ backgroundColor: '#F5F1EC' }}
                  >
                    <Text className="text-sm font-bold" style={{ color: '#7A6F65' }}>
                      {idx + 1}
                    </Text>
                  </View>
                  <Text className="flex-1 text-sm font-semibold" style={{ color: '#1A1A1A' }} numberOfLines={1}>
                    {item.item_name}
                  </Text>
                  <Text className="text-sm font-bold" style={{ color: '#2D5A3D' }}>
                    {formatCurrency(item.totalRevenue)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Low Inventory */}
      {!loading && data && data.lowStockItems.length > 0 && (
        <View className="px-4 mt-5">
          <View className="flex-row items-center gap-2 mb-3">
            <AlertCircle size={16} color="#D97706" />
            <Text className="text-base font-bold" style={{ color: '#1A1A1A' }}>
              Low Inventory
            </Text>
          </View>
          <View
            className="rounded-2xl bg-white overflow-hidden"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: 3,
            }}
          >
            {data.lowStockItems.map((item, idx) => {
              const status = getStockStatus(item);
              return (
                <View key={item.id}>
                  {idx > 0 && <View className="h-px mx-4" style={{ backgroundColor: '#F5F1EC' }} />}
                  <View className="flex-row items-center px-4 py-3 gap-3">
                    <Package size={16} color="#D97706" />
                    <Text className="flex-1 text-sm font-medium" style={{ color: '#1A1A1A' }}>
                      {item.item_name}
                    </Text>
                    <Text className="text-sm" style={{ color: '#7A6F65' }}>
                      {item.quantity} {item.unit}
                    </Text>
                    <View
                      className="rounded-full px-2 py-0.5 ml-2"
                      style={{ backgroundColor: status === 'out' ? '#FEF2F2' : '#FFFBEB' }}
                    >
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: status === 'out' ? '#DC2626' : '#D97706' }}
                      >
                        {status === 'out' ? 'Out' : 'Low'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
