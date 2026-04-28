import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, MapPin, Navigation } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useUserStore } from '@/lib/user-store';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import Slider from '@react-native-community/slider';

export default function LocationScreen() {
  const router = useRouter();
  const location = useUserStore((s) => s.location);
  const updateLocation = useUserStore((s) => s.updateLocation);
  const [isLoading, setIsLoading] = useState(false);
  const [localRadius, setLocalRadius] = useState(location.searchRadius);

  const handleUseCurrentLocation = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Please enable location access in settings.');
        setIsLoading(false);
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({});
      const [address] = await Location.reverseGeocodeAsync({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });

      updateLocation({
        city: address?.city || 'Unknown',
        state: address?.region || 'OR',
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });

      Alert.alert('Location Updated', `Your location is now set to ${address?.city || 'your current location'}.`);
    } catch (error) {
      Alert.alert('Error', 'Unable to get your current location. Please try again.');
    }

    setIsLoading(false);
  };

  const handleRadiusChange = (value: number) => {
    setLocalRadius(Math.round(value));
  };

  const handleRadiusComplete = (value: number) => {
    const roundedValue = Math.round(value);
    setLocalRadius(roundedValue);
    updateLocation({ searchRadius: roundedValue });
  };

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Location</Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {/* Current Location */}
          <View className="bg-white rounded-2xl p-4 border border-sand mb-6">
            <View className="flex-row items-center">
              <View className="w-12 h-12 rounded-full bg-forest items-center justify-center">
                <MapPin size={24} color="#FDF8F3" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-wood text-sm">Current Location</Text>
                <Text className="text-charcoal font-bold text-lg">
                  {location.city}, {location.state}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={handleUseCurrentLocation}
              disabled={isLoading}
              className="flex-row items-center justify-center mt-4 py-3 bg-forest rounded-xl"
            >
              <Navigation size={18} color="#FDF8F3" />
              <Text className="text-cream font-medium ml-2">
                {isLoading ? 'Getting Location...' : 'Use Current Location'}
              </Text>
            </Pressable>
          </View>

          {/* Search Radius */}
          <View className="bg-white rounded-2xl p-4 border border-sand">
            <Text className="text-charcoal font-semibold mb-2">Search Radius</Text>
            <Text className="text-wood text-sm mb-4">
              Show farm stands within {localRadius} miles
            </Text>
            <Slider
              minimumValue={5}
              maximumValue={100}
              value={localRadius}
              onValueChange={handleRadiusChange}
              onSlidingComplete={handleRadiusComplete}
              minimumTrackTintColor="#2D5A3D"
              maximumTrackTintColor="#E8DDD4"
              thumbTintColor="#2D5A3D"
            />
            <View className="flex-row justify-between mt-2">
              <Text className="text-wood text-sm">5 mi</Text>
              <Text className="text-wood text-sm">100 mi</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
