-- PROPOSAL ONLY. NOT APPLIED. See docs/M3_M4_FINAL_REPORT.md and docs/M3_M4_ROLLOUT_RUNBOOK.md.
-- Recoverable "Delete Reading Module": Delete moves a module to Trash; Admins can review, restore, or
-- (separately) permanently delete it when it has no learner history.
--
-- "In Trash" = modules.deleted_at IS NOT NULL. Every existing availability check already honours it:
-- learner reads (restrictive RLS), catalogs, new assignments (m3_reject_deleted_assignment), M5 starts,
-- and M6 completion (m6_assert_completion_access). Passages, questions, answer keys, attempts, results
-- and XP are never touched by Trash or Restore.
-- Restore never re-exposes content by itself: a module that was ever published comes back as
-- 'archived' (it needs a normal, validated Publish); a never-published draft comes back as 'draft'.
-- Permanent deletion is a separate Admin action, only from Trash, only without history, and reuses
-- the same ownership rules as the existing m3_delete_module (which is left unchanged).
-- Gate: the app switches Delete to "Move to Trash" only when m3_trashed_modules() exists.
-- Rollback: m3_module_trash_ROLLBACK_PROPOSED.sql (trashed modules stay hidden, as soft deletes do today).
begin;
set local lock_timeout = '5s';

do $guard$
begin
  -- Carriage returns are ignored: some live functions were installed with CRLF. Everything else must match exactly.
  if md5(replace(pg_get_functiondef('public.m3_protect_deleted_module()'::regprocedure), chr(13), '')) is distinct from 'fd19df944007fed809ef5abc4e35f533'
     or md5(replace(pg_get_functiondef('public.m3_delete_module(uuid)'::regprocedure), chr(13), '')) is distinct from '08d598518d825b6a62f3ad5de15aab64' then
    raise exception 'M3 deletion functions are not the reviewed definitions; stop and re-review';
  end if;
end $guard$;

-- Deliberately no foreign key to modules: m3_deletion_has_history treats every unknown incoming
-- reference as learner history, so an FK here would block permanent deletion of every trashed module.
-- m3_purge_module and m3_restore_module remove the row themselves.
create table public.m3_module_trash (
  module_id uuid primary key,
  trashed_by uuid not null references public.profiles(id),
  trashed_at timestamptz not null default now(),
  status_before text not null
);
alter table public.m3_module_trash enable row level security;
revoke all on table public.m3_module_trash from public, anon, authenticated;
grant select on table public.m3_module_trash to authenticated;
grant all on table public.m3_module_trash to service_role;
create policy "M3 Admins read the Trash" on public.m3_module_trash for select to authenticated
  using (public.m3_current_role() = 'admin');

-- Same rules as before plus two narrow exemptions, each only inside its Admin RPC:
-- Restore (deleted_at -> NULL, status draft/archived, nothing else) and Purge (DELETE).
create or replace function public.m3_protect_deleted_module() returns trigger
language plpgsql security definer set search_path to '' as $function$
begin
  if tg_op='DELETE' then
    if old.deleted_at is not null
       and current_setting('m3.purge_module', true) is distinct from old.id::text then
      raise exception 'Deleted modules must retain their historical records';
    end if;
    return old;
  elsif tg_op='INSERT' then
    if new.deleted_at is not null then raise exception 'Modules cannot be created deleted'; end if;
  elsif old.deleted_at is not null then
    if current_setting('m3.restore_module', true) = old.id::text and new.deleted_at is null
       and new.status in ('draft', 'archived')
       and new.path_id = old.path_id and new.title = old.title and new.difficulty = old.difficulty
       and new.passage is not distinct from old.passage and new.published_at is not distinct from old.published_at
       and new.created_by = old.created_by and new.source_material_id is not distinct from old.source_material_id then
      return new;
    end if;
    raise exception 'Deleted modules are retained for history and cannot be changed';
  elsif new.deleted_at is not null and not exists (
    select 1 from public.m3_deletion_context where module_id=old.id and transaction_id=txid_current()
  ) then
    raise exception 'Use the Admin module deletion operation';
  end if;
  return new;
end; $function$;

create function public.m3_require_admin() returns void language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null or public.m3_current_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Admin access is required to manage reading modules';
  end if;
