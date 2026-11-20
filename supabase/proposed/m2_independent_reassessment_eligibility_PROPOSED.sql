-- M2 F8 Independent Learner reassessment ELIGIBILITY (database backstop) -- PROPOSED. NOT APPLIED. Requires approval.
-- Requires: m2_assessment_packages_PROPOSED.sql and m2_reassessment_foundation_PROPOSED.sql applied first.
-- Rollback: m2_independent_reassessment_eligibility_ROLLBACK_PROPOSED.sql
-- Verification: m2_independent_reassessment_eligibility_VERIFY_READONLY.sql
--
-- ADDITIVE ONLY: one extra BEFORE INSERT trigger on m2_reassessment_assignments. Nothing in the Phase 2 foundation is
-- replaced. The Phase 2 guard already requires, for an Independent Learner self-start: both gates ON, an interval
-- configured, an Independent Learner package, a published + educator-endorsed version, a general_user learner starting
-- it for themselves, one active per language and never the same version twice. This adds the two rules it lacks:
--   1. a server-verified INITIAL diagnostic in that language (any version: a future initial version forces no retake);
--   2. the configured waiting interval has passed since the learner's latest official result in that language
--      (initial or recorded reassessment). The interval is an adviser decision: it stays UNSET (and Independent
--      Learner reassessment OFF) until approved; no score threshold is used.
-- Classroom assignments are unaffected. Existing data is not read or changed.
begin;

do $$
begin
  if to_regclass('public.m2_reassessment_assignments') is null
     or to_regprocedure('public.m2_initial_diagnostic_completed(uuid,text)') is null then
    raise exception 'STOP: apply m2_reassessment_foundation_PROPOSED.sql first';
  end if;
  if to_regprocedure('public.m2_check_independent_eligibility()') is not null then
    raise exception 'STOP: the Independent Learner eligibility check is already installed';
  end if;
end $$;

create function public.m2_check_independent_eligibility() returns trigger language plpgsql set search_path = '' as $$
declare
  v_days integer;
  v_last timestamptz;
begin
  -- Referential actions and classroom assignments pass through untouched.
  if new.kind is distinct from 'independent' or pg_trigger_depth() > 1 then return new; end if;
  -- Runs after m2_guard_reassessment_assignment (trigger names sort alphabetically), so new.language is the package's.
  if not public.m2_initial_diagnostic_completed(new.student_id, new.language) then
    raise exception 'Complete the initial diagnostic in this language first' using errcode = '42501';
  end if;
  select independent_min_days_between into v_days from public.m2_reassessment_settings;
  if v_days is null then
    raise exception 'The Independent Learner waiting interval is not set' using errcode = '42501';
  end if;
  select max(d.verified_at) into v_last from public.diagnostic_results d
    where d.user_id = new.student_id and d.language = new.language and d.verification_status = 'server_verified'
      and (d.assessment_type = 'initial' or (d.assessment_type = 'reassessment' and d.package_version_id is not null));
  if v_last is not null and v_last > now() - make_interval(days => v_days) then
    raise exception 'The waiting interval since the last official result has not passed yet' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger m2_reassessment_independent_eligibility before insert on public.m2_reassessment_assignments
  for each row execute function public.m2_check_independent_eligibility();
revoke all on function public.m2_check_independent_eligibility() from public, anon, authenticated, service_role;

commit;
