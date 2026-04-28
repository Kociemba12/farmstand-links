/**
 * FarmstandManager
 * Main Farmstand Manager section component.
 * Dropped into My Farmstand screen below the existing Manage tab content.
 * ISOLATED: does not touch any existing claim/approval/listing/messaging logic.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import {
  BarChart3,
  Package,
  ShoppingCart,
  Receipt,
  FileText,
  X,
  Lock,
  Zap,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { DateRange, DateRangePreset } from '@/lib/manager-types';
import { getDateRangeForPreset } from '@/lib/manager-types';
import type { PremiumStatus } from '@/lib/farmer-store';
import { isPremiumFarmstand } from '@/components/PremiumBadge';
import { OverviewTab } from './manager/OverviewTab';
import { InventoryTab } from './manager/InventoryTab';
import { SalesTab } from './manager/SalesTab';
import { ExpensesTab } from './manager/ExpensesTab';
import { ReportsTab } from './manager/ReportsTab';

// ============================================================
// TYPES
// ============================================================

type ManagerTab = 'overview' | 'inventory' | 'sales' | 'expenses' | 'reports';

interface TabConfig {
  id: ManagerTab;
  label: string;
  icon: React.ReactNode;
}

interface FarmstandManagerProps {
  farmstandId: string;
  farmstandName: string;
  premiumStatus?: PremiumStatus;
  isOpen: boolean;
  onClose: () => void;
  onUpgradePress?: () => void;
}

// ============================================================
// CONSTANTS
// ============================================================

const FOREST = '#2D5A3D';
const CREAM = '#FAF7F2';

// ============================================================
// PREMIUM LOCKED VIEW
// ============================================================

interface PremiumLockedViewProps {
  title: string;
  savedMessage: string;
  isExpired: boolean;
  onUpgradePress: () => void;
}

function PremiumLockedView({ title, savedMessage, isExpired, onUpgradePress }: PremiumLockedViewProps) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingVertical: 48,
      }}
    >
      {/* Lock icon with subtle background */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: '#F5F0E8',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
          borderWidth: 1.5,
          borderColor: '#E8E0D0',
        }}
      >
        <Lock size={28} color="#2D5A3D" />
      </View>

      {/* Title */}
      <Text
        style={{
          fontSize: 18,
          fontWeight: '700',
          color: '#1C1917',
          textAlign: 'center',
          marginBottom: 10,
          letterSpacing: -0.3,
        }}
      >
        {title}
      </Text>

      {/* Saved data message */}
      <Text
        style={{
          fontSize: 14,
          color: '#78716C',
          textAlign: 'center',
          marginBottom: 28,
          lineHeight: 20,
        }}
      >
        {savedMessage}
      </Text>

      {/* Upgrade button */}
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onUpgradePress();
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: pressed ? '#254d34' : '#2D5A3D',
          paddingHorizontal: 24,
          paddingVertical: 14,
          borderRadius: 14,
          shadowColor: '#2D5A3D',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 8,
          elevation: 4,
        })}
      >
        <Zap size={16} color="#FFFFFF" />
        <Text
          style={{
            color: '#FFFFFF',
            fontWeight: '700',
            fontSize: 15,
            letterSpacing: 0.2,
          }}
        >
          Start 3-Month Free Premium Membership
        </Text>
      </Pressable>

      {/* Sub-note */}
      <Text
        style={{
          fontSize: 12,
          color: '#A8A29E',
          textAlign: 'center',
          marginTop: 14,
        }}
      >
        Your data is still saved — pick up right where you left off
      </Text>
    </View>
  );
}

// ============================================================
// LOCKED TAB CONFIGS
// ============================================================

