-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP B8 (supabase/m3_content_rls.sql: M3 RLS, grants, reading-materials storage policies).
-- Apply B8 as 08_b8_hardened.sql. Run P4* before B8, V4* after it, then audit_stage_b.sql
-- A1-A8. A mismatch means STOP.

-- P4a. Ownership route (informational since P3c). On live staging this is expected to repeat
-- P3c's recorded FAIL: owner supabase_storage_admin, false, false. It is NOT a pass. B8 may
-- proceed only by the reviewed supautils route: P3e succeeded and P3f was 0 (both recorded
-- before B3), and P4c below matches. Never change the owner of storage.objects, grant
-- supabase_storage_admin, or skip/split B8's storage section.
select pg_get_userbyid(c.relowner) as storage_objects_owner,
       pg_has_role(current_user, c.relowner, 'USAGE') as can_create_storage_policies,
       (select rolsuper from pg_roles where rolname = current_user) as is_superuser
from pg_class c where c.oid = 'storage.objects'::regclass;

-- P4b. Existing policies on the tables B8 secures. Expect 0 rows on public tables
-- (modules, uploaded_materials, comprehension_questions, comprehension_question_answers) and
-- 0 rows on storage.objects. Any row must be reviewed: permissive policies combine with OR.
select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies
where (schemaname = 'public' and tablename in ('modules', 'uploaded_materials',
         'comprehension_questions', 'comprehension_question_answers'))
   or (schemaname = 'storage' and tablename = 'objects')
order by 1, 2, 3;

-- P4c. Alternative-route conditions still hold (same as P3d). Expect current_user postgres,
-- storage_objects_rls true, postgres_can_read_objects true (m3_material_file_is_absent reads
-- storage.objects as its owner), foldername_executable true, policy_grants_covers_objects
-- true or NULL (NULL accepted only because P3e succeeded), bucket_public false,
-- bucket_size_limit 26214400. Any other value = STOP.
select current_user,
       c.relrowsecurity as storage_objects_rls,
       has_table_privilege(current_user, c.oid, 'SELECT') as postgres_can_read_objects,
       has_function_privilege('authenticated', 'storage.foldername(text)', 'EXECUTE') as foldername_executable,
       (select (s.setting::jsonb -> current_user::text) ? 'storage.objects'
        from pg_settings s where s.name = 'supautils.policy_grants') as policy_grants_covers_objects,
       (select b.public from storage.buckets b where b.id = 'reading-materials') as bucket_public,
       (select b.file_size_limit from storage.buckets b where b.id = 'reading-materials') as bucket_size_limit
from pg_class c where c.oid = 'storage.objects'::regclass;

-- V4a. Helper functions. Expect 7 rows: present true, security_definer true,
-- search_path_pinned true, anon_execute false, authenticated_execute true.
-- B8 revokes only PUBLIC; the bundle's B8a removes the anon EXECUTE that Supabase defaults
-- add. These are SECURITY DEFINER and callable over the API: anon true = STOP (a plain B8
-- file was run instead of 08_b8_hardened.sql).
select e.sig as function_name, p.oid is not null as present, p.prosecdef as security_definer,
       coalesce(p.proconfig, '{}') @> array['search_path=""'] as search_path_pinned,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from unnest(array['public.m3_current_role()', 'public.m3_can_read_module(uuid)',
  'public.m3_owns_material(uuid)', 'public.m3_module_is_unreferenced(uuid)',
  'public.m3_material_is_unreferenced(uuid)', 'public.m3_material_file_is_absent(uuid)',
  'public.m3_storage_object_is_deletable(text)']) e(sig)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by 1;

-- V4b. Policy counts. Expect, all permissive with roles {authenticated}:
--   public.comprehension_question_answers 5, public.comprehension_questions 5,
--   public.modules 4, public.uploaded_materials 4, storage.objects 3.
select schemaname, tablename, count(*) as policies,
       bool_and(permissive = 'PERMISSIVE') as all_permissive,
       bool_and(roles = '{authenticated}') as authenticated_only
