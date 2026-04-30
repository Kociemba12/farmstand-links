-- ============================================================================
-- FIX: 403 "permission denied for table farmstands" on claim submit
--
-- PART 1 — Diagnostic SELECT: lists every trigger on claim_requests and the
--           full source of its trigger function so you can see exactly which
--           one touches farmstands.
--
-- PART 2 — Targeted DROP: removes only the INSERT trigger(s) whose function
--           body references UPDATE on farmstands. All other triggers
--           (notifications, email alerts, inbox, claim workflow) are left
--           untouched.
--
-- PART 3 — submit_claim_request SECURITY DEFINER RPC: belt-and-suspenders so
--           the insert path never returns 403 even if a trigger survives.
--           Does NOT touch farmstands. Does NOT change approve_claim /
--           deny_claim or farmstands RLS.
--
-- How to use:
--   1. Run PART 1 first. Review the output to confirm which trigger is broken.
--   2. Run PART 2 + PART 3 together to apply the fix.
-- ============================================================================


-- ============================================================================
-- PART 1  ·  DIAGNOSTIC (read-only — run this first to inspect)
-- ============================================================================
-- Shows every trigger on claim_requests, the events that fire it, and the
-- full PL/pgSQL source of its function.  Look for any function body that
-- contains UPDATE … farmstands — that is the broken trigger.
SELECT
  pt.tgname                                    AS trigger_name,
  CASE
    WHEN (pt.tgtype & 2) > 0 THEN 'BEFORE'
    ELSE 'AFTER'
  END                                           AS timing,
  string_agg(
    CASE em.n
      WHEN 4  THEN 'INSERT'
      WHEN 8  THEN 'DELETE'
      WHEN 16 THEN 'UPDATE'
    END, ' OR '
  )                                             AS events,
  p.proname                                    AS function_name,
  p.prosrc                                     AS function_body
FROM pg_trigger      pt
JOIN pg_class        c  ON c.oid = pt.tgrelid
JOIN pg_namespace    ns ON ns.oid = c.relnamespace
JOIN pg_proc         p  ON p.oid = pt.tgfoid
-- unnest event bits (INSERT=4, DELETE=8, UPDATE=16)
JOIN LATERAL (VALUES (4),(8),(16)) AS em(n) ON (pt.tgtype & em.n) > 0
WHERE c.relname     = 'claim_requests'
  AND ns.nspname    = 'public'
  AND NOT pt.tgisinternal
GROUP BY pt.tgname, pt.tgtype, p.proname, p.prosrc
ORDER BY pt.tgname;


-- ============================================================================
-- PART 2  ·  TARGETED DROP
-- Finds INSERT triggers on claim_requests whose PL/pgSQL function body
-- references an UPDATE on farmstands and drops only those.
-- Notification / email / inbox / workflow triggers are not touched.
-- ============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      pt.tgname  AS trigger_name,
      p.proname  AS function_name
    FROM pg_trigger    pt
    JOIN pg_class      c  ON c.oid = pt.tgrelid AND c.relname = 'claim_requests'
    JOIN pg_namespace  ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
    JOIN pg_proc       p  ON p.oid = pt.tgfoid
    WHERE NOT pt.tgisinternal
      -- only INSERT triggers
      AND (pt.tgtype & 4) > 0
      -- whose function body writes to farmstands
      AND (
           p.prosrc ILIKE '%UPDATE%farmstands%'
        OR p.prosrc ILIKE '%farmstands%claim_status%'
        OR p.prosrc ILIKE '%public.farmstands%SET%'
        OR p.prosrc ILIKE '%INTO%farmstands%'
      )
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.claim_requests',
      r.trigger_name
    );
    RAISE NOTICE 'Dropped trigger "%" (function: "%")', r.trigger_name, r.function_name;
  END LOOP;
END;
$$;


-- ============================================================================
-- PART 3  ·  submit_claim_request — SECURITY DEFINER RPC
--
-- The app now calls this RPC instead of a direct claim_requests INSERT.
-- Runs as the function owner (postgres) so any surviving trigger fires under
-- owner credentials — the 403 cannot occur.
-- This function does NOT update farmstands.
-- approve_claim / deny_claim and farmstands RLS are untouched.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.submit_claim_request(
  p_farmstand_id    UUID,
  p_user_id         UUID,
  p_requester_name  TEXT,
  p_requester_email TEXT,
  p_evidence_urls   TEXT[]  DEFAULT ARRAY[]::TEXT[],
  p_notes           TEXT    DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Security: the calling user must be the requester
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN json_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  -- Reject if farmstand is already claimed
  IF EXISTS (
    SELECT 1 FROM public.farmstands
    WHERE id = p_farmstand_id AND claim_status = 'claimed'
  ) THEN
    RETURN json_build_object('success', false,
      'error', 'This farmstand has already been claimed');
  END IF;

  -- Reject duplicate pending request from same user
  IF EXISTS (
    SELECT 1 FROM public.claim_requests
    WHERE farmstand_id = p_farmstand_id
      AND user_id      = p_user_id
      AND status       = 'pending'
  ) THEN
    RETURN json_build_object('success', false,
      'error', 'You already have a pending claim request for this farmstand');
  END IF;

  INSERT INTO public.claim_requests (
    farmstand_id,
    user_id,
    requester_name,
    requester_email,
    evidence_urls,
    notes,
    status
  ) VALUES (
    p_farmstand_id,
    p_user_id,
    trim(p_requester_name),
    lower(trim(p_requester_email)),
    COALESCE(p_evidence_urls, ARRAY[]::TEXT[]),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'pending'
  );

  RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_claim_request(UUID, UUID, TEXT, TEXT, TEXT[], TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_claim_request(UUID, UUID, TEXT, TEXT, TEXT[], TEXT)
  TO service_role;
