-- Push Notifications Tables for Farmstand App
-- Run this in your Supabase SQL Editor

-- =============================================
-- Table: user_push_tokens
-- Stores Expo push tokens for each user/device
-- =============================================
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  device_os TEXT NOT NULL CHECK (device_os IN ('ios', 'android', 'web')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One token per user per device OS
  UNIQUE(user_id, device_os)
);

-- Index for looking up tokens by user
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id
  ON public.user_push_tokens(user_id);

-- Index for finding stale tokens
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_last_seen
  ON public.user_push_tokens(last_seen_at);

-- =============================================
-- Table: user_notification_prefs
-- Stores notification preferences for each user
-- =============================================
CREATE TABLE IF NOT EXISTS public.user_notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,

  -- Notification toggles
  messages BOOLEAN NOT NULL DEFAULT true,           -- In-app message notifications (most important)
  new_farmstands BOOLEAN NOT NULL DEFAULT true,     -- New farm stands near you
  seasonal_products BOOLEAN NOT NULL DEFAULT true,  -- Seasonal produce alerts
  saved_farm_updates BOOLEAN NOT NULL DEFAULT true, -- Updates from saved farmstands
  promotions BOOLEAN NOT NULL DEFAULT false,        -- Special offers/deals
  app_updates BOOLEAN NOT NULL DEFAULT true,        -- New features

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for looking up prefs by user
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user_id
  ON public.user_notification_prefs(user_id);

-- =============================================
-- Row Level Security (RLS) Policies
-- =============================================

-- Enable RLS on both tables
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_prefs ENABLE ROW LEVEL SECURITY;

-- user_push_tokens policies
-- Users can only see/manage their own tokens
CREATE POLICY "Users can view own push tokens"
  ON public.user_push_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push tokens"
  ON public.user_push_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push tokens"
  ON public.user_push_tokens FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own push tokens"
  ON public.user_push_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- user_notification_prefs policies
-- Users can only see/manage their own preferences
CREATE POLICY "Users can view own notification prefs"
  ON public.user_notification_prefs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification prefs"
  ON public.user_notification_prefs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification prefs"
  ON public.user_notification_prefs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notification prefs"
  ON public.user_notification_prefs FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================
-- Service role policy for backend sending notifications
-- (Needed when backend needs to look up tokens for a user)
-- =============================================

-- Allow service role to read all tokens (for sending notifications)
CREATE POLICY "Service role can read all push tokens"
  ON public.user_push_tokens FOR SELECT
  TO service_role
  USING (true);

-- Allow service role to read all prefs (to check if user wants messages)
CREATE POLICY "Service role can read all notification prefs"
  ON public.user_notification_prefs FOR SELECT
  TO service_role
  USING (true);

-- =============================================
-- Helper function to get push tokens for a user
-- Use this in your backend to send notifications
-- =============================================
CREATE OR REPLACE FUNCTION public.get_user_push_tokens(target_user_id UUID)
RETURNS TABLE (
  expo_push_token TEXT,
  device_os TEXT,
  messages_enabled BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.expo_push_token,
    t.device_os,
    COALESCE(p.messages, true) as messages_enabled
  FROM public.user_push_tokens t
  LEFT JOIN public.user_notification_prefs p ON p.user_id = t.user_id
  WHERE t.user_id = target_user_id
    AND t.last_seen_at > NOW() - INTERVAL '30 days';  -- Only active tokens
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.get_user_push_tokens(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_push_tokens(UUID) TO service_role;

-- =============================================
-- Trigger to update updated_at on prefs change
-- =============================================
CREATE OR REPLACE FUNCTION public.update_notification_prefs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_notification_prefs_timestamp
  BEFORE UPDATE ON public.user_notification_prefs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_notification_prefs_updated_at();

-- =============================================
-- Comments for documentation
-- =============================================
COMMENT ON TABLE public.user_push_tokens IS 'Stores Expo push tokens for sending notifications to users';
COMMENT ON TABLE public.user_notification_prefs IS 'Stores user preferences for which notifications they want to receive';
COMMENT ON FUNCTION public.get_user_push_tokens IS 'Returns active push tokens for a user, with their message notification preference';
