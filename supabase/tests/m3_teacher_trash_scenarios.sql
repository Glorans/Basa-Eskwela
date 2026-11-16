-- Scenarios for supabase/proposed/m3_teacher_trash_PROPOSED.sql. NOT standalone: the runner prepends the setup section
-- of m3_teacher_module_management_test.sql (lines 1-111: synthetic users, materials and pg_temp helpers, inside one
-- transaction) and appends ROLLBACK. Run ONLY on a disposable local database that already has the migration.

-- ---------------------------------------------------------------- setup: drafts, one published Teacher module
select pg_temp.run('setup: T1 English draft', 't1', pg_temp.draft('m_t1','p_t1','path_en','T1 English module','mat_t1'), 'ok');
select pg_temp.run('setup: T1 Filipino draft', 't1', pg_temp.draft('m_fil','p_fil','path_fil','T1 Filipino module',null), 'ok');
select pg_temp.run('setup: T2 draft', 't2', pg_temp.draft('m_t2','p_t2','path_en','T2 module',null), 'ok');
select pg_temp.run('setup: Admin draft', 'admin', pg_temp.draft('m_admin','p_admin','path_en','Admin module',null), 'ok');
select pg_temp.run('setup: T1 saves a bank', 't1', pg_temp.save_bank('m_t1','p_t1','generate',1), 'ok');
select pg_temp.run('setup: T1 reviews the bank', 't1', pg_temp.save_bank('m_t1','p_t1','review',1), 'ok');
select pg_temp.run('setup: T1 publishes', 't1', format($s$update public.modules set status = 'published' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=1');

-- ---------------------------------------------------------------- no permanent deletion for Teachers
select pg_temp.run('Teacher hard delete is refused (unused draft)', 't1', format('select public.m3_delete_module(%L)', (select v from m3k where k='m_fil')), 'denied');
select pg_temp.run('Teacher cannot purge', 't1', format('select public.m3_purge_module(%L)', (select v from m3k where k='m_fil')), 'denied');
select pg_temp.run('Teacher cannot call the internal helper', 't1', format('select public.m3_trash_manager(%L)', (select v from m3k where k='m_fil')), 'denied');

-- ---------------------------------------------------------------- draft: trash and restore
select pg_temp.run('Owner moves own draft to the Trash', 't1', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_fil')), 'value=trashed');
select pg_temp.run('Trashed draft row kept (deleted_at set)', 'db', format('select (deleted_at is not null)::text from public.modules where id = %L', (select v from m3k where k='m_fil')), 'value=true');
select pg_temp.run('Trashed draft passages kept', 'db', format('select count(*)::text from public.module_passages where module_id = %L', (select v from m3k where k='m_fil')), 'value=1');
select pg_temp.run('Owner sees it in their Trash', 't1', format('select count(*)::text from public.m3_trashed_modules() where id = %L', (select v from m3k where k='m_fil')), 'value=1');
select pg_temp.run('Other Teacher does not see it', 't2', format('select count(*)::text from public.m3_trashed_modules() where id = %L', (select v from m3k where k='m_fil')), 'value=0');
select pg_temp.run('Other Teacher Trash is empty', 't2', 'select count(*)::text from public.m3_trashed_modules()', 'value=0');
select pg_temp.run('Owner Trash shows exactly own trashed modules', 't1', 'select count(*)::text from public.m3_trashed_modules()', 'value=1');
select pg_temp.run('Student cannot list the Trash', 'student', 'select count(*)::text from public.m3_trashed_modules()', 'denied');
select pg_temp.run('Pending Teacher cannot list the Trash', 'pending', 'select count(*)::text from public.m3_trashed_modules()', 'denied');
select pg_temp.run('Other Teacher cannot restore it', 't2', format('select public.m3_restore_module(%L)', (select v from m3k where k='m_fil')), 'denied');
select pg_temp.run('Student cannot restore it', 'student', format('select public.m3_restore_module(%L)', (select v from m3k where k='m_fil')), 'denied');
select pg_temp.run('Owner restores the draft as a draft', 't1', format('select public.m3_restore_module(%L)', (select v from m3k where k='m_fil')), 'value=draft');
select pg_temp.run('Restored draft is live again with its passage', 'db', format('select (deleted_at is null and status = %L)::text || count(p.id) from public.modules m left join public.module_passages p on p.module_id = m.id where m.id = %L group by m.deleted_at, m.status', 'draft', (select v from m3k where k='m_fil')), 'value=true1');
select pg_temp.run('Owner Trash empty after restore', 't1', 'select count(*)::text from public.m3_trashed_modules()', 'value=0');

-- ---------------------------------------------------------------- ownership: other users' modules
select pg_temp.run('Teacher cannot trash another Teacher''s module', 't1', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_t2')), 'denied');
select pg_temp.run('Teacher cannot trash an Admin module', 't1', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_admin')), 'denied');
select pg_temp.run('Student cannot trash', 'student', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('Pending Teacher cannot trash own old module', 'pending', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_pending')), 'denied');
-- Teachers have no UPDATE right on deleted_at at all: the direct update is refused outright.
select pg_temp.run('Teacher cannot soft-delete directly', 't1', format('update public.modules set deleted_at = now() where id = %L', (select v from m3k where k='m_t2')), 'denied');

-- ---------------------------------------------------------------- published module with an active Learning Room assignment
reset role;
-- A Learning Room of T1 and an active assignment of T1's published module (shapes cloned from existing rows).
insert into m3k values ('room_t1', '00000000-0000-4000-8000-000000aa0001'), ('rm_t1', '00000000-0000-4000-8000-000000aa0002'),
                       ('rm_late', '00000000-0000-4000-8000-000000aa0003'), ('room_t1b', '00000000-0000-4000-8000-000000aa0004');
insert into public.rooms
select (jsonb_populate_record(null::public.rooms, to_jsonb(r) || jsonb_build_object(
  'id', (select v from m3k where k='room_t1'), 'teacher_id', (select v from m3k where k='t1'), 'room_code', 'M3TRASH1',
  'archived_at', null, 'subject', 'en'))).*
from (select * from public.rooms order by created_at limit 1) r;
-- A second Learning Room of T1 (each room holds one assignment row per module, removed or not).
insert into public.rooms
select (jsonb_populate_record(null::public.rooms, to_jsonb(r) || jsonb_build_object(
  'id', (select v from m3k where k='room_t1b'), 'teacher_id', (select v from m3k where k='t1'), 'room_code', 'M3TRASH2',
  'archived_at', null, 'subject', 'en'))).*
from (select * from public.rooms order by created_at limit 1) r;
insert into public.room_modules
select (jsonb_populate_record(null::public.room_modules, to_jsonb(rm) || jsonb_build_object(
  'id', (select v from m3k where k='rm_t1'), 'room_id', (select v from m3k where k='room_t1'), 'module_id', (select v from m3k where k='m_t1'),
  'assigned_by', (select v from m3k where k='t1'), 'removed_at', null, 'removed_by', null, 'targeting_mode', 'whole_class'))).*
from (select * from public.room_modules order by assigned_at limit 1) rm;
insert into public.progress(user_id, module_id) values ((select v from m3k where k='student'), (select v from m3k where k='m_t1'));
-- Baselines: the first publication date, and every saved learner result table (must be identical at the end).
create temp table m3pub as select published_at from public.modules where id = (select v from m3k where k='m_t1');
create temp table m3results as select
  (select count(*) from public.oral_reading_attempts) a, (select count(*) from public.oral_reading_recordings) b,
  (select count(*) from public.m6_comprehension_attempts) c, (select count(*) from public.m6_comprehension_responses) d,
  (select count(*) from public.diagnostic_results) e, (select count(*) from public.m8_xp_events) f,
  (select count(*) from public.reading_activity_assignments) g;
grant select on m3pub, m3results to authenticated;

select pg_temp.run('Assigned published module: Teacher trash refused', 't1', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('Refusal names the Learning Room dependency', 'db',
  $s$select (select detail from m3t where label = 'Assigned published module: Teacher trash refused') like '%assigned in 1 Learning Room%'$s$, 'value=true');
select pg_temp.run('Module still live and published after the refusal', 'db', format('select status || (deleted_at is null)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=publishedtrue');

-- The Teacher removes the assignment (removed_at), then trashes the module.
reset role;
update public.room_modules set removed_at = now(), removed_by = (select v from m3k where k='t1') where id = (select v from m3k where k='rm_t1');
select pg_temp.run('After unassigning: owner trashes the published module', 't1', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_t1')), 'value=trashed');
select pg_temp.run('Learner progress kept', 'db', format('select count(*)::text from public.progress where module_id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('Removed assignment row kept', 'db', format('select count(*)::text from public.room_modules where id = %L', (select v from m3k where k='rm_t1')), 'value=1');
select pg_temp.run('Question bank kept', 'db', format('select count(*)::text from public.comprehension_questions where module_id = %L', (select v from m3k where k='m_t1')), 'value=6');
select pg_temp.run('Trashed module hidden from Students', 'student', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=0');
select pg_temp.run('Trashed module cannot be newly assigned', 'db',
  format($s$insert into public.room_modules select (jsonb_populate_record(null::public.room_modules, to_jsonb(rm) || jsonb_build_object('id', %L))).* from public.room_modules rm where rm.id = %L$s$,
    (select v from m3k where k='rm_late'), (select v from m3k where k='rm_t1')), 'denied');
select pg_temp.run('Owner restores the published module: comes back archived', 't1', format('select public.m3_restore_module(%L)', (select v from m3k where k='m_t1')), 'value=archived');
select pg_temp.run('Restored module keeps content and first-publish date', 'db',
  format('select (published_at is not null)::text || (select count(*) from public.comprehension_questions where module_id = %L) from public.modules where id = %L',
    (select v from m3k where k='m_t1'), (select v from m3k where k='m_t1')), 'value=true6');

-- ---------------------------------------------------------------- Publish Again (explicit, owner only, validated)
select pg_temp.run('Restore never auto-publishes: module stays archived', 'db', format('select status from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=archived');
select pg_temp.run('Archived module hidden from Students', 'student', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=0');
select pg_temp.run('Owner still cannot republish by a direct status update', 't1', format($s$update public.modules set status = 'published' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=0');
select pg_temp.run('Other Teacher cannot republish it', 't2', format('select public.m3_republish_module(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('Student cannot republish it', 'student', format('select public.m3_republish_module(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('Pending Teacher cannot republish', 'pending', format('select public.m3_republish_module(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('Admin does not use the Teacher republish function', 'admin', format('select public.m3_republish_module(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('Owner publishes the restored module again (explicit)', 't1', format('select public.m3_republish_module(%L)', (select v from m3k where k='m_t1')), 'value=published');
select pg_temp.run('Republished: status published, first-publish date unchanged', 'db',
  format('select status || (published_at = (select published_at from m3pub))::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=publishedtrue');
select pg_temp.run('Republished: passage and 6 questions kept, learner progress kept', 'db',
  format('select (select count(*) from public.module_passages where module_id = %1$L)::text || (select count(*) from public.comprehension_questions where module_id = %1$L) || (select count(*) from public.progress where module_id = %1$L)',
    (select v from m3k where k='m_t1')), 'value=161');
select pg_temp.run('Students see the republished module', 'student', format('select count(*)::text from public.modules where id = %L', (select v from m3k where k='m_t1')), 'value=1');
select pg_temp.run('Republish is one-time (no longer archived)', 't1', format('select public.m3_republish_module(%L)', (select v from m3k where k='m_t1')), 'denied');

-- A module the School Admin archives stays with the Admin.
select pg_temp.run('Admin archives the Teacher''s published module', 'admin', format($s$update public.modules set status = 'archived' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=1');
select pg_temp.run('Teacher cannot republish an Admin-archived module', 't1', format('select public.m3_republish_module(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('Refusal tells the Teacher to ask the School Admin', 'db',
  $s$select (select detail from m3t where label = 'Teacher cannot republish an Admin-archived module') like '%archived by the School Admin%'$s$, 'value=true');
select pg_temp.run('Admin publishes it again through the existing path (validated)', 'admin', format($s$update public.modules set status = 'published' where id = %L$s$, (select v from m3k where k='m_t1')), 'rows=1');

-- ---------------------------------------------------------------- M4: assign the republished module to a Learning Room
-- Same published module and room, before the owner assigns it: the only difference is who owns the room.
select pg_temp.run('Other Teacher cannot assign it into T1''s Learning Room', 't2',
  format('select public.m4_assign_module(%L, %L)', (select v from m3k where k='room_t1b'), (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('Owner assigns the published module to their Learning Room', 't1',
  format('select public.m4_assign_module(%L, %L)', (select v from m3k where k='room_t1b'), (select v from m3k where k='m_t1')), 'ok');
select pg_temp.run('Assigned again: Teacher trash refused again (protects learners)', 't1', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_t1')), 'denied');
select pg_temp.run('No saved learner result changed (readings, recordings, comprehension, diagnostics, XP, activities)', 'db',
  $s$select ((select count(*) from public.oral_reading_attempts), (select count(*) from public.oral_reading_recordings),
    (select count(*) from public.m6_comprehension_attempts), (select count(*) from public.m6_comprehension_responses),
    (select count(*) from public.diagnostic_results), (select count(*) from public.m8_xp_events),
    (select count(*) from public.reading_activity_assignments)) = (select a, b, c, d, e, f, g from m3results)$s$, 'value=true');

-- ---------------------------------------------------------------- Admin unchanged, and an Admin removal stays the Admin's
select pg_temp.run('Admin trashes a Teacher module', 'admin', format('select public.m3_trash_module(%L)', (select v from m3k where k='m_t2')), 'value=trashed');
select pg_temp.run('Admin sees it in the Admin Trash', 'admin', format('select count(*)::text from public.m3_trashed_modules() where id = %L', (select v from m3k where k='m_t2')), 'value=1');
select pg_temp.run('Owner does not see an Admin removal in their Trash', 't2', format('select count(*)::text from public.m3_trashed_modules() where id = %L', (select v from m3k where k='m_t2')), 'value=0');
select pg_temp.run('Owner cannot undo an Admin removal', 't2', format('select public.m3_restore_module(%L)', (select v from m3k where k='m_t2')), 'denied');
select pg_temp.run('Admin restores it', 'admin', format('select public.m3_restore_module(%L)', (select v from m3k where k='m_t2')), 'value=draft');
select pg_temp.run('Admin still hard-deletes an unused draft', 'admin', format('select public.m3_delete_module(%L)', (select v from m3k where k='m_admin')), 'value=permanent');
select pg_temp.run('Admin purges a Teacher-trashed unused module', 'admin',
  format('select public.m3_trash_module(%L) || public.m3_purge_module(%L)', (select v from m3k where k='m_fil'), (select v from m3k where k='m_fil')), 'ok');

-- ---------------------------------------------------------------- report
select case when got = expect then 'PASS' else 'FAIL' end as result, n, label, expect, got,
       case when got = expect then '' else detail end as detail
from m3t order by n;
select count(*) filter (where got = expect) as passed, count(*) filter (where got <> expect) as failed from m3t;
