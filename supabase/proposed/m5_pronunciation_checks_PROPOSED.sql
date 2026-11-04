-- ============================================================================
-- PROPOSED — NOT APPLIED. Do not run without explicit approval.
-- Target: ReadFlow-Staging only. Never the original team ReadFlow database.
--
-- M5 F2/F3/F4/F7: keep the English pronunciation check permanently.
-- Supersedes supabase/proposed/m5_pronunciation_results_PROPOSED.sql (per-part
-- rows written by the browser's part requests). Do not apply that file.
-- ============================================================================
--
-- Run order
--   1. supabase/tests/m5_pronunciation_checks_preflight.sql   (read-only)
--   2. this file
--   3. supabase/tests/m5_pronunciation_checks_verify.sql      (read-only)
--   Rollback: supabase/proposed/m5_pronunciation_checks_ROLLBACK_PROPOSED.sql
--
-- Design
--   One authoritative row per oral-reading attempt (attempt_id is the primary
--   key). The backend inserts a "running" claim BEFORE the paid speech
--   assessment, so two simultaneous requests cannot both pay: the second hits
--   the primary key and is told a check is already running. The backend then
--   stores the result it computed itself from the speech service's reply
--   (never scores sent by the browser) and marks the row "completed".
--
--   A completed row is immutable (trigger below): it is never overwritten or
--   re-run. A failed or abandoned ("running" for more than 10 minutes) claim
--   carries no results and may be taken over by a later request.
--
--   Filipino readings can never hold a row: the trigger rejects any attempt
--   whose language_snapshot is 'fil', and the language column only allows 'en'.
--
-- Access
--   Same model as oral_reading_recordings: RLS on, no policies, no anon or
--   authenticated privileges; only the backend (service_role) reads or writes.
--   The backend checks attempt ownership (learner self-review) or the existing
--   Teacher classroom rules before reading a row. No Admin review access.
--
-- Impact
--   Additive only. No existing table, column, policy, function, trigger, score
--   or student record changes. Deleting an attempt deletes its check
--   (ON DELETE CASCADE, as with oral_reading_recordings).
--
-- Known limit (unchanged from today)
--   The browser converts the saved recording to WAV and uploads it; the server
--   assesses the uploaded audio for the learner's own attempt. It does not
--   itself decode the saved WebM recording.
-- ============================================================================

BEGIN;

-- Stop instead of guessing if the expected M5 schema is not present.
DO $preflight$
BEGIN
  IF to_regclass('public.oral_reading_attempts') IS NULL THEN
    RAISE EXCEPTION 'public.oral_reading_attempts is missing; apply the M5 schema first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'oral_reading_attempts'
      AND column_name = 'language_snapshot'
  ) THEN
    RAISE EXCEPTION 'oral_reading_attempts.language_snapshot is missing.';
  END IF;
  IF to_regclass('public.oral_reading_pronunciation_checks') IS NOT NULL THEN
    RAISE EXCEPTION 'public.oral_reading_pronunciation_checks already exists; review it before re-running.';
  END IF;
  IF to_regclass('public.oral_reading_pronunciation_parts') IS NOT NULL THEN
    RAISE EXCEPTION 'The superseded oral_reading_pronunciation_parts table exists; review it first.';
  END IF;
END
$preflight$;

