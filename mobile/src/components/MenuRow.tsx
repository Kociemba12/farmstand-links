import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

export interface MenuRowProps {
  icon: React.ElementType;
  label: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
  isLast?: boolean;
  iconColor?: string;
  iconBgColor?: string;
  badge?: number;
}

export function MenuRow({
  icon: Icon,
  label,
  subtitle,
  value,
  onPress,
  isLast = false,
  iconColor = '#2D5A3D',
  iconBgColor = '#E8F0E8',
  badge,
}: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-4 py-4 active:bg-stone-100 ${
        !isLast ? 'border-b border-stone-100' : ''
      }`}
    >
      <View
        className="w-11 h-11 rounded-full items-center justify-center"
        style={{ backgroundColor: iconBgColor }}
      >
        <Icon size={20} color={iconColor} />
      </View>
      <View className="flex-1 ml-4">
        <Text className="text-base text-stone-800 font-medium">{label}</Text>
        {subtitle && (
          <Text className="text-sm text-stone-500 mt-0.5">{subtitle}</Text>
        )}
      </View>
      {badge !== undefined && badge > 0 && (
        <View
          className="bg-rust rounded-full items-center justify-center mr-2"
          style={{ minWidth: 20, height: 20, paddingHorizontal: 6 }}
        >
          <Text className="text-white text-xs font-bold">{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
      {value && <Text className="text-stone-500 text-sm mr-2">{value}</Text>}
      <ChevronRight size={18} color="#A8A29E" />
    </Pressable>
  );
}
