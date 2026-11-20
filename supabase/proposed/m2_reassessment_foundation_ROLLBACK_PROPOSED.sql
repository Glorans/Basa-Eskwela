-- ROLLBACK for m2_reassessment_foundation_PROPOSED.sql -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Refuses while any assignment or official reassessment result exists, so no learner history is lost.
-- Restores diagnostic_results exactly to its initial-only shape; existing initial results are not touched.
begin;

do $$
begin
  if to_regclass('public.m2_reassessment_assignments') is null then
    raise exception 'STOP: the reassessment foundation is not installed';
  end if;
  if exists (select 1 from public.m2_reassessment_assignments) then
    raise exception 'STOP: reassessment assignments exist. Export them before removing the foundation.';
  end if;
  if exists (select 1 from public.diagnostic_results where assessment_type <> 'initial' or package_version_id is not null
             or content_sha256 is not null or reassessment_assignment_id is not null) then
    raise exception 'STOP: official reassessment results exist. Export them before removing the foundation.';
  end if;
end $$;

drop trigger diagnostic_results_reassessment_guard on public.diagnostic_results;
drop index public.diagnostic_results_one_per_assignment;
drop index public.diagnostic_results_one_per_package_version;
alter table public.diagnostic_results drop constraint diagnostic_results_reassessment_link_check;
alter table public.m2_reassessment_assignments drop constraint m2_assignment_result_fk;
alter table public.diagnostic_results
  drop column reassessment_assignment_id,
  drop column content_sha256,
  drop column package_version_id;
alter table public.diagnostic_results drop constraint diagnostic_results_assessment_type_check;
alter table public.diagnostic_results
  add constraint diagnostic_results_assessment_type_check check (assessment_type = 'initial');

drop function public.m2_record_reassessment_result(uuid, uuid, jsonb);
drop function public.m2_current_reading_level(uuid, text);
drop function public.m2_initial_diagnostic_completed(uuid, text);
drop trigger m2_guard_reassessment_assignment on public.m2_reassessment_assignments;
drop table public.m2_reassessment_assignments;
drop function public.m2_guard_reassessment_assignment();
drop function public.m2_guard_reassessment_result();
drop function public.m2_reassessment_writer();
drop trigger m2_guard_reassessment_settings on public.m2_reassessment_settings;
drop table public.m2_reassessment_settings;
drop function public.m2_guard_reassessment_settings();

notify pgrst, 'reload schema';
commit;
