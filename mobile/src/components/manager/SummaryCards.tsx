import React from 'react';
import { View, Text } from 'react-native';
import { DollarSign, TrendingDown, TrendingUp, Package } from 'lucide-react-native';
import { SummaryCardsSkeleton } from './ManagerShimmer';

interface SummaryCardsProps {
  revenue: number;
  expenses: number;
  netProfit: number;
  inventoryValue: number;
  loading?: boolean;
}

function formatCardValue(amount: number): string {
  if (amount >= 10000) return `$${(amount / 1000).toFixed(1)}k`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(2).replace(/\.?0+$/, '')}k`;
  return `$${amount.toFixed(2)}`;
}

interface CardConfig {
  label: string;
  value: number;
  color: string;
  bgColor: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
}

export function SummaryCards({
  revenue,
  expenses,
  netProfit,
  inventoryValue,
  loading = false,
}: SummaryCardsProps) {
  if (loading) {
    return <SummaryCardsSkeleton />;
  }

  const profitColor = netProfit >= 0 ? '#2D5A3D' : '#DC2626';
  const profitBg = netProfit >= 0 ? '#F0F7F2' : '#FEF2F2';

  const cards: CardConfig[] = [
    {
      label: 'Revenue',
      value: revenue,
      color: '#16a34a',
      bgColor: '#F0FDF4',
      Icon: DollarSign,
    },
    {
      label: 'Expenses',
      value: expenses,
      color: '#DC2626',
      bgColor: '#FEF2F2',
      Icon: TrendingDown,
    },
    {
      label: 'Net Profit',
      value: netProfit,
      color: profitColor,
      bgColor: profitBg,
      Icon: TrendingUp,
    },
    {
      label: 'Inventory',
      value: inventoryValue,
      color: '#D97706',
      bgColor: '#FFFBEB',
      Icon: Package,
    },
  ];

  return (
    <View className="flex-row flex-wrap gap-3 px-4 py-1">
      {cards.map((card) => (
        <View
          key={card.label}
          className="rounded-2xl bg-white p-4"
          style={{
            width: '47%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.07,
            shadowRadius: 10,
            elevation: 3,
          }}
        >
          <View
            className="w-9 h-9 rounded-xl items-center justify-center"
            style={{ backgroundColor: card.bgColor }}
          >
            <card.Icon size={18} color={card.color} />
          </View>
          <Text
            className="mt-3 text-xs font-medium"
            style={{ color: '#8A8A8A' }}
          >
            {card.label}
          </Text>
          <Text
            className="mt-1 text-lg font-bold"
            style={{ color: card.color }}
            numberOfLines={1}
          >
            {formatCardValue(card.value)}
          </Text>
        </View>
      ))}
    </View>
  );
}
