-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- C9 (supabase/migrations/20261026_m8_trusted_xp.sql): immediately after DT1 and its checks.
-- Run one section at a time. Any result that differs from "Expect" means STOP.

-- P-C9a. Before C9. Expect 1 row, all true: DT1 applied; C2/C3 objects and triggers present.
select pg_catalog.to_regprocedure('public.m2_trusted_reading_level(uuid,text)') is not null as dt1_helper,
       exists (select 1 from information_schema.columns where table_schema = 'public'
         and table_name = 'diagnostic_results' and column_name = 'verification_status') as dt1_columns,
       exists (select 1 from pg_trigger where tgrelid = 'public.m6_comprehension_attempts'::regclass
         and tgname = 'm8_m6_completed' and not tgisinternal) as m8_completion_trigger,
       exists (select 1 from pg_trigger where tgrelid = 'public.diagnostic_results'::regclass
         and tgname = 'm8_diagnostic_sync' and not tgisinternal) as m8_diagnostic_trigger,
       pg_catalog.to_regprocedure('public.m8_grant_xp(uuid,text,uuid,integer)') is not null as m8_grant_xp;

-- P-C9b. Before C9. Record these numbers; V-C9c must preserve all history counts
-- and increase public_functions by 3 (C9 changes no XP event, badge or diagnostic row).
select (select count(*) from public.m8_xp_events) as xp_events,
       (select coalesce(sum(xp_earned), 0) from public.m8_xp_events) as xp_total,
       (select count(*) from public.m8_earned_badges) as earned_badges,
       (select count(*) from public.m8_earned_badges where badge_id = 'level_up') as level_up_badges,
       (select count(*) from public.diagnostic_results) as diagnostic_rows,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public') as public_functions;

-- P-C9c. Before C9. Module languages C9 will validate. Expect every row to have a
-- normalized value ('en' or 'fil'); a NULL means C9 would reject completions of that module.
select p.id, p.language as path_language,
       case lower(btrim(p.language)) when 'en' then 'en' when 'english' then 'en'
         when 'fil' then 'fil' when 'filipino' then 'fil' when 'tagalog' then 'fil'
         when 'fil-ph' then 'fil' when 'tl' then 'fil' when 'tl-ph' then 'fil' end as normalized,
       count(m.id) as modules
from public.learning_paths p left join public.modules m on m.path_id = p.id
group by 1, 2 order by 2, 1;

-- P-C9d. Before C9 AND after C9. Expect 4 rows, every client_access false.
-- A saved attempt is not authorization evidence if a browser can forge it.
select r.role_name, t.table_name,
       has_any_column_privilege(r.role_name, t.table_name, 'SELECT')
       or has_any_column_privilege(r.role_name, t.table_name, 'INSERT')
       or has_any_column_privilege(r.role_name, t.table_name, 'UPDATE')
       or has_table_privilege(r.role_name, t.table_name, 'DELETE,TRUNCATE,TRIGGER') as client_access
from (values ('anon'), ('authenticated')) r(role_name)
cross join (values ('public.m6_comprehension_attempts'), ('public.m6_comprehension_responses')) t(table_name);

-- P-C9e. Before C9: exactly 1 row; source_md5 ab592754ec820e5ed2533fa52a6adb7f,
-- definer true, search_path empty, anon/authenticated false, service_role true.
-- Save owner/ACL: V-C9h must preserve them. An unexpected hash means STOP, not bypass.
select pg_get_userbyid(p.proowner) as owner, p.proacl::text as acl, p.prosecdef, p.proconfig,
       md5(replace(p.prosrc, E'\r\n', E'\n')) as source_md5,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_proc p where p.oid = to_regprocedure('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)');

-- P-C9f. Before C9: save exactly 1 row, functions_count 4. V-C9i must match.
select count(*) as functions_count,
       md5(string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), E'\n'
         order by p.oid::regprocedure::text)) as m4_functions_md5
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('is_admin','m4_current_role','m6_is_enrolled_in_room','join_room_by_code');

