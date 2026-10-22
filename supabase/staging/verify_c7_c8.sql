-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP C7-C8 (supabase/migrations/20261024_m7_analytics.sql, then
-- supabase/migrations/20261024_m7_weekly_reports.sql) and the FULL STAGE C CHECKPOINT.
-- Run P12* before C7, V12* after C8, then audit_stage_b.sql A1-A8. Keep
-- M7_RISK_WORKER_ENABLED off. A mismatch means STOP.

-- P12a. C7 is install-once. Expect m7_tables 0, m7_functions 0, m7_sequence false.
-- Any M7 object already present = STOP; do not replay C7.
select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'm7\_%') as m7_tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'm7\_%') as m7_functions,
       to_regclass('public.m7_risk_generation') is not null as m7_sequence;

-- P12b. C7 dependencies. Expect has_scoring_rpc true, has_enrollment_id true,
-- m6_users_missing_profiles 0 (C7 aborts otherwise).
select to_regprocedure('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)') is not null as has_scoring_rpc,
       exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name = 'enrollments' and column_name = 'id') as has_enrollment_id,
       (select count(*) from public.m6_comprehension_attempts a
        where not exists (select 1 from public.profiles p where p.id = a.user_id)) as m6_users_missing_profiles;

-- V12a. M7/weekly report tables. Expect 4 rows: present, rls true; anon_privileges empty;
-- authenticated_privileges SELECT on m7_interventions and m7_risk_events only, empty on
-- m7_risk_queue and weekly_reports (service-role only).
select t.name, c.oid is not null as present, c.relrowsecurity as rls,
       array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
         where has_table_privilege('anon', c.oid, p)), ',') as anon_privileges,
       array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
         where has_table_privilege('authenticated', c.oid, p)), ',') as authenticated_privileges
from unnest(array['m7_risk_queue', 'm7_risk_events', 'm7_interventions', 'weekly_reports']) t(name)
left join pg_class c on c.oid = to_regclass('public.' || t.name)
order by 1;

-- V12b. Teacher-only read policies. Expect 2 rows, permissive SELECT for {authenticated}:
-- m7_events_teacher_read (m7_risk_events), m7_interventions_teacher_read (m7_interventions),
-- each limited to the approved teacher of an enrolled student.
select tablename, policyname, permissive, cmd, roles, qual
from pg_policies where schemaname = 'public' and tablename like 'm7\_%'
order by 1, 2;

-- V12c. M7 functions are backend-only. Expect 4 rows: anon false, authenticated false;
-- m7_save_evaluation service_role_execute true.
select e.sig as function_name, p.oid is not null as present,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       coalesce(p.proconfig, '{}') @> array['search_path=""'] as search_path_pinned
from unnest(array['public.m7_save_evaluation(uuid,bigint)', 'public.m7_enqueue_completion()',
                  'public.m7_enqueue_enrollment()', 'public.m7_enqueue_authorization_change()']) e(sig)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by 1;

-- V12d. Risk-queue sequence. Expect present true, service_role_usage true,
-- anon_any false, authenticated_any false.
select to_regclass('public.m7_risk_generation') is not null as present,
       has_sequence_privilege('service_role', 'public.m7_risk_generation', 'USAGE') as service_role_usage,
       has_sequence_privilege('anon', 'public.m7_risk_generation', 'USAGE,SELECT,UPDATE') as anon_any,
       has_sequence_privilege('authenticated', 'public.m7_risk_generation', 'USAGE,SELECT,UPDATE') as authenticated_any;

-- V12e. Every M7/M8 trigger on pre-existing M1/M2/M4/M5/M6 tables. Expect exactly 7 rows,
-- tgenabled O. A failing trigger rolls back the learner/teacher write it runs inside.
select t.tgrelid::regclass as on_table, t.tgname as trigger_name, t.tgenabled
from pg_trigger t
where not t.tgisinternal and t.tgname ~ '^(m7|m8)_'
  and t.tgrelid in (to_regclass('public.diagnostic_results'), to_regclass('public.oral_reading_attempts'),
    to_regclass('public.m6_comprehension_attempts'), to_regclass('public.enrollments'),
    to_regclass('public.rooms'), to_regclass('public.profiles'))
order by 1, 2;

-- V12f. Storage at the end of Stage C. Expect 2 rows, both public false:
-- oral-reading-recordings and reading-materials, file_size_limit 26214400.
select id, public, file_size_limit from storage.buckets
where id in ('oral-reading-recordings', 'reading-materials') order by 1;

-- V12g. Final totals. Expect public_tables 31, public_policies 72, storage_policies 4,
-- tables_without_rls 0, badge_catalogue 8.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) as tables_without_rls,
       (select count(*) from public.m8_badges) as badge_catalogue;
