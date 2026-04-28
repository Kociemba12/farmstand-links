-- ============================================
-- FIX: submit_claim_request RPC where auth.uid() returns null
-- The issue: the deployed function doesn't have SET search_path = public
-- which causes auth.uid() to return null in some Supabase configurations.
--
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/khngqgjabrmgtbbnpiax/sql
-- ============================================

-- Drop all existing overloads of submit_claim_request
DROP FUNCTION IF EXISTS submit_claim_request(UUID, TEXT, TEXT, TEXT[], TEXT);
DROP FUNCTION IF EXISTS submit_claim_request(UUID, TEXT, TEXT, TEXT[]);

-- Recreate with correct SECURITY DEFINER + search_path so auth.uid() works
CREATE OR REPLACE FUNCTION submit_claim_request(
  p_farmstand_id   UUID,
  p_message        TEXT,
  p_requester_email TEXT,
  p_evidence_urls  TEXT[] DEFAULT '{}'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_new_id  UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.farmstands
    WHERE id = p_farmstand_id
      AND (claim_status IS NULL OR claim_status IN ('unclaimed', 'pending'))
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Farmstand not found or already claimed');
  END IF;

  -- Remove any existing pending claim from this user for this farmstand
  DELETE FROM public.claim_requests
   WHERE farmstand_id = p_farmstand_id
     AND user_id = v_user_id
     AND status = 'pending';

  INSERT INTO public.claim_requests (
    farmstand_id, user_id, requester_name, requester_email, evidence_urls, status
  ) VALUES (
    p_farmstand_id, v_user_id, p_message, p_requester_email,
    COALESCE(p_evidence_urls, '{}'), 'pending'
  )
  RETURNING id INTO v_new_id;

  UPDATE public.farmstands
     SET claim_status = 'pending', updated_at = NOW()
   WHERE id = p_farmstand_id
     AND (claim_status IS NULL OR claim_status = 'unclaimed');

  RETURN json_build_object('success', true, 'claim_request_id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_claim_request(UUID, TEXT, TEXT, TEXT[]) TO authenticated;
