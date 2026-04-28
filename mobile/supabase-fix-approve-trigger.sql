-- ============================================================================
-- FIX: Drop ALL stale triggers on claim_requests + farmstands,
--      then recreate approve_claim / deny_claim with correct column names.
--
-- Root cause: an old trigger referenced NEW.requester_user_id which does not
-- exist (the column is user_id). This script nukes every trigger on both
-- tables and redeploys clean single-param RPCs.
--
-- Run this entire script in your Supabase SQL Editor.
-- ============================================================================

-- -----------------------------------------------------------------------
-- 1. Drop every known (and possible) trigger on claim_requests
-- -----------------------------------------------------------------------
DROP TRIGGER IF EXISTS upsert_farmstand_on_claim_insert     ON public.claim_requests;
DROP TRIGGER IF EXISTS sync_farmstand_on_claim_insert       ON public.claim_requests;
DROP TRIGGER IF EXISTS claim_insert_trigger                 ON public.claim_requests;
DROP TRIGGER IF EXISTS on_claim_request_insert              ON public.claim_requests;
DROP TRIGGER IF EXISTS update_farmstand_claim_status        ON public.claim_requests;
DROP TRIGGER IF EXISTS handle_claim_insert                  ON public.claim_requests;
DROP TRIGGER IF EXISTS after_claim_insert                   ON public.claim_requests;
DROP TRIGGER IF EXISTS before_claim_insert                  ON public.claim_requests;
DROP TRIGGER IF EXISTS claim_request_trigger                ON public.claim_requests;
DROP TRIGGER IF EXISTS claim_status_trigger                 ON public.claim_requests;
DROP TRIGGER IF EXISTS sync_claim_status                    ON public.claim_requests;
DROP TRIGGER IF EXISTS farmstand_claim_trigger              ON public.claim_requests;

-- -----------------------------------------------------------------------
-- 2. Drop every known (and possible) trigger on farmstands
-- -----------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_claim_request_on_farmstand_update ON public.farmstands;
DROP TRIGGER IF EXISTS sync_claim_status_trigger                ON public.farmstands;
DROP TRIGGER IF EXISTS claim_request_status_trigger             ON public.farmstands;
DROP TRIGGER IF EXISTS on_farmstand_update                      ON public.farmstands;
DROP TRIGGER IF EXISTS farmstand_update_trigger                 ON public.farmstands;

-- -----------------------------------------------------------------------
-- 3. Drop all trigger functions that may reference requester_user_id
-- -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS sync_claim_request_status()            CASCADE;
DROP FUNCTION IF EXISTS update_claim_on_farmstand_change()     CASCADE;
DROP FUNCTION IF EXISTS upsert_farmstand_on_claim()            CASCADE;
DROP FUNCTION IF EXISTS sync_farmstand_claim_status()          CASCADE;
DROP FUNCTION IF EXISTS handle_claim_request_insert()          CASCADE;
DROP FUNCTION IF EXISTS handle_claim_insert()                  CASCADE;
DROP FUNCTION IF EXISTS after_claim_insert_fn()                CASCADE;
DROP FUNCTION IF EXISTS claim_request_insert_fn()              CASCADE;

-- -----------------------------------------------------------------------
-- 4. Drop old overloaded approve_claim / deny_claim variants (2-param)
-- -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.approve_claim(UUID, UUID);
DROP FUNCTION IF EXISTS public.deny_claim(UUID, UUID);

-- -----------------------------------------------------------------------
-- 5. Recreate approve_claim — single param, uses auth.uid() for admin,
--    sets BOTH claimed_by AND owner_id so both old and new code works.
-- -----------------------------------------------------------------------
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
  SET status              = 'approved',
      reviewed_at         = v_now,
      reviewed_by_admin_id = v_admin_id
  WHERE id = p_claim_id;

  -- Update farmstand: set both owner_id and claimed_by
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
-- 6. Recreate deny_claim — single param
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
  SET status              = 'denied',
      reviewed_at         = v_now,
      reviewed_by_admin_id = v_admin_id
  WHERE id = p_claim_id;

  -- Reset farmstand claim_status only if it was still pending
  UPDATE public.farmstands
  SET claim_status = 'unclaimed',
      updated_at   = v_now
  WHERE id = v_claim.farmstand_id
    AND claim_status = 'pending';

  RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id);
END;
$$;

-- -----------------------------------------------------------------------
-- 7. Grant execute to authenticated users and service role
-- -----------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_claim(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.deny_claim(UUID)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_claim(UUID)    TO service_role;

-- -----------------------------------------------------------------------
-- 8. Verify: confirm NO triggers remain on these tables
-- -----------------------------------------------------------------------
SELECT event_object_table, trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table IN ('farmstands', 'claim_requests')
  AND trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
