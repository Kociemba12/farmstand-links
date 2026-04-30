-- ============================================================================
-- Admin Update Farmstand RPC
--
-- SECURITY DEFINER function that lets an admin update any farmstand's content
-- fields, bypassing RLS entirely. Uses the same admin-role check as
-- approve_farmstand / deny_farmstand.
--
-- Run in Supabase SQL Editor.
-- ============================================================================

-- ── Function ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_update_farmstand(
  p_farmstand_id UUID,
  p_updates      JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_role      TEXT;
BEGIN
  -- Must be authenticated
  IF v_caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Must have admin role in auth.users metadata (same check as approve_farmstand)
  SELECT raw_user_meta_data->>'role' INTO v_role
  FROM auth.users WHERE id = v_caller_id;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN json_build_object('success', false, 'error', 'Permission denied: admin role required');
  END IF;

  -- Apply only the keys present in p_updates; leave every other column untouched.
  -- Columns are grouped by type so casts are correct.
  UPDATE public.farmstands SET

    -- ── Text columns ──────────────────────────────────────────────────────────
    name               = CASE WHEN p_updates ? 'name'               THEN p_updates->>'name'               ELSE name               END,
    description        = CASE WHEN p_updates ? 'description'        THEN p_updates->>'description'        ELSE description        END,
    operational_status = CASE WHEN p_updates ? 'operational_status' THEN p_updates->>'operational_status' ELSE operational_status  END,
    operating_status   = CASE WHEN p_updates ? 'operating_status'   THEN p_updates->>'operating_status'   ELSE operating_status   END,
    street_address     = CASE WHEN p_updates ? 'street_address'     THEN p_updates->>'street_address'     ELSE street_address     END,
    address_line2      = CASE WHEN p_updates ? 'address_line2'      THEN p_updates->>'address_line2'      ELSE address_line2      END,
    city               = CASE WHEN p_updates ? 'city'               THEN p_updates->>'city'               ELSE city               END,
    state              = CASE WHEN p_updates ? 'state'              THEN p_updates->>'state'              ELSE state              END,
    zip                = CASE WHEN p_updates ? 'zip'                THEN p_updates->>'zip'                ELSE zip                END,
    full_address       = CASE WHEN p_updates ? 'full_address'       THEN p_updates->>'full_address'       ELSE full_address       END,
    cross_street1      = CASE WHEN p_updates ? 'cross_street1'      THEN p_updates->>'cross_street1'      ELSE cross_street1      END,
    cross_street2      = CASE WHEN p_updates ? 'cross_street2'      THEN p_updates->>'cross_street2'      ELSE cross_street2      END,
    email              = CASE WHEN p_updates ? 'email'              THEN p_updates->>'email'              ELSE email              END,
    phone              = CASE WHEN p_updates ? 'phone'              THEN p_updates->>'phone'              ELSE phone              END,
    status             = CASE WHEN p_updates ? 'status'             THEN p_updates->>'status'             ELSE status             END,
    hero_photo_url     = CASE WHEN p_updates ? 'hero_photo_url'     THEN p_updates->>'hero_photo_url'     ELSE hero_photo_url     END,
    ai_photo_url       = CASE WHEN p_updates ? 'ai_photo_url'       THEN p_updates->>'ai_photo_url'       ELSE ai_photo_url       END,
    hero_image_url     = CASE WHEN p_updates ? 'hero_image_url'     THEN p_updates->>'hero_image_url'     ELSE hero_image_url     END,
    ai_image_url       = CASE WHEN p_updates ? 'ai_image_url'       THEN p_updates->>'ai_image_url'       ELSE ai_image_url       END,
    photo_url          = CASE WHEN p_updates ? 'photo_url'          THEN p_updates->>'photo_url'          ELSE photo_url          END,
    image_url          = CASE WHEN p_updates ? 'image_url'          THEN p_updates->>'image_url'          ELSE image_url          END,
    video_url          = CASE WHEN p_updates ? 'video_url'          THEN p_updates->>'video_url'          ELSE video_url          END,
    video_path         = CASE WHEN p_updates ? 'video_path'         THEN p_updates->>'video_path'         ELSE video_path         END,
    seasonal_notes     = CASE WHEN p_updates ? 'seasonal_notes'     THEN p_updates->>'seasonal_notes'     ELSE seasonal_notes     END,

    -- ── Numeric columns ───────────────────────────────────────────────────────
    latitude               = CASE WHEN p_updates ? 'latitude'  THEN (p_updates->>'latitude')::DOUBLE PRECISION  ELSE latitude  END,
    longitude              = CASE WHEN p_updates ? 'longitude' THEN (p_updates->>'longitude')::DOUBLE PRECISION ELSE longitude END,
    video_duration_seconds = CASE WHEN p_updates ? 'video_duration_seconds'
                                  THEN (p_updates->>'video_duration_seconds')::INTEGER
                                  ELSE video_duration_seconds END,

    -- ── Boolean columns ───────────────────────────────────────────────────────
    show_on_map  = CASE WHEN p_updates ? 'show_on_map'  THEN (p_updates->>'show_on_map')::BOOLEAN  ELSE show_on_map  END,
    is_open_24_7 = CASE WHEN p_updates ? 'is_open_24_7' THEN (p_updates->>'is_open_24_7')::BOOLEAN ELSE is_open_24_7 END,

    -- ── Array columns (TEXT[]) ────────────────────────────────────────────────
    offerings = CASE WHEN p_updates ? 'offerings' THEN
        CASE WHEN jsonb_typeof(p_updates->'offerings') = 'null' THEN NULL::TEXT[]
             ELSE ARRAY(SELECT jsonb_array_elements_text(p_updates->'offerings')) END
      ELSE offerings END,

    other_products = CASE WHEN p_updates ? 'other_products' THEN
        CASE WHEN jsonb_typeof(p_updates->'other_products') = 'null' THEN NULL::TEXT[]
             ELSE ARRAY(SELECT jsonb_array_elements_text(p_updates->'other_products')) END
      ELSE other_products END,

    payment_options = CASE WHEN p_updates ? 'payment_options' THEN
        CASE WHEN jsonb_typeof(p_updates->'payment_options') = 'null' THEN NULL::TEXT[]
             ELSE ARRAY(SELECT jsonb_array_elements_text(p_updates->'payment_options')) END
      ELSE payment_options END,

    categories = CASE WHEN p_updates ? 'categories' THEN
        CASE WHEN jsonb_typeof(p_updates->'categories') = 'null' THEN NULL::TEXT[]
             ELSE ARRAY(SELECT jsonb_array_elements_text(p_updates->'categories')) END
      ELSE categories END,

    photos = CASE WHEN p_updates ? 'photos' THEN
        CASE WHEN jsonb_typeof(p_updates->'photos') = 'null' THEN NULL::TEXT[]
             ELSE ARRAY(SELECT jsonb_array_elements_text(p_updates->'photos')) END
      ELSE photos END,

    -- ── JSONB columns ─────────────────────────────────────────────────────────
    -- hours is a structured schedule object { timezone, mon, tue, ... }
    hours = CASE WHEN p_updates ? 'hours' THEN p_updates->'hours' ELSE hours END,

    -- ── Always update timestamp ───────────────────────────────────────────────
    updated_at = NOW()

  WHERE id = p_farmstand_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Farmstand not found');
  END IF;

  RETURN json_build_object('success', true, 'id', p_farmstand_id::TEXT);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_farmstand(UUID, JSONB) TO authenticated;

-- ── Verification ─────────────────────────────────────────────────────────────

SELECT proname, prosecdef
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname = 'admin_update_farmstand';
