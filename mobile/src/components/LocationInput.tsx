/**
 * LocationInput - Unified global location input component
 *
 * Supports 3 modes:
 * 1. Exact Address (best accuracy)
 * 2. Cross Streets (approximate, privacy-friendly)
 * 3. Use My Current Location (fastest)
 *
 * Use this component everywhere a location/address is needed:
 * - Create Farmstand
 * - Edit Farmstand
 * - Claim Farmstand
 * - Admin Approvals
 */

import React, { useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
} from 'react-native';
import MapView, { Marker, Region, MapPressEvent } from 'react-native-maps';
import {
  MapPin,
  Navigation,
  Crosshair,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Info,
  Search,
} from 'lucide-react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut, FadeInDown } from 'react-native-reanimated';
import { geocodeApproximateLocation } from '@/lib/geocoding';
import { geocodeAddress, isDefaultCoordinates } from '@/utils/geocode';
import { searchAddressSuggestions, AddressSuggestion } from '@/utils/addressAutocomplete';
import { FarmstandPinMarker } from '@/components/FarmstandPinMarker';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

export type LocationMode = 'exact_address' | 'cross_streets' | 'use_my_location';

export type GeoSource = 'GEOCODED' | 'DEVICE_GPS' | 'ADMIN_PIN_ADJUST' | 'USER_PIN_ADJUST';

export type AreaType = 'cross_streets' | 'generic_area';

export interface LocationInputData {
  // Mode selected
  locationMode: LocationMode;

  // Display text (what users see)
  displayLocationText: string;

  // Address fields
  addressLine1: string;
  city: string;
  state: string;
  zip: string;

  // Cross streets fields
  crossStreet1: string;
  crossStreet2: string;
  areaType: AreaType;
  genericAreaText: string;
  nearestCityState: string;

  // Coordinates (required for map display)
  latitude: number | null;
  longitude: number | null;

  // Metadata
  isApproximate: boolean;
  geoSource: GeoSource | null;
  geoAccuracyMeters: number | null;
  geocodeConfidence: number | null;
  pinAdjustedByUser: boolean;

  // Optional note (for "Use My Location" mode)
  locationNote: string;
}

export interface LocationInputProps {
  value: LocationInputData;
  onChange: (data: LocationInputData) => void;

  // User role affects defaults
  userRole?: 'guest' | 'farmer' | 'admin';

  // Initial map region
  initialRegion?: Region;

  // Show/hide optional fields
  showLocationNote?: boolean;

  // Validation
  requireCoordinates?: boolean;

  // Custom labels
  labels?: {
    title?: string;
    subtitle?: string;
  };
}

// ============================================================================
// REF INTERFACE - exposed methods for parent components
// ============================================================================

