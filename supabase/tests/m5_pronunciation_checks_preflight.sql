begin read only;
-- READ ONLY. Run on ReadFlow-Staging BEFORE
-- supabase/proposed/m5_pronunciation_checks_PROPOSED.sql and save the output:
-- the counts in P5 are compared after the migration.

-- P1. Required M5 objects exist; the new/superseded tables do not yet.
-- Expect: attempts and recordings non-null; checks_table, superseded_parts_table
-- and guard_function null.
select to_regclass('public.oral_reading_attempts') as attempts,
  to_regclass('public.oral_reading_recordings') as recordings,
  to_regclass('public.oral_reading_pronunciation_checks') as checks_table,
  to_regclass('public.oral_reading_pronunciation_parts') as superseded_parts_table,
  to_regprocedure('public.m5_pronunciation_check_guard()') as guard_function;

-- P2. Columns the migration and backend rely on. Expect 3 rows:
-- id uuid, user_id uuid, language_snapshot text.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'oral_reading_attempts'
  and column_name in ('id', 'user_id', 'language_snapshot')
order by column_name;

-- P3. id is the primary key of oral_reading_attempts (FK target). Expect 1 row.
select c.conname, pg_get_constraintdef(c.oid)
from pg_constraint c
where c.conrelid = 'public.oral_reading_attempts'::regclass and c.contype = 'p';

-- P4. Roles the grants use. Expect 3 rows; service_role rolbypassrls = true.
select rolname, rolbypassrls from pg_roles
where rolname in ('anon', 'authenticated', 'service_role') order by rolname;

-- P4b. The backend (service_role) can read the tables the new code and guard
-- trigger read. Expect both true.
select has_table_privilege('service_role', 'public.oral_reading_attempts', 'SELECT') as service_select_attempts,
  has_table_privilege('service_role', 'public.oral_reading_recordings', 'SELECT') as service_select_recordings;

-- P4c. Language values the backend and trigger rely on. Expect odd_language = 0.
-- no_language rows are classified from their learning path by the backend.
select count(*) filter (where language_snapshot is null) as no_language,
  count(*) filter (where language_snapshot not in ('en', 'fil')) as odd_language
from public.oral_reading_attempts;

-- P4d. Saved recording shapes (the backend requires one uploaded WAV per file).
-- Expect max_files <= 32 and duplicate_paths = 0.
select count(*) as recordings,
  count(*) filter (where jsonb_array_length(segments) > 1) as multi_file_recordings,
  max(jsonb_array_length(segments)) as max_files,
  count(*) filter (where (select count(distinct value) from jsonb_array_elements_text(segments)) <> jsonb_array_length(segments)) as duplicate_paths
from public.oral_reading_recordings;

-- P5. Baseline counts (unchanged by the migration). Save these numbers.
select
  (select count(*) from public.oral_reading_attempts) as attempts_total,
  (select count(*) from public.oral_reading_attempts where language_snapshot = 'en') as attempts_en,
  (select count(*) from public.oral_reading_attempts where language_snapshot = 'fil') as attempts_fil,
  (select count(*) from public.oral_reading_attempts where language_snapshot is null) as attempts_language_unknown,
  (select count(*) from public.oral_reading_recordings) as recordings_total,
  (select md5(coalesce(string_agg(id::text || ':' || pronunciation_accuracy::text || ':' || reading_speed_wpm::text, ',' order by id), ''))
     from public.oral_reading_attempts) as attempts_score_fingerprint;

-- P6. Existing triggers on oral_reading_attempts (unchanged by the migration).
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.oral_reading_attempts'::regclass and not tgisinternal
order by tgname;

-- P7. Nothing else already depends on the names this migration creates.
-- Expect 0 rows.
select n.nspname, c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relname in ('oral_reading_pronunciation_checks', 'oral_reading_pronunciation_checks_user_idx')
union all
select n.nspname, p.proname, 'f' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'm5_pronunciation_check_guard';

rollback;
