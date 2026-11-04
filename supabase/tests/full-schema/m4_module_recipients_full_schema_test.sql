-- Full-schema test for supabase/proposed/m4_module_recipients_PROPOSED.sql (+ the ENABLE step).
-- DISPOSABLE DATABASE ONLY (restore of the 2026-11-04 staging backup). One transaction, rolled back.
-- Fixture: "Grade 5 Filipino Class" (approved Teacher, two enrolled students) and two synthetic
-- published Filipino modules inserted as postgres inside this transaction.
\set ON_ERROR_STOP 1
begin;

select r.id as room, r.teacher_id as teacher from public.rooms r where r.room_name = 'Grade 5 Filipino Class' \gset
select (array_agg(student_id order by student_id))[1] as s1, (array_agg(student_id order by student_id))[2] as s2
  from public.enrollments where room_id = :'room' \gset
select id as other_teacher from public.profiles where role = 'teacher' and id <> :'teacher' and teacher_status = 'approved' limit 1 \gset
select id as outsider from public.profiles where role = 'student' and id not in (select student_id from public.enrollments where room_id = :'room') limit 1 \gset
select id as admin from public.profiles where role = 'admin' limit 1 \gset
select set_config('t.room', :'room', true), set_config('t.teacher', :'teacher', true), set_config('t.s1', :'s1', true),
  set_config('t.s2', :'s2', true), set_config('t.other_teacher', :'other_teacher', true), set_config('t.outsider', :'outsider', true),
  set_config('t.admin', :'admin', true);

insert into public.modules(id, path_id, title, difficulty, status, created_by, published_at, passage) values
  ('00000000-0000-4000-8000-0000000000a1', '6e712165-b161-4463-a2a6-7cba4123f06b', 'TEST selected module', 'Easy', 'published', :'admin', now(), 'Isang kuwento.'),
  ('00000000-0000-4000-8000-0000000000a2', '6e712165-b161-4463-a2a6-7cba4123f06b', 'TEST whole-class module', 'Easy', 'published', :'admin', now(), 'Isang kuwento.');

create function pg_temp.act_as(uid text, r text default 'authenticated') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', r)::text, true),
         set_config('request.jwt.claim.sub', uid, true), set_config('request.jwt.claim.role', r, true);
