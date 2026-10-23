-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- DT1 (supabase/migrations/20261025_m2_trusted_diagnostics.sql): after C8, before C9.
-- Run one section at a time. Any result that differs from "Expect" means STOP.

-- P-DT1a. Before DT1. Expect 1 row: has_status_column false, b6_key true, m8_sync_trigger true.
select exists (select 1 from information_schema.columns where table_schema = 'public'
         and table_name = 'diagnostic_results' and column_name = 'verification_status') as has_status_column,
       exists (select 1 from pg_constraint where conrelid = 'public.diagnostic_results'::regclass
         and conname = 'diagnostic_results_user_language_version_key') as b6_key,
       exists (select 1 from pg_trigger where tgrelid = 'public.diagnostic_results'::regclass
         and tgname = 'm8_diagnostic_sync' and not tgisinternal) as m8_sync_trigger;

-- P-DT1b. Before DT1. Record these counts; V-DT1a must report the same totals.
select language, count(*) as rows, count(distinct user_id) as learners
from public.diagnostic_results group by 1 order by 1;

-- P-DT1c. Before DT1. Expect authenticated SELECT, INSERT, UPDATE true; DELETE false.
select has_table_privilege('authenticated', 'public.diagnostic_results', 'SELECT') as can_select,
       has_table_privilege('authenticated', 'public.diagnostic_results', 'INSERT') as can_insert,
       has_table_privilege('authenticated', 'public.diagnostic_results', 'UPDATE') as can_update,
       has_table_privilege('authenticated', 'public.diagnostic_results', 'DELETE') as can_delete;

-- P-DT1d. Before DT1. Expect 4 rows: 3 PERMISSIVE (read/insert/update own results) and
-- the B16 RESTRICTIVE "M1 Teacher approval required" (ALL).
select policyname, permissive, cmd from pg_policies
where schemaname = 'public' and tablename = 'diagnostic_results' order by 2, 1;

-- P-DT1e. Before DT1. Record both numbers; V-DT1h expects public_functions + 2 and
-- public_policies - 2 (72 -> 70 after the C7-C8 checkpoint).
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public') as public_functions,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies;

-- V-DT1a. Every pre-existing row is kept and unverified. Expect the P-DT1b counts in
-- the 'unverified' rows and no 'server_verified' rows yet.
select verification_status, language, count(*) as rows
from public.diagnostic_results group by 1, 2 order by 1, 2;

-- V-DT1b. Client privileges. Expect authenticated can_select true and every other column
-- false; anon all false.
select r.rolname,
       has_table_privilege(r.oid, 'public.diagnostic_results', 'SELECT') as can_select,
       has_any_column_privilege(r.oid, 'public.diagnostic_results', 'INSERT') as can_insert,
       has_any_column_privilege(r.oid, 'public.diagnostic_results', 'UPDATE') as can_update,
       has_table_privilege(r.oid, 'public.diagnostic_results', 'DELETE') as can_delete,
       has_table_privilege(r.oid, 'public.diagnostic_results', 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') as can_manage
from pg_roles r where r.rolname in ('anon', 'authenticated') order by 1;

-- V-DT1c. Policies on diagnostic_results. Expect exactly 2 rows:
-- "Users can read their diagnostic results" PERMISSIVE SELECT {authenticated}, and
-- "M1 Teacher approval required" RESTRICTIVE ALL {authenticated} (B16, unchanged).
select policyname, permissive, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'diagnostic_results' order by 2, 1;

-- V-DT1d. Uniqueness. Expect 4 rows: diagnostic_results_pkey plus the partial unique indexes
-- diagnostic_results_unverified_version_key, _verified_version_key, _verified_recording_key.
select indexrelid::regclass as index_name, pg_get_indexdef(indexrelid) as definition
from pg_index where indrelid = 'public.diagnostic_results'::regclass and indisunique order by 1;

-- V-DT1e. Constraints. Expect diagnostic_results_verification_evidence_check and
-- diagnostic_results_verification_status_check, both convalidated true.
select conname, convalidated from pg_constraint
where conrelid = 'public.diagnostic_results'::regclass and conname like '%verification%' order by 1;

-- V-DT1f. Triggers on diagnostic_results. Expect 3 rows, all tgenabled O:
-- diagnostic_results_protect_verification (BEFORE INSERT OR UPDATE),
-- diagnostic_results_set_updated_at, m8_diagnostic_sync.
select tgname, tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid = 'public.diagnostic_results'::regclass and not tgisinternal order by 1;

-- V-DT1g. DT1 functions. Expect 2 rows; security_definer false; proconfig {search_path=""};
-- anon/authenticated EXECUTE false for both; service_role true for m2_trusted_reading_level.
-- Neither is SECURITY DEFINER, so A5 is unchanged; neither is client-callable, so A7 is unchanged.
select p.oid::regprocedure as function_name, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('m2_protect_diagnostic_verification', 'm2_trusted_reading_level')
order by 1;

-- V-DT1h. Totals. Expect public_tables 31, public_functions = P-DT1e + 2,
-- public_policies = P-DT1e - 2 (70 after C8), tables_without_rls 0.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public') as public_functions,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity) as tables_without_rls;

-- V-DT1i. Eligibility helper. Expect 0 rows now: no learner has verified evidence yet,
-- so C9 would grant no difficulty-dependent XP from historical rows.
select d.user_id, d.language, public.m2_trusted_reading_level(d.user_id, d.language) as trusted_level
from (select distinct user_id, language from public.diagnostic_results) d
where public.m2_trusted_reading_level(d.user_id, d.language) is not null;

-- V-DT1j. INFORMATIONAL for C9 (no expected value). M8 state that pre-DT1 (unverified)
-- rows already produced: unlocks above Easy and level_up badges for learners without any
-- server-verified diagnostic. C3 still authorizes from unlocked_difficulty until C9.
select p.user_id, p.unlocked_difficulty,
       exists (select 1 from public.m8_earned_badges b
               where b.user_id = p.user_id and b.badge_id = 'level_up') as has_level_up
from public.m8_learner_progress p
where not exists (select 1 from public.diagnostic_results d
                  where d.user_id = p.user_id and d.verification_status = 'server_verified')
  and (p.unlocked_difficulty <> 'Easy'
       or exists (select 1 from public.m8_earned_badges b where b.user_id = p.user_id and b.badge_id = 'level_up'))
order by 1;
