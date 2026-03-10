-- ============================================
-- FIX: Admin Claims Tab - Pending Claims RPC
-- ============================================
-- Problem: The RLS policy for admin reads on claim_requests uses
--   auth.jwt() ->> 'email' IN ('contact@farmstand.online', 'joekociemba@gmail.com')
-- But Supabase JWT tokens don't always include the email claim in app_metadata/user_metadata,
-- so the RLS check fails silently and returns 0 rows (no error, just empty).
--
-- Fix: Create a SECURITY DEFINER RPC that bypasses RLS and returns pending claims.
-- The function validates that the caller is an admin by checking their email
-- via the auth.users table (service-level lookup).
-- ============================================

-- Drop old function if exists
DROP FUNCTION IF EXISTS get_pending_claims_for_admin();

CREATE OR REPLACE FUNCTION get_pending_claims_for_admin()
RETURNS TABLE (
  id UUID,
  farmstand_id UUID,
  user_id UUID,
  requester_id UUID,
  requester_email TEXT,
  requester_name TEXT,
  notes TEXT,
  evidence_urls TEXT[],
  status TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ,
  farmstand_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT;
BEGIN
  -- Get caller's email from auth.users (bypasses JWT claim issues)
  SELECT au.email INTO v_caller_email
  FROM auth.users au
  WHERE au.id = auth.uid();

  -- Only allow known admins
  IF v_caller_email IS NULL OR v_caller_email NOT IN (
    'contact@farmstand.online',
    'joekociemba@gmail.com'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- Return pending claims joined with farmstand name
  RETURN QUERY
  SELECT
    cr.id,
    cr.farmstand_id,
    cr.user_id,
    cr.user_id AS requester_id,
    cr.requester_email,
    cr.requester_name,
    COALESCE(cr.notes, cr.message) AS notes,
    COALESCE(cr.evidence_urls, '{}') AS evidence_urls,
    cr.status,
    cr.reviewed_at,
    NULL::TEXT AS reviewed_by,
    cr.created_at,
    f.name AS farmstand_name
  FROM public.claim_requests cr
  JOIN public.farmstands f ON f.id = cr.farmstand_id
  WHERE cr.status = 'pending'
  ORDER BY cr.created_at DESC;
END;
$$;

-- Grant execute to authenticated users (the function itself checks if they're admin)
GRANT EXECUTE ON FUNCTION get_pending_claims_for_admin() TO authenticated;

-- ============================================
-- ALSO FIX: Ensure admin RLS SELECT policy works as fallback
-- Update to also check auth.uid() against a known set, not just jwt email
-- ============================================

-- Drop and recreate admin read policy to be more permissive for known admin UIDs
-- This is a belt-and-suspenders approach alongside the RPC
DROP POLICY IF EXISTS "Admins can read all claim requests" ON public.claim_requests;
CREATE POLICY "Admins can read all claim requests"
  ON public.claim_requests
  FOR SELECT
  USING (
    (auth.jwt() ->> 'email') IN ('contact@farmstand.online', 'joekociemba@gmail.com')
    OR
    (SELECT email FROM auth.users WHERE id = auth.uid()) IN ('contact@farmstand.online', 'joekociemba@gmail.com')
  );
