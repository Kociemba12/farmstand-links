/**
 * Farmstand List Cache
 *
 * Stale-While-Revalidate cache for farmstand lists.
 * - Persists to AsyncStorage
 * - Returns cached data instantly on app open
 * - Background refresh replaces stale data silently
 * - Never clears the UI during a refresh
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Farmstand } from './farmer-store';

export type CacheSource = 'cache' | 'network' | 'empty';

export interface FarmstandCacheEntry {
  data: Farmstand[];
  fetchedAt: string; // ISO string
  source: CacheSource;
  queryKey: string;
}

export interface CacheReadResult {
  data: Farmstand[];
  fetchedAt: string | null;
  source: CacheSource;
  isStale: boolean;
  cacheAgeMs: number;
}

// Stale window: 3 minutes. After this, background refresh is triggered.
// Cached data is still shown even if stale.
const STALE_WINDOW_MS = 3 * 60 * 1000;

// Cache key prefix
const CACHE_PREFIX = 'farmstand_list_cache_v1:';

// In-flight guard per query key — prevents concurrent fetches
const _inFlight = new Map<string, boolean>();

export function isFetchInFlight(queryKey: string): boolean {
  return _inFlight.get(queryKey) === true;
}

export function setFetchInFlight(queryKey: string, inFlight: boolean): void {
  if (inFlight) {
    _inFlight.set(queryKey, true);
  } else {
    _inFlight.delete(queryKey);
  }
}

export async function readCache(queryKey: string): Promise<CacheReadResult> {
  const storageKey = CACHE_PREFIX + queryKey;
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) {
      return { data: [], fetchedAt: null, source: 'empty', isStale: true, cacheAgeMs: Infinity };
    }
    const entry: FarmstandCacheEntry = JSON.parse(raw);
    const fetchedAt = new Date(entry.fetchedAt).getTime();
    const now = Date.now();
    const cacheAgeMs = now - fetchedAt;
    const isStale = cacheAgeMs > STALE_WINDOW_MS;
    return {
      data: entry.data,
      fetchedAt: entry.fetchedAt,
      source: 'cache',
      isStale,
      cacheAgeMs,
    };
  } catch (e) {
    console.log('[FarmstandCache] readCache error for', queryKey, ':', e);
    return { data: [], fetchedAt: null, source: 'empty', isStale: true, cacheAgeMs: Infinity };
  }
}

export async function writeCache(queryKey: string, data: Farmstand[]): Promise<void> {
  const storageKey = CACHE_PREFIX + queryKey;
  try {
    const entry: FarmstandCacheEntry = {
      data,
      fetchedAt: new Date().toISOString(),
      source: 'network',
      queryKey,
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(entry));
  } catch (e) {
    console.log('[FarmstandCache] writeCache error for', queryKey, ':', e);
  }
}

export async function clearCache(queryKey: string): Promise<void> {
  const storageKey = CACHE_PREFIX + queryKey;
  try {
    await AsyncStorage.removeItem(storageKey);
  } catch (e) {
    console.log('[FarmstandCache] clearCache error for', queryKey, ':', e);
  }
}

// Cache keys used by screens
export const CACHE_KEYS = {
  EXPLORE: 'explore_all',
  MAP: 'map_all',
  FAVORITES: 'favorites_all',
  PROFILE: 'profile_owned',
} as const;

// Format cache age for debug display
export function formatCacheAge(cacheAgeMs: number): string {
  if (!isFinite(cacheAgeMs)) return 'none';
  if (cacheAgeMs < 60_000) return `${Math.round(cacheAgeMs / 1000)}s ago`;
  if (cacheAgeMs < 3_600_000) return `${Math.round(cacheAgeMs / 60_000)}m ago`;
  return `${Math.round(cacheAgeMs / 3_600_000)}h ago`;
}
