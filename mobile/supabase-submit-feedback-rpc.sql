-- ============================================================================
-- Creates the submit_feedback SECURITY DEFINER RPC used by the support
-- screen in the mobile app.  The app calls this instead of posting to the
-- backend so that the ticket is inserted even when the backend service is
-- unavailable.
--
-- The function inserts one row into public.feedback and returns the new id.
-- It does NOT change any other tables, admin logic, or existing RPCs.
--
-- Run this in your Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.submit_feedback(
  p_user_id         UUID,
  p_user_email      TEXT,
  p_user_name       TEXT     DEFAULT NULL,
  p_rating          INT      DEFAULT NULL,
  p_category        TEXT     DEFAULT 'General Feedback',
  p_message         TEXT     DEFAULT '',
  p_source_screen   TEXT     DEFAULT 'support',
  p_screenshot_urls TEXT[]   DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Security: the calling user must be the requester
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF trim(COALESCE(p_message, '')) = '' THEN
    RETURN json_build_object('success', false, 'error', 'Message is required');
  END IF;

  INSERT INTO public.feedback (
    user_id,
    user_email,
    user_name,
    rating,
    category,
    message,
    status,
    source_screen,
    screenshot_urls
  ) VALUES (
    p_user_id,
    lower(trim(p_user_email)),
    NULLIF(trim(COALESCE(p_user_name, '')), ''),
    p_rating,
    COALESCE(NULLIF(trim(p_category), ''), 'General Feedback'),
    trim(p_message),
    'new',
    COALESCE(p_source_screen, 'support'),
    COALESCE(p_screenshot_urls, ARRAY[]::TEXT[])
  )
  RETURNING id INTO v_id;

  RETURN json_build_object('success', true, 'id', v_id);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_feedback(UUID, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_feedback(UUID, TEXT, TEXT, INT, TEXT, TEXT, TEXT, TEXT[])
  TO service_role;
