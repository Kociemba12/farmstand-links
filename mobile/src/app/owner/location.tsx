import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, Region, MapPressEvent } from 'react-native-maps';
import {
  ArrowLeft,
  Save,
  MapPin,
  Navigation,
  Car,
  ExternalLink,
  Crosshair,
  Locate,
  Check,
  AlertTriangle,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useUserStore } from '@/lib/user-store';
import { useAdminStore } from '@/lib/admin-store';
import { useProductsStore } from '@/lib/products-store';
import { logFarmstandEdit } from '@/lib/analytics-events';
import { Farmstand } from '@/lib/farmer-store';
import { FarmerRouteGuard } from '@/components/FarmerRouteGuard';
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';

// Map Picker Modal Component
interface MapPickerModalProps {
  visible: boolean;
  initialLat: number | null;
  initialLng: number | null;
  farmstandName: string;
  onClose: () => void;
  onSave: (lat: number, lng: number) => void;
}

function MapPickerModal({
  visible,
  initialLat,
  initialLng,
  farmstandName,
  onClose,
  onSave,
}: MapPickerModalProps) {
  const mapRef = useRef<MapView>(null);
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Reset selected coords when modal opens
  useEffect(() => {
    if (visible) {
      setSelectedCoords({
        lat: initialLat ?? 44.0,
        lng: initialLng ?? -120.5,
      });
    }
  }, [visible, initialLat, initialLng]);

  const initialRegion: Region = {
    latitude: initialLat ?? 44.0,
    longitude: initialLng ?? -120.5,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  };

  const handleMapPress = (event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCoords({ lat: latitude, lng: longitude });
  };

  const handleRecenter = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mapRef.current && initialLat && initialLng) {
      mapRef.current.animateToRegion(
        {
          latitude: initialLat,
          longitude: initialLng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500
      );
    }
  };

  const handleSavePin = () => {
    if (selectedCoords) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSave(selectedCoords.lat, selectedCoords.lng);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={modalStyles.container}>
        {/* Header */}
        <SafeAreaView edges={['top']} style={modalStyles.header}>
          <Pressable onPress={onClose} style={modalStyles.backButton}>
            <ArrowLeft size={24} color="#3D3D3D" />
          </Pressable>
          <View style={modalStyles.headerContent}>
            <Text style={modalStyles.title}>Adjust Pin Location</Text>
            <Text style={modalStyles.subtitle} numberOfLines={1}>
              {farmstandName}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </SafeAreaView>

        {/* Map */}
        <View style={modalStyles.mapContainer}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={initialRegion}
            onPress={handleMapPress}
            scrollEnabled={true}
            zoomEnabled={true}
            rotateEnabled={true}
            pitchEnabled={false}
            showsUserLocation={true}
            showsMyLocationButton={false}
            showsCompass={true}
            showsScale={true}
          >
            {/* Original Pin (gray/faded) */}
            {initialLat && initialLng && (
              <Marker
                coordinate={{
                  latitude: initialLat,
                  longitude: initialLng,
                }}
                opacity={0.4}
              >
                <View style={modalStyles.originalPinMarker}>
                  <MapPin size={24} color="#9CA3AF" />
                </View>
              </Marker>
            )}

            {/* New Selected Pin */}
            {selectedCoords && (
              <Marker
                coordinate={{
                  latitude: selectedCoords.lat,
                  longitude: selectedCoords.lng,
                }}
                draggable
                onDragEnd={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  setSelectedCoords({ lat: latitude, lng: longitude });
                }}
              >
                <FarmstandPinMarker />
              </Marker>
            )}
          </MapView>

          {/* Center Crosshair */}
          <View style={modalStyles.crosshairContainer} pointerEvents="none">
            <View style={modalStyles.crosshairVertical} />
            <View style={modalStyles.crosshairHorizontal} />
          </View>

          {/* Map Controls */}
          <View style={modalStyles.mapControls}>
            <Pressable onPress={handleRecenter} style={modalStyles.mapControlButton}>
              <Locate size={22} color="#3D3D3D" />
            </Pressable>
          </View>

          {/* Instructions */}
          <View style={modalStyles.instructionsOverlay}>
            <Text style={modalStyles.instructionsText}>
              Tap on the map or drag the pin to set the exact location
            </Text>
          </View>
        </View>

        {/* Coordinates Display */}
        {selectedCoords && (
          <View style={modalStyles.coordsDisplay}>
            <Navigation size={16} color="#2D5A3D" />
            <Text style={modalStyles.coordsText}>
              {selectedCoords.lat.toFixed(6)}, {selectedCoords.lng.toFixed(6)}
            </Text>
          </View>
        )}

        {/* Pending Verification Warning */}
        <View style={modalStyles.warningBanner}>
          <AlertTriangle size={16} color="#D97706" />
          <Text style={modalStyles.warningText}>
            Manual pin changes require admin verification
          </Text>
        </View>

        {/* Bottom Actions */}
        <SafeAreaView edges={['bottom']} style={modalStyles.footer}>
          <Pressable onPress={onClose} style={modalStyles.cancelButton}>
            <Text style={modalStyles.cancelButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSavePin}
            style={[modalStyles.saveButton, !selectedCoords && modalStyles.saveButtonDisabled]}
            disabled={!selectedCoords}
          >
            <Check size={18} color="#FFFFFF" />
            <Text style={modalStyles.saveButtonText}>Save Pin</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function LocationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const farmstandId = params.id;

  const user = useUserStore((s) => s.user);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const isGuest = useUserStore((s) => s.isGuest);

  const getFarmstandById = useAdminStore((s) => s.getFarmstandById);
  const updateFarmstand = useAdminStore((s) => s.updateFarmstand);
  const loadAdminData = useAdminStore((s) => s.loadAdminData);

  const logEdit = useProductsStore((s) => s.logEdit);

  const isGuestUser = isGuest();

  const [farmstand, setFarmstand] = useState<Farmstand | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('OR');
  const [zip, setZip] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [directionsNotes, setDirectionsNotes] = useState('');
  const [parkingNotes, setParkingNotes] = useState('');
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  // Map picker modal state
  const [showMapPicker, setShowMapPicker] = useState(false);

  // Map preview ref
  const mapPreviewRef = useRef<MapView>(null);

  // Check authorization
  useEffect(() => {
    if (!isLoggedIn) {
      router.replace('/auth/login');
    }
  }, [isLoggedIn]);

  // Load data
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await loadAdminData();

      if (farmstandId) {
        const fs = getFarmstandById(farmstandId);
        if (fs) {
          // Verify ownership
          if (fs.ownerUserId !== user?.id && fs.ownerUserId !== user?.email) {
            Alert.alert('Unauthorized', 'You do not have permission to edit this farmstand.', [
              { text: 'OK', onPress: () => router.back() },
            ]);
            return;
          }
          setFarmstand(fs);
          setAddressLine1(fs.addressLine1 || '');
          setCity(fs.city || '');
          setState(fs.state || 'OR');
          setZip(fs.zip || '');
          setLatitude(fs.latitude?.toString() || '');
          setLongitude(fs.longitude?.toString() || '');
          setDirectionsNotes(fs.directionsNotes || '');
          setParkingNotes(fs.parkingNotes || '');
        }
      }
      setIsLoading(false);
    };

    load();
  }, [farmstandId]);

  // Auto-geocode address
  const autoGeocode = useCallback(
    async (street: string, cityVal: string, stateVal: string, zipVal: string) => {
      const addressParts: string[] = [];
      if (street.trim()) addressParts.push(street.trim());
      if (cityVal.trim()) addressParts.push(cityVal.trim());
      if (stateVal.trim()) addressParts.push(stateVal.trim());
      if (zipVal.trim()) addressParts.push(zipVal.trim());

      if (addressParts.length < 2) return;

      const fullAddress = addressParts.join(', ');
      setIsGeocoding(true);
      setGeocodeError(null);

      try {
        const results = await Location.geocodeAsync(fullAddress);
        if (results.length > 0) {
          const { latitude: lat, longitude: lng } = results[0];
          setLatitude(lat.toFixed(6));
          setLongitude(lng.toFixed(6));

          // If ZIP was missing, try reverse geocode to get it
          if (!zipVal) {
            try {
              const reverseResults = await Location.reverseGeocodeAsync({
                latitude: lat,
                longitude: lng,
              });
              if (reverseResults.length > 0 && reverseResults[0].postalCode) {
                setZip(reverseResults[0].postalCode || '');
              }
            } catch {
              // Silently fail ZIP lookup
            }
          }

          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          setGeocodeError("Couldn't find coordinates for this address");
        }
      } catch (error) {
        console.error('Geocoding error:', error);
        setGeocodeError('Failed to look up coordinates');
      } finally {
        setIsGeocoding(false);
      }
    },
    []
  );

  // Parse address from iOS keyboard autocomplete selection
  const parseAndSetAddress = useCallback(
    async (fullAddress: string) => {
      const trimmed = fullAddress.trim();
      const parts = trimmed.split(',').map((p) => p.trim());

      if (parts.length >= 2) {
        const street = parts[0];
        const lastPart = parts[parts.length - 1];
        let cityVal = '';
        let stateZip = lastPart;

        if (parts.length >= 3) {
          cityVal = parts[1];
          stateZip = parts[parts.length - 1];
        } else {
          stateZip = lastPart;
        }

        const stateZipMatch = stateZip.match(/([A-Z]{2})\s*(\d{5})?/i);
        let stateVal = state || 'OR';
        let zipVal = '';

        if (stateZipMatch) {
          stateVal = stateZipMatch[1].toUpperCase();
          zipVal = stateZipMatch[2] || '';
          if (!cityVal) {
            cityVal = stateZip.replace(stateZipMatch[0], '').trim();
          }
        } else if (!cityVal) {
          cityVal = stateZip;
        }

        setAddressLine1(street);
        setCity(cityVal);
        setState(stateVal);
        setZip(zipVal);

        await autoGeocode(street, cityVal, stateVal, zipVal);
      } else {
        setAddressLine1(trimmed);
      }
    },
    [state, autoGeocode]
  );

  // Handle address field change - detect autocomplete selection
  const handleAddressChange = useCallback(
    (text: string) => {
      const hasComma = text.includes(',');
      const hasStatePattern = /[A-Z]{2}\s*\d{5}|,\s*[A-Z]{2}(?:\s|$)/i.test(text);

      if (hasComma || hasStatePattern) {
        parseAndSetAddress(text);
      } else {
        setAddressLine1(text);
      }
    },
    [parseAndSetAddress]
  );

  // Handle city change with auto-geocode
  const handleCityChange = useCallback(
    (text: string) => {
      setCity(text);
      if (addressLine1 && text && state) {
        setTimeout(() => autoGeocode(addressLine1, text, state, zip), 500);
      }
    },
    [addressLine1, state, zip, autoGeocode]
  );

  // Handle state change with auto-geocode
  const handleStateChange = useCallback(
    (text: string) => {
      const upperText = text.toUpperCase();
      setState(upperText);
      if (addressLine1 && city && upperText.length === 2) {
        setTimeout(() => autoGeocode(addressLine1, city, upperText, zip), 500);
      }
    },
    [addressLine1, city, zip, autoGeocode]
  );

  const handleUseCurrentLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow location access to use this feature.');
      return;
    }

    try {
      setIsGeocoding(true);
      const location = await Location.getCurrentPositionAsync({});
      setLatitude(location.coords.latitude.toFixed(6));
      setLongitude(location.coords.longitude.toFixed(6));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Reverse geocode to get address
      const addresses = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      if (addresses.length > 0) {
        const addr = addresses[0];
        if (addr.street) setAddressLine1(addr.street);
        if (addr.city) setCity(addr.city);
        if (addr.region) setState(addr.region);
        if (addr.postalCode) setZip(addr.postalCode);
      }
    } catch (error) {
      console.error('Location error:', error);
      Alert.alert('Error', 'Failed to get current location.');
    } finally {
      setIsGeocoding(false);
    }
  };

  const openInMaps = () => {
    if (!latitude || !longitude) {
      Alert.alert('No Coordinates', 'Please set coordinates first.');
      return;
    }

    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    Linking.openURL(url);
  };

  // Handle pin adjustment from map picker
  const handlePinAdjusted = (lat: number, lng: number) => {
    setLatitude(lat.toFixed(6));
    setLongitude(lng.toFixed(6));
    setShowMapPicker(false);
  };

  // Recenter map preview
  const handleRecenterPreview = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (mapPreviewRef.current && latitude && longitude) {
      mapPreviewRef.current.animateToRegion(
        {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500
      );
    }
  };

  const handleSave = async () => {
    if (!farmstandId || !user?.id || !farmstand) return;

    setIsSaving(true);

    try {
      // Check if coordinates changed manually
      const coordsChanged =
        farmstand.latitude?.toString() !== latitude ||
        farmstand.longitude?.toString() !== longitude;

      const updates: Partial<Farmstand> = {
        addressLine1: addressLine1.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zip: zip.trim() || null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        directionsNotes: directionsNotes.trim() || null,
        parkingNotes: parkingNotes.trim() || null,
      };

      // If user manually changed coordinates, mark for admin review
      if (coordsChanged && latitude && longitude) {
        updates.pinAdjustedByUser = true;
        updates.pinSource = 'manual_map_tap';
        updates.verificationStatus = 'PENDING_VERIFICATION';
        updates.locationPrecision = 'approximate_manual';
        updates.adminReviewReason = 'approx_location';
      }

      // Log changes
      const fieldsToCheck = [
        { key: 'addressLine1', old: farmstand.addressLine1, new: updates.addressLine1 },
        { key: 'city', old: farmstand.city, new: updates.city },
        { key: 'state', old: farmstand.state, new: updates.state },
        { key: 'zip', old: farmstand.zip, new: updates.zip },
        { key: 'latitude', old: farmstand.latitude?.toString(), new: latitude },
        { key: 'longitude', old: farmstand.longitude?.toString(), new: longitude },
        { key: 'directionsNotes', old: farmstand.directionsNotes, new: updates.directionsNotes },
        { key: 'parkingNotes', old: farmstand.parkingNotes, new: updates.parkingNotes },
      ];

      for (const field of fieldsToCheck) {
        if (field.old !== field.new) {
          await logEdit(
            farmstandId,
            field.key,
            field.old || null,
            (field.new as string) || null,
            user.id,
            'owner'
          );
        }
      }

      await updateFarmstand(farmstandId, updates);

      logFarmstandEdit(farmstandId, ['location'], user.id);

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Show different message if coordinates changed
      if (coordsChanged && latitude && longitude) {
        Alert.alert(
          'Location Updated',
          'Your pin has been updated and is pending verification by admin.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      } else {
        Alert.alert('Saved', 'Your location has been updated!', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('Error', 'Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Show guard for guests - AFTER all hooks
  if (isGuestUser) {
    return <FarmerRouteGuard title="Update Location" />;
  }

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#2D5A3D" />
      </View>
    );
  }

  const hasCoordinates = latitude && longitude;
  const mapRegion: Region | undefined = hasCoordinates
    ? {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    : undefined;

  return (
    <View className="flex-1 bg-gray-50">
      <SafeAreaView edges={['top']} className="bg-forest">
        <View className="flex-row items-center justify-between px-5 py-4">
          <Pressable onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="white" />
          </Pressable>
          <Text className="text-lg font-semibold text-white">Location</Text>
          <View className="w-10" />
        </View>
      </SafeAreaView>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Map Preview Section */}
        {hasCoordinates && (
          <Animated.View entering={FadeInDown.delay(0)} className="mx-4 mt-4">
            <View className="flex-row items-center mb-3">
              <MapPin size={18} color="#6b7280" />
              <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">
                Location on Map
              </Text>
            </View>

            <View className="bg-white rounded-2xl overflow-hidden border border-gray-100">
              {/* Interactive Map */}
              <View style={{ height: 200 }}>
                <MapView
                  ref={mapPreviewRef}
                  style={StyleSheet.absoluteFillObject}
                  initialRegion={mapRegion}
                  scrollEnabled={true}
                  zoomEnabled={true}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  showsCompass={true}
                  showsScale={true}
                >
                  <Marker
                    coordinate={{
                      latitude: parseFloat(latitude),
                      longitude: parseFloat(longitude),
                    }}
                  >
                    <FarmstandPinMarker />
                  </Marker>
                </MapView>

                {/* Recenter Button */}
                <Pressable
                  onPress={handleRecenterPreview}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: 'rgba(255,255,255,0.95)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.15,
                    shadowRadius: 2,
                    elevation: 2,
                  }}
                >
                  <Locate size={18} color="#3D3D3D" />
                </Pressable>

                {/* Coordinates Overlay */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'rgba(255,255,255,0.95)',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 8,
                  }}
                >
                  <Navigation size={14} color="#6B7280" />
                  <Text style={{ fontSize: 11, color: '#6B7280', marginLeft: 4 }}>
                    {latitude}, {longitude}
                  </Text>
                </View>
              </View>

              {/* Adjust Pin Button */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setShowMapPicker(true);
                }}
                className="flex-row items-center justify-center py-3 border-t border-gray-100"
              >
                <Crosshair size={18} color="#4338ca" />
                <Text className="text-indigo-700 font-semibold text-sm ml-2">Adjust Pin</Text>
              </Pressable>
            </View>

            {/* Verification Status Banner */}
            {farmstand?.verificationStatus === 'PENDING_VERIFICATION' && (
              <View className="flex-row items-center bg-amber-50 rounded-xl p-3 mt-3 border border-amber-200">
                <AlertTriangle size={16} color="#D97706" />
                <Text className="text-amber-700 text-sm ml-2 flex-1">
                  Location pending verification by admin
                </Text>
              </View>
            )}
          </Animated.View>
        )}

        {/* Address Section */}
        <Animated.View entering={FadeInDown.delay(100)} className="mx-4 mt-4">
          <View className="flex-row items-center mb-3">
            <MapPin size={18} color="#6b7280" />
            <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">Address</Text>
          </View>

          <View className="bg-white rounded-2xl p-4 border border-gray-100">
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-1">Street Address</Text>
              <Text className="text-xs text-gray-500 mb-2">
                Select from keyboard suggestions to auto-fill
              </Text>
              <TextInput
                value={addressLine1}
                onChangeText={handleAddressChange}
                placeholder="Start typing address..."
                placeholderTextColor="#9ca3af"
                className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                textContentType="streetAddressLine1"
                autoComplete="street-address"
              />
            </View>

            <View className="flex-row mb-4">
              <View className="flex-1 mr-2">
                <Text className="text-sm font-medium text-gray-700 mb-2">City</Text>
                <TextInput
                  value={city}
                  onChangeText={handleCityChange}
                  placeholder="City"
                  placeholderTextColor="#9ca3af"
                  className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                  textContentType="addressCity"
                />
              </View>
              <View className="w-20 mr-2">
                <Text className="text-sm font-medium text-gray-700 mb-2">State</Text>
                <TextInput
                  value={state}
                  onChangeText={handleStateChange}
                  placeholder="OR"
                  placeholderTextColor="#9ca3af"
                  maxLength={2}
                  autoCapitalize="characters"
                  className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                  textContentType="addressState"
                />
              </View>
              <View className="w-24">
                <Text className="text-sm font-medium text-gray-700 mb-2">ZIP</Text>
                <TextInput
                  value={zip}
                  onChangeText={setZip}
                  placeholder="97XXX"
                  placeholderTextColor="#9ca3af"
                  keyboardType="numeric"
                  maxLength={5}
                  className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                  textContentType="postalCode"
                />
              </View>
            </View>

            {/* GPS Status */}
            <View className="bg-gray-50 rounded-xl p-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-gray-700">GPS Coordinates</Text>
                {isGeocoding && (
                  <View className="flex-row items-center">
                    <ActivityIndicator size="small" color="#2D5A3D" />
                    <Text className="text-green-700 text-xs ml-2">Finding...</Text>
                  </View>
                )}
              </View>
              {latitude && longitude ? (
                <Text className="text-green-700 text-sm mt-1">
                  {latitude}, {longitude}
                </Text>
              ) : geocodeError ? (
                <Text className="text-red-600 text-sm mt-1">{geocodeError}</Text>
              ) : (
                <Text className="text-gray-500 text-sm mt-1">
                  Auto-filled when address is complete
                </Text>
              )}
            </View>
          </View>
        </Animated.View>

        {/* Coordinates Section */}
        <Animated.View entering={FadeInDown.delay(200)} className="mx-4 mt-4">
          <Text className="text-sm font-semibold text-gray-500 uppercase mb-3">Map Coordinates</Text>

          <View className="bg-white rounded-2xl p-4 border border-gray-100">
            <View className="flex-row mb-4">
              <View className="flex-1 mr-2">
                <Text className="text-sm font-medium text-gray-700 mb-2">Latitude</Text>
                <TextInput
                  value={latitude}
                  onChangeText={setLatitude}
                  placeholder="45.5152"
                  placeholderTextColor="#9ca3af"
                  keyboardType="decimal-pad"
                  className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                />
              </View>
              <View className="flex-1 ml-2">
                <Text className="text-sm font-medium text-gray-700 mb-2">Longitude</Text>
                <TextInput
                  value={longitude}
                  onChangeText={setLongitude}
                  placeholder="-122.6784"
                  placeholderTextColor="#9ca3af"
                  keyboardType="decimal-pad"
                  className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
                />
              </View>
            </View>

            <View className="flex-row">
              <Pressable
                onPress={handleUseCurrentLocation}
                disabled={isGeocoding}
                className="flex-1 flex-row items-center justify-center bg-green-50 border border-green-200 rounded-xl py-3 mr-2"
              >
                <Navigation size={18} color="#16a34a" />
                <Text className="text-green-700 font-medium text-sm ml-2">Use My Location</Text>
              </Pressable>
              {hasCoordinates && (
                <Pressable
                  onPress={openInMaps}
                  className="flex-1 flex-row items-center justify-center bg-gray-50 border border-gray-200 rounded-xl py-3 ml-2"
                >
                  <ExternalLink size={18} color="#6b7280" />
                  <Text className="text-gray-700 font-medium text-sm ml-2">View in Maps</Text>
                </Pressable>
              )}
            </View>

            {!hasCoordinates && (
              <View className="mt-3 bg-amber-50 rounded-xl p-3">
                <Text className="text-amber-700 text-sm">
                  Coordinates are required for your farmstand to appear on the map.
                </Text>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Directions Notes */}
        <Animated.View entering={FadeInDown.delay(300)} className="mx-4 mt-4">
          <View className="flex-row items-center mb-3">
            <Navigation size={18} color="#6b7280" />
            <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">Directions</Text>
          </View>

          <View className="bg-white rounded-2xl p-4 border border-gray-100">
            <Text className="text-gray-500 text-sm mb-3">
              Help customers find you with specific directions
            </Text>
            <TextInput
              value={directionsNotes}
              onChangeText={setDirectionsNotes}
              placeholder="e.g., Turn left at the red barn, go 0.5 miles down the gravel road. We're on the right side."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900 min-h-[100px]"
            />
          </View>
        </Animated.View>

        {/* Parking Notes */}
        <Animated.View entering={FadeInDown.delay(400)} className="mx-4 mt-4">
          <View className="flex-row items-center mb-3">
            <Car size={18} color="#6b7280" />
            <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">Parking</Text>
          </View>

          <View className="bg-white rounded-2xl p-4 border border-gray-100">
            <Text className="text-gray-500 text-sm mb-3">
              Let customers know where to park when they arrive
            </Text>
            <TextInput
              value={parkingNotes}
              onChangeText={setParkingNotes}
              placeholder="e.g., Park along the driveway, not on the grass. There's room for 3-4 cars."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900 min-h-[80px]"
            />
          </View>
        </Animated.View>
      </ScrollView>

      {/* Save Button */}
      <SafeAreaView edges={['bottom']} className="bg-white border-t border-gray-100">
        <View className="px-5 py-4">
          <Pressable
            onPress={handleSave}
            disabled={isSaving}
            className="bg-forest py-4 rounded-xl items-center flex-row justify-center"
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <>
                <Save size={20} color="white" />
                <Text className="text-white font-semibold text-base ml-2">Save Location</Text>
              </>
            )}
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Map Picker Modal */}
      <MapPickerModal
        visible={showMapPicker}
        initialLat={latitude ? parseFloat(latitude) : null}
        initialLng={longitude ? parseFloat(longitude) : null}
        farmstandName={farmstand?.name || 'Your Farmstand'}
        onClose={() => setShowMapPicker(false)}
        onSave={handlePinAdjusted}
      />
    </View>
  );
}

// Modal styles
const modalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E8DDD4',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContent: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#3D3D3D',
  },
  subtitle: {
    fontSize: 13,
    color: '#8B6F4E',
    marginTop: 2,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  crosshairContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginLeft: -20,
    marginTop: -20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 40,
    backgroundColor: 'rgba(45, 90, 61, 0.4)',
    borderRadius: 1,
  },
  crosshairHorizontal: {
    position: 'absolute',
    width: 40,
    height: 2,
    backgroundColor: 'rgba(45, 90, 61, 0.4)',
    borderRadius: 1,
  },
  mapControls: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  mapControlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  instructionsOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 76,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  instructionsText: {
    fontSize: 13,
    color: '#3D3D3D',
    textAlign: 'center',
  },
  originalPinMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coordsDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8DDD4',
    gap: 8,
  },
  coordsText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#2D5A3D',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: '#FEF3C7',
    gap: 8,
  },
  warningText: {
    fontSize: 13,
    color: '#D97706',
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E8DDD4',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F5F0EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#8B6F4E',
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2D5A3D',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    backgroundColor: '#A8A29E',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