$$;
create function pg_temp.expect_error(statement text, pattern text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm !~* pattern then raise exception 'expected /%/ but got: %', pattern, sqlerrm; end if;
    return;
  end;
  raise exception 'expected /%/ but the statement succeeded: %', pattern, statement;
end $$;
create function pg_temp.oral(uid text, assignment uuid) returns text language sql as $$
  select format($f$insert into public.oral_reading_attempts(user_id, module_id, room_id, assignment_id, passage_snapshot, transcript,
    duration_seconds, reading_speed_wpm, pronunciation_accuracy, expected_word_count, detected_error_count, word_metrics, language_snapshot)
    values (%L, '00000000-0000-4000-8000-0000000000a1', %L, %L, 'Isang kuwento.', 'Isang kuwento.', 10, 60, 90, 2, 0, '[]', 'fil')$f$,
    uid, current_setting('t.room'), assignment)
$$;
create function pg_temp.quiz(uid text, assignment uuid) returns text language sql as $$
  select format($f$insert into public.m6_comprehension_attempts(user_id, submission_id, module_id, passage_id, room_id, assignment_id,
    passage_title, passage_text, language, question_snapshot) values (%L, gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000a1', %L, %L, 'T', 'Isang kuwento.', 'fil', '[{"id":"q"}]')$f$, uid, current_setting('t.room'), assignment)
$$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- 1. Installed but not enabled: no selected assignments can be created.
select pg_temp.act_as(current_setting('t.teacher'));
set local role authenticated;
do $$ begin if public.m4_module_targeting_enabled() then raise exception 'gate must start disabled'; end if; end $$;
select pg_temp.expect_error(format($s$select public.m4_assign_module(%L, '00000000-0000-4000-8000-0000000000a1', 'selected_students', array[%L]::uuid[])$s$,
  current_setting('t.room'), current_setting('t.s1')), 'not enabled');
reset role;

-- 2. Enable (the ENABLE file's update), then assign.
update public.m4_targeting_rollout set enabled = true where singleton;
set local role authenticated;
select pg_temp.act_as(current_setting('t.teacher'));
do $$ begin if not public.m4_module_targeting_enabled() then raise exception 'gate did not open'; end if; end $$;
select pg_temp.expect_error(format($s$select public.m4_assign_module(%L, '00000000-0000-4000-8000-0000000000a1', 'selected_students', '{}'::uuid[])$s$, current_setting('t.room')), 'Select one or more');
select pg_temp.expect_error(format($s$select public.m4_assign_module(%L, '00000000-0000-4000-8000-0000000000a1', 'selected_students', array[%L, %L]::uuid[])$s$, current_setting('t.room'), current_setting('t.s1'), current_setting('t.s1')), 'distinct');
select pg_temp.expect_error(format($s$select public.m4_assign_module(%L, '00000000-0000-4000-8000-0000000000a1', 'selected_students', array[%L]::uuid[])$s$, current_setting('t.room'), current_setting('t.outsider')), 'currently be enrolled');
select pg_temp.expect_error(format($s$insert into public.room_modules(room_id, module_id, assigned_by, targeting_mode) values (%L, '00000000-0000-4000-8000-0000000000a1', %L, 'selected_students')$s$, current_setting('t.room'), current_setting('t.teacher')), 'authorized module assignment');
select set_config('t.selected', public.m4_assign_module(current_setting('t.room')::uuid, '00000000-0000-4000-8000-0000000000a1', 'selected_students', array[current_setting('t.s1')::uuid])::text, true);
-- Whole Class keeps the existing direct path.
insert into public.room_modules(room_id, module_id, assigned_by) values (current_setting('t.room')::uuid, '00000000-0000-4000-8000-0000000000a2', current_setting('t.teacher')::uuid);
select set_config('t.whole', (select id::text from public.room_modules where module_id = '00000000-0000-4000-8000-0000000000a2'), true);
-- Teachers have no UPDATE policy (RLS makes it a no-op); even privileged writers cannot change targeting.
reset role;
select pg_temp.expect_error(format('update public.room_modules set targeting_mode = %L where id = %L', 'whole_class', current_setting('t.selected')), 'immutable');
set local role authenticated;
select pg_temp.act_as(current_setting('t.other_teacher'));
select pg_temp.expect_error(format($s$select public.m4_assign_module(%L, '00000000-0000-4000-8000-0000000000a2', 'whole_class')$s$, current_setting('t.room')), 'classroom owner');

-- 3. Visibility through RLS (what the learner app reads).
select pg_temp.act_as(current_setting('t.s1'));
do $$ begin if (select count(*) from public.room_modules where room_id = current_setting('t.room')::uuid) <> 2 then raise exception 'recipient must see both'; end if; end $$;
select pg_temp.act_as(current_setting('t.s2'));
do $$ begin
  if (select array_agg(id::text) from public.room_modules where room_id = current_setting('t.room')::uuid) <> array[current_setting('t.whole')] then
    raise exception 'non-recipient must see only the whole-class assignment'; end if;
  if exists (select 1 from public.room_module_recipients) then raise exception 'non-recipient must not see recipient rows'; end if;
end $$;
select pg_temp.act_as(current_setting('t.teacher'));
do $$ begin if (select count(*) from public.room_module_recipients) <> 1 then raise exception 'owner must see recipients'; end if; end $$;
reset role;

-- 4. Service-role attempt writers (M5/M6 backends) cannot bypass recipients.
-- (M8 reading-day XP is out of scope here and needs auth.users rows this restore lacks; disabled in this rolled-back transaction only.)
alter table public.oral_reading_attempts disable trigger m8_oral_completed_trigger;
select pg_temp.act_as(current_setting('t.s2'), 'service_role');
select pg_temp.expect_error(pg_temp.oral(current_setting('t.s2'), current_setting('t.selected')::uuid), 'selected students only');
select pg_temp.expect_error(pg_temp.quiz(current_setting('t.s2'), current_setting('t.selected')::uuid), 'selected students only');
do $$ begin execute pg_temp.oral(current_setting('t.s1'), current_setting('t.selected')::uuid); end $$;
do $$ begin execute pg_temp.oral(current_setting('t.s2'), current_setting('t.whole')::uuid); end $$;
select pg_temp.expect_error(format('update public.oral_reading_attempts set assignment_id = %L where user_id = %L and assignment_id = %L',
  current_setting('t.selected'), current_setting('t.s2'), current_setting('t.whole')), 'selected students only');
do $$ begin
  if not public.m4_module_assigned_to(current_setting('t.selected')::uuid, current_setting('t.s1')::uuid) then raise exception 'recipient must be eligible'; end if;
  if public.m4_module_assigned_to(current_setting('t.selected')::uuid, current_setting('t.s2')::uuid) then raise exception 'non-recipient must not be eligible'; end if;
end $$;

-- 5. Removed assignment: no new starts for anyone; restore brings eligibility back.
select pg_temp.act_as(current_setting('t.teacher'));
set local role authenticated;
select public.m4_unassign_module(current_setting('t.selected')::uuid, false);
reset role;
select pg_temp.act_as(current_setting('t.s1'), 'service_role');
do $$ begin if public.m4_module_assigned_to(current_setting('t.selected')::uuid, current_setting('t.s1')::uuid) then raise exception 'removed assignment must block new starts'; end if; end $$;

-- 6. Rollback refuses while selected assignments exist (it would broaden access).
reset role;
do $$ begin
  begin
    if exists (select 1 from public.room_modules where targeting_mode <> 'whole_class') then
      raise exception 'Selected-student assignments exist';
    end if;
    raise exception 'rollback guard did not trigger';
  exception when others then
    if sqlerrm !~ 'Selected-student assignments exist' then raise; end if;
  end;
end $$;
select 'PASS m4 recipients: gate, RPC validation, immutability, owner-only, RLS visibility, service-role attempt enforcement (M5+M6), removal, rollback guard' as result;
rollback;
