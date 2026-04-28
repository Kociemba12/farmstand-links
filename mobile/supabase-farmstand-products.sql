-- ============================================================
-- FARMSTAND PRODUCTS TABLE
-- ============================================================
-- Stores products/items that farmstands offer for sale.
-- Used by product search in mobile/src/lib/search-store.ts to
-- augment local search results with product-name matching.
--
-- Columns queried by the app:
--   SELECT farmstand_id WHERE name ILIKE '%query%' AND is_active = true
--
-- Run this SQL in your Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS and DROP POLICY IF EXISTS.
--
-- IMPORTANT: Owners must populate this table for product search to work.
-- The app currently has no UI to write to this table — it's a future feature.
-- When you add a products UI, use createProduct() / updateProduct() calls
-- that insert rows here.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.farmstand_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmstand_id  UUID NOT NULL REFERENCES public.farmstands(id) ON DELETE CASCADE,

  -- Product info
  name          TEXT NOT NULL,
  category      TEXT,
  description   TEXT,
  price         NUMERIC(10, 2),
  unit          TEXT DEFAULT 'each',

  -- Lifecycle
  is_active     BOOLEAN NOT NULL DEFAULT true,
  in_season     BOOLEAN DEFAULT true,          -- seasonal availability flag
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS farmstand_products_farmstand_id_idx ON public.farmstand_products(farmstand_id);
CREATE INDEX IF NOT EXISTS farmstand_products_name_idx         ON public.farmstand_products USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS farmstand_products_is_active_idx    ON public.farmstand_products(is_active) WHERE is_active = true;

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE public.farmstand_products ENABLE ROW LEVEL SECURITY;

-- Any authenticated user (or anonymous) can read active products
-- (needed for product search in the explore/search flow)
DROP POLICY IF EXISTS "Products are publicly readable" ON public.farmstand_products;
CREATE POLICY "Products are publicly readable"
  ON public.farmstand_products FOR SELECT
  USING (true);

-- Owners can insert products for their own farmstands
DROP POLICY IF EXISTS "Owners can insert own products" ON public.farmstand_products;
CREATE POLICY "Owners can insert own products"
  ON public.farmstand_products FOR INSERT
  WITH CHECK (
    farmstand_id IN (
      SELECT id FROM public.farmstands WHERE owner_user_id = auth.uid()
    )
  );

-- Owners can update their own products
DROP POLICY IF EXISTS "Owners can update own products" ON public.farmstand_products;
CREATE POLICY "Owners can update own products"
  ON public.farmstand_products FOR UPDATE
  USING (
    farmstand_id IN (
      SELECT id FROM public.farmstands WHERE owner_user_id = auth.uid()
    )
  );

-- Owners can delete their own products
DROP POLICY IF EXISTS "Owners can delete own products" ON public.farmstand_products;
CREATE POLICY "Owners can delete own products"
  ON public.farmstand_products FOR DELETE
  USING (
    farmstand_id IN (
      SELECT id FROM public.farmstands WHERE owner_user_id = auth.uid()
    )
  );
