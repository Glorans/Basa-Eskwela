-- READ-ONLY verification for m2_assessment_packages_PROPOSED.sql. Run inside a read-only transaction.
-- Each row: check name, PASS/FAIL, detail. No data is changed and no learner content is printed.
begin transaction read only;

with checks(name, ok, detail) as (
  select 'tables exist', to_regclass('public.m2_assessment_packages') is not null and to_regclass('public.m2_assessment_package_versions') is not null, ''
  union all
  select 'RLS enabled on both tables',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.m2_assessment_packages'::regclass, 'public.m2_assessment_package_versions'::regclass, 'public.m2_assessment_educator_reviews'::regclass)), ''
  union all
  select 'no RLS policies (browser roles get nothing)',
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('m2_assessment_packages', 'm2_assessment_package_versions', 'm2_assessment_educator_reviews')), ''
  union all
  select 'anon/authenticated have no table privileges',
    not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
      and table_name in ('m2_assessment_packages', 'm2_assessment_package_versions', 'm2_assessment_educator_reviews') and grantee in ('anon', 'authenticated', 'PUBLIC')),
    (select coalesce(string_agg(distinct grantee || ':' || privilege_type, ','), '') from information_schema.role_table_grants where table_schema = 'public'
      and table_name in ('m2_assessment_packages', 'm2_assessment_package_versions', 'm2_assessment_educator_reviews') and grantee in ('anon', 'authenticated', 'PUBLIC'))
  union all
  select 'service_role can read and write (the backend authorizes)',
    has_table_privilege('service_role', 'public.m2_assessment_package_versions', 'SELECT')
    and has_table_privilege('service_role', 'public.m2_assessment_package_versions', 'INSERT')
    and has_table_privilege('service_role', 'public.m2_assessment_package_versions', 'UPDATE'), ''
  union all
  select 'guard triggers installed',
    exists (select 1 from pg_trigger where tgname = 'm2_guard_assessment_package' and not tgisinternal)
    and exists (select 1 from pg_trigger where tgname = 'm2_guard_assessment_version' and not tgisinternal), ''
  union all
  select 'browser roles cannot execute the functions',
    not has_function_privilege('authenticated', 'public.m2_assessment_content_issues(text,jsonb,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.m2_assessment_content_issues(text,jsonb,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.m2_guard_assessment_version()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.m2_publish_assessment_version(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.m2_publish_assessment_version(uuid,uuid)', 'EXECUTE'), ''
  union all
  select 'educator reviews: append-only guard; service_role cannot update or delete',
    exists (select 1 from pg_trigger where tgname = 'm2_guard_educator_review' and not tgisinternal)
    and not has_table_privilege('service_role', 'public.m2_assessment_educator_reviews', 'UPDATE')
    and not has_table_privilege('service_role', 'public.m2_assessment_educator_reviews', 'DELETE'), ''
  union all
  select 'endorsement needs all four checks (constraint)',
    exists (select 1 from pg_constraint where conname = 'm2_review_endorsement_needs_all_checks'), ''
  union all
  select 'every endorsed review has all four checks passed',
    not exists (select 1 from public.m2_assessment_educator_reviews where outcome = 'endorsed'
      and not (passage_suitable and questions_sound and answer_keys_correct and language_accurate)), ''
  union all
  select 'one published version per package (index)', to_regclass('public.m2_one_published_version_per_package') is not null, ''
  union all
  select 'one active initial package per language (index)', to_regclass('public.m2_one_active_initial_package_per_language') is not null, ''
  union all
  select 'no package has more than one published version',
    not exists (select 1 from public.m2_assessment_package_versions where status = 'published' group by package_id having count(*) > 1), ''
  union all
  select 'every frozen version has a content hash',
    not exists (select 1 from public.m2_assessment_package_versions where status <> 'draft' and content_sha256 is null), ''
  union all
  select 'diagnostic_results unchanged in shape (no new columns used here)',
    to_regclass('public.diagnostic_results') is not null, ''
)
select name, case when ok then 'PASS' else 'FAIL' end as result, detail from checks;

select kind, audience, scope, language, count(*) as packages from public.m2_assessment_packages group by 1, 2, 3, 4 order by 1, 2, 3, 4;
select v.status, v.source, count(*) as versions from public.m2_assessment_package_versions v group by 1, 2 order by 1, 2;
select outcome, count(*) as educator_reviews from public.m2_assessment_educator_reviews group by 1 order by 1;

rollback;
