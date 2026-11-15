-- PROPOSAL ONLY. NOT APPLIED. Student-controlled ("personal") Learning Room archiving.
--
-- A Student may hide a Learning Room they joined from THEIR OWN active Learning Rooms list, and restore it.
-- This is separate from the Teacher/Admin room archive (rooms.archived_at, m4_set_room_archived):
--   * nothing about the shared room changes: the Teacher and other Students are unaffected;
--   * enrollments, assignments, M5/M6 attempts and results, M7 records and M8 XP are not touched;
--   * activities are NOT completed, removed or blocked: the room is only hidden from the Student's list.
-- One row per (room, student) means "this Student archived this room for themselves". The row is tied to
-- the Student's enrollment: if the Teacher removes the Student, the row goes with the enrollment.
-- Students read only their own rows (RLS) and change them only through m4_set_my_room_archived, which
-- checks auth.uid(): a Student can never archive or restore another Student's enrollment.
-- A Student cannot restore their personal archive while the Teacher has archived the room
-- (rooms.archived_at is set): a Teacher-archived room is not an active room.
--
-- Requires (checked by m4_student_room_archive_PREFLIGHT_READONLY.sql): public.enrollments with the
-- unique (room_id, student_id) constraint, public.rooms.archived_at (m4_room_archive, installed on
-- Staging), public.m4_current_role().
-- Rollback: m4_student_room_archive_ROLLBACK_PROPOSED.sql (drops only the objects below; personal
-- archive marks are lost, all rooms simply reappear in the Students' active lists).
begin;
set local lock_timeout = '5s';

create table public.m4_student_room_archives (
  room_id uuid not null,
  student_id uuid not null,
  archived_at timestamptz not null default now(),
  constraint m4_student_room_archives_pkey primary key (student_id, room_id),
  constraint m4_student_room_archives_enrollment_fkey foreign key (room_id, student_id)
    references public.enrollments (room_id, student_id) on delete cascade
);
comment on table public.m4_student_room_archives is
  'Learning Rooms a Student archived for their own view only. Not the room-wide Teacher archive (rooms.archived_at).';
create index m4_student_room_archives_room_idx on public.m4_student_room_archives (room_id);

alter table public.m4_student_room_archives enable row level security;
revoke all on table public.m4_student_room_archives from public, anon, authenticated;
grant select on table public.m4_student_room_archives to authenticated;
create policy m4_student_room_archives_select_own on public.m4_student_room_archives
  for select to authenticated using (student_id = auth.uid());
-- No insert/update/delete policy or grant: writes happen only inside m4_set_my_room_archived.

create function public.m4_set_my_room_archived(p_room_id uuid, p_archive boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid := auth.uid();
  v_room_archived_at timestamptz;
  v_changed boolean := false;
begin
  if v_student is null or p_room_id is null or p_archive is null then
    raise exception using errcode = '42501', message = 'Sign in again to change this Learning Room.';
  end if;
  if public.m4_current_role() is distinct from 'student' then
    raise exception using errcode = '42501', message = 'Only Students can archive a Learning Room for themselves.';
  end if;
  -- Only the signed-in Student's own enrollment, locked so a concurrent removal cannot race the change.
  perform 1 from public.enrollments
    where room_id = p_room_id and student_id = v_student
    for key share;
  if not found then
    raise exception using errcode = '42501', message = 'You can archive only Learning Rooms you have joined.';
  end if;

  if p_archive then
    insert into public.m4_student_room_archives (room_id, student_id)
      values (p_room_id, v_student)
      on conflict (student_id, room_id) do nothing;
    v_changed := found;
  else
    select archived_at into v_room_archived_at from public.rooms where id = p_room_id;
    if v_room_archived_at is not null then
      raise exception using errcode = '55000',
        message = 'Your teacher archived this Learning Room, so it cannot be restored.';
    end if;
    delete from public.m4_student_room_archives
      where room_id = p_room_id and student_id = v_student;
    v_changed := found;
  end if;
  return v_changed;
end $$;
revoke all on function public.m4_set_my_room_archived(uuid, boolean) from public, anon, authenticated;
grant execute on function public.m4_set_my_room_archived(uuid, boolean) to authenticated;
comment on function public.m4_set_my_room_archived(uuid, boolean) is
  'Student-only: archive (true) or restore (false) a joined Learning Room for the caller''s own view. Returns true when something changed.';

commit;
