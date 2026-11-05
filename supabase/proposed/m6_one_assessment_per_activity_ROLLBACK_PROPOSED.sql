-- ============================================================================
-- PROPOSED ROLLBACK - NOT APPLIED. Undoes m6_one_assessment_per_activity_PROPOSED.sql only.
-- ============================================================================
-- Removes the trigger and its function. No row is touched: every attempt, answer, score and
-- oral-reading link saved while the rule was active stays as it is. After this rollback the
-- database again allows one attempt per (user, oral reading); the backend still reopens an
-- activity's existing assessment, but without the race-free database guard.
-- Guard: runs only on the exact applied definition (CR-normalized pg_get_functiondef md5
-- 76e677bf797d8db768e11bc200abb539, measured on PostgreSQL 17.11, the Staging version, on a disposable restore).
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.m6_one_assessment_per_activity()') is null then
    raise exception 'Stop: m6_one_assessment_per_activity is not installed (nothing to roll back).';
  end if;
  if md5(replace(pg_get_functiondef('public.m6_one_assessment_per_activity()'::regprocedure), chr(13), ''))
      is distinct from '76e677bf797d8db768e11bc200abb539' then
    raise exception 'Stop: m6_one_assessment_per_activity is not the applied definition; review before rolling back.';
  end if;
end $$;

drop trigger m6_one_assessment_per_activity on public.m6_comprehension_attempts;
drop function public.m6_one_assessment_per_activity();

do $$
begin
  if to_regprocedure('public.m6_one_assessment_per_activity()') is not null
     or exists (select 1 from pg_trigger where tgname = 'm6_one_assessment_per_activity' and not tgisinternal) then
    raise exception 'Postcondition: the one-per-activity guard is still present';
  end if;
end $$;

commit;
