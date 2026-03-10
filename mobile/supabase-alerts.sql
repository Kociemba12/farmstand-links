-- ============================================
-- ALERTS TABLE FOR FARMSTAND APP
-- ============================================
-- Run this SQL in your Supabase SQL Editor

-- Create the alerts table
CREATE TABLE IF NOT EXISTS public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  farmstand_id UUID,  -- nullable, references farmstand if applicable
  type TEXT NOT NULL CHECK (type IN (
    'claim_request',
    'claim_approved',
    'claim_denied',
    'review_new',
    'listing_flagged',
    'platform_announcement'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ,  -- null = unread
  action_route TEXT,    -- e.g. "FarmstandDetail", "Reviews", "AdminClaims"
  action_params JSONB   -- e.g. {"farmstandId": "..."}
);

-- Create index for faster user queries
CREATE INDEX IF NOT EXISTS alerts_user_id_idx ON public.alerts(user_id);
CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON public.alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_user_unread_idx ON public.alerts(user_id) WHERE read_at IS NULL;

-- Enable Row Level Security
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only read their own alerts
CREATE POLICY "Users can read own alerts"
  ON public.alerts
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can update only their own alerts (to set read_at)
CREATE POLICY "Users can update own alerts"
  ON public.alerts
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can insert their own alerts (for self-notifications)
CREATE POLICY "Users can insert own alerts"
  ON public.alerts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Admins can insert alerts for any user (for claim approvals, etc.)
CREATE POLICY "Admins can insert alerts for any user"
  ON public.alerts
  FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'email' = 'contact@farmstand.online'
  );

-- RLS Policy: Service role can insert alerts (for backend/triggers)
-- Note: Service role bypasses RLS, so this is for documentation
-- If you need authenticated users to create alerts for others (admin),
-- you'd add specific policies

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to get unread alerts count for a user
CREATE OR REPLACE FUNCTION get_unread_alerts_count(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.alerts
  WHERE user_id = p_user_id AND read_at IS NULL;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Function to mark an alert as read
CREATE OR REPLACE FUNCTION mark_alert_as_read(p_alert_id UUID)
RETURNS VOID AS $$
  UPDATE public.alerts
  SET read_at = NOW()
  WHERE id = p_alert_id AND user_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

-- Function to mark all alerts as read for a user
CREATE OR REPLACE FUNCTION mark_all_alerts_as_read()
RETURNS VOID AS $$
  UPDATE public.alerts
  SET read_at = NOW()
  WHERE user_id = auth.uid() AND read_at IS NULL;
$$ LANGUAGE SQL SECURITY DEFINER;

-- ============================================
-- SAMPLE INSERT (for testing)
-- ============================================
-- INSERT INTO public.alerts (user_id, type, title, body, action_route, action_params)
-- VALUES (
--   'YOUR_USER_ID_HERE',
--   'platform_announcement',
--   'Welcome to Farmstand!',
--   'Thanks for joining our community. Start exploring local farmstands near you.',
--   null,
--   null
-- );
