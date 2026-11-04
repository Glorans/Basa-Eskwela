-- Full-schema test for supabase/proposed/m4_room_archive_PROPOSED.sql.
-- DISPOSABLE DATABASE ONLY (restore of the 2026-11-04 staging backup). One transaction, rolled back.
\set ON_ERROR_STOP 1
begin;

select r.id as room, r.teacher_id as teacher, r.room_code as code from public.rooms r where r.room_name = 'Grade 5 Filipino Class' \gset
select (array_agg(student_id order by student_id))[1] as s1 from public.enrollments where room_id = :'room' \gset
select id as other_teacher from public.profiles where role = 'teacher' and id <> :'teacher' and teacher_status = 'approved' limit 1 \gset
select id as outsider from public.profiles where role = 'student' and id not in (select student_id from public.enrollments where room_id = :'room') limit 1 \gset
select id as admin from public.profiles where role = 'admin' limit 1 \gset
select id as material from public.uploaded_materials where uploaded_by = :'teacher' and language = 'fil' limit 1 \gset
select set_config('t.room', :'room', true), set_config('t.teacher', :'teacher', true), set_config('t.code', :'code', true),
  set_config('t.s1', :'s1', true), set_config('t.other_teacher', :'other_teacher', true), set_config('t.outsider', :'outsider', true),
  set_config('t.admin', :'admin', true), set_config('t.material', :'material', true);
insert into public.modules(id, path_id, title, difficulty, status, created_by, published_at, passage) values
  ('00000000-0000-4000-8000-0000000000b1', '6e712165-b161-4463-a2a6-7cba4123f06b', 'TEST archive module', 'Easy', 'published', :'admin', now(), 'Isang kuwento.'),
  ('00000000-0000-4000-8000-0000000000b2', '6e712165-b161-4463-a2a6-7cba4123f06b', 'TEST second module', 'Easy', 'published', :'admin', now(), 'Isang kuwento.');
