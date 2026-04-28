-- ============================================================
-- PREMIUM TRIAL REMINDERS
-- ============================================================
-- Run this in the Supabase SQL Editor (once).
-- Adds:
--   1. premium_trial_reminder to the inbox_alerts type constraint
--   2. trial_reminder_log table to prevent duplicate reminders
-- ============================================================

-- ── 1. Expand inbox_alerts type CHECK constraint ─────────────
-- Drop the old constraint and recreate it with the new type.
ALTER TABLE public.inbox_alerts
  DROP CONSTRAINT IF EXISTS inbox_alerts_type_check;

ALTER TABLE public.inbox_alerts
  ADD CONSTRAINT inbox_alerts_type_check CHECK (type IN (
    'claim_request',
    'claim_approved',
    'claim_denied',
    'review_new',
    'listing_flagged',
    'platform_announcement',
    'premium_approved',
    'premium_expired',
    'premium_downgraded',
    'premium_trial_reminder',
    'review_reply',
    'listing_attention',
    'listing_hidden',
    'report_received',
    'report_resolved',
    'app_notice',
    'message',
    'farmstand_update',
    'info',
    'action_required'
  ));

-- ── 2. Create trial_reminder_log table ───────────────────────
-- Tracks which reminder milestones have been sent per farmstand
-- so the backend scheduler never sends the same reminder twice.
CREATE TABLE IF NOT EXISTS public.trial_reminder_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmstand_id  UUID NOT NULL REFERENCES public.farmstands(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  days_before   INTEGER NOT NULL, -- e.g. 14, 7, 3, 1, 0
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One reminder per farmstand per milestone
  CONSTRAINT trial_reminder_log_unique UNIQUE (farmstand_id, days_before)
);

-- Only the service role (backend) needs to access this table.
-- No client-side RLS policies are required since users never read/write it directly.
ALTER TABLE public.trial_reminder_log ENABLE ROW LEVEL SECURITY;

-- Index for fast lookups by (farmstand_id, days_before)
CREATE INDEX IF NOT EXISTS trial_reminder_log_farmstand_idx
  ON public.trial_reminder_log (farmstand_id, days_before);
