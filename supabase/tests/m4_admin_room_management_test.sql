-- Permission and regression test for supabase/proposed/m4_admin_room_management_PROPOSED.sql.
-- Run ONLY on a disposable local database that already has the migration (never Staging).
-- Needs one published English and one published Filipino module and the on_auth_user_created trigger.
-- Everything happens inside one transaction that is ROLLED BACK: synthetic users, rooms, enrollments,
-- assignments and audit rows never persist. Each check runs as a signed-in user the way PostgREST does
-- (role authenticated + JWT claims), so RLS and function checks are real.
\set ON_ERROR_STOP on
begin;

create temp table m4t(n serial primary key, label text, expect text, got text, detail text);
create temp table m4k(k text primary key, v uuid);
grant select, insert on m4t to authenticated; grant usage on sequence m4t_n_seq to authenticated;
grant select on m4k to authenticated, anon;

insert into m4k values
  ('admin','00000000-0000-4000-8000-0000004a0001'), ('t1','00000000-0000-4000-8000-0000004a0002'),
  ('t2','00000000-0000-4000-8000-0000004a0003'), ('pending','00000000-0000-4000-8000-0000004a0004'),
  ('rejected','00000000-0000-4000-8000-0000004a0005'), ('s1','00000000-0000-4000-8000-0000004a0006'),
  ('s2','00000000-0000-4000-8000-0000004a0007'), ('learner','00000000-0000-4000-8000-0000004a0008'),
  ('room_t2','00000000-0000-4000-8000-0000004b0002'), ('room_pending','00000000-0000-4000-8000-0000004b0004'),
  ('room_t1en','00000000-0000-4000-8000-0000004b0001');
insert into m4k select 'mod_en', m.id from public.modules m join public.learning_paths p on p.id = m.path_id
  where m.status = 'published' and m.deleted_at is null and public.m4_normalize_subject(p.language) = 'en' order by m.id limit 1;
insert into m4k select 'mod_fil', m.id from public.modules m join public.learning_paths p on p.id = m.path_id
  where m.status = 'published' and m.deleted_at is null and public.m4_normalize_subject(p.language) = 'fil' order by m.id limit 1;

-- Synthetic accounts (profiles come from the on_auth_user_created trigger).
insert into auth.users(id, email, aud, role)
select v, k || '.m4admintest@example.test', 'authenticated', 'authenticated'
from m4k where k in ('admin','t1','t2','pending','rejected','s1','s2','learner');
update public.profiles p set full_name = 'M4 test ' || k.k, nickname = 'M4' || k.k,
  role = case k.k when 'admin' then 'admin' when 's1' then 'student' when 's2' then 'student'
                  when 'learner' then 'general_user' else 'teacher' end,
  teacher_status = case k.k when 't1' then 'approved' when 't2' then 'approved' when 'pending' then 'pending'
                            when 'rejected' then 'rejected' else null end
from m4k k where p.id = k.v;
-- A room owned by Teacher 2, and an older room whose owner is no longer approved (created directly).
insert into public.rooms(id, teacher_id, room_name, room_code, subject) values
  ((select v from m4k where k='room_t2'), (select v from m4k where k='t2'), 'M4 test T2 room', 'MTWOROOM', 'en'),
  ((select v from m4k where k='room_pending'), (select v from m4k where k='pending'), 'M4 test pending room', 'MPENDRMM', 'en'),
  ((select v from m4k where k='room_t1en'), (select v from m4k where k='t1'), 'M4 test T1 English room', 'MTONEENR', 'en');

create function pg_temp.k(key text) returns uuid language sql stable as $f$ select v from m4k where k = key $f$;
create function pg_temp.run(label text, who text, stmt text, expect text) returns void language plpgsql as $f$
declare got text; detail text := ''; rc bigint; val text;
begin
  if who <> 'db' then
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.k(who), 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', pg_temp.k(who)::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  begin
    if expect like 'value=%' then
      execute stmt into val; got := 'value=' || coalesce(val, 'null');
    else
      execute stmt; get diagnostics rc = row_count;
      got := case when expect like 'rows=%' then 'rows=' || rc else 'ok' end;
    end if;
  exception when others then
    got := 'denied'; detail := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into m4t(label, expect, got, detail) values (label, expect, got, detail);