end $$;
revoke all on function public.m3_require_admin() from public, anon, authenticated;

create function public.m3_trash_module(target_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.modules%rowtype;
begin
  perform public.m3_require_admin();
  select * into m from public.modules where id = target_id for update;
  if not found then raise exception 'Reading module not found; refresh the list'; end if;
  if m.deleted_at is not null then return 'trashed'; end if;
  insert into public.m3_deletion_context values (target_id, txid_current());
  update public.modules set deleted_at = clock_timestamp() where id = target_id;
  delete from public.m3_deletion_context where module_id = target_id;
  insert into public.m3_module_trash(module_id, trashed_by, status_before)
    values (target_id, auth.uid(), m.status)
    on conflict (module_id) do update set trashed_by = excluded.trashed_by, trashed_at = now(), status_before = excluded.status_before;
  return 'trashed';
end $$;

create function public.m3_restore_module(target_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.modules%rowtype; restored text;
begin
  perform public.m3_require_admin();
  select * into m from public.modules where id = target_id for update;
  if not found then raise exception 'Reading module not found; refresh the list'; end if;
  if m.deleted_at is null then raise exception using errcode = '22023', message = 'This reading module is not in the Trash'; end if;
  -- Ever-published content comes back hidden; it needs a normal validated Publish.
  restored := case when m.published_at is not null or m.status <> 'draft' then 'archived' else 'draft' end;
  perform set_config('m3.restore_module', target_id::text, true);
  update public.modules set deleted_at = null, status = restored where id = target_id;
  perform set_config('m3.restore_module', '', true);
  delete from public.m3_module_trash where module_id = target_id;
  return restored;
end $$;

create function public.m3_purge_module(target_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.modules%rowtype;
begin
  perform public.m3_require_admin();
  select * into m from public.modules where id = target_id for update;
  if not found then raise exception 'Reading module not found; refresh the list'; end if;
  if m.deleted_at is null then
    raise exception using errcode = '22023', message = 'Move the reading module to the Trash before deleting it permanently';
  end if;
  perform id from public.module_passages where module_id = target_id order by id for update;
  perform id from public.comprehension_questions where module_id = target_id order by id for update;
  if public.m3_deletion_has_history(target_id) then
    raise exception using errcode = '23503',
      message = 'This reading module has learner or classroom history, so it stays in the Trash and cannot be deleted permanently';
  end if;
  perform set_config('m3.purge_module', target_id::text, true);
  delete from public.m3_module_trash where module_id = target_id;
  delete from public.comprehension_question_answers where question_id in
    (select id from public.comprehension_questions where module_id = target_id);
  delete from public.comprehension_questions where module_id = target_id;
  delete from public.module_passages where module_id = target_id;
  delete from public.m3_pending_collection_delivery where module_id = target_id;
  delete from public.modules where id = target_id;
  perform set_config('m3.purge_module', '', true);
  return 'deleted';
end $$;

-- Admin Trash list (also the capability gate). Includes modules soft-deleted before this migration.
create function public.m3_trashed_modules() returns table (
  id uuid, title text, status_before text, trashed_at timestamptz, trashed_by_name text,
  ever_published boolean, has_history boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.m3_require_admin();
  return query
    select m.id, m.title, coalesce(t.status_before, m.status), coalesce(t.trashed_at, m.deleted_at),
      coalesce(nullif(p.full_name, ''), nullif(p.nickname, ''), 'Admin'),
      m.published_at is not null, public.m3_deletion_has_history(m.id)
    from public.modules m
    left join public.m3_module_trash t on t.module_id = m.id
    left join public.profiles p on p.id = t.trashed_by
    where m.deleted_at is not null
    order by coalesce(t.trashed_at, m.deleted_at) desc;
end $$;

revoke all on function public.m3_trash_module(uuid) from public, anon;
revoke all on function public.m3_restore_module(uuid) from public, anon;
revoke all on function public.m3_purge_module(uuid) from public, anon;
revoke all on function public.m3_trashed_modules() from public, anon;
grant execute on function public.m3_trash_module(uuid), public.m3_restore_module(uuid),
  public.m3_purge_module(uuid), public.m3_trashed_modules() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
