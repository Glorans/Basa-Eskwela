-- READ-ONLY verification for m2_initial_activation_PROPOSED.sql. Aggregates only.
begin transaction read only;

with checks(name, ok) as (
  select 'one activation row per language', (select count(*) from public.m2_initial_activation) = 2
    and exists (select 1 from public.m2_initial_activation where language = 'en') and exists (select 1 from public.m2_initial_activation where language = 'fil')
  union all
  select 'RLS on, no policies, no browser grants',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.m2_initial_activation'::regclass, 'public.m2_initial_activation_events'::regclass))
    and not exists (select 1 from pg_policies where tablename in ('m2_initial_activation', 'm2_initial_activation_events'))
    and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
      and table_name in ('m2_initial_activation', 'm2_initial_activation_events') and grantee in ('anon', 'authenticated', 'PUBLIC'))
  union all
  select 'backend reads but cannot write directly',
    has_table_privilege('service_role', 'public.m2_initial_activation', 'SELECT')
    and not has_table_privilege('service_role', 'public.m2_initial_activation', 'UPDATE')
    and not has_table_privilege('service_role', 'public.m2_initial_activation_events', 'INSERT')
  union all
  select 'activation function is backend-only and security definer',
    (select prosecdef from pg_proc where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure)
    and has_function_privilege('service_role', 'public.m2_activate_initial_version(text,uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.m2_activate_initial_version(text,uuid,uuid,uuid)', 'EXECUTE')
  union all
  select 'one verified initial diagnostic per learner per language (index)',
    to_regclass('public.diagnostic_results_one_verified_initial_per_language') is not null
    and not exists (select 1 from public.diagnostic_results where assessment_type = 'initial' and verification_status = 'server_verified'
      group by user_id, language having count(*) > 1)
  union all
  select 'history is append-only (guard installed)',
    exists (select 1 from pg_trigger where tgname = 'm2_guard_initial_activation_events' and not tgisinternal)
  union all
  select 'every activated version is a published-or-retired authored version of its language''s initial lineage',
    not exists (select 1 from public.m2_initial_activation a join public.m2_assessment_package_versions v on v.id = a.package_version_id
      join public.m2_assessment_packages p on p.id = v.package_id
      where p.kind <> 'initial' or p.language <> a.language or v.source <> 'authored' or v.status not in ('published', 'retired'))
)
select name, case when ok then 'PASS' else 'FAIL' end as result from checks;

select a.language, coalesce(v.version_label, '3.0 (built-in)') as active_version, a.activated_at
from public.m2_initial_activation a left join public.m2_assessment_package_versions v on v.id = a.package_version_id order by 1;
select language, count(*) as activation_changes from public.m2_initial_activation_events group by 1 order by 1;

rollback;
