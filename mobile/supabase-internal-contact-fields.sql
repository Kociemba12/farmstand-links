-- ============================================================
-- ADD INTERNAL CONTACT FIELDS TO FARMSTANDS
-- Admin-only / internal fields. NOT exposed in public UI.
-- ============================================================
-- Run this SQL in your Supabase SQL Editor

ALTER TABLE public.farmstands
  ADD COLUMN IF NOT EXISTS internal_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS internal_contact_email TEXT;

-- Optional: comment on columns for documentation
COMMENT ON COLUMN public.farmstands.internal_contact_phone IS 'Admin-only internal contact phone. Not shown publicly.';
COMMENT ON COLUMN public.farmstands.internal_contact_email IS 'Admin-only internal contact email. Not shown publicly.';
