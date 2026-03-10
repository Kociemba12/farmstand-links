/**
 * Mapbox Address Autocomplete utility
 * Provides address suggestions as user types
 */

import Constants from 'expo-constants';

// Get Mapbox token - read lazily to handle config updates
function getMapboxToken(): string | undefined {
  const token = Constants.expoConfig?.extra?.MAPBOX_PUBLIC_TOKEN;
  if (token) return token;
  // Fallback for dev
  return 'EXPO_PUBLIC_MAPBOX_TOKEN_PLACEHOLDER';
}

export interface AddressSuggestion {
  id: string;
  label: string; // Full place_name
  street: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
}

interface MapboxContext {
  id: string;
  text: string;
  short_code?: string;
}

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  address?: string;
  text?: string;
  context?: MapboxContext[];
  properties?: {
    accuracy?: string;
  };
}

interface MapboxResponse {
  features: MapboxFeature[];
}

/**
 * Parse Mapbox feature into AddressSuggestion
 */
function parseFeature(feature: MapboxFeature): AddressSuggestion {
  const [lng, lat] = feature.center;

  // Extract address components from context
  let city = '';
  let state = '';
  let zip = '';

  if (feature.context) {
    for (const ctx of feature.context) {
      if (ctx.id.startsWith('place.')) {
        city = ctx.text;
      } else if (ctx.id.startsWith('region.')) {
        // Use short_code for state abbreviation (e.g., "US-OR" -> "OR")
        state = ctx.short_code?.replace('US-', '') || ctx.text;
      } else if (ctx.id.startsWith('postcode.')) {
        zip = ctx.text;
      }
    }
  }

  // Build street address from feature
  // feature.address is the house number, feature.text is the street name
  let street = '';
  if (feature.address && feature.text) {
    street = `${feature.address} ${feature.text}`;
  } else if (feature.text) {
    street = feature.text;
  } else {
    // Fallback: extract from place_name
    const parts = feature.place_name.split(',');
    street = parts[0]?.trim() || '';
  }

  return {
    id: feature.id,
    label: feature.place_name,
    street,
    city,
    state,
    zip,
    latitude: lat,
    longitude: lng,
  };
}

/**
 * Search for address suggestions using Mapbox Geocoding API
 * @param query - The partial address string to search
 * @param proximity - Optional [lng, lat] to bias results toward
 * @returns Array of address suggestions
 */
export async function searchAddressSuggestions(
  query: string,
  proximity?: { longitude: number; latitude: number }
): Promise<AddressSuggestion[]> {
  const MAPBOX_TOKEN = getMapboxToken();

  if (!query || query.length < 4) {
    return [];
  }

  if (!MAPBOX_TOKEN) {
    console.log('[autocomplete] Missing Mapbox token');
    return [];
  }

  // Build URL with parameters
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    autocomplete: 'true',
    limit: '6',
    types: 'address',
    country: 'us',
    // Oregon-ish bounding box to prioritize local results
    bbox: '-124.8,41.8,-116.5,46.5',
  });

  // Add proximity bias if available
  if (proximity) {
    params.append('proximity', `${proximity.longitude},${proximity.latitude}`);
  } else {
    // Default to Oregon center
    params.append('proximity', '-120.5,44.0');
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log('[autocomplete] Mapbox API error:', res.status);
      return [];
    }

    const data: MapboxResponse = await res.json();
    if (!data?.features?.length) {
      return [];
    }

    // Parse features into suggestions
    return data.features.map(parseFeature);
  } catch (error) {
    console.log('[autocomplete] Error:', error);
    return [];
  }
}
