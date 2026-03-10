/**
 * Owner Analytics - Supabase Queries
 *
 * Fetches REAL analytics data from Supabase analytics_events table.
 * ALWAYS filters by farmstand_id - never aggregates all events.
 * Returns 0 when no events exist for a farmstand.
 */

import { supabase, isSupabaseConfigured } from './supabase';

// Event types that relate to farmstands (from analytics-events.ts)
type FarmstandEventType =
  | 'farmstand_view'
  | 'farmstand_save'
  | 'save_toggle'
  | 'share_tap'
  | 'directions_tap'
  | 'call_tap'
  | 'website_tap'
  | 'message_tap'
  | 'message_farmstand'
  | 'product_click'
  | 'review_create';

interface AnalyticsEvent {
  id: string;
  event_name: string;
  created_at: string;
  user_id: string | null;
  device_id: string | null;
  farmstand_id: string | null;
  screen: string | null;
  properties: Record<string, unknown> | null;
}

export interface FarmstandStats7Days {
  views: number;
  saves: number;
  directions: number;
  calls: number;
  website: number;
  shares: number;
}

export interface FarmstandStats30Days {
  newReviews: number;
  avgRating: number;
  directions: number;
  calls: number;
  website: number;
  shares: number;
}

export interface DailyTrend {
  date: string;
  views: number;
  saves: number;
  directions: number;
  calls: number;
  website: number;
  shares: number;
  reviews: number;
}

export interface ReviewStats {
  totalReviews: number;
  avgRating: number;
  ratingDistribution: { [rating: number]: number };
  newReviews30Days: number;
}

// Helper to get ISO date string for N days ago
const getDateNDaysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

/**
 * Fetch analytics events for specific farmstand IDs within a date range.
 * CRITICAL: Always filters by farmstand_id - never returns events with NULL farmstand_id.
 */
export async function fetchFarmstandEvents(
  farmstandIds: string[],
  daysBack: number = 30
): Promise<AnalyticsEvent[]> {
  if (!isSupabaseConfigured()) {
    console.log('[OwnerAnalytics] Supabase not configured');
    return [];
  }

  if (farmstandIds.length === 0) {
    console.log('[OwnerAnalytics] No farmstand IDs provided');
    return [];
  }

  const cutoffDate = getDateNDaysAgo(daysBack);

  try {
    // Fetch events for these farmstands only
    const { data, error } = await supabase
      .from<AnalyticsEvent>('analytics_events')
      .select('*')
      .in('farmstand_id', farmstandIds) // CRITICAL: Only events for these farmstands
      .order('created_at', { ascending: false })
      .limit(10000)
      .execute();

    if (error) {
      console.log('[OwnerAnalytics] Error fetching events:', error.message);
      return [];
    }

    // Filter by date and ensure farmstand_id is valid
    // Double-check: filter out any events with NULL farmstand_id (should not happen but safety check)
    const filteredEvents = (data || []).filter(
      (e) =>
        e.farmstand_id !== null &&
        farmstandIds.includes(e.farmstand_id) &&
        e.created_at >= cutoffDate
    );

    console.log(
      `[OwnerAnalytics] Fetched ${filteredEvents.length} events for farmstands: ${farmstandIds.join(', ')}`
    );

    return filteredEvents;
  } catch (e) {
    console.log('[OwnerAnalytics] Network error:', e);
    return [];
  }
}

/**
 * Calculate 7-day stats for a single farmstand.
 * Returns zeros if no events found - NEVER falls back to aggregate data.
 */
export function calculateStats7Days(
  events: AnalyticsEvent[],
  farmstandId: string
): FarmstandStats7Days {
  // Default to zeros
  const stats: FarmstandStats7Days = {
    views: 0,
    saves: 0,
    directions: 0,
    calls: 0,
    website: 0,
    shares: 0,
  };

  const cutoff = getDateNDaysAgo(7);

  // Filter events for THIS farmstand only, within 7 days
  const relevantEvents = events.filter(
    (e) => e.farmstand_id === farmstandId && e.created_at >= cutoff
  );

  // Count by event type
  relevantEvents.forEach((e) => {
    switch (e.event_name) {
      case 'farmstand_view':
        stats.views++;
        break;
      case 'farmstand_save':
      case 'save_toggle':
        // For save_toggle, check if it was a save or unsave
        if (e.event_name === 'save_toggle') {
          const saved = e.properties?.saved;
          if (saved === true) stats.saves++;
        } else {
          stats.saves++;
        }
        break;
      case 'directions_tap':
        stats.directions++;
        break;
      case 'call_tap':
        stats.calls++;
        break;
      case 'website_tap':
        stats.website++;
        break;
      case 'share_tap':
        stats.shares++;
        break;
    }
  });

  return stats;
}

/**
 * Calculate 30-day stats for a single farmstand.
 * Returns zeros if no events found - NEVER falls back to aggregate data.
 */
