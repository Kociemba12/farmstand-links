-- ============================================================
-- INBOX ALERTS TABLE
-- ============================================================
-- This is the table the app actually reads for user notifications.
-- The older `alerts` table was a prototype and is NOT read by the app.
--
-- Run this SQL in your Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS and DROP POLICY IF EXISTS.
--
-- IMPORTANT: If you are adding the 'claim_more_info' alert type to an
-- existing database, run these two ALTER statements FIRST:
--
--   ALTER TABLE public.inbox_alerts DROP CONSTRAINT IF EXISTS inbox_alerts_type_check;
--   ALTER TABLE public.inbox_alerts ADD CONSTRAINT inbox_alerts_type_check
--     CHECK (type IN (
--       'claim_request', 'claim_approved', 'claim_denied', 'claim_more_info',
--       'review_new', 'listing_flagged', 'platform_announcement'
--     ));
--
-- Referenced by:
--   - mobile/src/lib/alerts-store.ts (loadAlerts, markAsRead, deleteAlert)
--   - mobile/supabase-deny-and-alert.sql (admin_deny_farmstand_and_alert RPC)
--   - mobile/supabase-fix-approve-trigger.sql (approve_claim RPC)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inbox_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Notification content
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,

  -- Optional link to a farmstand
  related_farmstand_id UUID REFERENCES public.farmstands(id) ON DELETE SET NULL,

  -- Alert category — matches AlertType in alerts-store.ts
  type TEXT CHECK (type IN (
    'claim_request',
    'claim_approved',
    'claim_denied',
    'claim_more_info',
    'review_new',
    'listing_flagged',
    'platform_announcement'
  )),

  -- Deep-link navigation when tapped
  action_route     TEXT,
  action_params    JSONB,

  -- Lifecycle
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at          TIMESTAMPTZ,      -- NULL = unread
  deleted_at       TIMESTAMPTZ       -- NULL = not deleted (soft delete)
);

-- Indexes for efficient per-user queries
CREATE INDEX IF NOT EXISTS inbox_alerts_user_id_idx     ON public.inbox_alerts(user_id);
CREATE INDEX IF NOT EXISTS inbox_alerts_created_at_idx  ON public.inbox_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS inbox_alerts_unread_idx      ON public.inbox_alerts(user_id) WHERE read_at IS NULL AND deleted_at IS NULL;

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE public.inbox_alerts ENABLE ROW LEVEL SECURITY;

-- Users can read their own alerts (excluding soft-deleted)
DROP POLICY IF EXISTS "Users can read own inbox alerts" ON public.inbox_alerts;
CREATE POLICY "Users can read own inbox alerts"
  ON public.inbox_alerts FOR SELECT
  USING (auth.uid() = user_id);

-- Users can mark their own alerts as read or soft-delete them
DROP POLICY IF EXISTS "Users can update own inbox alerts" ON public.inbox_alerts;
CREATE POLICY "Users can update own inbox alerts"
  ON public.inbox_alerts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Admins (role = 'admin' in user metadata) can insert alerts for any user.
-- Used by admin_deny_farmstand_and_alert and approve_claim RPCs which run as
-- SECURITY DEFINER — those bypass RLS entirely.  This policy covers direct
-- admin inserts if ever needed from the client.
DROP POLICY IF EXISTS "Admins can insert inbox alerts" ON public.inbox_alerts;
CREATE POLICY "Admins can insert inbox alerts"
  ON public.inbox_alerts FOR INSERT
  WITH CHECK (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
  );

-- Service role bypasses RLS automatically — no extra policy needed.

-- ── Approve claim: also insert an inbox_alert ────────────────
-- The approve_claim RPC currently does NOT insert into inbox_alerts.
-- Add an alert for the owner when a farmstand is approved.
-- If approve_claim already does this in your Supabase project, skip this function.
CREATE OR REPLACE FUNCTION public.insert_claim_approved_alert(
  p_farmstand_id UUID,
  p_owner_user_id UUID,
  p_farmstand_name TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.inbox_alerts (
    user_id,
    title,
    body,
    related_farmstand_id,
    type,
    action_route
  ) VALUES (
    p_owner_user_id,
    'Farmstand approved!',
    FORMAT(
      E'Congratulations! Your Farmstand "%s" has been approved.\n\nYou now have access to Farmstand Manager and all Premium features.',
      COALESCE(p_farmstand_name, 'Your Farmstand')
    ),
    p_farmstand_id,
    'claim_approved',
    'owner/my-farmstand'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_claim_approved_alert(UUID, UUID, TEXT) TO authenticated;
