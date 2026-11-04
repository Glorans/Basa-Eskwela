-- PROPOSED ONLY: requires approval before staging application.
-- Prerequisites: installed M3 Trash and Revisions migrations.
-- Purge omitted the private deletion context used by m3_collection_bank_changed.
-- Deleting keys/questions consequently tried to UPDATE the trashed parent and was refused.
-- Reuse the existing transaction-scoped marker ONLY after Admin/Trash/history checks pass.
-- No trigger, history rule, grant, owner, search path or other RPC is changed.
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if md5(replace(pg_get_functiondef('public.m3_purge_module(uuid)'::regprocedure),chr(13),''))
       is distinct from 'db50b67c8f87949397a5736a75543216'
     or md5(replace(pg_get_functiondef('public.m3_collection_bank_changed()'::regprocedure),chr(13),''))
       is distinct from '0db2405b549dbdb98f9cb570a81bb37e'
     or md5(replace(pg_get_functiondef('public.m3_protect_deleted_module()'::regprocedure),chr(13),''))
       is distinct from '38a892fd8e7e7d2e79d17c97639fea0e'
     or md5(replace(pg_get_functiondef('public.m3_deletion_has_history(uuid)'::regprocedure),chr(13),''))
       is distinct from 'cdebb5895901d744757a40577fa288d5' then
    raise exception 'M3 purge dependencies differ from the reviewed definitions; stop and re-review';
  end if;
end $guard$;

create or replace function public.m3_purge_module(target_id uuid) returns text
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
  insert into public.m3_deletion_context values (target_id, txid_current());
  perform set_config('m3.purge_module', target_id::text, true);
  delete from public.m3_module_trash where module_id = target_id;
  delete from public.comprehension_question_answers where question_id in
    (select id from public.comprehension_questions where module_id = target_id);
  delete from public.comprehension_questions where module_id = target_id;
  delete from public.module_passages where module_id = target_id;
  delete from public.m3_pending_collection_delivery where module_id = target_id;
  delete from public.modules where id = target_id;
  perform set_config('m3.purge_module', '', true);
  delete from public.m3_deletion_context where module_id = target_id;
  return 'deleted';
end $$;

notify pgrst, 'reload schema';
commit;
