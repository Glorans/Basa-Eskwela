-- READ ONLY. Preflight for the M8 F2-F5 proposals. Selects catalog facts and aggregate counts only.
begin transaction read only;
-- 1. M8 F1 must be installed: true.
select to_regclass('public.m8_reward_settings') is not null as f1_installed;
-- 2. Must return no rows: the old badge proposal must not have been applied after F1.
select 1 where position('source_type in (''passage''' in pg_get_functiondef('public.m8_grant_xp(uuid,text,uuid,integer)'::regprocedure)) > 0;
-- 3. Baseline to compare after applying. Nothing here may change.
select 'm8_xp_events' as tbl, count(*) as n, md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as fp from public.m8_xp_events t
union all select 'm8_learner_progress', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id), '')) from public.m8_learner_progress t
union all select 'm8_earned_badges', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id, t.badge_id), '')) from public.m8_earned_badges t
union all select 'm8_reading_days', count(*), md5(coalesce(string_agg(t::text, '|' order by t.user_id, t.reading_date), '')) from public.m8_reading_days t
union all select 'diagnostic_results', count(*), md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.diagnostic_results t;
-- 4. For review: trashed modules with status published, and readings a Graduate check would skip.
select count(*) as trashed_published from public.modules where status = 'published' and deleted_at is not null;
rollback;
