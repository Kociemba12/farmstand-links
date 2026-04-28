-- ============================================================================
-- FIX: approve_claim must NOT grant premium on claim approval.
--
-- Premium should only be set after the user explicitly starts a
-- trial/subscription via the "Start 3-Month Free Trial" button in the app.
-- Claiming a farmstand only grants ownership — not premium access.
--
-- Run this entire script in your Supabase SQL Editor.
-- ============================================================================

-- Replace approve_claim with a version that only sets ownership fields.
-- Does NOT touch premium_status, premium_trial_started_at, or premium_trial_expires_at.
CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim    RECORD;
  v_now      TIMESTAMPTZ := NOW();
  v_admin_id UUID        := auth.uid();
BEGIN
  SELECT * INTO v_claim
  FROM public.claim_requests
  WHERE id = p_claim_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Claim request not found');
  END IF;

  -- Idempotent: already approved
  IF v_claim.status != 'pending' THEN
    RETURN json_build_object(
      'success', true,
      'farmstand_id', v_claim.farmstand_id,
      'user_id', v_claim.user_id
    );
  END IF;

  -- Mark claim as approved
  UPDATE public.claim_requests
  SET status               = 'approved',
      reviewed_at          = v_now,
      reviewed_by_admin_id = v_admin_id
  WHERE id = p_claim_id;

  -- Update farmstand: set ownership only.
  -- Premium is NOT granted here. The user must explicitly start the free trial
  -- through the app after claiming their farmstand.
  UPDATE public.farmstands
  SET owner_id     = v_claim.user_id,
      claimed_by   = v_claim.user_id,
      claimed_at   = v_now,
      claim_status = 'claimed',
      updated_at   = v_now
  WHERE id = v_claim.farmstand_id;

  RETURN json_build_object(
    'success', true,
    'farmstand_id', v_claim.farmstand_id,
    'user_id', v_claim.user_id
  );
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID) TO service_role;
