-- ============================================================================
-- feedback_messages — reply thread for support tickets
--
-- Stores admin and farmer replies on feedback/support rows.
-- Both the admin Feedback & Support screen and the user My Tickets thread
-- read/write this table so replies are visible on both sides.
--
-- Run in Supabase SQL Editor.
-- ============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.feedback_messages (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id          UUID        NOT NULL,
  sender_role          TEXT        NOT NULL CHECK (sender_role IN ('admin', 'farmer')),
  sender_user_id       TEXT,
  sender_email         TEXT,
  message_text         TEXT        NOT NULL DEFAULT '',
  attachment_urls      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_visible_to_farmer BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_messages_feedback_id
  ON public.feedback_messages(feedback_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.feedback_messages ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (backend reads if needed)
DROP POLICY IF EXISTS "service_all_feedback_messages" ON public.feedback_messages;
CREATE POLICY "service_all_feedback_messages"
  ON public.feedback_messages FOR ALL TO service_role
  USING (true);

-- Authenticated users can SELECT messages for tickets they own
DROP POLICY IF EXISTS "users_select_own_feedback_messages" ON public.feedback_messages;
CREATE POLICY "users_select_own_feedback_messages"
  ON public.feedback_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.feedback
      WHERE feedback.id = feedback_messages.feedback_id
        AND feedback.user_id = auth.uid()::text
    )
  );

-- ── add_feedback_reply RPC ───────────────────────────────────────────────────
--
-- SECURITY DEFINER so it can bypass RLS for the INSERT.
-- Caller must be authenticated. Authorization (admin vs. ticket owner) is
-- enforced in the mobile app (AdminGuard / session check).

CREATE OR REPLACE FUNCTION public.add_feedback_reply(
  p_feedback_id       UUID,
  p_sender_role       TEXT,
  p_sender_user_id    TEXT,
  p_sender_email      TEXT,
  p_message_text      TEXT,
  p_attachment_urls   TEXT[]  DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_new_id    UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.feedback WHERE id = p_feedback_id) THEN
    RETURN json_build_object('success', false, 'error', 'Ticket not found');
  END IF;

  IF trim(COALESCE(p_message_text, '')) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Message is required');
  END IF;

  INSERT INTO public.feedback_messages (
    feedback_id,
    sender_role,
    sender_user_id,
    sender_email,
    message_text,
    attachment_urls,
    is_visible_to_farmer
  ) VALUES (
    p_feedback_id,
    p_sender_role,
    p_sender_user_id,
    p_sender_email,
    trim(p_message_text),
    COALESCE(p_attachment_urls, ARRAY[]::TEXT[]),
    true
  )
  RETURNING id INTO v_new_id;

  RETURN json_build_object('success', true, 'id', v_new_id);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_feedback_reply(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_feedback_reply(UUID, TEXT, TEXT, TEXT, TEXT, TEXT[])
  TO service_role;
