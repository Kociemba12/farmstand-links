/**
 * UseMyLocationSection component
 * Handles getting device GPS and displaying on map
 */

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import MapView, { Marker, Region, MapPressEvent } from 'react-native-maps';
import { MapPin, Crosshair, AlertTriangle } from 'lucide-react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn } from 'react-native-reanimated';
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';

export interface UseMyLocationData {
  latitude: number | null;
  longitude: number | null;
  nearestCityState: string;
  streetAddress: string | null;
  pinAdjustedByUser: boolean;
}

interface UseMyLocationSectionProps {
  value: UseMyLocationData;
  onChange: (data: UseMyLocationData) => void;
  onPermissionDenied?: () => void;
  initialRegion?: Region;
}

// Oregon default region
const DEFAULT_REGION: Region = {
  latitude: 44.0,
  longitude: -120.5,
  latitudeDelta: 4,
  longitudeDelta: 4,
};

export function UseMyLocationSection({
  value,
  onChange,
  onPermissionDenied,
  initialRegion = DEFAULT_REGION,
}: UseMyLocationSectionProps) {
  const mapRef = useRef<MapView>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const handleUseMyLocation = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLocating(true);
    setLocationError(null);

    try {
      // Request permission
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        setLocationError('Location permission denied. Enter cross streets or tap map to drop pin.');
        setIsLocating(false);
        onPermissionDenied?.();
        return;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = location.coords;

      // Reverse geocode to get address info
      let nearestCityState = value.nearestCityState;
      let streetAddress: string | null = null;

      try {
        const reverseResults = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (reverseResults.length > 0) {
          const r = reverseResults[0];
          if (r.city && r.region) {
            nearestCityState = `${r.city}, ${r.region}`;
          }
          if (r.street) {
            streetAddress = r.street;
          }
        }
      } catch {
        // Ignore reverse geocode errors
      }

      onChange({
        latitude,
        longitude,
        nearestCityState,
        streetAddress,
        pinAdjustedByUser: false,
      });

      // Animate map to location
      mapRef.current?.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500
      );

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Location error:', error);
      setLocationError('Failed to get your location. Please try again or drop a pin manually.');
    } finally {
      setIsLocating(false);
    }
  }, [value.nearestCityState, onChange, onPermissionDenied]);

  // Handle map tap to place pin
  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { latitude, longitude } = event.nativeEvent.coordinate;

      onChange({
        ...value,
        latitude,
        longitude,
        pinAdjustedByUser: true,
      });

      setLocationError(null);
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

  const hasPin = value.latitude !== null && value.longitude !== null;

  return (
    <View className="gap-4">
      {/* Info Banner */}
      <Animated.View
        entering={FadeIn}
        className="flex-row items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200"
      >
        <Crosshair size={20} color="#2563EB" />
        <View className="flex-1">
          <Text className="text-sm font-medium text-blue-800">Use your current location</Text>
          <Text className="text-xs text-blue-700 mt-1">
            We'll drop a pin where you are standing. You can drag it if needed.
          </Text>
        </View>
      </Animated.View>

      {/* Use My Location Button */}
      <Pressable
        onPress={handleUseMyLocation}
        disabled={isLocating}
        className={`flex-row items-center justify-center py-4 px-6 rounded-xl ${
          isLocating ? 'bg-forest/50' : 'bg-forest'
        }`}
        style={{
          shadowColor: '#2D5A3D',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 4,
          elevation: 3,
        }}
      >
        {isLocating ? (
          <>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text className="text-white font-semibold text-base ml-3">Getting location...</Text>
          </>
        ) : (
          <>
            <Crosshair size={20} color="#FFFFFF" />
            <Text className="text-white font-semibold text-base ml-3">Use my current location</Text>
          </>
        )}
      </Pressable>

      {/* Location Error */}
      {locationError && (
        <Animated.View entering={FadeIn} className="flex-row items-start gap-2 px-1">
          <AlertTriangle size={16} color="#C45C3E" />
          <Text className="text-sm text-rust flex-1">{locationError}</Text>
        </Animated.View>
      )}

      {/* Map Preview */}
      <View className="rounded-xl overflow-hidden border border-sand">
        <Text className="text-sm font-medium text-charcoal px-4 py-3 bg-cream/50 border-b border-sand">
          {hasPin ? 'Drag pin to adjust location' : 'Or tap map to drop a pin'}
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
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
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

          {/* Coordinates display */}
          {hasPin && (
            <View style={styles.coordsOverlay}>
              <Text style={styles.coordsText}>
                {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Location Info */}
      {hasPin && value.nearestCityState && (
        <View className="flex-row items-center gap-2 px-1">
          <MapPin size={12} color="#2D5A3D" />
          <Text className="text-xs text-forest">Near {value.nearestCityState}</Text>
        </View>
      )}

      {hasPin && value.pinAdjustedByUser && (
        <View className="flex-row items-center gap-2 px-1">
          <MapPin size={12} color="#8B6F4E" />
          <Text className="text-xs text-wood">Pin adjusted manually</Text>
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
  coordsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  coordsText: {
    fontSize: 11,
    color: '#6B7280',
  },
});
