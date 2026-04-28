-- ============================================================
-- Fix: farmstand_reviews_owner_response RLS policy
--
-- Problem: The original policy checked farmstand_owners.is_active
-- which may not exist as a column, causing Postgres to silently
-- evaluate the policy as false → UPDATE returns 0 rows.
--
-- Fix: Drop & recreate the policy without is_active, and add a
-- fallback check on farmstands.owner_id / claimed_by so owners
-- can always reply regardless of farmstand_owners row state.
-- ============================================================

-- Drop the broken policy
DROP POLICY IF EXISTS "farmstand_reviews_owner_response" ON public.farmstand_reviews;

-- Recreate with robust ownership check
CREATE POLICY "farmstand_reviews_owner_response"
  ON public.farmstand_reviews
  FOR UPDATE
  USING (
    -- Primary: user has a row in farmstand_owners for this farmstand
    EXISTS (
      SELECT 1
      FROM public.farmstand_owners fo
      WHERE fo.farmstand_id = farmstand_reviews.farmstand_id
        AND fo.user_id = auth.uid()::text
    )
    OR
    -- Fallback: user is the recorded owner_id or claimed_by on the farmstands table
    EXISTS (
      SELECT 1
      FROM public.farmstands f
      WHERE f.id::text = farmstand_reviews.farmstand_id
        AND (
          f.owner_id = auth.uid()::text
          OR f.claimed_by = auth.uid()::text
        )
    )
  )
  WITH CHECK (
    -- Same ownership check applies on write
    EXISTS (
      SELECT 1
      FROM public.farmstand_owners fo
      WHERE fo.farmstand_id = farmstand_reviews.farmstand_id
        AND fo.user_id = auth.uid()::text
    )
    OR
    EXISTS (
      SELECT 1
      FROM public.farmstands f
      WHERE f.id::text = farmstand_reviews.farmstand_id
        AND (
          f.owner_id = auth.uid()::text
          OR f.claimed_by = auth.uid()::text
        )
    )
  );
