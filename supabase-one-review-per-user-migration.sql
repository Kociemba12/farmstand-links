-- ============================================================
-- Migration: Enforce one review per user per farmstand
-- Run this in your Supabase SQL editor (Dashboard > SQL Editor)
-- ============================================================

-- Step 1: Deduplicate existing rows.
-- For any user+farmstand pair that has multiple reviews,
-- keep only the most recently created one and delete the rest.
DELETE FROM public.farmstand_reviews
WHERE id NOT IN (
  SELECT DISTINCT ON (farmstand_id, user_id) id
  FROM public.farmstand_reviews
  ORDER BY farmstand_id, user_id, created_at DESC
);

-- Step 2: Add a unique constraint so the database enforces this going forward.
-- The app will use ON CONFLICT (farmstand_id, user_id) DO UPDATE to upsert.
ALTER TABLE public.farmstand_reviews
ADD CONSTRAINT farmstand_reviews_user_farmstand_unique
UNIQUE (farmstand_id, user_id);

-- Step 3 (optional): Verify no duplicates remain before the constraint applies.
-- Run this first if you want to preview what would be deleted:
--
-- SELECT farmstand_id, user_id, COUNT(*) as cnt
-- FROM public.farmstand_reviews
-- GROUP BY farmstand_id, user_id
-- HAVING COUNT(*) > 1;
