-- ============================================================
-- ADD expo_push_token TO profiles TABLE
-- ============================================================
-- Adds a single authoritative push token column to the profiles table.
-- This is the source of truth for claim-related push notifications.
--
-- WHY: user_push_tokens can have the same physical Expo push token
-- registered under multiple user IDs (e.g., when two users share a
-- device). Reading from profiles.expo_push_token guarantees we reach
-- exactly the user who submitted the claim.
--
-- The mobile app updates this column via registerPushToken() each time
-- the user's device token is registered.
--
-- Run this SQL in your Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- Index for fast backend lookups by uid
CREATE INDEX IF NOT EXISTS profiles_uid_push_token_idx
  ON public.profiles(uid)
  WHERE expo_push_token IS NOT NULL;
