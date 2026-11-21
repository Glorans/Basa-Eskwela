-- M7 risk-queue tidy-up for staff reading practice. PROPOSED. NOT APPLIED. OPTIONAL; requires explicit approval.
-- public.m7_enqueue_completion() (trigger m7_completed_quiz on m6_comprehension_attempts) queues an M7 risk
-- recalculation for the account that completed a comprehension attempt. It already skips School Admins; Teacher (and,
-- after m5_m6_staff_practice, System Admin) practice still queued a job. Risk is computed for learners only, so these
-- jobs only cost worker time. This migration skips every staff role. Learner behaviour, scores and existing queue
-- rows are unchanged. One function, one condition. Rollback: m7_staff_practice_queue_ROLLBACK_PROPOSED.sql.
begin;
set local lock_timeout = '5s';
do $guard$
begin
  if md5(pg_get_functiondef('public.m7_enqueue_completion()'::regprocedure)) <> '563885607c852a10581f83699c7efd74' then
    raise exception 'STOP: m7_enqueue_completion is not the reviewed definition; re-review before applying';
  end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.m7_enqueue_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.material_id is not null and new.activity_assignment_id is null and new.room_id is null then return new; end if;
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and not exists (select 1 from public.profiles p where p.id = new.user_id and p.role in ('admin', 'system_admin', 'teacher')) then
    insert into public.m7_risk_queue(id) values (new.user_id)
    on conflict(id) do update set generation = nextval('public.m7_risk_generation'), updated_at = now();
  end if;
  return new;
end; $function$;
commit;
