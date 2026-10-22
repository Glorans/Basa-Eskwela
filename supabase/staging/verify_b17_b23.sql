-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP B17-B23 (profile age, material question sets/options, M5 activity assignments,
-- selected-passage security, M6 schema, M6 functions). Run P7* before B17, V7* after B23,
-- then audit_stage_b.sql A1-A8. A mismatch means STOP.

-- P7a. B17's guard needs column-scoped profile SELECT. Expect authenticated_table_select
-- false and anon_any_select false; otherwise B17 aborts (and private age would leak).
select has_table_privilege('authenticated', 'public.profiles', 'SELECT') as authenticated_table_select,
       has_any_column_privilege('anon', 'public.profiles', 'SELECT') as anon_any_select;

-- P7b. Group objects absent. Expect 4 rows, already_exists false.
select t.name, to_regclass('public.' || t.name) is not null as already_exists
from unnest(array['material_question_sets', 'reading_activity_assignments',
                  'm6_comprehension_attempts', 'm6_comprehension_responses']) t(name)
order by 1;

-- V7a. New tables. Expect 4 rows: present true, rls true, force_rls false.
select t.name, c.oid is not null as present, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
from unnest(array['material_question_sets', 'reading_activity_assignments',
                  'm6_comprehension_attempts', 'm6_comprehension_responses']) t(name)
left join pg_class c on c.oid = to_regclass('public.' || t.name)
order by 1;

-- V7b. Private age. Expect can_select false (age is read only through
-- get_own_profile_age), can_update true (own row, via the B2 UPDATE policy).
select has_column_privilege('authenticated', 'public.profiles', 'age', 'SELECT') as can_select,
       has_column_privilege('authenticated', 'public.profiles', 'age', 'UPDATE') as can_update;

-- V7c. Functions and client EXECUTE. Expect 9 rows, as_expected true in every row.
-- m6_apply_action (scoring) and m3_write_material_question_set are backend-only:
-- service_role true, both client roles false.
select e.sig as function_name, p.oid is not null as present,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       e.authenticated as expected_authenticated,
       p.oid is not null and coalesce(p.proconfig, '{}') @> array['search_path=""']
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.authenticated as as_expected
from (values
  ('public.get_own_profile_age(uuid)', true),
  ('public.m3_admin_collection(uuid)', true),
  ('public.m3_save_passage_bank(uuid,uuid,bigint,jsonb,text)', true),
  ('public.m5_can_assign_activity(uuid,uuid,uuid,uuid)', true),
  ('public.m5_can_read_activity(uuid,uuid)', true),
  ('public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)', false),
  ('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', false),
  ('public.m3_protect_question_set_identity()', false),
  ('public.m5_protect_activity_identity()', false)
) e(sig, authenticated)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by as_expected, 1;

-- V7d. Activity-assignment privileges (B20). Expect anon (empty);
-- authenticated table SELECT,INSERT; update_columns status only.
-- B20 does not reset Supabase defaults: extra privileges (especially TRUNCATE, which RLS does
-- not control) = STOP pending an approved narrow REVOKE.
select r.role_name,
       array_to_string(array(
         select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                    'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
         where has_table_privilege(r.role_name, 'public.reading_activity_assignments', p)), ',') as table_privileges,
       (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
        where a.attrelid = 'public.reading_activity_assignments'::regclass and a.attnum > 0
          and not a.attisdropped
          and has_column_privilege(r.role_name, a.attrelid, a.attnum, 'UPDATE')) as update_columns
from (values ('anon'), ('authenticated')) r(role_name)
order by 1;

-- V7e. Other new-table and attempt privileges. Expect anon (empty) everywhere.
-- authenticated: material_question_sets SELECT; oral_reading_attempts SELECT only (B21 revokes
-- client INSERT/UPDATE/DELETE: attempts are saved by the server); m6_comprehension_attempts and
-- m6_comprehension_responses (empty): the backend scores through m6_apply_action.
select c.relname as table_name, r.role_name,
       array_to_string(array(
         select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                    'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
         where has_table_privilege(r.role_name, c.oid, p)), ',') as table_privileges
from pg_class c cross join (values ('anon'), ('authenticated')) r(role_name)
where c.oid in (to_regclass('public.material_question_sets'), to_regclass('public.oral_reading_attempts'),
  to_regclass('public.m6_comprehension_attempts'), to_regclass('public.m6_comprehension_responses'))
order by 1, 2;

-- V7f. M5 boundary policies. Expect reading_activity_assignments 6 policies (3 RESTRICTIVE
-- boundaries: insert, read, update; 3 PERMISSIVE: assign, read, student progress);
-- RESTRICTIVE "M5 learners read available modules" on modules,
-- "M5 learners read available passages" on module_passages,
-- "M5 server computed inserts only" on oral_reading_attempts.
select tablename, policyname, permissive, cmd
from pg_policies
where schemaname = 'public' and (tablename = 'reading_activity_assignments' or policyname like 'M5 %')
order by 1, 2;

-- V7g. New triggers. Expect 2 rows, tgenabled O.
select e.on_table, e.trigger_name, t.tgenabled
from (values ('public.comprehension_questions', 'comprehension_questions_set_identity'),
             ('public.reading_activity_assignments', 'm5_activity_identity')) e(on_table, trigger_name)
left join pg_trigger t on t.tgrelid = to_regclass(e.on_table) and t.tgname = e.trigger_name
  and not t.tgisinternal
order by 1, 2;

-- V7h. Checkpoint totals. Expect public_tables 21, public_policies 65, storage_policies 4.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;
