-- ============================================================================
-- Farmstand Video Column Migration
--
-- Adds video_url, video_path, and video_duration_seconds to the farmstands
-- table, and creates the farmstand-videos Storage bucket.
--
-- Run ORDER:
--   1. This file (adds columns)
--   2. supabase-owner-update-farmstand.sql (re-deploys RPC with video support)
--   3. supabase-admin-update-farmstand.sql (re-deploys RPC with video support)
--
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT).
-- ============================================================================

-- ── Step 1: Add columns to farmstands ────────────────────────────────────────

ALTER TABLE public.farmstands
  ADD COLUMN IF NOT EXISTS video_url              TEXT,
  ADD COLUMN IF NOT EXISTS video_path             TEXT,
  ADD COLUMN IF NOT EXISTS video_duration_seconds INTEGER;

-- ── Step 2: Create farmstand-videos Storage bucket ───────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'farmstand-videos',
  'farmstand-videos',
  true,
  524288000,  -- 500 MB per file
  ARRAY['video/mp4', 'video/quicktime', 'video/mov', 'video/mpeg', 'video/webm']
)
ON CONFLICT (id) DO NOTHING;

-- ── Step 3: RLS policies for farmstand-videos bucket ─────────────────────────

-- Owners can upload to their own farmstand folder: farmstand-videos/{farmstand_id}/...
-- (this is a permissive policy; restrict to owner_id join if needed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated users can upload farmstand videos'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Authenticated users can upload farmstand videos"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'farmstand-videos');
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated users can update farmstand videos'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Authenticated users can update farmstand videos"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = 'farmstand-videos');
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated users can delete farmstand videos'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Authenticated users can delete farmstand videos"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = 'farmstand-videos');
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Public read farmstand videos'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Public read farmstand videos"
      ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'farmstand-videos');
    $policy$;
  END IF;
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'farmstands'
  AND column_name  IN ('video_url', 'video_path', 'video_duration_seconds')
ORDER BY column_name;
