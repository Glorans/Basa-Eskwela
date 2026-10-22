-- READ ONLY. Every statement is a SELECT. Prepared, not executed.
-- B2 VERIFICATION: run in ReadFlow-Staging (oudfrdeqwotynihkkmze) right AFTER
-- supabase/staging/02_b2_hardened.sql and BEFORE B3. Run one section at a time.
-- Any result that differs from "Expect" means STOP: do not continue to B3.
-- Catalog checks do not replace the later signup/role behaviour test.

-- V2a. Profile columns. Expect six rows: the five B1 columns unchanged plus
-- nickname (text, nullable, no default). role stays nullable with no default.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

-- V2b. Role constraint. Expect one row; definition allows NULL, admin, teacher, student,
-- general_user. convalidated = false is EXPECTED (B2 adds it NOT VALID; new writes are checked).
select conname, convalidated, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass and conname = 'profiles_role_check';

-- V2c. Core tables unchanged. Expect 7 rows rls = true, force_rls = false; then 13 indexes.
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

select count(*) as public_indexes_expect_13 from pg_indexes where schemaname = 'public';

-- V2d. The three B2 functions. Expect 3 rows, all present, language plpgsql,
-- proconfig {search_path=""}, owner = profiles owner (same_owner true):
--   assign_own_role(text)                      definer true,  returns text
--   handle_new_user()                          definer true,  returns trigger
--   m1_protect_profile_authorization_fields()  definer false, returns trigger
select expected.signature, p.oid is not null as present,
       pg_get_userbyid(p.proowner) as owner,
       p.proowner = (select relowner from pg_class where oid = 'public.profiles'::regclass) as same_owner,
       l.lanname as language, p.prosecdef as security_definer,
       p.prorettype::regtype as returns, p.proconfig
from (values ('public.assign_own_role(text)'),
             ('public.handle_new_user()'),
             ('public.m1_protect_profile_authorization_fields()')) as expected(signature)
left join pg_proc p on p.oid = to_regprocedure(expected.signature)
left join pg_language l on l.oid = p.prolang
order by 1;

-- V2e. Function EXECUTE for client roles (the B2a security fix). Expect exactly:
--   assign_own_role(text)                      anon false, authenticated true,  public false
--   handle_new_user()                          anon false, authenticated false, public false
--   m1_protect_profile_authorization_fields()  anon false, authenticated false, public false
-- A true in the trigger-function rows means B2 ran WITHOUT the B2a revokes: STOP.
select p.oid::regprocedure as function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
from pg_proc p
where p.oid in (to_regprocedure('public.assign_own_role(text)'),
                to_regprocedure('public.handle_new_user()'),
                to_regprocedure('public.m1_protect_profile_authorization_fields()'))
order by 1;

-- V2f. Triggers. Expect exactly 2 rows, tgenabled O:
--   auth.users       on_auth_user_created                  AFTER INSERT ... FOR EACH ROW EXECUTE FUNCTION handle_new_user()
--   public.profiles  profiles_protect_authorization_fields BEFORE UPDATE ... FOR EACH ROW EXECUTE FUNCTION m1_protect_profile_authorization_fields()
select t.tgrelid::regclass as on_table, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid, true) as definition
from pg_trigger t
where t.tgrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
  and not t.tgisinternal
order by 1, 2;

-- V2g. Policies. Expect exactly 3 rows, all permissive, roles {authenticated}:
--   learning_paths "Signed-in users read learning paths"  SELECT  qual true
--   profiles "M1 users read own profile"                  SELECT  qual (id = auth.uid())
--   profiles "M1 users update own display name"           UPDATE  qual and with_check (id = auth.uid())
-- No INSERT or DELETE policy on profiles.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- V2h. Profile TABLE privileges for clients. Expect 16 rows, allowed false in every row.
select r.role_name, p.privilege,
       has_table_privilege(r.role_name, 'public.profiles', p.privilege) as allowed
from (values ('anon'), ('authenticated')) r(role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(privilege)
order by 1, 2;

-- V2i. Profile COLUMN privileges. Expect 12 rows. anon: all false.
-- authenticated: can_select true on all six columns; can_update true ONLY for full_name and
-- nickname; can_insert false everywhere. Role/status are never client-writable.
select r.role_name, a.attname as column_name,
       has_column_privilege(r.role_name, a.attrelid, a.attnum, 'SELECT') as can_select,
       has_column_privilege(r.role_name, a.attrelid, a.attnum, 'UPDATE') as can_update,
       has_column_privilege(r.role_name, a.attrelid, a.attnum, 'INSERT') as can_insert
from pg_attribute a
cross join (values ('anon'), ('authenticated')) r(role_name)
where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
order by 1, a.attnum;

-- V2j. Backend access retained. Expect service_role true for all four.
select has_table_privilege('service_role', 'public.profiles', 'SELECT') as can_select,
       has_table_privilege('service_role', 'public.profiles', 'INSERT') as can_insert,
       has_table_privilege('service_role', 'public.profiles', 'UPDATE') as can_update,
       has_table_privilege('service_role', 'public.profiles', 'DELETE') as can_delete;

-- V2k. Registration still closed. Expect 0, 0, 0.
select (select count(*) from auth.users) as auth_users,
       (select count(*) from public.profiles) as profiles,
       (select count(*) from auth.users u
        where not exists (select 1 from public.profiles p where p.id = u.id)) as auth_users_missing_profiles;

-- V2l. Event triggers unchanged. Expect the same rows as P2f.
select evtname, evtevent, evtenabled, evttags, evtfoid::regprocedure as function_name
from pg_event_trigger order by evtname;

-- V2m. Storage untouched by B2. Expect the same counts as before B2 (0 policies on a fresh
-- project; buckets 0, or 1 if reading-materials was already created in the dashboard).
select (select count(*) from pg_policies where schemaname = 'storage') as storage_policies,
       (select count(*) from storage.buckets) as storage_buckets;
