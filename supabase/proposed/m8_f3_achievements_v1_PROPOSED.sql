-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval. Apply after M8 F1.
-- M8 F3 Earn Achievements.
-- ============================================================================
--
-- Badges mark that something was done. Achievements show how well learners do over time, in Bronze,
-- Silver and Gold, so neither repeats the other:
--   accurate_reader     English passages whose FIRST verified reading scored at least 90%.
--   comprehension_star  Reading activities whose FIRST completed assessment scored at least 80% on
--                       first answers (the M7 "On Track" line). English and Filipino.
--   Bronze 3, Silver 10, Gold 25 distinct passages. Provisional project rules, pending adviser approval.
-- Evidence: m5_verified_readings and the protected M6 snapshot and first answers. Repeats cannot help:
-- only the first reading or assessment of a text counts. Reading accuracy is English-only while Filipino
-- speech validation continues. Nothing grants XP; nothing is stored: this reads and returns the caller's own.
-- Rollback: m8_f3_achievements_v1_ROLLBACK_PROPOSED.sql. Test: server/tests/m8F2F5Proposal.test.js
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.m5_verified_readings') is null then
    raise exception 'Stop: apply m8_f1_xp_rewards_v1_PROPOSED.sql first.';
  end if;
  if to_regprocedure('public.m8_my_achievements()') is not null then
    raise exception 'Stop: M8 F3 is already installed.';
  end if;
end $$;

create function public.m8_my_achievements()
returns table(achievement_id text, qualifying integer, bronze_at timestamptz, silver_at timestamptz, gold_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
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
end $$;
revoke all on function public.m8_my_achievements() from public, anon, service_role;
grant execute on function public.m8_my_achievements() to authenticated;

notify pgrst, 'reload schema';
commit;
