-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP B9-B15 (student module access, M4 classrooms, M5 oral reading, passages phase 1/2,
-- collection publication, module deletion). Run P5* before B9, V5* after B15,
-- then audit_stage_b.sql A1-A8. A mismatch means STOP.

-- P5a. M4 prerequisites from B1. Expect 3 rows, contype u, condeferrable false
-- (B10 requires immediate UNIQUE constraints for its ON CONFLICT clauses).
select conrelid::regclass as table_name, conname, contype, condeferrable,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conname in ('rooms_room_code_key', 'enrollments_room_id_student_id_key',
                  'room_modules_module_id_room_id_key')
order by 1;

-- P5b. Group objects absent. Expect 4 rows, already_exists false.
select t.name, to_regclass('public.' || t.name) is not null as already_exists
from unnest(array['oral_reading_attempts', 'module_passages', 'm3_pending_collection_delivery',
                  'm3_deletion_context']) t(name)
order by 1;

-- V5a. New tables. Expect 4 rows: present true, rls true, force_rls false.
select t.name, c.oid is not null as present, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
from unnest(array['oral_reading_attempts', 'module_passages', 'm3_pending_collection_delivery',
                  'm3_deletion_context']) t(name)
left join pg_class c on c.oid = to_regclass('public.' || t.name)
order by 1;

-- V5b. New functions and their client EXECUTE. Expect 21 rows, as_expected true in every row:
-- present, search_path pinned, anon false, authenticated = expected_authenticated.
-- security_definer is true for all except m3_protect_passage_identity / m3_protect_question_passage.
select e.sig as function_name, p.oid is not null as present, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       e.authenticated as expected_authenticated,
       p.oid is not null
         and coalesce(p.proconfig, '{}') @> array['search_path=""']
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.authenticated as as_expected
from (values
  ('public.is_admin()', true),
  ('public.m4_current_role()', true),
  ('public.join_room_by_code(text)', true),
  ('public.m6_is_enrolled_in_room(uuid)', true),
  ('public.m3_admin_collection(uuid)', true),
  ('public.m3_collection_publish_issues(uuid)', true),
  ('public.m3_create_collection_draft(uuid,text,uuid,text,jsonb)', true),
  ('public.m3_save_collection(uuid,bigint,text,uuid,text,jsonb,uuid[])', true),
  ('public.m3_save_passage_bank(uuid,uuid,bigint,jsonb,text)', true),
  ('public.m3_delete_module(uuid)', true),
  ('public.m3_deletion_has_history(uuid)', false),
  ('public.m3_lock_collection(uuid,bigint)', false),
  ('public.m3_block_pending_collection_publish()', false),
  ('public.m3_collection_bank_changed()', false),
  ('public.m3_collection_revision_trigger()', false),
  ('public.m3_mark_pending_collection()', false),
  ('public.m3_protect_deleted_module()', false),
  ('public.m3_protect_passage_identity()', false),
  ('public.m3_protect_question_passage()', false),
  ('public.m3_reject_deleted_assignment()', false),
  ('public.m3_validate_collection_publish()', false)
) e(sig, authenticated)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by as_expected, 1;

-- V5c. New row triggers. Expect 10 rows, tgenabled O in every row (NULL = missing).
select e.on_table, e.trigger_name, t.tgenabled
from (values
  ('public.module_passages', 'module_passages_identity'),
  ('public.module_passages', 'module_passages_pending_delivery'),
  ('public.module_passages', 'module_passages_updated_at'),
  ('public.comprehension_questions', 'comprehension_questions_passage_identity'),
  ('public.comprehension_questions', 'questions_collection_change'),
  ('public.comprehension_question_answers', 'answers_collection_change'),
  ('public.modules', 'modules_collection_publish_validation'),
  ('public.modules', 'modules_collection_revision'),
  ('public.modules', 'modules_protect_deleted'),
  ('public.room_modules', 'room_modules_reject_deleted')
) e(on_table, trigger_name)
left join pg_trigger t on t.tgrelid = to_regclass(e.on_table) and t.tgname = e.trigger_name
  and not t.tgisinternal
order by 1, 2;

-- V5d. Classroom and attempt policies. Expect these counts, all permissive, {authenticated}:
--   enrollments 3, module_passages 1, oral_reading_attempts 2, profiles 4 (2 from B2 +
--   admin/enrolled-teacher reads), room_modules 4, rooms 5.
-- Students see only rooms they are enrolled in; teachers only their own rooms.
select tablename, count(*) as policies,
       string_agg(policyname || ' [' || cmd || ']', '; ' order by policyname) as policy_names
from pg_policies
where schemaname = 'public' and tablename in ('enrollments', 'module_passages',
  'oral_reading_attempts', 'profiles', 'room_modules', 'rooms')
group by 1 order by 1;

-- V5e. Client table privileges on the new tables. Expect anon (empty) on all four;
-- authenticated: module_passages SELECT; oral_reading_attempts SELECT,INSERT (B21 later removes
-- INSERT); m3_deletion_context and m3_pending_collection_delivery (empty).
select c.relname as table_name, r.role_name,
       array_to_string(array(
         select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                    'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
         where has_table_privilege(r.role_name, c.oid, p)), ',') as table_privileges
from pg_class c cross join (values ('anon'), ('authenticated')) r(role_name)
where c.oid in (to_regclass('public.oral_reading_attempts'), to_regclass('public.module_passages'),
  to_regclass('public.m3_pending_collection_delivery'), to_regclass('public.m3_deletion_context'))
order by 1, 2;

-- V5f. Checkpoint totals. Expect public_tables 15, public_policies 41, storage_policies 3.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;
