/**
 * CrossStreetsInput component
 * For entering cross streets or generic area descriptions with map preview
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import MapView, { Marker, Region, MapPressEvent } from 'react-native-maps';
import { MapPin, AlertTriangle, Navigation } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { geocodeApproximateLocation, GeocodeResult } from '@/lib/geocoding';
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';

export type AreaType = 'cross_streets' | 'generic_area';

export interface CrossStreetsData {
  areaType: AreaType;
  crossStreet1: string;
  crossStreet2: string;
  genericAreaText: string;
  nearestCityState: string;
  latitude: number | null;
  longitude: number | null;
  geocodeConfidence: number | null;
  pinAdjustedByUser: boolean;
}

interface CrossStreetsInputProps {
  value: CrossStreetsData;
  onChange: (data: CrossStreetsData) => void;
  initialRegion?: Region;
}

// Oregon default region
const DEFAULT_REGION: Region = {
  latitude: 44.0,
  longitude: -120.5,
  latitudeDelta: 4,
  longitudeDelta: 4,
};

export function CrossStreetsInput({
  value,
  onChange,
  initialRegion = DEFAULT_REGION,
}: CrossStreetsInputProps) {
  const mapRef = useRef<MapView>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
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

  const triggerGeocode = useCallback(() => {
    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }

    let query = '';
    if (value.areaType === 'cross_streets') {
      if (!value.crossStreet1 || !value.crossStreet2 || !value.nearestCityState) {
        return;
      }
      query = `${value.crossStreet1} & ${value.crossStreet2}, ${value.nearestCityState}`;
    } else {
      if (!value.genericAreaText || !value.nearestCityState) {
        return;
      }
      query = `${value.genericAreaText}, ${value.nearestCityState}`;
    }

    if (query.length < 10) {
      return;
    }

    setIsGeocoding(true);
    setGeocodeError(null);

    geocodeTimeoutRef.current = setTimeout(async () => {
      const result = await geocodeApproximateLocation(query, {
        nearestCityState: value.nearestCityState,
        isIntersection: value.areaType === 'cross_streets',
      });
      handleGeocodeResult(result);
    }, 600);
  }, [value, handleGeocodeResult]);

  // Trigger geocode when relevant fields change
  useEffect(() => {
    triggerGeocode();
  }, [value.crossStreet1, value.crossStreet2, value.genericAreaText, value.nearestCityState, value.areaType]);

  // Handle map tap to place pin
  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { latitude, longitude } = event.nativeEvent.coordinate;

      onChange({
        ...value,
        latitude,
        longitude,
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
            We'll place an approximate pin. You can adjust it on the map. Admin will verify before publishing.
          </Text>
        </View>
      </Animated.View>

      {/* Area Type Selector */}
      <View>
        <Text className="text-sm font-medium text-charcoal mb-2">How do you want to describe it?</Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange({ ...value, areaType: 'cross_streets' });
            }}
            className={`flex-1 py-3 px-4 rounded-xl border ${
              value.areaType === 'cross_streets'
                ? 'bg-forest/10 border-forest'
                : 'bg-cream/60 border-sand/60'
            }`}
          >
            <Text
              className={`text-center text-sm font-medium ${
                value.areaType === 'cross_streets' ? 'text-forest' : 'text-charcoal'
              }`}
            >
              Cross streets
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange({ ...value, areaType: 'generic_area' });
            }}
            className={`flex-1 py-3 px-4 rounded-xl border ${
              value.areaType === 'generic_area'
                ? 'bg-forest/10 border-forest'
                : 'bg-cream/60 border-sand/60'
            }`}
          >
            <Text
              className={`text-center text-sm font-medium ${
                value.areaType === 'generic_area' ? 'text-forest' : 'text-charcoal'
              }`}
            >
              Generic area
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Cross Streets Inputs */}
      {value.areaType === 'cross_streets' && (
        <>
          <View>
            <Text className="text-sm font-medium text-charcoal mb-2">
              Cross street 1 <Text className="text-rust">*</Text>
            </Text>
            <TextInput
              className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
              placeholder="Example: Oak Street"
              placeholderTextColor="#A89080"
              value={value.crossStreet1}
              onChangeText={(text) => onChange({ ...value, crossStreet1: text })}
              autoCapitalize="words"
            />
          </View>
          <View>
            <Text className="text-sm font-medium text-charcoal mb-2">
              Cross street 2 <Text className="text-rust">*</Text>
            </Text>
            <TextInput
              className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
              placeholder="Example: Main Avenue"
              placeholderTextColor="#A89080"
              value={value.crossStreet2}
              onChangeText={(text) => onChange({ ...value, crossStreet2: text })}
              autoCapitalize="words"
            />
          </View>
        </>
      )}

      {/* Generic Area Input */}
      {value.areaType === 'generic_area' && (
        <View>
          <Text className="text-sm font-medium text-charcoal mb-2">
            Area description <Text className="text-rust">*</Text>
          </Text>
          <TextInput
            className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
            placeholder="Example: 5 miles past Camp Creek Rd near McKenzie Fire Station"
            placeholderTextColor="#A89080"
            value={value.genericAreaText}
            onChangeText={(text) => onChange({ ...value, genericAreaText: text })}
            autoCapitalize="sentences"
            multiline
          />
        </View>
      )}

      {/* Nearest City/State Input */}
      <View>
        <Text className="text-sm font-medium text-charcoal mb-2">
          Nearest city + state <Text className="text-rust">*</Text>
        </Text>
        <TextInput
          className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
          placeholder="Example: Springfield, OR"
          placeholderTextColor="#A89080"
          value={value.nearestCityState}
          onChangeText={(text) => onChange({ ...value, nearestCityState: text })}
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
            initialRegion={
              value.latitude && value.longitude
                ? {
                    latitude: value.latitude,
                    longitude: value.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }
                : initialRegion
            }
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
