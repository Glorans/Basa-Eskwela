-- Full-schema test for supabase/proposed/m4_admin_classroom_actions_PROPOSED.sql.
-- DISPOSABLE DATABASE ONLY (restore of the 2026-11-04 staging backup). One transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
select id as admin from public.profiles where role = 'admin' limit 1 \gset
select r.id as room, r.teacher_id as teacher from public.rooms r where r.room_name = 'Grade 5 Filipino Class' \gset
select id as enrollment, student_id as student from public.enrollments where room_id = :'room' order by student_id limit 1 \gset
select set_config('t.admin', :'admin', true), set_config('t.teacher', :'teacher', true), set_config('t.enrollment', :'enrollment', true),
  set_config('t.student', :'student', true), set_config('t.room', :'room', true),
  set_config('t.history', (select count(*)::text from public.m6_comprehension_attempts where user_id = :'student'), true);

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
grant execute on all functions in schema pg_temp to authenticated, anon;

set local role authenticated;
select pg_temp.act_as(current_setting('t.teacher'));
do $$ begin if cardinality(public.m4_admin_classroom_actions()) <> 0 then raise exception 'Teacher must get no Admin actions'; end if; end $$;
select pg_temp.expect_error(format('select public.m4_admin_remove_enrollment(%L)', current_setting('t.enrollment')), 'Admin access');
select pg_temp.act_as(current_setting('t.student'));
select pg_temp.expect_error(format('select public.m4_admin_remove_enrollment(%L)', current_setting('t.enrollment')), 'Admin access');
-- Admins still cannot delete enrollments directly (RLS unchanged).
select pg_temp.act_as(current_setting('t.admin'));
delete from public.enrollments where id = current_setting('t.enrollment')::uuid;
do $$ begin
  if not exists (select 1 from public.enrollments where id = current_setting('t.enrollment')::uuid) then raise exception 'direct Admin delete must stay blocked'; end if;
  if public.m4_admin_classroom_actions() <> array['remove_enrollment'] then raise exception 'Admin action list'; end if;
  if not public.m4_admin_remove_enrollment(current_setting('t.enrollment')::uuid) then raise exception 'Admin removal'; end if;
  if public.m4_admin_remove_enrollment(current_setting('t.enrollment')::uuid) then raise exception 'second removal must report nothing removed'; end if;
  if exists (select 1 from public.enrollments where id = current_setting('t.enrollment')::uuid) then raise exception 'enrollment still present'; end if;
  if (select (action, room_id, student_id, actor_id)::text from public.m4_admin_actions) <>
     format('(remove_enrollment,%s,%s,%s)', current_setting('t.room'), current_setting('t.student'), current_setting('t.admin')) then raise exception 'audit row'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*)::text from public.m6_comprehension_attempts where user_id = current_setting('t.student')::uuid) <> current_setting('t.history') then raise exception 'history changed'; end if;
end $$;
set local role anon;
select pg_temp.expect_error(format('select public.m4_admin_remove_enrollment(%L)', current_setting('t.enrollment')), 'permission denied');
reset role;
select 'PASS m4 admin actions: Admin-only audited removal, no direct Admin delete, Teacher/Student/anon refused, history kept' as result;
rollback;
