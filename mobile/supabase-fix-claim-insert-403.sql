-- ============================================================================
-- FIX: 403 "permission denied for table farmstands" on claim_requests INSERT
--
-- Root cause: a trigger on claim_requests fires on INSERT and tries to UPDATE
-- farmstands, but runs as SECURITY INVOKER (the authenticated user) who has
-- no WRITE access to farmstands.
--
-- Fix: drop ALL INSERT triggers on claim_requests. The farmstand claim_status
-- is set by the approve_claim / deny_claim SECURITY DEFINER RPCs instead.
--
-- Run this entire script in your Supabase SQL Editor.
-- ============================================================================

-- -----------------------------------------------------------------------
-- 1. Dynamically drop EVERY trigger on claim_requests (catches any name)
-- -----------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_table = 'claim_requests'
      AND trigger_schema     = 'public'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.claim_requests CASCADE', r.trigger_name);
    RAISE NOTICE 'Dropped trigger: %', r.trigger_name;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------
-- 2. Belt-and-suspenders: drop all known trigger names by name too
--    (covers triggers the information_schema may not surface in some configs)
-- -----------------------------------------------------------------------
DROP TRIGGER IF EXISTS upsert_farmstand_on_claim_insert      ON public.claim_requests;
DROP TRIGGER IF EXISTS sync_farmstand_on_claim_insert        ON public.claim_requests;
DROP TRIGGER IF EXISTS claim_insert_trigger                  ON public.claim_requests;
DROP TRIGGER IF EXISTS on_claim_request_insert               ON public.claim_requests;
DROP TRIGGER IF EXISTS update_farmstand_claim_status         ON public.claim_requests;
DROP TRIGGER IF EXISTS handle_claim_insert                   ON public.claim_requests;
DROP TRIGGER IF EXISTS after_claim_insert                    ON public.claim_requests;
DROP TRIGGER IF EXISTS before_claim_insert                   ON public.claim_requests;
DROP TRIGGER IF EXISTS claim_request_trigger                 ON public.claim_requests;
DROP TRIGGER IF EXISTS claim_status_trigger                  ON public.claim_requests;
DROP TRIGGER IF EXISTS sync_claim_status                     ON public.claim_requests;
DROP TRIGGER IF EXISTS farmstand_claim_trigger               ON public.claim_requests;
DROP TRIGGER IF EXISTS set_farmstand_claim_pending           ON public.claim_requests;
DROP TRIGGER IF EXISTS mark_farmstand_pending                ON public.claim_requests;
DROP TRIGGER IF EXISTS new_claim_request_trigger             ON public.claim_requests;

-- -----------------------------------------------------------------------
-- 3. Drop all trigger functions that touch farmstands from claim_requests
-- -----------------------------------------------------------------------
DROP FUNCTION IF EXISTS sync_claim_request_status()          CASCADE;
DROP FUNCTION IF EXISTS update_claim_on_farmstand_change()   CASCADE;
DROP FUNCTION IF EXISTS upsert_farmstand_on_claim()          CASCADE;
DROP FUNCTION IF EXISTS sync_farmstand_claim_status()        CASCADE;
DROP FUNCTION IF EXISTS handle_claim_request_insert()        CASCADE;
DROP FUNCTION IF EXISTS handle_claim_insert()                CASCADE;
DROP FUNCTION IF EXISTS after_claim_insert_fn()              CASCADE;
DROP FUNCTION IF EXISTS claim_request_insert_fn()            CASCADE;
DROP FUNCTION IF EXISTS set_farmstand_claim_pending()        CASCADE;
DROP FUNCTION IF EXISTS mark_farmstand_pending()             CASCADE;

-- -----------------------------------------------------------------------
-- 4. Verify: confirm NO triggers remain on claim_requests
-- -----------------------------------------------------------------------
SELECT event_object_table, trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'claim_requests'
  AND trigger_schema = 'public'
ORDER BY trigger_name;
-- Expected: 0 rows
