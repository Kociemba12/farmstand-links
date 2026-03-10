-- ============================================
-- FIX: Ensure submit_claim_request RPC and DELETE policy exist
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Allow users to delete their own pending claim requests
DROP POLICY IF EXISTS "Users can delete own claim requests" ON public.claim_requests;
CREATE POLICY "Users can delete own claim requests"
  ON public.claim_requests
  FOR DELETE
  USING (auth.uid() = user_id);

-- 2. Ensure claim_requests has a notes column
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

-- 3. Ensure the partial unique index exists (one pending row per farmstand)
ALTER TABLE public.claim_requests
  DROP CONSTRAINT IF EXISTS claim_requests_farmstand_status_uq;

DROP INDEX IF EXISTS claim_requests_one_pending_per_farmstand;
CREATE UNIQUE INDEX IF NOT EXISTS claim_requests_one_pending_per_farmstand
  ON public.claim_requests(farmstand_id)
  WHERE status = 'pending';

-- 4. Create/replace the submit_claim_request RPC (SECURITY DEFINER bypasses RLS)
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
      AND (claim_status IS NULL OR claim_status IN ('unclaimed', 'pending'))
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

  -- Mark farmstand as having a pending claim
  UPDATE public.farmstands
     SET claim_status = 'pending',
         updated_at   = NOW()
   WHERE id = p_farmstand_id
     AND (claim_status IS NULL OR claim_status = 'unclaimed');

  RETURN json_build_object('success', true, 'claim_request_id', v_new_id);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION submit_claim_request(UUID, TEXT, TEXT, TEXT[], TEXT) TO authenticated;
