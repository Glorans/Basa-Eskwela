-- Rollback for m8_final_corrections_v1_PROPOSED.sql.                                     PROPOSED - NOT APPLIED TO STAGING
-- Restores the exact previous bodies of m8_badge_eligible, m8_my_badges and m8_my_achievements, removes the
-- retired-badge trigger and the m8_badges.retired_at column. Claims, earned badges, XP and achievement claims are
-- not touched. Deploy the previous frontend first (the new one reads the `retired` column).
-- Note: achievement tiers claimed under the 1/2/3 rule stay claimed after a rollback.
BEGIN;
DROP TRIGGER IF EXISTS m8_skip_retired_badge ON public.m8_earned_badges;
DROP FUNCTION IF EXISTS public.m8_skip_retired_badge();
CREATE OR REPLACE FUNCTION public.m8_badge_eligible(p_user uuid, p_badge text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.m8_earned_badges e where e.user_id = p_user and e.badge_id = p_badge)
  or case p_badge
    when 'first_read' then exists (select 1 from public.m8_xp_events x
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module'))
    when 'bookworm' then (select count(*) from public.m8_xp_events x
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module')) >= 5
    when 'diamond' then (select coalesce(sum(x.xp_earned), 0) from public.m8_xp_events x
      where x.user_id = p_user and x.source_type <> 'daily_login') >= 2000
    -- M2 reassessment safety: level_up stays defined by the INITIAL diagnostic (pending adviser decision D2).
    when 'level_up' then exists (select 1 from public.diagnostic_results d where d.user_id = p_user
      and d.assessment_type = 'initial'
      and d.verification_status = 'server_verified' and d.reading_level in ('Independent', 'Instructional'))
    when 'streak_3' then coalesce((select max(n) from (select count(*) n from (
        select r.reading_date - (row_number() over (order by r.reading_date))::int grp
        from public.m8_reading_days r where r.user_id = p_user) d group by grp) runs), 0) >= 3
    when 'consistent_reader' then (select count(*) from public.m8_reading_days r where r.user_id = p_user) >= 7
    when 'brave_reader' then coalesce((select p.read_aloud_count from public.m8_learner_progress p where p.user_id = p_user), 0) >= 10
    when 'graduate' then exists (select 1 from public.modules where status = 'published' and deleted_at is null)
      and not exists (select 1 from public.modules m where m.status = 'published' and m.deleted_at is null
        and not exists (select 1 from public.m8_xp_events x where x.user_id = p_user
          and ((x.source_type = 'module' and x.source_id = m.id)
            or (x.source_type = 'module_bonus' and x.source_id = coalesce(m.revision_root, m.id)))))
    else false
  end
$function$

;
DROP FUNCTION public.m8_my_badges();
CREATE FUNCTION public.m8_my_badges()
 RETURNS TABLE(badge_id text, name text, description text, icon text, eligible boolean, unlocked_at timestamp with time zone, claimed_at timestamp with time zone, preserved boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not exists (select 1 from public.profiles p where p.id = v_me and p.role in ('student', 'general_user')) then
    raise exception 'Learner access required' using errcode = '42501';
  end if;
  return query
  select b.id, b.name, b.description, b.icon,
    c.claimed_at is not null or public.m8_badge_eligible(v_me, b.id),
    (select e.earned_at from public.m8_earned_badges e where e.user_id = v_me and e.badge_id = b.id),
    c.claimed_at, coalesce(c.preserved, false)
  from public.m8_badges b
  left join public.m8_badge_claims c on c.user_id = v_me and c.badge_id = b.id
  order by b.id;
end $function$

;
REVOKE ALL ON FUNCTION public.m8_my_badges() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m8_my_badges() TO authenticated;
CREATE OR REPLACE FUNCTION public.m8_my_achievements()
 RETURNS TABLE(achievement_id text, qualifying integer, bronze_at timestamp with time zone, silver_at timestamp with time zone, gold_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not exists (select 1 from public.profiles p where p.id = v_me and p.role in ('student','general_user')) then
    raise exception 'Learner access required' using errcode = '42501';
  end if;
  return query
  with first_readings as (
    select distinct on (r.content_fingerprint) r.words_correct, r.words_total, r.completed_at
    from public.m5_verified_readings r
    where r.user_id = v_me and r.language = 'en'
    order by r.content_fingerprint, r.completed_at, r.attempt_id
  ), accurate as (
    select f.completed_at at_time, row_number() over (order by f.completed_at) n
    from first_readings f where 10 * f.words_correct >= 9 * f.words_total
  ), first_assessments as (
    select distinct on (public.m8_content_fingerprint(a.passage_text)) a.id, a.completed_at, a.question_snapshot
    from public.m6_comprehension_attempts a
    where a.user_id = v_me and a.status = 'completed' and a.completed_at is not null
    order by public.m8_content_fingerprint(a.passage_text), a.completed_at, a.id
  ), scored as (
    select f.completed_at,
      (select count(*) from jsonb_array_elements(f.question_snapshot) q) total,
      (select count(*) from jsonb_array_elements(f.question_snapshot) q
        join public.m6_comprehension_responses r on r.attempt_id = f.id and r.question_id::text = q.value->>'id'
        where q.value->>'correctOptionIndex' ~ '^[0-3]$' and r.first_option_index = (q.value->>'correctOptionIndex')::integer) correct
    from first_assessments f
  ), understood as (
    select s.completed_at at_time, row_number() over (order by s.completed_at) n
    from scored s where s.total > 0 and 5 * s.correct >= 4 * s.total
  ), tracks as (
    select 'accurate_reader'::text id, a.at_time, a.n from accurate a
    union all select 'comprehension_star', u.at_time, u.n from understood u
  )
  select w.id, coalesce(max(t.n), 0)::integer, max(t.at_time) filter (where t.n = 3),
    max(t.at_time) filter (where t.n = 10), max(t.at_time) filter (where t.n = 25)
  from (values ('accurate_reader'), ('comprehension_star')) as w(id)
  left join tracks t on t.id = w.id
  group by w.id order by w.id;
end $function$

;
CREATE OR REPLACE FUNCTION public.m8_claim_badge(p_badge_id text)
 RETURNS TABLE(badge_id text, claimed_at timestamp with time zone, newly_claimed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := auth.uid();
  v_at timestamptz;
  v_new boolean := false;
begin
  if v_me is null or not exists (select 1 from public.profiles p where p.id = v_me and p.role in ('student', 'general_user')) then
    raise exception 'Learner access required' using errcode = '42501';
  end if;
  if p_badge_id is null or not exists (select 1 from public.m8_badges b where b.id = p_badge_id) then
    raise exception 'Unknown badge' using errcode = '22023';
  end if;
  select c.claimed_at into v_at from public.m8_badge_claims c where c.user_id = v_me and c.badge_id = p_badge_id;
  if v_at is null then
    if not public.m8_badge_eligible(v_me, p_badge_id) then
      raise exception 'This badge is still locked' using errcode = '55000';
    end if;
    insert into public.m8_badge_claims(user_id, badge_id) values (v_me, p_badge_id)
    on conflict on constraint m8_badge_claims_pkey do nothing
    returning m8_badge_claims.claimed_at into v_at;
    v_new := v_at is not null;
    if not v_new then -- a simultaneous claim won
      select c.claimed_at into v_at from public.m8_badge_claims c where c.user_id = v_me and c.badge_id = p_badge_id;
    end if;
  end if;
  return query select p_badge_id, v_at, v_new;
end $function$

;
CREATE OR REPLACE FUNCTION public.m8_claim_achievement(p_achievement_id text, p_tier text)
 RETURNS TABLE(achievement_id text, tier text, claimed_at timestamp with time zone, newly_claimed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := auth.uid();
  v_reached timestamptz;
  v_at timestamptz;
  v_new boolean := false;
begin
  if v_me is null or not exists (select 1 from public.profiles p where p.id = v_me and p.role in ('student', 'general_user')) then
    raise exception 'Learner access required' using errcode = '42501';
  end if;
  if p_achievement_id is null or p_achievement_id not in ('accurate_reader', 'comprehension_star')
    or p_tier is null or p_tier not in ('bronze', 'silver', 'gold') then
    raise exception 'Unknown achievement tier' using errcode = '22023';
  end if;
  select c.claimed_at into v_at from public.m8_achievement_claims c
  where c.user_id = v_me and c.achievement_id = p_achievement_id and c.tier = p_tier;
  if v_at is null then
    select case p_tier when 'bronze' then a.bronze_at when 'silver' then a.silver_at else a.gold_at end into v_reached
    from public.m8_my_achievements() a where a.achievement_id = p_achievement_id;
    if v_reached is null then
      raise exception 'This achievement tier is still locked' using errcode = '55000';
    end if;
    insert into public.m8_achievement_claims(user_id, achievement_id, tier) values (v_me, p_achievement_id, p_tier)
    on conflict on constraint m8_achievement_claims_pkey do nothing
    returning m8_achievement_claims.claimed_at into v_at;
    v_new := v_at is not null;
    if not v_new then
      select c.claimed_at into v_at from public.m8_achievement_claims c
      where c.user_id = v_me and c.achievement_id = p_achievement_id and c.tier = p_tier;
    end if;
  end if;
  return query select p_achievement_id, p_tier, v_at, v_new;
end $function$

;
ALTER TABLE public.m8_badges DROP COLUMN IF EXISTS retired_at;
COMMIT;
