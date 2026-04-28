-- ============================================================
-- admin_deny_farmstand_and_alert
-- Single SECURITY DEFINER function: denies a farmstand AND
-- inserts an inbox_alerts row for the correct recipient.
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_deny_farmstand_and_alert(
  p_farmstand_id uuid,
  p_reason       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id  uuid;
  v_caller_role text;
  v_owner_id   uuid;
  v_name       text;
BEGIN
  -- Auth check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Admin check
  SELECT raw_user_meta_data->>'role' INTO v_caller_role
    FROM auth.users WHERE id = v_caller_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'permission_denied: admin role required';
  END IF;

  -- Get farmstand name
  SELECT name INTO v_name
    FROM public.farmstands
   WHERE id = p_farmstand_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'farmstand_not_found: %', p_farmstand_id;
  END IF;

  -- Deny the farmstand
  UPDATE public.farmstands
     SET status     = 'denied',
         updated_at = NOW()
   WHERE id = p_farmstand_id;

  -- ----------------------------------------------------------------
  -- Determine recipient: try owner_user_id first (primary column),
  -- then farmstand_owners join table, then other legacy column names
  -- ----------------------------------------------------------------

  -- 1. owner_user_id (primary column used in this app)
  BEGIN
    EXECUTE 'SELECT owner_user_id FROM public.farmstands WHERE id = $1'
      INTO v_owner_id USING p_farmstand_id;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  -- 2. farmstand_owners join table (if it exists)
  IF v_owner_id IS NULL THEN
    BEGIN
      SELECT fo.user_id INTO v_owner_id
        FROM public.farmstand_owners fo
       WHERE fo.farmstand_id = p_farmstand_id
       ORDER BY fo.created_at ASC
       LIMIT 1;
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
  END IF;

  -- 3. user_id column (legacy)
  IF v_owner_id IS NULL THEN
    BEGIN
      EXECUTE 'SELECT user_id FROM public.farmstands WHERE id = $1'
        INTO v_owner_id USING p_farmstand_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- 4. owner_id column (legacy)
  IF v_owner_id IS NULL THEN
    BEGIN
      EXECUTE 'SELECT owner_id FROM public.farmstands WHERE id = $1'
        INTO v_owner_id USING p_farmstand_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- 5. created_by column (legacy)
  IF v_owner_id IS NULL THEN
    BEGIN
      EXECUTE 'SELECT created_by FROM public.farmstands WHERE id = $1'
        INTO v_owner_id USING p_farmstand_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- 6. claimed_by_user_id column (legacy)
  IF v_owner_id IS NULL THEN
    BEGIN
      EXECUTE 'SELECT claimed_by_user_id FROM public.farmstands WHERE id = $1'
        INTO v_owner_id USING p_farmstand_id;
    EXCEPTION WHEN undefined_column THEN NULL;
    END;
  END IF;

  -- ----------------------------------------------------------------
  -- Insert inbox alert for the recipient (if we found one)
  -- ----------------------------------------------------------------
  IF v_owner_id IS NOT NULL THEN
    INSERT INTO public.inbox_alerts (
      user_id,
      title,
      body,
      related_farmstand_id,
      created_at
    ) VALUES (
      v_owner_id,
      'Farmstand denied',
      CASE
        WHEN NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NOT NULL
          THEN FORMAT(
            E'Your Farmstand "%s" was denied.\n\nReason: %s',
            COALESCE(v_name, 'Your Farmstand'),
            TRIM(p_reason)
          )
        ELSE FORMAT(
          E'Your Farmstand "%s" was denied.',
          COALESCE(v_name, 'Your Farmstand')
        )
      END,
      p_farmstand_id,
      NOW()
    );
  END IF;
  -- Note: if no recipient found, denial still succeeds — alert is skipped silently.

END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_deny_farmstand_and_alert(uuid, text) TO authenticated;
