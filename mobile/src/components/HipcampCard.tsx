import React, { memo } from 'react';
import { View, Text, Pressable, Image, Dimensions } from 'react-native';
import { Heart, Navigation } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Farmstand, HoursSchedule } from '@/lib/farmer-store';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const CARD_WIDTH = SCREEN_WIDTH * 0.88;
export const CARD_SPACING = 14;
export const CARD_HEIGHT = 340;

interface HipcampCardProps {
  farmstand: {
    id: string;
    name: string;
    image: string;
    products: string[];
    isOpen: boolean;
    distance: string;
    hours?: HoursSchedule | null;
  };
  isFavorite?: boolean;
  onPress: () => void;
  onFavoritePress?: () => void;
}

// Helper to get hours status text
const getHoursStatus = (hours: HoursSchedule | null | undefined, isOpen: boolean): { text: string; isOpenNow: boolean } => {
  if (!hours) {
    return { text: isOpen ? 'Hours vary' : 'Closed', isOpenNow: isOpen };
  }

  const now = new Date();
  const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()] as keyof Omit<HoursSchedule, 'timezone' | 'exceptions'>;
  const todayHours = hours[dayOfWeek];

  if (todayHours.closed || !todayHours.open || !todayHours.close) {
    // Find next open day
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
    for (let i = 1; i <= 7; i++) {
      const nextDayIndex = (now.getDay() + i) % 7;
      const nextDay = days[nextDayIndex] as keyof Omit<HoursSchedule, 'timezone' | 'exceptions'>;
      const nextDayHours = hours[nextDay];
      if (!nextDayHours.closed && nextDayHours.open) {
        const dayName = i === 1 ? 'Tomorrow' : days[nextDayIndex].charAt(0).toUpperCase() + days[nextDayIndex].slice(1);
        return { text: `Opens ${dayName} ${formatTime(nextDayHours.open)}`, isOpenNow: false };
      }
    }
    return { text: 'Closed', isOpenNow: false };
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openHour, openMin] = todayHours.open.split(':').map(Number);
  const [closeHour, closeMin] = todayHours.close.split(':').map(Number);
  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;

  if (currentMinutes < openMinutes) {
    return { text: `Opens ${formatTime(todayHours.open)}`, isOpenNow: false };
  } else if (currentMinutes < closeMinutes) {
    return { text: `Open until ${formatTime(todayHours.close)}`, isOpenNow: true };
  } else {
    return { text: `Closed • Opens tomorrow`, isOpenNow: false };
  }
};

// Format time from HH:MM to readable format
const formatTime = (time: string): string => {
  const [hour, minute] = time.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return minute === 0 ? `${displayHour} ${period}` : `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
};

const HipcampCard = memo(({ farmstand, isFavorite = false, onPress, onFavoritePress }: HipcampCardProps) => {
  const hoursStatus = getHoursStatus(farmstand.hours, farmstand.isOpen);

  const handleFavoritePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onFavoritePress?.();
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        marginRight: CARD_SPACING,
        backgroundColor: '#fff',
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: 'rgba(0, 0, 0, 1)',
        shadowOffset: { width: 0, height: pressed ? 3 : 1 },
        shadowOpacity: pressed ? 0.10 : 0.06,
        shadowRadius: pressed ? 10 : 4,
        elevation: pressed ? 6 : 2,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      {/* Image Section - 65% of card */}
      <View style={{ height: CARD_HEIGHT * 0.65, position: 'relative' }}>
        <Image
          source={{ uri: farmstand.image }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />

        {/* Heart/Save Button */}
        <Pressable
          onPress={handleFavoritePress}
          hitSlop={12}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.35,
            shadowRadius: 3,
            elevation: 4,
          }}
        >
          <Heart
            size={26}
            color="#FFFFFF"
            fill={isFavorite ? '#4A7C59' : 'transparent'}
            strokeWidth={2}
          />
        </Pressable>

        {/* Map Pill (optional Hipcamp style) */}
        <View
          style={{
            position: 'absolute',
            bottom: 10,
            left: '50%',
            transform: [{ translateX: -30 }],
            backgroundColor: 'rgba(255,255,255,0.95)',
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 14,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Navigation size={12} color="#2D5A3D" />
          <Text style={{ color: '#2D5A3D', fontSize: 11, fontWeight: '600', marginLeft: 4 }}>
            {farmstand.distance} mi
          </Text>
        </View>
      </View>

      {/* Content Section - 35% of card */}
      <View style={{ flex: 1, padding: 14, justifyContent: 'space-between' }}>
        {/* Name */}
        <Text
          numberOfLines={1}
          style={{
            fontSize: 17,
            fontWeight: '700',
            color: '#3D3D3D',
            marginBottom: 4,
          }}
        >
          {farmstand.name}
        </Text>

        {/* Categories/Products */}
        <Text
          numberOfLines={1}
          style={{
            fontSize: 13,
            color: '#8B6F4E',
            marginBottom: 6,
          }}
        >
          {farmstand.products.slice(0, 3).join(' • ')}
        </Text>

        {/* Hours Status */}
        <Text
          numberOfLines={1}
          style={{
            fontSize: 12,
            color: hoursStatus.isOpenNow ? '#2D5A3D' : '#8B6F4E',
            fontWeight: '500',
          }}
        >
          {hoursStatus.text}
        </Text>
      </View>
    </Pressable>
  );
});

HipcampCard.displayName = 'HipcampCard';

export default HipcampCard;
