-- READ ONLY. Before and after m8_f2_f3_reward_claims_v1_PROPOSED.sql. Selects catalog facts and counts only.
begin transaction read only;
-- 1. Before: f1_f4_installed true, claims_installed false. After: both true.
select to_regprocedure('public.m8_my_achievements()') is not null
   and to_regprocedure('public.m8_classroom_rankings(uuid,text)') is not null as f1_f4_installed,
   to_regclass('public.m8_badge_claims') is not null as claims_installed;
-- 2. The eight reviewed badges: 8.
select count(*) as reviewed_badges from public.m8_badges
where id in ('first_read','bookworm','diamond','level_up','streak_3','consistent_reader','brave_reader','graduate');
-- 3. Baseline to compare after applying. Nothing here may change.
select 'm8_xp_events' as tbl, count(*) as n, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as fp from public.m8_xp_events t
union all select 'm8_learner_progress', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id), '')) from public.m8_learner_progress t
union all select 'm8_earned_badges', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id, t.badge_id), '')) from public.m8_earned_badges t
union all select 'm8_reading_days', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id, t.reading_date), '')) from public.m8_reading_days t
union all select 'diagnostic_results', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.diagnostic_results t;
-- 4. Earned badges by badge. After applying, every one of them is a preserved claim.
select badge_id, count(*) as earned from public.m8_earned_badges group by 1 order by 1;
rollback;
