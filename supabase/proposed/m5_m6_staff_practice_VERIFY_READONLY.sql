-- READ-ONLY verification for m5_m6_staff_practice_PROPOSED.sql. Changes nothing.
-- Run AFTER applying. Every check must be PASS and the last row must be 'OVERALL | PASS'; any FAIL means the
-- migration is not in the reviewed state (see the runbook: recovery uses the ROLLBACK file).
-- Before applying, use m5_m6_staff_practice_PREFLIGHT_READONLY.sql instead (this file then reports FAIL on purpose).
begin transaction read only;
with fn as (
  select md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure), chr(13), '')) as m6,
         md5(replace(pg_get_functiondef('public.m6_assert_learner_completion_access(uuid)'::regprocedure), chr(13), '')) as learner,
         (select proacl::text from pg_proc where oid = 'public.m6_assert_completion_access(uuid)'::regprocedure) as acl,
         (select prosecdef from pg_proc where oid = 'public.m6_assert_completion_access(uuid)'::regprocedure) as secdef
), checks(label, ok, detail) as (
  select 'm6_assert_completion_access is the reviewed staff-practice body (applied)',
    m6 = '98b2de24a6764ee26c1d3b1869c4d225', m6 from fn
  union all select 'learner completion rules unchanged (m6_assert_learner_completion_access)',
    learner = '86c31b952cca1a12f3f1d0de1a5b3a95', learner from fn
  union all select 'm6_assert_completion_access is still SECURITY INVOKER with grants postgres + service_role only',
    not secdef and acl = '{postgres=X/postgres,service_role=X/postgres}', acl from fn
  union all select 'm6_apply_action and the M8 completion trigger still call it',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('m6_apply_action', 'm8_on_comprehension_completed')
       and prosrc like '%m6_assert_completion_access%') = 2, ''
  union all select 'staff practice earns no M8 reward (completion reward limited to student/general_user)',
    (select prosrc like '%role in (''student'',''general_user'')%' from pg_proc where oid = 'public.m8_on_comprehension_completed()'::regprocedure), ''
  union all select 'M1 multi-tenancy present (schools, profiles.school_id)',
    to_regclass('public.schools') is not null
    and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'school_id'), ''
)
select case when ok then 'PASS' else 'FAIL' end as result, label, detail from checks
union all
select case when bool_and(ok) then 'PASS' else 'FAIL' end, 'OVERALL', count(*) filter (where not ok)::text || ' failed of ' || count(*)::text from checks;
rollback;
