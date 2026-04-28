import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Lock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

interface FarmerRouteGuardProps {
  title?: string;
}

/**
 * Shows a message when guests try to access farmer-only pages.
 * Use this component as early return when isGuest() is true.
 */
export function FarmerRouteGuard({ title = 'Farmer Tools' }: FarmerRouteGuardProps) {
  const router = useRouter();

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile');
    }
  };

  const handleGoToProfile = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace('/(tabs)/profile');
  };

  return (
    <View className="flex-1 bg-cream">
      <LinearGradient
        colors={['#2D5A3D', '#3D7A4D', '#4D8A5D']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ paddingTop: 0, paddingBottom: 32, paddingHorizontal: 20 }}
      >
        <SafeAreaView edges={['top']}>
          <View className="flex-row items-center mb-6">
            <Pressable onPress={handleBack} className="p-2 -ml-2">
              <ArrowLeft size={24} color="white" />
            </Pressable>
            <Text className="text-white text-xl font-bold ml-2">{title}</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View className="flex-1 items-center justify-center px-8">
        <View className="w-20 h-20 rounded-full bg-amber-100 items-center justify-center mb-6">
          <Lock size={36} color="#D97706" />
        </View>

        <Text className="text-stone-900 font-bold text-xl text-center mb-3">
          Farmer Tools Locked
        </Text>

        <Text className="text-stone-500 text-center text-base mb-8 leading-6">
          Farmer tools unlock after your Farmstand is claimed or verified.
        </Text>

        <Pressable
          onPress={handleGoToProfile}
          className="bg-forest px-6 py-3.5 rounded-xl active:opacity-80"
        >
          <Text className="text-white font-semibold text-base">Go to Profile</Text>
        </Pressable>
      </View>
    </View>
  );
}
