-- PROPOSAL ONLY. NOT APPLIED. Rollback for m3_module_revisions_PROPOSED.sql.
-- Refuses while any revision exists: dropping the columns would erase which module revises which.
-- (Revisions are ordinary modules; delete unwanted unpublished drafts through the Trash first.)
begin;
set local lock_timeout = '5s';
do $guard$
begin
  if exists (select 1 from public.modules where revision_of is not null) then
    raise exception 'Module revisions exist; keep the migration (or remove unused draft revisions first)';
  end if;
end $guard$;
drop function public.m3_module_revisions(uuid);
drop function public.m3_revise_module(uuid);
drop trigger m3_protect_revision_link on public.modules;
drop function public.m3_protect_revision_link();
drop index public.modules_one_open_revision;
drop index public.modules_revision_number;
alter table public.modules drop constraint modules_revision_consistent,
  drop column revision_number, drop column revision_root, drop column revision_of;
notify pgrst, 'reload schema';
commit;
