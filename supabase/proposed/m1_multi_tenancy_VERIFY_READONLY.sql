-- READ-ONLY verification for m1_multi_tenancy_PROPOSED.sql. Changes nothing. Every row is PASS, FAIL or INFO.
begin transaction read only;

with checks(label, ok, detail) as (
  select 'schools table present with exactly one legacy School 1',
    (select count(*) from public.schools where is_legacy) = 1, (select count(*)::text || ' school(s)' from public.schools)
  union all select 'every School Admin and Teacher has exactly one school',
    not exists (select 1 from public.profiles where role in ('admin', 'teacher') and school_id is null), ''
  union all select 'no System Admin or Independent Learner belongs to a school',
    not exists (select 1 from public.profiles where role in ('system_admin', 'general_user') and school_id is not null), ''
  union all select 'no role-less account belongs to a school',
    not exists (select 1 from public.profiles where role is null and school_id is not null), ''
  union all select 'every enrolled Student belongs to the school of each of their Learning Rooms',
    not exists (select 1 from public.enrollments e join public.rooms r on r.id = e.room_id join public.profiles t on t.id = r.teacher_id
                join public.profiles s on s.id = e.student_id
                where t.school_id is not null and s.school_id is distinct from t.school_id), ''
  union all select 'every Teacher invitation code and School Admin invitation names a school',
    not exists (select 1 from public.teacher_invite_codes where school_id is null)
    and not exists (select 1 from public.m1_school_admin_invitations where school_id is null), ''
  union all select 'every accepted School Admin invitation matches the account''s school',
    not exists (select 1 from public.m1_school_admin_invitations i join public.profiles p on p.id = i.user_id
                where i.status = 'accepted' and p.school_id is distinct from i.school_id), ''
  union all select 'school-owned assessment packages are owned by an account with a school',
    not exists (select 1 from public.m2_assessment_packages k left join public.profiles p on p.id = k.owner_id
                where k.scope in ('school', 'teacher') and k.owner_id is not null and p.school_id is null), ''
  union all select 'nothing references schools with ON DELETE CASCADE (deleting a school can never delete results)',
    not exists (select 1 from pg_constraint where contype = 'f' and confrelid = 'public.schools'::regclass and confdeltype = 'c'), ''
  union all select 'schools can never be deleted (trigger present, no DELETE grant to app roles)',
    exists (select 1 from pg_trigger where tgname = 'm1_schools_never_deleted' and not tgisinternal)
    and not has_table_privilege('authenticated', 'public.schools', 'DELETE'), ''
  union all select 'restrictive "M1 school isolation" policies on all 16 tables',
    (select count(*) from pg_policies where schemaname = 'public' and policyname = 'M1 school isolation' and permissive = 'RESTRICTIVE') = 16,
    (select count(*)::text from pg_policies where schemaname = 'public' and policyname = 'M1 school isolation')
  union all select 'school write guards on the 9 classroom/content tables + enrollment, room and profile school triggers',
    (select count(*) from pg_trigger where tgname = 'm1_school_write_guard' and not tgisinternal) = 9
    and exists (select 1 from pg_trigger where tgname = 'm1_school_write_guard_revision' and not tgisinternal)
    and (select count(*) from pg_trigger where tgname in ('m1_enrollment_school', 'm1_room_school_fixed', 'm1_profile_school_fixed') and not tgisinternal) = 3, ''
  union all select 'School Admin helpers are school-limited',
    (select bool_and(prosrc like '%m1_%visible%' or prosrc like '%m1_current_school%') from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('m1_school_admin_sees_owner', 'm1_school_admin_sees_material', 'm1_school_admin_sees_question', 'm1_school_admin_sees_storage_owner',
                      'm4_admin_classroom_teachers', 'm3_trashed_modules', 'm3_module_revisions', 'm3_can_manage_module', 'm5_can_read_activity')), ''
  union all select 'F10/F11/F9/F7 functions are school-aware',
    (select prosrc like '%code_row.school_id%' from pg_proc where oid = 'public.register_teacher_with_invite(text)'::regprocedure)
    and (select prosrc like '%school_id = v_school%' from pg_proc where oid = 'public.review_teacher_registration(uuid,text)'::regprocedure)
    and (select prosrc like '%school_id = v_row.school_id%' from pg_proc where oid = 'public.m1_accept_school_admin_invitation(uuid,timestamp with time zone)'::regprocedure)
    and (select prosrc like '%v_target_school = v_actor_school%' from pg_proc where oid = 'public.m1_set_account_status(uuid,uuid,text)'::regprocedure)
    and to_regprocedure('public.m1_create_school_admin_invitation(uuid,uuid,text,text,text,text,text,text,integer,uuid)') is not null
    and to_regprocedure('public.m1_create_school_admin_invitation(uuid,uuid,text,text,text,text,text,text,integer)') is null, ''
  union all select 'school management functions are service_role only',
    not has_function_privilege('authenticated', 'public.m1_create_school(uuid,text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.m1_update_school(uuid,uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.m1_create_school_admin_invitation(uuid,uuid,text,text,text,text,text,text,integer,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.m1_create_school(uuid,text,text,text)', 'EXECUTE'), ''
  union all select 'the browser cannot set or change profiles.school_id (protection trigger covers it)',
    (select prosrc like '%new.school_id is distinct from old.school_id%' from pg_proc where oid = 'public.m1_protect_profile_authorization_fields()'::regprocedure)
    and not has_column_privilege('authenticated', 'public.profiles', 'school_id', 'UPDATE'), ''
)
select case when ok then 'PASS' else 'FAIL' end as result, label, detail from checks
union all
select 'INFO', 'accounts per school and role', (select string_agg(s.code || ': ' || coalesce(p.role, '(none)') || '=' || p.n, ', ' order by s.code, p.role)
  from (select school_id, role, count(*) n from public.profiles where school_id is not null group by 1, 2) p join public.schools s on s.id = p.school_id)
union all
select 'INFO', 'Students in School 1 by role only (no Learning Room yet) -- review list', (select count(*)::text from public.profiles p
  where p.role = 'student' and p.school_id is not null and not exists (select 1 from public.enrollments e where e.student_id = p.id))
union all
select 'INFO', 'role-less accounts left without a school (ambiguous; not guessed)', (select count(*)::text from public.profiles where role is null)
union all
select 'INFO', 'Students without a school (get one when they join a Learning Room)', (select count(*)::text from public.profiles where role = 'student' and school_id is null);

rollback;
