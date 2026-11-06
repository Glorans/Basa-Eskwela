-- PROPOSED - NOT APPLIED. Do not run without explicit approval.
-- Rollback of m8_f1_xp_rewards_v1_PROPOSED.sql. Restores the exact previous functions and
-- constraints and drops the new tables.
-- It refuses once any new-rule XP exists: removing those rows would change learners' balances,
-- and the old constraints cannot hold them. After that point the safe fix is a forward migration.
-- Verified readings and receipts hold no XP; they are dropped and the saved readings are unaffected.
-- The three leaderboard functions get their previous definitions but no new grant: replacing a function
-- keeps its permissions, so clients keep whatever access they have now. If M8 F4 closed these functions,
-- which return user IDs, reading levels and nicknames, they stay closed.
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.m8_reward_settings') is null then
    raise exception 'Stop: M8 F1 is not installed; nothing to roll back.';
  end if;
  if exists (select 1 from public.m8_xp_events where source_type in ('passage','module_bonus','daily_login'))
    or exists (select 1 from public.m8_passage_rewards) or exists (select 1 from public.m8_daily_logins) then
    raise exception 'Stop: new-rule XP exists. Rolling back would change learner balances; use a forward migration.';
  end if;
end $$;

drop function public.m5_verify_reading(uuid,uuid,text);
drop function public.m5_record_transcript_receipt(uuid,text,text,uuid,text,uuid);
drop function public.m8_claim_daily_login(uuid);
drop function public.m8_claim_daily_login_at(uuid,timestamptz);

-- From m6_admin_practice_PROPOSED.sql (the applied definition), byte for byte.
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
  -- Admin practice is valid but is not learner progress: no XP, reading day or badge.
  if exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then return new; end if;

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

drop function public.m8_evaluate_rewards(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text);
drop function public.m8_try_module_bonus(uuid,uuid,uuid,uuid);
drop function public.m8_award_passage(uuid,uuid,uuid,uuid,uuid,text);

