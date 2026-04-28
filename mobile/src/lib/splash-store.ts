/**
 * Splash Store
 *
 * Provides a lightweight cross-component signal so the Explore screen
 * can tell _layout.tsx when above-the-fold content is visually ready.
 * _layout.tsx uses this to hold the splash overlay until Explore looks polished.
 */

import { create } from 'zustand';

interface SplashState {
  exploreReady: boolean;
  setExploreReady: () => void;
  /** True once the splash overlay has fully faded out and been removed. */
  splashDismissed: boolean;
  setSplashDismissed: () => void;
}

export const useSplashStore = create<SplashState>((set, get) => ({
  exploreReady: false,
  setExploreReady: () => {
    if (get().exploreReady) return; // idempotent
    console.log('[Splash] Explore ready signal received');
    set({ exploreReady: true });
  },
  splashDismissed: false,
  setSplashDismissed: () => {
    if (get().splashDismissed) return; // idempotent
    console.log('[Splash] Splash fully dismissed — gates unblocked');
    set({ splashDismissed: true });
  },
}));
