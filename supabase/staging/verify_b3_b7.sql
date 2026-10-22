-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP B3-B7 (M2 diagnostics, M3 content schema). Apply B3 as 03_b3_hardened.sql and B7 as
-- 07_b7_hardened.sql. Run P3* before B3, V3* after B7, then audit_stage_b.sql A1-A8.
-- Run one section at a time. A mismatch means STOP.

-- P3a. B2 checkpoint still holds. Expect V2e's result: assign_own_role anon false /
-- authenticated true; both trigger functions false / false.
select p.oid::regprocedure as function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
where p.oid in (to_regprocedure('public.assign_own_role(text)'),
                to_regprocedure('public.handle_new_user()'),
                to_regprocedure('public.m1_protect_profile_authorization_fields()'))
order by 1;

-- P3b. Group objects absent. Expect 4 rows, already_exists false.
select t.name, to_regclass('public.' || t.name) is not null as already_exists
from unnest(array['diagnostic_results', 'uploaded_materials', 'comprehension_questions',
                  'comprehension_question_answers']) t(name)
order by 1;

-- P3c. Ownership route to B8's storage policies. Expect can_create_storage_policies true
-- (or is_superuser true).
-- RECORDED 2026-10-22: FAILED (owner supabase_storage_admin, false, false). This result
-- stands; do not rerun P3c to get a different answer, and never change the owner or grant
-- supabase_storage_admin. Continue only by the reviewed alternative route, P3d-P3f below.
select pg_get_userbyid(c.relowner) as storage_objects_owner,
       pg_has_role(current_user, c.relowner, 'USAGE') as can_create_storage_policies,
       (select rolsuper from pg_roles where rolname = current_user) as is_superuser
from pg_class c where c.oid = 'storage.objects'::regclass;

-- P3d. Alternative route: supautils policy grant (Supabase lets postgres manage policies on
-- storage.objects without owning it). Expect one row: current_user postgres,
-- storage_objects_rls true, postgres_can_read_objects true, foldername_executable true,
-- existing_storage_policies 0, bucket_public false, bucket_size_limit 26214400.
-- policy_grants_covers_objects: true = route available; NULL = setting hidden from this
-- role (inconclusive, P3e decides); false = STOP. bucket_* NULL = bucket missing: do Stage A3
-- first. Any other mismatch = STOP.
select current_user,
       c.relrowsecurity as storage_objects_rls,
       has_table_privilege(current_user, c.oid, 'SELECT') as postgres_can_read_objects,
       has_function_privilege('authenticated', 'storage.foldername(text)', 'EXECUTE') as foldername_executable,
       (select (s.setting::jsonb -> current_user::text) ? 'storage.objects'
        from pg_settings s where s.name = 'supautils.policy_grants') as policy_grants_covers_objects,
       (select count(*) from pg_policies
        where schemaname = 'storage' and tablename = 'objects') as existing_storage_policies,
       (select b.public from storage.buckets b where b.id = 'reading-materials') as bucket_public,
       (select b.file_size_limit from storage.buckets b where b.id = 'reading-materials') as bucket_size_limit
from pg_class c where c.oid = 'storage.objects'::regclass;

-- P3e is NOT in this file: it is supabase/staging/probe_p3e_storage_policy.sql (one
-- rolled-back CREATE POLICY, needs approval). Expect "Success. No rows returned". A
-- "must be owner of table objects" error = STOP before B3; report it, do not work around it.

-- P3f. Run right after P3e. The probe left nothing behind. Expect storage_policies 0.
select count(*) as storage_policies from pg_policies where schemaname = 'storage';

-- V3a. New tables. Expect 4 rows: present true, rls true, force_rls false.
select t.name, c.oid is not null as present, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
from unnest(array['diagnostic_results', 'uploaded_materials', 'comprehension_questions',
                  'comprehension_question_answers']) t(name)
left join pg_class c on c.oid = to_regclass('public.' || t.name)
order by 1;

