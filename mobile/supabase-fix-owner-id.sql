-- =============================================================================
-- FIX: Set owner_id for all farmstands that have an approved claim
-- =============================================================================
-- Background: approve_claim RPC was setting claimed_by but NOT owner_id.
-- The frontend now uses owner_id as the authoritative ownership column.
-- This script backfills owner_id from claim_requests.user_id for all
-- farmstands where an approved claim exists but owner_id is NULL.
-- =============================================================================

-- 1. Backfill owner_id from claim_requests for approved claims
UPDATE public.farmstands f
SET owner_id = cr.user_id,
    updated_at = NOW()
FROM public.claim_requests cr
WHERE cr.farmstand_id = f.id
  AND cr.status = 'approved'
  AND f.owner_id IS NULL
  AND f.claimed_by IS NOT NULL;

-- 2. Also sync: if claimed_by is set but owner_id is still NULL (edge case)
UPDATE public.farmstands
SET owner_id = claimed_by,
    updated_at = NOW()
WHERE claimed_by IS NOT NULL
  AND owner_id IS NULL;

-- 3. Confirm claim_status is 'claimed' for all farmstands with owner_id set
UPDATE public.farmstands
SET claim_status = 'claimed',
    updated_at = NOW()
WHERE owner_id IS NOT NULL
  AND claim_status != 'claimed';

-- 4. Update approve_claim RPC to also set owner_id going forward
DROP FUNCTION IF EXISTS public.approve_claim(UUID, UUID);

CREATE OR REPLACE FUNCTION public.approve_claim(p_claim_id UUID, p_admin_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_admin_id UUID := p_admin_id;
BEGIN
  -- Get the claim request
  SELECT * INTO v_claim FROM public.claim_requests WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Claim not found');
  END IF;

  -- Update claim_requests: mark as approved
  UPDATE public.claim_requests
    SET status = 'approved', reviewed_at = v_now, reviewed_by_admin_id = v_admin_id
    WHERE id = p_claim_id;

  -- Update farmstand: set owner_id AND claimed_by, plus claim_status = 'claimed'
  UPDATE public.farmstands
    SET owner_id    = v_claim.user_id,
        claimed_by  = v_claim.user_id,
        claimed_at  = v_now,
        claim_status = 'claimed',
        updated_at  = v_now
    WHERE id = v_claim.farmstand_id;

  RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id, 'user_id', v_claim.user_id);
END;
$$;

-- 5. Update deny_claim RPC to clear owner_id on denial (in case it was set)
DROP FUNCTION IF EXISTS public.deny_claim(UUID, UUID);

CREATE OR REPLACE FUNCTION public.deny_claim(p_claim_id UUID, p_admin_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_admin_id UUID := p_admin_id;
BEGIN
  -- Get the claim request
  SELECT * INTO v_claim FROM public.claim_requests WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Claim not found');
  END IF;

  -- Update claim_requests: mark as denied
  UPDATE public.claim_requests
    SET status = 'denied', reviewed_at = v_now, reviewed_by_admin_id = v_admin_id
    WHERE id = p_claim_id;

  -- Reset farmstand claim status ONLY if it was pending (not already claimed by someone else)
  UPDATE public.farmstands
    SET claim_status = 'unclaimed',
        updated_at   = v_now
    WHERE id = v_claim.farmstand_id
      AND claim_status = 'pending';

  RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id);
END;
$$;

-- Grant execute on RPCs to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.deny_claim(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_claim(UUID, UUID) TO service_role;
