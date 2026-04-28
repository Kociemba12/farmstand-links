import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, MapPin, Navigation } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFarmerStore, Farmstand } from '@/lib/farmer-store';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

export default function UpdateLocationScreen() {
  const router = useRouter();
  const { farmstandId } = useLocalSearchParams<{ farmstandId: string }>();

  const getFarmstandById = useFarmerStore((s) => s.getFarmstandById);
  const updateFarmstand = useFarmerStore((s) => s.updateFarmstand);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  // Form state
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('OR');
  const [zip, setZip] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  useEffect(() => {
    if (farmstandId) {
      const farmstand = getFarmstandById(farmstandId);
      if (farmstand) {
        setAddressLine1(farmstand.addressLine1 || '');
        setCity(farmstand.city || '');
        setState(farmstand.state || 'OR');
        setZip(farmstand.zip || '');
        setLatitude(farmstand.latitude);
        setLongitude(farmstand.longitude);
      }
      setIsLoading(false);
    }
  }, [farmstandId, getFarmstandById]);

  const handleBack = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  const handleUseCurrentLocation = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGettingLocation(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please enable location services to use this feature.'
        );
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      setLatitude(location.coords.latitude);
      setLongitude(location.coords.longitude);

      // Try to get address from coordinates
      try {
        const [address] = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });

        if (address) {
          if (address.street) setAddressLine1(address.street);
          if (address.city) setCity(address.city);
          if (address.region) setState(address.region);
          if (address.postalCode) setZip(address.postalCode);
        }
      } catch (geocodeError) {
        console.log('Geocoding failed:', geocodeError);
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Error', 'Failed to get your location. Please try again.');
    } finally {
      setIsGettingLocation(false);
    }
  };

  const handleSave = async () => {
    if (!city.trim()) {
      Alert.alert('Required', 'Please enter at least a city.');
      return;
    }

    setIsSaving(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updateFarmstand(farmstandId!, {
        addressLine1: addressLine1.trim() || null,
        city: city.trim() || null,
        state: state || null,
        zip: zip.trim() || null,
        latitude,
        longitude,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Your location has been updated.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert('Error', 'Failed to save location. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center px-4 py-4">
          <Pressable onPress={handleBack} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#FDF8F3" />
          </Pressable>
          <Text className="text-cream text-xl font-bold ml-2">Update Location</Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-5 py-6">
          {/* Use Current Location */}
          <Pressable
            onPress={handleUseCurrentLocation}
            disabled={isGettingLocation}
            className="bg-forest rounded-2xl p-4 mb-6 flex-row items-center justify-center"
          >
            {isGettingLocation ? (
              <ActivityIndicator color="#FDF8F3" />
            ) : (
              <>
                <Navigation size={20} color="#FDF8F3" />
                <Text className="text-cream font-semibold ml-2">Use Current Location</Text>
              </>
            )}
          </Pressable>

          {/* Current Coordinates */}
          {latitude && longitude && (
            <View className="bg-mint/10 rounded-2xl p-4 mb-6 border border-mint/30">
              <View className="flex-row items-center">
                <MapPin size={20} color="#2D5A3D" />
                <Text className="text-forest font-medium ml-2">Location Set</Text>
              </View>
              <Text className="text-bark text-sm mt-2">
                Coordinates: {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </Text>
            </View>
          )}

          {/* Address Form */}
          <Text className="text-charcoal font-bold text-lg mb-3">Address</Text>
          <View className="bg-white rounded-2xl p-4 border border-sand mb-6">
            <View className="mb-4">
              <Text className="text-charcoal font-medium mb-2">Street Address</Text>
              <TextInput
                className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand"
                value={addressLine1}
                onChangeText={setAddressLine1}
                placeholder="123 Farm Road"
                placeholderTextColor="#8B6F4E"
              />
            </View>

            <View className="mb-4">
              <Text className="text-charcoal font-medium mb-2">City *</Text>
              <TextInput
                className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand"
                value={city}
                onChangeText={setCity}
                placeholder="Portland"
                placeholderTextColor="#8B6F4E"
              />
            </View>

            <View className="flex-row mb-4">
              <View className="flex-1 mr-2">
                <Text className="text-charcoal font-medium mb-2">State</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  nestedScrollEnabled={true}
                  style={{ flexGrow: 0 }}
                >
                  {US_STATES.filter((s) => ['OR', 'WA', 'CA', 'ID'].includes(s) || s === state).map(
                    (s) => (
                      <Pressable
                        key={s}
                        onPress={() => setState(s)}
                        className={`px-4 py-2 rounded-lg mr-2 ${
                          state === s ? 'bg-forest' : 'bg-cream border border-sand'
                        }`}
                      >
                        <Text
                          className={state === s ? 'text-cream font-medium' : 'text-charcoal'}
                        >
                          {s}
                        </Text>
                      </Pressable>
                    )
                  )}
                </ScrollView>
              </View>
            </View>

            <View>
              <Text className="text-charcoal font-medium mb-2">ZIP Code</Text>
              <TextInput
                className="bg-cream rounded-xl px-4 py-3 text-charcoal border border-sand"
                value={zip}
                onChangeText={setZip}
                placeholder="97201"
                placeholderTextColor="#8B6F4E"
                keyboardType="number-pad"
                maxLength={5}
              />
            </View>
          </View>

          {/* Tips */}
          <View className="bg-terracotta/10 rounded-2xl p-4 border border-terracotta/30">
            <View className="flex-row items-start">
              <MapPin size={20} color="#C4653A" />
              <View className="ml-3 flex-1">
                <Text className="text-charcoal font-semibold mb-1">Why Location Matters</Text>
                <Text className="text-bark text-sm">
                  An accurate location helps customers find you on the map. Using your current
                  location ensures the pin is placed exactly where your farm stand is.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Save Button */}
      <SafeAreaView edges={['bottom']} className="bg-cream border-t border-sand">
        <View className="px-5 py-4">
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className={`py-4 rounded-xl items-center ${
              isSaving ? 'bg-sand' : 'bg-forest'
            }`}
          >
            {isSaving ? (
              <ActivityIndicator color="#FDF8F3" />
            ) : (
              <Text className="text-cream font-semibold text-lg">Save Location</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
