-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval. Apply after m4_room_archive (installed on
-- Staging) and M8 F1-F4.
-- M4 Archived classrooms are read-only, except the authorized Restore.
-- ============================================================================
--
-- Already installed (m4_room_archive): an archived room refuses new enrollments, new module and activity
-- assignments, and NEW M5 oral-reading and M6 comprehension attempt rows.
-- Gaps this closes, found in the audit:
--   * An M6 assessment started before Archive (a tab left open) could still be answered and completed,
--     which also earned XP and a reading day through the M8 completion trigger.
--   * A reading saved before Archive could still get a recording, a pronunciation check or a verified
--     reading (M8 XP) afterwards; saved readings could be edited by any writer.
--   * A Teacher could still rename the room, remove or restore assignments, change activity status and
--     remove students while the room was archived.
-- How:
--   * Triggers only; no existing function, table or row is changed. They cover every writer, including the
--     service-role M5/M6 backends and SECURITY DEFINER functions, because a trigger cannot be skipped.
--   * Each trigger re-reads the room's archive state with FOR SHARE, so it waits for an Archive in progress
--     and sees the committed result: an already-open browser tab cannot slip a submission through.
--   * Scoped to the archived room's own rows (room_id). The same module or material in another, active room,
--     Independent Learner and Admin practice (room_id null) are untouched.
--   * Pending (in-progress) attempts are kept as they are; they simply cannot change while archived and
--     continue normally after Restore. Nothing is deleted, scored or reset.
--   * Restore (m4_set_room_archived) only changes the archive fields and stays allowed. Deletes caused by a
--     cascade (an account or room being deleted) stay allowed; direct deletes are refused.
--   * Saved results, XP, badges, claims, streaks and achievements are unchanged and stay readable.
-- Rollback: m4_archived_room_readonly_v1_ROLLBACK_PROPOSED.sql. Test: server/tests/m4ArchivedRoomReadOnlyProposal.test.js
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.m4_set_room_archived(uuid,boolean)') is null
    or to_regprocedure('public.m4_reject_archived_room_activity()') is null then
    raise exception 'Stop: apply m4_room_archive first.';
  end if;
  if to_regprocedure('public.m4_room_archived_locked(uuid)') is not null then
    raise exception 'Stop: archived-room read-only rules are already installed.';
  end if;
end $$;

-- True when the room is archived. FOR SHARE: waits for a concurrent Archive/Restore to commit.
create function public.m4_room_archived_locked(p_room_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_archived timestamptz;
begin
  if p_room_id is null then return false; end if;
  select r.archived_at into v_archived from public.rooms r where r.id = p_room_id for share;
  return v_archived is not null;
end $$;
revoke all on function public.m4_room_archived_locked(uuid) from public, anon, authenticated, service_role;

-- Learner results of an archived room cannot change. The room comes from the row or from its attempt.
create function public.m4_guard_archived_learner_results()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_room uuid;
begin
  if tg_table_name in ('m6_comprehension_attempts', 'oral_reading_attempts') then
    v_room := old.room_id;
  elsif tg_table_name = 'm6_comprehension_responses' then
    select a.room_id into v_room from public.m6_comprehension_attempts a where a.id = new.attempt_id;
  else
    select a.room_id into v_room from public.oral_reading_attempts a where a.id = new.attempt_id;
  end if;
  if public.m4_room_archived_locked(v_room) then
    raise exception using errcode = '55000',
      message = 'This classroom is archived. Saved results are kept, but new readings and answers cannot be submitted.';
  end if;
  return new;
end $$;
revoke all on function public.m4_guard_archived_learner_results() from public, anon, authenticated, service_role;

create trigger m4_archived_room_readonly before update on public.m6_comprehension_attempts
  for each row execute function public.m4_guard_archived_learner_results();
create trigger m4_archived_room_readonly before insert or update on public.m6_comprehension_responses
  for each row execute function public.m4_guard_archived_learner_results();
create trigger m4_archived_room_readonly before update on public.oral_reading_attempts
  for each row execute function public.m4_guard_archived_learner_results();
create trigger m4_archived_room_readonly before insert on public.oral_reading_recordings
  for each row execute function public.m4_guard_archived_learner_results();
create trigger m4_archived_room_readonly before insert on public.oral_reading_pronunciation_checks
  for each row execute function public.m4_guard_archived_learner_results();
create trigger m4_archived_room_readonly before insert on public.m5_verified_readings
  for each row execute function public.m4_guard_archived_learner_results();

-- Classroom management of an archived room is read-only, except Archive/Restore itself.
create function public.m4_guard_archived_room_management()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_room uuid;
begin
  -- A cascade (an account or a room being deleted) is not a classroom change.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_table_name = 'rooms' then
    v_room := old.id;
    if tg_op = 'UPDATE' then
      -- Archive or Restore (m4_set_room_archived) changes only the archive fields.
      if (new.room_name, new.section, new.description, new.room_code, new.subject, new.teacher_id)
        is not distinct from (old.room_name, old.section, old.description, old.room_code, old.subject, old.teacher_id) then
        return new;
      end if;
    end if;
  else
    v_room := old.room_id;
  end if;
  if public.m4_room_archived_locked(v_room) then
    raise exception using errcode = '55000', message = 'This learning room is archived. Restore it before making changes.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.m4_guard_archived_room_management() from public, anon, authenticated, service_role;

create trigger m4_archived_room_readonly before update or delete on public.rooms
  for each row execute function public.m4_guard_archived_room_management();
create trigger m4_archived_room_readonly before update or delete on public.room_modules
  for each row execute function public.m4_guard_archived_room_management();
create trigger m4_archived_room_readonly before update or delete on public.reading_activity_assignments
  for each row execute function public.m4_guard_archived_room_management();
create trigger m4_archived_room_readonly before delete on public.enrollments
  for each row execute function public.m4_guard_archived_room_management();

do $$ begin
  if (select count(*) from pg_trigger where tgname = 'm4_archived_room_readonly' and not tgisinternal) <> 10 then
    raise exception 'Postcondition: expected 10 read-only triggers';
  end if;
  if has_function_privilege('authenticated', 'public.m4_room_archived_locked(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m4_room_archived_locked(uuid)', 'EXECUTE') then
    raise exception 'Postcondition: helper is client-callable';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
