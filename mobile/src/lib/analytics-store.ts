import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Event Types
export type EventType =
  | 'farmstand_viewed'
  | 'directions_clicked'
  | 'call_clicked'
  | 'website_clicked'
  | 'saved'
  | 'unsaved'
  | 'shared'
  | 'review_created'
  | 'review_updated'
  | 'review_deleted'
  | 'listing_claim_requested'
  | 'listing_claim_approved'
  | 'listing_edited'
  | 'photo_added'
  | 'hours_updated'
  | 'products_updated'
  | 'report_created';

// Event record
export interface AnalyticsEvent {
  id: string;
  event_type: EventType;
  timestamp: string;
  user_id: string | null;
  farmstand_id: string | null;
  meta: Record<string, unknown> | null;
}

// Daily stats for a farmstand
export interface FarmstandStatsDaily {
  farmstand_id: string;
  date: string; // YYYY-MM-DD
  views: number;
  unique_viewers: string[]; // user_ids
  saves: number;
  unsaves: number;
  directions_clicks: number;
  calls: number;
  website_clicks: number;
  shares: number;
  new_reviews: number;
  avg_rating: number;
  reports: number;
}

// Total stats for a farmstand
export interface FarmstandStatsTotal {
  farmstand_id: string;
  views_total: number;
  unique_viewers_total: number;
  saves_total: number;
  directions_total: number;
  calls_total: number;
  website_total: number;
  shares_total: number;
  reviews_total: number;
  avg_rating: number;
  rating_distribution: { [rating: number]: number };
  last_activity_at: string | null;
  last_review_at: string | null;
}

// Admin daily stats
export interface AdminStatsDaily {
  date: string; // YYYY-MM-DD
  new_farmstands_added: number;
  claims_requested: number;
  claims_approved: number;
  claims_denied: number;
  new_reviews: number;
  reports_created: number;
  active_users: string[]; // user_ids
  new_users: number;
}

// Listing health check
export interface ListingHealth {
  has_hours: boolean;
  has_photos: boolean;
  has_products: boolean;
  has_location: boolean;
  has_contact: boolean;
}

// Recommended action
export interface RecommendedAction {
  id: string;
  title: string;
  description: string;
  actionRoute?: string;
  priority: 'high' | 'medium' | 'low';
}

interface AnalyticsState {
  events: AnalyticsEvent[];
  farmstandDailyStats: { [key: string]: FarmstandStatsDaily }; // key: farmstand_id:date
  farmstandTotalStats: { [farmstand_id: string]: FarmstandStatsTotal };
  adminDailyStats: { [date: string]: AdminStatsDaily };
  isLoading: boolean;

  // Actions
  loadAnalytics: () => Promise<void>;
  seedAnalyticsForFarmstand: (farmstand_id: string) => Promise<void>;
  logEvent: (
    event_type: EventType,
    user_id: string | null,
    farmstand_id: string | null,
    meta?: Record<string, unknown>
  ) => Promise<void>;

  // Farmstand Owner Analytics
  getFarmstandStats7Days: (farmstand_id: string) => {
    views: number;
    saves: number;
    directions: number;
    calls: number;
    website: number;
    shares: number;
  };
  getFarmstandStats30Days: (farmstand_id: string) => {
    newReviews: number;
    avgRating: number;
    directions: number;
    calls: number;
    website: number;
    shares: number;
  };
  getFarmstandTrends30Days: (farmstand_id: string) => FarmstandStatsDaily[];
  getFarmstandTotalStats: (farmstand_id: string) => FarmstandStatsTotal | null;
  getListingHealth: (farmstand_id: string, farmstand: any) => ListingHealth;
  getRecommendedActions: (
    farmstand_id: string,
    stats7Days: ReturnType<AnalyticsState['getFarmstandStats7Days']>,
    health: ListingHealth
  ) => RecommendedAction[];

