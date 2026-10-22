-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- C5 = readflow/supabase/migrations/20261022000000_m8_consistent_reader.sql (original, unchanged).
-- Prepared checks; none executed. Run ONE section at a time at its stated checkpoint.
-- B1-B26 and C1-C4 already applied and verified; never rerun them. Do not apply C6-C8 here.
-- Before C5: P-C5a, P-C5b. After C5: V-C5a..V-C5g, then verify_c2_c6.sql V11a/V11b/V11d/V11e/V11f,
-- verify_c2_c3.sql V-C3a/V-C3b (not V-C3c), then audit_stage_b.sql A1-A8.
-- Do not run V11c until C6: it expects m8_independent_leaderboard(text), which C5 does not create.
-- Any false/NULL as_expected, incorrect count, unexpected row or SQL error means STOP.

-- P-C5a. Before C5 ONLY. Expect one row:
-- m8_functions 8, m8_triggers 4, c5_function_present false, c5_trigger_present false,
-- consistent_reader_badge true, perfect_score_badge false, perfect_score_awards 0.
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'm8\_%') as m8_functions,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'm8\_%') as m8_triggers,
       to_regprocedure('public.m8_award_consistent_reader()') is not null as c5_function_present,
       exists (select 1 from pg_trigger where tgname = 'm8_consistent_reader_day'
               and tgrelid = to_regclass('public.m8_reading_days')) as c5_trigger_present,
       exists (select 1 from public.m8_badges where id = 'consistent_reader') as consistent_reader_badge,
       exists (select 1 from public.m8_badges where id = 'perfect_score') as perfect_score_badge,
       (select count(*) from public.m8_earned_badges where badge_id = 'perfect_score') as perfect_score_awards;

-- P-C5b. Before C5 ONLY. Backfill preview; save this row for comparison with V-C5f.
-- learners_with_7_days is how many awards C5's backfill may create (minus existing awards).
-- On a fresh staging database all values are expected to be 0.
select (select count(distinct user_id) from public.m8_reading_days) as learners_with_reading_days,
       (select count(*) from (select user_id from public.m8_reading_days
                              group by user_id having count(*) >= 7) s) as learners_with_7_days,
       (select count(*) from public.m8_earned_badges where badge_id = 'consistent_reader') as existing_awards,
       (select count(*) from public.m8_earned_badges) as total_earned_badges;

-- V-C5a. Immediately after C5. Expect 1 row, as_expected true.
-- Trigger-only SECURITY DEFINER function: search_path pinned to empty, no EXECUTE for
-- PUBLIC, anon or authenticated, and owned by the same role as the other M8 definers.
select p.oid::regprocedure as function_name, p.prosecdef as security_definer, p.proconfig,
       pg_get_userbyid(p.proowner) as owner,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       coalesce(p.prosecdef
         and p.prorettype = 'trigger'::regtype
         and p.proconfig = array['search_path=""']
         and p.proowner = (select proowner from pg_proc
                           where oid = to_regprocedure('public.m8_grant_xp(uuid,text,uuid,integer)'))
         and pg_get_userbyid(p.proowner) not in ('anon', 'authenticated')
         and not has_function_privilege('public', p.oid, 'EXECUTE')
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as as_expected
from (values ('public.m8_award_consistent_reader()')) e(sig)
left join pg_proc p on p.oid = to_regprocedure(e.sig);

-- V-C5b. Expect exactly 1 row, as_expected true, enabled O.
-- Row-level AFTER INSERT (tgtype 5); no WHEN condition or arguments. It must be the
-- only user trigger on m8_reading_days; a second row means STOP.
select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition,
       coalesce(t.tgname = 'm8_consistent_reader_day' and t.tgenabled = 'O'
         and t.tgfoid = to_regprocedure('public.m8_award_consistent_reader()')
         and t.tgtype = 5 and t.tgnargs = 0 and t.tgqual is null, false) as as_expected
from pg_trigger t
where t.tgrelid = to_regclass('public.m8_reading_days') and not t.tgisinternal
order by 1;

-- V-C5c. Inventory after C5 (replaces V-C3c). Expect m8_functions 9, m8_triggers 5.
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'm8\_%') as m8_functions,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal and t.tgname like 'm8\_%') as m8_triggers;

-- V-C5d. Every M8 function, not only a fixed list. Expect 0 rows.
-- Any row is an M8 function that is not SECURITY DEFINER, has an unpinned search_path,
-- is executable by PUBLIC/anon, can be re-granted, or is client-callable other than
-- m8_weekly_leaderboard() (the only client RPC until C6 adds the independent leaderboard).
select p.oid::regprocedure as function_name, p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'm8\_%'
  and (not p.prosecdef
    or not coalesce(p.proconfig, '{}') @> array['search_path=""']
    or has_function_privilege('public', p.oid, 'EXECUTE')
    or has_function_privilege('anon', p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE WITH GRANT OPTION')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE')
       <> (p.oid = to_regprocedure('public.m8_weekly_leaderboard()')))
order by 1;

-- V-C5e. Badge catalogue after C5. Expect 8 rows, perfect_score absent, and
-- consistent_reader = 'Consistent Reader' / 'Read on 7 different days' / 'CalendarCheck'.
-- The trigger's badge insert depends on this row (foreign key); if it is missing,
-- M5/M6 saves that record a reading day would fail.
select id, name, description, icon from public.m8_badges order by 1;

-- V-C5f. Award integrity. Expect 0 rows.
-- 'missing_award': a learner with 7+ distinct reading days lacks the badge (backfill/trigger failed).
-- 'unearned_award': a learner holds the badge with fewer than 7 reading days (unexpected award path).
with days as (select user_id, count(*) as reading_days from public.m8_reading_days group by user_id),
awards as (select user_id from public.m8_earned_badges where badge_id = 'consistent_reader')
select 'missing_award' as issue, d.user_id, d.reading_days
from days d where d.reading_days >= 7 and not exists (select 1 from awards a where a.user_id = d.user_id)
union all
select 'unearned_award', a.user_id, coalesce(d.reading_days, 0)
from awards a left join days d on d.user_id = a.user_id
where coalesce(d.reading_days, 0) < 7
order by 1, 2;

-- V-C5g. Badge-awarding paths. Expect exactly 6 rows, every client_execute false:
-- m8_award_consistent_reader(), m8_award_graduate(uuid), m8_grant_xp(uuid,text,uuid,integer),
-- m8_oral_completed(), m8_record_reading_day(uuid,date), m8_sync_diagnostic().
-- Lists every public function whose body writes or references m8_earned_badges; an extra
-- row is an unreviewed badge-awarding path. Only award_consistent_reader may mention
-- 'consistent_reader' (mentions_consistent_reader true in that row only).
select p.oid::regprocedure as function_name, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE') as client_execute,
       p.prosrc like '%consistent\_reader%' as mentions_consistent_reader
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc like '%m8\_earned\_badges%'
order by 1;
