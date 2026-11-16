-- READ-ONLY. m3_teacher_trash: run PREFLIGHT before applying and POST-APPLY after. Every row must be ok = true.
-- Fingerprints are md5(pg_get_functiondef) without CR, measured read-only on ReadFlow-Staging on 2026-11-17.
-- A PREFLIGHT mismatch means a function changed since the review: stop, do not apply.

-- PREFLIGHT
with fn(sig, fp) as (values
  ('public.m3_trash_module(uuid)',     '1e036e009fd302a638d14927cab2b49f'),
  ('public.m3_restore_module(uuid)',   '7dce18208e81bccefcba23495a553682'),
  ('public.m3_trashed_modules()',      '72d968603801edab89431aed4591a8ab'),
  ('public.m3_delete_module(uuid)',    'b1274f831cfac200f90f92580f7a68f6'),
  ('public.m3_purge_module(uuid)',     '7fe028161bb7f2ff2fcd4f982fc261b6'),
  ('public.m3_can_manage_module(uuid)', '8d4a7e597680188833fa6dc368d9f37e'),
  ('public.m3_require_admin()',        '100d609243f2f2e26031015105aad334')
)
select 'function ' || sig || ' is the reviewed live version' as check_name,
       coalesce((select md5(replace(pg_get_functiondef(to_regprocedure(sig)), chr(13), '')) = fp), false) as ok
from fn
union all
select 'helper public.m3_trash_manager(uuid) not installed yet', to_regprocedure('public.m3_trash_manager(uuid)') is null
union all
select 'Publish Again objects not installed yet (m3_republish_module, m3_teacher_restored_modules)',
       to_regprocedure('public.m3_republish_module(uuid)') is null and to_regclass('public.m3_teacher_restored_modules') is null
union all
select 'publish validation and metadata triggers present on modules (used by Publish Again)',
       (select count(*) from pg_trigger where tgrelid = 'public.modules'::regclass and not tgisinternal and tgenabled <> 'D'
          and tgname in ('modules_collection_publish_validation', 'modules_m3_metadata')) = 2
union all
select 'm3_module_trash table present with its Admin read policy',
       to_regclass('public.m3_module_trash') is not null
       and exists (select 1 from pg_policies where tablename = 'm3_module_trash' and policyname = 'M3 Admins read the Trash')
union all
select 'room_modules.removed_at exists (used for the Teacher assignment check)',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'room_modules' and column_name = 'removed_at');

-- POST-APPLY
select 'helper m3_trash_manager is SECURITY DEFINER, empty search_path, no client EXECUTE' as check_name,
       coalesce((select p.prosecdef and p.proconfig @> array['search_path=""']
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                 from pg_proc p where p.oid = to_regprocedure('public.m3_trash_manager(uuid)')), false) as ok
union all
select 'm3_trash_module uses the helper and refuses Teachers while the module is assigned',
       coalesce((select prosrc like '%m3_trash_manager(target_id)%' and prosrc like '%room_modules rm where rm.module_id = target_id and rm.removed_at is null%'
                 and prosrc not like '%m3_require_admin()%' from pg_proc where oid = to_regprocedure('public.m3_trash_module(uuid)')), false)
union all
select 'm3_restore_module uses the helper and limits Teachers to modules they trashed',
       coalesce((select prosrc like '%m3_trash_manager(target_id)%' and prosrc like '%t.trashed_by = auth.uid()%'
                 from pg_proc where oid = to_regprocedure('public.m3_restore_module(uuid)')), false)
union all
select 'm3_trashed_modules filters Teachers to their own trashed modules',
       coalesce((select prosrc like '%t.trashed_by = auth.uid() and m.created_by = auth.uid()%'
                 from pg_proc where oid = to_regprocedure('public.m3_trashed_modules()')), false)
union all
select 'm3_delete_module refuses Teachers (no permanent deletion for Teachers)',
       coalesce((select prosrc like '%permanent deletion is not available to Teachers%'
                 from pg_proc where oid = to_regprocedure('public.m3_delete_module(uuid)')), false)
union all
select 'm3_purge_module unchanged (Admin-only)',
       coalesce((select md5(replace(pg_get_functiondef(to_regprocedure('public.m3_purge_module(uuid)')), chr(13), '')) = '7fe028161bb7f2ff2fcd4f982fc261b6'), false)
union all
select 'signed-in users may still call trash, restore, list and delete (the functions decide)',
       has_function_privilege('authenticated', 'public.m3_trash_module(uuid)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.m3_restore_module(uuid)', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.m3_trashed_modules()', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.m3_delete_module(uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.m3_trash_module(uuid)', 'EXECUTE')
union all
select 'Publish Again: m3_republish_module is SECURITY DEFINER, empty search_path; authenticated may execute, anon may not',
       coalesce((select p.prosecdef and p.proconfig @> array['search_path=""']
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                 from pg_proc p where p.oid = to_regprocedure('public.m3_republish_module(uuid)')), false)
union all
select 'Publish Again: owner + archived + own-restore marker checks, status-only update',
       coalesce((select prosrc like '%m3_can_manage_module(target_id)%' and prosrc like '%m.status <> ''archived''%'
                   and prosrc like '%r.restored_by = auth.uid()%' and prosrc like '%update public.modules set status = ''published'' where id = target_id%'
                 from pg_proc where oid = to_regprocedure('public.m3_republish_module(uuid)')), false)
union all
select 'Publish Again marker table: RLS on, no client privileges',
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.m3_teacher_restored_modules')), false)
       and not has_table_privilege('authenticated', 'public.m3_teacher_restored_modules', 'SELECT,INSERT,UPDATE,DELETE')
       and not has_table_privilege('anon', 'public.m3_teacher_restored_modules', 'SELECT,INSERT,UPDATE,DELETE')
union all
select 'restore records the marker for a Teacher restore; trash clears it',
       coalesce((select prosrc like '%insert into public.m3_teacher_restored_modules%' from pg_proc where oid = to_regprocedure('public.m3_restore_module(uuid)')), false)
       and coalesce((select prosrc like '%delete from public.m3_teacher_restored_modules where module_id = target_id%' from pg_proc where oid = to_regprocedure('public.m3_trash_module(uuid)')), false)
union all
select 'm3_module_trash RLS policy unchanged (Admin read only)',
       exists (select 1 from pg_policies where tablename = 'm3_module_trash' and policyname = 'M3 Admins read the Trash')
       and (select count(*) from pg_policies where tablename = 'm3_module_trash') = 1;
