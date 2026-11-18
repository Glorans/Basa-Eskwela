-- READ-ONLY preflight for m1_account_deactivation_PROPOSED.sql. Aggregates only: no names, emails or ids.
-- Run in a read-only session (SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY). Expected values in comments.
begin read only;

-- status column: text, default 'active', NOT NULL
select data_type, column_default, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name = 'status';
-- every profile active (expect one row per role, all 'active')
select coalesce(role, '(none)') as role, status, count(*) from public.profiles group by 1, 2 order by 1, 2;
-- nothing installed yet (expect all false)
select exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_status_check') as status_check,
       to_regclass('public.m1_account_status_events') is not null as audit_table,
       to_regprocedure('public.m1_set_account_status(uuid,uuid,text)') is not null as set_status_fn,
       to_regprocedure('public.m1_reject_deactivated_request()') is not null as pre_request_fn,
       to_regprocedure('public.m1_account_active()') is not null as active_fn,
       exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'M1 active account required') as storage_policy;
-- no pre-request configured (expect no pgrst.db_pre_request entry)
select rolname, coalesce(array_to_string(rolconfig, ' | '), '(none)') from pg_roles where rolname = 'authenticator';
-- Auth: nobody banned yet (expect banned_now = 0)
select count(*) filter (where banned_until is not null and banned_until > now()) as banned_now, count(*) as auth_users from auth.users;
-- System Admins (expect >= 1, all active)
select count(*) filter (where status = 'active') as active_system_admins, count(*) as system_admins from public.profiles where role = 'system_admin';
-- learning-record baseline: compare with the VERIFY output after install
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
