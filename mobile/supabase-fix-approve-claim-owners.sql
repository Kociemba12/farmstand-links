-- ============================================================================
-- FIX: approve_claim must INSERT into farmstand_owners.
--
-- Root cause: fetchUserFarmstandsFromSupabase in bootstrap-store.ts queries
-- farmstand_owners JOIN farmstands as the sole ownership source.
-- The previous approve_claim only updated farmstands.owner_id / claimed_by,
-- which that query never reads.
--
-- This version adds the farmstand_owners INSERT so approved claimants see
-- their farmstand in Profile / My Farmstand immediately.
--
-- Does NOT grant premium — premium only starts when the user explicitly taps
-- "Start Trial" in the app.
--
-- Run in Supabase SQL Editor.
-- ============================================================================

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

  -- Idempotent: already approved — still ensure farmstand_owners row exists
  IF v_claim.status != 'pending' THEN
    INSERT INTO public.farmstand_owners (user_id, farmstand_id, is_approved, is_active)
    SELECT v_claim.user_id::text, v_claim.farmstand_id::text, true, true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.farmstand_owners
      WHERE user_id      = v_claim.user_id::text
        AND farmstand_id = v_claim.farmstand_id::text
    );
    RETURN json_build_object(
      'success',      true,
      'farmstand_id', v_claim.farmstand_id,
      'user_id',      v_claim.user_id
    );
  END IF;

  -- Mark claim as approved
  UPDATE public.claim_requests
  SET status               = 'approved',
      reviewed_at          = v_now,
      reviewed_by_admin_id = v_admin_id
  WHERE id = p_claim_id;

  -- Update farmstand: set ownership fields only.
  -- Premium is NOT granted here — user must explicitly start the free trial.
  UPDATE public.farmstands
  SET owner_id     = v_claim.user_id,
      claimed_by   = v_claim.user_id,
      claimed_at   = v_now,
      claim_status = 'claimed',
      updated_at   = v_now
  WHERE id = v_claim.farmstand_id;

  -- Insert into farmstand_owners so the profile join query finds this farmstand.
  -- bootstrap-store.ts queries farmstand_owners exclusively — it never reads
  -- farmstands.owner_id or farmstands.claimed_by for ownership determination.
  INSERT INTO public.farmstand_owners (user_id, farmstand_id, is_approved, is_active)
  SELECT v_claim.user_id::text, v_claim.farmstand_id::text, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.farmstand_owners
    WHERE user_id      = v_claim.user_id::text
      AND farmstand_id = v_claim.farmstand_id::text
  );

  RETURN json_build_object(
    'success',      true,
    'farmstand_id', v_claim.farmstand_id,
    'user_id',      v_claim.user_id
  );
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID) TO service_role;
