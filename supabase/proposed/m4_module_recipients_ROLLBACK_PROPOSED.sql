-- PROPOSAL ONLY. NOT APPLIED. Rollback for m4_module_recipients_PROPOSED.sql.
-- Step 1 always: disable new selected assignments (hides the UI option at once).
-- Step 2 only when NO selected assignment exists: dropping restrictions while selected rows exist
-- would silently give every enrolled student access, so the script refuses (and rolls back step 1
-- too; then run only the UPDATE below on its own).
--   update public.m4_targeting_rollout set enabled = false where singleton;
begin;
set local lock_timeout = '5s';
update public.m4_targeting_rollout set enabled = false where singleton;
do $guard$
begin
  if exists (select 1 from public.room_modules where targeting_mode <> 'whole_class') then
    raise exception 'Selected-student assignments exist; keep the foundation disabled and use a forward fix';
  end if;
end $guard$;
drop trigger m4_enforce_module_recipient on public.oral_reading_attempts;
drop trigger m4_enforce_module_recipient on public.m6_comprehension_attempts;
drop function public.m4_enforce_module_recipient();
drop function public.m4_module_targeting_enabled();
drop function public.m4_assign_module(uuid, uuid, text, uuid[], timestamptz);
drop trigger m4_protect_module_targeting on public.room_modules;
drop function public.m4_protect_module_targeting();
drop policy "M4 selected module recipient restriction" on public.room_modules;
drop policy "M4 recipients visible to authorized users" on public.room_module_recipients;
drop function public.m4_module_assigned_to(uuid, uuid);
drop table public.room_module_recipients;
drop table public.m4_targeting_rollout;
alter table public.room_modules drop column targeting_mode;
notify pgrst, 'reload schema';
commit;
