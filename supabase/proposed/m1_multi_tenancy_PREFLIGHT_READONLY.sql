-- READ-ONLY PREFLIGHT for m1_multi_tenancy_PROPOSED.sql. Changes nothing. Every row is PASS or FAIL (or INFO).
-- Generated from a restored copy of Staging (backup 2026-11-21_031347_preM2Release + the 7 applied M2 migrations).
begin transaction read only;
with expected(fn, md5) as (values
  ('public.m1_protect_profile_authorization_fields()', '1a189f847ffb8f8349bc770f4fdd2e23'),
  ('public.m1_school_admin_sees_owner(uuid)', '1b36677a63536c0f7d6452b8df92aa9b'),
  ('public.m1_school_admin_sees_material(uuid)', 'e294c83f1759145df49a9324ba5872d4'),
  ('public.m1_school_admin_sees_question(uuid)', '715487b6db66704ef2bdf00167456b1f'),
  ('public.m1_school_admin_sees_storage_owner(text)', 'd15fc702d1d1dba8a25f71f8920509c0'),
  ('public.m4_admin_classroom_teachers()', '2e7ef3408f8ca4b36e0038c3e5c8c972'),
  ('public.m3_trashed_modules()', '3d0390c55e002ab3f76849f659879166'),
  ('public.m3_module_revisions(uuid)', 'd999a79f72b9d525d8a071a36bc8c6da'),
  ('public.m3_can_manage_module(uuid)', 'fa21ab38b0e90f98bf1772296b99b127'),
  ('public.m5_can_read_activity(uuid,uuid)', '413857ffc8fba427c5d9dc1c315ff152'),
  ('public.register_teacher_with_invite(text)', '4da6e0d244880e65ad6d818d8b96ace1'),
  ('public.review_teacher_registration(uuid,text)', 'd9e4e51328e428fbeffbded35a93850a'),
  ('public.m1_accept_school_admin_invitation(uuid,timestamp with time zone)', 'f8c76e234a472b7d071b53c11543b241'),
  ('public.m1_set_account_status(uuid,uuid,text)', '0c7e106e31af85fee5c4d50809a675a5'),
  ('public.m1_create_school_admin_invitation(uuid,uuid,text,text,text,text,text,text,integer)', '4bb0c20a84377997308b2308b6f18243'),
  ('public.m3_collection_publish_issues(uuid)', '6f79cabbe0c5536457a614522fce87ea')
), checks(label, ok, detail) as (
  select 'multi-tenancy not applied yet: no schools table, no profiles.school_id, no school helpers',
    to_regclass('public.schools') is null and to_regclass('public.m1_school_events') is null
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'school_id')
    and to_regprocedure('public.m1_school_visible(uuid)') is null, ''
  union all select 'each of the 16 functions the migration replaces still has the exact body the rollback restores',
    not exists (select 1 from expected e where to_regprocedure(e.fn) is null or md5(pg_get_functiondef(to_regprocedure(e.fn))) <> e.md5),
    coalesce((select string_agg(e.fn, ', ') from expected e where to_regprocedure(e.fn) is null or md5(pg_get_functiondef(to_regprocedure(e.fn))) <> e.md5), '')
  union all select 'roles consistent with the backfill rules (every account role is known)',
    not exists (select 1 from public.profiles where role is not null and role not in ('system_admin', 'admin', 'teacher', 'student', 'general_user')), ''
  union all select 'no Independent Learner or System Admin is enrolled in a Learning Room (they stay without a school)',
    not exists (select 1 from public.enrollments e join public.profiles p on p.id = e.student_id where p.role in ('general_user', 'system_admin')), ''
  union all select 'every Learning Room is owned by a Teacher (rooms take their Teacher''s school)',
    not exists (select 1 from public.rooms r left join public.profiles t on t.id = r.teacher_id where t.role is distinct from 'teacher'), ''
  union all select 'no pending/unaccepted School Admin invitation without a role-less account (invitations backfill to School 1)',
    not exists (select 1 from public.m1_school_admin_invitations i join public.profiles p on p.id = i.user_id
                where i.status = 'accepted' and p.role is distinct from 'admin'), ''
)
select case when ok then 'PASS' else 'FAIL' end, label, detail from checks
union all select 'INFO', 'accounts by role (School 1 will get admin + teacher + student)',
  (select string_agg(coalesce(role, '(none)') || '=' || n, ', ' order by role) from (select role, count(*) n from public.profiles group by 1) x)
union all select 'INFO', 'Students not enrolled in any Learning Room (assigned to School 1 by role; review list)',
  (select count(*)::text from public.profiles p where p.role = 'student' and not exists (select 1 from public.enrollments e where e.student_id = p.id))
union all select 'INFO', 'role-less accounts (left without a school; ambiguous)', (select count(*)::text from public.profiles where role is null)
union all select 'INFO', 'Teacher invitation codes / School Admin invitations (all to School 1)',
  (select count(*)::text from public.teacher_invite_codes) || ' / ' || (select count(*)::text from public.m1_school_admin_invitations);
rollback;
