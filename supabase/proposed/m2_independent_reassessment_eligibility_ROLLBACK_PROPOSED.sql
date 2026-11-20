-- ROLLBACK for m2_independent_reassessment_eligibility_PROPOSED.sql -- PROPOSED. NOT APPLIED. Requires approval.
-- Removes only the extra eligibility trigger. No data is read, changed or removed. The Phase 2 foundation's own
-- Independent Learner checks (both gates, interval configured, package audience, role, duplicates) remain.
begin;

do $$
begin
  if to_regprocedure('public.m2_check_independent_eligibility()') is null then
    raise exception 'STOP: the Independent Learner eligibility check is not installed';
  end if;
end $$;

drop trigger m2_reassessment_independent_eligibility on public.m2_reassessment_assignments;
drop function public.m2_check_independent_eligibility();

commit;
