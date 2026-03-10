-- ============================================================
-- Farmstand Push Notifications — Supabase SQL
-- Run this in your Supabase SQL editor (Dashboard → SQL editor)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. user_push_tokens
--    Stores Expo push tokens per user per device.
--    One user can have multiple devices.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  device_os     text NOT NULL DEFAULT 'ios', -- 'ios' | 'android' | 'web'
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- One token per user+OS combo (a new token from the same device replaces the old one)
  UNIQUE (user_id, device_os)
);

-- Index for fast per-user lookups (used by push-sender.ts)
CREATE INDEX IF NOT EXISTS user_push_tokens_user_id_idx ON public.user_push_tokens (user_id);

-- RLS: users can only read/write their own tokens
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own push tokens"
  ON public.user_push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypasses RLS automatically — backend can read all tokens for push delivery.


-- ─────────────────────────────────────────────────────────────
-- 2. user_notification_prefs
--    Per-user notification preference flags.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_notification_prefs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  messages            boolean NOT NULL DEFAULT true,
  new_farmstands      boolean NOT NULL DEFAULT true,
  seasonal_products   boolean NOT NULL DEFAULT true,
  saved_farm_updates  boolean NOT NULL DEFAULT true,
  promotions          boolean NOT NULL DEFAULT false,
  app_updates         boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own notification prefs"
  ON public.user_notification_prefs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────
-- 3. user_saved_farmstands  (optional — only needed if you want
--    the backend to look up savers automatically)
--
--    If favorites are stored only in AsyncStorage on device,
--    skip this table and always pass notify_user_ids explicitly
--    when calling /api/send-saved-stand-push.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_saved_farmstands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  farmstand_id  uuid NOT NULL,
  saved_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, farmstand_id)
);

CREATE INDEX IF NOT EXISTS user_saved_farmstands_farmstand_id_idx
  ON public.user_saved_farmstands (farmstand_id);

ALTER TABLE public.user_saved_farmstands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own saved farmstands"
  ON public.user_saved_farmstands
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────
-- 4. inbox_alerts  (already exists — verify these columns exist)
--    If your table already has all these columns, skip this block.
-- ─────────────────────────────────────────────────────────────
-- CREATE TABLE IF NOT EXISTS public.inbox_alerts (
--   id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
--   farmstand_id   uuid,
--   type           text,
--   title          text NOT NULL,
--   body           text NOT NULL,
--   action_route   text,
--   action_params  jsonb,
--   read_at        timestamptz,
--   deleted_at     timestamptz,
--   created_at     timestamptz NOT NULL DEFAULT now()
-- );
--
-- ALTER TABLE public.inbox_alerts ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY "Users can read their own alerts"
--   ON public.inbox_alerts FOR SELECT
--   USING (auth.uid() = user_id);
--
-- CREATE POLICY "Users can update their own alerts"
--   ON public.inbox_alerts FOR UPDATE
--   USING (auth.uid() = user_id);
-- (INSERT/DELETE use service role key from backend — no client policy needed)
