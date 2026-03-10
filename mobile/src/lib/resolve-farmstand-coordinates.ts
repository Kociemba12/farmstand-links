/**
 * Shared geocoding utility for farmstand coordinates
 *
 * This function is used by BOTH:
 * - Admin Dashboard → Manage Farmstands → Edit Farmstand
 * - Admin Dashboard → Pending Approvals
 *
 * Ensures identical GPS auto-populate behavior across both screens.
 */

import * as Location from 'expo-location';
import { geocodeApproximateLocation, isIntersectionQuery } from './geocoding';

// ============================================================================
// TYPES
// ============================================================================

export type GeocodeSource = 'address' | 'cross_streets' | 'device' | 'manual';
export type GeocodeConfidence = 'high' | 'medium' | 'low';

export interface FarmstandLocationInput {
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
}

export interface FarmstandCoordinatesResult {
  latitude: number | null;
  longitude: number | null;
  geocodeSource: GeocodeSource;
  geocodeConfidence: GeocodeConfidence;
  error: string | null;
  zip?: string; // Filled from reverse geocode if missing
}

// ============================================================================
// CROSS-STREET DETECTION
// ============================================================================

/**
 * Detects if addressLine1 contains cross streets
 * Patterns: " & ", " and ", " / ", " @ ", " at "
 */
export function isCrossStreetAddress(addressLine1: string): boolean {
  if (!addressLine1) return false;

  const crossStreetPatterns = [
    /\s+&\s+/i,
    /\s+and\s+/i,
    /\s+\/\s+/,
    /\s+@\s+/,
    /\s+at\s+/i,
  ];

  return crossStreetPatterns.some(pattern => pattern.test(addressLine1));
}

/**
 * Builds a geocode query for cross streets
 * Normalizes various formats to "Street1 and Street2, City, State"
 *
 * Examples:
 * - Input: "SE Sunnyside Rd & 122nd Ave"
 *   Query: "SE Sunnyside Rd and 122nd Ave, Clackamas, OR"
 * - Input: "Highway 224 / SE Hogan Rd"
 *   Query: "Highway 224 and SE Hogan Rd, Estacada, OR"
 */
export function buildCrossStreetQuery(
  addressLine1: string,
  city: string,
  state: string
): string {
  // Normalize cross street indicators to "and"
  let normalized = addressLine1
    .replace(/\s+&\s+/gi, ' and ')
    .replace(/\s+\/\s+/g, ' and ')
    .replace(/\s+@\s+/g, ' and ')
    .replace(/\s+at\s+/gi, ' and ');

  // Build the full query with city and state
  const parts: string[] = [normalized];
  if (city) parts.push(city);
  if (state) parts.push(state);

  return parts.join(', ');
}

// ============================================================================
// MAIN GEOCODING FUNCTION
// ============================================================================

/**
 * Resolves farmstand coordinates from address fields
 *
 * Strategy (priority order):
 * 1. If full address present → geocode full address → source=address; confidence=high/medium
 * 2. If cross streets detected → geocode cross-street query → source=cross_streets; confidence=medium/low
 * 3. If geocode fails → return error but DO NOT clear existing lat/lng
 *
 * @param input - Address fields (addressLine1, city, state, zip)
 * @returns Promise<FarmstandCoordinatesResult>
 */
