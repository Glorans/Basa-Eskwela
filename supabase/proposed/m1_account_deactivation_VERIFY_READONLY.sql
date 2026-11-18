-- READ-ONLY verification after m1_account_deactivation_PROPOSED.sql. Aggregates only: no names, emails or ids.
begin read only;

-- installed (expect all true)
select exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_status_check' and convalidated) as status_check,
       to_regclass('public.m1_account_status_events') is not null as audit_table,
       to_regprocedure('public.m1_set_account_status(uuid,uuid,text)') is not null as set_status_fn,
       to_regprocedure('public.m1_reject_deactivated_request()') is not null as pre_request_fn,
       to_regprocedure('public.m1_account_active()') is not null as active_fn,
       exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
               and policyname = 'M1 active account required' and permissive = 'RESTRICTIVE') as storage_policy_restrictive;
-- pre-request configured (expect pgrst.db_pre_request=public.m1_reject_deactivated_request)
select coalesce(array_to_string(rolconfig, ' | '), '(none)') from pg_roles where rolname = 'authenticator';
-- privileges (expect: set_status service_role only; pre-request anon+authenticated; audit table no browser access)
select has_function_privilege('authenticated', 'public.m1_set_account_status(uuid,uuid,text)', 'EXECUTE') as set_status_authenticated,
       has_function_privilege('anon', 'public.m1_set_account_status(uuid,uuid,text)', 'EXECUTE') as set_status_anon,
       has_function_privilege('service_role', 'public.m1_set_account_status(uuid,uuid,text)', 'EXECUTE') as set_status_service,
       has_function_privilege('authenticated', 'public.m1_reject_deactivated_request()', 'EXECUTE') as pre_request_authenticated,
       has_function_privilege('anon', 'public.m1_reject_deactivated_request()', 'EXECUTE') as pre_request_anon,
       has_table_privilege('authenticated', 'public.m1_account_status_events', 'SELECT,INSERT,UPDATE,DELETE') as audit_authenticated,
       has_table_privilege('anon', 'public.m1_account_status_events', 'SELECT,INSERT,UPDATE,DELETE') as audit_anon,
       (select relrowsecurity from pg_class where oid = 'public.m1_account_status_events'::regclass) as audit_rls;
-- existing users remain active (expect same rows as PREFLIGHT, all 'active'), no events yet
select coalesce(role, '(none)') as role, status, count(*) from public.profiles group by 1, 2 order by 1, 2;
select count(*) as audit_events from public.m1_account_status_events;
-- no signed-in user: both checks pass (expect true, and no error)
select public.m1_account_active() as active_without_user;
select public.m1_reject_deactivated_request() is null as pre_request_without_user;
-- learning records unchanged (expect identical to PREFLIGHT)
select 'diagnostic_results' as t, count(*) from public.diagnostic_results
union all select 'oral_reading_attempts', count(*) from public.oral_reading_attempts
union all select 'm6_comprehension_attempts', count(*) from public.m6_comprehension_attempts
union all select 'm6_comprehension_responses', count(*) from public.m6_comprehension_responses
union all select 'm7_interventions', count(*) from public.m7_interventions
union all select 'm8_xp_events', count(*) from public.m8_xp_events
union all select 'enrollments', count(*) from public.enrollments
union all select 'rooms', count(*) from public.rooms
union all select 'profiles', count(*) from public.profiles
order by 1;

rollback;
