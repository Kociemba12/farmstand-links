/**
 * Address Autocomplete
 *
 * Uses Mapbox Geocoding API v5 (autocomplete, country=us, limit=8).
 * GPS coordinates are a SOFT proximity hint only — never a hard filter.
 */

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddressSuggestion {
  id: string;
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
}

// ─── Mapbox types ─────────────────────────────────────────────────────────────

interface MapboxContext {
  id: string;
  text: string;
  short_code?: string;
}

interface MapboxFeature {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  text: string;
  address?: string;
  context?: MapboxContext[];
}

interface MapboxResponse {
  features: MapboxFeature[];
}

// ─── Mapbox parser ────────────────────────────────────────────────────────────

function parseMapboxFeature(feature: MapboxFeature): AddressSuggestion | null {
  const [lng, lat] = feature.center;
  if (!lat || !lng) return null;

  let street = '';
  if (feature.address && feature.text) {
    street = `${feature.address} ${feature.text}`;
  } else if (feature.text) {
    street = feature.text;
  }

  let city = '';
  let state = '';
  let zip = '';

  for (const ctx of feature.context ?? []) {
    const type = ctx.id.split('.')[0];
    if (type === 'postcode') zip = ctx.text;
    else if (type === 'place' || type === 'locality') city = city || ctx.text;
    else if (type === 'region') {
      const sc = ctx.short_code ?? '';
      state = sc.includes('-') ? sc.split('-')[1] : sc;
    }
  }

  const featureType = feature.id.split('.')[0];
  if (featureType === 'place' && !city) city = feature.text;
  if (featureType === 'postcode' && !zip) zip = feature.text;

  const cityState = [city, state].filter(Boolean).join(', ');
  const label = [street || feature.text, cityState, zip].filter(Boolean).join(', ');

  return {
    id: feature.id,
    label: label || feature.place_name,
    street: street || feature.text,
    city,
    state,
    zip,
    latitude: lat,
    longitude: lng,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for address suggestions as the user types.
 *
 * Uses Mapbox Geocoding API (autocomplete=true, country=us, limit=8).
 * GPS proximity is used as a SOFT bias only.
 */
export async function searchAddressSuggestions(
  query: string,
  proximity?: { longitude: number; latitude: number },
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim().replace(/\s{2,}/g, ' ');
  if (!trimmed || trimmed.length < 3) return [];

  const proximityParam = proximity
    ? `${proximity.longitude},${proximity.latitude}`
    : '';

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&country=US&types=address,place&limit=8${proximityParam ? `&proximity=${proximityParam}` : ''}`;

  console.log('Mapbox request:', url.replace(MAPBOX_TOKEN, 'TOKEN'));

  try {
    const res = await fetch(url);
    const data: MapboxResponse = await res.json();
    console.log('Mapbox results:', data);

    const features = data.features ?? [];
    return features
      .map(parseMapboxFeature)
      .filter((s): s is AddressSuggestion => s !== null);
  } catch (err) {
    console.log('[autocomplete] Mapbox error:', err);
    return [];
  }
}
