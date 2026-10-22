-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- Prepared checks; none executed. Run ONE section at a time at its stated checkpoint.
-- B1-B26/C1 already applied and verified; never rerun them. P11a already passed.
-- After each C2/C3 file: run its V sections below, then verify_c2_c6.sql V11a/V11b/V11e/V11f,
-- then audit_stage_b.sql A1-A8. Do not run the full post-C6 V11c/V11d yet.
-- Any false/NULL as_expected, incorrect count, unexpected row or SQL error means STOP.

-- P11b. Before C2 ONLY: P11a checked tables, not orphaned functions/triggers.
-- Expect 0 rows. A match requires review before CREATE OR REPLACE / DROP TRIGGER.
select 'function' as object_kind, p.oid::regprocedure::text as object_name
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'm8\_%'
union all
select 'trigger', t.tgrelid::regclass::text || '.' || t.tgname
from pg_trigger t join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'm8\_%'
order by 1, 2;

-- V-C2a. Immediately after hardened C2. Expect 5 rows, ALL as_expected true.
-- All SECURITY DEFINER, search_path empty, PUBLIC/anon false; authenticated true ONLY for weekly leaderboard.
select e.sig as function_name, p.oid is not null as present,
       p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       coalesce(p.oid is not null and p.prosecdef
         and p.prorettype = to_regtype(e.return_type)
         and coalesce(p.proconfig, '{}') @> array['search_path=""']
         and not has_function_privilege('public', p.oid, 'EXECUTE')
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.authenticated
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE WITH GRANT OPTION'), false) as as_expected
from (values
  ('public.m8_sync_diagnostic()', false, 'trigger'),
  ('public.m8_oral_completed()', false, 'trigger'),
  ('public.m8_grant_xp(uuid,text,uuid,integer)', false, 'boolean'),
  ('public.m8_record_reading_day(uuid,date)', false, 'void'),
  ('public.m8_weekly_leaderboard()', true, 'record')
) e(sig, authenticated, return_type)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by 1;

-- V-C2b. Expect 2 rows, ALL as_expected true, enabled O.
-- Review definition: row-level AFTER INSERT; diagnostic also UPDATE OF reading_level,
-- M6 (C3 only) also UPDATE OF status. No WHEN condition or trigger arguments.
select e.on_table, e.trigger_name, t.tgenabled,
       pg_get_triggerdef(t.oid) as definition,
       coalesce(t.tgenabled = 'O' and t.tgfoid = to_regprocedure(e.function_name)
         and t.tgtype = e.trigger_type and t.tgnargs = 0 and t.tgqual is null, false) as as_expected
from (values
  ('public.diagnostic_results', 'm8_diagnostic_sync', 'public.m8_sync_diagnostic()', 21),
  ('public.oral_reading_attempts', 'm8_oral_completed_trigger', 'public.m8_oral_completed()', 5)
) e(on_table, trigger_name, function_name, trigger_type)
left join pg_trigger t on t.tgrelid = to_regclass(e.on_table)
  and t.tgname = e.trigger_name and not t.tgisinternal
order by 1, 2;

-- V-C2c. Inventory catches unexpected extra M8 objects. Expect functions 5, triggers 2.
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'm8\_%') as m8_functions,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'm8\_%') as m8_triggers;

-- V-C3a. Immediately after hardened C3. Expect 8 rows, ALL as_expected true.
-- All SECURITY DEFINER, search_path empty, PUBLIC/anon false; authenticated true ONLY for weekly leaderboard.
select e.sig as function_name, p.oid is not null as present,
       p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       coalesce(p.oid is not null and p.prosecdef
         and p.prorettype = to_regtype(e.return_type)
         and coalesce(p.proconfig, '{}') @> array['search_path=""']
         and not has_function_privilege('public', p.oid, 'EXECUTE')
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.authenticated
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE WITH GRANT OPTION'), false) as as_expected
from (values
  ('public.m8_sync_diagnostic()', false, 'trigger'),
  ('public.m8_oral_completed()', false, 'trigger'),
  ('public.m8_grant_xp(uuid,text,uuid,integer)', false, 'boolean'),
  ('public.m8_record_reading_day(uuid,date)', false, 'void'),
  ('public.m8_weekly_leaderboard()', true, 'record'),
  ('public.m8_on_comprehension_completed()', false, 'trigger'),
  ('public.m8_award_graduate(uuid)', false, 'void'),
  ('public.m8_on_module_xp_granted()', false, 'trigger')
) e(sig, authenticated, return_type)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by 1;

-- V-C3b. Expect 4 rows, ALL as_expected true, enabled O.
-- Review definition: row-level AFTER INSERT; diagnostic also UPDATE OF reading_level,
-- M6 (C3 only) also UPDATE OF status. No WHEN condition or trigger arguments.
select e.on_table, e.trigger_name, t.tgenabled,
       pg_get_triggerdef(t.oid) as definition,
       coalesce(t.tgenabled = 'O' and t.tgfoid = to_regprocedure(e.function_name)
         and t.tgtype = e.trigger_type and t.tgnargs = 0 and t.tgqual is null, false) as as_expected
from (values
  ('public.diagnostic_results', 'm8_diagnostic_sync', 'public.m8_sync_diagnostic()', 21),
  ('public.oral_reading_attempts', 'm8_oral_completed_trigger', 'public.m8_oral_completed()', 5),
  ('public.m6_comprehension_attempts', 'm8_m6_completed', 'public.m8_on_comprehension_completed()', 21),
  ('public.m8_xp_events', 'm8_graduate_check', 'public.m8_on_module_xp_granted()', 5)
) e(on_table, trigger_name, function_name, trigger_type)
left join pg_trigger t on t.tgrelid = to_regclass(e.on_table)
  and t.tgname = e.trigger_name and not t.tgisinternal
order by 1, 2;

-- V-C3c. Inventory catches unexpected extra M8 objects. Expect functions 8, triggers 4.
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'm8\_%') as m8_functions,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'm8\_%') as m8_triggers;

-- V-C23d. After C2 AND after C3: trusted completion inputs remain browser-read-only.
-- Expect 4 rows, every client_can_write false. Includes column-level grants.
-- Diagnostic results intentionally have authenticated INSERT/UPDATE; see review's integrity risk.
select e.table_name, r.role_name,
       has_table_privilege(r.role_name::name, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
         or has_any_column_privilege(r.role_name::name, c.oid, 'INSERT,UPDATE,REFERENCES') as client_can_write
from (values ('oral_reading_attempts'), ('m6_comprehension_attempts')) e(table_name)
cross join (values ('anon'), ('authenticated')) r(role_name)
left join pg_class c on c.oid = to_regclass('public.' || e.table_name)
order by 1, 2;
