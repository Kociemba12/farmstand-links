-- ============================================================
-- Alerts soft-delete support
-- Run once in your Supabase SQL Editor.
-- ============================================================

-- Add deleted_at column to alerts table (safe, no-op if already exists)
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index so the IS NULL filter is fast
CREATE INDEX IF NOT EXISTS alerts_deleted_at_idx
  ON public.alerts (deleted_at)
  WHERE deleted_at IS NULL;
