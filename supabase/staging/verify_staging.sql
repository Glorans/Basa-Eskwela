-- READ ONLY. Run section by section in the ReadFlow-Staging SQL editor. Every statement is a SELECT.
-- No credentials, user emails or learner data are returned (counts and object names only).

-- V0. Before anything (first confirm the dashboard URL reads .../project/oudfrdeqwotynihkkmze/...).
-- V0a: the project is empty. Expect public_tables 0, public_functions 0, public_views 0, auth_users 0, buckets 0.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as public_functions,
       (select count(*) from pg_views where schemaname = 'public') as public_views,
       (select count(*) from auth.users) as auth_users,
       (select count(*) from storage.buckets) as buckets,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;

-- V0b: platform capabilities the M1–M8 files rely on (real Supabase catalogs). Every column should be true
-- except is_superuser (false is normal on Supabase).
select current_user as sql_editor_role,
       current_setting('server_version') as postgres_version,
       (select rolsuper from pg_roles where rolname = current_user) as is_superuser,
       to_regprocedure('gen_random_uuid()') is not null as has_gen_random_uuid,
       exists (select 1 from pg_roles where rolname = 'anon') as has_anon,
       exists (select 1 from pg_roles where rolname = 'authenticated') as has_authenticated,
       (select rolbypassrls from pg_roles where rolname = 'service_role') as service_role_bypasses_rls,
       has_table_privilege('auth.users', 'TRIGGER') as can_create_signup_trigger,        -- B2
       exists (select 1 from information_schema.columns
               where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at') as has_email_confirmed_at,
       pg_has_role(current_user, (select tableowner from pg_tables where schemaname = 'storage' and tablename = 'objects'), 'MEMBER')
         as can_create_storage_policies,                                                  -- B8, B16
       has_table_privilege('storage.buckets', 'INSERT') as can_insert_buckets,            -- C1
       (select count(*) = 3 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets'
          and column_name in ('public', 'file_size_limit', 'allowed_mime_types')) as buckets_have_limit_columns;

-- V0c: owners of the managed tables, and what new public tables are auto-granted to (informational).
select schemaname, tablename, tableowner from pg_tables
where (schemaname, tablename) in (('auth','users'), ('storage','objects'), ('storage','buckets')) order by 1, 2;
select pg_get_userbyid(d.defaclrole) as for_objects_created_by, d.defaclobjtype as object_type,
       array_to_string(d.defaclacl, ', ') as default_grants
from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public' order by 1, 2;

-- V1. After 00_core_baseline.sql (B1).
-- V1a: seven tables, RLS on (expect 7 rows, all rls = true).
select c.relname as core_table, c.relrowsecurity as rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('profiles','learning_paths','modules','progress','rooms','enrollments','room_modules')
order by 1;
-- V1b: keys and constraints, with delete rules (expect 11 named FKs, rooms_room_code_key,
-- enrollments_room_id_student_id_key, room_modules_module_id_room_id_key, profiles_role_check, modules_status_check).
select conrelid::regclass as table_name, conname, contype,
       case confdeltype when 'c' then 'cascade' when 'a' then 'no action' when 'r' then 'restrict' end as on_delete,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in ('profiles','learning_paths','modules','progress','rooms','enrollments','room_modules')
order by 1, 3, 2;
-- V1c: column types, nullability and defaults.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles','learning_paths','modules','progress','rooms','enrollments','room_modules')
order by table_name, ordinal_position;
-- V1d: table grants right after B1. Expect exactly 4 rows, all for authenticated:
-- enrollments, room_modules, rooms = DELETE,INSERT,SELECT,UPDATE; learning_paths = SELECT.
-- No anon rows, and nothing on profiles, modules or progress (B2 and B8 add column-level grants later).
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
  and table_name in ('profiles','learning_paths','modules','progress','rooms','enrollments','room_modules')
group by 1, 2 order by 1, 2;
-- V1e: policies (expect exactly one: learning_paths "Signed-in users read learning paths").
select tablename, policyname, roles, cmd from pg_policies
where schemaname = 'public' order by 1, 2;
-- V1f: indexes.
select tablename, indexname from pg_indexes
where schemaname = 'public'
  and tablename in ('profiles','learning_paths','modules','progress','rooms','enrollments','room_modules')
order by 1, 2;
-- V1g: auth dependency: profiles.id references auth.users(id) with ON DELETE CASCADE (expect 1 row).
select conname, pg_get_constraintdef(oid) as definition from pg_constraint
where conrelid = 'public.profiles'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass;

-- Later checkpoints (V2 onward) live in one file per migration group, each with its
-- preflight (P) and verification (V) sections; see docs/STAGING_DATABASE_SETUP_PLAN.md:
--   B2      preflight_b2.sql (P2a-P2i), verify_b2.sql (V2a-V2m)
--   B3-B7   verify_b3_b7.sql     B8 verify_b8.sql       B9-B15 verify_b9_b15.sql
--   B16     verify_b16.sql       B17-B23 verify_b17_b23.sql   B24 verify_b24.sql
--   B25-B26 verify_b25_b26.sql (full Stage B)    C1 verify_c1.sql
--   C2-C6   verify_c2_c6.sql     C7-C8 verify_c7_c8.sql (full Stage C)
-- After every group from B3 on, also run the security sweep audit_stage_b.sql (A1-A8).
