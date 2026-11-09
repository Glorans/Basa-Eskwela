-- READ-ONLY preflight for supabase/proposed/m3_teacher_module_management_PROPOSED.sql.
-- Writes nothing. Every row must say PASS before the migration may be applied.
-- Fingerprints: md5 of pg_get_functiondef with CR removed (CRLF-safe).
begin transaction read only;

with expected(item, signature, md5) as (values
  ('create draft',      'public.m3_create_collection_draft(uuid,text,uuid,text,jsonb)', 'dfcfdebd'),
  ('lock collection',   'public.m3_lock_collection(uuid,bigint)',                        '7b91c008'),
  ('editor load',       'public.m3_admin_collection(uuid)',                              'f248bf1f'),
  ('publish issues p1', 'public.m3_collection_publish_issues_phase1(uuid)',              '57a9c46a'),
  ('delete module',     'public.m3_delete_module(uuid)',                                 '08d59851'),
  ('read module',       'public.m3_can_read_module(uuid)',                               '11e39d7e'),
  -- Unchanged dependencies the migration relies on (Staging values recorded 2026-11-04/08).
  ('publish issues',    'public.m3_collection_publish_issues(uuid)',                     '6f79cabb'),
  ('save bank',         'public.m3_save_passage_bank(uuid,uuid,bigint,jsonb,text)',      '9e81c4e1'),
  ('save collection',   'public.m3_save_collection(uuid,bigint,text,uuid,text,jsonb,uuid[])', 'cc5e5c94'),
  ('owns material',     'public.m3_owns_material(uuid)',                                 'e432a936'),
  ('publish trigger fn','public.m3_validate_collection_publish()',                       'f5937946')
), found as (
  select e.item, e.signature, e.md5,
    case when to_regprocedure(e.signature) is null then null
         else left(md5(replace(pg_get_functiondef(e.signature::regprocedure), chr(13), '')), 8) end as found_md5
  from expected e
)
select case when found_md5 = md5 then 'PASS' else 'FAIL' end as result,
       'function ' || item as check_name, coalesce(found_md5, 'missing') as found, md5 as expected
from found
union all
select case when to_regprocedure('public.m3_can_manage_module(uuid)') is null then 'PASS' else 'FAIL' end,
       'helper not yet installed', coalesce(to_regprocedure('public.m3_can_manage_module(uuid)')::text, 'absent'), 'absent'
union all
select case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'modules'
                             and policyname = 'M3 approved teachers publish own drafts') then 'PASS' else 'FAIL' end,
       'teacher publish policy not yet installed', '', 'absent'
union all
select case when not exists (select 1 from pg_trigger where tgname = 'm3_teacher_passage_source') then 'PASS' else 'FAIL' end,
       'passage source trigger not yet installed', '', 'absent'
union all
-- The existing modules policies, unchanged (names and expressions).
select case when count(*) = 6 then 'PASS' else 'FAIL' end, 'modules policies unchanged', count(*)::text, '6'
from pg_policies
where schemaname = 'public' and tablename = 'modules'
  and (policyname, left(md5(coalesce(qual, '') || '|' || coalesce(with_check, '')), 8)) in (
    ('M1 Teacher approval required', '0f9779eb'), ('M3 admins create draft modules', '899b41e0'),
    ('M3 admins delete unused drafts', 'fdf5c037'), ('M3 admins update modules', '0945f751'),
    ('M3 role-aware module reads', '3def742e'), ('M5 learners read available modules', 'e9ee71a2'))
union all
select case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'modules') = 6
            then 'PASS' else 'FAIL' end, 'no other modules policies', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'modules')::text, '6'
union all
select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'modules'
                         and column_name = 'created_by' and is_nullable = 'NO')
            and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'modules'
                         and column_name = 'deleted_at') then 'PASS' else 'FAIL' end,
       'modules.created_by required and deleted_at present', '', ''
union all
-- m3_current_role() must still recognise only APPROVED Teachers (the approval gate the migration relies on).
select case when replace(pg_get_functiondef('public.m3_current_role()'::regprocedure), chr(13), '')
                 like '%teacher_status = ''approved''%' then 'PASS' else 'FAIL' end,
       'm3_current_role requires approved Teachers', '', ''
union all
-- Informational: existing Teacher-owned modules (expected 0 before the migration; never changed by it).
select 'INFO', 'modules created by Teachers', count(*)::text, '0 expected'
from public.modules m join public.profiles p on p.id = m.created_by
where p.role = 'teacher'
order by 1 desc, 2;

rollback;
