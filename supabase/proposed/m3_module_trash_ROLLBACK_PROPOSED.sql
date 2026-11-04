-- PROPOSAL ONLY. NOT APPLIED. Rollback for m3_module_trash_PROPOSED.sql.
-- Removes Trash/Restore/Purge and restores the original m3_protect_deleted_module (fd19df94...).
-- Modules still in the Trash stay soft-deleted and hidden, exactly as the old Delete left them;
-- their Trash metadata (who/when) is dropped with m3_module_trash. Export it first if needed.
begin;
set local lock_timeout = '5s';
drop function public.m3_trashed_modules();
drop function public.m3_purge_module(uuid);
drop function public.m3_restore_module(uuid);
drop function public.m3_trash_module(uuid);
drop function public.m3_require_admin();
drop table public.m3_module_trash;

-- Verbatim installed definition.
CREATE OR REPLACE FUNCTION public.m3_protect_deleted_module()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

begin

  if tg_op='DELETE' then

    if old.deleted_at is not null then raise exception 'Deleted modules must retain their historical records'; end if;

    return old;

  elsif tg_op='INSERT' then

    if new.deleted_at is not null then raise exception 'Modules cannot be created deleted'; end if;

  elsif old.deleted_at is not null then

    raise exception 'Deleted modules are retained for history and cannot be changed';

  elsif new.deleted_at is not null and not exists (

    select 1 from public.m3_deletion_context where module_id=old.id and transaction_id=txid_current()

  ) then

    raise exception 'Use the Admin module deletion operation';

  end if;

  return new;

end; $function$;

notify pgrst, 'reload schema';
commit;