end $f$;
create function pg_temp.create_room(owner text, name text, subject text, code text) returns text language sql as $f$
  select format('select (public.m4_admin_create_room(%L, %L, %L, %L, %L, %L)).teacher_id::text',
    pg_temp.k(owner), name, ' Section A ', '  ', subject, code)
$f$;

select pg_temp.run('setup: published English and Filipino modules exist', 'db',
  $s$select (count(*) filter (where k in ('mod_en','mod_fil')))::text from m4k$s$, 'value=2');

-- ---------------------------------------------------------------- F1 Admin creates a room for an approved Teacher
select pg_temp.run('F1 Admin lists approved Teachers (both included)', 'admin',
  format('select count(*)::text from public.m4_admin_classroom_teachers() where id in (%L, %L)', pg_temp.k('t1'), pg_temp.k('t2')), 'value=2');
select pg_temp.run('F1 Teacher list leaves out pending/rejected Teachers, Students, Learners and Admins', 'admin',
  format('select count(*)::text from public.m4_admin_classroom_teachers() where id in (%L, %L, %L, %L, %L)',
    pg_temp.k('pending'), pg_temp.k('rejected'), pg_temp.k('s1'), pg_temp.k('learner'), pg_temp.k('admin')), 'value=0');
select pg_temp.run('F1 Teacher cannot list Teachers', 't1', 'select count(*) from public.m4_admin_classroom_teachers()', 'denied');
select pg_temp.run('F1 Student cannot list Teachers', 's1', 'select count(*) from public.m4_admin_classroom_teachers()', 'denied');
select pg_temp.run('F1 Admin creates an English room owned by Teacher 1', 'admin',
  pg_temp.create_room('t1', '  M4 Admin Room  ', 'en', 'ADMNR234'), 'value=' || pg_temp.k('t1'));
insert into m4k select 'room_admin', id from public.rooms where room_code = 'ADMNR234';
select pg_temp.run('F1 room saved with trimmed name, section, no description', 'db',
  format($s$select room_name || '|' || section || '|' || coalesce(description, 'null') || '|' || subject || '|' || (archived_at is null)
            from public.rooms where id = %L$s$, pg_temp.k('room_admin')), 'value=M4 Admin Room|Section A|null|en|true');
select pg_temp.run('F1 audit: Admin recorded as the creator, Teacher 1 as the owner', 'db',
  format($s$select count(*)::text from public.m4_admin_actions where action = 'create_room' and room_id = %L and actor_id = %L
            and teacher_id = %L and student_id is null$s$, pg_temp.k('room_admin'), pg_temp.k('admin'), pg_temp.k('t1')), 'value=1');
select pg_temp.run('F1/F3 no enrollment created for the Admin or the Teacher', 'db',
  format('select count(*)::text from public.enrollments where room_id = %L', pg_temp.k('room_admin')), 'value=0');
select pg_temp.run('F1 owner Teacher sees the room in their Learning Rooms', 't1',
  format('select count(*)::text from public.rooms where id = %L and teacher_id = auth.uid()', pg_temp.k('room_admin')), 'value=1');
select pg_temp.run('F1 owner Teacher edits it with the existing Teacher permission', 't1',
  format($s$update public.rooms set description = 'Edited by owner' where id = %L$s$, pg_temp.k('room_admin')), 'rows=1');
select pg_temp.run('F1 another Teacher cannot see it', 't2',
  format('select count(*)::text from public.rooms where id = %L', pg_temp.k('room_admin')), 'value=0');
select pg_temp.run('F1 a Student who has not joined cannot see it', 's1',
  format('select count(*)::text from public.rooms where id = %L', pg_temp.k('room_admin')), 'value=0');
