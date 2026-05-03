/**
 * Farmstand Reviews Store — Supabase-backed
 *
 * Queries by farmstand_id ONLY. Every user sees ALL reviews for a
 * farmstand. No per-user filtering on reads.
 *
 * Cache: keyed by farmstand_id so navigating between farmstands
 * doesn't mix data. Refreshed after every write.
 */

import { create } from 'zustand';
import { supabase, isSupabaseConfigured, getValidSession } from './supabase';
import { useAdminStore } from './admin-store';
import { createAlert } from './alerts-store';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReviewResponse {
  text: string;
  date: string;
  authorId?: string;
  updatedAt?: string;
}

export interface Review {
  id: string;
  farmId: string;
  userId: string;        // reviewer's user_id — used for ownership checks
  userName: string;
  userAvatar: string;
  rating: number;
  date: string;          // human-readable relative date
  createdAt: string;     // raw ISO timestamp for sorting
  text: string;
  helpful: number;
  response?: ReviewResponse;
}

// Shape returned by Supabase REST for this table
interface SupabaseReviewRow {
  id: string;
  farmstand_id: string;
  user_id: string;
  user_name: string;
  rating: number;
  review_text: string;
  owner_response: string | null;
  owner_response_at: string | null;
  created_at: string;
}

interface ProfileRow {
  uid: string;
  avatar_url: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatReviewDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return `${Math.floor(diffDays / 30)} months ago`;
}

function mapRowToReview(row: SupabaseReviewRow, avatarUrl?: string | null): Review {
  return {
    id: row.id,
    farmId: row.farmstand_id,
    userId: row.user_id,
    userName: row.user_name,
    userAvatar: avatarUrl ?? '',
    rating: row.rating,
    date: formatReviewDate(row.created_at),
    createdAt: row.created_at,
    text: row.review_text,
    helpful: 0,
    response: row.owner_response
      ? {
          text: row.owner_response,
          date: row.owner_response_at ? formatReviewDate(row.owner_response_at) : '',
        }
      : undefined,
  };
}

// ── Store interface ───────────────────────────────────────────────────────────

interface ReviewsState {
  /** Reviews cached per farmstand_id */
  reviewsByFarm: Record<string, Review[]>;
  /** Reviews written by the current logged-in user */
  myReviews: Review[];
  /** Tracks which farmstands have been loaded (prevents redundant fetches) */
  loadedFarms: Set<string>;
  /** True while any fetch is in progress */
  isLoading: boolean;

  // ── Queries ────────────────────────────────────────────────────────────────
  /** Load all reviews for a farmstand from Supabase (no user filter). */
  loadReviewsForFarm: (farmId: string) => Promise<void>;
  /** Load all reviews written by a specific user. */
  loadMyReviews: (userId: string) => Promise<void>;
  /** Return cached reviews for a farmstand. */
  getReviewsForFarm: (farmId: string) => Review[];
  /** Backward-compat alias used by farm/[id].tsx */
  loadReviews: () => Promise<void>;
  isLoaded: boolean;

  // ── Writes ─────────────────────────────────────────────────────────────────
  addReview: (
    farmId: string,
    userId: string,
    userName: string,
    rating: number,
    text: string
  ) => Promise<{ success: boolean; error?: string }>;

  /** Farmer: add an owner response to a review */
  addOwnerResponse: (reviewId: string, responseText: string, authorId: string) => Promise<void>;
  /** Farmer: edit an existing owner response */
  updateOwnerResponse: (reviewId: string, responseText: string) => Promise<void>;
  /** Farmer: remove an owner response */
  deleteOwnerResponse: (reviewId: string) => Promise<void>;
  /** Legacy alias — delegates to addOwnerResponse */
  addFarmerResponse: (reviewId: string, responseText: string) => Promise<void>;

