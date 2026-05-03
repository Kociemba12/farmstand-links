-- update_review_reply RPC
--
-- Lets an authenticated farmstand owner update their reply on a received review.
-- Runs SECURITY DEFINER so it bypasses RLS for the UPDATE, but still verifies
-- ownership using auth.uid() before writing.
--
-- Client usage:
--   const { data, error } = await supabase.rpc('update_review_reply', {
--     p_review_id: '<uuid>',
--     p_reply_text: 'Your updated reply text',
--   });
--   // data: { owner_response: string, owner_response_at: string }

CREATE OR REPLACE FUNCTION update_review_reply(
  p_review_id   UUID,
  p_reply_text  TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmstand_id TEXT;
  v_user_id      TEXT;
BEGIN
  -- Caller must be authenticated
  v_user_id := auth.uid()::TEXT;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Resolve the farmstand that owns this review
  SELECT farmstand_id INTO v_farmstand_id
  FROM farmstand_reviews
  WHERE id = p_review_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_not_found';
  END IF;

  -- Confirm the caller owns that farmstand
  IF NOT EXISTS (
    SELECT 1 FROM farmstand_owners
    WHERE user_id      = v_user_id
      AND farmstand_id = v_farmstand_id
  ) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Update only the reply columns — never touches the customer review fields
  UPDATE farmstand_reviews
  SET
    owner_response    = p_reply_text,
    owner_response_at = NOW()
  WHERE id = p_review_id;

  -- Return the committed values so the client can sync state immediately
  RETURN (
    SELECT json_build_object(
      'owner_response',    owner_response,
      'owner_response_at', owner_response_at::TEXT
    )
    FROM farmstand_reviews
    WHERE id = p_review_id
  );
END;
$$;

-- Grant execute to authenticated users only
GRANT EXECUTE ON FUNCTION update_review_reply(UUID, TEXT) TO authenticated;
