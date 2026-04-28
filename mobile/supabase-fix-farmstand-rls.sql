-- ============================================
-- FIX: Add RLS UPDATE policy for farmstand owners
-- AND create a SECURITY DEFINER RPC for owner updates
-- (the RPC bypasses RLS entirely, so it works even before the policy is added)
--
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/khngqgjabrmgtbbnpiax/sql
-- ============================================

-- 1. Add RLS UPDATE policy so owners can update their own farmstand directly
DROP POLICY IF EXISTS "Owners can update their farmstand" ON public.farmstands;
CREATE POLICY "Owners can update their farmstand"
  ON public.farmstands
  FOR UPDATE
  USING (
    auth.uid() = owner_id
    OR auth.uid() = claimed_by
  )
  WITH CHECK (
    auth.uid() = owner_id
    OR auth.uid() = claimed_by
  );

-- 2. Create SECURITY DEFINER RPC for owner updates (bypasses RLS, verifies ownership in SQL)
CREATE OR REPLACE FUNCTION update_farmstand_owner(
  p_farmstand_id UUID,
  p_updates      JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_farmstand RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT id, owner_id, claimed_by INTO v_farmstand
    FROM public.farmstands WHERE id = p_farmstand_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Farmstand not found');
  END IF;

  IF v_farmstand.owner_id IS DISTINCT FROM v_user_id
     AND v_farmstand.claimed_by IS DISTINCT FROM v_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Permission denied');
  END IF;

  UPDATE public.farmstands
    SET
      name             = COALESCE((p_updates->>'name'),             name),
      description      = COALESCE((p_updates->>'description'),      description),
      street_address   = COALESCE((p_updates->>'street_address'),   street_address),
      address_line2    = COALESCE((p_updates->>'address_line2'),    address_line2),
      city             = COALESCE((p_updates->>'city'),             city),
      state            = COALESCE((p_updates->>'state'),            state),
      zip              = COALESCE((p_updates->>'zip'),              zip),
      full_address     = COALESCE((p_updates->>'full_address'),     full_address),
      cross_street1    = COALESCE((p_updates->>'cross_street1'),    cross_street1),
      cross_street2    = COALESCE((p_updates->>'cross_street2'),    cross_street2),
      email            = COALESCE((p_updates->>'email'),            email),
      phone            = COALESCE((p_updates->>'phone'),            phone),
      hero_image_url   = COALESCE((p_updates->>'hero_image_url'),   hero_image_url),
      hero_photo_url   = COALESCE((p_updates->>'hero_photo_url'),   hero_photo_url),
      ai_photo_url     = COALESCE((p_updates->>'ai_photo_url'),     ai_photo_url),
      photo_url        = COALESCE((p_updates->>'photo_url'),        photo_url),
      image_url        = COALESCE((p_updates->>'image_url'),        image_url),
      photos           = CASE WHEN p_updates ? 'photos' THEN (SELECT array_agg(x) FROM jsonb_array_elements_text(p_updates->'photos') x) ELSE photos END,
      offerings        = CASE WHEN p_updates ? 'offerings' THEN (SELECT array_agg(x) FROM jsonb_array_elements_text(p_updates->'offerings') x) ELSE offerings END,
      other_products   = COALESCE((p_updates->>'other_products'),   other_products),
      payment_options  = CASE WHEN p_updates ? 'payment_options' THEN (SELECT array_agg(x) FROM jsonb_array_elements_text(p_updates->'payment_options') x) ELSE payment_options END,
      categories       = CASE WHEN p_updates ? 'categories' THEN (SELECT array_agg(x) FROM jsonb_array_elements_text(p_updates->'categories') x) ELSE categories END,
      hours            = COALESCE((p_updates->'hours'),             hours),
      is_open_24_7     = COALESCE((p_updates->>'is_open_24_7')::boolean, is_open_24_7),
      updated_at       = NOW()
    WHERE id = p_farmstand_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_farmstand_owner(UUID, JSONB) TO authenticated;
