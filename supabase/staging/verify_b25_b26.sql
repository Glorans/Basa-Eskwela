-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP B25-B26 (M6 activity question sets, then the six synthetic learning paths) and the
-- FULL STAGE B CHECKPOINT. Run P9a before B25, V9* after B26, then audit_stage_b.sql A1-A8.
-- Take the Stage B backup only after every check here passes. A mismatch means STOP.

-- P9a. Seed not yet applied and no other learning paths exist. Expect learning_paths 0.
select count(*) as learning_paths from public.learning_paths;

-- V9a. B25 functions. Expect 2 rows: present, both client EXECUTE false.
select e.sig as function_name, p.oid is not null as present,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from unnest(array['public.m6_check_activity_question_set()',
                  'public.m6_protect_activity_assignment_mode()']) e(sig)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by 1;

-- V9b. B25 triggers. Expect 2 rows on reading_activity_assignments, tgenabled O.
select e.trigger_name, t.tgenabled
from unnest(array['m6_activity_assignment_mode', 'm6_activity_question_set_check']) e(trigger_name)
left join pg_trigger t on t.tgrelid = 'public.reading_activity_assignments'::regclass
  and t.tgname = e.trigger_name and not t.tgisinternal
order by 1;

-- V9c. Exactly the six seeded learning paths. Expect 6 rows:
--   English Foundations / English / Frustration / Easy
--   English Growing Readers / English / Instructional / Medium
--   English Independent Readers / English / Independent / Hard
--   Filipino Malayang Mambabasa / Filipino / Independent / Hard
--   Filipino Panimulang Pagbasa / Filipino / Frustration / Easy
--   Filipino Umuunlad na Mambabasa / Filipino / Instructional / Medium
select path_name, language, reading_level, difficulty_tier
from public.learning_paths order by 1;

-- V9d. Full Stage B table set. Expect 21 rows, present true and rls true in every row.
select t.name, to_regclass('public.' || t.name) is not null as present,
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t.name)), false) as rls
from unnest(array['profiles', 'learning_paths', 'modules', 'progress', 'rooms', 'enrollments',
  'room_modules', 'diagnostic_results', 'uploaded_materials', 'comprehension_questions',
  'comprehension_question_answers', 'module_passages', 'm3_pending_collection_delivery',
  'm3_deletion_context', 'material_question_sets', 'oral_reading_attempts',
  'reading_activity_assignments', 'teacher_invite_codes', 'teacher_invite_attempts',
  'm6_comprehension_attempts', 'm6_comprehension_responses']) t(name)
order by present, 1;

-- V9e. Signup and scoring boundaries still intact. Expect signup_trigger 1,
-- signup_trigger_enabled O, browser_can_score false, browser_can_write_question_sets false.
select (select count(*) from pg_trigger where tgname = 'on_auth_user_created'
          and tgrelid = 'auth.users'::regclass) as signup_trigger,
       (select tgenabled from pg_trigger where tgname = 'on_auth_user_created'
          and tgrelid = 'auth.users'::regclass) as signup_trigger_enabled,
       has_function_privilege('authenticated', 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE')
         as browser_can_score,
       has_function_privilege('authenticated', 'public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)', 'EXECUTE')
         as browser_can_write_question_sets;

-- V9f. M3 uploads bucket (created in the dashboard, Stage A). Expect 1 row: public false,
-- file_size_limit 26214400, allowed_mime_types exactly application/pdf,
-- application/vnd.openxmlformats-officedocument.wordprocessingml.document, image/jpeg, image/png.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'reading-materials';

-- V9g. Stage B totals. Expect public_tables 21, public_policies 65, storage_policies 4,
-- auth_users_missing_profiles 0.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies,
       (select count(*) from auth.users u
        where not exists (select 1 from public.profiles p where p.id = u.id)) as auth_users_missing_profiles;
