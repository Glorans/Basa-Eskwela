-- READ-ONLY post-apply verification for supabase/proposed/m6_teacher_practice_PROPOSED.sql.
-- Writes nothing. Every PASS/FAIL row must say PASS. Prints counts only.
begin transaction read only;

with expected(item, signature, md5) as (values
  ('completion guard (Teacher practice)', 'public.m6_assert_completion_access(uuid)',                 'b02ca1708f0d79c63b1240f2eeeaa285'),
  ('learner completion rules (kept)',     'public.m6_assert_learner_completion_access(uuid)',         '795969b21c895ea830aba4a6bbcf035c'),
  ('M6 answer/complete action (kept)',    'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', '7eb1bb3a3d3de650dac9628ff181f864'),
  ('M6 one assessment per activity (kept)', 'public.m6_one_assessment_per_activity()',               '76e677bf797d8db768e11bc200abb539'),
  ('M8 completion rewards (kept)',        'public.m8_on_comprehension_completed()',                   '6c387f36c9af10a925533d68a44a7bd5'),
  ('M7 completion queue (kept)',          'public.m7_enqueue_completion()',                           'e4a3dd2f01bd80db6ba590659068a92e')
), found as (
  select e.item, e.md5,
    case when to_regprocedure(e.signature) is null then null
         else md5(replace(pg_get_functiondef(e.signature::regprocedure), chr(13), '')) end as found_md5
  from expected e
)
select case when found_md5 = md5 then 'PASS' else 'FAIL' end as result,
       'function ' || item as check_name, coalesce(left(found_md5, 8), 'missing') as found, left(md5, 8) as expected
from found
union all
select case when (select not prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
                  and pg_get_userbyid(proowner) = 'postgres'
                  from pg_proc where oid = 'public.m6_assert_completion_access(uuid)'::regprocedure)
            then 'PASS' else 'FAIL' end, 'completion guard: invoker rights, empty search_path, owned by postgres', '', ''
union all
select case when not has_function_privilege('anon', 'public.m6_assert_completion_access(uuid)', 'execute')
             and not has_function_privilege('authenticated', 'public.m6_assert_completion_access(uuid)', 'execute')
             and has_function_privilege('service_role', 'public.m6_assert_completion_access(uuid)', 'execute')
            then 'PASS' else 'FAIL' end, 'completion guard callable by service_role only', '', ''
union all
select case when (select count(*) from pg_trigger t where t.tgrelid = 'public.m6_comprehension_attempts'::regclass
                  and t.tgenabled = 'O' and t.tgname in ('m6_one_assessment_per_activity', 'm8_m6_completed', 'm7_completed_quiz')) = 3
            then 'PASS' else 'FAIL' end, 'M6 attempt-limit, M8 and M7 completion triggers enabled', '', ''
union all
select case when pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure) like '%v_role = ''teacher'' and v_teacher_status = ''approved''%'
            then 'PASS' else 'FAIL' end, 'Teacher branch requires an approved Teacher', '', ''
union all
select 'INFO', 'comprehension attempts owned by Teachers', count(*)::text, 'reported only'
from public.m6_comprehension_attempts a join public.profiles p on p.id = a.user_id where p.role = 'teacher'
order by 1 desc, 2;

rollback;
