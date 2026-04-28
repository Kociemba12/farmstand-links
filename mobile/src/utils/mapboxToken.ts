/**
 * Mapbox access token — single source of truth.
 *
 * Set EXPO_PUBLIC_MAPBOX_TOKEN in your .env file.
 * Get your token at https://account.mapbox.com/access-tokens/
 */
import Constants from 'expo-constants';

export function getMapboxToken(): string | undefined {
  // expo-constants first (app.json extra config)
  const token = Constants.expoConfig?.extra?.MAPBOX_PUBLIC_TOKEN;
  if (token) return token;

  // env var (EXPO_PUBLIC_ prefix makes it available in the bundle)
  return process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
}