-- M8 reading-day XP needs auth.users rows this restore lacks; out of scope, disabled in this transaction only.
alter table public.oral_reading_attempts disable trigger m8_oral_completed_trigger;

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', uid, true);
$$;
create function pg_temp.expect_error(statement text, pattern text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm !~* pattern then raise exception 'expected /%/ but got: %', pattern, sqlerrm; end if;
    return;
  end;
  raise exception 'expected /%/ but the statement succeeded: %', pattern, statement;
end $$;
create function pg_temp.oral(uid text) returns text language sql as $$
  select format($f$insert into public.oral_reading_attempts(user_id, module_id, room_id, assignment_id, passage_snapshot, transcript,
    duration_seconds, reading_speed_wpm, pronunciation_accuracy, expected_word_count, detected_error_count, word_metrics, language_snapshot)
    values (%L, '00000000-0000-4000-8000-0000000000b1', %L, (select id from public.room_modules where module_id = '00000000-0000-4000-8000-0000000000b1'),
    'Isang kuwento.', 'Isang kuwento.', 10, 60, 90, 2, 0, '[]', 'fil')$f$, uid, current_setting('t.room'))
$$;
create function pg_temp.quiz(uid text) returns text language sql as $$
  select format($f$insert into public.m6_comprehension_attempts(user_id, submission_id, module_id, passage_id, room_id, assignment_id,
    passage_title, passage_text, language, question_snapshot) values (%L, gen_random_uuid(), '00000000-0000-4000-8000-0000000000b1',
    '00000000-0000-4000-8000-0000000000b1', %L, (select id from public.room_modules where module_id = '00000000-0000-4000-8000-0000000000b1'),
    'T', 'Isang kuwento.', 'fil', '[{"id":"q"}]')$f$, uid, current_setting('t.room'))
$$;
create function pg_temp.counts() returns text language sql as $$
  select format('%s/%s/%s', (select count(*) from public.enrollments where room_id = current_setting('t.room')::uuid),
    (select count(*) from public.reading_activity_assignments where room_id = current_setting('t.room')::uuid),
    (select count(*) from public.m6_comprehension_attempts where room_id = current_setting('t.room')::uuid))
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;
-- A whole-class module assigned before archiving (existing assignment).
insert into public.room_modules(room_id, module_id, assigned_by) values (:'room', '00000000-0000-4000-8000-0000000000b1', :'teacher');
select set_config('t.counts', pg_temp.counts(), true);

-- Archive: owner yes; other Teacher/Student no; direct column edits never.
set local role authenticated;
select pg_temp.act_as(current_setting('t.other_teacher'));
select pg_temp.expect_error(format('select public.m4_set_room_archived(%L, true)', current_setting('t.room')), 'Teacher or an Admin');
select pg_temp.act_as(current_setting('t.s1'));
select pg_temp.expect_error(format('select public.m4_set_room_archived(%L, true)', current_setting('t.room')), 'Teacher or an Admin');
select pg_temp.act_as(current_setting('t.teacher'));
select pg_temp.expect_error(format('update public.rooms set archived_at = now(), archived_by = %L where id = %L', current_setting('t.teacher'), current_setting('t.room')), 'Use Archive or Restore');
do $$ begin
  if not public.m4_set_room_archived(current_setting('t.room')::uuid, true) then raise exception 'archive did not change'; end if;
  if public.m4_set_room_archived(current_setting('t.room')::uuid, true) then raise exception 'second archive must be a no-op'; end if;
  if (select archived_by::text from public.rooms where id = current_setting('t.room')::uuid) <> current_setting('t.teacher') then raise exception 'archived_by'; end if;
end $$;
reset role;
select pg_temp.expect_error(format('update public.rooms set archived_at = null, archived_by = null where id = %L', current_setting('t.room')), 'Use Archive or Restore');

-- While archived: joins, assignments and new attempts are refused for every writer.
set local role authenticated;
select pg_temp.act_as(current_setting('t.outsider'));
select pg_temp.expect_error(format('select public.join_room_by_code(%L)', current_setting('t.code')), 'not accepting new students');
select pg_temp.act_as(current_setting('t.teacher'));
select pg_temp.expect_error(format($s$insert into public.reading_activity_assignments(room_id, material_id, student_id, assigned_by) values (%L, %L, %L, %L)$s$,
  current_setting('t.room'), current_setting('t.material'), current_setting('t.s1'), current_setting('t.teacher')), 'Restore it before assigning activities');
reset role;
select pg_temp.expect_error(format($s$insert into public.room_modules(room_id, module_id, assigned_by) values (%L, %L, %L)$s$,
  current_setting('t.room'), '00000000-0000-4000-8000-0000000000b2', current_setting('t.teacher')), 'Restore it before assigning modules');
select pg_temp.expect_error(pg_temp.oral(current_setting('t.s1')), 'cannot be started');
select pg_temp.expect_error(pg_temp.quiz(current_setting('t.s1')), 'cannot be started');

-- History stays readable: the enrolled student still sees the room and its assignment; nothing changed.
set local role authenticated;
select pg_temp.act_as(current_setting('t.s1'));
do $$ begin
  if not exists (select 1 from public.rooms where id = current_setting('t.room')::uuid and archived_at is not null) then raise exception 'student must still see the archived room'; end if;
  if not exists (select 1 from public.room_modules where room_id = current_setting('t.room')::uuid) then raise exception 'student must still see past assignments'; end if;
end $$;
reset role;
do $$ begin if pg_temp.counts() <> current_setting('t.counts') then raise exception 'archiving changed enrollments, activities or attempts'; end if; end $$;

-- Admin can restore (and archive); after Restore everything works again.
set local role authenticated;
select pg_temp.act_as(current_setting('t.admin'));
do $$ begin if not public.m4_set_room_archived(current_setting('t.room')::uuid, false) then raise exception 'admin restore failed'; end if; end $$;
select pg_temp.act_as(current_setting('t.outsider'));
select public.join_room_by_code(current_setting('t.code'));
reset role;
do $$ begin execute pg_temp.oral(current_setting('t.s1')); end $$;
select pg_temp.act_as(current_setting('t.admin'));
set local role authenticated;
do $$ begin
  perform public.m4_set_room_archived(current_setting('t.room')::uuid, true);
  if (select archived_by::text from public.rooms where id = current_setting('t.room')::uuid) <> current_setting('t.admin') then raise exception 'admin actor not recorded'; end if;
end $$;
set local role anon;
select pg_temp.expect_error(format('select public.m4_set_room_archived(%L, false)', current_setting('t.room')), 'permission denied');
reset role;
do $$ begin
  begin
    if exists (select 1 from public.rooms where archived_at is not null) then raise exception 'Archived learning rooms exist'; end if;
    raise exception 'rollback guard did not trigger';
  exception when others then if sqlerrm !~ 'Archived learning rooms exist' then raise; end if;
  end;
end $$;
select 'PASS m4 archive: owner/Admin only, protected columns, joins/assignments/M5/M6 starts refused while archived, history readable and unchanged, restore reopens, rollback guard' as result;
rollback;
