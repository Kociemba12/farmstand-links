-- ============================================================
-- FIX: Review stats trigger on farmstand_reviews
--
-- Problem: The existing trigger on farmstand_reviews runs as
-- SECURITY INVOKER (the calling user's permissions). When an
-- authenticated user inserts a review, the trigger tries to
-- UPDATE farmstands.avg_rating / review_count, but normal users
-- don't have UPDATE permission on farmstands → 403 RLS error
-- blocks the entire insert transaction.
--
-- Fix: Recreate the trigger function with SECURITY DEFINER so it
-- runs as the DB owner and bypasses RLS for the stats update.
--
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/khngqgjabrmgtbbnpiax/sql
-- ============================================================

-- ── 1. Drop any existing review-stats triggers ──────────────────
DROP TRIGGER IF EXISTS update_farmstand_review_stats    ON public.farmstand_reviews;
DROP TRIGGER IF EXISTS sync_farmstand_review_stats      ON public.farmstand_reviews;
DROP TRIGGER IF EXISTS farmstand_review_stats_trigger   ON public.farmstand_reviews;
DROP TRIGGER IF EXISTS after_review_insert              ON public.farmstand_reviews;
DROP TRIGGER IF EXISTS on_review_change                 ON public.farmstand_reviews;
DROP TRIGGER IF EXISTS review_stats_trigger             ON public.farmstand_reviews;
DROP TRIGGER IF EXISTS trig_review_stats                ON public.farmstand_reviews;
DROP TRIGGER IF EXISTS review_insert_trigger            ON public.farmstand_reviews;

-- ── 2. Drop the old trigger function if it exists ───────────────
DROP FUNCTION IF EXISTS public.update_farmstand_review_stats() CASCADE;
DROP FUNCTION IF EXISTS public.sync_farmstand_review_stats()   CASCADE;
DROP FUNCTION IF EXISTS public.refresh_farmstand_review_stats() CASCADE;
DROP FUNCTION IF EXISTS public.farmstand_review_stats_fn()     CASCADE;

-- ── 3. Ensure the stats columns exist on farmstands ────────────
--   (safe to run even if they already exist)
ALTER TABLE public.farmstands
  ADD COLUMN IF NOT EXISTS review_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_rating   numeric(4,2) NOT NULL DEFAULT 0;

-- ── 4. Create a SECURITY DEFINER trigger function ───────────────
--   Recalculates avg_rating and review_count for the affected
--   farmstand after any INSERT / UPDATE / DELETE on farmstand_reviews.
--   SECURITY DEFINER means it runs as the function owner (postgres),
--   bypassing row-level security on the farmstands table.
CREATE OR REPLACE FUNCTION public.refresh_farmstand_review_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmstand_id text;
  v_count        integer;
  v_avg          numeric;
BEGIN
  -- Determine which farmstand_id was affected
  IF TG_OP = 'DELETE' THEN
    v_farmstand_id := OLD.farmstand_id;
  ELSE
    v_farmstand_id := NEW.farmstand_id;
  END IF;

  -- Recalculate from all current rows for that farmstand
  SELECT
    COUNT(*)::integer,
    COALESCE(ROUND(AVG(rating)::numeric, 2), 0)
  INTO v_count, v_avg
  FROM public.farmstand_reviews
  WHERE farmstand_id = v_farmstand_id;

  -- Write stats back to farmstands (SECURITY DEFINER bypasses RLS)
  UPDATE public.farmstands
  SET
    review_count = v_count,
    avg_rating   = v_avg,
    updated_at   = NOW()
  WHERE id::text = v_farmstand_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 5. Attach the trigger ────────────────────────────────────────
CREATE TRIGGER update_farmstand_review_stats
AFTER INSERT OR UPDATE OR DELETE
ON public.farmstand_reviews
FOR EACH ROW
EXECUTE FUNCTION public.refresh_farmstand_review_stats();

-- ── 6. Grant execute to authenticated users (required for calling via RPC) ──
-- (The trigger fires automatically — no direct EXECUTE grant needed,
--  but granting it doesn't hurt and is harmless.)
GRANT EXECUTE ON FUNCTION public.refresh_farmstand_review_stats() TO authenticated;
