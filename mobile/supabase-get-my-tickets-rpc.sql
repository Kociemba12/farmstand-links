-- ============================================================================
-- get_my_tickets — SECURITY DEFINER RPC
--
-- Returns all non-deleted feedback rows for the currently authenticated user.
-- Runs as the function owner (postgres) so it bypasses RLS on public.feedback.
-- auth.uid() is resolved inside the function and used to filter rows.
-- feedback.user_id is TEXT so auth.uid() is cast to text for the comparison.
--
-- Run this in your Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_tickets()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_rows    JSON;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  SELECT json_agg(row_to_json(t) ORDER BY t.created_at DESC)
  INTO v_rows
  FROM (
    SELECT
      id,
      user_id,
      user_email,
      user_name,
      category,
      message,
      status,
      rating,
      screenshot_urls,
      source_screen,
      created_at,
      updated_at,
      deleted_at
    FROM public.feedback
    WHERE user_id = v_user_id::text
      AND deleted_at IS NULL
  ) t;

  RETURN json_build_object('success', true, 'data', COALESCE(v_rows, '[]'::json));

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_tickets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_tickets() TO service_role;