-- V-C9a. C9 functions. Expect 6 rows; search_path pinned for all; anon/authenticated EXECUTE
-- false for all; security_definer true for the two M8 triggers and m6_apply_action only.
-- Replaced owners unchanged; helpers owned by the trusted migration owner.
select p.oid::regprocedure as function_name, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('m8_on_comprehension_completed', 'm8_sync_diagnostic',
  'm8_normalize_language', 'm8_verified_difficulty_summary', 'm6_assert_completion_access', 'm6_apply_action')
order by 1;

-- V-C9b. The completion trigger no longer rejects for difficulty and reads trusted levels.
-- Expect 1 row: locked_exception false, uses_trusted_level true, uses_unlocked_difficulty false.
select pg_get_functiondef('public.m8_on_comprehension_completed()'::regprocedure) like '%Reading difficulty is locked%' as locked_exception,
       pg_get_functiondef('public.m8_on_comprehension_completed()'::regprocedure) like '%m2_trusted_reading_level%' as uses_trusted_level,
       pg_get_functiondef('public.m8_on_comprehension_completed()'::regprocedure) like '%unlocked_difficulty%' as uses_unlocked_difficulty;

-- V-C9c. History unchanged. Expect exactly the P-C9b values, except public_functions = P-C9b + 3.
select (select count(*) from public.m8_xp_events) as xp_events,
       (select coalesce(sum(xp_earned), 0) from public.m8_xp_events) as xp_total,
       (select count(*) from public.m8_earned_badges) as earned_badges,
       (select count(*) from public.m8_earned_badges where badge_id = 'level_up') as level_up_badges,
       (select count(*) from public.diagnostic_results) as diagnostic_rows,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public') as public_functions;

-- V-C9d. Display summary equals verified evidence. Expect 0 rows.
select user_id, unlocked_difficulty, public.m8_verified_difficulty_summary(user_id) as expected
from public.m8_learner_progress
where unlocked_difficulty is distinct from public.m8_verified_difficulty_summary(user_id);

-- V-C9e. Triggers unchanged. Expect exactly 7 rows (as V12e), all tgenabled O.
select t.tgrelid::regclass as on_table, t.tgname as trigger_name, t.tgenabled
from pg_trigger t
where not t.tgisinternal and t.tgname ~ '^(m7|m8)_'
  and t.tgrelid in (to_regclass('public.diagnostic_results'), to_regclass('public.oral_reading_attempts'),
    to_regclass('public.m6_comprehension_attempts'), to_regclass('public.enrollments'),
    to_regclass('public.rooms'), to_regclass('public.profiles'))
order by 1, 2;

-- V-C9f. Totals (C8 checkpoint after DT1). Expect public_tables 31, public_policies 70,
-- tables_without_rls 0, storage_policies 4, badges 8, m8_functions 12, m8_triggers 5.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity) as tables_without_rls,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies,
       (select count(*) from public.m8_badges) as badges,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'm8\_%') as m8_functions,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgname like 'm8\_%') as m8_triggers;

-- V-C9g. INFORMATIONAL (no expected value). Historical level_up badges with no verified
-- Instructional/Independent result. C9 keeps them; they grant no XP or unlock.
select b.user_id, b.earned_at
from public.m8_earned_badges b
where b.badge_id = 'level_up' and not exists (
  select 1 from public.diagnostic_results d where d.user_id = b.user_id
    and d.verification_status = 'server_verified' and d.reading_level in ('Instructional', 'Independent'))
order by 2, 1;

-- V-C9h. Exactly 1 row: source_md5 ab1569a4dab7fffd71e7ff1315dd5971;
-- owner/ACL same as P-C9e, definer true, search_path empty, client EXECUTE false,
-- service_role true. Also repeat P-C9d (all false).
select pg_get_userbyid(p.proowner) as owner, p.proacl::text as acl, p.prosecdef, p.proconfig,
       md5(replace(p.prosrc, E'\r\n', E'\n')) as source_md5,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
from pg_proc p where p.oid = to_regprocedure('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)');

-- V-C9i. Exactly the P-C9f count and fingerprint (M4 definitions/grants unchanged).
select count(*) as functions_count,
       md5(string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), E'\n'
         order by p.oid::regprocedure::text)) as m4_functions_md5
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('is_admin','m4_current_role','m6_is_enrolled_in_room','join_room_by_code');