export interface LocationInputRef {
  /**
   * Force geocoding of the current address and wait for result.
   * Returns true if geocoding succeeded and coordinates are valid.
   * Returns false if geocoding failed (shows error to user).
   * Use this before allowing navigation to ensure coordinates are up-to-date.
   */
  forceGeocode: () => Promise<boolean>;
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

export const createDefaultLocationData = (
  mode: LocationMode = 'cross_streets'
): LocationInputData => ({
  locationMode: mode,
  displayLocationText: '',
  addressLine1: '',
  city: '',
  state: 'OR',
  zip: '',
  crossStreet1: '',
  crossStreet2: '',
  areaType: 'cross_streets',
  genericAreaText: '',
  nearestCityState: '',
  latitude: null,
  longitude: null,
  isApproximate: mode !== 'exact_address',
  geoSource: null,
  geoAccuracyMeters: null,
  geocodeConfidence: null,
  pinAdjustedByUser: false,
  locationNote: '',
});

/**
 * Validate location data based on location mode.
 * Returns error message if invalid, null if valid.
 * This is the authoritative validation — enforces street, city, state, ZIP, and coordinates.
 */
export function validateLocationData(data: LocationInputData): string | null {
  // My Location mode: requires coordinates + city + state + ZIP
  if (data.locationMode === 'use_my_location') {
    if (data.latitude === null || data.longitude === null) {
      return 'Please confirm your location on the map.';
    }
    if (!data.city?.trim()) return 'Please enter the city.';
    if (!data.state?.trim()) return 'Please enter the state.';
    if (!data.zip?.trim()) return 'Please enter the ZIP code.';
    return null;
  }

  // Exact Address mode: requires street, city, state, ZIP
  if (data.locationMode === 'exact_address') {
    if (!data.addressLine1?.trim()) {
      return 'Please enter a street address.';
    }
    if (!data.city?.trim()) return 'Please enter the city.';
    if (!data.state?.trim()) return 'Please enter the state.';
    if (!data.zip?.trim()) return 'Please enter the ZIP code.';
    return null;
  }

  // Cross Streets mode: requires street identifiers + city/state
  if (data.locationMode === 'cross_streets') {
    if (data.areaType === 'cross_streets') {
      if (!data.crossStreet1?.trim() || !data.crossStreet2?.trim()) {
        return 'Enter two nearby cross streets (e.g., Oak St & Main Ave).';
      }
    } else {
      if (!data.genericAreaText?.trim()) {
        return 'Please enter an area description.';
      }
    }
    if (!data.nearestCityState?.trim() && !(data.city?.trim() && data.state?.trim())) {
      return 'Please enter the nearest city and state.';
    }
    return null;
  }

  return 'Please add the farmstand address and confirm the map location before submitting.';
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface ModeSelectorProps {
  value: LocationMode;
  onChange: (mode: LocationMode) => void;
}

function ModeSelector({ value, onChange }: ModeSelectorProps) {
  const handlePress = (mode: LocationMode) => {
    if (mode !== value) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange(mode);
    }
  };

  const getIcon = (mode: LocationMode, isSelected: boolean) => {
    const color = isSelected ? '#2D5A3D' : '#8B6F4E';
    switch (mode) {
      case 'exact_address':
        return <MapPin size={16} color={color} />;
      case 'cross_streets':
        return <Navigation size={16} color={color} />;
      case 'use_my_location':
        return <Crosshair size={16} color={color} />;
    }
  };

  const getLabel = (mode: LocationMode) => {
    switch (mode) {
      case 'exact_address':
        return 'Exact Address';
      case 'cross_streets':
        return 'Cross Streets';
      case 'use_my_location':
        return 'My Location';
    }
  };

  const modes: LocationMode[] = ['exact_address', 'cross_streets', 'use_my_location'];

  return (
    <View className="mb-5">
      <Text className="text-charcoal font-medium mb-2 text-sm">How to set location</Text>
      <View className="flex-row bg-sand/30 rounded-xl p-1">
        {modes.map((mode) => {
          const isSelected = value === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => handlePress(mode)}
              className={`flex-1 flex-row items-center justify-center py-3 px-2 rounded-lg ${
                isSelected ? 'bg-white' : ''
              }`}
              style={
                isSelected
                  ? {
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.1,
                      shadowRadius: 2,
                      elevation: 2,
                    }
                  : undefined
              }
            >
              <View style={{ opacity: isSelected ? 1 : 0.5 }}>
                {getIcon(mode, isSelected)}
              </View>
              <Text
                className={`ml-1.5 text-xs font-medium ${
                  isSelected ? 'text-forest' : 'text-wood'
                }`}
                numberOfLines={1}
              >
                {getLabel(mode)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface MapPreviewProps {
  latitude: number | null;
  longitude: number | null;
  initialRegion: Region;
  onMapPress: (event: MapPressEvent) => void;
  onMarkerDragEnd: (lat: number, lng: number) => void;
  mapRef: React.RefObject<MapView | null>;
  isLocating?: boolean;
}

function MapPreview({
  latitude,
  longitude,
  initialRegion,
  onMapPress,
  onMarkerDragEnd,
  mapRef,
  isLocating,
}: MapPreviewProps) {
  // Don't consider default fallback coordinates as a valid pin
  // Use the helper function to check for DEFAULT_REGION
  const hasPin = latitude !== null && longitude !== null &&
    !isDefaultCoordinates(latitude, longitude);

  const handleMarkerDrag = useCallback(
    (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const { latitude: lat, longitude: lng } = event.nativeEvent.coordinate;
      onMarkerDragEnd(lat, lng);
    },
    [onMarkerDragEnd]
  );

  return (
    <View className="rounded-xl overflow-hidden border border-sand">
      <Text className="text-sm font-medium text-charcoal px-4 py-3 bg-cream/50 border-b border-sand">
        {hasPin ? 'Drag pin to adjust location' : 'Tap map to drop a pin'}
      </Text>
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
        {!hasPin && !isLocating && (
          <View style={styles.tapOverlay} pointerEvents="none">
            <View className="bg-white/90 px-4 py-2 rounded-full">
              <Text className="text-sm text-charcoal font-medium">Tap to drop pin</Text>
            </View>
          </View>
        )}

        {/* Coordinates display */}
        {hasPin && (
          <View style={styles.coordsOverlay}>
            <Text style={styles.coordsText}>
              {latitude?.toFixed(5)}, {longitude?.toFixed(5)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const LocationInput = forwardRef<LocationInputRef, LocationInputProps>(function LocationInput({
  value,
  onChange,
  userRole = 'guest',
  initialRegion = DEFAULT_REGION,
  showLocationNote = false,
  requireCoordinates = true,
  labels,
}, ref) {
  const mapRef = useRef<MapView>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const geocodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Address autocomplete state
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const autocompleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedFromSuggestionRef = useRef(false); // Track if user selected a suggestion

  // Store latest value in ref for use in forceGeocode
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Ref so handleModeChange can call handleUseMyLocation without a forward-reference error
  const handleUseMyLocationRef = useRef<() => void>(() => {});

  // -------------------------------------------------------------------------
  // Editing Flags - track which fields are actively being edited
  // This prevents geocode from overwriting user input while typing
  // -------------------------------------------------------------------------
  const isEditingAddressRef = useRef(false);
  const isEditingCityRef = useRef(false);
  const isEditingStateRef = useRef(false);
  const isEditingZipRef = useRef(false);
  const isEditingCrossStreet1Ref = useRef(false);
  const isEditingCrossStreet2Ref = useRef(false);
  const isEditingGenericAreaRef = useRef(false);
  const isEditingNearestCityStateRef = useRef(false);

  // Determine default mode based on user role
  useEffect(() => {
    if (!value.locationMode) {
      const defaultMode: LocationMode =
        userRole === 'guest' ? 'cross_streets' : 'exact_address';
      onChange({ ...value, locationMode: defaultMode });
    }
  }, [userRole]);

  // -------------------------------------------------------------------------
  // Mode Change Handler
  // -------------------------------------------------------------------------
  const handleModeChange = useCallback(
    (mode: LocationMode) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange({
        ...value,
        locationMode: mode,
        isApproximate: mode !== 'exact_address',
        // Reset errors
      });
      setGeocodeError(null);
      setLocationError(null);
      // Auto-trigger GPS immediately when switching to "Use My Location"
      if (mode === 'use_my_location') {
        // Use ref to avoid forward-reference error (handleUseMyLocation is declared later)
        setTimeout(() => handleUseMyLocationRef.current(), 0);
      }
    },
    [value, onChange]
  );

  // -------------------------------------------------------------------------
  // Exact Address: Mapbox Geocoding (debounced)
  // Uses Mapbox API for more accurate geocoding than Expo Location
  // -------------------------------------------------------------------------
  const geocodeExactAddressMapbox = useCallback(async (): Promise<boolean> => {
    const { addressLine1, city, state, zip } = value;

    // Build full address - require at least street address >= 5 chars, city, and state
    if (!addressLine1 || addressLine1.trim().length < 5 || !city?.trim() || !state?.trim()) {
      return false;
    }

    const fullAddress = `${addressLine1.trim()}, ${city.trim()}, ${state.trim()} ${zip?.trim() || ''}`.trim();

    setIsGeocoding(true);
    setGeocodeError(null);

    try {
      const result = await geocodeAddress(fullAddress);

      if (result) {
        const displayText = [addressLine1, city, state, zip]
          .filter(Boolean)
          .join(', ');

        // Update coordinates and metadata - DO NOT overwrite user-typed address fields
        onChange({
          ...value,
          latitude: result.latitude,
          longitude: result.longitude,
          displayLocationText: displayText,
          geoSource: 'GEOCODED',
          isApproximate: false,
          geocodeConfidence: 0.9,
          pinAdjustedByUser: false,
        });

        // Animate map to new coordinates
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
        setIsGeocoding(false);
        return true;
      } else {
        // Geocode failed - do NOT update coordinates, show warning
        setGeocodeError("Couldn't verify address — use Locate on Map or drag pin.");
        setIsGeocoding(false);
        return false;
      }
    } catch (error) {
      console.log('GEOCODE_FAIL', error);
      // Geocode failed - do NOT update coordinates, show warning
      setGeocodeError("Couldn't verify address — use Locate on Map or drag pin.");
      setIsGeocoding(false);
      return false;
    }
  }, [value, onChange]);

  // Debounced trigger for Mapbox geocoding (700ms delay)
  const triggerExactGeocodeDebounced = useCallback(() => {
    // Don't geocode if user selected from autocomplete (already has coords)
    if (selectedFromSuggestionRef.current) {
      selectedFromSuggestionRef.current = false;
      return;
    }

    // Don't geocode if any address field is being actively edited
    if (isEditingAddressRef.current || isEditingCityRef.current ||
        isEditingStateRef.current || isEditingZipRef.current) {
      return;
    }

    // Clear any existing timeout
    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }

    // Set new debounced geocode
    geocodeTimeoutRef.current = setTimeout(() => {
      geocodeExactAddressMapbox();
    }, 700);
  }, [geocodeExactAddressMapbox]);

  // -------------------------------------------------------------------------
  // Address Autocomplete - search for suggestions as user types
  // -------------------------------------------------------------------------
  const searchAddresses = useCallback(async (query: string) => {
    if (query.length < 4) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoadingSuggestions(true);

    // Use current coordinates as proximity if available
    const proximity = value.latitude && value.longitude && !isDefaultCoordinates(value.latitude, value.longitude)
      ? { latitude: value.latitude, longitude: value.longitude }
      : undefined;

    const suggestions = await searchAddressSuggestions(query, proximity);
    setAddressSuggestions(suggestions);
    setShowSuggestions(suggestions.length > 0);
    setIsLoadingSuggestions(false);
  }, [value.latitude, value.longitude]);

  // Debounced autocomplete search (300ms delay)
  const triggerAutocompleteSearch = useCallback((query: string) => {
    // Clear any existing timeout
    if (autocompleteTimeoutRef.current) {
      clearTimeout(autocompleteTimeoutRef.current);
    }

    if (query.length < 4) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Set new debounced search
    autocompleteTimeoutRef.current = setTimeout(() => {
      searchAddresses(query);
    }, 300);
  }, [searchAddresses]);

  // Handle suggestion selection
  const handleSuggestionSelect = useCallback((suggestion: AddressSuggestion) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Keyboard.dismiss();

    // Mark that we selected from suggestion (skip geocode)
    selectedFromSuggestionRef.current = true;

    // Update all form fields with suggestion data
    onChange({
      ...value,
      addressLine1: suggestion.street,
      city: suggestion.city,
      state: suggestion.state,
      zip: suggestion.zip,
      displayLocationText: suggestion.label,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      geoSource: 'GEOCODED',
      isApproximate: false,
      geocodeConfidence: 0.95, // High confidence from autocomplete
      pinAdjustedByUser: false,
    });

    // Animate map to new coordinates
    mapRef.current?.animateToRegion(
      {
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      },
      500
    );

    // Clear suggestions
    setAddressSuggestions([]);
    setShowSuggestions(false);
    setGeocodeError(null);

    // Haptic feedback for success
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [value, onChange]);

  // Hide suggestions when tapping outside
  const hideSuggestions = useCallback(() => {
    setShowSuggestions(false);
  }, []);

  // -------------------------------------------------------------------------
  // Exact Address: Geocoding (legacy - kept for forceGeocode compatibility)
  // NOTE: This is now DISABLED for normal typing. We rely on Google Places Autocomplete.
  // This function is ONLY called by forceGeocode() when explicitly needed.
  // -------------------------------------------------------------------------
  const geocodeExactAddress = useCallback(async (): Promise<boolean> => {
    const { addressLine1, city, state, zip } = value;

    const parts: string[] = [];
    if (addressLine1?.trim()) parts.push(addressLine1.trim());
    if (city?.trim()) parts.push(city.trim());
    if (state?.trim()) parts.push(state.trim());
    if (zip?.trim()) parts.push(zip.trim());

    if (parts.length < 2) {
      setGeocodeError('Please enter at least a street address and city.');
      return false;
    }

    const fullAddress = parts.join(', ');
    setIsGeocoding(true);
    setGeocodeError(null);

    try {
      const results = await Location.geocodeAsync(fullAddress);
      if (results.length > 0) {
        const coords = results[0];
        const displayText = [addressLine1, city, state, zip]
          .filter(Boolean)
          .join(', ');

        // Only update GPS coordinates and metadata - NEVER overwrite user-typed address fields
        onChange({
          ...value,
          latitude: coords.latitude,
          longitude: coords.longitude,
          displayLocationText: displayText,
          geoSource: 'GEOCODED',
          isApproximate: false,
          geocodeConfidence: 0.9,
          pinAdjustedByUser: false,
        });

        // Animate map
        mapRef.current?.animateToRegion(
          {
            latitude: coords.latitude,
            longitude: coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          500
        );

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsGeocoding(false);
        return true;
      } else {
        setGeocodeError("Could not verify this address. Please select a suggestion or tap the map to drop a pin.");
        setIsGeocoding(false);
        return false;
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      setGeocodeError('Failed to verify address. Please use the map to drop a pin.');
      setIsGeocoding(false);
      return false;
    }
  }, [value, onChange]);

  // Trigger exact address geocode (calls debounced Mapbox geocoding)
  const triggerExactGeocode = useCallback(() => {
    triggerExactGeocodeDebounced();
  }, [triggerExactGeocodeDebounced]);

  // -------------------------------------------------------------------------
  // Cross Streets: Geocoding
  // -------------------------------------------------------------------------
  const geocodeCrossStreets = useCallback(async () => {
    // IMPORTANT: Skip geocoding if any cross streets field is being actively edited
    if (isEditingCrossStreet1Ref.current || isEditingCrossStreet2Ref.current ||
        isEditingGenericAreaRef.current || isEditingNearestCityStateRef.current) {
      return;
    }

    const { areaType, crossStreet1, crossStreet2, genericAreaText, nearestCityState } = value;

    let query = '';
    if (areaType === 'cross_streets') {
      if (!crossStreet1 || !crossStreet2 || !nearestCityState) {
        return;
      }
      query = `${crossStreet1} & ${crossStreet2}, ${nearestCityState}`;
    } else {
      if (!genericAreaText || !nearestCityState) {
        return;
      }
      query = `${genericAreaText}, ${nearestCityState}`;
    }

    if (query.length < 10) {
      return;
    }

    setIsGeocoding(true);
    setGeocodeError(null);

    const result = await geocodeApproximateLocation(query, {
      nearestCityState,
      isIntersection: areaType === 'cross_streets',
    });

    setIsGeocoding(false);

    if (result) {
      const displayText =
        areaType === 'cross_streets'
          ? `${crossStreet1} & ${crossStreet2}, ${nearestCityState}`
          : `${genericAreaText}, ${nearestCityState}`;

      // Only update GPS coordinates - NEVER overwrite user-typed text fields
      onChange({
        ...value,
        latitude: result.latitude,
        longitude: result.longitude,
        displayLocationText: displayText,
        geoSource: 'GEOCODED',
        isApproximate: true,
        geocodeConfidence: result.confidence,
        pinAdjustedByUser: false,
      });

      // Animate map
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
      setGeocodeError(
        "Could not find location. Try adding more details or drop a pin manually."
      );
    }
  }, [value, onChange]);

  // Debounced geocode trigger for cross streets
  const triggerCrossStreetsGeocode = useCallback(() => {
    if (geocodeTimeoutRef.current) {
      clearTimeout(geocodeTimeoutRef.current);
    }

    geocodeTimeoutRef.current = setTimeout(() => {
      geocodeCrossStreets();
    }, 600);
  }, [geocodeCrossStreets]);

  // -------------------------------------------------------------------------
  // IMPERATIVE HANDLE - expose forceGeocode method to parent via ref
  // -------------------------------------------------------------------------
  useImperativeHandle(ref, () => ({
    forceGeocode: async (): Promise<boolean> => {
      // Cancel any pending debounced geocode
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
      }

      const currentValue = valueRef.current;

      // If we already have valid coordinates (not null, not DEFAULT_REGION), consider it valid
      if (currentValue.latitude !== null && currentValue.longitude !== null &&
          !isDefaultCoordinates(currentValue.latitude, currentValue.longitude)) {
        return true;
      }

      // Geocode based on current mode
      if (currentValue.locationMode === 'exact_address') {
        // Try Mapbox geocoding for exact address
        const { addressLine1, city, state, zip } = currentValue;

        // Require at least street address >= 5 chars, city, and state
        if (!addressLine1 || addressLine1.trim().length < 5 || !city?.trim() || !state?.trim()) {
          setGeocodeError('Please enter a street address (5+ chars), city, and state.');
          return false;
        }

        const fullAddress = `${addressLine1.trim()}, ${city.trim()}, ${state.trim()} ${zip?.trim() || ''}`.trim();

        setIsGeocoding(true);
        setGeocodeError(null);

        try {
          const result = await geocodeAddress(fullAddress);

          if (result) {
            const displayText = [addressLine1, city, state, zip]
              .filter(Boolean)
              .join(', ');

            onChange({
              ...currentValue,
              latitude: result.latitude,
              longitude: result.longitude,
              displayLocationText: displayText,
              geoSource: 'GEOCODED',
              isApproximate: false,
              geocodeConfidence: 0.9,
              pinAdjustedByUser: false,
            });

            mapRef.current?.animateToRegion(
              {
                latitude: result.latitude,
                longitude: result.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              },
              500
            );

            setIsGeocoding(false);
            return true;
          } else {
            // Geocode failed - do NOT update coordinates
            setGeocodeError("Couldn't verify address — use Locate on Map or drag pin.");
            setIsGeocoding(false);
            return false;
          }
        } catch (error) {
          console.log('GEOCODE_FAIL', error);
          // Geocode failed - do NOT update coordinates
          setGeocodeError("Couldn't verify address — use Locate on Map or drag pin.");
          setIsGeocoding(false);
          return false;
        }
      } else if (currentValue.locationMode === 'cross_streets') {
        const { areaType, crossStreet1, crossStreet2, genericAreaText, nearestCityState } = currentValue;

        let query = '';
        if (areaType === 'cross_streets') {
          if (!crossStreet1 || !crossStreet2 || !nearestCityState) {
            setGeocodeError('Please enter both cross streets and nearest city.');
            return false;
          }
          query = `${crossStreet1} & ${crossStreet2}, ${nearestCityState}`;
        } else {
          if (!genericAreaText || !nearestCityState) {
            setGeocodeError('Please enter area description and nearest city.');
            return false;
          }
          query = `${genericAreaText}, ${nearestCityState}`;
        }

        setIsGeocoding(true);
        setGeocodeError(null);

        const result = await geocodeApproximateLocation(query, {
          nearestCityState,
          isIntersection: areaType === 'cross_streets',
        });

        setIsGeocoding(false);

        if (result) {
          const displayText =
            areaType === 'cross_streets'
              ? `${crossStreet1} & ${crossStreet2}, ${nearestCityState}`
              : `${genericAreaText}, ${nearestCityState}`;

          onChange({
            ...currentValue,
            latitude: result.latitude,
            longitude: result.longitude,
            displayLocationText: displayText,
            geoSource: 'GEOCODED',
            isApproximate: true,
            geocodeConfidence: result.confidence,
            pinAdjustedByUser: false,
          });

          mapRef.current?.animateToRegion(
            {
              latitude: result.latitude,
              longitude: result.longitude,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            },
            500
          );

          return true;
        } else {
          setGeocodeError("Could not find this location. Please drop a pin on the map.");
          return false;
        }
      } else if (currentValue.locationMode === 'use_my_location') {
        // For GPS mode, if no coordinates, user needs to tap the button
        setLocationError('Please tap "Use My Current Location" to get coordinates.');
        return false;
      }

      return false;
    },
  }), [onChange]);

  // -------------------------------------------------------------------------
  // Use My Location: GPS
  // -------------------------------------------------------------------------
  const handleUseMyLocation = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLocating(true);
    setLocationError(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        setLocationError(
          'Location permission denied. You can enable it in Settings or use Address/Cross Streets.'
        );
        setIsLocating(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude, accuracy } = location.coords;

      // Reverse geocode for display text and address fields
      let displayText = 'Current location';
      let city = '';
      let state = '';
      let streetAddress = '';
      let zip = '';
      let streetNumber = '';
      let streetName = '';

      try {
        const reverseResults = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });
        if (reverseResults.length > 0) {
          const r = reverseResults[0];
          if (r.city && r.region) {
            city = r.city;
            state = r.region;
            displayText = `Near ${r.street || r.name || city}, ${city}, ${state}`;
          }
          // Extract street address components
          if (r.streetNumber) {
            streetNumber = r.streetNumber;
          }
          if (r.street) {
            streetName = r.street;
            // Build full street address
            streetAddress = streetNumber ? `${streetNumber} ${streetName}` : streetName;
          } else if (r.name && r.name !== city) {
            streetAddress = r.name;
          }
          // Extract ZIP/postal code
          if (r.postalCode) {
            zip = r.postalCode;
          }
        }
      } catch {
        // Ignore reverse geocode errors
      }

      onChange({
        ...value,
        latitude,
        longitude,
        displayLocationText: displayText,
        city,
        state,
        zip,
        addressLine1: streetAddress,
        nearestCityState: city && state ? `${city}, ${state}` : '',
        geoSource: 'DEVICE_GPS',
        isApproximate: !streetAddress, // Approximate if no street address
        geoAccuracyMeters: accuracy || null,
        pinAdjustedByUser: false,
      });

      // Animate map
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
      setLocationError(
        'Failed to get your location. Please try again or drop a pin manually.'
      );
    } finally {
      setIsLocating(false);
    }
  }, [value, onChange]);

  // Keep the ref in sync so handleModeChange can call this without a forward-reference
  useEffect(() => {
    handleUseMyLocationRef.current = handleUseMyLocation;
  }, [handleUseMyLocation]);

  // -------------------------------------------------------------------------
  // Map Interactions
  // -------------------------------------------------------------------------
  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const { latitude: lat, longitude: lng } = event.nativeEvent.coordinate;

      const geoSource: GeoSource =
        userRole === 'admin' ? 'ADMIN_PIN_ADJUST' : 'USER_PIN_ADJUST';

      onChange({
        ...value,
        latitude: lat,
        longitude: lng,
        geoSource,
        pinAdjustedByUser: true,
        // Keep isApproximate based on mode
      });

      setGeocodeError(null);
      setLocationError(null);
    },
    [value, onChange, userRole]
  );

  const handleMarkerDragEnd = useCallback(
    (lat: number, lng: number) => {
      const geoSource: GeoSource =
        userRole === 'admin' ? 'ADMIN_PIN_ADJUST' : 'USER_PIN_ADJUST';

      onChange({
        ...value,
        latitude: lat,
        longitude: lng,
        geoSource,
        pinAdjustedByUser: true,
      });
    },
    [value, onChange, userRole]
  );

  // -------------------------------------------------------------------------
  // Field Change Handlers
  // -------------------------------------------------------------------------
  const handleAddressChange = useCallback(
    (text: string) => {
      // Trigger autocomplete search
      triggerAutocompleteSearch(text);

      // Check for full address paste (with commas or state pattern)
      const hasComma = text.includes(',');
      const hasStatePattern = /[A-Z]{2}\s*\d{5}|,\s*[A-Z]{2}(?:\s|$)/i.test(text);

      if (hasComma || hasStatePattern) {
        // Parse full address
        const parts = text.split(',').map((p) => p.trim());
        if (parts.length >= 2) {
          const street = parts[0];
          let parsedCity = '';
          let parsedState = 'OR';
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

          // Trigger geocode after a short delay
          setTimeout(triggerExactGeocode, 100);
        } else {
          onChange({ ...value, addressLine1: text });
        }
      } else {
        onChange({ ...value, addressLine1: text });
      }
    },
    [value, onChange, triggerExactGeocode, triggerAutocompleteSearch]
  );

  const handleAddressFocus = useCallback(() => {
    isEditingAddressRef.current = true;
    // Show suggestions if we have any
    if (addressSuggestions.length > 0) {
      setShowSuggestions(true);
    }
  }, [addressSuggestions.length]);

  const handleAddressBlur = useCallback(() => {
    isEditingAddressRef.current = false;
    // Hide suggestions after a short delay (allow tap to register)
    setTimeout(() => {
      setShowSuggestions(false);
    }, 200);
    // Trigger geocode after user finishes editing address
    if (value.addressLine1 && value.city) {
      triggerExactGeocode();
    }
  }, [value.addressLine1, value.city, triggerExactGeocode]);

  const handleZipFocus = useCallback(() => {
    isEditingZipRef.current = true;
  }, []);

  const handleZipBlur = useCallback(() => {
    isEditingZipRef.current = false;
    // Trigger geocode after user finishes editing zip
    if (value.zip && value.city) {
      triggerExactGeocode();
    }
  }, [value.zip, value.city, triggerExactGeocode]);

  const handleCityChange = useCallback(
    (text: string) => {
      // Only update city value - do NOT trigger geocode while typing
      // Geocode will be triggered on blur via handleCityBlur
      onChange({ ...value, city: text });
    },
    [value, onChange]
  );

  const handleCityFocus = useCallback(() => {
    isEditingCityRef.current = true;
  }, []);

  const handleCityBlur = useCallback(() => {
    isEditingCityRef.current = false;
    // Trigger geocode after user finishes editing city
    if (value.city && value.state) {
      triggerExactGeocode();
    }
  }, [value.city, value.state, triggerExactGeocode]);

  const handleStateChange = useCallback(
    (text: string) => {
      const upper = text.toUpperCase();
      // Only update state value - do NOT trigger geocode while typing
      onChange({ ...value, state: upper });
    },
    [value, onChange]
  );

  const handleStateFocus = useCallback(() => {
    isEditingStateRef.current = true;
  }, []);

  const handleStateBlur = useCallback(() => {
    isEditingStateRef.current = false;
    // Trigger geocode after user finishes editing state
    if (value.state.length === 2 && value.city) {
      triggerExactGeocode();
    }
  }, [value.state, value.city, triggerExactGeocode]);

  const handleCrossStreet1Change = useCallback(
    (text: string) => {
      // Only update value - geocode on blur
      onChange({ ...value, crossStreet1: text });
    },
    [value, onChange]
  );

  const handleCrossStreet1Focus = useCallback(() => {
    isEditingCrossStreet1Ref.current = true;
  }, []);

  const handleCrossStreet1Blur = useCallback(() => {
    isEditingCrossStreet1Ref.current = false;
    triggerCrossStreetsGeocode();
  }, [triggerCrossStreetsGeocode]);

  const handleCrossStreet2Change = useCallback(
    (text: string) => {
      // Only update value - geocode on blur
      onChange({ ...value, crossStreet2: text });
    },
    [value, onChange]
  );

  const handleCrossStreet2Focus = useCallback(() => {
    isEditingCrossStreet2Ref.current = true;
  }, []);

  const handleCrossStreet2Blur = useCallback(() => {
    isEditingCrossStreet2Ref.current = false;
    triggerCrossStreetsGeocode();
  }, [triggerCrossStreetsGeocode]);

  const handleGenericAreaChange = useCallback(
    (text: string) => {
      // Only update value - geocode on blur
      onChange({ ...value, genericAreaText: text });
    },
    [value, onChange]
  );

  const handleGenericAreaFocus = useCallback(() => {
    isEditingGenericAreaRef.current = true;
  }, []);

  const handleGenericAreaBlur = useCallback(() => {
    isEditingGenericAreaRef.current = false;
    triggerCrossStreetsGeocode();
  }, [triggerCrossStreetsGeocode]);

  const handleNearestCityStateChange = useCallback(
    (text: string) => {
      // Only update value - geocode on blur
      onChange({ ...value, nearestCityState: text });
    },
    [value, onChange]
  );

  const handleNearestCityStateFocus = useCallback(() => {
    isEditingNearestCityStateRef.current = true;
  }, []);

  const handleNearestCityStateBlur = useCallback(() => {
    isEditingNearestCityStateRef.current = false;
    triggerCrossStreetsGeocode();
  }, [triggerCrossStreetsGeocode]);

  const handleAreaTypeChange = useCallback(
    (type: AreaType) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onChange({ ...value, areaType: type });
    },
    [value, onChange]
  );

  // -------------------------------------------------------------------------
  // City→ZIP Auto-fill: lookup ZIP from city+state using Supabase
  // -------------------------------------------------------------------------
  const [zipHint, setZipHint] = useState<string | null>(null);
  const [isLookingUpZip, setIsLookingUpZip] = useState(false);

  const lookupZipFromCityState = useCallback(async (city: string, state: string) => {
    // Only lookup if ZIP is empty and we have city+state
    if (value.zip || !city.trim() || !state.trim() || state.length !== 2) {
      setZipHint(null);
      return;
    }

    // Check if Supabase is configured
    if (!isSupabaseConfigured()) {
      return;
    }

    setIsLookingUpZip(true);
    setZipHint(null);

    try {
      // Use ilike for case-insensitive city matching
      const { data, error } = await supabase
        .from<{ zip: string }>('zip_lookup')
        .select('zip')
        .ilike('city', city.trim())
        .eq('state', state.trim().toUpperCase())
        .limit(5)
        .execute();

      // Silently handle errors (table may not exist yet)
      if (error) {
        // Don't log 404 errors - table may not be set up yet
        if (!error.message?.includes('404')) {
          console.log('[LocationInput] ZIP lookup error:', error.message);
        }
        setIsLookingUpZip(false);
        return;
      }

      if (data && data.length === 1) {
        // Exactly one ZIP found - auto-fill it
        onChange({ ...value, zip: data[0].zip });
        setZipHint(null);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (data && data.length > 1) {
        // Multiple ZIPs - show hint
        setZipHint('Multiple ZIP codes for this city. Please enter ZIP.');
      }
      // If no results, do nothing (user types ZIP manually)
    } catch (err) {
      // Silently fail - ZIP lookup is optional enhancement
      // Table may not exist yet
    } finally {
      setIsLookingUpZip(false);
    }
  }, [value, onChange]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (geocodeTimeoutRef.current) {
        clearTimeout(geocodeTimeoutRef.current);
      }
    };
  }, []);

  // Use helper to check for valid coordinates (not null, not DEFAULT_REGION)
  const hasPin = value.latitude !== null && value.longitude !== null &&
    !isDefaultCoordinates(value.latitude, value.longitude);

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------
  return (
    <View className="gap-4">
      {/* Section Header */}
      {labels?.title && (
        <View className="mb-2">
          <Text className="text-forest font-semibold text-sm uppercase tracking-wide">
            {labels.title}
          </Text>
          {labels.subtitle && (
            <Text className="text-wood text-sm mt-1">{labels.subtitle}</Text>
          )}
        </View>
      )}

      {/* Mode Selector */}
      <ModeSelector value={value.locationMode} onChange={handleModeChange} />

      {/* =================================================================== */}
      {/* MODE 1: EXACT ADDRESS */}
      {/* =================================================================== */}
      {value.locationMode === 'exact_address' && (
        <Animated.View entering={FadeIn} className="gap-4">
          {/* Street Address with Autocomplete */}
          <View style={{ zIndex: 1000 }}>
            <Text className="text-sm font-medium text-charcoal mb-1">Street Address</Text>
            <Text className="text-wood text-xs mb-2">
              Start typing to see address suggestions, or enter manually.
            </Text>
            <View style={{ position: 'relative' }}>
              <View className="flex-row items-center bg-cream/60 rounded-xl border border-sand/60">
                <Search size={18} color="#A89080" style={{ marginLeft: 14 }} />
                <TextInput
                  className="flex-1 px-3 py-3.5 text-base text-charcoal"
                  value={value.addressLine1}
                  onChangeText={handleAddressChange}
                  onFocus={handleAddressFocus}
                  onBlur={handleAddressBlur}
                  placeholder="123 Main Street"
                  placeholderTextColor="#A89080"
                  textContentType="streetAddressLine1"
                  autoComplete="off"
                  autoCorrect={false}
                  blurOnSubmit
                />
                {isLoadingSuggestions && (
                  <ActivityIndicator size="small" color="#8B6F4E" style={{ marginRight: 14 }} />
                )}
              </View>

              {/* Autocomplete Dropdown */}
              {showSuggestions && addressSuggestions.length > 0 && (
                <View style={styles.suggestionsContainer}>
                  <View style={{ maxHeight: 260 }}>
                    {addressSuggestions.map((item, index) => (
                      <React.Fragment key={item.id}>
                        {index > 0 && <View style={styles.suggestionSeparator} />}
                        <Pressable
                          onPress={() => handleSuggestionSelect(item)}
                          style={({ pressed }) => [
                            styles.suggestionItem,
                            pressed && styles.suggestionItemPressed,
                            index === 0 && styles.suggestionItemFirst,
                            index === addressSuggestions.length - 1 && styles.suggestionItemLast,
                          ]}
                        >
                          <View className="flex-row items-start">
                            <MapPin size={16} color="#2D5A3D" style={{ marginTop: 2, marginRight: 10 }} />
                            <View className="flex-1">
                              <Text className="text-charcoal font-medium text-sm" numberOfLines={1}>
                                {item.street || item.label.split(',')[0]}
                              </Text>
                              <Text className="text-wood text-xs mt-0.5" numberOfLines={1}>
                                {item.city}{item.city && item.state ? ', ' : ''}{item.state} {item.zip}
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                      </React.Fragment>
                    ))}
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* City / State / ZIP Row */}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="text-sm font-medium text-charcoal mb-1">
                City <Text className="text-forest">*</Text>
              </Text>
              <TextInput
                className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
                value={value.city}
                onChangeText={handleCityChange}
                onFocus={handleCityFocus}
                onBlur={(e) => {
                  handleCityBlur();
                  // Trigger ZIP lookup when city loses focus
                  lookupZipFromCityState(value.city, value.state);
                }}
                placeholder="Portland"
                placeholderTextColor="#A89080"
                textContentType="addressCity"
                blurOnSubmit
              />
            </View>
            <View className="w-20">
              <Text className="text-sm font-medium text-charcoal mb-1">State</Text>
              <TextInput
                className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60 text-center"
                value={value.state}
                onChangeText={handleStateChange}
                onFocus={handleStateFocus}
                onBlur={(e) => {
                  handleStateBlur();
                  // Trigger ZIP lookup when state loses focus
                  if (value.state.length === 2) {
                    lookupZipFromCityState(value.city, value.state);
                  }
                }}
                placeholder="OR"
                placeholderTextColor="#A89080"
                maxLength={2}
                autoCapitalize="characters"
                textContentType="addressState"
                blurOnSubmit
              />
            </View>
            <View className="w-24">
              <Text className="text-sm font-medium text-charcoal mb-1">ZIP</Text>
              <TextInput
                className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
                value={value.zip}
                onChangeText={(text) => onChange({ ...value, zip: text })}
                onFocus={handleZipFocus}
                onBlur={handleZipBlur}
                placeholder="97XXX"
                placeholderTextColor="#A89080"
                keyboardType="numeric"
                maxLength={5}
                textContentType="postalCode"
                blurOnSubmit
              />
            </View>
          </View>

          {/* ZIP Lookup Status */}
          {(isLookingUpZip || zipHint) && (
            <Animated.View entering={FadeIn} exiting={FadeOut} className="flex-row items-center gap-2 px-1 -mt-2">
              {isLookingUpZip ? (
                <>
                  <ActivityIndicator size="small" color="#8B6F4E" />
                  <Text className="text-xs text-wood">Looking up ZIP...</Text>
                </>
              ) : zipHint ? (
                <>
                  <Info size={12} color="#D97706" />
                  <Text className="text-xs text-amber-600">{zipHint}</Text>
                </>
              ) : null}
            </Animated.View>
          )}

          {/* GPS Status - Location is verified ONLY via map/pin */}
          <View className="bg-cream/80 rounded-xl p-4 border border-sand/40">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                {hasPin ? (
                  <CheckCircle2 size={18} color="#2D5A3D" />
                ) : (
                  <Circle size={18} color="#A89080" />
                )}
                <Text className="text-charcoal font-medium ml-2 text-sm">
                  Map Location
                </Text>
              </View>
            </View>

            {hasPin ? (
              <View className="mt-2">
                <Text className="text-forest text-sm font-medium">Location verified</Text>
                <Text className="text-wood text-xs mt-0.5">
                  {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)}
                </Text>
              </View>
            ) : (
              <Text className="text-wood text-sm mt-2">
                Tap "Locate on Map" or drop a pin on the map below
              </Text>
            )}
          </View>

          {/* Map Preview for exact address - show always for fallback */}
          <MapPreview
            latitude={value.latitude}
            longitude={value.longitude}
            initialRegion={initialRegion}
            onMapPress={handleMapPress}
            onMarkerDragEnd={handleMarkerDragEnd}
            mapRef={mapRef}
          />

          {/* Locate on Map hint */}
          {!hasPin && (
            <View className="flex-row items-center gap-2 px-1">
              <MapPin size={12} color="#8B6F4E" />
              <Text className="text-xs text-wood">
                Can't find your address? Tap the map to drop a pin manually
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {/* =================================================================== */}
      {/* MODE 2: CROSS STREETS */}
      {/* =================================================================== */}
      {value.locationMode === 'cross_streets' && (
        <Animated.View entering={FadeIn} className="gap-4">
          {/* Warning Banner */}
          <Animated.View
            entering={FadeIn}
            className="flex-row items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200"
          >
            <AlertTriangle size={20} color="#D97706" />
            <View className="flex-1">
              <Text className="text-sm font-medium text-amber-800">Approximate pin</Text>
              <Text className="text-xs text-amber-700 mt-1">
                We'll place an approximate pin. You can adjust it on the map. Admin will
                verify before publishing.
              </Text>
            </View>
          </Animated.View>

          {/* Area Type Selector */}
          <View>
            <Text className="text-sm font-medium text-charcoal mb-2">
              How do you want to describe it?
            </Text>
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => handleAreaTypeChange('cross_streets')}
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
                onPress={() => handleAreaTypeChange('generic_area')}
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
                  onChangeText={handleCrossStreet1Change}
                  onFocus={handleCrossStreet1Focus}
                  onBlur={handleCrossStreet1Blur}
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
                  onChangeText={handleCrossStreet2Change}
                  onFocus={handleCrossStreet2Focus}
                  onBlur={handleCrossStreet2Blur}
                  autoCapitalize="words"
                />
              </View>
              {/* Validation helper text */}
              <Text className="text-xs text-wood px-1 -mt-2">
                Enter two nearby cross streets (e.g., Oak St & Main Ave)
              </Text>
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
                onChangeText={handleGenericAreaChange}
                onFocus={handleGenericAreaFocus}
                onBlur={handleGenericAreaBlur}
                autoCapitalize="sentences"
                multiline
              />
            </View>
          )}

          {/* Nearest City/State */}
          <View>
            <Text className="text-sm font-medium text-charcoal mb-2">
              Nearest city + state <Text className="text-rust">*</Text>
            </Text>
            <TextInput
              className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
              placeholder="Example: Springfield, OR"
              placeholderTextColor="#A89080"
              value={value.nearestCityState}
              onChangeText={handleNearestCityStateChange}
              onFocus={handleNearestCityStateFocus}
              onBlur={handleNearestCityStateBlur}
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
          <MapPreview
            latitude={value.latitude}
            longitude={value.longitude}
            initialRegion={initialRegion}
            onMapPress={handleMapPress}
            onMarkerDragEnd={handleMarkerDragEnd}
            mapRef={mapRef}
          />

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
        </Animated.View>
      )}

      {/* =================================================================== */}
      {/* MODE 3: USE MY LOCATION */}
      {/* =================================================================== */}
      {value.locationMode === 'use_my_location' && (
        <Animated.View entering={FadeIn} className="gap-4">
          {/* Use My Current Location Button */}
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
                <Text className="text-white font-semibold text-base ml-3">
                  Getting location...
                </Text>
              </>
            ) : (
              <>
                <Crosshair size={20} color="#FFFFFF" />
                <Text className="text-white font-semibold text-base ml-3">
                  Use My Current Location
                </Text>
              </>
            )}
          </Pressable>

          {/* Location Error */}
          {locationError && (
            <Animated.View
              entering={FadeIn}
              className="flex-row items-start gap-2 px-1"
            >
              <AlertTriangle size={16} color="#C45C3E" />
              <Text className="text-sm text-rust flex-1">{locationError}</Text>
            </Animated.View>
          )}

          {/* Map Preview */}
          <MapPreview
            latitude={value.latitude}
            longitude={value.longitude}
            initialRegion={initialRegion}
            onMapPress={handleMapPress}
            onMarkerDragEnd={handleMarkerDragEnd}
            mapRef={mapRef}
            isLocating={isLocating}
          />

          {/* Address Fields - Show after pin is set */}
          {hasPin && (
            <Animated.View entering={FadeIn} className="gap-4">
              <View className="bg-cream/80 rounded-xl p-4 border border-sand/40">
                <View className="flex-row items-center mb-3">
                  <CheckCircle2 size={18} color="#2D5A3D" />
                  <Text className="text-charcoal font-medium ml-2 text-sm">
                    Location captured - verify address below
                  </Text>
                </View>
                <Text className="text-wood text-xs">
                  {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)}
                </Text>
              </View>

              {/* Street Address */}
              <View>
                <Text className="text-sm font-medium text-charcoal mb-1">
                  Street Address <Text className="text-forest">*</Text>
                </Text>
                <TextInput
                  className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
                  value={value.addressLine1}
                  onChangeText={(text) => onChange({ ...value, addressLine1: text })}
                  placeholder="123 Main Street"
                  placeholderTextColor="#A89080"
                  textContentType="streetAddressLine1"
                  blurOnSubmit
                />
              </View>

              {/* City / State / ZIP Row */}
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Text className="text-sm font-medium text-charcoal mb-1">
                    City <Text className="text-forest">*</Text>
                  </Text>
                  <TextInput
                    className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
                    value={value.city}
                    onChangeText={(text) => onChange({ ...value, city: text })}
                    placeholder="Portland"
                    placeholderTextColor="#A89080"
                    textContentType="addressCity"
                    blurOnSubmit
                  />
                </View>
                <View className="w-20">
                  <Text className="text-sm font-medium text-charcoal mb-1">State</Text>
                  <TextInput
                    className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60 text-center"
                    value={value.state}
                    onChangeText={(text) => onChange({ ...value, state: text.toUpperCase() })}
                    placeholder="OR"
                    placeholderTextColor="#A89080"
                    maxLength={2}
                    autoCapitalize="characters"
                    textContentType="addressState"
                    blurOnSubmit
                  />
                </View>
                <View className="w-24">
                  <Text className="text-sm font-medium text-charcoal mb-1">ZIP</Text>
                  <TextInput
                    className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
                    value={value.zip}
                    onChangeText={(text) => onChange({ ...value, zip: text })}
                    placeholder="97XXX"
                    placeholderTextColor="#A89080"
                    keyboardType="numeric"
                    maxLength={5}
                    textContentType="postalCode"
                    blurOnSubmit
                  />
                </View>
              </View>

              {/* Optional Location Note */}
              {showLocationNote && (
                <View>
                  <Text className="text-sm font-medium text-charcoal mb-2">
                    Additional directions <Text className="text-wood text-xs">(optional)</Text>
                  </Text>
                  <TextInput
                    className="bg-cream/60 rounded-xl px-4 py-3.5 text-base text-charcoal border border-sand/60"
                    placeholder="e.g., by the red barn, past mile marker 12"
                    placeholderTextColor="#A89080"
                    value={value.locationNote}
                    onChangeText={(text) => onChange({ ...value, locationNote: text })}
                    autoCapitalize="sentences"
                  />
                </View>
              )}
            </Animated.View>
          )}

          {/* Location Info when no address fields visible */}
          {hasPin && value.nearestCityState && !value.city && (
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
        </Animated.View>
      )}

      {/* =================================================================== */}
      {/* VALIDATION WARNING */}
      {/* =================================================================== */}
      {requireCoordinates && !hasPin && (
        <Animated.View
          entering={FadeInDown.delay(500)}
          className="flex-row items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200"
        >
          <AlertTriangle size={16} color="#DC2626" />
          <Text className="text-sm text-red-700 flex-1">
            Add a location so this Farmstand can appear on the map.
          </Text>
        </Animated.View>
      )}
    </View>
  );
});

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
  // Autocomplete suggestion styles
  suggestionsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8DDD4',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
    zIndex: 1000,
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  suggestionItemPressed: {
    backgroundColor: '#F5F0EB',
  },
  suggestionItemFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  suggestionItemLast: {
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  suggestionSeparator: {
    height: 1,
    backgroundColor: '#F0EBE6',
    marginHorizontal: 14,
  },
});

export default LocationInput;
