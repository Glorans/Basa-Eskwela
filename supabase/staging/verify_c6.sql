-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- C6 = readflow/supabase/migrations/20261023000000_m8_independent_leaderboard.sql (original, unchanged;
-- SHA-256 91a9f3582ed48a4bef666c3a008cf58a0f079dde9b7e6c40dfc48f66afa1f388).
-- Prepared checks; none executed. Run ONE section at a time at its stated checkpoint.
-- B1-B26 and C1-C5 already applied and verified; never rerun them. Do not apply C7-C8 here.
-- Before C6: P-C6a..P-C6e (save P-C6d output). After C6: V-C6a..V-C6f, then
-- verify_c2_c6.sql V11a-V11f, verify_c5.sql V-C5f/V-C5g (regression), then audit_stage_b.sql A1-A8.
-- After C6 do NOT rerun verify_c5.sql V-C5c or V-C5d: they assert the pre-C6 inventory
-- (9 functions; weekly leaderboard as the only client RPC) and fail by design. V-C6c/V-C6d replace them.
-- These are catalog checks. They do not prove runtime behaviour; see the runtime tests at the end.
-- Any false/NULL as_expected, incorrect count, unexpected row or SQL error means STOP.

-- P-C6a. Before C6 ONLY. Expect one row:
-- c6_function_present false, c6_overloads 0, m8_functions 9, m8_triggers 5, badges 8,
-- public_tables 27, public_policies 70, storage_policies 4.
select to_regprocedure('public.m8_independent_leaderboard(text)') is not null as c6_function_present,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'm8_independent_leaderboard') as c6_overloads,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'm8\_%') as m8_functions,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'm8\_%') as m8_triggers,
       (select count(*) from public.m8_badges) as badges,
       (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;

-- P-C6b. Before C6 ONLY. Columns C6 reads. Expect exactly 8 rows, as_expected true in every row.
select e.rel, e.col, e.typ as expected_type, a.atttypid::regtype::text as actual_type,
       coalesce(a.atttypid = e.typ::regtype, false) as as_expected
from (values ('public.profiles', 'id', 'uuid'),
             ('public.profiles', 'role', 'text'),
             ('public.profiles', 'nickname', 'text'),
             ('public.m8_xp_events', 'user_id', 'uuid'),
             ('public.m8_xp_events', 'xp_earned', 'integer'),
             ('public.m8_xp_events', 'created_at', 'timestamp with time zone'),
             ('public.m8_learner_progress', 'user_id', 'uuid'),
             ('public.m8_learner_progress', 'unlocked_difficulty', 'text')) e(rel, col, typ)
left join pg_attribute a on a.attrelid = to_regclass(e.rel) and a.attname = e.col
  and a.attnum > 0 and not a.attisdropped
order by 1, 2;

-- P-C6c. Before C6 ONLY. Other dependencies. Expect one row, every column true.
-- The two single-column unique keys guarantee one leaderboard row per learner (no duplicates).
select to_regprocedure('auth.uid()') is not null as auth_uid_present,
       exists (select 1 from pg_constraint
               where conrelid = to_regclass('public.profiles') and conname = 'profiles_role_check'
                 and pg_get_constraintdef(oid) like '%general_user%') as role_check_has_general_user,
       exists (select 1 from pg_index i join pg_attribute a
                 on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
               where i.indrelid = to_regclass('public.profiles') and i.indisunique
                 and i.indnatts = 1 and a.attname = 'id') as profiles_id_unique,
       exists (select 1 from pg_index i join pg_attribute a
                 on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
               where i.indrelid = to_regclass('public.m8_learner_progress') and i.indisunique
                 and i.indnatts = 1 and a.attname = 'user_id') as progress_user_unique,
       exists (select 1 from pg_roles where rolname = 'authenticated') as authenticated_role_present;

-- P-C6d. Before C6 ONLY. Classroom leaderboard fingerprint. Expect exactly 1 row.
-- SAVE weekly_def_md5 and weekly_acl; V-C6e must return the identical values after C6.
-- The md5 value itself cannot be predicted here; it only has to stay unchanged.
select md5(pg_get_functiondef(p.oid)) as weekly_def_md5, p.proacl::text as weekly_acl
from pg_proc p where p.oid = to_regprocedure('public.m8_weekly_leaderboard()');

-- P-C6e. Before C6 ONLY. Informational demo-data preview; no fixed expectation.
-- general_user_profiles is how many rows the leaderboard can show (max 100).
-- On a database with only synthetic accounts these counts reflect the test users you created.
select (select count(*) from public.profiles where role = 'general_user') as general_user_profiles,
       (select count(*) from public.profiles where role = 'general_user'
          and coalesce(nickname, '') = '') as without_nickname_shown_as_reader_prefix,
       (select count(distinct x.user_id) from public.m8_xp_events x
          join public.profiles p on p.id = x.user_id where p.role = 'general_user') as general_users_with_xp;

-- V-C6a. Immediately after C6. Expect exactly 1 row, as_expected true.
-- SECURITY DEFINER, STABLE (PL/pgSQL then rejects any write in the body), empty search_path,
-- unchanged signature/result shape, same owner as the other M8 definers, and EXECUTE only for
-- authenticated (no PUBLIC, no anon, no grant option).
select p.oid::regprocedure as function_name, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.provolatile, p.proconfig,
       pg_get_function_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       coalesce(p.prosecdef
         and p.provolatile = 's'
         and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
         and p.proretset
         and p.proconfig = array['search_path=""']
         and pg_get_function_arguments(p.oid) = 'p_period text DEFAULT ''weekly''::text'
         and pg_get_function_result(p.oid) = 'TABLE(user_id uuid, display_name text, xp bigint, difficulty text)'
         and p.proowner = (select proowner from pg_proc
                           where oid = to_regprocedure('public.m8_grant_xp(uuid,text,uuid,integer)'))
         and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated')
         and not has_function_privilege('public', p.oid, 'EXECUTE')
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE WITH GRANT OPTION'), false) as as_expected
from (values ('public.m8_independent_leaderboard(text)')) e(sig)
left join pg_proc p on p.oid = to_regprocedure(e.sig);

-- V-C6b. Explicit ACL entries on the new function. Expect as_expected true in every row.
-- Typical Supabase grantees: the owner (postgres), authenticated and service_role (service_role
-- comes from platform default privileges; it is a trusted backend role and the function raises
-- 42501 for it because auth.uid() is NULL). A PUBLIC or anon row means STOP.
-- Any other grantee is unexpected: STOP and investigate before continuing.
select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type, a.is_grantable,
       a.grantee <> 0 and pg_get_userbyid(a.grantee) <> 'anon'
         and (a.grantee = p.proowner or not a.is_grantable)
         and (a.grantee = p.proowner or pg_get_userbyid(a.grantee) in ('authenticated', 'service_role'))
         as as_expected
from pg_proc p cross join lateral aclexplode(p.proacl) a
where p.oid = to_regprocedure('public.m8_independent_leaderboard(text)')
order by 1;

-- V-C6c. Inventory after C6 (replaces V-C5c). Expect one row:
-- m8_functions 10, m8_triggers 5, independent_overloads 1, badges 8,
-- public_tables 27, public_policies 70, storage_policies 4.
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'm8\_%') as m8_functions,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'm8\_%') as m8_triggers,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'm8_independent_leaderboard') as independent_overloads,
       (select count(*) from public.m8_badges) as badges,
       (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;

-- V-C6d. Every M8 function, not only a fixed list (replaces V-C5d). Expect 0 rows.
-- Any row is an M8 function that is not SECURITY DEFINER, has an unpinned search_path,
-- is executable by PUBLIC/anon, can be re-granted, or whose authenticated EXECUTE differs from
-- "true for the two leaderboard RPCs, false for everything else".
select p.oid::regprocedure as function_name, p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'm8\_%'
  and (not p.prosecdef
    or not coalesce(p.proconfig, '{}') @> array['search_path=""']
    or has_function_privilege('public', p.oid, 'EXECUTE')
    or has_function_privilege('anon', p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE WITH GRANT OPTION')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       <> (p.oid in (to_regprocedure('public.m8_weekly_leaderboard()'),
                     to_regprocedure('public.m8_independent_leaderboard(text)'))))
