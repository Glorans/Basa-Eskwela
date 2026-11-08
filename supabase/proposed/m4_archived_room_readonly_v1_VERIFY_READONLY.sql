-- READ ONLY. Before and after m4_archived_room_readonly_v1_PROPOSED.sql. Selects catalog facts and counts only.
begin transaction read only;
-- 1. Before: archive_installed true, readonly_installed false, readonly_triggers 0. After: true, true, 10.
select to_regprocedure('public.m4_set_room_archived(uuid,boolean)') is not null as archive_installed,
   to_regprocedure('public.m4_room_archived_locked(uuid)') is not null as readonly_installed,
   (select count(*) from pg_trigger where tgname = 'm4_archived_room_readonly' and not tgisinternal) as readonly_triggers;
-- 2. Archived rooms and what they hold (counts only). Nothing here may change when applying.
select count(*) as archived_rooms,
   (select count(*) from public.enrollments e join public.rooms r on r.id = e.room_id where r.archived_at is not null) as archived_enrollments,
   (select count(*) from public.oral_reading_attempts a join public.rooms r on r.id = a.room_id where r.archived_at is not null) as archived_readings,
   (select count(*) from public.m6_comprehension_attempts a join public.rooms r on r.id = a.room_id where r.archived_at is not null) as archived_assessments,
   (select count(*) from public.m6_comprehension_attempts a join public.rooms r on r.id = a.room_id
     where r.archived_at is not null and a.status <> 'completed') as archived_pending_assessments
from public.rooms where archived_at is not null;
rollback;
