-- READ-ONLY post-apply verification for supabase/proposed/m3_teacher_module_management_PROPOSED.sql.
-- Writes nothing. Every row must say PASS.
begin transaction read only;

with expected(item, signature, md5) as (values
  ('create draft',      'public.m3_create_collection_draft(uuid,text,uuid,text,jsonb)', 'e650b474'),
  ('lock collection',   'public.m3_lock_collection(uuid,bigint)',                        'd817bcfc'),
  ('editor load',       'public.m3_admin_collection(uuid)',                              '08f5bd4f'),
  ('publish issues p1', 'public.m3_collection_publish_issues_phase1(uuid)',              '1fcaef22'),
  ('delete module',     'public.m3_delete_module(uuid)',                                 'b1274f83'),
  ('read module',       'public.m3_can_read_module(uuid)',                               '5de6a069'),
  -- Must be untouched by the migration.
  ('publish issues',    'public.m3_collection_publish_issues(uuid)',                     '6f79cabb'),
  ('save bank',         'public.m3_save_passage_bank(uuid,uuid,bigint,jsonb,text)',      '9e81c4e1'),
  ('save collection',   'public.m3_save_collection(uuid,bigint,text,uuid,text,jsonb,uuid[])', 'cc5e5c94'),
  ('publish trigger fn','public.m3_validate_collection_publish()',                       'f5937946')
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
select case when to_regprocedure('public.m3_can_manage_module(uuid)') is not null
             and (select prosecdef from pg_proc where oid = 'public.m3_can_manage_module(uuid)'::regprocedure)
            then 'PASS' else 'FAIL' end, 'helper installed (security definer)', '', ''
union all
select case when not has_function_privilege('authenticated', 'public.m3_can_manage_module(uuid)', 'execute')
             and not has_function_privilege('anon', 'public.m3_can_manage_module(uuid)', 'execute')
            then 'PASS' else 'FAIL' end, 'helper not callable by clients', '', ''
union all
-- The replaced functions keep their client grants.
select case when bool_and(has_function_privilege('authenticated', s, 'execute')) then 'PASS' else 'FAIL' end,
       'replaced RPCs still executable by authenticated', '', ''
from unnest(array['public.m3_create_collection_draft(uuid,text,uuid,text,jsonb)', 'public.m3_admin_collection(uuid)',
                  'public.m3_collection_publish_issues(uuid)', 'public.m3_delete_module(uuid)',
                  'public.m3_save_collection(uuid,bigint,text,uuid,text,jsonb,uuid[])',
                  'public.m3_save_passage_bank(uuid,uuid,bigint,jsonb,text)']) as s
union all
select case when exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'modules'
    and policyname = 'M3 approved teachers publish own drafts' and cmd = 'UPDATE' and permissive = 'PERMISSIVE'
    and roles = '{authenticated}'
    and qual like '%m3_current_role() = ''teacher''%' and qual like '%created_by = auth.uid()%'
    and qual like '%status = ''draft''%' and qual like '%published_at IS NULL%' and qual like '%deleted_at IS NULL%'
    and with_check like '%created_by = auth.uid()%' and with_check like '%deleted_at IS NULL%')
  then 'PASS' else 'FAIL' end, 'teacher publish policy installed as reviewed', '', ''
union all
select case when count(*) = 7 then 'PASS' else 'FAIL' end, 'modules policies: 6 original + 1 new', count(*)::text, '7'
from pg_policies where schemaname = 'public' and tablename = 'modules'
union all
select case when exists (select 1 from pg_trigger where tgname = 'm3_teacher_passage_source'
                         and tgrelid = 'public.module_passages'::regclass and tgenabled = 'O')
            then 'PASS' else 'FAIL' end, 'passage source trigger enabled', '', ''
union all
select case when not has_function_privilege('authenticated', 'public.m3_guard_teacher_passage_source()', 'execute')
            then 'PASS' else 'FAIL' end, 'trigger function not callable by clients', '', ''
order by 1 desc, 2;

rollback;