select pg_temp.run('F1 Admin cannot make a pending Teacher the owner', 'admin', pg_temp.create_room('pending', 'X', 'en', 'ADMNRPND'), 'denied');
select pg_temp.run('F1 Admin cannot make a rejected Teacher the owner', 'admin', pg_temp.create_room('rejected', 'X', 'en', 'ADMNRREJ'), 'denied');
select pg_temp.run('F1 Admin cannot make a Student the owner', 'admin', pg_temp.create_room('s1', 'X', 'en', 'ADMNRSTU'), 'denied');
select pg_temp.run('F1 Admin cannot make themselves the owner', 'admin', pg_temp.create_room('admin', 'X', 'en', 'ADMNRADM'), 'denied');
select pg_temp.run('F1 no ownerless room', 'admin',
  $s$select (public.m4_admin_create_room(null, 'X', '', '', 'en', 'ADMNRNUL')).id$s$, 'denied');
select pg_temp.run('F1 room name is required', 'admin', pg_temp.create_room('t1', '   ', 'en', 'ADMNRBLK'), 'denied');
select pg_temp.run('F1 subject must be English or Filipino', 'admin', pg_temp.create_room('t1', 'X', 'es', 'ADMNRSUB'), 'denied');
select pg_temp.run('F1 malformed room code rejected', 'admin', pg_temp.create_room('t1', 'X', 'en', 'abc1'), 'denied');
select pg_temp.run('F1 duplicate room code rejected', 'admin', pg_temp.create_room('t2', 'X', 'en', 'ADMNR234'), 'denied');
select pg_temp.run('F1 Teacher cannot use the Admin create function', 't1', pg_temp.create_room('t1', 'X', 'en', 'ADMNRT01'), 'denied');
select pg_temp.run('F1 Student cannot use the Admin create function', 's1', pg_temp.create_room('t1', 'X', 'en', 'ADMNRS01'), 'denied');
select pg_temp.run('F1 Independent Learner cannot use the Admin create function', 'learner', pg_temp.create_room('t1', 'X', 'en', 'ADMNRL01'), 'denied');
select pg_temp.run('F1 failed attempts left no rooms or audit rows', 'db',
  $s$select (select count(*) from public.rooms where room_code like 'ADMNR%') || '/' ||
            (select count(*) from public.m4_admin_actions where action = 'create_room' and actor_id = pg_temp.k('admin'))$s$, 'value=1/1');
select pg_temp.run('F1 Teacher still creates own room the existing way', 't1',
  format($s$insert into public.rooms(teacher_id, subject, room_name, room_code) values (%L, 'fil', 'T1 own', 'TONEOWN2')$s$, pg_temp.k('t1')), 'rows=1');
select pg_temp.run('F1 Teacher still cannot create a room for another Teacher', 't1',
  format($s$insert into public.rooms(teacher_id, subject, room_name, room_code) values (%L, 'en', 'Spoof', 'TSPOOF22')$s$, pg_temp.k('t2')), 'denied');
select pg_temp.run('F1 Admin still cannot insert rooms directly', 'admin',
  format($s$insert into public.rooms(teacher_id, subject, room_name, room_code) values (%L, 'en', 'Direct', 'ADIRECT2')$s$, pg_temp.k('t1')), 'denied');

-- ---------------------------------------------------------------- F3 joining stays Student-only
select pg_temp.run('F3 Student joins the Admin-created room with its code', 's1', $s$select (public.join_room_by_code(' admnr234 ')).id is not null$s$, 'ok');
select pg_temp.run('F3 Student 2 joins too', 's2', $s$select public.join_room_by_code('ADMNR234')$s$, 'ok');
select pg_temp.run('F3 Admin cannot join as a Student', 'admin', $s$select public.join_room_by_code('ADMNR234')$s$, 'denied');
select pg_temp.run('F3 Teacher cannot join as a Student', 't1', $s$select public.join_room_by_code('ADMNR234')$s$, 'denied');
select pg_temp.run('F3 enrollments are the two Students only', 'db',
  format($s$select (select count(*) from public.enrollments e join public.profiles p on p.id = e.student_id
                    where e.room_id = %1$L and p.role = 'student') || '/' || (select count(*) from public.enrollments where room_id = %1$L)$s$,
    pg_temp.k('room_admin')), 'value=2/2');

