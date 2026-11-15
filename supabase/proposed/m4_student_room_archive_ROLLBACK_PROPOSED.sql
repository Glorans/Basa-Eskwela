-- PROPOSAL ONLY. Rollback of m4_student_room_archive_PROPOSED.sql.
-- Drops only the objects that migration created. Personal archive marks are lost: every joined room
-- reappears in its Student's active Learning Rooms list. Rooms, enrollments, assignments, attempts,
-- results and XP are not touched. The Teacher archive (rooms.archived_at) is not touched.
begin;
set local lock_timeout = '5s';
drop function if exists public.m4_set_my_room_archived(uuid, boolean);
drop table if exists public.m4_student_room_archives;
commit;
