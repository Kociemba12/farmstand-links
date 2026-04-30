-- Per-user soft delete for conversations
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to run multiple times (IF NOT EXISTS / IF EXISTS guards).

-- 1. Add soft-delete timestamp columns
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS deleted_by_owner_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_customer_at TIMESTAMPTZ;

-- 2. Allow authenticated participants to update their own soft-delete field.
--    Drop first in case an older version of the policy exists.
DROP POLICY IF EXISTS "Users can soft-delete their conversations" ON public.conversations;

CREATE POLICY "Users can soft-delete their conversations"
  ON public.conversations
  FOR UPDATE
  USING  (auth.uid() = owner_id OR auth.uid() = customer_id)
  WITH CHECK (auth.uid() = owner_id OR auth.uid() = customer_id);
