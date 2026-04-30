-- ============================================================================
-- Unread admin reply tracking for support tickets
--
-- Adds last_user_read_at to public.feedback so the app can badge unread
-- admin replies on the Profile tab, Support row, My Tickets card, and
-- individual ticket list items.
--
-- Run in Supabase SQL Editor after supabase-feedback-messages.sql.
-- ============================================================================

-- ── 1. Column on feedback ────────────────────────────────────────────────────

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS last_user_read_at TIMESTAMPTZ;

-- ── 2. get_unread_support_info RPC ────────────────────────────────────────────
-- Returns { count: int, ticket_ids: text[] } of tickets that have at least
-- one admin message newer than last_user_read_at (or any admin message when
-- last_user_read_at is null).
-- SECURITY DEFINER so it can read feedback and feedback_messages for the caller.

CREATE OR REPLACE FUNCTION public.get_unread_support_info()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id UUID  := auth.uid();
  v_ticket_ids TEXT[];
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN json_build_object('count', 0, 'ticket_ids', ARRAY[]::TEXT[]);
  END IF;

  SELECT ARRAY_AGG(DISTINCT fm.feedback_id) INTO v_ticket_ids
  FROM public.feedback_messages fm
  JOIN public.feedback f ON f.id::text = fm.feedback_id
  WHERE f.user_id          = v_caller_id::text
    AND fm.sender_role     = 'admin'
    AND fm.is_visible_to_farmer = true
    AND (f.last_user_read_at IS NULL OR fm.created_at > f.last_user_read_at);

  RETURN json_build_object(
    'count',      COALESCE(array_length(v_ticket_ids, 1), 0),
    'ticket_ids', COALESCE(v_ticket_ids, ARRAY[]::TEXT[])
  );
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('count', 0, 'ticket_ids', ARRAY[]::TEXT[]);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_support_info() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_support_info() TO service_role;

-- ── 3. mark_support_ticket_read RPC ─────────────────────────────────────────
-- Stamps last_user_read_at = now() on the feedback row the caller owns.
-- No-op when called for a ticket the caller doesn't own (safe).

DROP FUNCTION IF EXISTS public.mark_support_ticket_read(TEXT);

CREATE FUNCTION public.mark_support_ticket_read(p_ticket_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT := auth.uid()::text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  UPDATE public.feedback
  SET last_user_read_at = now()
  WHERE id::text = p_ticket_id
    AND user_id   = v_user_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_support_ticket_read(TEXT) TO authenticated;

-- ── Verification ─────────────────────────────────────────────────────────────

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'feedback'
  AND column_name  = 'last_user_read_at';