const LOCKED_TAB_CONTENT: Record<string, { title: string; savedMessage: string }> = {
  overview: {
    title: 'Premium Feature',
    savedMessage: "You're on the free plan. Start your 3-month free premium membership to view your full business overview with sales, expenses, and inventory insights.",
  },
  inventory: {
    title: 'Inventory Tracking',
    savedMessage: "You're on the free plan. Start your 3-month free premium membership to manage inventory. All previously saved inventory is safe and waiting.",
  },
  sales: {
    title: 'Sales Tracking',
    savedMessage: "You're on the free plan. Start your 3-month free premium membership to track sales. Your previous records are saved and ready.",
  },
  expenses: {
    title: 'Expense Tracking',
    savedMessage: "You're on the free plan. Start your 3-month free premium membership to track expenses. Your history is saved and ready.",
  },
  reports: {
    title: 'Reports & Analytics',
    savedMessage: "You're on the free plan. Start your 3-month free premium membership to unlock analytics, export reports, and review historical data.",
  },
};

// ============================================================
// COMPONENT
// ============================================================

export function FarmstandManager({ farmstandId, farmstandName, premiumStatus = 'free', isOpen, onClose, onUpgradePress }: FarmstandManagerProps) {
  const [activeTab, setActiveTab] = useState<ManagerTab>('overview');
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>('this_month');

  // Determine if premium is currently active
  const isPremium = isPremiumFarmstand(premiumStatus);
  const isExpired = premiumStatus === 'expired';
  // Default upgrade handler — calls the optional callback or closes the manager
  const handleUpgradePress = onUpgradePress ?? onClose;
  // Separate refresh keys so each tab only remounts when its data changes.
  // overview and reports refresh when sales OR expenses change.
  // inventory refreshes when a sale with deduction OR an inventory edit occurs.
  const [inventoryKey, setInventoryKey] = useState(0);
  const [overviewKey, setOverviewKey] = useState(0);
  const [reportsKey, setReportsKey] = useState(0);

  const dateRange: DateRange = {
    ...getDateRangeForPreset(dateRangePreset),
    preset: dateRangePreset,
  };

  const handleDateRangeChange = useCallback((preset: DateRangePreset) => {
    setDateRangePreset(preset);
  }, []);

  // Called by SalesTab after a sale is successfully recorded.
  // Marks overview, reports, and inventory (for deductions) as stale.
  const handleSaleAdded = useCallback(() => {
    setOverviewKey((k) => k + 1);
    setReportsKey((k) => k + 1);
    setInventoryKey((k) => k + 1);
  }, []);

  // Called by ExpensesTab after an expense is successfully recorded.
  // Marks overview and reports as stale.
  const handleExpenseAdded = useCallback(() => {
    setOverviewKey((k) => k + 1);
    setReportsKey((k) => k + 1);
  }, []);

  // Called by InventoryTab after an inventory item is added/edited.
  // Marks overview and reports as stale (inventory value changes).
  const handleInventoryChanged = useCallback(() => {
    setOverviewKey((k) => k + 1);
    setReportsKey((k) => k + 1);
  }, []);

  const TABS: TabConfig[] = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 size={16} color={activeTab === 'overview' ? FOREST : '#78716C'} /> },
    { id: 'inventory', label: 'Inventory', icon: <Package size={16} color={activeTab === 'inventory' ? FOREST : '#78716C'} /> },
    { id: 'sales', label: 'Sales', icon: <ShoppingCart size={16} color={activeTab === 'sales' ? FOREST : '#78716C'} /> },
    { id: 'expenses', label: 'Expenses', icon: <Receipt size={16} color={activeTab === 'expenses' ? FOREST : '#78716C'} /> },
    { id: 'reports', label: 'Reports', icon: <FileText size={16} color={activeTab === 'reports' ? FOREST : '#78716C'} /> },
  ];

  return (
    <>
      {/* Full-screen Manager Modal */}
      <Modal
        visible={isOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <View className="flex-1" style={{ backgroundColor: CREAM }}>
          {/* Modal Header */}
          <View
            style={{
              backgroundColor: '#FFFFFF',
              paddingTop: 16,
              paddingBottom: 0,
              paddingHorizontal: 20,
              borderBottomWidth: 1,
              borderBottomColor: '#F0EDE8',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.04,
              shadowRadius: 4,
              elevation: 2,
            }}
          >
            {/* Title row */}
            <View className="flex-row items-center justify-between mb-4">
              <View>
                <Text className="text-lg font-bold" style={{ color: '#1C1917' }}>
                  Farmstand Manager
                </Text>
                <Text className="text-xs" style={{ color: '#78716C' }}>
                  {farmstandName}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onClose();
                }}
                hitSlop={8}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: '#F5F5F4',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={18} color="#44403C" />
              </Pressable>
            </View>

            {/* Tab bar */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 0, gap: 4 }}
            >
              {TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const isLocked = !isPremium;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setActiveTab(tab.id);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      marginRight: 2,
                      borderBottomWidth: 2,
                      borderBottomColor: isActive ? FOREST : 'transparent',
                      gap: 6,
                    }}
                  >
                    {tab.icon}
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: isActive ? '600' : '400',
                        color: isActive ? FOREST : '#78716C',
                      }}
                    >
                      {tab.label}
                    </Text>
                    {isLocked && (
                      <Lock size={10} color="#A8A29E" />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Tab Content — each tab manages its own scroll internally */}
          <View className="flex-1">
            {activeTab === 'overview' && (
              isPremium ? (
                <OverviewTab
                  key={`overview-${overviewKey}`}
                  farmstandId={farmstandId}
                  farmstandName={farmstandName}
                  dateRange={dateRange}
                  onDateRangeChange={handleDateRangeChange}
                />
              ) : (
                <PremiumLockedView
                  title={LOCKED_TAB_CONTENT.overview.title}
                  savedMessage={LOCKED_TAB_CONTENT.overview.savedMessage}
                  isExpired={isExpired}
                  onUpgradePress={handleUpgradePress}
                />
              )
            )}
            {activeTab === 'inventory' && (
              isPremium ? (
                <InventoryTab
                  key={`inventory-${inventoryKey}`}
                  farmstandId={farmstandId}
                  onInventoryChanged={handleInventoryChanged}
                />
              ) : (
                <PremiumLockedView
                  title={LOCKED_TAB_CONTENT.inventory.title}
                  savedMessage={LOCKED_TAB_CONTENT.inventory.savedMessage}
                  isExpired={isExpired}
                  onUpgradePress={handleUpgradePress}
                />
              )
            )}
            {activeTab === 'sales' && (
              isPremium ? (
                <SalesTab
                  key="sales"
                  farmstandId={farmstandId}
                  dateRange={dateRange}
                  onSaleAdded={handleSaleAdded}
                  onSaleChanged={handleSaleAdded}
                />
              ) : (
                <PremiumLockedView
                  title={LOCKED_TAB_CONTENT.sales.title}
                  savedMessage={LOCKED_TAB_CONTENT.sales.savedMessage}
                  isExpired={isExpired}
                  onUpgradePress={handleUpgradePress}
                />
              )
            )}
            {activeTab === 'expenses' && (
              isPremium ? (
                <ExpensesTab
                  key="expenses"
                  farmstandId={farmstandId}
                  dateRange={dateRange}
                  onExpenseAdded={handleExpenseAdded}
                  onExpenseChanged={handleExpenseAdded}
                />
              ) : (
                <PremiumLockedView
                  title={LOCKED_TAB_CONTENT.expenses.title}
                  savedMessage={LOCKED_TAB_CONTENT.expenses.savedMessage}
                  isExpired={isExpired}
                  onUpgradePress={handleUpgradePress}
                />
              )
            )}
            {activeTab === 'reports' && (
              isPremium ? (
                <ReportsTab
                  key={`reports-${reportsKey}`}
                  farmstandId={farmstandId}
                  farmstandName={farmstandName}
                  dateRange={dateRange}
                  onDateRangeChange={handleDateRangeChange}
                />
              ) : (
                <PremiumLockedView
                  title={LOCKED_TAB_CONTENT.reports.title}
                  savedMessage={LOCKED_TAB_CONTENT.reports.savedMessage}
                  isExpired={isExpired}
                  onUpgradePress={handleUpgradePress}
                />
              )
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}
