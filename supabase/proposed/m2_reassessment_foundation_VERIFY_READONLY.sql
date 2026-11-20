-- READ-ONLY verification for m2_reassessment_foundation_PROPOSED.sql. Aggregates only; no learner data is printed.
begin transaction read only;

with checks(name, ok) as (
  select 'gates exist and are BOTH OFF', exists (select 1 from public.m2_reassessment_settings
    where not official_reassessment_enabled and not independent_learner_enabled)
  union all
  select 'backend can read but not change the gates',
    has_table_privilege('service_role', 'public.m2_reassessment_settings', 'SELECT')
    and not has_table_privilege('service_role', 'public.m2_reassessment_settings', 'UPDATE')
    and not has_table_privilege('service_role', 'public.m2_reassessment_settings', 'INSERT')
  union all
  select 'RLS on, no policies, no browser grants (assignments, settings)',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.m2_reassessment_assignments'::regclass, 'public.m2_reassessment_settings'::regclass))
    and not exists (select 1 from pg_policies where tablename in ('m2_reassessment_assignments', 'm2_reassessment_settings'))
    and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
      and table_name in ('m2_reassessment_assignments', 'm2_reassessment_settings') and grantee in ('anon', 'authenticated', 'PUBLIC'))
  union all
  select 'backend cannot delete assignments',
    not has_table_privilege('service_role', 'public.m2_reassessment_assignments', 'DELETE')
  union all
  select 'diagnostic_results allows initial and reassessment only',
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.diagnostic_results'::regclass
      and conname = 'diagnostic_results_assessment_type_check') like '%initial%reassessment%'
  union all
  select 'reassessment link constraint installed',
    exists (select 1 from pg_constraint where conrelid = 'public.diagnostic_results'::regclass and conname = 'diagnostic_results_reassessment_link_check')
  union all
  select 'every initial result has no package link',
    not exists (select 1 from public.diagnostic_results where assessment_type = 'initial'
      and (package_version_id is not null or content_sha256 is not null or reassessment_assignment_id is not null))
  union all
  select 'no reassessment result while gates are off',
    not exists (select 1 from public.diagnostic_results where assessment_type = 'reassessment')
    or (select official_reassessment_enabled from public.m2_reassessment_settings)
  union all
  select 'guards installed (assignments, results, settings)',
    exists (select 1 from pg_trigger where tgname = 'm2_guard_reassessment_assignment' and not tgisinternal)
    and exists (select 1 from pg_trigger where tgname = 'diagnostic_results_reassessment_guard' and not tgisinternal)
    and exists (select 1 from pg_trigger where tgname = 'm2_guard_reassessment_settings' and not tgisinternal)
  union all
  select 'duplicate protections (indexes)',
    to_regclass('public.m2_one_active_reassessment_per_language') is not null
    and to_regclass('public.m2_one_assignment_per_version') is not null
    and to_regclass('public.diagnostic_results_one_per_assignment') is not null
    and to_regclass('public.diagnostic_results_one_per_package_version') is not null
  union all
  select 'recording function is backend-only (security definer)',
    (select prosecdef from pg_proc where oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::regprocedure)
    and not has_function_privilege('authenticated', 'public.m2_record_reassessment_result(uuid,uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.m2_record_reassessment_result(uuid,uuid,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.m2_record_reassessment_result(uuid,uuid,jsonb)', 'EXECUTE')
  union all
  select 'lookups are backend-only',
    not has_function_privilege('authenticated', 'public.m2_current_reading_level(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.m2_initial_diagnostic_completed(uuid,text)', 'EXECUTE')
  union all
  select 'M8 input unchanged: m2_trusted_reading_level still initial-only',
    (select prosrc from pg_proc where oid = 'public.m2_trusted_reading_level(uuid,text)'::regprocedure) like '%assessment_type = ''initial''%'
  union all
  select 'every assignment references a published-or-retired, endorsed-at-creation version (sanity)',
    not exists (select 1 from public.m2_reassessment_assignments a join public.m2_assessment_package_versions v on v.id = a.package_version_id
      where v.status not in ('published', 'retired'))
)
select name, case when ok then 'PASS' else 'FAIL' end as result from checks;

select assessment_type, verification_status, count(*) as results from public.diagnostic_results group by 1, 2 order by 1, 2;
select kind, status, count(*) as assignments from public.m2_reassessment_assignments group by 1, 2 order by 1, 2;
-- Fingerprints to compare with the pre-migration values (function bodies M8 depends on; must be identical).
select proname, md5(prosrc) as body_md5 from pg_proc
where proname in ('m2_trusted_reading_level', 'm8_sync_diagnostic', 'm8_badge_eligible', 'm8_verified_difficulty_summary',
                  'm8_on_comprehension_completed', 'm2_protect_diagnostic_verification')
order by proname;

rollback;
