-- ============================================================
-- ADD price_tier TO farmstands
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Adds an owner-selectable price tier column to the farmstands
-- table so the map's Price filter can filter by it.
-- $ = Budget-friendly, $$ = Moderate, $$$ = Premium
--
-- Safe to re-run: uses IF NOT EXISTS
-- ============================================================

ALTER TABLE public.farmstands
  ADD COLUMN IF NOT EXISTS price_tier TEXT
  CHECK (price_tier IN ('$', '$$', '$$$'));

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS farmstands_price_tier_idx
  ON public.farmstands (price_tier)
  WHERE price_tier IS NOT NULL;
