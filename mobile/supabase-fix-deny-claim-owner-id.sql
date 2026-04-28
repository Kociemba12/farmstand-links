-- ============================================================================
-- FIX: deny_claim must clear owner_id, claimed_by, claimed_at on denial.
--
-- Root cause: previous deny_claim only reset claim_status to 'unclaimed' but
-- left owner_id intact, so the farmstand continued appearing in the claimant's
-- "My Farmstand" list (which is driven by farmstands.owner_id).
--
-- Run this entire script in your Supabase SQL Editor.
-- ============================================================================

-- -----------------------------------------------------------------------
-- 1. Drop old deny_claim (single and two-param variants to be safe)
-- -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.deny_claim(UUID);
DROP FUNCTION IF EXISTS public.deny_claim(UUID, UUID);

-- -----------------------------------------------------------------------
-- 2. Recreate deny_claim — clears owner_id, claimed_by, claimed_at
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deny_claim(p_claim_id UUID)
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

  -- Idempotent: already processed
  IF v_claim.status != 'pending' THEN
    RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id);
  END IF;

  -- Mark claim as denied
  UPDATE public.claim_requests
  SET status               = 'denied',
      reviewed_at          = v_now,
      reviewed_by_admin_id = v_admin_id
  WHERE id = p_claim_id;

  -- Reset farmstand: clear owner_id, claimed_by, claimed_at so it no longer
  -- appears in the claimant's profile. claim_status goes back to 'unclaimed'.
  -- No WHERE guard on claim_status so this always fires.
  UPDATE public.farmstands
  SET owner_id     = NULL,
      claimed_by   = NULL,
      claimed_at   = NULL,
      claim_status = 'unclaimed',
      updated_at   = v_now
  WHERE id = v_claim.farmstand_id;

  RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id);
END;
$$;

-- -----------------------------------------------------------------------
-- 3. Re-confirm approve_claim is correct (sets owner_id on approve)
-- -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.approve_claim(UUID);
DROP FUNCTION IF EXISTS public.approve_claim(UUID, UUID);

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

  -- Update farmstand: set both owner_id and claimed_by (owner_id is authoritative)
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

-- -----------------------------------------------------------------------
-- 4. Grant execute to authenticated users and service role
-- -----------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.deny_claim(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_claim(UUID)    TO service_role;

-- -----------------------------------------------------------------------
-- 5. Verify the functions exist
-- -----------------------------------------------------------------------
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('approve_claim', 'deny_claim');
