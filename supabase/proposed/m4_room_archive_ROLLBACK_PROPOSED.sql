-- PROPOSAL ONLY. NOT APPLIED. Rollback for m4_room_archive_PROPOSED.sql.
-- Refuses while any room is archived: dropping the columns would silently reopen those rooms to
-- joins and new activity. Restore (or keep) archived rooms first.
begin;
set local lock_timeout = '5s';
do $guard$
begin
  if exists (select 1 from public.rooms where archived_at is not null) then
    raise exception 'Archived learning rooms exist; restore them first or keep the migration';
  end if;
end $guard$;
drop trigger m4_reject_archived_room on public.enrollments;
drop trigger m4_reject_archived_room on public.room_modules;
drop trigger m4_reject_archived_room on public.reading_activity_assignments;
drop trigger m4_reject_archived_room on public.oral_reading_attempts;
drop trigger m4_reject_archived_room on public.m6_comprehension_attempts;
drop function public.m4_reject_archived_room_activity();
drop function public.m4_set_room_archived(uuid, boolean);
drop trigger m4_protect_room_archive on public.rooms;
drop function public.m4_protect_room_archive();
alter table public.rooms drop constraint rooms_archive_consistent, drop column archived_by, drop column archived_at;
notify pgrst, 'reload schema';
commit;
