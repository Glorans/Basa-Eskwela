-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval. Apply after M8 F1-F4.
-- M8 F2 Earn Badges and F3 Earn Achievements: learners CLAIM their rewards.
-- ============================================================================
--
-- Before: the database put a badge on the learner's account the moment its rule was met, and
-- achievements had no saved state (m8_my_achievements recalculated them on every page load).
--
-- After, nothing changes in how rewards are earned:
--   * The F1-F5 functions and triggers are NOT replaced. They keep writing m8_earned_badges, which from
--     now on means "unlocked: ready to claim". Clients still cannot write it.
--   * New m8_badge_claims and m8_achievement_claims hold what a learner claimed. Only the claim functions
--     below write them. RLS is on with no policies and no client grants.
--   * m8_claim_badge / m8_claim_achievement claim for auth.uid() only (no user argument), recheck
--     eligibility in the database, and are safe to repeat: the primary key stops duplicates, also when two
--     claims race. Claiming adds no XP, reading day, streak or ranking change.
--   * Every badge on an account when this runs is copied in as claimed, with its original date
--     (preserved = true; the page labels it "Earned", a manual claim "Claimed"). Achievements had no saved
--     state, so learners claim each tier they reached.
--   * m8_my_badges and m8_my_achievement_claims let the page show Locked, Ready to claim or Claimed.
-- Release order: the frontend first (it falls back to the earlier display while these functions are
-- missing), then this migration.
-- Rollback: m8_f2_f3_reward_claims_v1_ROLLBACK_PROPOSED.sql (refuses once a learner has claimed).
-- Test: server/tests/m8RewardClaimsProposal.test.js
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.m8_count_verified_reading(uuid,timestamptz)') is null
    or to_regprocedure('public.m8_my_achievements()') is null
    or to_regprocedure('public.m8_classroom_rankings(uuid,text)') is null then
    raise exception 'Stop: apply M8 F1, F2, F3 and F4 first.';
  end if;
  if to_regclass('public.m8_badge_claims') is not null or to_regclass('public.m8_achievement_claims') is not null then
    raise exception 'Stop: reward claiming is already installed.';
  end if;
  if pg_get_function_result('public.m8_my_achievements()'::regprocedure)
    is distinct from 'TABLE(achievement_id text, qualifying integer, bronze_at timestamp with time zone, silver_at timestamp with time zone, gold_at timestamp with time zone)' then
    raise exception 'Stop: m8_my_achievements differs from the reviewed F3 definition.';
  end if;
  if (select count(*) from public.m8_badges where id in
      ('first_read','bookworm','diamond','level_up','streak_3','consistent_reader','brave_reader','graduate')) <> 8 then
    raise exception 'Stop: the badge catalogue differs from the reviewed eight badges.';
  end if;
end $$;

create table public.m8_badge_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null references public.m8_badges(id),
  claimed_at timestamptz not null default now(),
  -- True for badges already on the account when claiming began; they were never claimed by hand.
  preserved boolean not null default false,
  primary key (user_id, badge_id)
);

create table public.m8_achievement_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null check (achievement_id in ('accurate_reader', 'comprehension_star')),
  tier text not null check (tier in ('bronze', 'silver', 'gold')),
  claimed_at timestamptz not null default now(),
  primary key (user_id, achievement_id, tier)
);

alter table public.m8_badge_claims enable row level security;
alter table public.m8_achievement_claims enable row level security;
revoke all on table public.m8_badge_claims, public.m8_achievement_claims from public, anon, authenticated, service_role;

-- Badges already earned stay earned, with their original date.
insert into public.m8_badge_claims(user_id, badge_id, claimed_at, preserved)
select e.user_id, e.badge_id, e.earned_at, true from public.m8_earned_badges e;

