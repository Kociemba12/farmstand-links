/**
 * Geocoding utility with intersection/crossroad support
 * Uses Expo Location for geocoding approximate addresses
 */

import * as Location from 'expo-location';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  confidence: number; // 0-1 score
  provider: 'expo' | 'manual';
  formattedAddress?: string;
}

export interface GeocodeOptions {
  nearestCityState?: string | null;
  isIntersection?: boolean;
}

/**
 * Detects if the query looks like an intersection/crossroad
 * Patterns: "A & B", "A and B", "A / B", "A at B"
 */
export function isIntersectionQuery(query: string): boolean {
  const intersectionPatterns = [
    /\s+&\s+/i,
    /\s+and\s+/i,
    /\s+\/\s+/,
    /\s+at\s+/i,
    /\s+@\s+/,
  ];
  return intersectionPatterns.some((pattern) => pattern.test(query));
}

/**
 * Normalizes an intersection query for better geocoding results
 * Converts various formats to "Street1 & Street2, City, State"
 */
function normalizeIntersectionQuery(query: string, nearestCityState?: string | null): string {
  // Replace common intersection indicators with "&"
  let normalized = query
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/\s+\/\s+/g, ' & ')
    .replace(/\s+at\s+/gi, ' & ')
    .replace(/\s+@\s+/g, ' & ');

  // Append city/state if provided and not already in query
  if (nearestCityState && !query.toLowerCase().includes(nearestCityState.toLowerCase())) {
    normalized = `${normalized}, ${nearestCityState}`;
  }

  return normalized.trim();
}

/**
 * Extracts distance and direction from approximate location text
 * Patterns: "5 miles past X", "2 miles north of X", "near X"
 */
interface DistanceInfo {
  miles: number | null;
  direction: 'north' | 'south' | 'east' | 'west' | 'past' | null;
  landmark: string;
}

function extractDistanceInfo(query: string): DistanceInfo | null {
  // Pattern: "X miles past/north/south/east/west of Y"
  const distancePattern = /(\d+(?:\.\d+)?)\s*(?:miles?|mi)?\s*(past|north|south|east|west)(?:\s+of)?\s+(.+)/i;
  const match = query.match(distancePattern);

  if (match) {
    return {
      miles: parseFloat(match[1]),
      direction: match[2].toLowerCase() as DistanceInfo['direction'],
      landmark: match[3].trim(),
    };
  }

  // Pattern: "near X"
  const nearPattern = /near\s+(.+)/i;
  const nearMatch = query.match(nearPattern);
  if (nearMatch) {
    return {
      miles: null,
      direction: null,
      landmark: nearMatch[1].trim(),
    };
  }

  return null;
}

/**
 * Adjusts coordinates based on distance and direction
 * 1 mile ≈ 0.0145 degrees latitude, varies for longitude
 */
function adjustCoordinates(
  lat: number,
  lng: number,
  miles: number,
  direction: 'north' | 'south' | 'east' | 'west' | 'past'
): { latitude: number; longitude: number } {
  const milesPerDegreeLat = 69; // Approximate
  const milesPerDegreeLng = 69 * Math.cos((lat * Math.PI) / 180);

  const latOffset = miles / milesPerDegreeLat;
  const lngOffset = miles / milesPerDegreeLng;

  switch (direction) {
    case 'north':
      return { latitude: lat + latOffset, longitude: lng };
    case 'south':
      return { latitude: lat - latOffset, longitude: lng };
    case 'east':
      return { latitude: lat, longitude: lng + lngOffset };
    case 'west':
      return { latitude: lat, longitude: lng - lngOffset };
    case 'past':
      // Default "past" to a slight offset in a random direction (user should adjust)
      return { latitude: lat + latOffset * 0.5, longitude: lng + lngOffset * 0.5 };
    default:
      return { latitude: lat, longitude: lng };
  }
}

/**
 * Main geocoding function with intersection and approximate location support
 */
export async function geocodeApproximateLocation(
  query: string,
  options: GeocodeOptions = {}
): Promise<GeocodeResult | null> {
  const { nearestCityState } = options;

  if (!query || query.trim().length < 3) {
    return null;
  }

  try {
    // Check if this is a distance-based query
    const distanceInfo = extractDistanceInfo(query);

    let searchQuery = query;
    let isIntersection = isIntersectionQuery(query);

    if (distanceInfo) {
      // Geocode the landmark first
      searchQuery = distanceInfo.landmark;
      if (nearestCityState) {
        searchQuery = `${searchQuery}, ${nearestCityState}`;
      }
    } else if (isIntersection) {
      // Normalize intersection query
      searchQuery = normalizeIntersectionQuery(query, nearestCityState);
    } else if (nearestCityState) {
      // Append city/state for context
      searchQuery = `${query}, ${nearestCityState}`;
    }

    // Use Expo Location for geocoding
    const results = await Location.geocodeAsync(searchQuery);

    if (results.length === 0) {
      // Try without the city/state suffix as fallback
      if (nearestCityState) {
        const fallbackResults = await Location.geocodeAsync(query);
        if (fallbackResults.length > 0) {
          return {
            latitude: fallbackResults[0].latitude,
            longitude: fallbackResults[0].longitude,
            confidence: 0.3, // Lower confidence for fallback
            provider: 'expo',
          };
        }
      }
      return null;
    }

    let { latitude, longitude } = results[0];
    let confidence = 0.7; // Base confidence for successful geocode

    // Adjust for distance-based queries
    if (distanceInfo && distanceInfo.miles && distanceInfo.direction) {
      const adjusted = adjustCoordinates(
        latitude,
        longitude,
        distanceInfo.miles,
        distanceInfo.direction
      );
      latitude = adjusted.latitude;
      longitude = adjusted.longitude;
      confidence = 0.4; // Lower confidence for distance-adjusted results
    }

    // Adjust confidence based on query type
    if (isIntersection) {
      confidence = Math.min(confidence, 0.6); // Intersections are less precise
    }

    // Get reverse geocode for formatted address
    let formattedAddress: string | undefined;
    try {
      const reverseResults = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (reverseResults.length > 0) {
        const r = reverseResults[0];
        formattedAddress = [r.street, r.city, r.region].filter(Boolean).join(', ');
      }
    } catch {
      // Ignore reverse geocode errors
    }

    return {
      latitude,
      longitude,
      confidence,
      provider: 'expo',
      formattedAddress,
    };
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

/**
 * Debounced geocoding hook helper
 * Returns a function that can be called with a query
 */
export function createDebouncedGeocoder(
  onResult: (result: GeocodeResult | null) => void,
  delay: number = 600
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (query: string, options?: GeocodeOptions) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(async () => {
      const result = await geocodeApproximateLocation(query, options);
      onResult(result);
    }, delay);

    // Return cleanup function
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  };
}
