-- ============================================
-- CLAIM REQUESTS TABLE FOR FARMSTAND APP
-- ============================================
-- Run this SQL in your Supabase SQL Editor

-- Create the claim_requests table with requester info stored directly
-- (no need to query users table for requester details)
CREATE TABLE IF NOT EXISTS public.claim_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmstand_id UUID NOT NULL REFERENCES public.farmstands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Requester info stored directly (source of truth - no join to users table needed)
  requester_email TEXT NOT NULL,
  requester_name TEXT,
  requester_role TEXT DEFAULT 'owner' CHECK (requester_role IN ('owner', 'manager')),
  -- Claim details
  message TEXT,
  evidence_urls TEXT[], -- Array of photo URLs for proof
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'needs_more_info')),
  admin_note TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_admin_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS claim_requests_farmstand_id_idx ON public.claim_requests(farmstand_id);
CREATE INDEX IF NOT EXISTS claim_requests_user_id_idx ON public.claim_requests(user_id);
CREATE INDEX IF NOT EXISTS claim_requests_status_idx ON public.claim_requests(status);
CREATE INDEX IF NOT EXISTS claim_requests_pending_idx ON public.claim_requests(created_at DESC) WHERE status = 'pending';

-- Enable Row Level Security
ALTER TABLE public.claim_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read their own claim requests
DROP POLICY IF EXISTS "Users can read own claim requests" ON public.claim_requests;
CREATE POLICY "Users can read own claim requests"
  ON public.claim_requests
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own claim requests
DROP POLICY IF EXISTS "Users can insert own claim requests" ON public.claim_requests;
CREATE POLICY "Users can insert own claim requests"
  ON public.claim_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Admins can read all claim requests (based on email)
DROP POLICY IF EXISTS "Admins can read all claim requests" ON public.claim_requests;
CREATE POLICY "Admins can read all claim requests"
  ON public.claim_requests
  FOR SELECT
  USING (
    auth.jwt() ->> 'email' IN ('contact@farmstand.online', 'joekociemba@gmail.com')
  );

-- RLS Policy: Admins can update claim requests (to approve/deny)
DROP POLICY IF EXISTS "Admins can update claim requests" ON public.claim_requests;
CREATE POLICY "Admins can update claim requests"
  ON public.claim_requests
  FOR UPDATE
  USING (
    auth.jwt() ->> 'email' IN ('contact@farmstand.online', 'joekociemba@gmail.com')
  );

-- RLS Policy: Users can delete their own pending claim requests
DROP POLICY IF EXISTS "Users can delete own claim requests" ON public.claim_requests;
CREATE POLICY "Users can delete own claim requests"
  ON public.claim_requests
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- ADD MISSING COLUMNS TO EXISTING TABLE
-- ============================================
-- Run these ALTER statements if the table already exists
DO $$
BEGIN
  -- Add requester_email if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'claim_requests' AND column_name = 'requester_email'
  ) THEN
    ALTER TABLE public.claim_requests ADD COLUMN requester_email TEXT;
  END IF;

  -- Add requester_name if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'claim_requests' AND column_name = 'requester_name'
  ) THEN
    ALTER TABLE public.claim_requests ADD COLUMN requester_name TEXT;
  END IF;

  -- Add requester_role if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'claim_requests' AND column_name = 'requester_role'
  ) THEN
    ALTER TABLE public.claim_requests ADD COLUMN requester_role TEXT DEFAULT 'owner';
  END IF;

  -- Add message if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'claim_requests' AND column_name = 'message'
  ) THEN
    ALTER TABLE public.claim_requests ADD COLUMN message TEXT;
  END IF;

  -- Add evidence_urls if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'claim_requests' AND column_name = 'evidence_urls'
  ) THEN
    ALTER TABLE public.claim_requests ADD COLUMN evidence_urls TEXT[];
  END IF;
END $$;

-- ============================================
-- ADD claim_status COLUMN TO FARMSTANDS TABLE
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'farmstands'
    AND column_name = 'claim_status'
  ) THEN
    ALTER TABLE public.farmstands ADD COLUMN claim_status TEXT DEFAULT 'unclaimed';
  END IF;
END $$;

-- ============================================
-- RPC: APPROVE CLAIM REQUEST
-- ============================================
-- Call with: supabase.rpc('approve_claim', { p_claim_id: claimId })
CREATE OR REPLACE FUNCTION approve_claim(p_claim_id UUID)
RETURNS JSON AS $$
DECLARE
  v_claim RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_admin_id UUID;
BEGIN
  -- Get current user ID (admin)
  v_admin_id := auth.uid();

  -- Get the claim request
  SELECT * INTO v_claim FROM public.claim_requests WHERE id = p_claim_id;

  IF v_claim IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Claim request not found');
  END IF;

  IF v_claim.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Claim request is not pending');
  END IF;

  -- Update claim request status to approved
  UPDATE public.claim_requests
  SET status = 'approved',
      reviewed_at = v_now,
      reviewed_by_admin_id = v_admin_id
  WHERE id = p_claim_id;

  -- Update farmstand: set claimed_by to the requester's user_id
  UPDATE public.farmstands
  SET claimed_by = v_claim.user_id,
      claimed_at = v_now,
      claim_status = 'claimed',
      updated_at = v_now
  WHERE id = v_claim.farmstand_id;

  RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id, 'user_id', v_claim.user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- RPC: DENY CLAIM REQUEST
-- ============================================
-- Call with: supabase.rpc('deny_claim', { p_claim_id: claimId })
CREATE OR REPLACE FUNCTION deny_claim(p_claim_id UUID)
RETURNS JSON AS $$
DECLARE
  v_claim RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_admin_id UUID;
BEGIN
  -- Get current user ID (admin)
  v_admin_id := auth.uid();

  -- Get the claim request
  SELECT * INTO v_claim FROM public.claim_requests WHERE id = p_claim_id;

  IF v_claim IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Claim request not found');
  END IF;

  IF v_claim.status != 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Claim request is not pending');
  END IF;

  -- Update claim request status to denied
  UPDATE public.claim_requests
  SET status = 'denied',
      reviewed_at = v_now,
      reviewed_by_admin_id = v_admin_id
  WHERE id = p_claim_id;

  -- Reset farmstand claim_status to unclaimed (if it was pending)
  UPDATE public.farmstands
  SET claim_status = 'unclaimed',
      updated_at = v_now
  WHERE id = v_claim.farmstand_id
    AND claim_status = 'pending';

  RETURN json_build_object('success', true, 'farmstand_id', v_claim.farmstand_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- HELPER FUNCTION: Get pending claim requests count
-- ============================================
CREATE OR REPLACE FUNCTION get_pending_claim_requests_count()
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.claim_requests
  WHERE status = 'pending';
$$ LANGUAGE SQL SECURITY DEFINER;
