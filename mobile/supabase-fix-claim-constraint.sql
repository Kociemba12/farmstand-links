-- ============================================
-- FIX: Drop bad unique constraint + ALL triggers using ON CONFLICT with it
-- Run this in your Supabase SQL Editor
-- ============================================

-- 1. Drop any triggers on claim_requests that use ON CONFLICT
DROP TRIGGER IF EXISTS upsert_farmstand_on_claim_insert ON public.claim_requests;
DROP TRIGGER IF EXISTS sync_farmstand_on_claim_insert ON public.claim_requests;
DROP TRIGGER IF EXISTS claim_insert_trigger ON public.claim_requests;
DROP TRIGGER IF EXISTS on_claim_request_insert ON public.claim_requests;
DROP TRIGGER IF EXISTS update_farmstand_claim_status ON public.claim_requests;

-- 2. Drop any triggers on farmstands that use ON CONFLICT
DROP TRIGGER IF EXISTS update_claim_request_on_farmstand_update ON public.farmstands;
DROP TRIGGER IF EXISTS sync_claim_status_trigger ON public.farmstands;
DROP TRIGGER IF EXISTS claim_request_status_trigger ON public.farmstands;
DROP TRIGGER IF EXISTS on_farmstand_update ON public.farmstands;

-- 3. Drop any trigger functions that reference the old constraint
DROP FUNCTION IF EXISTS sync_claim_request_status() CASCADE;
DROP FUNCTION IF EXISTS update_claim_on_farmstand_change() CASCADE;
DROP FUNCTION IF EXISTS upsert_farmstand_on_claim() CASCADE;
DROP FUNCTION IF EXISTS sync_farmstand_claim_status() CASCADE;
DROP FUNCTION IF EXISTS handle_claim_request_insert() CASCADE;

-- 4. Drop the bad unique constraint
ALTER TABLE public.claim_requests
  DROP CONSTRAINT IF EXISTS claim_requests_farmstand_status_uq;

-- 5. Replace with a partial unique index: only one PENDING row per farmstand
DROP INDEX IF EXISTS claim_requests_one_pending_per_farmstand;
CREATE UNIQUE INDEX claim_requests_one_pending_per_farmstand
  ON public.claim_requests(farmstand_id)
  WHERE status = 'pending';

-- 6. Recreate approve_claim RPC (handles already-processed rows gracefully)
CREATE OR REPLACE FUNCTION approve_claim(p_claim_id UUID)
RETURNS JSON AS $$
DECLARE
  v_claim RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  SELECT * INTO v_claim FROM public.claim_requests WHERE id = p_claim_id;
  IF v_claim IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Claim request not found');
  END IF;
  IF v_claim.status != 'pending' THEN
    RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id, 'user_id', v_claim.user_id);
  END IF;
  UPDATE public.claim_requests
    SET status = 'approved', reviewed_at = v_now, reviewed_by_admin_id = v_admin_id
    WHERE id = p_claim_id;
  UPDATE public.farmstands
    SET claimed_by = v_claim.user_id, claimed_at = v_now, claim_status = 'claimed', updated_at = v_now
    WHERE id = v_claim.farmstand_id;
  RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id, 'user_id', v_claim.user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Recreate deny_claim RPC
CREATE OR REPLACE FUNCTION deny_claim(p_claim_id UUID)
RETURNS JSON AS $$
DECLARE
  v_claim RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  SELECT * INTO v_claim FROM public.claim_requests WHERE id = p_claim_id;
  IF v_claim IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Claim request not found');
  END IF;
  IF v_claim.status != 'pending' THEN
    RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id);
  END IF;
  UPDATE public.claim_requests
    SET status = 'denied', reviewed_at = v_now, reviewed_by_admin_id = v_admin_id
    WHERE id = p_claim_id;
  UPDATE public.farmstands
    SET claim_status = 'unclaimed', updated_at = v_now
    WHERE id = v_claim.farmstand_id AND claim_status = 'pending';
  RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Verify: list ALL remaining triggers on both tables
SELECT event_object_table, trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table IN ('farmstands', 'claim_requests')
  AND trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
