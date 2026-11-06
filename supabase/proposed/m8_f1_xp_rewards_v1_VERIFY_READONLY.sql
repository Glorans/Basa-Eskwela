-- READ ONLY. Run in a read-only transaction. Preflight for m8_f1_xp_rewards_v1_PROPOSED.sql.
-- Selects catalog facts and aggregate counts only: no learner IDs, names, transcripts or passage text.
begin transaction read only;

-- 1. Each row must say match = true.
select fn, md5(replace(pg_get_functiondef(fn::regprocedure), chr(13), '')) = fp as match
from (values
  ('public.m8_grant_xp(uuid,text,uuid,integer)', '3e803b9b0c2543fdfe132060a811c70a'),
  ('public.m8_on_comprehension_completed()', 'a31be79ffcd4e76ea3396a808f4cbd3a'),
  ('public.m8_award_graduate(uuid)', '3516a76d0547cdc64d2d0d9d03555582'),
  ('public.m8_on_module_xp_granted()', 'c63db1f4be03ae32413047cb2844200c'),
  ('public.m8_weekly_leaderboard()', 'e09ba39cdef64cfd31d4eff1500a192c'),
  ('public.m8_classroom_leaderboard(uuid)', '111d438f1ecddd69f37929270f3d0e27'),
  ('public.m8_independent_leaderboard(text)', '0fa0574f46b772474da40a72a35af09a')
) as expected(fn, fp);

-- 2. Must return no rows.
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and relname in
  ('m8_reward_settings','m5_transcript_receipts','m5_verified_readings','m8_passage_rewards','m8_daily_logins');

-- 3. Must be false, false: clients cannot write saved readings.
select has_table_privilege('authenticated', 'public.oral_reading_attempts', 'INSERT,UPDATE,DELETE') as table_write,
       has_any_column_privilege('authenticated', 'public.oral_reading_attempts', 'INSERT,UPDATE') as column_write;

-- 4. Baseline: compare with the same query after applying. Nothing may change.
select source_type, xp_earned, count(*) as events, sum(xp_earned) as xp from public.m8_xp_events group by 1, 2 order by 1, 2;
select count(*) as learners, sum(total_xp) as total_xp, sum(completed_modules) as completed_modules,
  sum(read_aloud_count) as read_alouds, sum(current_streak) as streaks from public.m8_learner_progress;
select count(*) as earned_badges from public.m8_earned_badges;
select count(*) as reading_days from public.m8_reading_days;
select count(*) as diagnostic_rows from public.diagnostic_results;

-- 5. Row fingerprints of the protected records. Must be identical after applying.
select 'm8_xp_events' as tbl, count(*) as n, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as fp from public.m8_xp_events t
union all select 'm8_learner_progress', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id), '')) from public.m8_learner_progress t
union all select 'm8_earned_badges', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id, t.badge_id), '')) from public.m8_earned_badges t
union all select 'm8_reading_days', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id, t.reading_date), '')) from public.m8_reading_days t
union all select 'diagnostic_results', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.diagnostic_results t;

-- 6. Identity ambiguity: duplicate normalized passage text across sources, for review.
select n as copies, count(*) as texts from (
  select count(*) as n from public.module_passages
  group by btrim(regexp_replace(lower(normalize(passage_text, NFKC)), '[^[:alnum:]]+', ' ', 'g'))
) d where n > 1 group by 1 order by 1;

rollback;
