import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { useReviewsStore } from './reviews-store';

// Shared polished dot style — import this wherever the dot is rendered
export const redDotStyle = {
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: '#FF3B30',
  borderWidth: 1.5,
  borderColor: '#FFFFFF',
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 2,
} as const;

// ── In-memory store for last-viewed timestamps ────────────────────────────────
// Keyed by farmstandId. '' means the key is hydrated but never set (never viewed).
// undefined means not yet hydrated from AsyncStorage.

interface LastViewedStore {
  timestamps: Record<string, string | undefined>;
  set: (farmstandId: string, iso: string) => void;
}

const useLastViewedStore = create<LastViewedStore>((setState) => ({
  timestamps: {},
  set: (farmstandId, iso) =>
    setState((s) => ({ timestamps: { ...s.timestamps, [farmstandId]: iso } })),
}));

function storageKey(farmstandId: string): string {
  return `lastViewedReviewsAt:${farmstandId}`;
}

/**
 * Call when the owner opens Manage Reviews.
 * Immediately clears the dot everywhere (Zustand update) and persists to AsyncStorage.
 */
export async function markReviewsViewed(farmstandId: string): Promise<void> {
  const iso = new Date().toISOString();
  useLastViewedStore.getState().set(farmstandId, iso);
  try {
    await AsyncStorage.setItem(storageKey(farmstandId), iso);
  } catch {
    // non-fatal
  }
}

/**
 * Returns true if the farmstand has received reviews newer than the last time
 * the owner opened Manage Reviews. Triggers a fetch if reviews are not cached.
 * Dot clears instantly when markReviewsViewed is called anywhere in the app.
 */
export function useReviewUnread(farmstandId: string | undefined): boolean {
  const reviewsByFarm = useReviewsStore((s) => s.reviewsByFarm);
  const loadedFarms = useReviewsStore((s) => s.loadedFarms);
  const loadReviewsForFarm = useReviewsStore((s) => s.loadReviewsForFarm);
  const timestamps = useLastViewedStore((s) => s.timestamps);
  const setTimestamp = useLastViewedStore((s) => s.set);

  // Hydrate from AsyncStorage once per farmstand (skip if already in memory)
  useEffect(() => {
    if (!farmstandId) return;
    if (timestamps[farmstandId] !== undefined) return;
    AsyncStorage.getItem(storageKey(farmstandId))
      .then((val) => setTimestamp(farmstandId, val ?? ''))
      .catch(() => setTimestamp(farmstandId, ''));
  }, [farmstandId, timestamps, setTimestamp]);

  // Trigger a review fetch if not yet loaded
  useEffect(() => {
    if (!farmstandId) return;
    if (!loadedFarms.has(farmstandId)) {
      loadReviewsForFarm(farmstandId);
    }
  }, [farmstandId, loadedFarms, loadReviewsForFarm]);

  if (!farmstandId) return false;

  const lastViewed = timestamps[farmstandId];
  if (lastViewed === undefined) return false; // still hydrating

  const reviews = reviewsByFarm[farmstandId] ?? [];
  if (reviews.length === 0) return false;

  if (!lastViewed) return true; // '' = never viewed → always show dot

  return reviews.some((r) => r.createdAt > lastViewed);
}