  /** User: permanently delete one of their own reviews by id */
  deleteMyReview: (reviewId: string, userId: string) => Promise<{ success: boolean; error?: string }>;
  markHelpful: (reviewId: string) => void;
  clearAllReviews: () => void;
  /** Fetch aggregated rating stats for ALL farmstands in one query and sync to admin store. */
  loadAllReviewStats: () => Promise<void>;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useReviewsStore = create<ReviewsState>((set, get) => ({
  reviewsByFarm: {},
  myReviews: [],
  loadedFarms: new Set<string>(),
  isLoading: false,
  isLoaded: true, // backward-compat flag — always true with Supabase

  // ── loadReviews (backward-compat no-op) ─────────────────────────────────
  loadReviews: async () => {
    // No-op: reviews are loaded per-farmstand via loadReviewsForFarm.
    // Kept for backward-compat call sites in farm/[id].tsx.
  },

  // ── loadReviewsForFarm ───────────────────────────────────────────────────
  loadReviewsForFarm: async (farmId: string) => {
    if (!farmId || !isSupabaseConfigured()) return;

    console.log('[Reviews] Loading reviews for farmstand:', farmId);
    set({ isLoading: true });

    const { data, error } = await supabase
      .from<SupabaseReviewRow>('farmstand_reviews')
      .select('*')
      .eq('farmstand_id', farmId)
      .order('created_at', { ascending: false }) // newest first
      .execute();

    if (error) {
      console.log('[Reviews] Error loading reviews:', error.message);
      set({ isLoading: false });
      return;
    }

    const rows = data ?? [];

    // Batch-fetch profile avatars for all unique reviewers
    const uniqueUserIds = [...new Set(rows.map((r) => r.user_id))];
    let avatarMap: Record<string, string | null> = {};

    if (uniqueUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from<ProfileRow>('profiles')
        .select('uid,avatar_url')
        .in('uid', uniqueUserIds)
        .execute();

      for (const p of profiles ?? []) {
        avatarMap[p.uid] = p.avatar_url;
      }
    }

    const reviews = rows.map((row) => mapRowToReview(row, avatarMap[row.user_id] ?? null));

    console.log('[Reviews] farmstand_id:', farmId);
    console.log('[Reviews] total reviews returned:', reviews.length);
    console.log('[Reviews] average rating:', reviews.length > 0
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(2)
      : 'N/A');
    console.log('[Reviews] reviewer ids:', reviews.map(r => r.userId).join(', ') || 'none');

    set((state) => ({
      isLoading: false,
      loadedFarms: new Set([...state.loadedFarms, farmId]),
      reviewsByFarm: { ...state.reviewsByFarm, [farmId]: reviews },
    }));

    // Sync stats to admin store (for farmstand card badges)
    if (reviews.length > 0) {
      const avgRating =
        Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
      await useAdminStore.getState().updateFarmstandReviewStats(farmId, reviews.length, avgRating);
    }
  },

  // ── loadMyReviews ────────────────────────────────────────────────────────
  loadMyReviews: async (userId: string) => {
    if (!userId || !isSupabaseConfigured()) return;

    const { data, error } = await supabase
      .from<SupabaseReviewRow>('farmstand_reviews')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .execute();

    if (error || !data) {
      console.log('[Reviews] loadMyReviews error:', error?.message);
      return;
    }

    // Fetch own avatar once
    const { data: profiles } = await supabase
      .from<ProfileRow>('profiles')
      .select('uid,avatar_url')
      .eq('uid', userId)
      .execute();
    const avatarUrl = profiles?.[0]?.avatar_url ?? null;

    const reviews = data.map((row) => mapRowToReview(row, avatarUrl));
    set({ myReviews: reviews });
  },

  // ── deleteMyReview ───────────────────────────────────────────────────────
  deleteMyReview: async (reviewId: string, userId: string): Promise<{ success: boolean; error?: string }> => {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured' };

    const { error } = await supabase
      .from<SupabaseReviewRow>('farmstand_reviews')
      .delete()
      .eq('id', reviewId)
      .eq('user_id', userId)
      .execute();

    if (error) {
      console.log('[Reviews] deleteMyReview error:', error.message);
      return { success: false, error: error.message };
    }

    set((state) => {
      const updatedMyReviews = state.myReviews.filter((r) => r.id !== reviewId);
      const updatedByFarm: Record<string, Review[]> = {};
      for (const [farmId, reviews] of Object.entries(state.reviewsByFarm)) {
        updatedByFarm[farmId] = reviews.filter((r) => r.id !== reviewId);
      }
      return { myReviews: updatedMyReviews, reviewsByFarm: updatedByFarm };
    });

    return { success: true };
  },

  // ── getReviewsForFarm ────────────────────────────────────────────────────
  getReviewsForFarm: (farmId: string) => {
    return get().reviewsByFarm[farmId] ?? [];
  },

  // ── addReview ────────────────────────────────────────────────────────────
  addReview: async (
    farmId: string,
    userId: string,
    userName: string,
    rating: number,
    text: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!farmId || !isSupabaseConfigured()) {
      console.log('[Reviews] addReview — cannot proceed: farmId missing or Supabase not configured');
      return { success: false, error: 'Supabase not configured' };
    }

    const session = await getValidSession();
    if (!session?.access_token) {
      console.log('[Reviews] addReview — no valid session, cannot insert review');
      return { success: false, error: 'Not signed in. Please sign out and sign back in.' };
    }

    // Decode the Supabase user ID directly from the JWT sub claim.
    // This is the value auth.uid() returns server-side and MUST match user_id for RLS to pass.
    let jwtUserId: string = userId;
    try {
      const parts = session.access_token.split('.');
      if (parts.length === 3) {
        const jwtPayload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (jwtPayload.sub) {
          jwtUserId = jwtPayload.sub as string;
        }
      }
    } catch { /* ignore decode errors, fall back to passed userId */ }

    console.log('[Reviews] addReview — session valid, expires_at:', session.expires_at);
    console.log('[Reviews] addReview — store userId (arg):', userId);
    console.log('[Reviews] addReview — JWT sub (auth.uid):', jwtUserId);
    if (userId !== jwtUserId) {
      console.log('[Reviews] addReview — WARNING: store userId != JWT sub — using JWT sub for RLS compliance');
    }

    const payload = {
      farmstand_id: farmId,
      user_id: jwtUserId,   // always use JWT sub so auth.uid()::text = user_id passes RLS
      user_name: userName,
      rating,
      review_text: text,
    };
    console.log('[Reviews] addReview — submitting payload:', JSON.stringify(payload));

    // Check if a review already exists for this user+farmstand
    const { data: existing } = await supabase
      .from<SupabaseReviewRow>('farmstand_reviews')
      .select('id')
      .eq('farmstand_id', farmId)
      .eq('user_id', jwtUserId)
      .limit(1)
      .execute();

    const existingId = existing?.[0]?.id;

    let error;
    if (existingId) {
      // Update the existing review
      console.log('[Reviews] addReview — existing review found, updating:', existingId);
      const res = await supabase
        .from<SupabaseReviewRow>('farmstand_reviews')
        .update({ rating, review_text: text, user_name: userName })
        .eq('id', existingId)
        .execute();
      error = res.error;
    } else {
      // Insert a new review
      const res = await supabase
        .from<SupabaseReviewRow>('farmstand_reviews')
        .insert(payload)
        .execute();
      error = res.error;
    }

    if (error) {
      const errMsg = [
        error.message,
        (error as { code?: string }).code ? `code=${(error as { code?: string }).code}` : null,
        (error as { hint?: string }).hint ? `hint=${(error as { hint?: string }).hint}` : null,
        (error as { details?: string }).details ? `details=${(error as { details?: string }).details}` : null,
        (error as { status?: number }).status ? `status=${(error as { status?: number }).status}` : null,
      ].filter(Boolean).join(' | ');
      console.log('[Reviews] addReview — Supabase write FAILED:', errMsg);
      return { success: false, error: errMsg };
    }

    console.log('[Reviews] addReview — Supabase write SUCCESS');
    // Refresh the cache so the updated/new review appears immediately
    await get().loadReviewsForFarm(farmId);

    // Fire an inbox alert for the farmstand owner (non-blocking)
    const farmstand = useAdminStore.getState().allFarmstands.find((f) => f.id === farmId);
    if (farmstand?.ownerUserId && farmstand.ownerUserId !== jwtUserId) {
      createAlert({
        user_id: farmstand.ownerUserId,
        farmstand_id: farmId,
        type: 'review_new',
        title: 'New review received',
        body: `${userName} left a ${rating}-star review on ${farmstand.name}`,
        action_route: 'Reviews',
        action_params: { farmstandId: farmId },
      }).catch(() => { /* non-fatal */ });
    }

    return { success: true };
  },

  // ── Owner response methods ────────────────────────────────────────────────
  // These go through the backend server (service role key) to bypass RLS.

  addOwnerResponse: async (reviewId: string, responseText: string, _authorId: string) => {
    if (!isSupabaseConfigured()) return;

    // Find farmId and reviewerId from cache for the alert
    let reviewFarmId: string | null = null;
    let reviewerId: string | null = null;
    for (const [fId, reviews] of Object.entries(get().reviewsByFarm)) {
      const found = reviews.find((r) => r.id === reviewId);
      if (found) { reviewFarmId = fId; reviewerId = found.userId; break; }
    }

    console.log('[Reviews:addOwnerResponse] reviewId:', reviewId);
    console.log('[Reviews:addOwnerResponse] farmstand_id:', reviewFarmId);
    console.log('[Reviews:addOwnerResponse] reply text:', responseText);

    const session = await getValidSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
    const payload = { review_id: reviewId, farmstand_id: reviewFarmId ?? '', owner_response: responseText };
    console.log('[Reviews:addOwnerResponse] backend payload:', JSON.stringify(payload));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let resp: Response;
    try {
      resp = await fetch(`${backendUrl}/api/owner-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const rct1 = resp.headers.get('content-type') ?? '';
    if (!rct1.includes('application/json')) {
      console.log('[Reviews:addOwnerResponse] non-JSON response (HTTP', resp.status, '), content-type:', rct1);
      throw new Error(`Unexpected response from server (HTTP ${resp.status})`);
    }
    const result = await resp.json() as { success: boolean; error?: string; message?: string; owner_response?: string; owner_response_at?: string };
    console.log('[Reviews:addOwnerResponse] backend response status:', resp.status);
    console.log('[Reviews:addOwnerResponse] backend response body:', JSON.stringify(result));

    if (!resp.ok || !result.success) {
      const errMsg = result.message ?? result.error ?? 'Failed to save reply';
      throw new Error(errMsg);
    }

    console.log('[Reviews:addOwnerResponse] owner_response confirmed:', result.owner_response);

    // Update cache from confirmed response
    set((state) => {
      const updated = { ...state.reviewsByFarm };
      for (const farmId of Object.keys(updated)) {
        updated[farmId] = updated[farmId].map((r) =>
          r.id === reviewId
            ? {
                ...r,
                response: {
                  text: result.owner_response!,
                  date: result.owner_response_at ?? new Date().toISOString(),
                  authorId: _authorId,
                },
              }
            : r
        );
      }
      return { reviewsByFarm: updated };
    });

    // Fire inbox alert for the reviewer (non-blocking)
    if (reviewerId && reviewFarmId && reviewerId !== _authorId) {
      const farmstand = useAdminStore.getState().allFarmstands.find((f) => f.id === reviewFarmId);
      createAlert({
        user_id: reviewerId,
        farmstand_id: reviewFarmId,
        type: 'review_reply',
        title: 'Owner replied to your review',
        body: `${farmstand?.name ?? 'The farmstand'} responded to your review`,
        action_route: 'ReviewDetail',
        action_params: { reviewId, farmstandId: reviewFarmId },
      }).catch(() => { /* non-fatal */ });
    }
  },

  updateOwnerResponse: async (reviewId: string, responseText: string) => {
    if (!isSupabaseConfigured()) return;

    console.log('[Reviews:updateOwnerResponse] reviewId:', reviewId);
    console.log('[Reviews:updateOwnerResponse] reply text:', responseText);

    type RpcResult = { owner_response: string; owner_response_at: string };
    const { data, error } = await supabase.rpc<RpcResult>('update_review_reply', {
      p_review_id: reviewId,
      p_reply_text: responseText,
    });

    if (error) {
      const e = error as { message?: string; code?: string; details?: string; hint?: string };
      const msg = [
        e.message ?? 'Unknown error',
        e.code    ? `code=${e.code}`       : null,
        e.details ? `details=${e.details}` : null,
        e.hint    ? `hint=${e.hint}`       : null,
      ].filter(Boolean).join(' | ');
      console.error('[Reviews:updateOwnerResponse] RPC error:', msg);
      throw new Error(msg);
    }

    console.log('[Reviews:updateOwnerResponse] RPC success:', JSON.stringify(data));

    const savedText = data?.owner_response ?? responseText;
    const savedAt   = data?.owner_response_at ?? new Date().toISOString();

    set((state) => {
      const updated = { ...state.reviewsByFarm };
      for (const farmId of Object.keys(updated)) {
        updated[farmId] = updated[farmId].map((r) =>
          r.id === reviewId && r.response
            ? {
                ...r,
                response: {
                  ...r.response,
                  text:      savedText,
                  date:      savedAt,
                  updatedAt: new Date().toISOString(),
                },
              }
            : r
        );
      }
      return { reviewsByFarm: updated };
    });
  },

  deleteOwnerResponse: async (reviewId: string) => {
    if (!isSupabaseConfigured()) return;

    let reviewFarmId: string | null = null;
    for (const [fId, reviews] of Object.entries(get().reviewsByFarm)) {
      if (reviews.find((r) => r.id === reviewId)) { reviewFarmId = fId; break; }
    }

    const session = await getValidSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    const backendUrl = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || '';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let resp: Response;
    try {
      resp = await fetch(`${backendUrl}/api/owner-response`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ review_id: reviewId, farmstand_id: reviewFarmId ?? '' }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const rct3 = resp.headers.get('content-type') ?? '';
    if (!rct3.includes('application/json')) {
      console.log('[Reviews:deleteOwnerResponse] non-JSON response (HTTP', resp.status, '), content-type:', rct3);
      throw new Error(`Unexpected response from server (HTTP ${resp.status})`);
    }
    const result = await resp.json() as { success: boolean; error?: string };
    if (!resp.ok || !result.success) {
      throw new Error(result.error ?? 'Failed to delete reply');
    }

    set((state) => {
      const updated = { ...state.reviewsByFarm };
      for (const farmId of Object.keys(updated)) {
        updated[farmId] = updated[farmId].map((r) =>
          r.id === reviewId ? { ...r, response: undefined } : r
        );
      }
      return { reviewsByFarm: updated };
    });
  },

  addFarmerResponse: async (reviewId: string, responseText: string) => {
    await get().addOwnerResponse(reviewId, responseText, '');
  },

  markHelpful: (reviewId: string) => {
    // Optimistic local increment — not persisted to Supabase
    set((state) => {
      const updated = { ...state.reviewsByFarm };
      for (const farmId of Object.keys(updated)) {
        updated[farmId] = updated[farmId].map((r) =>
          r.id === reviewId ? { ...r, helpful: r.helpful + 1 } : r
        );
      }
      return { reviewsByFarm: updated };
    });
  },

  clearAllReviews: () => {
    set({ reviewsByFarm: {}, loadedFarms: new Set<string>() });
  },

  loadAllReviewStats: async () => {
    if (!isSupabaseConfigured()) return;

    console.log('[Reviews] loadAllReviewStats: fetching aggregated ratings...');

    const { data, error } = await supabase
      .from<{ farmstand_id: string; rating: number }>('farmstand_reviews')
      .select('farmstand_id,rating')
      .execute();

    if (error || !data) {
      console.log('[Reviews] loadAllReviewStats error:', error?.message);
      return;
    }

    // Aggregate by farmstand_id in JS
    const statsByFarm: Record<string, { count: number; sum: number }> = {};
    for (const row of data) {
      if (!statsByFarm[row.farmstand_id]) {
        statsByFarm[row.farmstand_id] = { count: 0, sum: 0 };
      }
      statsByFarm[row.farmstand_id].count++;
      statsByFarm[row.farmstand_id].sum += row.rating;
    }

    console.log('[Reviews] loadAllReviewStats: got stats for', Object.keys(statsByFarm).length, 'farmstands');

    // Batch-update admin store in a single setState call
    const adminStore = useAdminStore.getState();
    const updatedFarmstands = adminStore.allFarmstands.map((f) => {
      const stats = statsByFarm[f.id];
      if (!stats) return f;
      const avgRating = Math.round((stats.sum / stats.count) * 10) / 10;
      return { ...f, reviewCount: stats.count, avgRating, avg_rating: avgRating, review_count: stats.count };
    });

    useAdminStore.setState({ allFarmstands: updatedFarmstands });
  },
}));
