import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { MapPin, X, Settings } from 'lucide-react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LocationPermissionStatus } from '@/lib/location-store';

interface LocationBannerProps {
  permissionStatus: LocationPermissionStatus;
  onEnable: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

export function LocationBanner({
  permissionStatus,
  onEnable,
  onOpenSettings,
  onDismiss,
}: LocationBannerProps) {
  const handleEnable = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onEnable();
  };

  const handleOpenSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenSettings();
  };

  const handleDismiss = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDismiss();
  };

  const isBlocked = permissionStatus === 'blocked';

  return (
    <Animated.View
      entering={FadeInDown.duration(300)}
      exiting={FadeOutUp.duration(200)}
      className="mx-5 mb-3"
    >
      <View
        className="bg-honey/15 border border-honey/30 rounded-2xl px-4 py-3 flex-row items-center"
        style={{
          shadowColor: '#D4A03B',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08,
          shadowRadius: 6,
          elevation: 2,
        }}
      >
        <View className="bg-honey/20 w-9 h-9 rounded-xl items-center justify-center">
          <MapPin size={18} color="#B8860B" />
        </View>

        <Text className="text-charcoal flex-1 text-sm ml-3" numberOfLines={2}>
          Turn on location to see Farmstands near you.
        </Text>

        <View className="flex-row items-center ml-2">
          {isBlocked ? (
            <Pressable
              onPress={handleOpenSettings}
              className="bg-forest px-3 py-2 rounded-xl flex-row items-center active:opacity-80"
            >
              <Settings size={14} color="#FDF8F3" />
              <Text className="text-cream text-xs font-semibold ml-1">Settings</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleEnable}
              className="bg-forest px-4 py-2 rounded-xl active:opacity-80"
            >
              <Text className="text-cream text-xs font-semibold">Enable</Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleDismiss}
            className="ml-2 p-1.5 active:opacity-60"
            hitSlop={8}
          >
            <X size={16} color="#8B6F4E" />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}
