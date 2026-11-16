-- PROPOSAL ONLY. NOT APPLIED. M3 Teacher Trash: Teachers move their own reading modules to the Trash and restore them.
--
-- Today (verified on Staging, schema backup 2026-11-17_033602_preM1Apply): a Teacher's Delete calls m3_delete_module,
-- which PERMANENTLY erases an unused module (passages, question banks, answer keys); the Trash functions are Admin-only.
--
-- Changes (generated from the exact live definitions; only these points differ):
--   * new internal helper m3_trash_manager(target): 'admin', or 'teacher' for the APPROVED Teacher who created the
--     module; anyone else gets the unchanged Admin refusal. No client EXECUTE.
--   * m3_trash_module: gate = m3_trash_manager. Teachers additionally cannot trash a module that is still assigned in a
--     Learning Room (room_modules.removed_at is null): remove it from the rooms first. Admin behaviour unchanged.
--   * m3_restore_module: gate = m3_trash_manager. Teachers restore only modules they moved to the Trash themselves.
--     Result unchanged: drafts come back as drafts, ever-published modules come back archived.
--   * m3_trashed_modules: approved Teachers get only their own modules that they trashed; Admin output unchanged.
--   * m3_delete_module: Teachers are refused (no permanent deletion for Teachers). Admin behaviour unchanged.
--   * Publish Again: new table m3_teacher_restored_modules (no client access) + new m3_republish_module(target).
--     A Teacher restoring their own published module records a marker; only that Teacher may then publish it again,
--     explicitly, through the unchanged publish validation (status only; passages, questions and results untouched).
--     An Admin-archived module (no marker) stays with the Admin. m3_trash_module and an Admin restore clear markers.
-- Not changed: m3_purge_module stays Admin-only; the m3_module_trash table, its RLS and grants; every trigger;
-- every assignment, attempt, result and XP row. No row is changed by this migration.
-- Live fingerprints replaced (md5 of the pg_dump text): {'m3_trash_module': '82e76f16ca2a', 'm3_restore_module': 'cfa7f400d930', 'm3_trashed_modules': 'e7e4d9247224', 'm3_delete_module': '8659b665043a'}
-- Preflight / verify: m3_teacher_trash_VERIFY_READONLY.sql. Rollback: m3_teacher_trash_ROLLBACK_PROPOSED.sql.
begin;
set local lock_timeout = '5s';

