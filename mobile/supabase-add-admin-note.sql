-- ============================================
-- ADD admin_note COLUMN TO claim_requests
-- ============================================
-- Run this in your Supabase SQL Editor to add
-- the admin_note column used by the Request More Info flow.

ALTER TABLE public.claim_requests
  ADD COLUMN IF NOT EXISTS admin_note TEXT;
