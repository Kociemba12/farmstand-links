-- ============================================================
-- Farmstand Reviews Table
-- Stores all customer reviews for farmstands, shared across
-- all users. Reviews are queried by farmstand_id only so every
-- user sees ALL reviews for a farmstand, not just their own.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.farmstand_reviews (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  farmstand_id    text        NOT NULL,
  user_id         text        NOT NULL,
  user_name       text        NOT NULL,
  rating          integer     NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text     text        NOT NULL DEFAULT '',
  owner_response  text,
  owner_response_at timestamptz,
  created_at      timestamptz DEFAULT now() NOT NULL
);

-- Fast lookups by farmstand
CREATE INDEX IF NOT EXISTS idx_farmstand_reviews_farmstand_id
  ON public.farmstand_reviews (farmstand_id);

-- Fast lookups by user (for profile/my-reviews screen)
CREATE INDEX IF NOT EXISTS idx_farmstand_reviews_user_id
  ON public.farmstand_reviews (user_id);

-- ============================================================
-- Row-Level Security
-- ============================================================

ALTER TABLE public.farmstand_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read all reviews for any farmstand (public reads)
CREATE POLICY "farmstand_reviews_public_read"
  ON public.farmstand_reviews
  FOR SELECT
  USING (true);

-- Authenticated users can insert their own reviews
CREATE POLICY "farmstand_reviews_insert"
  ON public.farmstand_reviews
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

-- Review author can update their own review text/rating
CREATE POLICY "farmstand_reviews_update_author"
  ON public.farmstand_reviews
  FOR UPDATE
  USING (auth.uid()::text = user_id);

-- Farmstand owners can set owner_response on reviews for their farmstand
-- Checks the farmstand_owners table for active ownership
CREATE POLICY "farmstand_reviews_owner_response"
  ON public.farmstand_reviews
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.farmstand_owners fo
      WHERE fo.farmstand_id = farmstand_reviews.farmstand_id
        AND fo.user_id = auth.uid()::text
        AND (fo.is_active IS NULL OR fo.is_active = true)
    )
  );

-- Review author can delete their own review
CREATE POLICY "farmstand_reviews_delete"
  ON public.farmstand_reviews
  FOR DELETE
  USING (auth.uid()::text = user_id);