create function public.m3_trash_manager(target_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.m3_current_role() = 'admin' then return 'admin'; end if;
  -- m3_current_role() is 'teacher' only for an APPROVED Teacher; m3_can_manage_module checks created_by = auth.uid().
  if auth.uid() is not null and public.m3_current_role() = 'teacher' then
    if public.m3_can_manage_module(target_id) then return 'teacher'; end if;
    raise exception using errcode = '42501', message = 'Only the module owner or an Admin can manage this reading module in the Trash';
  end if;
  perform public.m3_require_admin();  -- everyone else: the unchanged Admin refusal
  return 'admin';
end $$;
revoke all on function public.m3_trash_manager(uuid) from public, anon, authenticated;
comment on function public.m3_trash_manager(uuid) is
  'M3 Teacher Trash: admin, or the approved Teacher who created the module. Internal helper (no client EXECUTE).';

-- Marks a published module the owning Teacher restored from their own Trash (it came back archived). Only that
-- Teacher may then publish it again, explicitly (m3_republish_module). No client access: definer functions only.
create table public.m3_teacher_restored_modules (
  module_id uuid primary key references public.modules(id) on delete cascade,
  restored_by uuid not null references public.profiles(id) on delete cascade,
  restored_at timestamptz not null default now()
);
alter table public.m3_teacher_restored_modules enable row level security;
revoke all on table public.m3_teacher_restored_modules from public, anon, authenticated;
comment on table public.m3_teacher_restored_modules is
  'M3 Teacher Trash: published modules a Teacher restored from their own Trash, pending an explicit Publish Again.';

CREATE OR REPLACE FUNCTION "public"."m3_trash_module"("target_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare m public.modules%rowtype; actor text; rooms integer;
begin
  actor := public.m3_trash_manager(target_id);
  select * into m from public.modules where id = target_id for update;
  if not found then raise exception 'Reading module not found; refresh the list'; end if;
  if m.deleted_at is not null then return 'trashed'; end if;
  -- A new Trash cycle cancels any pending Teacher Publish Again.
  delete from public.m3_teacher_restored_modules where module_id = target_id;
  -- Teachers: a module still assigned in a Learning Room stays live, so learners' activities are not disrupted.
  if actor = 'teacher' then
    select count(distinct rm.room_id) into rooms from public.room_modules rm where rm.module_id = target_id and rm.removed_at is null;
    if rooms > 0 then
      raise exception using errcode = '23503', message = format(
        'This module is assigned in %s Learning Room(s). Remove it from those rooms before moving it to the Trash.', rooms);
    end if;
  end if;
  insert into public.m3_deletion_context values (target_id, txid_current());
  update public.modules set deleted_at = clock_timestamp() where id = target_id;
  delete from public.m3_deletion_context where module_id = target_id;
  insert into public.m3_module_trash(module_id, trashed_by, status_before)
    values (target_id, auth.uid(), m.status)
    on conflict (module_id) do update set trashed_by = excluded.trashed_by, trashed_at = now(), status_before = excluded.status_before;
  return 'trashed';
end $$;

CREATE OR REPLACE FUNCTION "public"."m3_restore_module"("target_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare m public.modules%rowtype; restored text; actor text;
begin
  actor := public.m3_trash_manager(target_id);
  select * into m from public.modules where id = target_id for update;
  if not found then raise exception 'Reading module not found; refresh the list'; end if;
  if m.deleted_at is null then raise exception using errcode = '22023', message = 'This reading module is not in the Trash'; end if;
  -- Teachers restore only what they themselves moved to the Trash (never an Admin's removal of their module).
  if actor = 'teacher' and not exists (
    select 1 from public.m3_module_trash t where t.module_id = target_id and t.trashed_by = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'You can restore only reading modules you moved to the Trash';
  end if;
  -- Ever-published content comes back hidden; it needs a normal validated Publish.
  restored := case when m.published_at is not null or m.status <> 'draft' then 'archived' else 'draft' end;
  perform set_config('m3.restore_module', target_id::text, true);
  update public.modules set deleted_at = null, status = restored where id = target_id;
  perform set_config('m3.restore_module', '', true);
  delete from public.m3_module_trash where module_id = target_id;
  -- The Teacher who restored their own published module may publish it again (m3_republish_module, explicit);
  -- an Admin restore never grants that.
  if actor = 'teacher' and restored = 'archived' then
    insert into public.m3_teacher_restored_modules(module_id, restored_by) values (target_id, auth.uid())
      on conflict (module_id) do update set restored_by = excluded.restored_by, restored_at = now();
  else
    delete from public.m3_teacher_restored_modules where module_id = target_id;
  end if;
  return restored;
end $$;

CREATE OR REPLACE FUNCTION "public"."m3_trashed_modules"() RETURNS TABLE("id" "uuid", "title" "text", "status_before" "text", "trashed_at" timestamp with time zone, "trashed_by_name" "text", "ever_published" boolean, "has_history" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- Approved Teachers see only the modules they created AND moved to the Trash; everyone else needs Admin.
  if public.m3_current_role() is distinct from 'teacher' then perform public.m3_require_admin(); end if;
  return query
    select m.id, m.title, coalesce(t.status_before, m.status), coalesce(t.trashed_at, m.deleted_at),
      coalesce(nullif(p.full_name, ''), nullif(p.nickname, ''), 'Admin'),
      m.published_at is not null, public.m3_deletion_has_history(m.id)
    from public.modules m
    left join public.m3_module_trash t on t.module_id = m.id
    left join public.profiles p on p.id = t.trashed_by
    where m.deleted_at is not null
      and (public.m3_current_role() = 'admin' or (t.trashed_by = auth.uid() and m.created_by = auth.uid()))
    order by coalesce(t.trashed_at, m.deleted_at) desc;
end $$;

CREATE OR REPLACE FUNCTION "public"."m3_delete_module"("target_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare m public.modules%rowtype; preserve boolean;

begin

  if auth.uid() is null or not public.m3_can_manage_module(target_id) then

    raise exception using errcode='42501', message='Only the module owner or an Admin can delete this reading module';

  end if;

  -- Teachers never hard-delete: their Delete moves the module to the Trash (m3_trash_module).

  if public.m3_current_role() = 'teacher' then

    raise exception using errcode='42501', message='Teachers move reading modules to the Trash; permanent deletion is not available to Teachers';

  end if;

  select * into m from public.modules where id=target_id for update;

  if not found then raise exception 'Reading module not found; refresh the list'; end if;

  if m.deleted_at is not null then return 'soft'; end if;

  -- Lock all owned records before checking incoming references. Concurrent FK

  -- inserts cannot acquire key-share locks until this operation commits.

  perform id from public.module_passages where module_id=target_id order by id for update;

  perform id from public.comprehension_questions where module_id=target_id order by id for update;

  perform a.question_id from public.comprehension_question_answers a join public.comprehension_questions q on q.id=a.question_id

    where q.module_id=target_id order by a.question_id for update of a;

  preserve:=public.m3_deletion_has_history(target_id);

  insert into public.m3_deletion_context values(target_id,txid_current());

  if not preserve then

    begin

      -- Shared uploaded_materials, their Storage files and material-scoped sets

      -- are independent uploader-owned sources, never owned by this module.

      delete from public.comprehension_question_answers where question_id in

        (select id from public.comprehension_questions where module_id=target_id);

      delete from public.comprehension_questions where module_id=target_id;

      delete from public.module_passages where module_id=target_id;

      delete from public.m3_pending_collection_delivery where module_id=target_id;

      delete from public.modules where id=target_id;

    exception when foreign_key_violation then

      -- Whole subtransaction rolls back, including all owned child deletions.

      preserve:=true;

    end;

  end if;

  if preserve then

    update public.modules set deleted_at=clock_timestamp() where id=target_id;

  end if;

  delete from public.m3_deletion_context where module_id=target_id;

  return case when preserve then 'soft' else 'permanent' end;

end; $$;

create function public.m3_republish_module(target_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.modules%rowtype;
begin
  -- Approved owning Teacher only (Admins keep their existing publish path). m3_current_role() is 'teacher' only
  -- for an APPROVED Teacher; m3_can_manage_module checks created_by = auth.uid().
  if auth.uid() is null or public.m3_current_role() is distinct from 'teacher' or not public.m3_can_manage_module(target_id) then
    raise exception using errcode = '42501', message = 'Only the Teacher who created this reading module can publish it again';
  end if;
  select * into m from public.modules where id = target_id for update;
  if not found then raise exception 'Reading module not found; refresh the list'; end if;
  if m.deleted_at is not null then
    raise exception using errcode = '22023', message = 'Restore this reading module from the Trash before publishing it again';
  end if;
  if m.status <> 'archived' then
    raise exception using errcode = '22023', message = 'Only an archived reading module can be published again';
  end if;
  -- Only a module this Teacher restored from their own Trash; never one the School Admin archived.
  if not exists (select 1 from public.m3_teacher_restored_modules r where r.module_id = target_id and r.restored_by = auth.uid()) then
    raise exception using errcode = '42501', message = 'This module was archived by the School Admin; ask your School Admin to publish it again';
  end if;
  -- Status only. modules_collection_publish_validation re-checks every passage and question bank; the original
  -- published_at is kept by modules_m3_metadata. Passages, questions and learner records are not touched.
  update public.modules set status = 'published' where id = target_id;
  delete from public.m3_teacher_restored_modules where module_id = target_id;
  return 'published';
end $$;
revoke all on function public.m3_republish_module(uuid) from public, anon;
grant execute on function public.m3_republish_module(uuid) to authenticated;
comment on function public.m3_republish_module(uuid) is
  'M3 Teacher Trash: the approved owning Teacher publishes again a module they restored from their own Trash (validated).';

commit;
