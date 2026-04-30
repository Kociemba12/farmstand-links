-- ============================================================================
-- toggle_favorite RPC
--
-- SECURITY DEFINER so the authenticated role can INSERT/DELETE from
-- saved_farmstands without the FK constraint check that requires SELECT on
-- farmstands (which the authenticated role doesn't have by default).
--
-- Returns JSON on every path:
--   success  boolean  – true on save/unsave, false on any failure
--   is_saved boolean  – true = stand is now saved, false = now unsaved
--   favorites text[]  – caller's full favorites list after the operation
--   error    text     – human-readable error (failure paths only)
--   code     text     – SQLSTATE 5-char code (failure paths only)
--   details  text     – extended PG error detail (failure paths only)
--
-- Table / column names used:
--   public.saved_farmstands  (user_id uuid, farmstand_id uuid)
--
-- Run in Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.toggle_favorite(
  p_farmstand_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_exists     BOOLEAN;
  v_err_msg    TEXT;
  v_err_state  TEXT;
  v_err_detail TEXT;
BEGIN
  -- Auth guard
  IF v_user_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error',   'Not authenticated – auth.uid() returned NULL',
      'code',    'AUTH01',
      'details', 'No active session token was passed with the request'
    );
  END IF;

  -- Null guard for the parameter itself
  IF p_farmstand_id IS NULL THEN
    RETURN json_build_object(
      'success', false,
      'error',   'p_farmstand_id must not be NULL',
      'code',    'PARAM01',
      'details', 'A valid UUID is required'
    );
  END IF;

  -- Check current saved state
  SELECT EXISTS(
    SELECT 1
      FROM public.saved_farmstands
     WHERE user_id      = v_user_id
       AND farmstand_id = p_farmstand_id
  ) INTO v_exists;

  IF v_exists THEN
    -- Unsave
    DELETE FROM public.saved_farmstands
     WHERE user_id      = v_user_id
       AND farmstand_id = p_farmstand_id;
  ELSE
    -- Save — ON CONFLICT DO NOTHING is idempotent against double-taps
    INSERT INTO public.saved_farmstands (user_id, farmstand_id)
    VALUES (v_user_id, p_farmstand_id)
    ON CONFLICT (user_id, farmstand_id) DO NOTHING;
  END IF;

  -- Return full favorites list so the client can sync exactly
  RETURN json_build_object(
    'success',   true,
    'is_saved',  NOT v_exists,
    'favorites', COALESCE(
      (SELECT json_agg(farmstand_id)
         FROM public.saved_farmstands
        WHERE user_id = v_user_id),
      '[]'::json
    )
  );

EXCEPTION WHEN OTHERS THEN
  -- Capture all available Postgres error fields before returning
  GET STACKED DIAGNOSTICS
    v_err_msg    = MESSAGE_TEXT,
    v_err_state  = RETURNED_SQLSTATE,
    v_err_detail = PG_EXCEPTION_DETAIL;

  RETURN json_build_object(
    'success', false,
    'error',   v_err_msg,
    'code',    v_err_state,
    'details', COALESCE(v_err_detail, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_favorite(UUID) TO authenticated;

-- Verification — should return one row with prosecdef = true
SELECT proname, prosecdef
  FROM pg_proc
  JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
 WHERE pg_namespace.nspname = 'public'
   AND proname = 'toggle_favorite';
