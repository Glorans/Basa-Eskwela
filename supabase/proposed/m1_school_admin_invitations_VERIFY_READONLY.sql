-- READ-ONLY verification after m1_school_admin_invitations_PROPOSED.sql. Aggregates only.
begin read only;
-- installed (expect all t)
select to_regclass('public.m1_school_admin_invitations') is not null, to_regclass('public.m1_school_admin_invitation_events') is not null,
       to_regprocedure('public.m1_accept_school_admin_invitation(uuid,timestamptz)') is not null,
       exists (select 1 from pg_trigger where tgname = 'm1_guard_school_admin_role' and tgenabled = 'O');
-- browser roles have no access (expect all f) and RLS is on (expect t|t)
select has_table_privilege('authenticated', 'public.m1_school_admin_invitations', 'SELECT,INSERT,UPDATE,DELETE'),
       has_table_privilege('anon', 'public.m1_school_admin_invitations', 'SELECT,INSERT,UPDATE,DELETE'),
       has_table_privilege('authenticated', 'public.m1_school_admin_invitation_events', 'SELECT,INSERT,UPDATE,DELETE'),
       has_function_privilege('authenticated', 'public.m1_accept_school_admin_invitation(uuid,timestamptz)', 'EXECUTE'),
       has_function_privilege('authenticated', 'public.m1_create_school_admin_invitation(uuid,uuid,text,text,text,text,text,text,integer)', 'EXECUTE'),
       has_function_privilege('anon', 'public.m1_accept_school_admin_invitation(uuid,timestamptz)', 'EXECUTE');
-- backend service role: read-only on both tables (expect t|f|f|f|t|f|f|f)
select has_table_privilege('service_role', 'public.m1_school_admin_invitations', 'SELECT'),
       has_table_privilege('service_role', 'public.m1_school_admin_invitations', 'INSERT'),
       has_table_privilege('service_role', 'public.m1_school_admin_invitations', 'UPDATE'),
       has_table_privilege('service_role', 'public.m1_school_admin_invitations', 'DELETE'),
       has_table_privilege('service_role', 'public.m1_school_admin_invitation_events', 'SELECT'),
       has_table_privilege('service_role', 'public.m1_school_admin_invitation_events', 'INSERT'),
       has_table_privilege('service_role', 'public.m1_school_admin_invitation_events', 'UPDATE'),
       has_table_privilege('service_role', 'public.m1_school_admin_invitation_events', 'DELETE');
-- every new function: security mode and who may execute it (expect the 4 backend functions definer + service_role only;
-- helper/trigger functions callable by nobody but the owner)
select p.proname, p.prosecdef as definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('m1_is_active_system_admin', 'm1_create_school_admin_invitation', 'm1_record_school_admin_invitation_email',
   'm1_cancel_school_admin_invitation', 'm1_accept_school_admin_invitation', 'm1_guard_school_admin_role', 'm1_school_admin_history_protect')
 order by 1;
-- history-protection triggers present (expect 4)
select count(*) from pg_trigger where tgname in ('m1_school_admin_events_append_only', 'm1_school_admin_events_no_truncate',
  'm1_school_admin_invitations_no_delete', 'm1_school_admin_invitations_no_truncate');
select (select relrowsecurity from pg_class where oid = 'public.m1_school_admin_invitations'::regclass),
       (select relrowsecurity from pg_class where oid = 'public.m1_school_admin_invitation_events'::regclass);
-- existing accounts unchanged (compare with PREFLIGHT) and no invitations yet (expect 0)
select coalesce(role, '(none)') as role, status, count(*) from public.profiles group by 1, 2 order by 1, 2;
select count(*) as invitations from public.m1_school_admin_invitations;
rollback;
