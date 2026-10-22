-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP B24 alone (supabase/migrations/20261012_m5_m6_uploaded_reading.sql).
-- Before B24: run P8a-P8b below, then the whole of supabase/tests/m5_m6_uploaded_reading_preflight.sql
-- and save its output. After B24: V8a-V8c below, then the whole of
-- supabase/tests/m5_m6_uploaded_reading_verify.sql, then audit_stage_b.sql A1-A8.
-- Those two existing files are not plain SELECTs: each runs inside BEGIN READ ONLY ... ROLLBACK
-- with a DO-block assertion, so it cannot change data. Run each file as a whole; an error = STOP.
-- B24 has its own embedded security guard (DO block). If it raises, B24 rolls back: STOP and
-- inspect. Never edit or remove that guard to get past it.

-- P8a. Guard prerequisites. Expect anon_answer_select false, answers_rls true,
-- scoring_client_execute false, scoring_service_execute true.
select has_table_privilege('anon', 'public.comprehension_question_answers', 'SELECT') as anon_answer_select,
       (select relrowsecurity from pg_class where oid = 'public.comprehension_question_answers'::regclass) as answers_rls,
       has_function_privilege('authenticated', 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE')
         as scoring_client_execute,
       has_function_privilege('service_role', 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE')
         as scoring_service_execute;

-- P8b. Columns B24 adds are absent. Expect 2 rows, already_exists false.
select t.table_name, exists (select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = t.table_name
           and c.column_name = 'activity_assignment_id') as already_exists
from unnest(array['oral_reading_attempts', 'm6_comprehension_attempts']) t(table_name)
order by 1;

-- V8a. New columns. Expect 2 rows: uuid, nullable.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and column_name = 'activity_assignment_id'
  and table_name in ('oral_reading_attempts', 'm6_comprehension_attempts')
order by 1;

-- V8b. New indexes. Expect 2 rows: m5_material_history (oral_reading_attempts) and
-- m6_owner_oral_result_unique (m6_comprehension_attempts, UNIQUE).
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public' and indexname in ('m5_material_history', 'm6_owner_oral_result_unique')
order by 1;

-- V8c. Nothing widened. Expect the same values as P8a, and public_policies 65.
select has_table_privilege('anon', 'public.comprehension_question_answers', 'SELECT') as anon_answer_select,
       has_function_privilege('authenticated', 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE')
         as scoring_client_execute,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies;
