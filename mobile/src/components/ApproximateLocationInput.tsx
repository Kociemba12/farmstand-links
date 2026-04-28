/**
 * ApproximateLocationInput component
 * Allows users to enter an approximate location with a draggable map pin
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import MapView, { Marker, Region, MapPressEvent } from 'react-native-maps';
import { MapPin, AlertTriangle, Navigation } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { geocodeApproximateLocation, GeocodeResult, isIntersectionQuery } from '@/lib/geocoding';
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';

export interface ApproximateLocationData {
  approxLocationText: string;
  optionalNearestCityState: string;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: 'approximate' | 'approximate_manual';
  geocodeConfidence: number | null;
  pinAdjustedByUser: boolean;
}

interface ApproximateLocationInputProps {
  value: ApproximateLocationData;
  onChange: (data: ApproximateLocationData) => void;
  initialRegion?: Region;
}

// Oregon default region
const DEFAULT_REGION: Region = {
  latitude: 44.0,
  longitude: -120.5,
  latitudeDelta: 4,
  longitudeDelta: 4,
};

export function ApproximateLocationInput({
  value,
  onChange,
  initialRegion = DEFAULT_REGION,
}: ApproximateLocationInputProps) {
  const mapRef = useRef<MapView>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [mapRegion, setMapRegion] = useState<Region>(
    value.latitude && value.longitude
      ? {
          latitude: value.latitude,
          longitude: value.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }
      : initialRegion
  );

  // Debounced geocoding
  const geocodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleGeocodeResult = useCallback(
    (result: GeocodeResult | null) => {
      setIsGeocoding(false);

      if (result) {
        setGeocodeError(null);
        onChange({
          ...value,
          latitude: result.latitude,
          longitude: result.longitude,
          locationPrecision: 'approximate',
          geocodeConfidence: result.confidence,
          pinAdjustedByUser: false,
        });

        // Animate map to new location
        mapRef.current?.animateToRegion(
          {
            latitude: result.latitude,
            longitude: result.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          },
          500
        );
      } else {
        setGeocodeError('Could not find location. Try adding more details or drop a pin manually.');
      }
    },
    [value, onChange]
  );

  const triggerGeocode = useCallback(
    (approxText: string, cityState: string) => {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
      }

      if (!approxText || approxText.trim().length < 5) {
        return;
      }

      setIsGeocoding(true);
      setGeocodeError(null);

      geocodeTimeoutRef.current = setTimeout(async () => {
        const result = await geocodeApproximateLocation(approxText, {
          nearestCityState: cityState || null,
        });
        handleGeocodeResult(result);
      }, 600);
    },
    [handleGeocodeResult]
  );

  // Handle approx location text change
  const handleApproxTextChange = useCallback(
    (text: string) => {
      onChange({
        ...value,
        approxLocationText: text,
      });
      triggerGeocode(text, value.optionalNearestCityState);
    },
    [value, onChange, triggerGeocode]
  );

  // Handle city/state change
  const handleCityStateChange = useCallback(
    (text: string) => {
      onChange({
        ...value,
        optionalNearestCityState: text,
      });
      if (value.approxLocationText.trim().length >= 5) {
        triggerGeocode(value.approxLocationText, text);
      }
    },
    [value, onChange, triggerGeocode]
  );

  // Handle map tap to place pin
  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { latitude, longitude } = event.nativeEvent.coordinate;

      onChange({
        ...value,
        latitude,
        longitude,
        locationPrecision: 'approximate_manual',
        geocodeConfidence: null,
        pinAdjustedByUser: true,
      });

      setGeocodeError(null);
    },
    [value, onChange]
  );

  // Handle marker drag end
  const handleMarkerDragEnd = useCallback(
    (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const { latitude, longitude } = event.nativeEvent.coordinate;

      onChange({
        ...value,
        latitude,
        longitude,
        pinAdjustedByUser: true,
      });
    },
    [value, onChange]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
      }
    };
  }, []);

  const hasPin = value.latitude !== null && value.longitude !== null;
  const isIntersection = isIntersectionQuery(value.approxLocationText);

  return (
    <View className="gap-4">
      {/* Warning Banner */}
      <Animated.View
        entering={FadeIn}
        className="flex-row items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200"
      >
        <AlertTriangle size={20} color="#D97706" />
        <View className="flex-1">
          <Text className="text-sm font-medium text-amber-800">Approximate pin</Text>
          <Text className="text-xs text-amber-700 mt-1">
            Adjust if needed. Admin will verify before publishing.
          </Text>
        </View>
      </Animated.View>

      {/* Approx Location Text Input */}
      <View>
        <Text className="text-sm font-medium text-charcoal mb-2">
          Location Description <Text className="text-rust">*</Text>
        </Text>
        <TextInput
          className="bg-white border border-sand rounded-xl px-4 py-3.5 text-base text-charcoal"
          placeholder="Jacksonville Hill & Cady Rd, Jacksonville OR"
          placeholderTextColor="#8B6F4E"
          value={value.approxLocationText}
          onChangeText={handleApproxTextChange}
          autoCapitalize="words"
        />
        <Text className="text-xs text-wood mt-1.5 px-1">
          Examples: "Jacksonville Hill & Cady Rd", "5 miles past Camp Creek Rd", "Near McKenzie Fire
          Station"
        </Text>
        {isIntersection && (
          <View className="flex-row items-center gap-1.5 mt-2 px-1">
            <Navigation size={12} color="#2D5A3D" />
            <Text className="text-xs text-forest">Detected as intersection/crossroad</Text>
          </View>
        )}
      </View>

      {/* Optional City/State Input */}
      <View>
        <Text className="text-sm font-medium text-charcoal mb-2">
          Nearest City, State <Text className="text-wood text-xs">(recommended)</Text>
        </Text>
        <TextInput
          className="bg-white border border-sand rounded-xl px-4 py-3.5 text-base text-charcoal"
          placeholder="e.g., Jacksonville, OR"
          placeholderTextColor="#8B6F4E"
          value={value.optionalNearestCityState}
          onChangeText={handleCityStateChange}
          autoCapitalize="words"
        />
      </View>

      {/* Geocoding Status */}
      {isGeocoding && (
        <View className="flex-row items-center gap-2 px-1">
          <ActivityIndicator size="small" color="#2D5A3D" />
          <Text className="text-sm text-wood">Finding location...</Text>
        </View>
      )}

      {geocodeError && (
        <Animated.View entering={FadeIn} exiting={FadeOut} className="px-1">
          <Text className="text-sm text-rust">{geocodeError}</Text>
        </Animated.View>
      )}

      {/* Map Preview */}
      <View className="rounded-xl overflow-hidden border border-sand">
        <Text className="text-sm font-medium text-charcoal px-4 py-3 bg-cream/50 border-b border-sand">
          {hasPin ? 'Drag pin to adjust location' : 'Tap map to drop a pin'}
        </Text>
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={mapRegion}
            onPress={handleMapPress}
            showsUserLocation
            showsMyLocationButton={false}
          >
            {hasPin && (
              <Marker
                coordinate={{
                  latitude: value.latitude!,
                  longitude: value.longitude!,
                }}
                draggable
                onDragEnd={handleMarkerDragEnd}
              >
                <FarmstandPinMarker />
              </Marker>
            )}
          </MapView>

          {/* Tap to drop pin overlay */}
          {!hasPin && !isGeocoding && (
            <View style={styles.tapOverlay} pointerEvents="none">
              <View className="bg-white/90 px-4 py-2 rounded-full">
                <Text className="text-sm text-charcoal font-medium">Tap to drop pin</Text>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Confidence indicator */}
      {hasPin && value.geocodeConfidence !== null && (
        <View className="flex-row items-center gap-2 px-1">
          <View
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor:
                value.geocodeConfidence > 0.6
                  ? '#2D5A3D'
                  : value.geocodeConfidence > 0.3
                    ? '#D97706'
                    : '#C45C3E',
            }}
          />
          <Text className="text-xs text-wood">
            {value.geocodeConfidence > 0.6
              ? 'Good match'
              : value.geocodeConfidence > 0.3
                ? 'Approximate match - verify pin position'
                : 'Low confidence - please adjust pin'}
          </Text>
        </View>
      )}

      {hasPin && value.pinAdjustedByUser && (
        <View className="flex-row items-center gap-2 px-1">
          <MapPin size={12} color="#2D5A3D" />
          <Text className="text-xs text-forest">Pin adjusted manually</Text>
        </View>
      )}
    </View>
  );
}

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
