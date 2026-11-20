-- ROLLBACK for m2_assessment_packages_PROPOSED.sql -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Refuses while any AUTHORED version or educator review record exists, so no educator-written content or review
-- evidence is silently lost. The reassessment foundation must be rolled back first.
-- Code-import rows (a copy of the code-defined version 3.0 diagnostic, which stays in the code) may be removed.
-- Nothing else is touched: diagnostic_results, scoring, M3, M7 and M8 do not depend on these tables.
begin;

do $$
declare authored integer;
begin
  if to_regclass('public.m2_assessment_package_versions') is null then
    raise exception 'STOP: m2_assessment_packages is not installed';
  end if;
  if to_regclass('public.m2_reassessment_assignments') is not null then
    raise exception 'STOP: roll back m2_reassessment_foundation first';
  end if;
  if exists (select 1 from public.m2_assessment_educator_reviews) then
    raise exception 'STOP: educator review records exist. Export them before removing the feature.';
  end if;
  select count(*) into authored from public.m2_assessment_package_versions where source <> 'code_import';
  if authored > 0 then
    raise exception 'STOP: % authored assessment version(s) exist. Export them before removing the feature.', authored;
  end if;
end $$;

drop trigger m2_guard_educator_review on public.m2_assessment_educator_reviews;
drop table public.m2_assessment_educator_reviews;
drop function public.m2_guard_educator_review();
drop function public.m2_version_educator_endorsed(uuid);
drop trigger m2_guard_assessment_version on public.m2_assessment_package_versions;
drop trigger m2_guard_assessment_package on public.m2_assessment_packages;
drop trigger m2_require_package_owner on public.m2_assessment_packages;
drop table public.m2_assessment_package_versions;
drop table public.m2_assessment_packages;
drop function public.m2_publish_assessment_version(uuid, uuid);
drop function public.m2_guard_assessment_version();
drop function public.m2_guard_assessment_package();
drop function public.m2_require_package_owner();
drop function public.m2_assessment_content_sha256(text, jsonb, jsonb);
drop function public.m2_assessment_content_issues(text, jsonb, jsonb);

commit;
