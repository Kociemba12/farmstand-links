/**
 * AddressMapPicker - Unified address input with interactive map component
 *
 * Used in:
 * - Create Farmstand (farmer/onboarding.tsx)
 * - Admin → Manage Farmstands → Edit (admin/farmstand-edit.tsx)
 * - Admin → Pending Farmstands → Edit/Approve (admin/pending-approvals.tsx)
 *
 * Features:
 * - Address input fields (line 1, city, state, ZIP, country)
 * - "Locate on Map" button for geocoding
 * - "Use My Location" button for device GPS
 * - Interactive map with draggable pin
 * - Auto-geocode on field blur
 * - Status line showing pin source
 * - Reverse geocode on pin drag (optional)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import MapView, { Marker, Region, MapPressEvent } from 'react-native-maps';
import {
  MapPin,
  Crosshair,
  Search,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';
import {
  resolveFarmstandCoordinates,
  getDeviceCoordinates,
  GeocodeSource,
  GeocodeConfidence,
} from '@/lib/resolve-farmstand-coordinates';

// ============================================================================
// TYPES
// ============================================================================

export type AddressMapPickerSource = 'address' | 'pin_drag' | 'current_location' | 'manual';

export interface AddressMapPickerData {
  // Address fields
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  country: string;

  // Location outputs
  latitude: number | null;
  longitude: number | null;
  geocodeSource: AddressMapPickerSource;
  geocodeConfidence: GeocodeConfidence;
}

export interface AddressMapPickerProps {
  value: AddressMapPickerData;
  onChange: (data: AddressMapPickerData) => void;

  // Initial map region (defaults to Oregon)
  initialRegion?: Region;

  // Enable reverse geocoding when pin is dragged
  reverseGeocodeOnDrag?: boolean;

  // Custom labels
  labels?: {
    title?: string;
    subtitle?: string;
  };

  // Compact mode (less padding, for modals)
  compact?: boolean;
}

// ============================================================================
// DEFAULTS
// ============================================================================

const DEFAULT_REGION: Region = {
  latitude: 44.0,
  longitude: -120.5,
  latitudeDelta: 4,
  longitudeDelta: 4,
};

export const createDefaultAddressMapData = (
  defaults?: Partial<AddressMapPickerData>
): AddressMapPickerData => ({
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: 'OR',
  zip: '',
  country: 'US',
  latitude: null,
  longitude: null,
  geocodeSource: 'manual',
  geocodeConfidence: 'low',
  ...defaults,
});

// ============================================================================
// STATUS LINE COMPONENT
// ============================================================================

interface StatusLineProps {
  source: AddressMapPickerSource;
  confidence: GeocodeConfidence;
  hasCoordinates: boolean;
  isGeocoding: boolean;
  error: string | null;
}

function StatusLine({ source, confidence, hasCoordinates, isGeocoding, error }: StatusLineProps) {
  if (isGeocoding) {
    return (
      <Animated.View entering={FadeIn} className="flex-row items-center mt-3 px-1">
        <ActivityIndicator size="small" color="#2D5A3D" />
        <Text className="text-sm text-gray-600 ml-2">Finding location...</Text>
      </Animated.View>
    );
  }

  if (error) {
    return (
      <Animated.View entering={FadeIn} className="flex-row items-center mt-3 px-1 py-2 bg-amber-50 rounded-lg">
        <AlertTriangle size={16} color="#D97706" />
        <Text className="text-sm text-amber-700 ml-2 flex-1">{error}</Text>
      </Animated.View>
    );
  }

  if (!hasCoordinates) {
    return (
      <View className="flex-row items-center mt-3 px-1">
        <MapPin size={14} color="#9CA3AF" />
        <Text className="text-sm text-gray-500 ml-2">
          Enter address and click "Locate on Map" or drop a pin
        </Text>
      </View>
    );
  }

  const getStatusText = () => {
    switch (source) {
      case 'address':
        return 'Pin set from address';
      case 'pin_drag':
        return 'Pin adjusted manually';
      case 'current_location':
        return 'Using current location';
      case 'manual':
        return 'Coordinates entered manually';
      default:
        return 'Location set';
    }
  };

  const getConfidenceColor = () => {
    switch (confidence) {
      case 'high':
        return '#16A34A';
      case 'medium':
        return '#D97706';
      case 'low':
        return '#DC2626';
      default:
        return '#6B7280';
    }
  };

  return (
    <Animated.View entering={FadeIn} className="flex-row items-center mt-3 px-1">
      <CheckCircle2 size={14} color="#16A34A" />
      <Text className="text-sm text-green-700 ml-2">{getStatusText()}</Text>
      <View
        className="ml-2 px-2 py-0.5 rounded-full"
        style={{ backgroundColor: `${getConfidenceColor()}20` }}
      >
        <Text className="text-xs capitalize" style={{ color: getConfidenceColor() }}>
          {confidence}
        </Text>
      </View>
    </Animated.View>
  );
}

// ============================================================================
// MAP PREVIEW COMPONENT
// ============================================================================

interface MapPreviewProps {
  latitude: number | null;
  longitude: number | null;
  initialRegion: Region;
  onMapPress: (event: MapPressEvent) => void;
  onMarkerDragEnd: (lat: number, lng: number) => void;
  mapRef: React.RefObject<MapView | null>;
}

function MapPreview({
  latitude,
  longitude,
  initialRegion,
  onMapPress,
  onMarkerDragEnd,
  mapRef,
}: MapPreviewProps) {
  const hasPin = latitude !== null && longitude !== null;

  const handleMarkerDrag = useCallback(
    (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const { latitude: lat, longitude: lng } = event.nativeEvent.coordinate;
      onMarkerDragEnd(lat, lng);
    },
    [onMarkerDragEnd]
  );

  return (
    <View className="rounded-xl overflow-hidden border border-gray-200 mt-4">
      <View className="flex-row items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <Text className="text-sm font-medium text-gray-700">
          {hasPin ? 'Drag pin to fine-tune location' : 'Tap map to drop a pin'}
        </Text>
        {hasPin && (
          <Text className="text-xs text-gray-500">
            {latitude?.toFixed(5)}, {longitude?.toFixed(5)}
          </Text>
        )}
      </View>
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={
            latitude && longitude
              ? {
                  latitude,
                  longitude,
                  latitudeDelta: 0.02,
                  longitudeDelta: 0.02,
                }
              : initialRegion
          }
          onPress={onMapPress}
          showsUserLocation
          showsMyLocationButton={false}
        >
          {hasPin && (
            <Marker
              coordinate={{
                latitude: latitude!,
                longitude: longitude!,
              }}
              draggable
              onDragEnd={handleMarkerDrag}
            >
              <FarmstandPinMarker />
            </Marker>
          )}
        </MapView>

        {/* Tap to drop pin overlay */}
        {!hasPin && (
          <View style={styles.tapOverlay} pointerEvents="none">
            <View className="bg-white/90 px-4 py-2 rounded-full shadow-sm">
              <Text className="text-sm text-gray-700 font-medium">Tap to drop pin</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AddressMapPicker({
  value,
  onChange,
  initialRegion = DEFAULT_REGION,
  reverseGeocodeOnDrag = true,
  labels,
  compact = false,
}: AddressMapPickerProps) {
  const mapRef = useRef<MapView>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const geocodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editing flags to prevent geocode overwriting while typing
  const isEditingAddressRef = useRef(false);
  const isEditingCityRef = useRef(false);
  const isEditingStateRef = useRef(false);
  const isEditingZipRef = useRef(false);

  const hasCoordinates = value.latitude !== null && value.longitude !== null;

  // Cleanup
  useEffect(() => {
    return () => {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Geocoding
  // -------------------------------------------------------------------------
  const geocodeAddress = useCallback(async () => {
    // Skip if fields are being actively edited
    if (
      isEditingAddressRef.current ||
      isEditingCityRef.current ||
      isEditingStateRef.current ||
      isEditingZipRef.current
    ) {
      return;
    }

    const { addressLine1, city, state, zip } = value;

    // Need at least street + city or street + state
    if (!addressLine1?.trim() || (!city?.trim() && !state?.trim())) {
      setGeocodeError("Enter a street address and city to locate on map.");
      return;
    }

    setIsGeocoding(true);
    setGeocodeError(null);

    try {
      const result = await resolveFarmstandCoordinates({
        addressLine1,
        city,
        state,
        zip,
      });

      if (result.latitude !== null && result.longitude !== null) {
        onChange({
          ...value,
          latitude: result.latitude,
          longitude: result.longitude,
          geocodeSource: 'address',
          geocodeConfidence: result.geocodeConfidence,
          ...(result.zip && !value.zip ? { zip: result.zip } : {}),
        });

        // Animate map to new location
        mapRef.current?.animateToRegion(
          {
            latitude: result.latitude,
            longitude: result.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          500
        );

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (result.error) {
        setGeocodeError(result.error);
      } else {
        setGeocodeError("Couldn't locate that address. Check spelling or drop the pin manually.");
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      setGeocodeError("Couldn't locate that address. Check spelling or drop the pin manually.");
    } finally {
      setIsGeocoding(false);
    }
  }, [value, onChange]);

  // Debounced geocode (for onBlur)
  const triggerDebouncedGeocode = useCallback(() => {
    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }

    geocodeTimeoutRef.current = setTimeout(() => {
      geocodeAddress();
    }, 600);
  }, [geocodeAddress]);

  // -------------------------------------------------------------------------
  // Use My Location
  // -------------------------------------------------------------------------
  const handleUseMyLocation = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGeocoding(true);
    setGeocodeError(null);

    const result = await getDeviceCoordinates();

    if (result.latitude !== null && result.longitude !== null) {
      onChange({
        ...value,
        latitude: result.latitude,
        longitude: result.longitude,
        geocodeSource: 'current_location',
        geocodeConfidence: 'high',
        ...(result.city ? { city: result.city } : {}),
        ...(result.state ? { state: result.state } : {}),
        ...(result.addressLine1 ? { addressLine1: result.addressLine1 } : {}),
        ...(result.zip ? { zip: result.zip } : {}),
      });

      // Animate map to new location
      mapRef.current?.animateToRegion(
        {
          latitude: result.latitude,
          longitude: result.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500
      );

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (result.error) {
      setGeocodeError(result.error);
    }

    setIsGeocoding(false);
  }, [value, onChange]);

  // -------------------------------------------------------------------------
  // Map Interactions
  // -------------------------------------------------------------------------
  const handleMapPress = useCallback(
    async (event: MapPressEvent) => {
      // Extract coordinates BEFORE any async calls - synthetic events are reused/nullified
      const { latitude: lat, longitude: lng } = event.nativeEvent.coordinate;
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      onChange({
        ...value,
        latitude: lat,
        longitude: lng,
        geocodeSource: 'pin_drag',
        geocodeConfidence: 'high',
      });

      setGeocodeError(null);

      // Optional: reverse geocode to fill address
      if (reverseGeocodeOnDrag) {
        try {
          const reverseResults = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
          if (reverseResults.length > 0) {
            const r = reverseResults[0];
            // Only fill empty fields
            onChange({
              ...value,
              latitude: lat,
              longitude: lng,
              geocodeSource: 'pin_drag',
              geocodeConfidence: 'high',
              ...(r.street && !value.addressLine1 ? { addressLine1: r.street } : {}),
              ...(r.city && !value.city ? { city: r.city } : {}),
              ...(r.region && !value.state ? { state: r.region } : {}),
              ...(r.postalCode && !value.zip ? { zip: r.postalCode } : {}),
            });
          }
        } catch {
          // Ignore reverse geocode errors
        }
      }
    },
    [value, onChange, reverseGeocodeOnDrag]
  );

  const handleMarkerDragEnd = useCallback(
    async (lat: number, lng: number) => {
      onChange({
        ...value,
        latitude: lat,
        longitude: lng,
        geocodeSource: 'pin_drag',
        geocodeConfidence: 'high',
      });

      // Optional: reverse geocode to update address fields
      if (reverseGeocodeOnDrag) {
        try {
          const reverseResults = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
          if (reverseResults.length > 0) {
            const r = reverseResults[0];
            // Only fill empty fields
            onChange({
              ...value,
              latitude: lat,
              longitude: lng,
              geocodeSource: 'pin_drag',
              geocodeConfidence: 'high',
              ...(r.street && !value.addressLine1 ? { addressLine1: r.street } : {}),
              ...(r.city && !value.city ? { city: r.city } : {}),
              ...(r.region && !value.state ? { state: r.region } : {}),
              ...(r.postalCode && !value.zip ? { zip: r.postalCode } : {}),
            });
          }
        } catch {
          // Ignore reverse geocode errors
        }
      }
    },
    [value, onChange, reverseGeocodeOnDrag]
  );

  // -------------------------------------------------------------------------
  // Field Handlers
  // -------------------------------------------------------------------------
  const handleAddressChange = useCallback(
    (text: string) => {
      // Check for full address paste (with commas or state pattern)
      const hasComma = text.includes(',');
      const hasStatePattern = /[A-Z]{2}\s*\d{5}|,\s*[A-Z]{2}(?:\s|$)/i.test(text);

      if (hasComma || hasStatePattern) {
        // Parse full address
        const parts = text.split(',').map((p) => p.trim());
        if (parts.length >= 2) {
          const street = parts[0];
          let parsedCity = '';
          let parsedState = value.state || 'OR';
          let parsedZip = '';

          if (parts.length >= 3) {
            parsedCity = parts[1];
            const lastPart = parts[parts.length - 1];
            const stateZipMatch = lastPart.match(/([A-Z]{2})\s*(\d{5})?/i);
            if (stateZipMatch) {
              parsedState = stateZipMatch[1].toUpperCase();
              parsedZip = stateZipMatch[2] || '';
            }
          } else {
            const lastPart = parts[1];
            const stateZipMatch = lastPart.match(/([A-Z]{2})\s*(\d{5})?/i);
            if (stateZipMatch) {
              parsedState = stateZipMatch[1].toUpperCase();
              parsedZip = stateZipMatch[2] || '';
              parsedCity = lastPart.replace(stateZipMatch[0], '').trim();
            } else {
              parsedCity = lastPart;
            }
          }

          onChange({
            ...value,
            addressLine1: street,
            city: parsedCity,
            state: parsedState,
            zip: parsedZip,
          });

          // Trigger geocode after parsing
          setTimeout(geocodeAddress, 100);
        } else {
          onChange({ ...value, addressLine1: text });
        }
      } else {
        onChange({ ...value, addressLine1: text });
      }
    },
    [value, onChange, geocodeAddress]
  );

  const handleAddressFocus = useCallback(() => {
    isEditingAddressRef.current = true;
  }, []);

  const handleAddressBlur = useCallback(() => {
    isEditingAddressRef.current = false;
    if (value.addressLine1 && value.city) {
      triggerDebouncedGeocode();
    }
  }, [value.addressLine1, value.city, triggerDebouncedGeocode]);

  const handleCityChange = useCallback(
    (text: string) => {
      onChange({ ...value, city: text });
    },
    [value, onChange]
  );

  const handleCityFocus = useCallback(() => {
    isEditingCityRef.current = true;
  }, []);

  const handleCityBlur = useCallback(() => {
    isEditingCityRef.current = false;
    if (value.city && value.state) {
      triggerDebouncedGeocode();
    }
  }, [value.city, value.state, triggerDebouncedGeocode]);

  const handleStateChange = useCallback(
    (text: string) => {
      onChange({ ...value, state: text.toUpperCase() });
    },
    [value, onChange]
  );

  const handleStateFocus = useCallback(() => {
    isEditingStateRef.current = true;
  }, []);

  const handleStateBlur = useCallback(() => {
    isEditingStateRef.current = false;
    if (value.state.length === 2 && value.city) {
      triggerDebouncedGeocode();
    }
  }, [value.state, value.city, triggerDebouncedGeocode]);

  const handleZipChange = useCallback(
    (text: string) => {
      onChange({ ...value, zip: text });
    },
    [value, onChange]
  );

  const handleZipFocus = useCallback(() => {
    isEditingZipRef.current = true;
  }, []);

  const handleZipBlur = useCallback(() => {
    isEditingZipRef.current = false;
  }, []);

  const padding = compact ? 'p-4' : 'p-5';

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  return (
    <View className={`bg-white rounded-2xl ${padding}`}>
      {/* Section Header */}
      {(labels?.title || labels?.subtitle) && (
        <View className="mb-4">
          <View className="flex-row items-center">
            <MapPin size={18} color="#6B7280" />
            <Text className="text-sm font-semibold text-gray-500 uppercase ml-2">
              {labels?.title || 'Location'}
            </Text>
          </View>
          {labels?.subtitle && (
            <Text className="text-xs text-amber-600 mt-1">{labels.subtitle}</Text>
          )}
        </View>
      )}

      {/* Address Line 1 */}
      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-1">Street Address</Text>
        <Text className="text-xs text-gray-500 mb-2">
          Select from keyboard suggestions to auto-fill
        </Text>
        <TextInput
          className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
          value={value.addressLine1}
          onChangeText={handleAddressChange}
          onFocus={handleAddressFocus}
          onBlur={handleAddressBlur}
          placeholder="Start typing address..."
          placeholderTextColor="#9CA3AF"
          textContentType="streetAddressLine1"
          autoComplete="street-address"
        />
      </View>

      {/* Address Line 2 (optional) */}
      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-2">
          Address Line 2 <Text className="text-gray-400">(optional)</Text>
        </Text>
        <TextInput
          className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
          value={value.addressLine2}
          onChangeText={(text) => onChange({ ...value, addressLine2: text })}
          placeholder="Apt, suite, unit, etc."
          placeholderTextColor="#9CA3AF"
          textContentType="streetAddressLine2"
        />
      </View>

      {/* City / State / ZIP Row */}
      <View className="flex-row mb-4" style={{ gap: 8 }}>
        <View className="flex-1">
          <Text className="text-sm font-medium text-gray-700 mb-2">City</Text>
          <TextInput
            className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
            value={value.city}
            onChangeText={handleCityChange}
            onFocus={handleCityFocus}
            onBlur={handleCityBlur}
            placeholder="City"
            placeholderTextColor="#9CA3AF"
            textContentType="addressCity"
          />
        </View>
        <View className="w-20">
          <Text className="text-sm font-medium text-gray-700 mb-2">State</Text>
          <TextInput
            className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900 text-center"
            value={value.state}
            onChangeText={handleStateChange}
            onFocus={handleStateFocus}
            onBlur={handleStateBlur}
            placeholder="OR"
            placeholderTextColor="#9CA3AF"
            maxLength={2}
            autoCapitalize="characters"
            textContentType="addressState"
          />
        </View>
        <View className="w-24">
          <Text className="text-sm font-medium text-gray-700 mb-2">ZIP</Text>
          <TextInput
            className="bg-gray-100 rounded-xl px-4 py-3 text-base text-gray-900"
            value={value.zip}
            onChangeText={handleZipChange}
            onFocus={handleZipFocus}
            onBlur={handleZipBlur}
            placeholder="97XXX"
            placeholderTextColor="#9CA3AF"
            keyboardType="numeric"
            maxLength={5}
            textContentType="postalCode"
          />
        </View>
      </View>

      {/* Action Buttons */}
      <View className="flex-row mb-2" style={{ gap: 8 }}>
        <Pressable
          onPress={geocodeAddress}
          disabled={isGeocoding}
          className={`flex-1 flex-row items-center justify-center py-3 rounded-xl ${
            isGeocoding ? 'bg-green-600/50' : 'bg-green-600'
          }`}
        >
          {isGeocoding ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Search size={18} color="#ffffff" />
          )}
          <Text className="text-white font-medium ml-2">
            {isGeocoding ? 'Locating...' : 'Locate on Map'}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleUseMyLocation}
          disabled={isGeocoding}
          className={`flex-1 flex-row items-center justify-center py-3 rounded-xl border ${
            isGeocoding ? 'border-gray-300 bg-gray-50' : 'border-green-600 bg-white'
          }`}
        >
          <Crosshair size={18} color={isGeocoding ? '#9CA3AF' : '#16A34A'} />
          <Text
            className={`font-medium ml-2 ${isGeocoding ? 'text-gray-400' : 'text-green-600'}`}
          >
            Use My Location
          </Text>
        </Pressable>
      </View>

      {/* Status Line */}
      <StatusLine
        source={value.geocodeSource}
        confidence={value.geocodeConfidence}
        hasCoordinates={hasCoordinates}
        isGeocoding={isGeocoding}
        error={geocodeError}
      />

      {/* Map Preview */}
      <MapPreview
        latitude={value.latitude}
        longitude={value.longitude}
        initialRegion={
          value.latitude && value.longitude
            ? {
                latitude: value.latitude,
                longitude: value.longitude,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }
            : initialRegion
        }
        onMapPress={handleMapPress}
        onMarkerDragEnd={handleMarkerDragEnd}
        mapRef={mapRef}
      />

      {/* GPS Coordinates Display */}
      {hasCoordinates && (
        <Animated.View entering={FadeInDown} className="bg-gray-50 rounded-xl p-4 mt-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-gray-700">GPS Coordinates</Text>
            <View
              className={`px-2 py-0.5 rounded-full ${
                value.geocodeConfidence === 'high'
                  ? 'bg-green-100'
                  : value.geocodeConfidence === 'medium'
                    ? 'bg-amber-100'
                    : 'bg-red-100'
              }`}
            >
              <Text
                className={`text-xs capitalize ${
                  value.geocodeConfidence === 'high'
                    ? 'text-green-700'
                    : value.geocodeConfidence === 'medium'
                      ? 'text-amber-700'
                      : 'text-red-700'
                }`}
              >
                {value.geocodeConfidence}
              </Text>
            </View>
          </View>
          <Text className="text-green-700 text-sm font-medium mt-2">
            {value.latitude?.toFixed(6)}, {value.longitude?.toFixed(6)}
          </Text>
          <Text className="text-gray-500 text-xs mt-1">
            Source:{' '}
            {value.geocodeSource === 'current_location'
              ? 'Device GPS'
              : value.geocodeSource === 'pin_drag'
                ? 'Pin Drag'
                : value.geocodeSource === 'address'
                  ? 'Address Geocode'
                  : 'Manual Entry'}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  mapContainer: {
    height: 250,
    width: '100%',
  },
  tapOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AddressMapPicker;
