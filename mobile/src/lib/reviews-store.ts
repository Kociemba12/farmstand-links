import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAdminStore } from './admin-store';

export interface ReviewResponse {
  text: string;
  date: string;
  authorId?: string;
  updatedAt?: string;
}

export interface Review {
  id: string;
  farmId: string;
  userName: string;
  userAvatar: string;
  rating: number;
  date: string;
  text: string;
  helpful: number;
  // For farmer/owner responses
  response?: ReviewResponse;
}

// Helper to calculate and update farmstand review stats
const updateFarmstandReviewStats = async (farmId: string, reviews: Review[]) => {
  const farmReviews = reviews.filter((r) => r.farmId === farmId);
  const reviewCount = farmReviews.length;
  const avgRating =
    reviewCount > 0
      ? Math.round((farmReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
      : 0;

  // Update the admin store with new stats (this also triggers gold verification evaluation)
  await useAdminStore.getState().updateFarmstandReviewStats(farmId, reviewCount, avgRating);
};

interface ReviewsState {
  reviews: Review[];
  isLoaded: boolean;

  // Actions
  loadReviews: () => Promise<void>;
  addReview: (farmId: string, userName: string, rating: number, text: string) => Promise<void>;
  getReviewsForFarm: (farmId: string) => Review[];
  markHelpful: (reviewId: string) => Promise<void>;
  addFarmerResponse: (reviewId: string, responseText: string) => Promise<void>;
  // Owner response methods
  addOwnerResponse: (reviewId: string, responseText: string, authorId: string) => Promise<void>;
  updateOwnerResponse: (reviewId: string, responseText: string) => Promise<void>;
  deleteOwnerResponse: (reviewId: string) => Promise<void>;
  clearAllReviews: () => Promise<void>;
}

// Initial seed reviews
const SEED_REVIEWS: Review[] = [];

export const useReviewsStore = create<ReviewsState>((set, get) => ({
  reviews: [],
  isLoaded: false,

  loadReviews: async () => {
    try {
      const stored = await AsyncStorage.getItem('farmstand_reviews_v2');
      if (stored) {
        set({ reviews: JSON.parse(stored), isLoaded: true });
      } else {
        // Initialize with seed reviews
        await AsyncStorage.setItem('farmstand_reviews_v2', JSON.stringify(SEED_REVIEWS));
        set({ reviews: SEED_REVIEWS, isLoaded: true });
      }
    } catch (error) {
      console.error('Error loading reviews:', error);
      set({ reviews: SEED_REVIEWS, isLoaded: true });
    }
  },

  addReview: async (farmId: string, userName: string, rating: number, text: string) => {
    const newReview: Review = {
      id: `r-${Date.now()}`,
      farmId,
      userName,
      userAvatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100',
      rating,
      date: 'Just now',
      text,
      helpful: 0,
    };

    const updatedReviews = [newReview, ...get().reviews];
    await AsyncStorage.setItem('farmstand_reviews_v2', JSON.stringify(updatedReviews));
    set({ reviews: updatedReviews });

    // Update farmstand review stats and trigger gold verification evaluation
    await updateFarmstandReviewStats(farmId, updatedReviews);
  },

  getReviewsForFarm: (farmId: string) => {
    return get().reviews.filter((r) => r.farmId === farmId);
  },

  markHelpful: async (reviewId: string) => {
    const updatedReviews = get().reviews.map((r) =>
      r.id === reviewId ? { ...r, helpful: r.helpful + 1 } : r
    );
    await AsyncStorage.setItem('farmstand_reviews_v2', JSON.stringify(updatedReviews));
    set({ reviews: updatedReviews });
  },

  addFarmerResponse: async (reviewId: string, responseText: string) => {
    const updatedReviews = get().reviews.map((r) =>
      r.id === reviewId
        ? {
            ...r,
            response: {
              text: responseText,
              date: 'Just now',
            },
          }
        : r
    );
    await AsyncStorage.setItem('farmstand_reviews_v2', JSON.stringify(updatedReviews));
    set({ reviews: updatedReviews });
  },

  addOwnerResponse: async (reviewId: string, responseText: string, authorId: string) => {
    const updatedReviews = get().reviews.map((r) =>
      r.id === reviewId
        ? {
            ...r,
            response: {
              text: responseText,
              date: new Date().toISOString(),
              authorId,
            },
          }
        : r
    );
    await AsyncStorage.setItem('farmstand_reviews_v2', JSON.stringify(updatedReviews));
    set({ reviews: updatedReviews });
  },

  updateOwnerResponse: async (reviewId: string, responseText: string) => {
    const updatedReviews = get().reviews.map((r) =>
      r.id === reviewId && r.response
        ? {
            ...r,
            response: {
              ...r.response,
              text: responseText,
              updatedAt: new Date().toISOString(),
            },
          }
        : r
    );
    await AsyncStorage.setItem('farmstand_reviews_v2', JSON.stringify(updatedReviews));
    set({ reviews: updatedReviews });
  },

  deleteOwnerResponse: async (reviewId: string) => {
    const updatedReviews = get().reviews.map((r) =>
      r.id === reviewId
        ? {
            ...r,
            response: undefined,
          }
        : r
    );
    await AsyncStorage.setItem('farmstand_reviews_v2', JSON.stringify(updatedReviews));
    set({ reviews: updatedReviews });
  },

  clearAllReviews: async () => {
    await AsyncStorage.setItem('farmstand_reviews_v2', JSON.stringify([]));
    set({ reviews: [] });
  },
}));
