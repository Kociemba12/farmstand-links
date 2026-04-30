-- ============================================================================
-- Owner Update Farmstand RPC
--
-- SECURITY DEFINER function that lets a farmstand owner update their own
-- listing. Verifies the caller is the owner (owner_id or claimed_by) before
-- applying changes — no admin role required.
--
-- Separate from admin_update_farmstand (which requires admin role).
-- Replaces the older update_farmstand_owner (which had a limited field set).
--
-- Run in Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.owner_update_farmstand(
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
  v_owner_id  TEXT;
  v_claimed   TEXT;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Fetch ownership columns (cast to TEXT so comparison works regardless of column type)
  SELECT owner_id::TEXT, claimed_by::TEXT
    INTO v_owner_id, v_claimed
    FROM public.farmstands
   WHERE id = p_farmstand_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Farmstand not found');
  END IF;

  -- Caller must be the owner or the claimer
  IF v_owner_id IS DISTINCT FROM v_caller_id::TEXT
     AND v_claimed IS DISTINCT FROM v_caller_id::TEXT THEN
    RETURN json_build_object('success', false, 'error', 'Permission denied');
  END IF;

  -- Apply only keys present in p_updates; leave every other column untouched.
  -- Owners cannot change status / approval columns — those are admin-only.
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
    hours = CASE WHEN p_updates ? 'hours' THEN p_updates->'hours' ELSE hours END,

    -- ── Always update timestamp ───────────────────────────────────────────────
    updated_at = NOW()

  WHERE id = p_farmstand_id;

  RETURN json_build_object('success', true, 'id', p_farmstand_id::TEXT);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_update_farmstand(UUID, JSONB) TO authenticated;

-- ── Verification ─────────────────────────────────────────────────────────────

SELECT proname, prosecdef
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname = 'owner_update_farmstand';
