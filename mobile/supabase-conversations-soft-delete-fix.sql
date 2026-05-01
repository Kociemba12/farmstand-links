-- ============================================================================
-- Fix conversations soft-delete persistence
--
-- Root cause: The original RLS UPDATE policy in supabase-conversation-soft-delete.sql
-- used `auth.uid() = owner_id` without a ::text cast. If owner_id/customer_id are
-- stored as TEXT (not UUID), this comparison silently returns false → PATCH returns
-- HTTP 200 with 0 rows updated → soft-delete never persists to the DB.
--
-- This file:
--   1. Ensures the soft-delete columns exist (idempotent)
--   2. Replaces the UPDATE policy with one that uses ::text cast on both sides
--
-- Run in Supabase SQL Editor BEFORE supabase-conversation-soft-delete.sql if that
-- file has not been deployed yet, or run this file alone to fix an existing deployment.
-- Safe to run multiple times (IF NOT EXISTS / DROP IF EXISTS guards).
-- ============================================================================

-- Step 1: Ensure columns exist
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS deleted_by_owner_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_customer_at TIMESTAMPTZ;

-- Step 2: Fix RLS UPDATE policy — use ::text cast so the comparison works
-- regardless of whether owner_id/customer_id are UUID or TEXT columns.
DROP POLICY IF EXISTS "Users can soft-delete their conversations" ON public.conversations;

CREATE POLICY "Users can soft-delete their conversations"
  ON public.conversations
  FOR UPDATE
  USING  (auth.uid()::text = owner_id::text OR auth.uid()::text = customer_id::text)
  WITH CHECK (auth.uid()::text = owner_id::text OR auth.uid()::text = customer_id::text);

-- ── Verification ─────────────────────────────────────────────────────────────
-- Check that both columns exist and the policy is in place.

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'conversations'
  AND column_name  IN ('deleted_by_owner_at', 'deleted_by_customer_at')
ORDER BY column_name;

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename  = 'conversations'
  AND policyname = 'Users can soft-delete their conversations';
