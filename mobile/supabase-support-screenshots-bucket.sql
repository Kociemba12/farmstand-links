-- ============================================================================
-- Creates the support-screenshots Storage bucket and RLS policies for the
-- mobile app's support photo upload flow.
--
-- Run this in your Supabase SQL Editor.
-- ============================================================================

-- Create the bucket (idempotent)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-screenshots',
  'support-screenshots',
  true,
  10485760,  -- 10 MB per file
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- RLS policies
-- ============================================================================

-- Allow authenticated users to upload to their own support/ folder only
CREATE POLICY "Authenticated users can upload support screenshots"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'support-screenshots'
  AND (storage.foldername(name))[1] = 'support'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow anyone to read (bucket is public, but belt-and-suspenders)
CREATE POLICY "Public read support screenshots"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'support-screenshots');
