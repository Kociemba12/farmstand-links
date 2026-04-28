/**
 * Single source of truth for Farmstand brand colors.
 * Import from here — never hardcode brand greens directly in screens.
 */

/** The exact gradient used on the splash/loading screen. Login must match this. */
export const SPLASH_GRADIENT = ['#2F5D3A', '#3A6B46', '#2F5D3A'] as const;

/** Subtle dark overlay applied on top of the gradient (same on splash + login). */
export const SPLASH_OVERLAY = 'rgba(0,0,0,0.08)';

/**
 * Primary brand green — matches the loading screen background exactly.
 * Use this for the Farmstand logo tint on light backgrounds (Explore page, etc.)
 */
export const LOGO_GREEN = '#2F5D3A';
