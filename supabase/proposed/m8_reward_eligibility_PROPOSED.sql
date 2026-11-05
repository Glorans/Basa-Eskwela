-- PROPOSED - NOT APPLIED - REQUIRES APPROVAL
-- M8 reward eligibility: only Student and Independent Learner read-alouds count toward M8.
--
-- Defect: m8_oral_completed() runs for every saved oral_reading_attempts row. Admins save M5
-- practice readings (the API allows it), so an Admin gains read_aloud_count, reading days,
-- streaks and possibly the Brave Reader / 3-Day Streak / Consistent Reader badges. No role
-- check exists in the trigger, so any other non-learner row inserted by the backend would too.
--
-- Fix: the same function body with one early return for non-learner owners. The reading itself
-- is still saved (the trigger runs AFTER INSERT and returns NEW), so Admin M5 practice keeps
-- working. M6 XP already requires a learner (m6_assert_completion_access). XP values, badge
-- rules and all existing rows are unchanged. DDL only: no row is inserted, updated or deleted.
--
-- Fingerprint (resolved 2026-11-06): the guard uses the CR-normalized md5 of pg_get_functiondef read
-- READ-ONLY from ReadFlow-Staging (PostgreSQL 17.11) on 2026-11-05. Replaying
-- supabase/staging/c2_m8_gamification_hardened.sql in PGlite (PostgreSQL 17) gives the same value,
-- so the live body is exactly the c2 body reproduced below apart from the eligibility line.
-- Admin practice (M5 and M6) never earns M8 progress: this file covers M5 readings; the M6
-- completion trigger is covered by m6_admin_practice_PROPOSED.sql. The two are independent and
-- may be applied in either order. Test: server/tests/m6AdminPracticeProposal.test.js (PGlite).
--
-- BEFORE APPLYING: run m8_reward_eligibility_VERIFY_READONLY.sql and take a staging backup. Apply
-- only with explicit approval.

begin;

do $$ begin
  if to_regprocedure('public.m8_oral_completed()') is null then
    raise exception 'Stop: public.m8_oral_completed() is missing.';
  end if;
  if md5(replace(pg_get_functiondef('public.m8_oral_completed()'::regprocedure), chr(13), ''))
      is distinct from '76c29f67f939493194c7fb5c8a191bdb' then
    raise exception 'Stop: m8_oral_completed differs from the reviewed definition (already applied?).';
  end if;
end $$;

create or replace function public.m8_oral_completed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 -- Learner rewards only. Other roles' readings are saved but earn no M8 progress.
 if not exists (select 1 from public.profiles where id=new.user_id and role in ('student','general_user')) then
  return new;
 end if;
 insert into public.m8_learner_progress(user_id,read_aloud_count) values(new.user_id,1)
 on conflict(user_id) do update set read_aloud_count=public.m8_learner_progress.read_aloud_count+1,updated_at=now();
 perform public.m8_record_reading_day(new.user_id,(new.completed_at at time zone 'Asia/Manila')::date);
 insert into public.m8_earned_badges(user_id,badge_id)
 select new.user_id,'brave_reader' where
 (select read_aloud_count from public.m8_learner_progress where user_id=new.user_id)>=10 on conflict do nothing;
 return new;
end $$;
revoke all on function public.m8_oral_completed() from public, anon, authenticated;

do $$ begin
  if has_function_privilege('anon', 'public.m8_oral_completed()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.m8_oral_completed()', 'EXECUTE') then
    raise exception 'Postcondition: m8_oral_completed is callable by clients';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'm8_oral_completed_trigger'
                 and tgrelid = 'public.oral_reading_attempts'::regclass and not tgisinternal) then
    raise exception 'Postcondition: m8_oral_completed_trigger is missing';
  end if;
end $$;

commit;

-- ROLLBACK (restores the c2 body exactly):
--   see m8_reward_eligibility_ROLLBACK_PROPOSED.sql
