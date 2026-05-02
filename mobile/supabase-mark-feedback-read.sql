-- ============================================================================
-- mark_feedback_read(p_ticket_id text)
--
-- Marks a feedback row as 'read' only when its current status is 'new'.
-- Uses SECURITY DEFINER so it runs with elevated privileges and bypasses
-- the RLS policy that silently blocks direct client UPDATE statements.
--
-- Never downgrades a 'resolved' row — the WHERE guard ensures only 'new'
-- rows are touched.
--
-- Run in Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_feedback_read(p_ticket_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.feedback
  SET status = 'read'
  WHERE id = p_ticket_id::uuid
    AND status = 'new';

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_feedback_read(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_feedback_read(TEXT) TO service_role;