-- Whether a learner may claim a badge. A row in m8_earned_badges is the trusted record written by the
-- F1-F5 triggers when the rule was met (only they can write it). The same rules are also recalculated
-- from saved records, so a learner who met a rule without a recorded unlock can still claim it.
create function public.m8_badge_eligible(p_user uuid, p_badge text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.m8_earned_badges e where e.user_id = p_user and e.badge_id = p_badge)
  or case p_badge
    when 'first_read' then exists (select 1 from public.m8_xp_events x
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module'))
    when 'bookworm' then (select count(*) from public.m8_xp_events x
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module')) >= 5
    when 'diamond' then (select coalesce(sum(x.xp_earned), 0) from public.m8_xp_events x
      where x.user_id = p_user and x.source_type <> 'daily_login') >= 2000
    when 'level_up' then exists (select 1 from public.diagnostic_results d where d.user_id = p_user
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
$$;
revoke all on function public.m8_badge_eligible(uuid,text) from public, anon, authenticated, service_role;

-- The signed-in learner's badges: the catalogue, whether each can be claimed, and when it was claimed.
-- preserved = true: awarded automatically before claiming began; claimed_at is then the original award date,
-- not a date the learner pressed Claim.
create function public.m8_my_badges()
returns table(badge_id text, name text, description text, icon text, eligible boolean, unlocked_at timestamptz, claimed_at timestamptz,
  preserved boolean)
language plpgsql stable security definer set search_path = '' as $$
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
end $$;
revoke all on function public.m8_my_badges() from public, anon, service_role;
grant execute on function public.m8_my_badges() to authenticated;

-- Claim one badge for the signed-in learner. Repeating returns the first claim unchanged.
create function public.m8_claim_badge(p_badge_id text)
returns table(badge_id text, claimed_at timestamptz, newly_claimed boolean)
language plpgsql volatile security definer set search_path = '' as $$
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
end $$;
revoke all on function public.m8_claim_badge(text) from public, anon, service_role;
grant execute on function public.m8_claim_badge(text) to authenticated;

-- The signed-in learner's claimed achievement tiers.
create function public.m8_my_achievement_claims()
returns table(achievement_id text, tier text, claimed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not exists (select 1 from public.profiles p where p.id = v_me and p.role in ('student', 'general_user')) then
    raise exception 'Learner access required' using errcode = '42501';
  end if;
  return query select c.achievement_id, c.tier, c.claimed_at from public.m8_achievement_claims c
  where c.user_id = v_me order by c.achievement_id, c.claimed_at;
end $$;
revoke all on function public.m8_my_achievement_claims() from public, anon, service_role;
grant execute on function public.m8_my_achievement_claims() to authenticated;

-- Claim one tier of one achievement. Each tier is separate: claiming Silver does not claim Bronze or
-- Gold. Eligibility is recalculated by m8_my_achievements (F3) from verified readings and saved
-- assessments, where only the first reading or assessment of a text counts. No XP is added.
create function public.m8_claim_achievement(p_achievement_id text, p_tier text)
returns table(achievement_id text, tier text, claimed_at timestamptz, newly_claimed boolean)
language plpgsql volatile security definer set search_path = '' as $$
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
end $$;
revoke all on function public.m8_claim_achievement(text,text) from public, anon, service_role;
grant execute on function public.m8_claim_achievement(text,text) to authenticated;

do $$ begin
  if (select count(*) from public.m8_badge_claims) <> (select count(*) from public.m8_earned_badges)
    or exists (select 1 from public.m8_badge_claims where not preserved) then
    raise exception 'Postcondition: earned badges were not preserved exactly';
  end if;
  if has_table_privilege('authenticated', 'public.m8_badge_claims', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.m8_achievement_claims', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.m8_badge_claims', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.m8_achievement_claims', 'SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated', 'public.m8_badge_eligible(uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_claim_badge(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_claim_achievement(text,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.m8_claim_badge(text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.m8_claim_achievement(text,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.m8_my_badges()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.m8_my_achievement_claims()', 'EXECUTE') then
    raise exception 'Postcondition: claim access is wrong';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
