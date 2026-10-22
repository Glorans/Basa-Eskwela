-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- GROUP C2-C6. Use staging/c2_m8_gamification_hardened.sql and
-- staging/c3_m8_completion_integration_hardened.sql INSTEAD OF the C2/C3 originals.
-- C4-C6 remain the original readflow migrations, in filename order.
-- P11a already PASSED (2026-10-22); do not replay B1-B26/C1.
-- Use verify_c2_c3.sql for immediate C2/C3 checks. Run V11a-V11f after C6,
-- then audit_stage_b.sql A1-A8. See docs/C2_C3_STAGING_REVIEW.md for the sequence.
-- C2 is not re-runnable (it fails and rolls back if its policies exist). A mismatch means STOP.

-- P11a. M8 not installed. Expect 5 rows, already_exists false.
select t.name, to_regclass('public.' || t.name) is not null as already_exists
from unnest(array['m8_learner_progress', 'm8_xp_events', 'm8_badges', 'm8_earned_badges',
                  'm8_reading_days']) t(name)
order by 1;

-- V11a. M8 tables are read-only for browsers. Expect 5 rows: present, rls true,
-- anon_privileges empty, authenticated_privileges SELECT. PostgreSQL 17 privileges.
-- All three column-level flags must be false (table REVOKE does not remove column grants).
select t.name, c.oid is not null as present, c.relrowsecurity as rls,
       array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
         where has_table_privilege('anon', c.oid, p)), ',') as anon_privileges,
       array_to_string(array(select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
         where has_table_privilege('authenticated', c.oid, p)), ',') as authenticated_privileges,
       has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') as anon_column_access,
       has_any_column_privilege('authenticated', c.oid, 'INSERT,UPDATE,REFERENCES') as authenticated_column_write_or_reference,
       has_any_column_privilege('authenticated', c.oid, 'SELECT WITH GRANT OPTION') as authenticated_can_grant_select
from unnest(array['m8_learner_progress', 'm8_xp_events', 'm8_badges', 'm8_earned_badges',
                  'm8_reading_days']) t(name)
left join pg_class c on c.oid = to_regclass('public.' || t.name)
order by 1;

-- V11b. Own-row policies. Expect 5 rows, permissive SELECT for {authenticated}:
-- m8_all_badges (badge catalogue), m8_self_badges, m8_self_days, m8_self_progress, m8_self_xp.
-- qual must be true for m8_all_badges and (user_id = auth.uid()) for each other policy.
-- with_check must be NULL in all five rows. Extra policies, even restrictive ones, mean STOP.
select tablename, policyname, permissive, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename like 'm8\_%'
order by 1, 2;

-- V11c. XP and leaderboard functions. Expect 10 rows, as_expected true in every row.
-- Only the two leaderboard RPCs are callable by signed-in users; XP is never client-grantable.
-- The three functions marked (*) are hardened inside the staging C2/C3 replacement files.
-- Any remaining effective client EXECUTE means STOP; do not dismiss inherited grants.
select e.sig as function_name, p.oid is not null as present,
       p.prosecdef as security_definer,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       e.authenticated as expected_authenticated,
       p.oid is not null and p.prosecdef
         and coalesce(p.proconfig, '{}') @> array['search_path=""']
         and not has_function_privilege('public', p.oid, 'EXECUTE')
         and not has_function_privilege('anon', p.oid, 'EXECUTE')
         and has_function_privilege('authenticated', p.oid, 'EXECUTE') = e.authenticated
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE WITH GRANT OPTION') as as_expected
from (values
  ('public.m8_weekly_leaderboard()', true),
  ('public.m8_independent_leaderboard(text)', true),
  ('public.m8_grant_xp(uuid,text,uuid,integer)', false),
  ('public.m8_record_reading_day(uuid,date)', false),
  ('public.m8_award_graduate(uuid)', false),
  ('public.m8_on_comprehension_completed()', false),
  ('public.m8_award_consistent_reader()', false),
  ('public.m8_sync_diagnostic()', false),        -- (*)
  ('public.m8_oral_completed()', false),         -- (*)
  ('public.m8_on_module_xp_granted()', false)    -- (*)
) e(sig, authenticated)
left join pg_proc p on p.oid = to_regprocedure(e.sig)
order by as_expected, 1;

-- V11d. M8 triggers. Expect 5 rows, tgenabled O. The first three run inside existing
-- M2/M5/M6 writes: a failure there rolls back the learner's save.
select e.on_table, e.trigger_name, t.tgenabled
from (values ('public.diagnostic_results', 'm8_diagnostic_sync'),
             ('public.oral_reading_attempts', 'm8_oral_completed_trigger'),
             ('public.m6_comprehension_attempts', 'm8_m6_completed'),
             ('public.m8_xp_events', 'm8_graduate_check'),
             ('public.m8_reading_days', 'm8_consistent_reader_day')) e(on_table, trigger_name)
left join pg_trigger t on t.tgrelid = to_regclass(e.on_table) and t.tgname = e.trigger_name
  and not t.tgisinternal
order by 1, 2;

-- V11e. Badge catalogue. Expect exactly 8 rows: bookworm, brave_reader, consistent_reader,
-- diamond, first_read, graduate, level_up, streak_3 (no perfect_score).
select id from public.m8_badges order by 1;

-- V11f. Checkpoint totals. Expect public_tables 27, public_policies 70, storage_policies 4.
select (select count(*) from pg_tables where schemaname = 'public') as public_tables,
       (select count(*) from pg_policies where schemaname = 'public') as public_policies,
       (select count(*) from pg_policies where schemaname = 'storage') as storage_policies;
