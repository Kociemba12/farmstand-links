-- ============================================================
-- ADD owner_id + claimed_by TO farmstand_products
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- These columns record which authenticated user created each
-- product row. They are explicitly set on every INSERT from
-- the mobile app (owner_id = auth.uid(), claimed_by = auth.uid())
-- and must never be NULL.
--
-- Having these columns directly on the row makes RLS policies
-- simpler and faster (no subquery to farmstands needed).
--
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS
-- ============================================================

-- Add owner_id (UUID of the Supabase auth user who owns this product)
ALTER TABLE public.farmstand_products
  ADD COLUMN IF NOT EXISTS owner_id UUID;

-- Add claimed_by (mirrors the farmstand.claimed_by for easy cross-checks)
ALTER TABLE public.farmstand_products
  ADD COLUMN IF NOT EXISTS claimed_by UUID;

-- Backfill existing rows via join to farmstands (if any products already exist)
UPDATE public.farmstand_products fp
SET
  owner_id  = COALESCE(fs.owner_id, fs.claimed_by, fs.owner_user_id::uuid),
  claimed_by = COALESCE(fs.claimed_by, fs.owner_id)
FROM public.farmstands fs
WHERE fp.farmstand_id = fs.id
  AND (fp.owner_id IS NULL OR fp.claimed_by IS NULL);

-- Index for fast per-owner queries
CREATE INDEX IF NOT EXISTS farmstand_products_owner_id_idx
  ON public.farmstand_products (owner_id);

-- ── Simplified RLS policies ───────────────────────────────────
-- Now check the row's own owner_id / claimed_by directly,
-- no subquery to farmstands required.

-- Public read (unchanged)
DROP POLICY IF EXISTS "Products are publicly readable" ON public.farmstand_products;
CREATE POLICY "Products are publicly readable"
  ON public.farmstand_products FOR SELECT
  USING (true);

-- INSERT: row must carry the caller's auth.uid()
DROP POLICY IF EXISTS "Owners can insert own products" ON public.farmstand_products;
CREATE POLICY "Owners can insert own products"
  ON public.farmstand_products FOR INSERT
  WITH CHECK (
    owner_id  = auth.uid()
    AND claimed_by = auth.uid()
    AND farmstand_id IN (
      SELECT id FROM public.farmstands
      WHERE owner_id = auth.uid()
         OR claimed_by = auth.uid()
         OR owner_user_id = auth.uid()
    )
  );

-- UPDATE: only the owner can update their own products
DROP POLICY IF EXISTS "Owners can update own products" ON public.farmstand_products;
CREATE POLICY "Owners can update own products"
  ON public.farmstand_products FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR claimed_by = auth.uid()
  );

-- DELETE: only the owner can delete their own products
DROP POLICY IF EXISTS "Owners can delete own products" ON public.farmstand_products;
CREATE POLICY "Owners can delete own products"
  ON public.farmstand_products FOR DELETE
  USING (
    owner_id = auth.uid()
    OR claimed_by = auth.uid()
  );
