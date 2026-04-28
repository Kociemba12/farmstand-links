-- ============================================================
-- USER PROFILES TABLE
-- ============================================================
-- Stores public user profile data including avatar URL.
-- Referenced by uploadAvatarAndPersist() and fetchProfileAvatarUrl()
-- in mobile/src/lib/supabase.ts.
--
-- The app queries this table using the `uid` column (NOT `id`).
-- A row must exist here before avatar persistence will succeed.
--
-- Run this SQL in your Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS and DROP POLICY IF EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  uid          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avatar_url   TEXT,
  full_name    TEXT,
  bio          TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast uid lookups
CREATE INDEX IF NOT EXISTS profiles_uid_idx ON public.profiles(uid);

-- ── Row Level Security ───────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read any profile (avatars/names shown publicly in UI)
DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;
CREATE POLICY "Profiles are publicly readable"
  ON public.profiles FOR SELECT
  USING (true);

-- Users can only update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = uid)
  WITH CHECK (auth.uid() = uid);

-- Users can insert their own profile (on first sign-up)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = uid);

-- ── Auto-create profile on sign-up ──────────────────────────
-- Trigger: creates a profiles row automatically when a new auth.users row is inserted.
-- This ensures uploadAvatarAndPersist always finds an existing row to PATCH.
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (uid, full_name, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NULL),
    NOW(),
    NOW()
  )
  ON CONFLICT (uid) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

-- ── Back-fill existing users ─────────────────────────────────
-- Creates a profiles row for any auth user who signed up before this table existed.
-- Safe to run multiple times — uses ON CONFLICT DO NOTHING.
INSERT INTO public.profiles (uid, created_at, updated_at)
SELECT id, created_at, NOW()
FROM auth.users
ON CONFLICT (uid) DO NOTHING;
