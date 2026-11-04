begin read only;
-- READ ONLY. Run on ReadFlow-Staging AFTER
-- supabase/proposed/m5_pronunciation_checks_PROPOSED.sql.

-- V1. Objects exist. Expect all non-null.
select to_regclass('public.oral_reading_pronunciation_checks') as checks_table,
  to_regclass('public.oral_reading_pronunciation_checks_user_idx') as user_index,
  to_regprocedure('public.m5_pronunciation_check_guard()') as guard_function;

-- V2. RLS on, no policies (backend-only table). Expect rls = true, policies = 0.
select c.relrowsecurity as rls,
  (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c where c.oid = 'public.oral_reading_pronunciation_checks'::regclass;

-- V3. Privileges, one privilege per column (a comma list in has_table_privilege
-- is true when ANY one is held, so it is never used here).
-- Expect every anon_* / authenticated_* column false and every service_* column true.
select
  has_table_privilege('anon', 'public.oral_reading_pronunciation_checks', 'SELECT') as anon_select,
  has_table_privilege('anon', 'public.oral_reading_pronunciation_checks', 'INSERT') as anon_insert,
  has_table_privilege('anon', 'public.oral_reading_pronunciation_checks', 'UPDATE') as anon_update,
  has_table_privilege('anon', 'public.oral_reading_pronunciation_checks', 'DELETE') as anon_delete,
  has_table_privilege('authenticated', 'public.oral_reading_pronunciation_checks', 'SELECT') as authenticated_select,
  has_table_privilege('authenticated', 'public.oral_reading_pronunciation_checks', 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', 'public.oral_reading_pronunciation_checks', 'UPDATE') as authenticated_update,
  has_table_privilege('authenticated', 'public.oral_reading_pronunciation_checks', 'DELETE') as authenticated_delete,
  has_table_privilege('authenticated', 'public.oral_reading_pronunciation_checks', 'TRUNCATE') as authenticated_truncate,
  has_function_privilege('authenticated', 'public.m5_pronunciation_check_guard()', 'EXECUTE') as authenticated_guard_execute,
  has_table_privilege('service_role', 'public.oral_reading_pronunciation_checks', 'SELECT') as service_select,
  has_table_privilege('service_role', 'public.oral_reading_pronunciation_checks', 'INSERT') as service_insert,
  has_table_privilege('service_role', 'public.oral_reading_pronunciation_checks', 'UPDATE') as service_update,
  -- The guard trigger runs as the caller (service_role) and reads these two tables.
  has_table_privilege('service_role', 'public.oral_reading_attempts', 'SELECT') as service_select_attempts,
  has_table_privilege('service_role', 'public.oral_reading_recordings', 'SELECT') as service_select_recordings;

-- V3b. The backend role bypasses RLS (the table has no policies by design).
-- Expect service_role = true; anon and authenticated = false.
select rolname, rolbypassrls from pg_roles
where rolname in ('anon', 'authenticated', 'service_role') order by rolname;

-- V4. Constraints. Expect the primary key, both foreign keys (ON DELETE CASCADE)
-- and the status/result checks.
select conname, contype, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.oral_reading_pronunciation_checks'::regclass
order by contype, conname;

-- V5. Guard trigger and function settings. Expect one BEFORE INSERT OR UPDATE
-- trigger; prosecdef = false (SECURITY INVOKER); proconfig = {search_path=""}.
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.oral_reading_pronunciation_checks'::regclass and not tgisinternal;
select proname, prosecdef, proconfig from pg_proc
where oid = 'public.m5_pronunciation_check_guard()'::regprocedure;

-- V6. Existing data unchanged. Compare with preflight P5; checks_total = 0.
select
  (select count(*) from public.oral_reading_attempts) as attempts_total,
  (select count(*) from public.oral_reading_attempts where language_snapshot = 'en') as attempts_en,
  (select count(*) from public.oral_reading_attempts where language_snapshot = 'fil') as attempts_fil,
  (select count(*) from public.oral_reading_attempts where language_snapshot is null) as attempts_language_unknown,
  (select count(*) from public.oral_reading_recordings) as recordings_total,
  (select md5(coalesce(string_agg(id::text || ':' || pronunciation_accuracy::text || ':' || reading_speed_wpm::text, ',' order by id), ''))
     from public.oral_reading_attempts) as attempts_score_fingerprint,
  (select count(*) from public.oral_reading_pronunciation_checks) as checks_total;

-- V7. Triggers on oral_reading_attempts unchanged. Compare with preflight P6.
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.oral_reading_attempts'::regclass and not tgisinternal
order by tgname;

rollback;

-- ----------------------------------------------------------------------------
-- OPTIONAL behaviour smoke test. It writes inside a transaction that is
-- ALWAYS rolled back, so nothing is kept. Run it only with approval. It needs
-- one existing English and (optionally) one Filipino attempt on staging.
-- ----------------------------------------------------------------------------
-- begin;
-- set local role service_role;
-- -- S1 claim, complete; then a second claim for the same attempt must fail (23505).
-- with a as (select id, user_id from public.oral_reading_attempts where language_snapshot = 'en' limit 1)
-- insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id)
-- select id, user_id, 'running', gen_random_uuid() from a returning attempt_id;
-- update public.oral_reading_pronunciation_checks set status = 'completed', locale = 'en-US', score_scale = '0-100',
--   provider = 'azure', summary_version = 1, part_count = 1, utterance_count = 0, words_to_practice = '[]',
--   assessed_seconds = 10, complete = true, unassessed_seconds = 0, unassessed_segments = 0,
--   parts = '[{"utterances":[],"complete":true}]', completed_at = now()
-- where status = 'running' returning attempt_id, status;
-- -- S2 completed rows are immutable: expect ERROR "A completed pronunciation check cannot be changed."
-- update public.oral_reading_pronunciation_checks set accuracy = 99;
-- rollback;
-- begin;
-- set local role service_role;
-- -- S3 Filipino attempts are refused: expect ERROR "Filipino readings have no pronunciation check."
-- insert into public.oral_reading_pronunciation_checks (attempt_id, user_id, status, claim_id)
-- select id, user_id, 'running', gen_random_uuid() from public.oral_reading_attempts where language_snapshot = 'fil' limit 1;
-- rollback;