CREATE TABLE public.oral_reading_pronunciation_checks (
  attempt_id uuid PRIMARY KEY
    REFERENCES public.oral_reading_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  -- Identifies the request that holds a running claim; compare-and-swap key.
  claim_id uuid NOT NULL,
  -- Lease time: set when claimed and renewed by the backend before each further
  -- recording file is assessed. A running claim not renewed for 10 minutes is
  -- abandoned (e.g. after a server crash) and may be taken over.
  claimed_at timestamptz NOT NULL DEFAULT now(),
  -- Safe error code of a failed claim (e.g. STT_QUOTA); never provider text.
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  language text NOT NULL DEFAULT 'en' CHECK (language = 'en'),

  -- Results. All NULL until status = 'completed'.
  locale text CHECK (locale IS NULL OR locale = 'en-US'),
  score_scale text CHECK (score_scale IS NULL OR score_scale = '0-100'),
  -- Internal provider tag for audits; never shown to learners.
  provider text CHECK (provider IS NULL OR provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
  summary_version smallint CHECK (summary_version IS NULL OR summary_version >= 1),
  part_count smallint CHECK (part_count IS NULL OR part_count BETWEEN 1 AND 32),
  utterance_count integer CHECK (utterance_count IS NULL OR utterance_count BETWEEN 0 AND 6400),
  -- Word-weighted mean of the service's utterance scores (F3); NULL if none.
  accuracy smallint CHECK (accuracy IS NULL OR accuracy BETWEEN 0 AND 100),
  fluency smallint CHECK (fluency IS NULL OR fluency BETWEEN 0 AND 100),
  -- F4 words flagged for practice (at most 10).
  words_to_practice jsonb CHECK (
    words_to_practice IS NULL OR (
      jsonb_typeof(words_to_practice) = 'array'
      AND jsonb_array_length(words_to_practice) <= 10
    )
  ),
  -- Coverage (F3/F4 notes and F2 wording).
  assessed_seconds integer CHECK (assessed_seconds IS NULL OR assessed_seconds BETWEEN 0 AND 600),
  complete boolean,
  -- NULL with complete = false means some unassessed speech was unmeasured.
  unassessed_seconds integer CHECK (unassessed_seconds IS NULL OR unassessed_seconds BETWEEN 0 AND 600),
  unassessed_segments integer CHECK (unassessed_segments IS NULL OR unassessed_segments BETWEEN 0 AND 10000),
  -- Word-level findings: the server-sanitized per-part results
  -- ({utterances:[{text,accuracy,fluency,words:[{word,accuracy,errorType}]}],
  --   complete, durationSeconds, unassessedSegments, unassessedSeconds}).
  parts jsonb CHECK (
    parts IS NULL OR (
      jsonb_typeof(parts) = 'array'
      AND jsonb_array_length(parts) BETWEEN 1 AND 32
    )
  ),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oral_reading_pronunciation_checks_results_match_status CHECK (
    CASE WHEN status = 'completed' THEN
      locale IS NOT NULL AND score_scale IS NOT NULL AND provider IS NOT NULL
      AND summary_version IS NOT NULL AND part_count IS NOT NULL
      AND utterance_count IS NOT NULL AND words_to_practice IS NOT NULL
      AND assessed_seconds IS NOT NULL AND complete IS NOT NULL
      AND unassessed_segments IS NOT NULL AND parts IS NOT NULL
      AND completed_at IS NOT NULL
      AND jsonb_array_length(parts) = part_count
      AND (complete = false OR (unassessed_seconds = 0 AND unassessed_segments = 0))
    ELSE
      locale IS NULL AND score_scale IS NULL AND provider IS NULL
      AND summary_version IS NULL AND part_count IS NULL AND utterance_count IS NULL
      AND accuracy IS NULL AND fluency IS NULL AND words_to_practice IS NULL
      AND assessed_seconds IS NULL AND complete IS NULL AND unassessed_seconds IS NULL
      AND unassessed_segments IS NULL AND parts IS NULL AND completed_at IS NULL
    END
  ),
  CONSTRAINT oral_reading_pronunciation_checks_failure_only_when_failed CHECK (
    failure_code IS NULL OR status = 'failed'
  )
);

COMMENT ON TABLE public.oral_reading_pronunciation_checks IS
  'M5 English pronunciation check: one server-computed, immutable result per oral-reading attempt. Backend (service_role) access only.';

-- Supports ON DELETE CASCADE from auth.users.
CREATE INDEX oral_reading_pronunciation_checks_user_idx
  ON public.oral_reading_pronunciation_checks (user_id);

-- Owner/language guard and immutability. SECURITY INVOKER: it runs with the
-- writer's rights (service_role), reads only oral_reading_attempts, and has a
-- fixed empty search_path.
CREATE FUNCTION public.m5_pronunciation_check_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  attempt_owner uuid;
  attempt_language text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'A completed pronunciation check cannot be changed.'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'A pronunciation check cannot move to another attempt or account.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT a.user_id, a.language_snapshot
    INTO attempt_owner, attempt_language
    FROM public.oral_reading_attempts AS a
   WHERE a.id = NEW.attempt_id;

  IF attempt_owner IS NULL OR attempt_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'The pronunciation check must belong to the attempt owner.'
      USING ERRCODE = '23514';
  END IF;
  IF attempt_language = 'fil' THEN
    RAISE EXCEPTION 'Filipino readings have no pronunciation check.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.m5_pronunciation_check_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER m5_pronunciation_check_guard
  BEFORE INSERT OR UPDATE ON public.oral_reading_pronunciation_checks
  FOR EACH ROW EXECUTE FUNCTION public.m5_pronunciation_check_guard();

ALTER TABLE public.oral_reading_pronunciation_checks
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.oral_reading_pronunciation_checks
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oral_reading_pronunciation_checks
  TO service_role;

-- Ask the Supabase Data API to reload its schema cache when this commits.
-- Until it does, the backend sees the table as missing and safely reports each
-- check as "not saved" (it never claims a result was saved).
NOTIFY pgrst, 'reload schema';

COMMIT;
