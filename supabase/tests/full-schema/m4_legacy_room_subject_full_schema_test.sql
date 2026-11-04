-- Full-schema test for supabase/proposed/m4_legacy_room_subject_PROPOSED.sql.
-- DISPOSABLE DATABASE ONLY (a local restore of the 2026-11-04 staging backup). Never run against staging.
-- Run AFTER the proposal is applied. One transaction, rolled back at the end.
-- Fixture rooms (from the backup): "English Reading Room" (legacy, English + Filipino activities) and
-- "Grade 5 Filipino Class" (legacy, Filipino activities only).
\set ON_ERROR_STOP 1
begin;

select id as mixed_room, teacher_id as mixed_owner from public.rooms where room_name = 'English Reading Room' and subject is null \gset
select id as fil_room, teacher_id as fil_owner from public.rooms where room_name = 'Grade 5 Filipino Class' and subject is null \gset
select id as admin_id from public.profiles where role = 'admin' limit 1 \gset
select student_id as student_id from public.enrollments where room_id = :'fil_room' limit 1 \gset
select set_config('t.mixed_room', :'mixed_room', true), set_config('t.mixed_owner', :'mixed_owner', true),
       set_config('t.fil_room', :'fil_room', true), set_config('t.fil_owner', :'fil_owner', true),
       set_config('t.admin', :'admin_id', true), set_config('t.student', :'student_id', true);

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
-- Everything except rooms and the new audit table, to prove a conversion writes nothing else.
create function pg_temp.others_digest() returns text language sql as $$
  select md5(string_agg(t || ':' || (xpath('/row/c/text()', query_to_xml(format(
    'select coalesce(md5(string_agg(x::text, ''|'' order by x::text)), ''-'') as c from public.%I x', t), false, true, '')))[1]::text, ','))
  from unnest(array['room_modules','reading_activity_assignments','enrollments','modules','learning_paths','uploaded_materials',
    'm6_comprehension_attempts','m6_comprehension_responses','oral_reading_attempts','m7_risk_queue','m8_xp_events',
    'm8_learner_progress','m8_reading_days','m8_earned_badges','progress','profiles']) t
$$;
grant execute on all functions in schema pg_temp to authenticated;
select set_config('t.digest', pg_temp.others_digest(), true);

set local role authenticated;

-- Options: owners see what is allowed; Admin is view-only; others are refused.
select pg_temp.act_as(current_setting('t.fil_owner'));
do $$ declare o jsonb := public.m4_legacy_room_subject_options(current_setting('t.fil_room')::uuid); begin
  if o->'choices' <> '["fil"]' or (o->>'canSet')::boolean is not true or o->'contentLanguages' <> '["fil"]' then
    raise exception 'Filipino-only legacy room options wrong: %', o; end if; end $$;
select pg_temp.act_as(current_setting('t.mixed_owner'));
do $$ declare o jsonb := public.m4_legacy_room_subject_options(current_setting('t.mixed_room')::uuid); begin
  if o->'choices' <> '[]' or (o->>'canSet')::boolean or o->'contentLanguages' <> '["en", "fil"]' then
    raise exception 'mixed legacy room options wrong: %', o; end if; end $$;
select pg_temp.act_as(current_setting('t.admin'));
do $$ declare o jsonb := public.m4_legacy_room_subject_options(current_setting('t.fil_room')::uuid); begin
  if (o->>'canSet')::boolean then raise exception 'Admin must be view-only: %', o; end if; end $$;
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.fil_room'), 'fil'), 'approved Teacher');
select pg_temp.act_as(current_setting('t.mixed_owner'));
select pg_temp.expect_error(format('select public.m4_legacy_room_subject_options(%L)', current_setting('t.fil_room')), 'Room access');
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.fil_room'), 'fil'), 'approved Teacher');
select pg_temp.act_as(current_setting('t.student'));
select pg_temp.expect_error(format('select public.m4_legacy_room_subject_options(%L)', current_setting('t.fil_room')), 'Room access');
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.fil_room'), 'fil'), 'approved Teacher');

-- A mixed room is never converted, to either language; direct updates stay blocked.
select pg_temp.act_as(current_setting('t.mixed_owner'));
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.mixed_room'), 'en'), 'both English and Filipino');
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.mixed_room'), 'fil'), 'both English and Filipino');
select pg_temp.expect_error(format('update public.rooms set subject = %L where id = %L', 'en', current_setting('t.mixed_room')), 'cannot be changed');

-- The Filipino-only room: wrong language and bad values refused, Filipino accepted once.
select pg_temp.act_as(current_setting('t.fil_owner'));
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.fil_room'), 'en'), 'another language');
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.fil_room'), 'Filipino'), 'Select English or Filipino');
select pg_temp.expect_error(format('update public.rooms set subject = %L where id = %L', 'fil', current_setting('t.fil_room')), 'cannot be changed');
select public.m4_set_legacy_room_subject(current_setting('t.fil_room')::uuid, 'fil');
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.fil_room'), 'fil'), 'already has a saved subject');
select pg_temp.expect_error(format('update public.rooms set subject = %L where id = %L', 'en', current_setting('t.fil_room')), 'cannot be changed');
do $$ begin
  if (select subject from public.rooms where id = current_setting('t.fil_room')::uuid) <> 'fil' then raise exception 'subject not saved'; end if;
  if (select (subject, converted_by, activity_assignments)::text from public.m4_room_subject_conversions where room_id = current_setting('t.fil_room')::uuid)
     <> (select format('(fil,%s,2)', current_setting('t.fil_owner'))) then raise exception 'audit row wrong'; end if;
  if (select subject from public.rooms where id = current_setting('t.mixed_room')::uuid) is not null then raise exception 'mixed room changed'; end if;
end $$;
reset role;
do $$ begin
  if pg_temp.others_digest() <> current_setting('t.digest') then raise exception 'conversion changed assignments, history, analytics or XP'; end if;
end $$;

-- After conversion the room behaves like a new Filipino room.
select pg_temp.expect_error(format(
  'insert into public.reading_activity_assignments(room_id, material_id, student_id, assigned_by) values (%L, %L, %L, %L)',
  current_setting('t.fil_room'), (select id from public.uploaded_materials where language = 'en' limit 1), current_setting('t.student'), current_setting('t.fil_owner')),
  'must match the saved room subject');
select pg_temp.expect_error(format('update public.uploaded_materials set language = %L where id = %L', 'en',
  (select material_id from public.reading_activity_assignments where room_id = current_setting('t.fil_room')::uuid limit 1)), 'different subject');

-- An unapproved Teacher cannot convert even their own room.
update public.profiles set teacher_status = 'pending' where id = current_setting('t.mixed_owner')::uuid;
set local role authenticated;
select pg_temp.act_as(current_setting('t.mixed_owner'));
select pg_temp.expect_error(format('select public.m4_set_legacy_room_subject(%L, %L)', current_setting('t.mixed_room'), 'en'), 'approved Teacher');
reset role;

-- anon cannot call either RPC.
set local role anon;
select pg_temp.expect_error(format('select public.m4_legacy_room_subject_options(%L)', current_setting('t.fil_room')), 'permission denied');
reset role;
select 'PASS m4: options, owner-only conversion, mixed-room refusal, audit row, no other writes, post-conversion subject enforcement, roles' as result;
rollback;
