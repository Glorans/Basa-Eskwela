-- M8 final corrections (Capstone): attainable badges and achievements.                  PROPOSED - NOT APPLIED TO STAGING
--
-- Changes ONLY reward eligibility, display and claim error codes. XP rules, XP history, daily login, streaks,
-- reading days, readings, assessments and every existing earned or claimed reward are untouched.
--   * Retire Graduate, Diamond and Level Up from future earning: m8_badges.retired_at (rows kept).
--       - No new unlock rows for a retired badge (trigger m8_skip_retired_badge).
--       - A retired badge is claimable ONLY with a persisted unlock (m8_earned_badges) dated before its retirement;
--         never from current scores. Claims made earlier are kept. Both are listed as past badges.
--   * Bookworm: 3 rewarded reading activities (was 5).
--   * Accurate Reader and Comprehension Star: Bronze 1, Silver 2, Gold 3 qualifying stories (was 3, 10, 25). The rules
--     (90% first verified English reading; 80% first-answer comprehension; unique stories; first attempt only) are
--     unchanged, and only published reading modules and Teacher-assigned materials count. A learner's own uploaded
--     material stays available for practice but does not count toward achievements. Claimed tiers stay claimed.
--   * m8_my_badges returns a new `retired` column.
--   * A claim of a locked or retired badge/tier is refused with HTTP 409 (PostgREST code PT409) instead of 500.
-- Guard: stops unless the five replaced functions are the reviewed bodies (md5 of the definition, CR removed).
-- Rollback: m8_final_corrections_v1_ROLLBACK_PROPOSED.sql. Checks: ..._PREFLIGHT_READONLY.sql, ..._VERIFY_READONLY.sql.

BEGIN;

DO $guard$
DECLARE
  expected CONSTANT jsonb := '{"m8_badge_eligible(uuid,text)": "41fa600a881cdf76985d45a76cd1bb25",
    "m8_my_badges()": "3ab0866dc43b6ce0772f042b2e2f667b", "m8_my_achievements()": "3d6433fb4df8339989802f67fc0299d5",
    "m8_claim_badge(text)": "dc391554937e751cc980a88f23068473", "m8_claim_achievement(text,text)": "4e548fc45ad688c24a806cfef83da158"}';
  k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(expected) LOOP
    IF to_regprocedure('public.' || k) IS NULL
       OR md5(replace(pg_get_functiondef(to_regprocedure('public.' || k)), chr(13), '')) <> expected ->> k THEN
      RAISE EXCEPTION 'M8 final corrections: % is not the reviewed version; nothing was changed', k;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'm8_badges' AND column_name = 'retired_at') THEN
    RAISE EXCEPTION 'M8 final corrections already applied; nothing was changed';
  END IF;
END $guard$;

ALTER TABLE public.m8_badges ADD COLUMN retired_at timestamptz;
UPDATE public.m8_badges SET retired_at = now() WHERE id IN ('graduate', 'diamond', 'level_up');

-- Retired badges: keep every earned row, but record no new ones (the XP functions that insert them stay unchanged).
CREATE FUNCTION public.m8_skip_retired_badge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.m8_badges b WHERE b.id = NEW.badge_id AND b.retired_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.m8_skip_retired_badge() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER m8_skip_retired_badge BEFORE INSERT ON public.m8_earned_badges
FOR EACH ROW EXECUTE FUNCTION public.m8_skip_retired_badge();

