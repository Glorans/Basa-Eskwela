-- PROPOSAL ONLY. Rollback of m3_teacher_trash_PROPOSED.sql: restores the four functions exactly as they are on
-- Staging today (verbatim from the 2026-11-17 schema backup) and drops the helper and the Publish Again table and
-- function. No module, passage, question or learner-result row is touched (pending Publish Again markers go away).
-- Modules a Teacher moved to the Trash stay in the Trash (the Admin can restore or purge them).
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION "public"."m3_trash_module"("target_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION "public"."m3_restore_module"("target_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION "public"."m3_trashed_modules"() RETURNS TABLE("id" "uuid", "title" "text", "status_before" "text", "trashed_at" timestamp with time zone, "trashed_by_name" "text", "ever_published" boolean, "has_history" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

CREATE OR REPLACE FUNCTION "public"."m3_delete_module"("target_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare m public.modules%rowtype; preserve boolean;

begin

  if auth.uid() is null or not public.m3_can_manage_module(target_id) then

    raise exception using errcode='42501', message='Only the module owner or an Admin can delete this reading module';

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

drop function public.m3_republish_module(uuid);
drop table public.m3_teacher_restored_modules;
drop function public.m3_trash_manager(uuid);

commit;
