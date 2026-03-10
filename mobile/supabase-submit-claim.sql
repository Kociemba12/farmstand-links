-- ============================================
-- RPC: SUBMIT CLAIM REQUEST (SECURITY DEFINER)
-- Runs as postgres role so RLS on auth.users / farmstands
-- does NOT block the insert. Client only needs to be authenticated.
--
-- Run this in your Supabase SQL Editor.
-- ============================================

CREATE OR REPLACE FUNCTION submit_claim_request(
  p_farmstand_id   UUID,
  p_requester_name TEXT,
  p_requester_email TEXT,
  p_evidence_urls  TEXT[]  DEFAULT '{}',
  p_notes          TEXT    DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_new_id  UUID;
BEGIN
  -- Caller must be authenticated
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify the farmstand exists and is unclaimed / pending
  IF NOT EXISTS (
    SELECT 1 FROM public.farmstands
    WHERE id = p_farmstand_id
      AND claim_status IN ('unclaimed', 'pending')
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Farmstand not found or already claimed');
  END IF;

  -- Cancel any existing pending request from this user for this farmstand
  UPDATE public.claim_requests
     SET status = 'superseded'
   WHERE farmstand_id = p_farmstand_id
     AND user_id      = v_user_id
     AND status       = 'pending';

  -- Insert the new claim request
  INSERT INTO public.claim_requests (
    farmstand_id,
    user_id,
    requester_name,
    requester_email,
    evidence_urls,
    notes,
    status
  ) VALUES (
    p_farmstand_id,
    v_user_id,
    p_requester_name,
    p_requester_email,
    COALESCE(p_evidence_urls, '{}'),
    p_notes,
    'pending'
  )
  RETURNING id INTO v_new_id;

  -- Mark farmstand as having a pending claim (non-blocking update)
  UPDATE public.farmstands
     SET claim_status = 'pending',
         updated_at   = NOW()
   WHERE id = p_farmstand_id
     AND claim_status = 'unclaimed';

  RETURN json_build_object('success', true, 'claim_request_id', v_new_id);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION submit_claim_request(UUID, TEXT, TEXT, TEXT[], TEXT) TO authenticated;

-- ============================================
-- Also ensure claim_requests has a notes column
-- (the table was originally created with "message" in some migrations)
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'claim_requests'
      AND column_name  = 'notes'
  ) THEN
    ALTER TABLE public.claim_requests ADD COLUMN notes TEXT;
  END IF;
END $$;

-- ============================================
-- Ensure the partial unique index exists so there
-- is never more than one 'pending' row per farmstand.
-- (Drop old full-table unique constraint first if present.)
-- ============================================
ALTER TABLE public.claim_requests
  DROP CONSTRAINT IF EXISTS claim_requests_farmstand_status_uq;

DROP INDEX IF EXISTS claim_requests_one_pending_per_farmstand;
CREATE UNIQUE INDEX IF NOT EXISTS claim_requests_one_pending_per_farmstand
  ON public.claim_requests(farmstand_id)
  WHERE status = 'pending';