CREATE OR REPLACE FUNCTION public.m8_badge_eligible(p_user uuid, p_badge text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
  -- A retired badge: only a persisted unlock recorded before the retirement (never current scores).
  when exists (select 1 from public.m8_badges b where b.id = p_badge and b.retired_at is not null) then
    exists (select 1 from public.m8_earned_badges e join public.m8_badges b on b.id = e.badge_id
      where e.user_id = p_user and e.badge_id = p_badge and e.earned_at < b.retired_at)
  else (exists (select 1 from public.m8_earned_badges e where e.user_id = p_user and e.badge_id = p_badge)
  or case p_badge
    when 'first_read' then exists (select 1 from public.m8_xp_events x
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module'))
    -- Bookworm: 3 rewarded reading activities (was 5; Capstone content has 4 published stories).
    when 'bookworm' then (select count(*) from public.m8_xp_events x
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module')) >= 3
    when 'streak_3' then coalesce((select max(n) from (select count(*) n from (
        select r.reading_date - (row_number() over (order by r.reading_date))::int grp
        from public.m8_reading_days r where r.user_id = p_user) d group by grp) runs), 0) >= 3
    when 'consistent_reader' then (select count(*) from public.m8_reading_days r where r.user_id = p_user) >= 7
    when 'brave_reader' then coalesce((select p.read_aloud_count from public.m8_learner_progress p where p.user_id = p_user), 0) >= 10
    else false
  end)
  end
$function$;

DROP FUNCTION public.m8_my_badges();
CREATE FUNCTION public.m8_my_badges()
 RETURNS TABLE(badge_id text, name text, description text, icon text, eligible boolean, unlocked_at timestamp with time zone,
   claimed_at timestamp with time zone, preserved boolean, retired boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not exists (select 1 from public.profiles p where p.id = v_me and p.role in ('student', 'general_user')) then
    raise exception 'Learner access required' using errcode = '42501';
  end if;
  -- Active badges, plus retired badges this learner claimed or unlocked before the retirement (past badges).
  return query
  select b.id, b.name, b.description, b.icon,
    c.claimed_at is not null or public.m8_badge_eligible(v_me, b.id),
    (select e.earned_at from public.m8_earned_badges e where e.user_id = v_me and e.badge_id = b.id),
    c.claimed_at, coalesce(c.preserved, false), b.retired_at is not null
  from public.m8_badges b
  left join public.m8_badge_claims c on c.user_id = v_me and c.badge_id = b.id
  where b.retired_at is null or c.claimed_at is not null or public.m8_badge_eligible(v_me, b.id)
  order by b.id;
end $function$;
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
    -- Only published reading modules and Teacher-assigned materials count (not a learner's own uploads).
    select distinct on (r.content_fingerprint) r.words_correct, r.words_total, r.completed_at
    from public.m5_verified_readings r
    join public.oral_reading_attempts o on o.id = r.attempt_id
    where r.user_id = v_me and r.language = 'en'
      and (o.module_id is not null or o.activity_assignment_id is not null)
    order by r.content_fingerprint, r.completed_at, r.attempt_id
  ), accurate as (
    select f.completed_at at_time, row_number() over (order by f.completed_at) n
    from first_readings f where 10 * f.words_correct >= 9 * f.words_total
  ), first_assessments as (
    select distinct on (public.m8_content_fingerprint(a.passage_text)) a.id, a.completed_at, a.question_snapshot
    from public.m6_comprehension_attempts a
    where a.user_id = v_me and a.status = 'completed' and a.completed_at is not null
      and (a.module_id is not null or a.activity_assignment_id is not null)
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
  -- Bronze 1, Silver 2, Gold 3 qualifying stories (was 3, 10, 25).
  select w.id, coalesce(max(t.n), 0)::integer, max(t.at_time) filter (where t.n = 1),
    max(t.at_time) filter (where t.n = 2), max(t.at_time) filter (where t.n = 3)
  from (values ('accurate_reader'), ('comprehension_star')) as w(id)
  left join tracks t on t.id = w.id
  group by w.id order by w.id;
end $function$;

-- Claims: unchanged except the HTTP status of an expected refusal (locked or retired): 409 instead of 500.
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
      if exists (select 1 from public.m8_badges b where b.id = p_badge_id and b.retired_at is not null) then
        raise exception 'This badge is no longer awarded' using errcode = 'PT409';
      end if;
      raise exception 'This badge is still locked' using errcode = 'PT409';
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
end $function$;

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
      raise exception 'This achievement tier is still locked' using errcode = 'PT409';
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
end $function$;

COMMIT;
