-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP B16 alone (supabase/m1_teacher_verification.sql: invite-based teacher registration,
-- approval status, restrictive approval policies incl. storage). Run P6* before B16,
-- V6* after it, then audit_stage_b.sql A1-A8. A mismatch means STOP. NEVER rerun B2 after B16.

-- P6a. Storage-policy route (B16 adds a restrictive storage.objects policy). On live staging
-- this repeats P3c's recorded FAIL (false, false): not a pass. Proceed only by the reviewed
-- supautils route: P3e succeeded, V4h passed after B8 (proving it), and verify_b8.sql P4c
-- still matches when rerun now. Never change the owner of storage.objects.
select pg_has_role(current_user, c.relowner, 'USAGE') as can_create_storage_policies,
       (select rolsuper from pg_roles where rolname = current_user) as is_superuser
from pg_class c where c.oid = 'storage.objects'::regclass;

-- P6b. No grandfathered teachers. B16 automatically APPROVES every existing teacher.
-- Expect existing_teachers 0. Any other value = STOP and review each account first.
select count(*) as existing_teachers from public.profiles where role = 'teacher';

-- P6c. B16 not yet applied. Expect has_teacher_status false; both invite tables false.
select exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name = 'profiles' and column_name = 'teacher_status') as has_teacher_status,
       to_regclass('public.teacher_invite_codes') is not null as has_invite_codes,
       to_regclass('public.teacher_invite_attempts') is not null as has_invite_attempts;

-- V6a. teacher_status column and rule. Expect column text, nullable; constraint
-- profiles_teacher_status_check convalidated true: teachers have pending/approved/rejected,
-- every other role has NULL.
select conname, convalidated, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass and conname = 'profiles_teacher_status_check';

-- V6b. Invite tables. Expect 2 rows: present, rls true, force_rls false, and no client
-- table privileges (empty strings): invite codes are hashed and server-managed.
select t.name, c.oid is not null as present, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
       array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
         where has_table_privilege('anon', c.oid, p)), ',') as anon_privileges,
       array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
         where has_table_privilege('authenticated', c.oid, p)), ',') as authenticated_privileges
from unnest(array['teacher_invite_codes', 'teacher_invite_attempts']) t(name)
left join pg_class c on c.oid = to_regclass('public.' || t.name)
order by 1;

-- V6c. Role functions after B16. Expect 6 rows, as_expected true in every row.
-- assign_own_role(text) now permits learner roles only (teacher requires an invite).
select e.sig as function_name, p.oid is not null as present,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       e.authenticated as expected_authenticated,
       p.oid is not null and coalesce(p.proconfig, '{}') @> array['search_path=""']
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.authenticated as as_expected
from (values
  ('public.assign_own_role(text)', true),
  ('public.register_teacher_with_invite(text)', true),
  ('public.review_teacher_registration(uuid,text)', true),
  ('public.m1_teacher_access_allowed()', true),
  ('public.m1_protect_profile_authorization_fields()', false),
  ('public.handle_new_user()', false)
) e(sig, authenticated)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by as_expected, 1;

-- V6d. Role selection no longer offers teacher. Expect offers_teacher false.
select position('''teacher''' in p.prosrc) > 0 as offers_teacher
from pg_proc p where p.oid = 'public.assign_own_role(text)'::regprocedure;

-- V6e. Restrictive approval policies. Expect 14 rows, permissive RESTRICTIVE, cmd ALL,
-- roles {authenticated}: "M1 Teacher approval required" on comprehension_question_answers,
-- comprehension_questions, diagnostic_results, enrollments, learning_paths, module_passages,
-- modules, oral_reading_attempts, progress, room_modules, rooms, uploaded_materials and
-- storage.objects; plus profiles "M1 unapproved Teachers see only own profile".
select schemaname, tablename, policyname, permissive, cmd, roles
from pg_policies
where policyname in ('M1 Teacher approval required', 'M1 unapproved Teachers see only own profile')
order by 1, 2;

-- V6f. teacher_status is readable but never client-writable. Expect can_select true,
-- can_update false, can_insert false.
select has_column_privilege('authenticated', 'public.profiles', 'teacher_status', 'SELECT') as can_select,
       has_column_privilege('authenticated', 'public.profiles', 'teacher_status', 'UPDATE') as can_update,
       has_column_privilege('authenticated', 'public.profiles', 'teacher_status', 'INSERT') as can_insert;

-- V6g. Checkpoint totals. Expect public_tables 17, public_policies 54, storage_policies 4.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;