-- ---------------------------------------------------------------- F5 Admin edits a room
select pg_temp.run('F5 Admin edits name, section and description', 'admin',
  format($s$select (public.m4_admin_update_room(%L, ' Renamed by Admin ', '', ' New notes ')).room_name$s$, pg_temp.k('room_t2')), 'value=Renamed by Admin');
select pg_temp.run('F5 owner, code and subject unchanged; section cleared', 'db',
  format($s$select (teacher_id = %L)::text || '|' || room_code || '|' || subject || '|' || coalesce(section, 'null') || '|' || description
            from public.rooms where id = %L$s$, pg_temp.k('t2'), pg_temp.k('room_t2')), 'value=true|MTWOROOM|en|null|New notes');
select pg_temp.run('F5 audit: Admin edit recorded', 'db',
  format($s$select count(*)::text from public.m4_admin_actions where action = 'update_room' and room_id = %L and actor_id = %L$s$,
    pg_temp.k('room_t2'), pg_temp.k('admin')), 'value=1');
select pg_temp.run('F5 room name still required', 'admin', format($s$select public.m4_admin_update_room(%L, ' ', '', '')$s$, pg_temp.k('room_t2')), 'denied');
select pg_temp.run('F5 Teacher cannot use the Admin edit function', 't2', format($s$select public.m4_admin_update_room(%L, 'X', '', '')$s$, pg_temp.k('room_t2')), 'denied');
select pg_temp.run('F5 Teacher still cannot edit another Teacher''s room', 't1',
  format($s$update public.rooms set room_name = 'Hijack' where id = %L$s$, pg_temp.k('room_t2')), 'rows=0');
select pg_temp.run('F5 Admin still cannot update rooms directly', 'admin',
  format($s$update public.rooms set room_name = 'Direct' where id = %L$s$, pg_temp.k('room_t2')), 'rows=0');
select pg_temp.run('F10 Admin archives Teacher 2''s room (existing)', 'admin', format('select public.m4_set_room_archived(%L, true)::text', pg_temp.k('room_t2')), 'value=true');
select pg_temp.run('F5 archived room stays locked for Admin edits', 'admin', format($s$select public.m4_admin_update_room(%L, 'X', '', '')$s$, pg_temp.k('room_t2')), 'denied');

-- ---------------------------------------------------------------- F6 Admin assigns reading modules
alter table public.m4_admin_actions add constraint m4_test_audit_failure
  check (action <> 'assign_module') not valid;
