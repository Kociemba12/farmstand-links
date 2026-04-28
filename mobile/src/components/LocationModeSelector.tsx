/**
 * LocationModeSelector - Segmented control for choosing location input mode
 */

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MapPin, Navigation, Crosshair } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

export type LocationMode = 'exact_address' | 'cross_streets' | 'use_my_location';

interface LocationModeSelectorProps {
  value: LocationMode;
  onChange: (mode: LocationMode) => void;
}

export function LocationModeSelector({ value, onChange }: LocationModeSelectorProps) {
  const handlePress = (mode: LocationMode) => {
    if (mode !== value) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange(mode);
    }
  };

  const getIcon = (mode: LocationMode, isSelected: boolean) => {
    const color = isSelected ? '#2D5A3D' : '#8B6F4E';
    switch (mode) {
      case 'exact_address':
        return <MapPin size={16} color={color} />;
      case 'cross_streets':
        return <Navigation size={16} color={color} />;
      case 'use_my_location':
        return <Crosshair size={16} color={color} />;
    }
  };

  const getLabel = (mode: LocationMode) => {
    switch (mode) {
      case 'exact_address':
        return 'Exact address';
      case 'cross_streets':
        return 'Cross streets';
      case 'use_my_location':
        return 'Use my location';
    }
  };

  const modes: LocationMode[] = ['exact_address', 'cross_streets', 'use_my_location'];

  return (
    <View className="mb-5">
      <Text className="text-charcoal font-medium mb-2 text-sm">Location type</Text>
      <View className="flex-row bg-sand/30 rounded-xl p-1">
        {modes.map((mode) => {
          const isSelected = value === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => handlePress(mode)}
              className={`flex-1 flex-row items-center justify-center py-3 px-2 rounded-lg ${
                isSelected ? 'bg-white' : ''
              }`}
              style={
                isSelected
                  ? {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.1,
                      shadowRadius: 2,
                      elevation: 2,
                    }
                  : undefined
              }
            >
              <View style={{ opacity: isSelected ? 1 : 0.5 }}>
                {getIcon(mode, isSelected)}
              </View>
              <Text
                className={`ml-1.5 text-xs font-medium ${
                  isSelected ? 'text-forest' : 'text-wood'
                }`}
                numberOfLines={1}
              >
                {getLabel(mode)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
