-- READ-ONLY preflight for m1_school_admin_invitations_PROPOSED.sql. Aggregates only.
begin read only;
-- prerequisite installed (expect t|t)
select to_regprocedure('public.m1_set_account_status(uuid,uuid,text)') is not null as deactivation_fn,
       to_regclass('public.m1_account_status_events') is not null as deactivation_events;
-- not installed yet (expect all f)
select to_regclass('public.m1_school_admin_invitations') is not null as invitations, to_regclass('public.m1_school_admin_invitation_events') is not null as events,
       to_regprocedure('public.m1_accept_school_admin_invitation(uuid,timestamptz)') is not null as accept_fn,
       exists (select 1 from pg_trigger where tgname = 'm1_guard_school_admin_role') as guard;
-- accounts by role/status (role-less accounts are onboarding or legacy; none becomes an invitation)
select coalesce(role, '(none)') as role, status, count(*) from public.profiles group by 1, 2 order by 1, 2;
-- active System Admins (expect >= 1)
select count(*) as active_system_admins from public.profiles where role = 'system_admin' and status = 'active';
-- existing triggers on profiles (the new guard is added beside them)
select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal order by 1;
rollback;