export function calculateStats30Days(
  events: AnalyticsEvent[],
  farmstandId: string
): FarmstandStats30Days {
  const stats: FarmstandStats30Days = {
    newReviews: 0,
    avgRating: 0,
    directions: 0,
    calls: 0,
    website: 0,
    shares: 0,
  };

  const cutoff = getDateNDaysAgo(30);

  // Filter events for THIS farmstand only, within 30 days
  const relevantEvents = events.filter(
    (e) => e.farmstand_id === farmstandId && e.created_at >= cutoff
  );

  let ratingSum = 0;
  let ratingCount = 0;

  relevantEvents.forEach((e) => {
    switch (e.event_name) {
      case 'directions_tap':
        stats.directions++;
        break;
      case 'call_tap':
        stats.calls++;
        break;
      case 'website_tap':
        stats.website++;
        break;
      case 'share_tap':
        stats.shares++;
        break;
      case 'review_create':
        stats.newReviews++;
        const rating = e.properties?.rating;
        if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
          ratingSum += rating;
          ratingCount++;
        }
        break;
    }
  });

  stats.avgRating = ratingCount > 0 ? ratingSum / ratingCount : 0;

  return stats;
}

/**
 * Calculate daily trends for the last N days for a single farmstand.
 * Returns array with zeros for days with no activity.
 */
export function calculateDailyTrends(
  events: AnalyticsEvent[],
  farmstandId: string,
  daysBack: number = 30
): DailyTrend[] {
  // Filter events for THIS farmstand only
  const farmstandEvents = events.filter((e) => e.farmstand_id === farmstandId);

  // Create a map of date -> counts
  const dateMap: { [date: string]: DailyTrend } = {};

  // Initialize all days with zeros
  for (let i = 0; i < daysBack; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    dateMap[dateStr] = {
      date: dateStr,
      views: 0,
      saves: 0,
      directions: 0,
      calls: 0,
      website: 0,
      shares: 0,
      reviews: 0,
    };
  }

  // Count events by date
  farmstandEvents.forEach((e) => {
    const dateStr = e.created_at.split('T')[0];
    if (!dateMap[dateStr]) return; // Outside our range

    switch (e.event_name) {
      case 'farmstand_view':
        dateMap[dateStr].views++;
        break;
      case 'farmstand_save':
      case 'save_toggle':
        if (e.event_name === 'save_toggle') {
          if (e.properties?.saved === true) dateMap[dateStr].saves++;
        } else {
          dateMap[dateStr].saves++;
        }
        break;
      case 'directions_tap':
        dateMap[dateStr].directions++;
        break;
      case 'call_tap':
        dateMap[dateStr].calls++;
        break;
      case 'website_tap':
        dateMap[dateStr].website++;
        break;
      case 'share_tap':
        dateMap[dateStr].shares++;
        break;
      case 'review_create':
        dateMap[dateStr].reviews++;
        break;
    }
  });

  // Convert to array sorted by date (oldest first)
  return Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Calculate review statistics for a single farmstand.
 * Returns zeros if no reviews found.
 */
export function calculateReviewStats(
  events: AnalyticsEvent[],
  farmstandId: string
): ReviewStats {
  const stats: ReviewStats = {
    totalReviews: 0,
    avgRating: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    newReviews30Days: 0,
  };

  const cutoff30Days = getDateNDaysAgo(30);

  // Filter review events for THIS farmstand only
  const reviewEvents = events.filter(
    (e) => e.farmstand_id === farmstandId && e.event_name === 'review_create'
  );

  let ratingSum = 0;

  reviewEvents.forEach((e) => {
    stats.totalReviews++;

    const rating = e.properties?.rating;
    if (typeof rating === 'number' && rating >= 1 && rating <= 5) {
      const roundedRating = Math.round(rating);
      stats.ratingDistribution[roundedRating] =
        (stats.ratingDistribution[roundedRating] || 0) + 1;
      ratingSum += rating;
    }

    if (e.created_at >= cutoff30Days) {
      stats.newReviews30Days++;
    }
  });

  stats.avgRating = stats.totalReviews > 0 ? ratingSum / stats.totalReviews : 0;

  return stats;
}

/**
 * Hook-friendly wrapper to fetch and calculate all owner analytics.
 * CRITICAL: Only returns data for the specified farmstand - no fallbacks.
 */
export async function fetchOwnerAnalytics(farmstandId: string): Promise<{
  stats7Days: FarmstandStats7Days;
  stats30Days: FarmstandStats30Days;
  dailyTrends: DailyTrend[];
  reviewStats: ReviewStats;
  hasData: boolean;
}> {
  // Default empty response
  const emptyResponse = {
    stats7Days: { views: 0, saves: 0, directions: 0, calls: 0, website: 0, shares: 0 },
    stats30Days: { newReviews: 0, avgRating: 0, directions: 0, calls: 0, website: 0, shares: 0 },
    dailyTrends: calculateDailyTrends([], farmstandId, 30),
    reviewStats: {
      totalReviews: 0,
      avgRating: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      newReviews30Days: 0,
    },
    hasData: false,
  };

  if (!farmstandId) {
    return emptyResponse;
  }

  // Fetch events for this farmstand only
  const events = await fetchFarmstandEvents([farmstandId], 60); // Fetch 60 days for review history

  if (events.length === 0) {
    console.log(`[OwnerAnalytics] No events found for farmstand: ${farmstandId}`);
    return emptyResponse;
  }

  return {
    stats7Days: calculateStats7Days(events, farmstandId),
    stats30Days: calculateStats30Days(events, farmstandId),
    dailyTrends: calculateDailyTrends(events, farmstandId, 30),
    reviewStats: calculateReviewStats(events, farmstandId),
    hasData: true,
  };
}
