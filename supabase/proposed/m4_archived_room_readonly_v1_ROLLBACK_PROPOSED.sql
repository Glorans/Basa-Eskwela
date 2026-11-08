-- ============================================================================
-- PROPOSED ROLLBACK - NOT APPLIED. Do not run without explicit approval.
-- Removes m4_archived_room_readonly_v1_PROPOSED.sql: archived rooms return to the m4_room_archive rules
-- (no new joins, assignments or attempt rows; existing attempts and room settings can change again).
-- It stores no data, so nothing is lost. m4_room_archive itself is not touched.
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.m4_room_archived_locked(uuid)') is null then
    raise exception 'Stop: archived-room read-only rules are not installed.';
  end if;
end $$;

drop trigger m4_archived_room_readonly on public.m6_comprehension_attempts;
drop trigger m4_archived_room_readonly on public.m6_comprehension_responses;
drop trigger m4_archived_room_readonly on public.oral_reading_attempts;
drop trigger m4_archived_room_readonly on public.oral_reading_recordings;
drop trigger m4_archived_room_readonly on public.oral_reading_pronunciation_checks;
drop trigger m4_archived_room_readonly on public.m5_verified_readings;
drop trigger m4_archived_room_readonly on public.rooms;
drop trigger m4_archived_room_readonly on public.room_modules;
drop trigger m4_archived_room_readonly on public.reading_activity_assignments;
drop trigger m4_archived_room_readonly on public.enrollments;
drop function public.m4_guard_archived_learner_results();
drop function public.m4_guard_archived_room_management();
drop function public.m4_room_archived_locked(uuid);

notify pgrst, 'reload schema';
commit;
