-- READ-ONLY checks for m6_one_assessment_per_activity_PROPOSED.sql. SELECT only; counts and flags,
-- no names, emails or answers. Run before applying (preflight) and again after applying or rolling back.

-- 1. Installed state: the guard function and trigger (absent before, present after).
select to_regprocedure('public.m6_one_assessment_per_activity()') is not null as function_present,
       exists (select 1 from pg_trigger where tgname = 'm6_one_assessment_per_activity' and not tgisinternal) as trigger_present,
       (select md5(replace(pg_get_functiondef(p.oid), chr(13), '')) from pg_proc p
         where p.oid = to_regprocedure('public.m6_one_assessment_per_activity()')) as function_md5;

-- 2. Required columns (8 expected).
select count(*) as activity_columns from information_schema.columns
where table_schema = 'public' and table_name = 'm6_comprehension_attempts'
  and column_name in ('user_id', 'module_id', 'passage_id', 'room_id', 'assignment_id', 'material_id', 'activity_assignment_id', 'status');

-- 3. Activities that already have more than one attempt (saved under the old per-reading rule).
--    These rows are preserved unchanged; the app shows the first completed attempt, otherwise the
--    first started; the database refuses new attempts and a second completion for them.
select p.role, case when a.material_id is null then 'module' else 'material' end as kind,
       count(*) as attempts, count(*) filter (where a.status = 'completed') as completed,
       count(distinct a.oral_reading_attempt_id) as readings
from public.m6_comprehension_attempts a join public.profiles p on p.id = a.user_id
group by p.role, a.user_id, a.module_id, a.passage_id, a.room_id, a.assignment_id, a.material_id, a.activity_assignment_id,
         case when a.material_id is null then 'module' else 'material' end
having count(*) > 1
order by 1, 2;

-- 4. Activities with more than one COMPLETED attempt (legacy; never changed, never added to).
select count(*) as activities_with_several_completed from (
  select 1 from public.m6_comprehension_attempts a where a.status = 'completed'
  group by a.user_id, a.module_id, a.passage_id, a.room_id, a.assignment_id, a.material_id, a.activity_assignment_id
  having count(*) > 1) x;

-- 5. Totals that the migration must not change.
select (select count(*) from public.m6_comprehension_attempts) as attempts,
       (select count(*) from public.m6_comprehension_attempts where status = 'completed') as completed,
       (select count(*) from public.m6_comprehension_responses) as responses,
       (select count(*) from public.oral_reading_attempts) as readings;

-- 6. Other M6 triggers and the protected functions stay as they are.
select t.tgname, t.tgenabled from pg_trigger t
where t.tgrelid = 'public.m6_comprehension_attempts'::regclass and not t.tgisinternal order by 1;
select md5(replace(prosrc, chr(13), '')) as m6_apply_action_prosrc
from pg_proc where oid = to_regprocedure('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)');