  // Admin Analytics
  getAdminStats7Days: () => {
    newListings: number;
    claimsRequested: number;
    claimsApproved: number;
    newReviews: number;
    reports: number;
  };
  getActiveUsers30Days: () => number;
  getTopFarmstands: (metric: 'views' | 'saves' | 'directions', limit?: number) => Array<{
    farmstand_id: string;
    value: number;
  }>;
  getDataQualityMetrics: (farmstands: any[]) => {
    percentClaimed: number;
    percentWithPhotos: number;
    percentWithHours: number;
    percentWithLocation: number;
    percentWithProducts: number;
  };
  getTotalEvents7Days: () => number;
  getTopEventTypes7Days: () => Array<{ type: EventType; count: number }>;
}

// Helper to get date string YYYY-MM-DD
const getDateString = (date: Date = new Date()): string => {
  return date.toISOString().split('T')[0];
};

// Helper to get date N days ago
const getDaysAgo = (days: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

// Helper to check if date is within range
const isWithinDays = (dateString: string, days: number): boolean => {
  const date = new Date(dateString);
  const cutoff = getDaysAgo(days);
  return date >= cutoff;
};

// Generate realistic demo analytics data for a farmstand
const generateDemoAnalyticsData = (farmstandId: string) => {
  const farmstandDailyStats: { [key: string]: FarmstandStatsDaily } = {};
  const events: AnalyticsEvent[] = [];
  const adminDailyStats: { [date: string]: AdminStatsDaily } = {};

  // Generate 60 days of data with realistic patterns
  for (let i = 0; i < 60; i++) {
    const date = getDaysAgo(i);
    const dateString = getDateString(date);
    const dayOfWeek = date.getDay(); // 0 = Sunday

    // Weekend boost factor (Sat/Sun have more traffic)
    const weekendBoost = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.5 : 1;
    // Recent trend (more views in recent days)
    const recencyBoost = i < 7 ? 1.3 : i < 14 ? 1.15 : 1;
    // Random variation
    const randomFactor = 0.7 + Math.random() * 0.6;

    const baseViews = Math.floor(15 * weekendBoost * recencyBoost * randomFactor);
    const views = Math.max(5, baseViews);
    const saves = Math.floor(views * (0.08 + Math.random() * 0.07)); // 8-15% save rate
    const directions = Math.floor(views * (0.12 + Math.random() * 0.1)); // 12-22% direction rate
    const calls = Math.floor(directions * (0.2 + Math.random() * 0.15)); // 20-35% of directions
    const website = Math.floor(views * (0.03 + Math.random() * 0.04)); // 3-7% website clicks
    const shares = Math.floor(views * (0.02 + Math.random() * 0.03)); // 2-5% share rate
    const newReviews = Math.random() > 0.92 ? 1 : 0; // ~8% chance of review per day

    const dailyKey = `${farmstandId}:${dateString}`;
    farmstandDailyStats[dailyKey] = {
      farmstand_id: farmstandId,
      date: dateString,
      views,
      unique_viewers: Array.from({ length: Math.floor(views * 0.7) }, (_, j) => `user-${i}-${j}`),
      saves,
      unsaves: Math.floor(saves * 0.1),
      directions_clicks: directions,
      calls,
      website_clicks: website,
      shares,
      new_reviews: newReviews,
      avg_rating: 4.2 + Math.random() * 0.6,
      reports: 0,
    };

    // Generate some events for the day
    for (let j = 0; j < views; j++) {
      const timestamp = new Date(date.getTime() + Math.random() * 24 * 60 * 60 * 1000);
      events.push({
        id: `evt-demo-${i}-${j}`,
        event_type: 'farmstand_viewed',
        timestamp: timestamp.toISOString(),
        user_id: Math.random() > 0.3 ? `user-${Math.floor(Math.random() * 100)}` : null,
        farmstand_id: farmstandId,
        meta: { source: ['map', 'search', 'favorite', 'share'][Math.floor(Math.random() * 4)] },
      });
    }

    // Admin stats
    adminDailyStats[dateString] = {
      date: dateString,
      new_farmstands_added: Math.random() > 0.9 ? 1 : 0,
      claims_requested: Math.random() > 0.85 ? 1 : 0,
      claims_approved: Math.random() > 0.9 ? 1 : 0,
      claims_denied: 0,
      new_reviews: newReviews,
      reports_created: 0,
      active_users: Array.from({ length: Math.floor(views * 0.5) }, (_, j) => `user-${i}-${j}`),
      new_users: Math.random() > 0.8 ? Math.floor(Math.random() * 3) + 1 : 0,
    };
  }

  // Calculate total stats
  const totalViews = Object.values(farmstandDailyStats).reduce((sum, d) => sum + d.views, 0);
  const totalSaves = Object.values(farmstandDailyStats).reduce((sum, d) => sum + d.saves, 0);
  const totalDirections = Object.values(farmstandDailyStats).reduce((sum, d) => sum + d.directions_clicks, 0);
  const totalCalls = Object.values(farmstandDailyStats).reduce((sum, d) => sum + d.calls, 0);
  const totalWebsite = Object.values(farmstandDailyStats).reduce((sum, d) => sum + d.website_clicks, 0);
  const totalShares = Object.values(farmstandDailyStats).reduce((sum, d) => sum + d.shares, 0);
  const totalReviews = Object.values(farmstandDailyStats).reduce((sum, d) => sum + d.new_reviews, 0);

  // Rating distribution (skewed positive)
  const ratingDistribution = {
    5: Math.floor(totalReviews * 0.45),
    4: Math.floor(totalReviews * 0.30),
    3: Math.floor(totalReviews * 0.15),
    2: Math.floor(totalReviews * 0.07),
    1: Math.floor(totalReviews * 0.03),
  };

  const weightedSum = Object.entries(ratingDistribution).reduce(
    (sum, [r, count]) => sum + parseInt(r) * count,
    0
  );
  const avgRating = totalReviews > 0 ? weightedSum / totalReviews : 4.3;

  const farmstandTotalStats: { [farmstand_id: string]: FarmstandStatsTotal } = {
    [farmstandId]: {
      farmstand_id: farmstandId,
      views_total: totalViews,
      unique_viewers_total: Math.floor(totalViews * 0.6),
      saves_total: totalSaves,
      directions_total: totalDirections,
      calls_total: totalCalls,
      website_total: totalWebsite,
      shares_total: totalShares,
      reviews_total: totalReviews,
      avg_rating: avgRating,
      rating_distribution: ratingDistribution,
      last_activity_at: new Date().toISOString(),
      last_review_at: getDaysAgo(Math.floor(Math.random() * 7)).toISOString(),
    },
  };

  return { events, farmstandDailyStats, farmstandTotalStats, adminDailyStats };
};

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  events: [],
  farmstandDailyStats: {},
  farmstandTotalStats: {},
  adminDailyStats: {},
  isLoading: false,

  loadAnalytics: async () => {
    set({ isLoading: true });
    try {
      const eventsData = await AsyncStorage.getItem('analytics_events');
      const dailyStatsData = await AsyncStorage.getItem('analytics_farmstand_daily');
      const totalStatsData = await AsyncStorage.getItem('analytics_farmstand_total');
      const adminStatsData = await AsyncStorage.getItem('analytics_admin_daily');

      // Check if we have any data
      const hasData = eventsData || dailyStatsData || totalStatsData;

      if (!hasData) {
        // Seed demo data for the default farmstand
        // First try to get farmstand ID from admin store
        const adminFarmstandsData = await AsyncStorage.getItem('admin_farmstands');
        let demoFarmstandId = 'farm-demo-1';

        if (adminFarmstandsData) {
          const farmstands = JSON.parse(adminFarmstandsData);
          if (farmstands.length > 0) {
            // Use the first farmstand that's claimed or the first one
            const claimedFarm = farmstands.find((f: { claimStatus: string }) => f.claimStatus === 'claimed');
            demoFarmstandId = claimedFarm?.id || farmstands[0].id;
          }
        }

        const demoData = generateDemoAnalyticsData(demoFarmstandId);

        await AsyncStorage.setItem('analytics_events', JSON.stringify(demoData.events));
        await AsyncStorage.setItem('analytics_farmstand_daily', JSON.stringify(demoData.farmstandDailyStats));
        await AsyncStorage.setItem('analytics_farmstand_total', JSON.stringify(demoData.farmstandTotalStats));
        await AsyncStorage.setItem('analytics_admin_daily', JSON.stringify(demoData.adminDailyStats));

        set({
          events: demoData.events,
          farmstandDailyStats: demoData.farmstandDailyStats,
          farmstandTotalStats: demoData.farmstandTotalStats,
          adminDailyStats: demoData.adminDailyStats,
          isLoading: false,
        });
        return;
      }

      set({
        events: eventsData ? JSON.parse(eventsData) : [],
        farmstandDailyStats: dailyStatsData ? JSON.parse(dailyStatsData) : {},
        farmstandTotalStats: totalStatsData ? JSON.parse(totalStatsData) : {},
        adminDailyStats: adminStatsData ? JSON.parse(adminStatsData) : {},
        isLoading: false,
      });
    } catch (error) {
      console.error('Error loading analytics:', error);
      set({ isLoading: false });
    }
  },

  seedAnalyticsForFarmstand: async (farmstand_id: string) => {
    const state = get();
    const demoData = generateDemoAnalyticsData(farmstand_id);

    // Merge with existing data
    const mergedDailyStats = { ...state.farmstandDailyStats, ...demoData.farmstandDailyStats };
    const mergedTotalStats = { ...state.farmstandTotalStats, ...demoData.farmstandTotalStats };
    const mergedEvents = [...state.events, ...demoData.events];
    const mergedAdminStats = { ...state.adminDailyStats, ...demoData.adminDailyStats };

    await AsyncStorage.setItem('analytics_events', JSON.stringify(mergedEvents));
    await AsyncStorage.setItem('analytics_farmstand_daily', JSON.stringify(mergedDailyStats));
    await AsyncStorage.setItem('analytics_farmstand_total', JSON.stringify(mergedTotalStats));
    await AsyncStorage.setItem('analytics_admin_daily', JSON.stringify(mergedAdminStats));

    set({
      events: mergedEvents,
      farmstandDailyStats: mergedDailyStats,
      farmstandTotalStats: mergedTotalStats,
      adminDailyStats: mergedAdminStats,
    });
  },

  logEvent: async (event_type, user_id, farmstand_id, meta) => {
    const timestamp = new Date().toISOString();
    const dateString = getDateString();
    const newEvent: AnalyticsEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      event_type,
      timestamp,
      user_id,
      farmstand_id,
      meta: meta || null,
    };

    const state = get();
    const events = [...state.events, newEvent];

    // Update farmstand daily stats if farmstand_id present
    let farmstandDailyStats = { ...state.farmstandDailyStats };
    let farmstandTotalStats = { ...state.farmstandTotalStats };

    if (farmstand_id) {
      const dailyKey = `${farmstand_id}:${dateString}`;
      const existingDaily = farmstandDailyStats[dailyKey] || {
        farmstand_id,
        date: dateString,
        views: 0,
        unique_viewers: [],
        saves: 0,
        unsaves: 0,
        directions_clicks: 0,
        calls: 0,
        website_clicks: 0,
        shares: 0,
        new_reviews: 0,
        avg_rating: 0,
        reports: 0,
      };

      const existingTotal = farmstandTotalStats[farmstand_id] || {
        farmstand_id,
        views_total: 0,
        unique_viewers_total: 0,
        saves_total: 0,
        directions_total: 0,
        calls_total: 0,
        website_total: 0,
        shares_total: 0,
        reviews_total: 0,
        avg_rating: 0,
        rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        last_activity_at: null,
        last_review_at: null,
      };

      // Update based on event type
      switch (event_type) {
        case 'farmstand_viewed':
          existingDaily.views++;
          existingTotal.views_total++;
          if (user_id && !existingDaily.unique_viewers.includes(user_id)) {
            existingDaily.unique_viewers.push(user_id);
            existingTotal.unique_viewers_total++;
          }
          break;
        case 'saved':
          existingDaily.saves++;
          existingTotal.saves_total++;
          break;
        case 'unsaved':
          existingDaily.unsaves++;
          break;
        case 'directions_clicked':
          existingDaily.directions_clicks++;
          existingTotal.directions_total++;
          break;
        case 'call_clicked':
          existingDaily.calls++;
          existingTotal.calls_total++;
          break;
        case 'website_clicked':
          existingDaily.website_clicks++;
          existingTotal.website_total++;
          break;
        case 'shared':
          existingDaily.shares++;
          existingTotal.shares_total++;
          break;
        case 'review_created':
          existingDaily.new_reviews++;
          existingTotal.reviews_total++;
          existingTotal.last_review_at = timestamp;
          if (meta?.rating && typeof meta.rating === 'number') {
            const rating = Math.min(5, Math.max(1, Math.round(meta.rating)));
            existingTotal.rating_distribution[rating] =
              (existingTotal.rating_distribution[rating] || 0) + 1;
            // Recalculate avg rating
            const dist = existingTotal.rating_distribution;
            const totalRatings = Object.values(dist).reduce((a, b) => a + b, 0);
            const weightedSum = Object.entries(dist).reduce(
              (sum, [r, count]) => sum + parseInt(r) * count,
              0
            );
            existingTotal.avg_rating = totalRatings > 0 ? weightedSum / totalRatings : 0;
            existingDaily.avg_rating = existingTotal.avg_rating;
          }
          break;
        case 'report_created':
          existingDaily.reports++;
          break;
      }

      existingTotal.last_activity_at = timestamp;
      farmstandDailyStats[dailyKey] = existingDaily;
      farmstandTotalStats[farmstand_id] = existingTotal;
    }

    // Update admin daily stats
    let adminDailyStats = { ...state.adminDailyStats };
    const existingAdminDaily = adminDailyStats[dateString] || {
      date: dateString,
      new_farmstands_added: 0,
      claims_requested: 0,
      claims_approved: 0,
      claims_denied: 0,
      new_reviews: 0,
      reports_created: 0,
      active_users: [],
      new_users: 0,
    };

    switch (event_type) {
      case 'listing_claim_requested':
        existingAdminDaily.claims_requested++;
        break;
      case 'listing_claim_approved':
        existingAdminDaily.claims_approved++;
        break;
      case 'review_created':
        existingAdminDaily.new_reviews++;
        break;
      case 'report_created':
        existingAdminDaily.reports_created++;
        break;
    }

    if (user_id && !existingAdminDaily.active_users.includes(user_id)) {
      existingAdminDaily.active_users.push(user_id);
    }

    adminDailyStats[dateString] = existingAdminDaily;

    // Save to storage
    await AsyncStorage.setItem('analytics_events', JSON.stringify(events));
    await AsyncStorage.setItem('analytics_farmstand_daily', JSON.stringify(farmstandDailyStats));
    await AsyncStorage.setItem('analytics_farmstand_total', JSON.stringify(farmstandTotalStats));
    await AsyncStorage.setItem('analytics_admin_daily', JSON.stringify(adminDailyStats));

    set({ events, farmstandDailyStats, farmstandTotalStats, adminDailyStats });
  },

  getFarmstandStats7Days: (farmstand_id) => {
    const state = get();
    const result = { views: 0, saves: 0, directions: 0, calls: 0, website: 0, shares: 0 };

    for (let i = 0; i < 7; i++) {
      const date = getDaysAgo(i);
      const key = `${farmstand_id}:${getDateString(date)}`;
      const daily = state.farmstandDailyStats[key];
      if (daily) {
        result.views += daily.views;
        result.saves += daily.saves;
        result.directions += daily.directions_clicks;
        result.calls += daily.calls;
        result.website += daily.website_clicks;
        result.shares += daily.shares;
      }
    }

    return result;
  },

  getFarmstandStats30Days: (farmstand_id) => {
    const state = get();
    const result = {
      newReviews: 0,
      avgRating: 0,
      directions: 0,
      calls: 0,
      website: 0,
      shares: 0,
    };
    let totalRatings = 0;
    let ratingSum = 0;

    for (let i = 0; i < 30; i++) {
      const date = getDaysAgo(i);
      const key = `${farmstand_id}:${getDateString(date)}`;
      const daily = state.farmstandDailyStats[key];
      if (daily) {
        result.newReviews += daily.new_reviews;
        result.directions += daily.directions_clicks;
        result.calls += daily.calls;
        result.website += daily.website_clicks;
        result.shares += daily.shares;
        if (daily.avg_rating > 0) {
          ratingSum += daily.avg_rating;
          totalRatings++;
        }
      }
    }

    result.avgRating = totalRatings > 0 ? ratingSum / totalRatings : 0;
    return result;
  },

  getFarmstandTrends30Days: (farmstand_id) => {
    const state = get();
    const trends: FarmstandStatsDaily[] = [];

    for (let i = 29; i >= 0; i--) {
      const date = getDaysAgo(i);
      const dateString = getDateString(date);
      const key = `${farmstand_id}:${dateString}`;
      const daily = state.farmstandDailyStats[key] || {
        farmstand_id,
        date: dateString,
        views: 0,
        unique_viewers: [],
        saves: 0,
        unsaves: 0,
        directions_clicks: 0,
        calls: 0,
        website_clicks: 0,
        shares: 0,
        new_reviews: 0,
        avg_rating: 0,
        reports: 0,
      };
      trends.push(daily);
    }

    return trends;
  },

  getFarmstandTotalStats: (farmstand_id) => {
    return get().farmstandTotalStats[farmstand_id] || null;
  },

  getListingHealth: (farmstand_id, farmstand) => {
    if (!farmstand) {
      return {
        has_hours: false,
        has_photos: false,
        has_products: false,
        has_location: false,
        has_contact: false,
      };
    }

    return {
      has_hours: !!farmstand.hours,
      has_photos: farmstand.photos && farmstand.photos.length > 0,
      has_products: farmstand.offerings && farmstand.offerings.length > 0,
      has_location: !!(farmstand.latitude && farmstand.longitude),
      has_contact: !!(farmstand.phone || farmstand.email || farmstand.website),
    };
  },

  getRecommendedActions: (farmstand_id, stats7Days, health) => {
    const actions: RecommendedAction[] = [];

    // Health-based recommendations
    if (!health.has_photos) {
      actions.push({
        id: 'add-photos',
        title: 'Add Photos',
        description: 'Listings with photos get 3x more views',
        actionRoute: `/owner/edit?id=${farmstand_id}`,
        priority: 'high',
      });
    }

    if (!health.has_hours) {
      actions.push({
        id: 'set-hours',
        title: 'Set Your Hours',
        description: 'Help customers know when to visit',
        actionRoute: `/owner/hours?id=${farmstand_id}`,
        priority: 'high',
      });
    }

    if (!health.has_products) {
      actions.push({
        id: 'add-products',
        title: 'Add Products',
        description: 'Show customers what you offer',
        actionRoute: `/owner/products?id=${farmstand_id}`,
        priority: 'medium',
      });
    }

    if (!health.has_location) {
      actions.push({
        id: 'pin-location',
        title: 'Pin Your Location',
        description: 'Make it easy for customers to find you',
        actionRoute: `/owner/location?id=${farmstand_id}`,
        priority: 'high',
      });
    }

    // Stats-based recommendations
    if (stats7Days.views > 10 && stats7Days.directions < 2) {
      actions.push({
        id: 'improve-directions',
        title: 'Improve Directions',
        description: 'High views but low direction taps - add clearer address info',
        actionRoute: `/owner/location?id=${farmstand_id}`,
        priority: 'medium',
      });
    }

    if (stats7Days.views > 10 && stats7Days.saves < 2) {
      actions.push({
        id: 'improve-appeal',
        title: 'Make Listing More Appealing',
        description: 'High views but low saves - add more photos or update description',
        actionRoute: `/owner/edit?id=${farmstand_id}`,
        priority: 'medium',
      });
    }

    const totalStats = get().farmstandTotalStats[farmstand_id];
    if (!totalStats || totalStats.reviews_total === 0) {
      actions.push({
        id: 'get-reviews',
        title: 'Get Your First Review',
        description: 'Ask satisfied customers to leave a review',
        priority: 'low',
      });
    }

    return actions.slice(0, 5); // Limit to 5 actions
  },

  getAdminStats7Days: () => {
    const state = get();
    const result = {
      newListings: 0,
      claimsRequested: 0,
      claimsApproved: 0,
      newReviews: 0,
      reports: 0,
    };

    for (let i = 0; i < 7; i++) {
      const date = getDateString(getDaysAgo(i));
      const daily = state.adminDailyStats[date];
      if (daily) {
        result.newListings += daily.new_farmstands_added;
        result.claimsRequested += daily.claims_requested;
        result.claimsApproved += daily.claims_approved;
        result.newReviews += daily.new_reviews;
        result.reports += daily.reports_created;
      }
    }

    return result;
  },

  getActiveUsers30Days: () => {
    const state = get();
    const uniqueUsers = new Set<string>();

    for (let i = 0; i < 30; i++) {
      const date = getDateString(getDaysAgo(i));
      const daily = state.adminDailyStats[date];
      if (daily) {
        daily.active_users.forEach((u) => uniqueUsers.add(u));
      }
    }

    return uniqueUsers.size;
  },

  getTopFarmstands: (metric, limit = 10) => {
    const state = get();
    const farmstandMetrics: { farmstand_id: string; value: number }[] = [];

    for (const [farmstand_id, total] of Object.entries(state.farmstandTotalStats)) {
      let value = 0;
      switch (metric) {
        case 'views':
          value = total.views_total;
          break;
        case 'saves':
          value = total.saves_total;
          break;
        case 'directions':
          value = total.directions_total;
          break;
      }
      farmstandMetrics.push({ farmstand_id, value });
    }

    return farmstandMetrics.sort((a, b) => b.value - a.value).slice(0, limit);
  },

  getDataQualityMetrics: (farmstands) => {
    if (farmstands.length === 0) {
      return {
        percentClaimed: 0,
        percentWithPhotos: 0,
        percentWithHours: 0,
        percentWithLocation: 0,
        percentWithProducts: 0,
      };
    }

    const total = farmstands.length;
    const claimed = farmstands.filter((f) => f.claimStatus === 'claimed').length;
    const withPhotos = farmstands.filter((f) => f.photos && f.photos.length > 0).length;
    const withHours = farmstands.filter((f) => f.hours).length;
    const withLocation = farmstands.filter((f) => f.latitude && f.longitude).length;
    const withProducts = farmstands.filter((f) => f.offerings && f.offerings.length > 0).length;

    return {
      percentClaimed: Math.round((claimed / total) * 100),
      percentWithPhotos: Math.round((withPhotos / total) * 100),
      percentWithHours: Math.round((withHours / total) * 100),
      percentWithLocation: Math.round((withLocation / total) * 100),
      percentWithProducts: Math.round((withProducts / total) * 100),
    };
  },

  getTotalEvents7Days: () => {
    const state = get();
    const cutoff = getDaysAgo(7).toISOString();
    return state.events.filter((e) => e.timestamp >= cutoff).length;
  },

  getTopEventTypes7Days: () => {
    const state = get();
    const cutoff = getDaysAgo(7).toISOString();
    const recentEvents = state.events.filter((e) => e.timestamp >= cutoff);

    const counts: { [type: string]: number } = {};
    recentEvents.forEach((e) => {
      counts[e.event_type] = (counts[e.event_type] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([type, count]) => ({ type: type as EventType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  },
}));
