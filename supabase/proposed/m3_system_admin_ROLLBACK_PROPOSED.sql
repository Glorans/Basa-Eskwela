-- ROLLBACK PROPOSAL ONLY: NOT APPLIED. Undoes m3_system_admin_PROPOSED.sql exactly.
-- Restores the nine module functions and the question RPC to the byte-identical definitions reviewed on Staging
-- (verified by fingerprint before commit), then removes the System Admin policies, triggers and helper functions.
-- Changes no data. Content a System Admin created stays (ordinary module/material rows).
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.m3_module_author_role()') is null then
    raise exception 'System Admin proposal is not installed: nothing to roll back';
  end if;
end $$;

-- 1. Question RPC: remove the single inserted line.
do $$
declare target regprocedure := to_regprocedure('public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)');
        line constant text := chr(10) || '  IF actor_role = ''system_admin'' THEN actor_role := ''teacher''; END IF;';
        body text;
begin
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, line, ''))) <> length(line) then raise exception 'Question RPC patch not found exactly once'; end if;
  execute replace(body, line, '');
end $$;

-- 2. Module functions: put the original role lookup back.
do $$
declare fn text;
begin
  foreach fn in array array['public.m3_can_manage_module(uuid)', 'public.m3_can_read_module(uuid)', 'public.m3_create_collection_draft(uuid,text,uuid,text,jsonb)', 'public.m3_delete_module(uuid)', 'public.m3_require_admin()', 'public.m3_trash_manager(uuid)', 'public.m3_trashed_modules()', 'public.m3_revise_module(uuid)', 'public.m3_module_revisions(uuid)'] loop
    execute replace(pg_get_functiondef(to_regprocedure(fn)), 'public.m3_module_author_role()', 'public.m3_current_role()');
  end loop;
end $$;

-- 3. Every restored definition must equal the reviewed original, or nothing is committed.
do $$
declare pin record;
begin
  for pin in select * from (values
    ('public.m3_can_manage_module(uuid)', '8d4a7e597680188833fa6dc368d9f37e'),
    ('public.m3_can_read_module(uuid)', '5de6a069ccfc8257f192a23fedfb9a7e'),
    ('public.m3_create_collection_draft(uuid,text,uuid,text,jsonb)', 'e650b474bdee4eaba39c2aabb8f45a37'),
    ('public.m3_delete_module(uuid)', '48b7d4092436520f02088c9983eb4110'),
    ('public.m3_require_admin()', '100d609243f2f2e26031015105aad334'),
    ('public.m3_trash_manager(uuid)', '6d64c20f28fe6aa5b7b0c86233670f79'),
    ('public.m3_trashed_modules()', '72c32fe7314dcb66ec40ad009bc6688a'),
    ('public.m3_revise_module(uuid)', '7a70b9a7d9ef118f26d44aafa0587202'),
    ('public.m3_module_revisions(uuid)', '65cb490e6cb64a63b5b3d3c5331141c6'),
    ('public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)', '2160dac893964bd8c73c4fda01b5b990')
  ) as p(fn, hash) loop
    if md5(pg_get_functiondef(to_regprocedure(pin.fn))) <> pin.hash then
      raise exception 'Restored % differs from the reviewed original: rollback aborted', pin.fn;
    end if;
  end loop;
end $$;

-- 4. Remove the System Admin objects.
drop policy if exists "M3 System Admin cleans up own unused files" on storage.objects;
drop policy if exists "M3 System Admin reads own files" on storage.objects;
drop policy if exists "M3 System Admin uploads own files" on storage.objects;
drop trigger if exists m3_system_admin_module_source on public.modules;
drop trigger if exists m3_system_admin_passage_source on public.module_passages;
drop function if exists public.m3_guard_system_admin_source();
drop policy if exists "M3 System Admin updates live modules" on public.modules;
drop function public.m3_module_author_role();
commit;
