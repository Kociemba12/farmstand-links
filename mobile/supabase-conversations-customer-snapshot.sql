-- Customer identity snapshot columns on conversations table.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Safe to run multiple times (IF NOT EXISTS guards).
--
-- Purpose: store the customer's display name and avatar on the conversation row
-- so the owner can read it without a cross-user profiles table lookup.
-- The customer writes these fields the first time they send a message.
-- The existing "Users can soft-delete their conversations" UPDATE policy already
-- allows owner_id and customer_id participants to update any column, so no new
-- RLS policy is needed.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS customer_name       text,
  ADD COLUMN IF NOT EXISTS customer_avatar_url text;
