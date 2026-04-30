-- ============================================================================
-- Fixes "My Tickets shows 0 rows" by ensuring the feedback table has:
--   1. RLS enabled
--   2. A SELECT policy so authenticated users can read their own rows
--
-- Run this in your Supabase SQL Editor.
-- ============================================================================

-- Enable RLS (idempotent — safe to run even if already enabled)
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Drop the policy if it already exists under a different definition, then recreate
DROP POLICY IF EXISTS "Users can view own feedback" ON public.feedback;

-- Allow authenticated users to SELECT only their own feedback rows
CREATE POLICY "Users can view own feedback"
ON public.feedback
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