from pg_policies
where (schemaname = 'public' and tablename in ('modules', 'uploaded_materials',
         'comprehension_questions', 'comprehension_question_answers'))
   or (schemaname = 'storage' and tablename = 'objects')
group by 1, 2 order by 1, 2;

-- V4c. Storage policies. Expect 3 rows (SELECT, INSERT, DELETE), each qual/with_check limited
-- to bucket_id = 'reading-materials' and to the owner or an admin (via the m3_* helpers).
-- No UPDATE policy and no policy for anon.
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'storage' and tablename = 'objects'
order by 1;

-- V4d. Answer keys are never readable by learners. Expect exactly one SELECT policy on
-- comprehension_question_answers: "M3 admins and owning teachers read answer keys";
-- its qual references the admin role and the owning teacher only.
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'comprehension_question_answers' and cmd in ('SELECT', 'ALL')
order by 1;

-- V4e. Client TABLE privileges after B8. Expect anon (empty) on all four tables;
-- authenticated SELECT,DELETE on all four (INSERT/UPDATE are column-scoped, see V4f).
select c.relname as table_name, r.role_name,
       array_to_string(array(
         select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                    'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
         where has_table_privilege(r.role_name, c.oid, p)), ',') as table_privileges
from pg_class c cross join (values ('anon'), ('authenticated')) r(role_name)
where c.oid in (to_regclass('public.modules'), to_regclass('public.uploaded_materials'),
  to_regclass('public.comprehension_questions'), to_regclass('public.comprehension_question_answers'))
order by 1, 2;

-- V4f. Column-scoped INSERT/UPDATE for authenticated. Compare with the grant insert (...)
-- and grant update (...) lists in supabase/m3_content_rls.sql. Server-managed columns
-- (ids, created_by/uploaded_by, status timestamps, review metadata) must not be listed
-- unless the migration grants them.
select c.relname as table_name,
       string_agg(a.attname, ',' order by a.attnum)
         filter (where has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT')) as insert_columns,
       string_agg(a.attname, ',' order by a.attnum)
         filter (where has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')) as update_columns
from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where c.oid in (to_regclass('public.modules'), to_regclass('public.uploaded_materials'),
  to_regclass('public.comprehension_questions'), to_regclass('public.comprehension_question_answers'))
group by 1 order by 1;

-- V4g. Checkpoint totals. Expect public_tables 11, public_policies 24, storage_policies 3.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;

-- V4h. Storage policies matched by definition, not only by name. Expect exactly 3 rows
-- (DELETE, INSERT, SELECT), every boolean true. INSERT has only a WITH CHECK; SELECT and
-- DELETE have only a USING. A 4th row, an UPDATE/ALL row or any false = STOP.
select cmd, policyname,
       permissive = 'PERMISSIVE' and roles = '{authenticated}' as authenticated_permissive,
       coalesce(qual, with_check) like '%bucket_id = ''reading-materials''%' as bucket_scoped,
       case cmd
         when 'INSERT' then qual is null and with_check like '%m3_current_role()%'
           and with_check like '%auth.uid()%' and with_check like '%(pdf|docx|jpg|jpeg|png)$%'
         when 'SELECT' then with_check is null and qual like '%m3_current_role()%'
           and qual like '%foldername(name)%' and qual like '%auth.uid()%'
         when 'DELETE' then with_check is null and qual like '%foldername(name)%'
           and qual like '%auth.uid()%' and qual like '%m3_storage_object_is_deletable(name)%'
       end as definition_as_expected
from pg_policies where schemaname = 'storage' and tablename = 'objects'
order by 1;

-- V4i. Supabase-managed Storage untouched. Expect 2 rows, owner supabase_storage_admin and
-- rls true for both storage.buckets and storage.objects (as before B8).
select c.oid::regclass as table_name, pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls
from pg_class c
where c.oid in ('storage.buckets'::regclass, 'storage.objects'::regclass)
order by 1;
