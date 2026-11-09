-- READ-ONLY post-apply verification for supabase/proposed/m4_admin_activity_assignment_PROPOSED.sql (F7).
-- Writes nothing. Every row must say PASS.
begin transaction read only;

with expected(item, signature, md5) as (values
  ('M5 assign check (Admin branch)',    'public.m5_can_assign_activity(uuid,uuid,uuid,uuid)',  'd84b5e4c'),
  ('M4 unassign activity',              'public.m4_unassign_activity(uuid,boolean)',           '8065fa7e'),
  ('M4 admin action list',              'public.m4_admin_classroom_actions()',                 '15d2440b'),
  ('M4 activity audit trigger fn',      'public.m4_audit_admin_activity()',                    'dc930974'),
  ('M6 question-set trigger (kept)',    'public.m6_check_activity_question_set()',             '36ba72a7'),
  ('M6 learner completion gate (kept)', 'public.m6_assert_learner_completion_access(uuid)',    '795969b2'),
  ('M5 learner read check (kept)',      'public.m5_can_read_activity(uuid,uuid)',              '3818cb82')
), found as (
  select e.item, e.md5,
    case when to_regprocedure(e.signature) is null then null
         else left(md5(replace(pg_get_functiondef(e.signature::regprocedure), chr(13), '')), 8) end as found_md5
  from expected e
)
select case when found_md5 = md5 then 'PASS' else 'FAIL' end as result,
       'function ' || item as check_name, coalesce(found_md5, 'missing') as found, md5 as expected
from found
union all
select case when exists (select 1 from pg_trigger t where t.tgname = 'm4_admin_activity_audit'
                         and t.tgrelid = 'public.reading_activity_assignments'::regclass and t.tgenabled = 'O'
                         and t.tgfoid = 'public.m4_audit_admin_activity()'::regprocedure
                         and pg_get_triggerdef(t.oid) like '%AFTER INSERT%FOR EACH ROW%')
            then 'PASS' else 'FAIL' end, 'audit trigger enabled (AFTER INSERT, each row)', '', ''
union all
select case when (select prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""')
                  from pg_proc where oid = 'public.m4_audit_admin_activity()'::regprocedure)
             and not has_function_privilege('authenticated', 'public.m4_audit_admin_activity()', 'execute')
             and not has_function_privilege('anon', 'public.m4_audit_admin_activity()', 'execute')
            then 'PASS' else 'FAIL' end, 'audit trigger function: definer, empty search_path, not callable by clients', '', ''
union all
select case when has_function_privilege('authenticated', 'public.m5_can_assign_activity(uuid,uuid,uuid,uuid)', 'execute')
             and not has_function_privilege('anon', 'public.m5_can_assign_activity(uuid,uuid,uuid,uuid)', 'execute')
             and (select prosecdef and provolatile = 's' from pg_proc where oid = 'public.m5_can_assign_activity(uuid,uuid,uuid,uuid)'::regprocedure)
            then 'PASS' else 'FAIL' end, 'M5 assign check keeps its grants and attributes', '', ''
union all
select case when count(*) = 2 then 'PASS' else 'FAIL' end, 'M5 activity insert policies unchanged', count(*)::text, '2'
from pg_policies where schemaname = 'public' and tablename = 'reading_activity_assignments' and cmd = 'INSERT'
  and with_check like '%m5_can_assign_activity(room_id, material_id, student_id, assigned_by)%'
union all
select case when count(*) = 6 then 'PASS' else 'FAIL' end, 'reading_activity_assignments policies unchanged', count(*)::text, '6'
from pg_policies where schemaname = 'public' and tablename = 'reading_activity_assignments'
union all
select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'm4_admin_actions'
                         and column_name = 'activity_id')
             and pg_get_constraintdef((select oid from pg_constraint where conname = 'm4_admin_actions_action_check')) like '%assign_activity%'
             and pg_get_constraintdef((select oid from pg_constraint where conname = 'm4_admin_actions_shape_check')) like '%activity_id IS NOT NULL%'
            then 'PASS' else 'FAIL' end, 'audit table: activity_id, activity actions and shape check', '', ''
union all
select case when not has_table_privilege('authenticated', 'public.m4_admin_actions', 'insert')
             and not has_table_privilege('authenticated', 'public.m4_admin_actions', 'update')
             and not has_table_privilege('authenticated', 'public.m4_admin_actions', 'delete')
             and (select relrowsecurity from pg_class where oid = 'public.reading_activity_assignments'::regclass)
            then 'PASS' else 'FAIL' end, 'audit rows not writable by clients; activity RLS still enabled', '', ''
order by 1 desc, 2;

rollback;
