-- Premium Trial System
-- Run this in the Supabase SQL editor to add premium trial fields to farmstands

-- 1. Add premium trial columns to farmstands table
ALTER TABLE farmstands
  ADD COLUMN IF NOT EXISTS premium_status TEXT DEFAULT 'free' CHECK (premium_status IN ('free', 'trial', 'active', 'expired')),
  ADD COLUMN IF NOT EXISTS premium_trial_started_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS premium_trial_expires_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Update the approve_claim function to set premium trial dates on approval
-- This replaces or modifies the existing approve_claim RPC to also set trial fields

CREATE OR REPLACE FUNCTION approve_claim(p_claim_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_trial_expires TIMESTAMPTZ := NOW() + INTERVAL '3 months';
BEGIN
  -- Fetch the claim
  SELECT * INTO v_claim
  FROM claim_requests
  WHERE id = p_claim_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Claim not found');
  END IF;

  -- Update the claim status
  UPDATE claim_requests
  SET
    status = 'approved',
    reviewed_at = v_now
  WHERE id = p_claim_id;

  -- Update the farmstand: set owner and premium trial
  UPDATE farmstands
  SET
    claim_status = 'claimed',
    owner_id = v_claim.user_id,
    claimed_by = v_claim.user_id,
    claimed_at = v_now,
    updated_at = v_now,
    -- Premium trial fields
    premium_status = 'trial',
    premium_trial_started_at = v_now,
    premium_trial_expires_at = v_trial_expires
  WHERE id = v_claim.farmstand_id;

  RETURN json_build_object('success', true);
END;
$$;

-- 3. Grant execute to authenticated users (admin checks are in app logic)
GRANT EXECUTE ON FUNCTION approve_claim(UUID) TO authenticated;