order by 1;

-- V-C6e. Classroom leaderboard unchanged. Expect exactly 1 row whose weekly_def_md5 and
-- weekly_acl are IDENTICAL to the values saved from P-C6d. Any difference means STOP.
select md5(pg_get_functiondef(p.oid)) as weekly_def_md5, p.proacl::text as weekly_acl
from pg_proc p where p.oid = to_regprocedure('public.m8_weekly_leaderboard()');

-- V-C6f. C6 reads but never writes M8 data. Expect 0 rows.
-- No public function other than the existing trusted paths references m8_xp_events or
-- m8_learner_progress with a write keyword; the new leaderboard must not appear here.
select p.oid::regprocedure as function_name
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'm8_independent_leaderboard'
  and (p.prosrc ~* '\m(insert|update|delete|truncate|merge)\M' or p.provolatile <> 's');

-- RUNTIME TESTS (not SQL; use the app with SYNTHETIC accounts after the catalog checks pass).
-- These are what prove behaviour; the SELECTs above only prove catalog/security state.
-- R1 independent learner (role general_user): Global Leaderboard loads; own row highlighted
--    "You (<nickname>)"; "This week" and "All time" both load; a learner with no XP shows 0 XP, Easy.
-- R2 student: calling the RPC returns error "Independent learner access required" (42501);
--    the classroom leaderboard still works exactly as before C6.
-- R3 teacher (and admin): same 42501 error from the independent leaderboard.
-- R4 independent learner completes one module: XP appears in both periods; it appears in "This week"
--    only for events since Monday 00:00 Asia/Manila. Repeating the same module adds no XP.
-- R5 signed out (anon): the RPC is refused (permission denied), not an empty list.