-- V3b. Diagnostic uniqueness after B4-B6. Expect exactly 2 rows: diagnostic_results_pkey
-- PRIMARY KEY (id), and diagnostic_results_user_language_version_key
--   UNIQUE (user_id, assessment_type, language, assessment_id, assessment_version).
-- The older two- and three-column unique keys must be gone.
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.diagnostic_results'::regclass and contype in ('u', 'p')
order by 1;

-- V3c. Foreign keys of the new tables (review on_delete against the migration source).
-- Expect every row validated true.
select conrelid::regclass as table_name, conname, convalidated,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f' and conrelid in (to_regclass('public.diagnostic_results'),
  to_regclass('public.uploaded_materials'), to_regclass('public.comprehension_questions'),
  to_regclass('public.comprehension_question_answers'), to_regclass('public.modules'))
order by 1, 2;

-- V3d. Diagnostic policies. Expect exactly 3 rows, permissive, roles {authenticated}:
-- "Users can insert their diagnostic results" INSERT, "... read ..." SELECT,
-- "... update ..." UPDATE, each limited to the caller's own user_id.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'diagnostic_results'
order by 1;

-- V3e. New functions (all trigger functions). Expect 7 rows: present true,
-- search_path pinned true, anon_execute false, authenticated_execute false.
-- The B3a/B7a REVOKEs in the hardened bundles remove Supabase's default grants; any true
-- here means a plain B3/B7 file was run instead: STOP.
select e.sig as function_name, p.oid is not null as present, p.prosecdef as security_definer,
       coalesce(p.proconfig, '{}') @> array['search_path=""'] as search_path_pinned,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from unnest(array['public.set_diagnostic_updated_at()', 'public.m3_set_updated_at()',
  'public.m3_set_module_metadata()', 'public.m3_set_question_metadata()',
  'public.m3_protect_material_file_identity()', 'public.m3_validate_answer_key()',
  'public.m3_validate_changed_options()']) e(sig)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by 1;

-- V3f. New row triggers. Expect 10 rows, tgenabled O in every row (NULL = missing).
select e.on_table, e.trigger_name, t.tgenabled, pg_get_triggerdef(t.oid, true) as definition
from (values
  ('public.diagnostic_results', 'diagnostic_results_set_updated_at'),
  ('public.modules', 'modules_m3_metadata'),
  ('public.modules', 'modules_m3_set_updated_at'),
  ('public.uploaded_materials', 'uploaded_materials_protect_file_identity'),
  ('public.uploaded_materials', 'uploaded_materials_set_updated_at'),
  ('public.comprehension_questions', 'comprehension_questions_set_metadata'),
  ('public.comprehension_questions', 'comprehension_questions_set_updated_at'),
  ('public.comprehension_questions', 'comprehension_questions_validate_changed_options'),
  ('public.comprehension_question_answers', 'comprehension_question_answers_set_updated_at'),
  ('public.comprehension_question_answers', 'comprehension_question_answers_validate')
) e(on_table, trigger_name)
left join pg_trigger t on t.tgrelid = to_regclass(e.on_table) and t.tgname = e.trigger_name
  and not t.tgisinternal
order by 1, 2;

-- V3g. Client table privileges on the new tables.
-- Expect 8 rows. diagnostic_results: anon (empty); authenticated SELECT,INSERT,UPDATE only
-- (B3a removed the default DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN).
-- uploaded_materials / comprehension_questions / comprehension_question_answers: (empty)
-- for both roles (B7a); B8 grants the column-scoped set. Anything else = STOP.
select c.relname as table_name, r.role_name,
       array_to_string(array(
         select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                    'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
         where has_table_privilege(r.role_name, c.oid, p)), ',') as table_privileges
from pg_class c cross join (values ('anon'), ('authenticated')) r(role_name)
where c.oid in (to_regclass('public.diagnostic_results'), to_regclass('public.uploaded_materials'),
  to_regclass('public.comprehension_questions'), to_regclass('public.comprehension_question_answers'))
order by 1, 2;

-- V3h. Checkpoint totals. Expect public_tables 11, public_policies 6, storage_policies 0.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;
