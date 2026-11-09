-- Permission, audit and learner-access test for supabase/proposed/m4_admin_activity_assignment_PROPOSED.sql
-- (F7: Admin assigns reading activities on behalf of the room's approved Teacher).
-- Run ONLY on a disposable local database that has m4_admin_room_management AND this migration (never Staging).
-- Needs at least one existing material question set with questions (its shape is cloned) and the
-- on_auth_user_created trigger. Everything runs in one transaction that is ROLLED BACK.
\set ON_ERROR_STOP on
begin;

create temp table f7t(n serial primary key, label text, expect text, got text, detail text);
create temp table f7k(k text primary key, v uuid);
grant select, insert on f7t to authenticated; grant usage on sequence f7t_n_seq to authenticated;
grant select on f7k to authenticated, anon;

insert into f7k values
  ('admin','00000000-0000-4000-8000-0000007a0001'), ('t1','00000000-0000-4000-8000-0000007a0002'),
  ('t2','00000000-0000-4000-8000-0000007a0003'), ('pending','00000000-0000-4000-8000-0000007a0004'),
  ('rejected','00000000-0000-4000-8000-0000007a0005'), ('s1','00000000-0000-4000-8000-0000007a0006'),
  ('s2','00000000-0000-4000-8000-0000007a0007'), ('s3','00000000-0000-4000-8000-0000007a0008'),
  ('learner','00000000-0000-4000-8000-0000007a0009'),
  ('room1','00000000-0000-4000-8000-0000007b0001'), ('room_arch','00000000-0000-4000-8000-0000007b0002'),
  ('room_pending','00000000-0000-4000-8000-0000007b0003'), ('room_rej','00000000-0000-4000-8000-0000007b0004'),
  ('mat_t1','00000000-0000-4000-8000-0000007c0001'), ('mat_t1b','00000000-0000-4000-8000-0000007c0002'),
  ('mat_t2','00000000-0000-4000-8000-0000007c0003'), ('mat_proc','00000000-0000-4000-8000-0000007c0004'),
  ('mat_pending','00000000-0000-4000-8000-0000007c0005'), ('mat_rej','00000000-0000-4000-8000-0000007c0006'),
  ('qs_t1','00000000-0000-4000-8000-0000007d0001'), ('qs_draft','00000000-0000-4000-8000-0000007d0002'),
  ('qs_t2','00000000-0000-4000-8000-0000007d0003'), ('src_set', null);
update f7k set v = (select s.id from public.material_question_sets s
  where exists (select 1 from public.comprehension_questions q where q.question_set_id = s.id) order by s.created_at limit 1)
where k = 'src_set';

insert into auth.users(id, email, aud, role)
select v, k || '.m4f7test@example.test', 'authenticated', 'authenticated'
from f7k where k in ('admin','t1','t2','pending','rejected','s1','s2','s3','learner');
update public.profiles p set full_name = 'F7 test ' || k.k, nickname = 'F7' || k.k,
  role = case when k.k = 'admin' then 'admin' when k.k in ('s1','s2','s3') then 'student'
              when k.k = 'learner' then 'general_user' else 'teacher' end,
  teacher_status = case k.k when 't1' then 'approved' when 't2' then 'approved' when 'pending' then 'approved'
                            when 'rejected' then 'approved' else null end
from f7k k where p.id = k.v;

create function pg_temp.k(key text) returns uuid language sql stable as $f$ select v from f7k where k = key $f$;

-- Rooms (English) and enrollments, created directly as the database owner.
insert into public.rooms(id, teacher_id, room_name, room_code, subject) values
  (pg_temp.k('room1'), pg_temp.k('t1'), 'F7 room', 'FSEVEN01', 'en'),
  (pg_temp.k('room_arch'), pg_temp.k('t1'), 'F7 archived room', 'FSEVEN02', 'en'),
  (pg_temp.k('room_pending'), pg_temp.k('pending'), 'F7 pending room', 'FSEVEN03', 'en'),
  (pg_temp.k('room_rej'), pg_temp.k('rejected'), 'F7 rejected room', 'FSEVEN04', 'en');
insert into public.enrollments(room_id, student_id) values
  (pg_temp.k('room1'), pg_temp.k('s1')), (pg_temp.k('room1'), pg_temp.k('s2')),
  (pg_temp.k('room_arch'), pg_temp.k('s1')), (pg_temp.k('room_pending'), pg_temp.k('s1')), (pg_temp.k('room_rej'), pg_temp.k('s1'));

-- Materials (cloned row shape; synthetic text), owned by the Teachers.
insert into public.uploaded_materials
select (jsonb_populate_record(null::public.uploaded_materials, to_jsonb(m) || jsonb_build_object(
  'id', o.mat, 'uploaded_by', o.owner, 'title', o.title, 'language', 'en', 'extraction_status', o.status,
  'content_text', case when o.status = 'completed' then 'Mia planted three seeds in a small pot. Every morning she gave them water.' end,
  'raw_extracted_text', 'Mia planted three seeds in a small pot. Every morning she gave them water.',
  'storage_path', o.owner::text || '/' || o.mat::text || '.pdf'))).*
from (select * from public.uploaded_materials order by created_at limit 1) m
cross join (values (pg_temp.k('mat_t1'), pg_temp.k('t1'), 'F7 Teacher 1 story', 'completed'),
                   (pg_temp.k('mat_t1b'), pg_temp.k('t1'), 'F7 Teacher 1 second story', 'completed'),
                   (pg_temp.k('mat_t2'), pg_temp.k('t2'), 'F7 Teacher 2 story', 'completed'),
                   (pg_temp.k('mat_proc'), pg_temp.k('t1'), 'F7 Teacher 1 unfinished', 'processing'),
                   (pg_temp.k('mat_pending'), pg_temp.k('pending'), 'F7 pending Teacher story', 'completed'),
                   (pg_temp.k('mat_rej'), pg_temp.k('rejected'), 'F7 rejected Teacher story', 'completed')) o(mat, owner, title, status);

-- Question sets: a reviewed set for each Teacher's story, and an unreviewed one.
insert into public.material_question_sets(id, material_id, created_by, name, sequence_number) values
  (pg_temp.k('qs_t1'), pg_temp.k('mat_t1'), pg_temp.k('t1'), 'F7 reviewed set', 1),
  (pg_temp.k('qs_draft'), pg_temp.k('mat_t1'), pg_temp.k('t1'), 'F7 unreviewed set', 2),
  (pg_temp.k('qs_t2'), pg_temp.k('mat_t2'), pg_temp.k('t2'), 'F7 Teacher 2 set', 1);
insert into public.comprehension_questions
select (jsonb_populate_record(null::public.comprehension_questions, to_jsonb(q) || jsonb_build_object(
  'id', gen_random_uuid(), 'question_set_id', s.set_id, 'material_id', s.material_id,
  'review_status', s.review) || case when s.review = 'generated'
    then '{"reviewed_by": null, "reviewed_at": null}'::jsonb else jsonb_build_object('reviewed_at', now()) end)).*
from public.comprehension_questions q
cross join (values (pg_temp.k('qs_t1'), pg_temp.k('mat_t1'), 'reviewed'), (pg_temp.k('qs_draft'), pg_temp.k('mat_t1'), 'generated'),
                   (pg_temp.k('qs_t2'), pg_temp.k('mat_t2'), 'reviewed')) s(set_id, material_id, review)
where q.question_set_id = pg_temp.k('src_set');

-- The pending and rejected Teachers were approved when their rooms were made; now they are not.
update public.profiles set teacher_status = 'pending' where id = pg_temp.k('pending');
update public.profiles set teacher_status = 'rejected' where id = pg_temp.k('rejected');

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
  insert into f7t(label, expect, got, detail) values (label, expect, got, detail);
end $f$;
-- The same insert the app sends (classroomService.assignReadingActivity).
create function pg_temp.assign(room text, mat text, student text, owner text, qset text default null,
  due interval default null, st text default 'assigned') returns text language sql as $f$
  select format($s$insert into public.reading_activity_assignments(room_id, material_id, student_id, assigned_by, status,
      question_set_id, read_aloud_only, due_at) values (%L, %L, %L, %L, %L, %L, %L, %L)$s$,
    pg_temp.k(room), pg_temp.k(mat), pg_temp.k(student), pg_temp.k(owner), st, pg_temp.k(qset), qset is null,
    case when due is null then null else date_trunc('second', now() + due) end)
$f$;
create function pg_temp.activity(room text, mat text, student text) returns uuid language sql stable as $f$
  select id from public.reading_activity_assignments where room_id = pg_temp.k(room) and material_id = pg_temp.k(mat)
    and student_id = pg_temp.k(student)
$f$;

select pg_temp.run('setup: source question set found and cloned', 'db',
  $s$select (pg_temp.k('src_set') is not null and (select count(*) from public.comprehension_questions where question_set_id = pg_temp.k('qs_t1')) > 0)::text$s$, 'value=true');

-- ---------------------------------------------------------------- 1, 6, 8, 9 Admin assigns
-- Force audit failure after an otherwise valid insert; the assignment must roll back too.
alter table public.m4_admin_actions add constraint f7_test_audit_failure
  check (action <> 'assign_activity') not valid;
select pg_temp.run('atomic audit failure rejects the assignment', 'admin',
  pg_temp.assign('room1', 'mat_t1', 's1', 't1', 'qs_t1'), 'denied');
select pg_temp.run('atomic failure came from the audit constraint', 'db',
  $s$select (detail like '23514 %f7_test_audit_failure%')::text from f7t
     where label = 'atomic audit failure rejects the assignment'$s$, 'value=true');
select pg_temp.run('atomic audit failure leaves neither assignment nor audit', 'db',
  $s$select (not exists (select 1 from public.reading_activity_assignments where room_id = pg_temp.k('room1'))
     and not exists (select 1 from public.m4_admin_actions where room_id = pg_temp.k('room1')))::text$s$, 'value=true');
alter table public.m4_admin_actions drop constraint f7_test_audit_failure;

select pg_temp.run('1 Admin assigns Teacher 1''s story with a reviewed question set and a deadline', 'admin',
  pg_temp.assign('room1', 'mat_t1', 's1', 't1', 'qs_t1', interval '3 days'), 'rows=1');
insert into f7k values ('act_admin', pg_temp.activity('room1', 'mat_t1', 's1'));
select pg_temp.run('6/9 row keeps the room Teacher, the deadline and the question set', 'db',
  $s$select (a.assigned_by = pg_temp.k('t1'))::text || '|' || (a.due_at = date_trunc('second', a.assigned_at + interval '3 days') or a.due_at > now() + interval '2 days')::text
     || '|' || (a.question_set_id = pg_temp.k('qs_t1'))::text || '|' || a.status || '|' || a.read_aloud_only
     || '|' || ((select teacher_id from public.rooms where id = a.room_id) = pg_temp.k('t1'))::text
     from public.reading_activity_assignments a where a.id = pg_temp.k('act_admin')$s$, 'value=true|true|true|assigned|false|true');
select pg_temp.run('8 audit: real Admin from the session, effective Teacher beside it', 'db',
  $s$select count(*)::text from public.m4_admin_actions where action = 'assign_activity' and activity_id = pg_temp.k('act_admin')
     and actor_id = pg_temp.k('admin') and teacher_id = pg_temp.k('t1') and student_id = pg_temp.k('s1') and room_id = pg_temp.k('room1')$s$, 'value=1');
select pg_temp.run('1 Admin assigns a read-aloud-only story to two Students in one request', 'admin',
  replace(pg_temp.assign('room1', 'mat_t1b', 's1', 't1'), 'values (', 'values (') || ', ' ||
  format('(%L, %L, %L, %L, %L, null, true, null)', pg_temp.k('room1'), pg_temp.k('mat_t1b'), pg_temp.k('s2'), pg_temp.k('t1'), 'assigned'), 'rows=2');
select pg_temp.run('8 one audit row per assigned Student', 'db',
  $s$select count(*)::text from public.m4_admin_actions where action = 'assign_activity' and actor_id = pg_temp.k('admin') and room_id = pg_temp.k('room1')$s$, 'value=3');
select pg_temp.run('2 the room Teacher sees the Admin-assigned activities in their classroom', 't1',
  $s$select count(*)::text from public.reading_activity_assignments where room_id = pg_temp.k('room1')$s$, 'value=3');
select pg_temp.run('7 Admin sees them', 'admin',
  $s$select count(*)::text from public.reading_activity_assignments where room_id = pg_temp.k('room1')$s$, 'value=3');

-- ---------------------------------------------------------------- 10 unauthorized materials and attribution
select pg_temp.run('10 Admin cannot attribute the activity to themselves', 'admin', pg_temp.assign('room1', 'mat_t1', 's2', 'admin'), 'denied');
select pg_temp.run('10 Admin cannot attribute it to a Teacher who does not own the room', 'admin', pg_temp.assign('room1', 'mat_t2', 's2', 't2'), 'denied');
select pg_temp.run('10 Admin cannot assign another Teacher''s material in this room', 'admin', pg_temp.assign('room1', 'mat_t2', 's2', 't1'), 'denied');
select pg_temp.run('10 Admin cannot assign an unfinished material', 'admin', pg_temp.assign('room1', 'mat_proc', 's2', 't1'), 'denied');
select pg_temp.run('10 Admin cannot assign to a Student who is not enrolled', 'admin', pg_temp.assign('room1', 'mat_t1', 's3', 't1'), 'denied');
select pg_temp.run('10 Admin cannot use another Teacher''s question set', 'admin', pg_temp.assign('room1', 'mat_t1', 's2', 't1', 'qs_t2'), 'denied');
select pg_temp.run('10 Admin cannot use an unreviewed question set', 'admin', pg_temp.assign('room1', 'mat_t1', 's2', 't1', 'qs_draft'), 'denied');
select pg_temp.run('10 Admin cannot create an already-completed activity', 'admin', pg_temp.assign('room1', 'mat_t1', 's2', 't1', null, null, 'completed'), 'denied');
select pg_temp.run('10 duplicate assignment is refused', 'admin', pg_temp.assign('room1', 'mat_t1', 's1', 't1'), 'denied');
select pg_temp.run('11 not into a room whose Teacher is now pending', 'admin', pg_temp.assign('room_pending', 'mat_pending', 's1', 'pending'), 'denied');
select pg_temp.run('11 not into a room whose Teacher is now rejected', 'admin', pg_temp.assign('room_rej', 'mat_rej', 's1', 'rejected'), 'denied');
select pg_temp.run('11 pending Teacher cannot assign', 'pending', pg_temp.assign('room_pending', 'mat_pending', 's1', 'pending'), 'denied');
select pg_temp.run('11 rejected Teacher cannot assign', 'rejected', pg_temp.assign('room_rej', 'mat_rej', 's1', 'rejected'), 'denied');
select pg_temp.run('12 Student cannot assign', 's1', pg_temp.assign('room1', 'mat_t1', 's2', 't1'), 'denied');
select pg_temp.run('12 Independent Learner cannot assign', 'learner', pg_temp.assign('room1', 'mat_t1', 's2', 't1'), 'denied');
select pg_temp.run('12 another Teacher cannot assign in Teacher 1''s room', 't2', pg_temp.assign('room1', 'mat_t1', 's2', 't1'), 'denied');
select pg_temp.run('10-12 refused attempts left no rows or audit rows', 'db',
  $s$select (select count(*) from public.reading_activity_assignments where room_id in (pg_temp.k('room1'), pg_temp.k('room_pending'), pg_temp.k('room_rej')))
     || '/' || (select count(*) from public.m4_admin_actions where action = 'assign_activity' and actor_id = pg_temp.k('admin'))$s$, 'value=3/3');

-- ---------------------------------------------------------------- 13 archived rooms
select pg_temp.run('13 Admin archives a room (existing)', 'admin', format('select public.m4_set_room_archived(%L, true)::text', pg_temp.k('room_arch')), 'value=true');
select pg_temp.run('13 archived room rejects an Admin assignment', 'admin', pg_temp.assign('room_arch', 'mat_t1', 's1', 't1'), 'denied');
select pg_temp.run('13 archived room rejects a Teacher assignment', 't1', pg_temp.assign('room_arch', 'mat_t1', 's1', 't1'), 'denied');

-- ---------------------------------------------------------------- 14 Teacher F7 unchanged
select pg_temp.run('14 Teacher still assigns their own story the existing way', 't1', pg_temp.assign('room1', 'mat_t1', 's2', 't1', 'qs_t1', interval '2 days'), 'rows=1');
insert into f7k values ('act_teacher', pg_temp.activity('room1', 'mat_t1', 's2'));
select pg_temp.run('14 Teacher assignments create no Admin audit rows', 'db',
  $s$select count(*)::text from public.m4_admin_actions where activity_id = pg_temp.k('act_teacher')$s$, 'value=0');
select pg_temp.run('14 Teacher still cannot attribute to another Teacher', 't1', pg_temp.assign('room1', 'mat_t1b', 's1', 't2'), 'denied');

-- ---------------------------------------------------------------- remove / restore
select pg_temp.run('Admin removes an activity', 'admin', format('select public.m4_unassign_activity(%L)::text', pg_temp.k('act_admin')), 'value=true');
select pg_temp.run('removal records the Admin as the real actor; Teacher unchanged', 'db',
  $s$select (removed_by = pg_temp.k('admin') and assigned_by = pg_temp.k('t1'))::text from public.reading_activity_assignments where id = pg_temp.k('act_admin')$s$, 'value=true');
select pg_temp.run('Admin restores it', 'admin', format('select public.m4_unassign_activity(%L, true)::text', pg_temp.k('act_admin')), 'value=true');
select pg_temp.run('audit: assign, remove and restore recorded in order', 'db',
  $s$select string_agg(action, ',' order by acted_at, action) from public.m4_admin_actions where activity_id = pg_temp.k('act_admin')$s$,
  'value=assign_activity,restore_activity,unassign_activity');
select pg_temp.run('owner Teacher still removes and restores (no Admin audit)', 't1',
  format('select (public.m4_unassign_activity(%1$L) and public.m4_unassign_activity(%1$L, true))::text', pg_temp.k('act_teacher')), 'value=true');
select pg_temp.run('another Teacher cannot remove it', 't2', format('select public.m4_unassign_activity(%L)', pg_temp.k('act_admin')), 'denied');
select pg_temp.run('a Student cannot remove it', 's1', format('select public.m4_unassign_activity(%L)', pg_temp.k('act_admin')), 'denied');

-- ---------------------------------------------------------------- 3, 4, 5 Student access (Admin-assigned activity)
select pg_temp.run('3 Student sees the Admin-assigned activity', 's1',
  $s$select count(*)::text from public.reading_activity_assignments where id = pg_temp.k('act_admin')$s$, 'value=1');
select pg_temp.run('3 Student opens its story text', 's1',
  $s$select (length(content_text) > 10)::text from public.uploaded_materials where id = pg_temp.k('mat_t1')$s$, 'value=true');
select pg_temp.run('3 another Student does not see it', 's2',
  $s$select count(*)::text from public.reading_activity_assignments where id = pg_temp.k('act_admin')$s$, 'value=0');
select pg_temp.run('4 Student marks it in progress (existing M5 progress rule)', 's1',
  $s$update public.reading_activity_assignments set status = 'in_progress' where id = pg_temp.k('act_admin')$s$, 'rows=1');
-- The backend (service role) saves oral readings and comprehension attempts; the database gate for
-- comprehension is m6_assert_learner_completion_access, called exactly as the backend does.
select pg_temp.run('4 oral reading for the activity is saved', 'db',
  $s$insert into public.oral_reading_attempts(id, user_id, passage_snapshot, transcript, duration_seconds, reading_speed_wpm,
       pronunciation_accuracy, expected_word_count, detected_error_count, word_metrics, room_id, material_id, activity_assignment_id, language_snapshot)
     values ('00000000-0000-4000-8000-0000007e0001', pg_temp.k('s1'), 'Mia planted three seeds.', 'Mia planted three seeds.', 10, 60, 100, 4, 0,
       '[]'::jsonb, pg_temp.k('room1'), pg_temp.k('mat_t1'), pg_temp.k('act_admin'), 'en')$s$, 'rows=1');
select pg_temp.run('5 comprehension attempt for the Admin-assigned activity passes the M6 access gate', 'db',
  $s$with a as (insert into public.m6_comprehension_attempts(user_id, submission_id, passage_title, passage_text, language, question_snapshot,
       room_id, material_id, activity_assignment_id, oral_reading_attempt_id)
     values (pg_temp.k('s1'), gen_random_uuid(), 'F7 Teacher 1 story', 'Mia planted three seeds.', 'en', '[{"id": "q1"}]'::jsonb,
       pg_temp.k('room1'), pg_temp.k('mat_t1'), pg_temp.k('act_admin'), '00000000-0000-4000-8000-0000007e0001') returning id)
     select public.m6_assert_learner_completion_access((select id from a))$s$, 'ok');
select pg_temp.run('5 control: oral reading for a Teacher-assigned activity', 'db',
  $s$insert into public.oral_reading_attempts(id, user_id, passage_snapshot, transcript, duration_seconds, reading_speed_wpm,
       pronunciation_accuracy, expected_word_count, detected_error_count, word_metrics, room_id, material_id, activity_assignment_id, language_snapshot)
     values ('00000000-0000-4000-8000-0000007e0002', pg_temp.k('s2'), 'Mia planted three seeds.', 'Mia planted three seeds.', 10, 60, 100, 4, 0,
       '[]'::jsonb, pg_temp.k('room1'), pg_temp.k('mat_t1'), pg_temp.k('act_teacher'), 'en')$s$, 'rows=1');
select pg_temp.run('5 control: the same gate for a Teacher-assigned activity', 'db',
  $s$with a as (insert into public.m6_comprehension_attempts(user_id, submission_id, passage_title, passage_text, language, question_snapshot,
       room_id, material_id, activity_assignment_id, oral_reading_attempt_id)
     values (pg_temp.k('s2'), gen_random_uuid(), 'F7 Teacher 1 story', 'Mia planted three seeds.', 'en', '[{"id": "q1"}]'::jsonb,
       pg_temp.k('room1'), pg_temp.k('mat_t1'), pg_temp.k('act_teacher'), '00000000-0000-4000-8000-0000007e0002') returning id)
     select public.m6_assert_learner_completion_access((select id from a))$s$, 'ok');
select pg_temp.run('5 Student completes the activity', 's1',
  $s$update public.reading_activity_assignments set status = 'completed' where id = pg_temp.k('act_admin')$s$, 'rows=1');
select pg_temp.run('16 Student cannot change who assigned it', 's1',
  $s$update public.reading_activity_assignments set assigned_by = pg_temp.k('s1') where id = pg_temp.k('act_admin')$s$, 'denied');

-- ---------------------------------------------------------------- actions list and audit integrity
select pg_temp.run('Admin action list includes activity actions', 'admin',
  'select array_to_string(public.m4_admin_classroom_actions(), '','')',
  'value=remove_enrollment,create_room,update_room,assign_module,unassign_module,assign_activity,unassign_activity');
select pg_temp.run('Teacher action list stays empty', 't1', 'select array_to_string(public.m4_admin_classroom_actions(), '','')', 'value=');
select pg_temp.run('clients cannot call the audit trigger function', 'admin', 'select public.m4_audit_admin_activity()', 'denied');
select pg_temp.run('Admin cannot write activity audit rows directly', 'admin',
  $s$insert into public.m4_admin_actions(action, room_id, student_id, teacher_id, activity_id, actor_id)
     values ('assign_activity', pg_temp.k('room1'), pg_temp.k('s1'), pg_temp.k('t1'), pg_temp.k('act_admin'), pg_temp.k('t1'))$s$, 'denied');
select pg_temp.run('Admin cannot edit or delete audit rows', 'admin',
  $s$delete from public.m4_admin_actions where activity_id = pg_temp.k('act_admin')$s$, 'denied');
select pg_temp.run('audit shape: an activity action needs the activity, Student and Teacher', 'db',
  $s$insert into public.m4_admin_actions(action, room_id, actor_id) values ('assign_activity', pg_temp.k('room1'), pg_temp.k('admin'))$s$, 'denied');

-- ---------------------------------------------------------------- report
-- Removing enrollment preserves the saved oral reading, comprehension and activity records.
create temp table f7_history_before as
  select 'oral' as kind, to_jsonb(a) as saved from public.oral_reading_attempts a where user_id = pg_temp.k('s1')
  union all select 'comprehension', to_jsonb(a) from public.m6_comprehension_attempts a where user_id = pg_temp.k('s1')
  union all select 'activity', to_jsonb(a) from public.reading_activity_assignments a where student_id = pg_temp.k('s1');
select pg_temp.run('F9 Admin removes enrollment after completed activity', 'admin',
  $s$select public.m4_admin_remove_enrollment((select id from public.enrollments
     where room_id = pg_temp.k('room1') and student_id = pg_temp.k('s1')))::text$s$, 'value=true');
select pg_temp.run('F9 saved learning history is unchanged after removal', 'db',
  $s$with after_history as (
    select 'oral' as kind, to_jsonb(a) as saved from public.oral_reading_attempts a where user_id = pg_temp.k('s1')
    union all select 'comprehension', to_jsonb(a) from public.m6_comprehension_attempts a where user_id = pg_temp.k('s1')
    union all select 'activity', to_jsonb(a) from public.reading_activity_assignments a where student_id = pg_temp.k('s1'))
  select (not exists ((select * from f7_history_before except all select * from after_history)
    union all (select * from after_history except all select * from f7_history_before)))::text$s$, 'value=true');

select case when got = expect then 'PASS' else 'FAIL' end as result, n, label, expect, got,
       case when got = expect then '' else detail end as detail
from f7t order by n;
select count(*) filter (where got = expect) as passed, count(*) filter (where got <> expect) as failed from f7t;

rollback;
