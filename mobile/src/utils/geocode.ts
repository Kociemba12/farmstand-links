/**
 * Mapbox Geocoding utility
 * Uses Mapbox Geocoding API to convert addresses to coordinates
 */

import { getMapboxToken } from './mapboxToken';

// DEFAULT_REGION coordinates - these are NEVER valid geocode results
const DEFAULT_LAT = 44.0;
const DEFAULT_LNG = -120.5;

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

/**
 * Check if coordinates are the default/fallback (not real geocoded values)
 */
export function isDefaultCoordinates(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return true;
  // Check if coords match DEFAULT_REGION (with small tolerance for floating point)
  return Math.abs(lat - DEFAULT_LAT) < 0.001 && Math.abs(lng - DEFAULT_LNG) < 0.001;
}

/**
 * Geocode a full address using Mapbox Geocoding API
 * @param fullAddress - The full address string (e.g., "123 Main St, Portland, OR 97201")
 * @returns GeocodeResult with latitude/longitude, or null if not found
 */
export async function geocodeAddress(fullAddress: string): Promise<GeocodeResult | null> {
  console.log('GEOCODE_REQUEST', fullAddress);

  const MAPBOX_TOKEN = getMapboxToken();

  if (!fullAddress) {
    console.log('GEOCODE_FAIL', 'Missing address');
    return null;
  }

  if (!MAPBOX_TOKEN) {
    console.log('GEOCODE_FAIL', 'Missing Mapbox token');
    return null;
  }

  const url =
    'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
    encodeURIComponent(fullAddress) +
    `.json?access_token=${MAPBOX_TOKEN}&country=us&limit=1`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log('GEOCODE_FAIL', 'Mapbox API error:', res.status);
      return null;
    }

    const data = await res.json();
    if (!data?.features?.length) {
      console.log('GEOCODE_FAIL', 'No results for:', fullAddress);
      return null;
    }

    const [lng, lat] = data.features[0].center;

    // CRITICAL: Never return DEFAULT_REGION coordinates
    if (isDefaultCoordinates(lat, lng)) {
      console.log('GEOCODE_FAIL', 'Geocode returned default coordinates, treating as failure');
      return null;
    }

    console.log('GEOCODE_RESULT', lat, lng);
    return { latitude: lat, longitude: lng };
  } catch (error) {
    console.log('GEOCODE_FAIL', error);
    return null;
  }
}
