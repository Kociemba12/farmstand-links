-- ============================================================
-- PRODUCTS PERSISTENCE FIX
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- This migration:
-- 1. Adds missing columns to farmstand_products that the mobile
--    app uses (is_in_stock, stock_note, seasonal, photo_url, sort_order)
-- 2. Fixes RLS policies to check all owner columns (owner_id,
--    claimed_by, owner_user_id) so authenticated owners can
--    insert/update/delete their own products
--
-- Safe to re-run: uses IF NOT EXISTS and DROP POLICY IF EXISTS
-- ============================================================

-- ── Add missing columns ──────────────────────────────────────

-- is_in_stock: whether the product is currently in stock
ALTER TABLE public.farmstand_products
  ADD COLUMN IF NOT EXISTS is_in_stock BOOLEAN NOT NULL DEFAULT true;

-- stock_note: optional note about stock status (e.g. "Limited supply")
ALTER TABLE public.farmstand_products
  ADD COLUMN IF NOT EXISTS stock_note TEXT;

-- seasonal: text description of seasonal availability (e.g. "June–September")
ALTER TABLE public.farmstand_products
  ADD COLUMN IF NOT EXISTS seasonal TEXT;

-- photo_url: URL to product photo stored in Supabase Storage
ALTER TABLE public.farmstand_products
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- sort_order: display order for products within a farmstand
ALTER TABLE public.farmstand_products
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- ── Fix RLS policies ─────────────────────────────────────────
-- The original policies only checked owner_user_id but the app
-- stores the owner's Supabase auth.uid() in owner_id and claimed_by.
-- All three columns must be checked so any ownership mapping works.

-- Public read (unchanged)
DROP POLICY IF EXISTS "Products are publicly readable" ON public.farmstand_products;
CREATE POLICY "Products are publicly readable"
  ON public.farmstand_products FOR SELECT
  USING (true);

-- INSERT: owner must own the farmstand
DROP POLICY IF EXISTS "Owners can insert own products" ON public.farmstand_products;
CREATE POLICY "Owners can insert own products"
  ON public.farmstand_products FOR INSERT
  WITH CHECK (
    farmstand_id IN (
      SELECT id FROM public.farmstands
      WHERE owner_id = auth.uid()
         OR claimed_by = auth.uid()
         OR owner_user_id = auth.uid()
    )
  );

-- UPDATE: owner must own the farmstand
DROP POLICY IF EXISTS "Owners can update own products" ON public.farmstand_products;
CREATE POLICY "Owners can update own products"
  ON public.farmstand_products FOR UPDATE
  USING (
    farmstand_id IN (
      SELECT id FROM public.farmstands
      WHERE owner_id = auth.uid()
         OR claimed_by = auth.uid()
         OR owner_user_id = auth.uid()
    )
  );

-- DELETE: owner must own the farmstand
DROP POLICY IF EXISTS "Owners can delete own products" ON public.farmstand_products;
CREATE POLICY "Owners can delete own products"
  ON public.farmstand_products FOR DELETE
  USING (
    farmstand_id IN (
      SELECT id FROM public.farmstands
      WHERE owner_id = auth.uid()
         OR claimed_by = auth.uid()
         OR owner_user_id = auth.uid()
    )
  );

-- ── Auto-update updated_at trigger ───────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_farmstand_products_updated_at ON public.farmstand_products;
CREATE TRIGGER update_farmstand_products_updated_at
  BEFORE UPDATE ON public.farmstand_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
