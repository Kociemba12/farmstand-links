/**
 * AddressAutocomplete - Google Places-powered address autocomplete component
 *
 * Shows a dropdown of address suggestions as the user types using Google Places API.
 * When a suggestion is tapped, it auto-fills all address fields and sets coordinates.
 */

import React, { useRef, useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GooglePlacesAutocomplete, GooglePlaceData, GooglePlaceDetail } from 'react-native-google-places-autocomplete';
import { MapPin, AlertCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

// ============================================================================
// TYPES
// ============================================================================

export interface AddressData {
  street: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

export interface AddressAutocompleteProps {
  value: string;
  onChangeText: (text: string) => void;
  onSelectAddress: (data: AddressData) => void;
  placeholder?: string;
  defaultState?: string;
  inputStyle?: string;
}

// Get the Google API key from environment
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_VIBECODE_GOOGLE_API_KEY || '';

// ============================================================================
// HELPER: Parse Google Place details into address components
// ============================================================================

function parseAddressComponents(details: GooglePlaceDetail | null): AddressData {
  if (!details || !details.address_components) {
    return {
      street: '',
      city: '',
      state: '',
      zip: '',
      latitude: null,
      longitude: null,
    };
  }

  let streetNumber = '';
  let streetName = '';
  let city = '';
  let state = '';
  let zip = '';

  for (const component of details.address_components) {
    const types = component.types;

    if (types.includes('street_number')) {
      streetNumber = component.long_name;
    } else if (types.includes('route')) {
      streetName = component.long_name;
    } else if (types.includes('locality')) {
      city = component.long_name;
    } else if (types.includes('sublocality_level_1') && !city) {
      city = component.long_name;
    } else if (types.includes('administrative_area_level_1')) {
      state = component.short_name; // Use short name for state (e.g., "OR" not "Oregon")
    } else if (types.includes('postal_code')) {
      zip = component.long_name;
    }
  }

  // Build street address
  const street = streetNumber && streetName
    ? `${streetNumber} ${streetName}`
    : streetName || '';

  // Get coordinates
  const latitude = details.geometry?.location?.lat ?? null;
  const longitude = details.geometry?.location?.lng ?? null;

  return {
    street,
    city,
    state,
    zip,
    latitude,
    longitude,
  };
}

// ============================================================================
// COMPONENT
// ============================================================================

export function AddressAutocomplete({
  value,
  onChangeText,
  onSelectAddress,
  placeholder = 'Start typing your address...',
  defaultState = 'OR',
}: AddressAutocompleteProps) {
  const autocompleteRef = useRef<any>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Handle when user selects a place from dropdown
  const handlePlaceSelect = useCallback(
    (data: GooglePlaceData, details: GooglePlaceDetail | null) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setApiError(null);

      // Parse the address components
      const addressData = parseAddressComponents(details);

      // IMPORTANT: Only call onSelectAddress if we have valid coordinates
      // This prevents the "Kansas coordinates" bug
      if (addressData.latitude === null || addressData.longitude === null) {
        console.warn('[AddressAutocomplete] Selected place has no coordinates:', data.description);
        setApiError('Could not get location coordinates. Please try another address or use the map.');
        return;
      }

      // Update the text input with the street address
      onChangeText(addressData.street || data.structured_formatting?.main_text || '');

      // Call parent callback with full address data
      onSelectAddress(addressData);
    },
    [onChangeText, onSelectAddress]
  );

  // Handle API errors
  const handleError = useCallback((error: string) => {
    console.error('[AddressAutocomplete] API Error:', error);
    setApiError('Address search not available. Please use the map to set location.');
    setHasSearched(true);
  }, []);

  // Handle text change
  const handleTextChange = useCallback(
    (text: string) => {
      onChangeText(text);
      setHasSearched(text.length >= 3);
      if (text.length < 3) {
        setApiError(null);
      }
    },
    [onChangeText]
  );

  // Check if API key is configured
  if (!GOOGLE_API_KEY) {
    return (
      <View>
        <View style={styles.inputContainer}>
          <View style={styles.iconContainer}>
            <AlertCircle size={16} color="#C45C3E" />
          </View>
          <Text style={styles.errorText}>
            Address autocomplete not configured. Please use the map to set location.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GooglePlacesAutocomplete
        ref={autocompleteRef}
        placeholder={placeholder}
        fetchDetails={true} // IMPORTANT: This fetches lat/lng
        onPress={handlePlaceSelect}
        onFail={handleError}
        textInputProps={{
          value: value,
          onChangeText: handleTextChange,
          placeholderTextColor: '#A89080',
          autoCorrect: false,
        }}
        query={{
          key: GOOGLE_API_KEY,
          language: 'en',
          components: 'country:us', // Restrict to US addresses
          types: 'address', // Only show addresses, not businesses
        }}
        styles={{
          container: styles.autocompleteContainer,
          textInputContainer: styles.textInputContainer,
          textInput: styles.textInput,
          listView: styles.listView,
          row: styles.row,
          separator: styles.separator,
          description: styles.description,
          poweredContainer: styles.poweredContainer,
          powered: styles.powered,
        }}
        renderLeftButton={() => (
          <View style={styles.leftIcon}>
            <MapPin size={18} color="#8B6F4E" />
          </View>
        )}
        renderRow={(data) => (
          <View style={styles.suggestionRow}>
            <View style={styles.suggestionIcon}>
              <MapPin size={16} color="#2D5A3D" />
            </View>
            <View style={styles.suggestionText}>
              <Text style={styles.mainText} numberOfLines={1}>
                {data.structured_formatting?.main_text || data.description}
              </Text>
              <Text style={styles.secondaryText} numberOfLines={1}>
                {data.structured_formatting?.secondary_text || ''}
              </Text>
            </View>
          </View>
        )}
        enablePoweredByContainer={false}
        debounce={300}
        minLength={3}
        nearbyPlacesAPI="GooglePlacesSearch"
        keyboardShouldPersistTaps="handled"
        listViewDisplayed="auto"
        suppressDefaultStyles={false}
      />

      {/* API Error Message */}
      {apiError && (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          style={styles.errorContainer}
        >
          <AlertCircle size={14} color="#C45C3E" />
          <Text style={styles.errorMessage}>{apiError}</Text>
        </Animated.View>
      )}
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    zIndex: 100,
  },
  autocompleteContainer: {
    flex: 0,
    zIndex: 100,
  },
  textInputContainer: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderBottomWidth: 0,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  textInput: {
    backgroundColor: 'rgba(253, 248, 243, 0.6)', // cream/60
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingLeft: 44, // Space for icon
    paddingVertical: 14,
    fontSize: 16,
    color: '#3D2B1F', // charcoal
    borderWidth: 1,
    borderColor: 'rgba(193, 177, 161, 0.6)', // sand/60
    height: 52,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  },
  leftIcon: {
    position: 'absolute',
    left: 14,
    top: 17,
    zIndex: 2,
  },
  listView: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(193, 177, 161, 0.6)',
    marginTop: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 1000,
  },
  row: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(193, 177, 161, 0.3)',
  },
  description: {
    color: '#3D2B1F',
    fontSize: 15,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  suggestionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(45, 90, 61, 0.1)', // forest/10
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  suggestionText: {
    flex: 1,
  },
  mainText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#3D2B1F',
  },
  secondaryText: {
    fontSize: 13,
    color: '#8B6F4E',
    marginTop: 2,
  },
  poweredContainer: {
    display: 'none',
  },
  powered: {
    display: 'none',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(196, 92, 62, 0.1)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(196, 92, 62, 0.3)',
  },
  iconContainer: {
    marginRight: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#C45C3E',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  errorMessage: {
    fontSize: 12,
    color: '#C45C3E',
    marginLeft: 6,
    flex: 1,
  },
});

export default AddressAutocomplete;
