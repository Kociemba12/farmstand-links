-- ============================================
-- Admin Farmstand RPC Functions
-- Provides SECURITY DEFINER functions for admin approve/deny
-- so admins can update farmstand status bypassing RLS.
--
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql
-- ============================================

-- 1. Approve a farmstand (set status = 'active')
CREATE OR REPLACE FUNCTION approve_farmstand(p_farmstand_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is an admin
  SELECT raw_user_meta_data->>'role' INTO v_role
    FROM auth.users WHERE id = v_user_id;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  UPDATE public.farmstands
    SET status = 'active',
        updated_at = NOW()
    WHERE id = p_farmstand_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Farmstand not found: %', p_farmstand_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_farmstand(UUID) TO authenticated;

-- 2. Deny a farmstand (set status = 'denied')
CREATE OR REPLACE FUNCTION deny_farmstand(p_farmstand_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify caller is an admin
  SELECT raw_user_meta_data->>'role' INTO v_role
    FROM auth.users WHERE id = v_user_id;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  UPDATE public.farmstands
    SET status = 'denied',
        updated_at = NOW()
    WHERE id = p_farmstand_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Farmstand not found: %', p_farmstand_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION deny_farmstand(UUID) TO authenticated;
