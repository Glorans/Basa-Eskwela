-- READ ONLY. Every statement is a SELECT. Prepared, not executed.
-- B2 PREFLIGHT: run in ReadFlow-Staging (oudfrdeqwotynihkkmze) after V1 passed and BEFORE
-- supabase/staging/02_b2_hardened.sql. Confirm the dashboard URL first; SQL cannot prove the project.
-- Run one section at a time (the SQL editor shows only the last result of a multi-query run).
-- Any result that differs from "Expect" means STOP and review before running B2.

-- P2a. Migration role and prerequisites.
-- Expect: PostgreSQL 17.11; owns_profiles, profiles_rls, every can_* and has_* column true;
-- profiles_force_rls false.
select current_user as migration_role,
       current_setting('server_version') as postgres_version,
       pg_get_userbyid(c.relowner) as profiles_owner,
       c.relowner = (select oid from pg_roles where rolname = current_user) as owns_profiles,
       c.relrowsecurity as profiles_rls,
       c.relforcerowsecurity as profiles_force_rls,
       has_schema_privilege(current_user, 'public', 'CREATE') as can_create_public_functions,
       has_schema_privilege(current_user, 'auth', 'USAGE') as can_use_auth,
       has_table_privilege(current_user, 'auth.users', 'TRIGGER') as can_create_signup_trigger,
       to_regprocedure('auth.uid()') is not null as has_auth_uid,
       to_regprocedure('auth.role()') is not null as has_auth_role
from pg_class c where c.oid = 'public.profiles'::regclass;

-- P2b. Client roles. Expect anon and authenticated: rolsuper false, rolbypassrls false;
-- service_role: rolbypassrls true.
select rolname, rolsuper, rolbypassrls
from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
order by rolname;

-- P2c. Registration is still closed. Expect 0, 0, 0.
-- B2 creates profiles only for FUTURE auth.users inserts; it does not backfill.
select (select count(*) from auth.users) as auth_users,
       (select count(*) from public.profiles) as profiles,
       (select count(*) from auth.users u
        where not exists (select 1 from public.profiles p where p.id = u.id)) as auth_users_missing_profiles;

-- P2d. B2 functions do not exist yet. Expect 3 rows, existing_function NULL in each.
select signature, to_regprocedure(signature) as existing_function
from (values ('public.handle_new_user()'),
             ('public.m1_protect_profile_authorization_fields()'),
             ('public.assign_own_role(text)')) as expected(signature);

-- P2e. Row triggers on auth.users and public.profiles. Expect 0 rows on fresh B1.
-- B2 drops only on_auth_user_created; any other trigger here needs review first.
select t.tgrelid::regclass as on_table, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
where t.tgrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  and not t.tgisinternal
order by 1, 2;

-- P2f. Event triggers. Expect ensure_rls (ddl_command_end, enabled O, tags CREATE TABLE /
-- CREATE TABLE AS / SELECT INTO, standard_create_only_tags true) plus Supabase's six platform
-- triggers: issue_graphql_placeholder, issue_pg_cron_access, issue_pg_graphql_access,
-- issue_pg_net_access, pgrst_ddl_watch, pgrst_drop_watch. B2 creates no tables, so ensure_rls
-- does not fire for it. Any other trigger needs review. Never disable an event trigger.
select e.evtname, e.evtevent, e.evtenabled, e.evttags,
       e.evtfoid::regprocedure as function_name,
       e.evtname = 'ensure_rls'
         and e.evtevent = 'ddl_command_end'
         and cardinality(e.evttags) > 0
         and e.evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
         as standard_create_only_tags
from pg_event_trigger e order by e.evtname;

-- P2g. Profile columns. Expect exactly the five B1 columns: id, full_name, role, status,
-- created_at. role: nullable, no default. nickname/teacher_status/age must be absent.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- P2h. Public policies. Expect exactly one row: learning_paths
-- "Signed-in users read learning paths", SELECT, {authenticated}.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- P2i. Default privileges for functions created in public. A row granting EXECUTE ('X') to
-- anon or authenticated means new functions are client-executable unless revoked by name.
-- This is why the hardened bundle (B2 + B2a) is required. Record the result.
select pg_get_userbyid(d.defaclrole) as creator,
       coalesce(n.nspname, '(global)') as scope,
       d.defaclobjtype as object_type,
       d.defaclacl as default_grants
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
where d.defaclnamespace = 0 or n.nspname = 'public'
order by 1, 2, 3;
