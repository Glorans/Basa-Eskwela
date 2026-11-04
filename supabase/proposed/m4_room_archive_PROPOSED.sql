-- PROPOSAL ONLY. NOT APPLIED. See docs/M3_M4_FINAL_REPORT.md and docs/M3_M4_ROLLOUT_RUNBOOK.md.
-- Archive / Restore a learning room. Nothing is deleted or rewritten: enrollments, assignments,
-- M5/M6 attempts and responses, M7 records and M8 XP stay as they are; the room code stays reserved
-- (rooms_room_code_key is unchanged).
-- While archived, the database refuses: new enrollments (joining by code), new module and activity
-- assignments, and new M5 oral-reading / M6 comprehension attempts for that room. Every writer is
-- covered, including the service-role M5/M6 backends, because these are triggers.
-- Who may archive/restore: the room's approved Teacher, or an Admin (adviser direction; remove the
-- is_admin() branch if the panel decides otherwise). The actor is recorded in archived_by.
-- The app detects support from the presence of rooms.archived_at (no extra gate function).
-- Rollback: m4_room_archive_ROLLBACK_PROPOSED.sql (refuses while any room is archived).
begin;
set local lock_timeout = '5s';

alter table public.rooms
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id) on delete restrict,
  add constraint rooms_archive_consistent check ((archived_at is null) = (archived_by is null));

-- Archive fields change only inside m4_set_room_archived (transaction-local marker).
create function public.m4_protect_room_archive() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if new.archived_at is not null or new.archived_by is not null then
      raise exception using errcode = '42501', message = 'New learning rooms cannot be created archived.';
    end if;
  elsif (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and current_setting('m4.archive_room', true) is distinct from new.id::text then
    raise exception using errcode = '42501', message = 'Use Archive or Restore to change a learning room''s archive state.';
  end if;
  return new;
end $$;
revoke all on function public.m4_protect_room_archive() from public, anon, authenticated;
create trigger m4_protect_room_archive before insert or update of archived_at, archived_by on public.rooms
  for each row execute function public.m4_protect_room_archive();

create function public.m4_set_room_archived(p_room_id uuid, p_archive boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare room public.rooms; changed boolean := false;
begin
  if auth.uid() is null or p_archive is null then
    raise exception using errcode = '42501', message = 'Sign in again to change this learning room.';
  end if;
  select * into room from public.rooms where id = p_room_id for update;
  if room.id is null or not (
       public.is_admin()
       or (room.teacher_id = auth.uid() and public.m4_current_role() = 'teacher' and public.m1_teacher_access_allowed())
     ) then
    raise exception using errcode = '42501', message = 'Only the room''s Teacher or an Admin can archive or restore it.';
  end if;
  if p_archive and room.archived_at is null then
    perform set_config('m4.archive_room', p_room_id::text, true);
    update public.rooms set archived_at = now(), archived_by = auth.uid() where id = p_room_id;
    changed := true;
  elsif not p_archive and room.archived_at is not null then
    perform set_config('m4.archive_room', p_room_id::text, true);
    update public.rooms set archived_at = null, archived_by = null where id = p_room_id;
    changed := true;
  end if;
  perform set_config('m4.archive_room', '', true);
  return changed;
end $$;
revoke all on function public.m4_set_room_archived(uuid, boolean) from public, anon;
grant execute on function public.m4_set_room_archived(uuid, boolean) to authenticated, service_role;

-- New activity in an archived room is refused for every writer. Existing rows are never touched.
-- FOR SHARE on the room makes a concurrent Archive and a new join/assignment/start serialize.
create function public.m4_reject_archived_room_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare archived timestamptz;
begin
  if new.room_id is null then return new; end if;
  if TG_OP = 'UPDATE' and new.room_id is not distinct from old.room_id then return new; end if;
  select archived_at into archived from public.rooms where id = new.room_id for share;
  if archived is not null then
    raise exception using errcode = '55000', message = case TG_TABLE_NAME
      when 'enrollments' then 'This learning room is archived and is not accepting new students.'
      when 'room_modules' then 'This learning room is archived. Restore it before assigning modules.'
      when 'reading_activity_assignments' then 'This learning room is archived. Restore it before assigning activities.'
      else 'This learning room is archived, so new reading activities cannot be started.' end;
  end if;
  return new;
end $$;
revoke all on function public.m4_reject_archived_room_activity() from public, anon, authenticated;
create trigger m4_reject_archived_room before insert or update of room_id on public.enrollments
  for each row execute function public.m4_reject_archived_room_activity();
create trigger m4_reject_archived_room before insert or update of room_id on public.room_modules
  for each row execute function public.m4_reject_archived_room_activity();
create trigger m4_reject_archived_room before insert or update of room_id on public.reading_activity_assignments
  for each row execute function public.m4_reject_archived_room_activity();
create trigger m4_reject_archived_room before insert or update of room_id on public.oral_reading_attempts
  for each row execute function public.m4_reject_archived_room_activity();
create trigger m4_reject_archived_room before insert or update of room_id on public.m6_comprehension_attempts
  for each row execute function public.m4_reject_archived_room_activity();

notify pgrst, 'reload schema';
commit;