select pg_temp.run('F6 audit failure rejects the module assignment', 'admin',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_admin'), pg_temp.k('mod_en')), 'denied');
select pg_temp.run('F6 failure came from the audit constraint', 'db',
  $s$select (detail like '23514 %m4_test_audit_failure%')::text from m4t
     where label = 'F6 audit failure rejects the module assignment'$s$, 'value=true');
select pg_temp.run('F6 audit failure leaves no module assignment', 'db',
  $s$select count(*)::text from public.room_modules where room_id = pg_temp.k('room_admin')$s$, 'value=0');
alter table public.m4_admin_actions drop constraint m4_test_audit_failure;

select pg_temp.run('F6 Admin assigns an English module to the whole class', 'admin',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_admin'), pg_temp.k('mod_en')), 'ok');
insert into m4k select 'rm_admin', id from public.room_modules where room_id = pg_temp.k('room_admin') and module_id = pg_temp.k('mod_en');
select pg_temp.run('F6 assignment stays under the room''s Teacher (learner visibility rules)', 'db',
  format('select (assigned_by = %L)::text from public.room_modules where id = %L', pg_temp.k('t1'), pg_temp.k('rm_admin')), 'value=true');
select pg_temp.run('F6 audit: Admin recorded as the actor', 'db',
  format($s$select count(*)::text from public.m4_admin_actions where action = 'assign_module' and room_module_id = %L and actor_id = %L and teacher_id = %L$s$,
    pg_temp.k('rm_admin'), pg_temp.k('admin'), pg_temp.k('t1')), 'value=1');
select pg_temp.run('F6 enrolled Student sees the Admin-assigned module', 's1',
  format('select count(*)::text from public.room_modules where id = %L', pg_temp.k('rm_admin')), 'value=1');
select pg_temp.run('F6 module counts as assigned for that Student', 's1',
  format('select public.m4_module_assigned_to(%L, %L)::text', pg_temp.k('rm_admin'), pg_temp.k('s1')), 'value=true');
select pg_temp.run('F6 oral reading can be saved for the Admin-assigned module', 'db',
  $s$insert into public.oral_reading_attempts(id, user_id, passage_snapshot, transcript, duration_seconds, reading_speed_wpm,
       pronunciation_accuracy, expected_word_count, detected_error_count, word_metrics, room_id, module_id, assignment_id, language_snapshot)
     values ('00000000-0000-4000-8000-0000004e0001', pg_temp.k('s1'), 'Mia planted three seeds.', 'Mia planted three seeds.', 10, 60, 100, 4, 0,
       '[]'::jsonb, pg_temp.k('room_admin'), pg_temp.k('mod_en'), pg_temp.k('rm_admin'), 'en')$s$, 'rows=1');
select pg_temp.run('F6 Admin-assigned module passes the unchanged M6 completion gate', 'db',
  $s$with a as (insert into public.m6_comprehension_attempts(user_id, submission_id, passage_title, passage_text, language, question_snapshot,
       room_id, module_id, assignment_id, oral_reading_attempt_id, passage_id)
     values (pg_temp.k('s1'), gen_random_uuid(), 'Synthetic module reading', 'Mia planted three seeds.', 'en', '[{"id": "q1"}]'::jsonb,
       pg_temp.k('room_admin'), pg_temp.k('mod_en'), pg_temp.k('rm_admin'), '00000000-0000-4000-8000-0000004e0001',
       (select id from public.module_passages where module_id = pg_temp.k('mod_en') order by display_order limit 1)) returning id)
     select public.m6_assert_learner_completion_access((select id from a))$s$, 'ok');
select pg_temp.run('F6 owner Teacher sees it in their room', 't1',
  format('select count(*)::text from public.room_modules where id = %L', pg_temp.k('rm_admin')), 'value=1');
select pg_temp.run('F6 language must match the room subject', 'admin',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_admin'), pg_temp.k('mod_fil')), 'denied');
select pg_temp.run('F6 archived room accepts no new modules', 'admin',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_t2'), pg_temp.k('mod_en')), 'denied');
select pg_temp.run('F6 not into a room whose Teacher is not approved', 'admin',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_pending'), pg_temp.k('mod_en')), 'denied');
select pg_temp.run('F6 past deadlines still rejected', 'admin',
  format($s$select public.m4_assign_module(%L, %L, 'whole_class', '{}', now() - interval '1 day')$s$, pg_temp.k('room_admin'), pg_temp.k('mod_en')), 'denied');
select pg_temp.run('F6 another Teacher cannot assign into Teacher 1''s room', 't2',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_admin'), pg_temp.k('mod_en')), 'denied');
select pg_temp.run('F6 Student cannot assign', 's1',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_admin'), pg_temp.k('mod_en')), 'denied');
select pg_temp.run('F6 pending Teacher cannot assign into their old room', 'pending',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_pending'), pg_temp.k('mod_en')), 'denied');
select pg_temp.run('F6 Teacher still assigns the existing way (direct insert, assigned by self)', 't1',
  $s$insert into public.room_modules(room_id, module_id, assigned_by) select id, pg_temp.k('mod_fil'), pg_temp.k('t1') from public.rooms where room_code = 'TONEOWN2'$s$, 'rows=1');
select pg_temp.run('F6 Teacher RPC path still works for the owner', 't1',
  format('select public.m4_assign_module(%L, %L)', pg_temp.k('room_t1en'), pg_temp.k('mod_en')), 'ok');
select pg_temp.run('F6 Teacher assignments create no Admin audit rows', 'db',
  $s$select count(*)::text from public.m4_admin_actions where action = 'assign_module' and room_id in (pg_temp.k('room_t1en'), (select id from public.rooms where room_code = 'TONEOWN2'))$s$, 'value=0');
select pg_temp.run('F6 selected-students mode still off unless enabled', 'admin',
  format($s$select public.m4_assign_module(%L, %L, 'selected_students', array[%L]::uuid[])$s$, pg_temp.k('room_admin'), pg_temp.k('mod_en'), pg_temp.k('s1')), 'denied');
update public.m4_targeting_rollout set enabled = true;
select pg_temp.run('F1 Admin creates a second room for Teacher 1', 'admin', pg_temp.create_room('t1', 'M4 Admin Room 2', 'en', 'ADMNR567'), 'value=' || pg_temp.k('t1'));
select pg_temp.run('F3 Student 1 joins room 2', 's1', $s$select public.join_room_by_code('ADMNR567')$s$, 'ok');
select pg_temp.run('F3 Student 2 joins room 2', 's2', $s$select public.join_room_by_code('ADMNR567')$s$, 'ok');
select pg_temp.run('F6 Admin assigns to one selected Student (rollout enabled in this test only)', 'admin',
  $s$select public.m4_assign_module((select id from public.rooms where room_code = 'ADMNR567'), pg_temp.k('mod_en'), 'selected_students', array[pg_temp.k('s1')])$s$, 'ok');
insert into m4k select 'rm_selected', id from public.room_modules where targeting_mode = 'selected_students'
  and room_id = (select id from public.rooms where room_code = 'ADMNR567');
select pg_temp.run('F6 selected Student sees it', 's1', format('select count(*)::text from public.room_modules where id = %L', pg_temp.k('rm_selected')), 'value=1');
select pg_temp.run('F6 other Student does not', 's2', format('select count(*)::text from public.room_modules where id = %L', pg_temp.k('rm_selected')), 'value=0');

-- Unassign / restore
select pg_temp.run('F6 Admin removes a module', 'admin', format('select public.m4_unassign_module(%L)::text', pg_temp.k('rm_admin')), 'value=true');
select pg_temp.run('F6 removal records the Admin as the real actor', 'db',
  format('select (removed_by = %L and removed_at is not null)::text from public.room_modules where id = %L', pg_temp.k('admin'), pg_temp.k('rm_admin')), 'value=true');
select pg_temp.run('F6 removed module no longer counts for the Student', 's1',
  format('select public.m4_module_assigned_to(%L, %L)::text', pg_temp.k('rm_admin'), pg_temp.k('s1')), 'value=false');
select pg_temp.run('F6 Admin restores it', 'admin', format('select public.m4_unassign_module(%L, true)::text', pg_temp.k('rm_admin')), 'value=true');
select pg_temp.run('F6 audit: removal and restore recorded', 'db',
  format($s$select string_agg(action, ',' order by acted_at, action) from public.m4_admin_actions where room_module_id = %L and action <> 'assign_module'$s$,
    pg_temp.k('rm_admin')), 'value=restore_module,unassign_module');
select pg_temp.run('F6 repeated restore is a no-op without an audit row', 'admin', format('select public.m4_unassign_module(%L, true)::text', pg_temp.k('rm_admin')), 'value=false');
select pg_temp.run('F6 owner Teacher still removes their module', 't1', format('select public.m4_unassign_module(%L)::text', pg_temp.k('rm_admin')), 'value=true');
select pg_temp.run('F6 another Teacher cannot restore it', 't2', format('select public.m4_unassign_module(%L, true)::text', pg_temp.k('rm_admin')), 'denied');
select pg_temp.run('F6 Student cannot restore it', 's1', format('select public.m4_unassign_module(%L, true)::text', pg_temp.k('rm_admin')), 'denied');
select pg_temp.run('F6 Teacher removals create no Admin audit rows', 'db',
  format($s$select count(*)::text from public.m4_admin_actions where room_module_id = %L$s$, pg_temp.k('rm_admin')), 'value=3');

-- ---------------------------------------------------------------- F7 attribution (full F7 tests: m4_admin_activity_assignment_test.sql)
select pg_temp.run('F7 Admin cannot assign a reading activity attributed to themselves', 'admin',
  format($s$insert into public.reading_activity_assignments(room_id, material_id, student_id, assigned_by, status)
            select %L, id, %L, %L, 'assigned' from public.uploaded_materials limit 1$s$, pg_temp.k('room_admin'), pg_temp.k('s1'), pg_temp.k('admin')), 'denied');

-- ---------------------------------------------------------------- F8/F9 roster
select pg_temp.run('F8 Admin sees the enrolled Students', 'admin',
  format('select count(*)::text from public.enrollments where room_id = %L', pg_temp.k('room_admin')), 'value=2');
select pg_temp.run('F9 Admin removes a Student (existing audited function)', 'admin',
  format('select public.m4_admin_remove_enrollment((select id from public.enrollments where room_id = %L and student_id = %L))::text',
    pg_temp.k('room_admin'), pg_temp.k('s2')), 'value=true');
select pg_temp.run('F9 removal audited with the Student', 'db',
  format($s$select count(*)::text from public.m4_admin_actions where action = 'remove_enrollment' and room_id = %L and student_id = %L and actor_id = %L$s$,
    pg_temp.k('room_admin'), pg_temp.k('s2'), pg_temp.k('admin')), 'value=1');
select pg_temp.run('F9 Teacher cannot use the Admin removal function', 't1',
  format('select public.m4_admin_remove_enrollment((select id from public.enrollments where room_id = %L limit 1))', pg_temp.k('room_admin')), 'denied');

-- ---------------------------------------------------------------- action list and audit table
-- (The dependent F7 proposal, m4_admin_activity_assignment, appends assign_activity/unassign_activity.)
select pg_temp.run('Admin action list includes the new actions', 'admin',
  $s$select (array_to_string(public.m4_admin_classroom_actions(), ',') like 'remove_enrollment,create_room,update_room,assign_module,unassign_module%')::text$s$, 'value=true');
select pg_temp.run('Teacher action list stays empty', 't1', 'select array_to_string(public.m4_admin_classroom_actions(), '','')', 'value=');
select pg_temp.run('Admin cannot write audit rows directly', 'admin',
  format($s$insert into public.m4_admin_actions(action, room_id, teacher_id, actor_id) values ('create_room', %L, %L, %L)$s$,
    pg_temp.k('room_admin'), pg_temp.k('t1'), pg_temp.k('admin')), 'denied');
select pg_temp.run('Teacher cannot read the audit log', 't1', 'select count(*)::text from public.m4_admin_actions', 'value=0');
select pg_temp.run('Audit shape: create_room needs an owner', 'db',
  format($s$insert into public.m4_admin_actions(action, room_id, actor_id) values ('create_room', %L, %L)$s$, pg_temp.k('room_admin'), pg_temp.k('admin')), 'denied');
select pg_temp.run('Audit shape: remove_enrollment still needs a Student', 'db',
  format($s$insert into public.m4_admin_actions(action, room_id, actor_id) values ('remove_enrollment', %L, %L)$s$, pg_temp.k('room_admin'), pg_temp.k('admin')), 'denied');

-- ---------------------------------------------------------------- report
select case when got = expect then 'PASS' else 'FAIL' end as result, n, label, expect, got,
       case when got = expect then '' else detail end as detail
from m4t order by n;
select count(*) filter (where got = expect) as passed, count(*) filter (where got <> expect) as failed from m4t;

rollback;
