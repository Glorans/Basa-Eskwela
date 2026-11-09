-- READ-ONLY preflight for supabase/proposed/m4_admin_activity_assignment_PROPOSED.sql (F7).
-- Run AFTER m4_admin_room_management is applied and verified. Writes nothing. Every row must say PASS.
begin transaction read only;

with expected(item, signature, md5) as (values
  ('M5 assign check (replaced)',        'public.m5_can_assign_activity(uuid,uuid,uuid,uuid)',        'e2cffc86'),
  ('M4 unassign activity (replaced)',   'public.m4_unassign_activity(uuid,boolean)',                 'e190de08'),
  ('M4 admin action list (replaced)',   'public.m4_admin_classroom_actions()',                       '995e32bb'),
  ('M6 question-set trigger (kept)',    'public.m6_check_activity_question_set()',                   '36ba72a7'),
  ('M6 learner completion gate (kept)', 'public.m6_assert_learner_completion_access(uuid)',          '795969b2'),
  ('M5 learner read check (kept)',      'public.m5_can_read_activity(uuid,uuid)',                    '3818cb82'),
  ('M4 admin create room (installed)',  'public.m4_admin_create_room(uuid,text,text,text,text,text)', 'dcfcba18')
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
select case when to_regprocedure('public.m4_audit_admin_activity()') is null
             and not exists (select 1 from pg_trigger where tgname = 'm4_admin_activity_audit') then 'PASS' else 'FAIL' end,
       'F7 audit trigger not yet installed', '', 'absent'
union all
select case when not exists (select 1 from information_schema.columns where table_schema = 'public'
                             and table_name = 'm4_admin_actions' and column_name = 'activity_id')
             and exists (select 1 from information_schema.columns where table_schema = 'public'
                         and table_name = 'm4_admin_actions' and column_name = 'room_module_id')
            then 'PASS' else 'FAIL' end, 'audit table is the M4 Admin room-management shape', '', ''
union all
select case when count(*) = 2 then 'PASS' else 'FAIL' end, 'M5 activity insert policies call m5_can_assign_activity',
       count(*)::text, '2'
from pg_policies where schemaname = 'public' and tablename = 'reading_activity_assignments' and cmd = 'INSERT'
  and with_check like '%m5_can_assign_activity(room_id, material_id, student_id, assigned_by)%'
union all
select case when count(*) = 6 then 'PASS' else 'FAIL' end, 'reading_activity_assignments policies unchanged',
       count(*)::text, '6'
from pg_policies where schemaname = 'public' and tablename = 'reading_activity_assignments'
union all
select case when exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'reading_activity_assignments'
                         and indexname = 'reading_activity_room_material_student_unique' and indexdef like 'CREATE UNIQUE INDEX%(room_id, material_id, student_id)')
             and exists (select 1 from pg_trigger where tgname = 'm4_reject_archived_room' and tgrelid = 'public.reading_activity_assignments'::regclass)
             and exists (select 1 from pg_trigger where tgname = 'm6_activity_question_set_check' and tgrelid = 'public.reading_activity_assignments'::regclass)
            then 'PASS' else 'FAIL' end, 'duplicate, archived-room and question-set guards installed', '', ''
union all
select 'INFO', 'existing reading activities (unchanged by the migration)', count(*)::text, 'reported only'
from public.reading_activity_assignments
order by 1 desc, 2;

rollback;