export async function resolveFarmstandCoordinates(
  input: FarmstandLocationInput
): Promise<FarmstandCoordinatesResult> {
  const { addressLine1, city, state, zip } = input;

  // Need at least addressLine1 and one of city/state to attempt geocoding
  if (!addressLine1?.trim()) {
    return {
      latitude: null,
      longitude: null,
      geocodeSource: 'manual',
      geocodeConfidence: 'low',
      error: null, // Not an error, just not enough info
    };
  }

  if (!city?.trim() && !state?.trim()) {
    return {
      latitude: null,
      longitude: null,
      geocodeSource: 'manual',
      geocodeConfidence: 'low',
      error: null, // Not an error, just not enough info
    };
  }

  const isCrossStreet = isCrossStreetAddress(addressLine1);

  try {
    if (isCrossStreet) {
      // ===== CROSS STREETS GEOCODING =====
      const crossStreetQuery = buildCrossStreetQuery(addressLine1, city, state);

      const result = await geocodeApproximateLocation(crossStreetQuery, {
        nearestCityState: city && state ? `${city}, ${state}` : null,
        isIntersection: true,
      });

      if (result) {
        // Determine confidence based on geocode confidence score
        let confidence: GeocodeConfidence = 'medium';
        if (result.confidence >= 0.7) {
          confidence = 'medium'; // Cross streets max at medium
        } else if (result.confidence >= 0.4) {
          confidence = 'medium';
        } else {
          confidence = 'low';
        }

        return {
          latitude: result.latitude,
          longitude: result.longitude,
          geocodeSource: 'cross_streets',
          geocodeConfidence: confidence,
          error: null,
        };
      } else {
        return {
          latitude: null,
          longitude: null,
          geocodeSource: 'cross_streets',
          geocodeConfidence: 'low',
          error: "Couldn't auto-locate cross streets. Please adjust or use map pin.",
        };
      }
    } else {
      // ===== FULL ADDRESS GEOCODING =====
      const addressParts: string[] = [];
      if (addressLine1.trim()) addressParts.push(addressLine1.trim());
      if (city.trim()) addressParts.push(city.trim());
      if (state.trim()) addressParts.push(state.trim());
      if (zip?.trim()) addressParts.push(zip.trim());

      const fullAddress = addressParts.join(', ');

      const results = await Location.geocodeAsync(fullAddress);

      if (results.length > 0) {
        const { latitude, longitude } = results[0];

        // Try to fill ZIP if missing via reverse geocode
        let filledZip: string | undefined;
        if (!zip) {
          try {
            const reverseResults = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (reverseResults.length > 0 && reverseResults[0].postalCode) {
              filledZip = reverseResults[0].postalCode;
            }
          } catch {
            // Ignore reverse geocode errors
          }
        }

        return {
          latitude,
          longitude,
          geocodeSource: 'address',
          geocodeConfidence: 'high',
          error: null,
          zip: filledZip,
        };
      } else {
        return {
          latitude: null,
          longitude: null,
          geocodeSource: 'address',
          geocodeConfidence: 'low',
          error: "Couldn't auto-locate. Please adjust or use map pin.",
        };
      }
    }
  } catch (error) {
    console.error('Geocoding error in resolveFarmstandCoordinates:', error);
    return {
      latitude: null,
      longitude: null,
      geocodeSource: isCrossStreet ? 'cross_streets' : 'address',
      geocodeConfidence: 'low',
      error: "Failed to look up coordinates. Please try again.",
    };
  }
}

/**
 * Gets coordinates from device GPS
 * @returns Promise<FarmstandCoordinatesResult>
 */
export async function getDeviceCoordinates(): Promise<FarmstandCoordinatesResult & {
  city?: string;
  state?: string;
  addressLine1?: string;
}> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== 'granted') {
      return {
        latitude: null,
        longitude: null,
        geocodeSource: 'device',
        geocodeConfidence: 'low',
        error: 'Location permission denied. Please enable location access or enter address manually.',
      };
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    const { latitude, longitude } = location.coords;

    // Reverse geocode to get address info
    let city: string | undefined;
    let state: string | undefined;
    let addressLine1: string | undefined;
    let zip: string | undefined;

    try {
      const reverseResults = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (reverseResults.length > 0) {
        const r = reverseResults[0];
        city = r.city || undefined;
        state = r.region || undefined;
        addressLine1 = r.street || undefined;
        zip = r.postalCode || undefined;
      }
    } catch {
      // Ignore reverse geocode errors
    }

    return {
      latitude,
      longitude,
      geocodeSource: 'device',
      geocodeConfidence: 'high',
      error: null,
      city,
      state,
      addressLine1,
      zip,
    };
  } catch (error) {
    console.error('Device location error:', error);
    return {
      latitude: null,
      longitude: null,
      geocodeSource: 'device',
      geocodeConfidence: 'low',
      error: 'Failed to get your location. Please try again or enter address manually.',
    };
  }
}

// ============================================================================
// DEBOUNCED GEOCODING HOOK HELPER
// ============================================================================

/**
 * Creates a debounced geocoder function
 * Cancels prior requests if new input arrives
 *
 * @param onResult - Callback with geocode result
 * @param delay - Debounce delay in ms (default 600ms)
 * @returns Function to trigger geocoding
 */
export function createDebouncedFarmstandGeocoder(
  onResult: (result: FarmstandCoordinatesResult) => void,
  delay: number = 600
): {
  trigger: (input: FarmstandLocationInput) => void;
  cancel: () => void;
} {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  const trigger = (input: FarmstandLocationInput) => {
    // Cancel prior request
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (abortController) {
      abortController.abort();
    }

    abortController = new AbortController();

    timeoutId = setTimeout(async () => {
      const result = await resolveFarmstandCoordinates(input);
      // Check if aborted
      if (!abortController?.signal.aborted) {
        onResult(result);
      }
    }, delay);
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  };

  return { trigger, cancel };
}
