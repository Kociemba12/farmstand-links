import React from 'react';
import { View, Text, Pressable, Modal, useWindowDimensions } from 'react-native';
import { MapPin, Navigation } from 'lucide-react-native';
import Animated, { FadeIn, FadeInUp, FadeOut } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

interface LocationPermissionModalProps {
  visible: boolean;
  onEnableLocation: () => void;
  onNotNow: () => void;
}

export function LocationPermissionModal({
  visible,
  onEnableLocation,
  onNotNow,
}: LocationPermissionModalProps) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const handleEnableLocation = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onEnableLocation();
  };

  const handleNotNow = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onNotNow();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          justifyContent: isTablet ? 'center' : 'flex-end',
          alignItems: isTablet ? 'center' : 'stretch',
          backgroundColor: 'rgba(0,0,0,0.5)',
          paddingHorizontal: isTablet ? 40 : 0,
        }}
      >
        <Animated.View
          entering={FadeInUp.duration(400).springify()}
          exiting={FadeOut.duration(200)}
          style={{
            backgroundColor: '#FDF8F3',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            borderBottomLeftRadius: isTablet ? 24 : 0,
            borderBottomRightRadius: isTablet ? 24 : 0,
            overflow: 'hidden',
            paddingBottom: isTablet ? 32 : 40,
            width: '100%',
            maxWidth: isTablet ? 500 : undefined,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: isTablet ? 4 : -4 },
            shadowOpacity: 0.15,
            shadowRadius: 20,
            elevation: 10,
          }}
        >
          {/* Illustration Area */}
          <View className="items-center pt-8 pb-6">
            <LinearGradient
              colors={['#E8F5E9', '#C8E6C9']}
              style={{
                width: 100,
                height: 100,
                borderRadius: 50,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View className="bg-forest w-16 h-16 rounded-full items-center justify-center">
                <MapPin size={32} color="#FDF8F3" />
              </View>
            </LinearGradient>
          </View>

          {/* Content */}
          <View className="px-6">
            <Text className="text-charcoal text-2xl font-bold text-center mb-3">
              Find Farmstands near you
            </Text>
            <Text className="text-wood text-base text-center leading-6 mb-8">
              We use your location to show nearby stands and accurate distances. You can change this anytime in Settings.
            </Text>

            {/* Features */}
            <View className="mb-8">
              <View className="flex-row items-center mb-4">
                <View className="bg-forest/10 w-10 h-10 rounded-xl items-center justify-center">
                  <Navigation size={18} color="#2D5A3D" />
                </View>
                <Text className="text-charcoal flex-1 ml-3">
                  See distances to each farmstand
                </Text>
              </View>
              <View className="flex-row items-center">
                <View className="bg-forest/10 w-10 h-10 rounded-xl items-center justify-center">
                  <MapPin size={18} color="#2D5A3D" />
                </View>
                <Text className="text-charcoal flex-1 ml-3">
                  Discover stands in your area first
                </Text>
              </View>
            </View>

            {/* Buttons */}
            <Pressable
              onPress={handleEnableLocation}
              className="bg-forest py-4 rounded-2xl mb-3 active:opacity-90"
              style={{
                shadowColor: '#2D5A3D',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.2,
                shadowRadius: 8,
                elevation: 4,
              }}
            >
              <Text className="text-cream text-center font-semibold text-lg">
                Enable Location
              </Text>
            </Pressable>

            <Pressable
              onPress={handleNotNow}
              className="py-4 rounded-2xl active:bg-sand/30"
            >
              <Text className="text-wood text-center font-medium text-base">
                Not Now
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
