-- READ-ONLY preflight for supabase/proposed/m4_admin_room_management_PROPOSED.sql.
-- Writes nothing. Every row must say PASS before the migration may be applied.
-- Fingerprints: md5 of pg_get_functiondef with CR removed (CRLF-safe).
begin transaction read only;

with expected(item, signature, md5) as (values
  ('assign module',        'public.m4_assign_module(uuid,uuid,text,uuid[],timestamptz)', '970dec9a'),
  ('unassign module',      'public.m4_unassign_module(uuid,boolean)',                     '43ef9941'),
  ('admin action list',    'public.m4_admin_classroom_actions()',                         '17a1d55d'),
  ('admin remove student', 'public.m4_admin_remove_enrollment(uuid)',                     '5ae5e9b4')
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
select case when to_regprocedure('public.m4_admin_create_room(uuid,text,text,text,text,text)') is null
             and to_regprocedure('public.m4_admin_update_room(uuid,text,text,text)') is null
             and to_regprocedure('public.m4_admin_classroom_teachers()') is null then 'PASS' else 'FAIL' end,
       'new Admin functions not yet installed', '', 'absent'
union all
select case when (select pg_get_constraintdef(oid) from pg_constraint where conname = 'm4_admin_actions_action_check'
                  and conrelid = 'public.m4_admin_actions'::regclass) = 'CHECK ((action = ''remove_enrollment''::text))'
            then 'PASS' else 'FAIL' end, 'audit action check is the original one', '', ''
union all
select case when not exists (select 1 from information_schema.columns where table_schema = 'public'
                             and table_name = 'm4_admin_actions' and column_name in ('teacher_id', 'room_module_id'))
             and exists (select 1 from information_schema.columns where table_schema = 'public'
                         and table_name = 'm4_admin_actions' and column_name = 'student_id' and is_nullable = 'NO')
            then 'PASS' else 'FAIL' end, 'audit table has its original columns', '', ''
union all
select case when count(*) = 0 then 'PASS' else 'FAIL' end, 'every audit row is an enrollment removal with a student',
       count(*)::text, '0'
from public.m4_admin_actions where action <> 'remove_enrollment' or student_id is null
union all
-- Room policies the migration relies on staying as they are (Teacher create/update own, Admin read-only).
select case when count(*) = 6 then 'PASS' else 'FAIL' end, 'rooms policies unchanged', count(*)::text, '6'
from pg_policies where schemaname = 'public' and tablename = 'rooms'
union all
select case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rooms'
                             and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and qual ilike '%is_admin%')
             and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rooms'
                             and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and with_check ilike '%is_admin%')
            then 'PASS' else 'FAIL' end, 'no Admin write policy on rooms (Admin writes only through audited functions)', '', ''
union all
select case when exists (select 1 from pg_trigger where tgname = 'm4_archived_room_readonly' and tgrelid = 'public.rooms'::regclass)
             and exists (select 1 from pg_trigger where tgname = 'm4_protect_room_subject' and tgrelid = 'public.rooms'::regclass)
             and exists (select 1 from pg_trigger where tgname = 'm4_reject_archived_room' and tgrelid = 'public.room_modules'::regclass)
            then 'PASS' else 'FAIL' end, 'archive, subject and archived-room guards installed', '', ''
union all
select case when exists (select 1 from pg_constraint where conname = 'rooms_room_code_key') then 'PASS' else 'FAIL' end,
       'room codes are unique', '', ''
union all
-- Informational: rooms owned by someone who is not an approved Teacher (Admin cannot assign modules into these).
select 'INFO', 'rooms whose owner is not an approved Teacher', count(*)::text, 'reported only'
from public.rooms r left join public.profiles t on t.id = r.teacher_id
where t.id is null or t.role <> 'teacher' or t.teacher_status is distinct from 'approved'
order by 1 desc, 2;

rollback;
