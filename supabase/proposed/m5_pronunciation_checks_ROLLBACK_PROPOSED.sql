-- ============================================================================
-- PROPOSED ROLLBACK — NOT APPLIED. Do not run without explicit approval.
-- Reverses supabase/proposed/m5_pronunciation_checks_PROPOSED.sql only.
--
-- !!! PERMANENT DATA DELETION !!!
-- Running this DELETES EVERY SAVED PRONUNCIATION CHECK (learner F2/F3/F4
-- results and Teacher review data). It cannot be undone. Learners would have to
-- run new, paid pronunciation checks to see results again.
--
-- BEFORE running it, back up the table into a schema the Data API does NOT
-- expose. Do NOT create the backup in "public": Supabase grants new public
-- tables to anon/authenticated and RLS is off by default, so a public backup
-- table would expose every student's results through the API.
-- Backup (run separately, in the Supabase SQL editor, and check the row count):
--
--   create schema if not exists m5_backup;
--   revoke all on schema m5_backup from public, anon, authenticated;
--   create table m5_backup.pronunciation_checks_YYYYMMDD as
--     table public.oral_reading_pronunciation_checks;
--   revoke all on m5_backup.pronunciation_checks_YYYYMMDD from public, anon, authenticated;
--   select count(*) from m5_backup.pronunciation_checks_YYYYMMDD;  -- must equal the live count
--
-- (psql users may instead use \copy to a local CSV; \copy does not work in the
-- Supabase SQL editor.)
--
-- Order: deploy (or keep) a backend that tolerates the missing table first.
-- The current backend does: without the table it runs checks but reports each
-- result as "not saved", never as saved.
--
-- No other object is touched: oral_reading_attempts, oral_reading_recordings,
-- M6, M7 and M8 data are unchanged.
-- ============================================================================

BEGIN;

-- Dropping the table also drops its trigger.
DROP TABLE IF EXISTS public.oral_reading_pronunciation_checks;
DROP FUNCTION IF EXISTS public.m5_pronunciation_check_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;
