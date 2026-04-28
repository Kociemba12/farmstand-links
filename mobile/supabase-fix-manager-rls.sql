-- ============================================================
-- FIX: Re-apply RLS policies for farmstand_inventory and
--      farmstand_expenses using farmstand_owners table.
--
-- Ownership model: a user owns a farmstand if there is a row
-- in public.farmstand_owners where
--   farmstand_id = <the row's farmstand_id>
--   AND user_id = auth.uid()
--
-- Run this in your Supabase SQL Editor AFTER you have already
-- applied the same fix to farmstand_sales.
-- ============================================================

-- ============================================================
-- farmstand_inventory
-- ============================================================

DROP POLICY IF EXISTS "Owners can read own inventory"   ON public.farmstand_inventory;
DROP POLICY IF EXISTS "Owners can insert own inventory" ON public.farmstand_inventory;
DROP POLICY IF EXISTS "Owners can update own inventory" ON public.farmstand_inventory;
DROP POLICY IF EXISTS "Owners can delete own inventory" ON public.farmstand_inventory;

CREATE POLICY "Owners can read own inventory"
  ON public.farmstand_inventory FOR SELECT
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can insert own inventory"
  ON public.farmstand_inventory FOR INSERT
  WITH CHECK (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update own inventory"
  ON public.farmstand_inventory FOR UPDATE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can delete own inventory"
  ON public.farmstand_inventory FOR DELETE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- farmstand_expenses
-- ============================================================

DROP POLICY IF EXISTS "Owners can read own expenses"   ON public.farmstand_expenses;
DROP POLICY IF EXISTS "Owners can insert own expenses" ON public.farmstand_expenses;
DROP POLICY IF EXISTS "Owners can update own expenses" ON public.farmstand_expenses;
DROP POLICY IF EXISTS "Owners can delete own expenses" ON public.farmstand_expenses;

CREATE POLICY "Owners can read own expenses"
  ON public.farmstand_expenses FOR SELECT
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can insert own expenses"
  ON public.farmstand_expenses FOR INSERT
  WITH CHECK (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update own expenses"
  ON public.farmstand_expenses FOR UPDATE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Owners can delete own expenses"
  ON public.farmstand_expenses FOR DELETE
  USING (
    farmstand_id IN (
      SELECT farmstand_id FROM public.farmstand_owners WHERE user_id = auth.uid()
    )
  );
