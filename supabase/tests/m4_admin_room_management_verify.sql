-- READ-ONLY post-apply verification for supabase/proposed/m4_admin_room_management_PROPOSED.sql.
-- Writes nothing. Every row must say PASS.
begin transaction read only;

with expected(item, signature, md5) as (values
  ('assign module',        'public.m4_assign_module(uuid,uuid,text,uuid[],timestamptz)', '50c6b0f2'),
  ('unassign module',      'public.m4_unassign_module(uuid,boolean)',                     'bf5be251'),
  ('admin action list',    'public.m4_admin_classroom_actions()',                         '995e32bb'),
  ('admin remove student', 'public.m4_admin_remove_enrollment(uuid)',                     '5ae5e9b4'),
  ('admin teacher list',   'public.m4_admin_classroom_teachers()',                        '2e7ef340'),
  ('admin create room',    'public.m4_admin_create_room(uuid,text,text,text,text,text)',  'dcfcba18'),
  ('admin update room',    'public.m4_admin_update_room(uuid,text,text,text)',            '8417a77d')
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
select case when bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""'))
            then 'PASS' else 'FAIL' end, 'new functions are security definer with an empty search_path', '', ''
from pg_proc p where p.oid in ('public.m4_admin_classroom_teachers()'::regprocedure,
  'public.m4_admin_create_room(uuid,text,text,text,text,text)'::regprocedure, 'public.m4_admin_update_room(uuid,text,text,text)'::regprocedure)
union all
select case when bool_and(has_function_privilege('authenticated', s, 'execute') and not has_function_privilege('anon', s, 'execute'))
            then 'PASS' else 'FAIL' end, 'new functions: authenticated only, not anon', '', ''
from unnest(array['public.m4_admin_classroom_teachers()', 'public.m4_admin_create_room(uuid,text,text,text,text,text)',
                  'public.m4_admin_update_room(uuid,text,text,text)']) s
union all
select case when bool_and(has_function_privilege('authenticated', s, 'execute')) then 'PASS' else 'FAIL' end,
       'replaced functions still executable by authenticated', '', ''
from unnest(array['public.m4_assign_module(uuid,uuid,text,uuid[],timestamptz)', 'public.m4_unassign_module(uuid,boolean)',
                  'public.m4_admin_classroom_actions()']) s
union all
select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'm4_admin_actions'
                         and column_name = 'student_id' and is_nullable = 'YES')
             and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'm4_admin_actions'
                  and column_name in ('teacher_id', 'room_module_id')) = 2
             and exists (select 1 from pg_constraint where conname = 'm4_admin_actions_shape_check')
            then 'PASS' else 'FAIL' end, 'audit table extended with shape check', '', ''
union all
select case when not has_table_privilege('authenticated', 'public.m4_admin_actions', 'insert')
             and not has_table_privilege('authenticated', 'public.m4_admin_actions', 'update')
             and not has_table_privilege('authenticated', 'public.m4_admin_actions', 'delete')
            then 'PASS' else 'FAIL' end, 'clients cannot write the audit table', '', ''
union all
select case when count(*) = 6 then 'PASS' else 'FAIL' end, 'rooms policies unchanged (no Admin write policy)', count(*)::text, '6'
from pg_policies where schemaname = 'public' and tablename = 'rooms'
union all
select case when (select relrowsecurity from pg_class where oid = 'public.m4_admin_actions'::regclass)
             and (select relrowsecurity from pg_class where oid = 'public.rooms'::regclass) then 'PASS' else 'FAIL' end,
       'RLS still enabled on rooms and the audit table', '', ''
order by 1 desc, 2;

rollback;
