-- ============================================================
-- ADMIN USER MANAGEMENT MIGRATION
-- ============================================================
-- Adds role + status columns to profiles, backfills existing
-- users, and sets up triggers so profiles always stays in sync
-- with auth.users metadata.
--
-- Run this in your Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ============================================================

-- 1. Add role column to profiles (if not already present)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'consumer'
    CHECK (role IN ('admin', 'farmer', 'consumer'));

-- 2. Add status column to profiles (if not already present)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended'));

-- 3. Backfill full_name from auth metadata for rows where it is null
UPDATE public.profiles p
SET full_name = COALESCE(
  (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = p.uid),
  p.full_name
)
WHERE full_name IS NULL OR full_name = '';

-- 4. Backfill role from auth metadata for rows still at default 'consumer'
--    Only overwrites if metadata explicitly has a recognised role value.
UPDATE public.profiles p
SET role = sub.meta_role
FROM (
  SELECT id, raw_user_meta_data->>'role' AS meta_role
  FROM auth.users
  WHERE raw_user_meta_data->>'role' IN ('admin', 'farmer', 'consumer')
) sub
WHERE p.uid = sub.id
  AND p.role = 'consumer'  -- only update if still at default
  AND sub.meta_role IS NOT NULL;

-- 5. Backfill: ensure EVERY auth user has a profiles row
INSERT INTO public.profiles (uid, full_name, role, created_at, updated_at)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', NULL),
  COALESCE(
    CASE WHEN u.raw_user_meta_data->>'role' IN ('admin','farmer','consumer')
         THEN u.raw_user_meta_data->>'role'
         ELSE 'consumer' END,
    'consumer'
  ),
  u.created_at,
  NOW()
FROM auth.users u
ON CONFLICT (uid) DO NOTHING;

-- 6. Update the auto-create trigger to also capture role
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (uid, full_name, role, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
    COALESCE(
      CASE WHEN NEW.raw_user_meta_data->>'role' IN ('admin','farmer','consumer')
           THEN NEW.raw_user_meta_data->>'role'
           ELSE 'consumer' END,
      'consumer'
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (uid) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Drop & recreate trigger (safe idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- 7. RLS: Keep profiles publicly readable (avatars/names shown in UI)
--    Admins also need to be able to update any profile's role/status.
--    We use service-role key on the backend so RLS is bypassed there —
--    no extra policy needed. But keep a record of what's intentional:

-- Policy: service role (backend) can do anything — automatically bypasses RLS.
-- Policy: users can update own profile (already exists from profiles.sql)
-- Policy: publicly readable (already exists from profiles.sql)

-- 8. Admin-only function: get_all_users_for_admin
--    Returns all profiles joined with their farmstand count.
--    The backend calls this via service role (bypasses RLS), so no
--    additional RLS policy is needed here.
CREATE OR REPLACE FUNCTION public.get_all_users_for_admin()
RETURNS TABLE (
  uid          UUID,
  full_name    TEXT,
  role         TEXT,
  status       TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ,
  farmstand_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.uid,
    p.full_name,
    p.role,
    p.status,
    p.avatar_url,
    p.created_at,
    p.updated_at,
    COUNT(f.id) AS farmstand_count
  FROM public.profiles p
  LEFT JOIN public.farmstands f
    ON f.owner_id = p.uid
    AND f.deleted_at IS NULL
  GROUP BY p.uid, p.full_name, p.role, p.status, p.avatar_url, p.created_at, p.updated_at
  ORDER BY p.created_at DESC;
$$;

-- Grant execute to authenticated users (backend uses service role anyway,
-- but this lets the function be called via anon key if needed in future)
REVOKE ALL ON FUNCTION public.get_all_users_for_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_users_for_admin() TO service_role;
