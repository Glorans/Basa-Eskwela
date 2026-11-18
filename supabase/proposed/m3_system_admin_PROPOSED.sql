-- PROPOSAL ONLY: NOT APPLIED. M3 System Admin content access (Appendix N M3 F1-F10).
-- Revised 2026-11-18 after a read-only preflight of ReadFlow-Staging (oudfrdeqwotynihkkmze); see
-- docs/M3_SYSTEM_ADMIN_REPORT.md. Every function it rewrites is pinned to the exact definition that was reviewed:
-- if Staging changed since then, nothing is applied.
-- Scope: System Admin is treated as the School Admin ONLY inside the nine M3 module functions listed below, and as an
-- owning uploader in the material-question RPC. m3_current_role(), is_admin() and every other function, policy and
-- grant used by School Admin, Teacher, Student or Independent Learner are unchanged.
begin;
set local lock_timeout = '5s';

-- 1. Fail closed unless Staging still matches the reviewed definitions and nothing is installed yet.
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
    if to_regprocedure(pin.fn) is null then raise exception 'Missing function %: re-run the preflight', pin.fn; end if;
    if md5(pg_get_functiondef(to_regprocedure(pin.fn))) <> pin.hash then
      raise exception 'Function % changed since the reviewed preflight: re-run it before applying', pin.fn;
    end if;
  end loop;
  if to_regprocedure('public.m3_module_author_role()') is not null
     or to_regprocedure('public.m3_guard_system_admin_source()') is not null
     or exists (select 1 from pg_trigger where tgname in ('m3_system_admin_passage_source', 'm3_system_admin_module_source'))
     or exists (select 1 from pg_policies where policyname like 'M3 System Admin%') then
    raise exception 'System Admin proposal already (partly) installed: do not reapply';
  end if;
  if has_function_privilege('authenticated', 'public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)', 'EXECUTE') then
    raise exception 'Material question RPC must remain service-role-only';
  end if;
end $$;

-- 2. Role used only by the nine module functions below: System Admin acts as the School Admin there.
--    Not executable by anon/authenticated: every caller is SECURITY DEFINER, so it runs as the owner.
create function public.m3_module_author_role() returns text
language sql stable security definer set search_path = '' as $$
  select case public.m3_current_role() when 'system_admin' then 'admin' else public.m3_current_role() end;
$$;
revoke all on function public.m3_module_author_role() from public, anon, authenticated;

-- 3. Swap only the role lookup inside the pinned module functions. CREATE OR REPLACE keeps each function's owner,
--    grants, SECURITY DEFINER flag and search_path = ''; every other line (validation, revision locks, publication,
--    Trash/history, Teacher ownership) is byte-identical. For every role except system_admin the result is unchanged.
do $$
declare fn text; body text;
begin
  foreach fn in array array['public.m3_can_manage_module(uuid)', 'public.m3_can_read_module(uuid)', 'public.m3_create_collection_draft(uuid,text,uuid,text,jsonb)', 'public.m3_delete_module(uuid)', 'public.m3_require_admin()', 'public.m3_trash_manager(uuid)', 'public.m3_trashed_modules()', 'public.m3_revise_module(uuid)', 'public.m3_module_revisions(uuid)'] loop
    body := pg_get_functiondef(to_regprocedure(fn));
    if position('public.m3_current_role()' in body) = 0 then raise exception 'No role lookup in %', fn; end if;
    execute replace(body, 'public.m3_current_role()', 'public.m3_module_author_role()');
    body := pg_get_functiondef(to_regprocedure(fn));
    if position('public.m3_current_role()' in body) > 0 or position('public.m3_module_author_role()' in body) = 0 then
      raise exception 'Rewrite of % incomplete', fn;
    end if;
  end loop;
end $$;

-- 4. Direct status/metadata updates from the existing editor. Same as the School Admin policy, but live modules only;
--    column grants still limit the columns, and the existing publication/history triggers still run.
--    No INSERT/DELETE policy: creation and deletion use the validated RPCs.
create policy "M3 System Admin updates live modules" on public.modules for update to authenticated
  using (public.m3_current_role() = 'system_admin' and deleted_at is null)
  with check (public.m3_current_role() = 'system_admin' and deleted_at is null);

-- 5. System Admin can attach only materials it uploaded (forged source IDs are refused). Acts for System Admin only.
create function public.m3_guard_system_admin_source() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.m3_current_role() = 'system_admin' and new.source_material_id is not null
     and (tg_op = 'INSERT' or new.source_material_id is distinct from old.source_material_id)
     and not exists (select 1 from public.uploaded_materials m
                     where m.id = new.source_material_id and m.uploaded_by = auth.uid()) then
    raise exception using errcode = '42501', message = 'Use only reading materials you uploaded';
  end if;
  return new;
end $$;
revoke all on function public.m3_guard_system_admin_source() from public, anon, authenticated;
create trigger m3_system_admin_passage_source before insert or update on public.module_passages
  for each row execute function public.m3_guard_system_admin_source();
create trigger m3_system_admin_module_source before insert or update on public.modules
  for each row execute function public.m3_guard_system_admin_source();

-- 6. Original files: System Admin's own folder only (same path rule as the existing uploader policy).
create policy "M3 System Admin uploads own files" on storage.objects for insert to authenticated
  with check (public.m3_current_role() = 'system_admin' and bucket_id = 'reading-materials'
    and name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|docx|jpg|jpeg|png)$'));
create policy "M3 System Admin reads own files" on storage.objects for select to authenticated
  using (public.m3_current_role() = 'system_admin' and bucket_id = 'reading-materials'
    and (storage.foldername(name))[1] = auth.uid()::text);
create policy "M3 System Admin cleans up own unused files" on storage.objects for delete to authenticated
  using (public.m3_current_role() = 'system_admin' and bucket_id = 'reading-materials'
    and (storage.foldername(name))[1] = auth.uid()::text and public.m3_storage_object_is_deletable(name));

-- 7. Service-role-only question RPC: System Admin takes the owning-uploader (Teacher) branch, never the Admin branch,
--    so every later check requires owner_id = actor_id. The installed role lookup spans several CRLF lines.
do $patch$
declare target regprocedure := to_regprocedure('public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)');
        body text; matches integer;
        line constant text := chr(10) || '  IF actor_role = ''system_admin'' THEN actor_role := ''teacher''; END IF;';
        pattern constant text := '(SELECT role\s+INTO actor_role\s+FROM public\.profiles\s+WHERE id = actor_id;)';
begin
  body := pg_get_functiondef(target);
  select count(*) into matches from regexp_matches(body, pattern, 'g');
  if matches <> 1 then raise exception 'Unexpected question RPC definition (% role lookups)', matches; end if;
  execute regexp_replace(body, pattern, '\1' || line);
  body := pg_get_functiondef(target);
  if (length(body) - length(replace(body, line, ''))) <> length(line)
     or has_function_privilege('authenticated', target, 'EXECUTE') or has_function_privilege('anon', target, 'EXECUTE') then
    raise exception 'Question RPC patch did not apply exactly once, or its grants changed';
  end if;
end $patch$;
commit;
