-- READ-ONLY. m6_student_personal_comprehension: run PREFLIGHT before applying and POST-APPLY after. Every row must be ok = true.
-- Fingerprints are md5(pg_get_functiondef) without CR, measured read-only on ReadFlow-Staging on 2026-11-17.
-- A PREFLIGHT mismatch means a function changed since the review: stop, do not apply.

-- PREFLIGHT
with fn(sig, fp) as (values
  ('public.m6_assert_learner_completion_access(uuid)', '795969b21c895ea830aba4a6bbcf035c'),
  ('public.m8_on_comprehension_completed()', 'f2f7fa2b71a135b195ae43d8aa19c4e3'),
  ('public.m7_save_evaluation(uuid,bigint)', '5d35ed97ae5ff84c8973618775556f88')
)
select 'function ' || sig || ' is the reviewed live version' as check_name,
       coalesce((select md5(replace(pg_get_functiondef(to_regprocedure(sig)), chr(13), '')) = fp), false) as ok
from fn
union all
select 'one-assessment-per-activity trigger present and enabled on m6_comprehension_attempts',
       exists (select 1 from pg_trigger where tgrelid = 'public.m6_comprehension_attempts'::regclass
               and tgname = 'm6_one_assessment_per_activity' and tgenabled <> 'D')
union all
select 'M8 completion trigger present and enabled', exists (select 1 from pg_trigger
       where tgrelid = 'public.m6_comprehension_attempts'::regclass and tgname = 'm8_m6_completed' and tgenabled <> 'D')
union all
select 'no Student module assessment without a classroom exists yet (nothing to reclassify)',
       not exists (select 1 from public.m6_comprehension_attempts a join public.profiles p on p.id = a.user_id
                   where p.role = 'student' and a.room_id is null and a.material_id is null)
union all
select 'no Student passage has both a personal and a classroom assessment',
       not exists (select 1 from public.m6_comprehension_attempts a join public.profiles p on p.id = a.user_id
                   where p.role = 'student' and a.material_id is null
                   group by a.user_id, a.module_id, a.passage_id
                   having bool_or(a.room_id is null) and bool_or(a.room_id is not null))
union all
select 'm6_apply_action completes through m6_assert_completion_access',
       position('perform public.m6_assert_completion_access(activity.id);' in pg_get_functiondef('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)'::regprocedure)) > 0;

-- POST-APPLY
with fn(sig, fp) as (values
  ('public.m6_assert_learner_completion_access(uuid)', '86c31b952cca1a12f3f1d0de1a5b3a95'),
  ('public.m8_on_comprehension_completed()', 'c5daae20ebeb0c67963648fd10f7ed02'),
  ('public.m7_save_evaluation(uuid,bigint)', 'c38bedca53414369917164e4829c652a')
)
select 'function ' || sig || ' is the proposed version' as check_name,
       coalesce((select md5(replace(pg_get_functiondef(to_regprocedure(sig)), chr(13), '')) = fp), false) as ok
from fn
union all
select 'security attributes unchanged (definer/invoker, search_path)',
       (select bool_and(case p.proname
                when 'm6_assert_learner_completion_access' then not p.prosecdef
                else p.prosecdef end and p.proconfig @> array['search_path=""'])
        from pg_proc p where p.oid in ('public.m6_assert_learner_completion_access(uuid)'::regprocedure,
          'public.m8_on_comprehension_completed()'::regprocedure, 'public.m7_save_evaluation(uuid,bigint)'::regprocedure))
union all
select 'no client EXECUTE on m7_save_evaluation and m8_on_comprehension_completed',
       not has_function_privilege('anon', 'public.m7_save_evaluation(uuid,bigint)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.m7_save_evaluation(uuid,bigint)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.m8_on_comprehension_completed()', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.m8_on_comprehension_completed()', 'EXECUTE');
