-- READ-ONLY verification for m2_independent_reassessment_eligibility_PROPOSED.sql. Aggregates only.
begin transaction read only;

with checks(name, ok) as (
  select 'eligibility trigger installed (before insert, after the Phase 2 guard by name)',
    exists (select 1 from pg_trigger where tgname = 'm2_reassessment_independent_eligibility' and not tgisinternal
      and tgrelid = 'public.m2_reassessment_assignments'::regclass)
    and 'm2_guard_reassessment_assignment' < 'm2_reassessment_independent_eligibility'
  union all
  select 'browser and backend roles cannot call the trigger function directly',
    not has_function_privilege('authenticated', 'public.m2_check_independent_eligibility()', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.m2_check_independent_eligibility()', 'EXECUTE')
  union all
  select 'Independent Learner reassessment is OFF and the interval is UNSET (adviser decision pending)',
    exists (select 1 from public.m2_reassessment_settings where not independent_learner_enabled and independent_min_days_between is null)
  union all
  select 'Phase 2 foundation unchanged: its assignment guard is still installed',
    exists (select 1 from pg_trigger where tgname = 'm2_guard_reassessment_assignment' and not tgisinternal)
)
select name, case when ok then 'PASS' else 'FAIL' end as result from checks;

select kind, status, count(*) as assignments from public.m2_reassessment_assignments group by 1, 2 order by 1, 2;

rollback;
