-- PROPOSED - NOT APPLIED - rollback for m6_admin_practice_PROPOSED.sql
-- Restores the learner-only completion check and the original M8/M7 trigger functions.
-- DDL only. Admin attempts completed while the feature was on stay as saved (they earned
-- no XP); after rollback an Admin can no longer complete an attempt.

begin;

do $$
declare
  expected constant text[][] := array[
    -- Fingerprints of the applied state (pg_get_functiondef, CR removed), from the PGlite replay
    -- of m6_admin_practice_PROPOSED.sql on PostgreSQL 17. Any other state stops the rollback.
    array['public.m6_assert_completion_access(uuid)', '4f5aeddcb911fb2433d4f9f97c804b2b'],
    array['public.m6_assert_learner_completion_access(uuid)', '795969b21c895ea830aba4a6bbcf035c'],
    array['public.m8_on_comprehension_completed()', 'a31be79ffcd4e76ea3396a808f4cbd3a'],
    array['public.m7_enqueue_completion()', 'e4a3dd2f01bd80db6ba590659068a92e']];
  i int;
begin
  if to_regprocedure('public.m6_assert_learner_completion_access(uuid)') is null then
    raise exception 'Stop: m6_assert_learner_completion_access(uuid) is missing (not applied?).';
  end if;
  for i in 1 .. array_length(expected, 1) loop
    if md5(replace(pg_get_functiondef(to_regprocedure(expected[i][1])), chr(13), '')) is distinct from expected[i][2] then
      raise exception 'Stop: % differs from the applied Admin-practice definition.', expected[i][1];
    end if;
  end loop;
end $$;

drop function public.m6_assert_completion_access(uuid);
alter function public.m6_assert_learner_completion_access(uuid) rename to m6_assert_completion_access;
revoke all on function public.m6_assert_completion_access(uuid) from public, anon, authenticated;

-- Original body from 20261026_m8_trusted_xp.sql.
create or replace function public.m8_on_comprehension_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier integer;
  v_allowed integer;
  v_granted boolean := false;
begin
  if new.status <> 'completed' or new.completed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;
  perform public.m6_assert_completion_access(new.id);

  if new.activity_assignment_id is not null then
    v_granted := public.m8_grant_xp(new.user_id, 'assignment', new.activity_assignment_id, 60);
  else
    select case lower(m.difficulty) when 'easy' then 1 when 'medium' then 2 when 'hard' then 3 else 0 end
      into v_tier from public.modules m where m.id = new.module_id;
    if v_tier is null or v_tier = 0 then raise exception 'Unknown module difficulty'; end if;
    if new.room_id is not null then
      v_allowed := v_tier;
    else
      v_allowed := case public.m2_trusted_reading_level(new.user_id, new.language)
        when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end;
      if v_allowed is null then return new; end if;
    end if;
    v_granted := public.m8_grant_xp(new.user_id, 'module', new.module_id,
      case least(v_tier, v_allowed) when 1 then 30 when 2 then 50 else 80 end);
  end if;

  -- Only new verified XP records a reading day; duplicates never farm streaks.
  if v_granted then
    perform public.m8_record_reading_day(new.user_id, (new.completed_at at time zone 'Asia/Manila')::date);
  end if;
  return new;
end $$;
revoke all on function public.m8_on_comprehension_completed() from public, anon, authenticated;

-- Original body from 20261024_m7_analytics.sql.
-- Body copied verbatim so its md5 matches the preflight capture again.
CREATE OR REPLACE FUNCTION public.m7_enqueue_completion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    INSERT INTO public.m7_risk_queue(id) VALUES (NEW.user_id)
    ON CONFLICT(id) DO UPDATE SET generation = nextval('public.m7_risk_generation'), updated_at = now();
  END IF;
  RETURN NEW;
END; $$;
revoke all on function public.m7_enqueue_completion() from public, anon, authenticated;

-- Postcondition: the three functions are byte-identical to the live definitions read from
-- ReadFlow-Staging before the migration (2026-11-05); otherwise everything rolls back.
do $$
declare
  expected constant text[][] := array[
    array['public.m6_assert_completion_access(uuid)', '91606e8441adbf5aa18e8d9d8c6e6171'],
    array['public.m8_on_comprehension_completed()', '315d8d440b617e93281fd5a35cb623ed'],
    array['public.m7_enqueue_completion()', 'f5274f2a411092aea73d88fe1b093d68']];
  i int;
begin
  for i in 1 .. array_length(expected, 1) loop
    if md5(replace(pg_get_functiondef(to_regprocedure(expected[i][1])), chr(13), '')) is distinct from expected[i][2] then
      raise exception 'Postcondition: % was not restored exactly.', expected[i][1];
    end if;
  end loop;
  if to_regprocedure('public.m6_assert_learner_completion_access(uuid)') is not null then
    raise exception 'Postcondition: m6_assert_learner_completion_access still exists.';
  end if;
end $$;

commit;