-- From supabase/staging/c2_m8_gamification_hardened.sql, byte for byte.
create or replace function public.m8_grant_xp(p_user uuid,p_type text,p_source uuid,p_xp integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
 if p_type not in ('module','assignment') or p_xp not in (30,50,60,80) then raise exception 'Invalid XP grant'; end if;
 insert into public.m8_xp_events(user_id,source_type,source_id,xp_earned)
 values(p_user,p_type,p_source,p_xp) on conflict do nothing;
 get diagnostics inserted_count = row_count;
 if inserted_count=0 then return false; end if;
 insert into public.m8_learner_progress(user_id,total_xp,completed_modules)
 values(p_user,p_xp,case when p_type='module' then 1 else 0 end)
 on conflict(user_id) do update set total_xp=public.m8_learner_progress.total_xp+excluded.total_xp,
 completed_modules=public.m8_learner_progress.completed_modules+excluded.completed_modules,updated_at=now();
 if p_type='module' then
  insert into public.m8_earned_badges(user_id,badge_id)
  select p_user,'first_read' on conflict do nothing;
  insert into public.m8_earned_badges(user_id,badge_id)
  select p_user,'bookworm' where (select completed_modules from public.m8_learner_progress where user_id=p_user)>=5
  on conflict do nothing;
 end if;
 insert into public.m8_earned_badges(user_id,badge_id)
 select p_user,'diamond' where (select total_xp from public.m8_learner_progress where user_id=p_user)>=2000
 on conflict do nothing;
 return true;
end $$;
revoke all on function public.m8_grant_xp(uuid,text,uuid,integer) from public,anon,authenticated;

-- From supabase/staging/c3_m8_completion_integration_hardened.sql, byte for byte.
create or replace function public.m8_award_graduate(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from public.modules where status='published')
 and not exists (
   select 1 from public.modules m where m.status='published'
   and not exists(select 1 from public.m8_xp_events x where x.user_id=p_user
      and x.source_type='module' and x.source_id=m.id)
 ) then insert into public.m8_earned_badges(user_id,badge_id)
 values(p_user,'graduate') on conflict do nothing; end if;
end $$;
revoke all on function public.m8_award_graduate(uuid) from public,anon,authenticated;
create or replace function public.m8_on_module_xp_granted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.source_type='module' then perform public.m8_award_graduate(new.user_id); end if;
 return new;
end $$;
revoke all on function public.m8_on_module_xp_granted() from public, anon, authenticated;

-- From readflow/supabase/migrations/20261021000000_m8_classroom_leaderboard.sql, byte for byte.
create or replace function public.m8_weekly_leaderboard()
returns table(user_id uuid, display_name text, xp bigint, difficulty text)
language sql stable security definer set search_path = '' as $$
 with me as (select auth.uid() id),
 classmates as (
   select distinct e2.student_id id
   from public.enrollments e1
   join public.enrollments e2 on e1.room_id=e2.room_id
   join public.rooms r on r.id=e1.room_id
   where e1.student_id=(select id from me)
   -- Only valid classroom members; no all-users ranking.
 ), visible as (
   select id from classmates
   union select id from me where id is not null
 ), weekly as (
   select x.user_id, sum(x.xp_earned)::bigint xp
   from public.m8_xp_events x
   where x.created_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
   group by x.user_id
 )
 select v.id,
   case when v.id=(select id from me) then 'You'
        else 'Reader ' || upper(substr(replace(v.id::text,'-',''),1,6)) end,
   coalesce(w.xp,0), coalesce(p.unlocked_difficulty,'Easy')
 from visible v
 left join weekly w on w.user_id=v.id
 left join public.m8_learner_progress p on p.user_id=v.id
 order by coalesce(w.xp,0) desc, v.id
 limit 100;
$$;
revoke all on function public.m8_weekly_leaderboard() from public, anon;

-- From supabase/proposed/m8_classroom_leaderboard_PROPOSED.sql, byte for byte.
create or replace function public.m8_classroom_leaderboard(p_room_id uuid)
returns table(user_id uuid, display_name text, xp bigint, difficulty text)
language sql stable security definer set search_path = '' as $$
 with me as (select auth.uid() id),
 members as (
   -- Only members of a room the caller is enrolled in; anyone else gets no rows.
   select e.student_id id from public.enrollments e
   where e.room_id = p_room_id
     and exists (select 1 from public.enrollments mine
                 where mine.room_id = p_room_id and mine.student_id = (select id from me))
 ), weekly as (
   select x.user_id, sum(x.xp_earned)::bigint xp
   from public.m8_xp_events x
   where x.created_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
     and x.user_id in (select id from members)
   group by x.user_id
 )
 select m.id,
   case when m.id = (select id from me) then 'You'
        else 'Reader ' || upper(substr(replace(m.id::text, '-', ''), 1, 6)) end,
   coalesce(w.xp, 0), coalesce(p.unlocked_difficulty, 'Easy')
 from members m
 left join weekly w on w.user_id = m.id
 left join public.m8_learner_progress p on p.user_id = m.id
 order by coalesce(w.xp, 0) desc, m.id
 limit 100;
$$;
revoke all on function public.m8_classroom_leaderboard(uuid) from public, anon;

-- From readflow/supabase/migrations/20261023000000_m8_independent_leaderboard.sql, byte for byte.
CREATE OR REPLACE FUNCTION public.m8_independent_leaderboard(p_period text DEFAULT 'weekly')
RETURNS TABLE(user_id uuid, display_name text, xp bigint, difficulty text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='general_user'
 ) THEN RAISE EXCEPTION 'Independent learner access required' USING ERRCODE='42501'; END IF;
 IF p_period NOT IN ('weekly','all_time') THEN RAISE EXCEPTION 'Invalid period'; END IF;
 RETURN QUERY
 WITH scores AS (
  SELECT x.user_id, SUM(x.xp_earned)::bigint AS points
  FROM public.m8_xp_events x
  WHERE p_period='all_time' OR x.created_at >=
   (date_trunc('week', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')
  GROUP BY x.user_id
 )
 SELECT p.id, COALESCE(NULLIF(p.nickname,''), 'Reader ' || LEFT(p.id::text,6))::text,
        COALESCE(s.points,0)::bigint,
        COALESCE(g.unlocked_difficulty,'Easy')::text
 FROM public.profiles p
 LEFT JOIN scores s ON s.user_id=p.id
 LEFT JOIN public.m8_learner_progress g ON g.user_id=p.id
 WHERE p.role='general_user'
 ORDER BY COALESCE(s.points,0) DESC, p.id
 LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.m8_independent_leaderboard(text) FROM PUBLIC, anon;

drop function public.m8_calculate_passage_xp(bigint,bigint,bigint,bigint);
drop function public.m8_same_passage(text,text);
drop function public.m8_activity_language(uuid,uuid);
drop function public.m8_performance_language(text);
drop function public.m8_content_fingerprint(text);
drop function public.m8_normalized_text(text);
drop function public.m8_manila_date(timestamptz);

alter table public.m8_xp_events drop constraint m8_xp_events_source_type_check;
alter table public.m8_xp_events drop constraint m8_xp_events_xp_earned_check;
alter table public.m8_xp_events add constraint m8_xp_events_source_type_check check (source_type in ('module','assignment'));
alter table public.m8_xp_events add constraint m8_xp_events_xp_earned_check check (xp_earned in (30,50,60,80));

drop table public.m8_daily_logins;
drop table public.m8_passage_rewards;
drop table public.m5_verified_readings;
drop table public.m5_transcript_receipts;
drop table public.m8_reward_settings;

notify pgrst, 'reload schema';
commit;
