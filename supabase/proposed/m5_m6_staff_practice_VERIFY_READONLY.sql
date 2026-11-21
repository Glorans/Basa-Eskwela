-- READ-ONLY verification for m5_m6_staff_practice_PROPOSED.sql. Changes nothing. Every row is PASS or FAIL.
-- Run once BEFORE applying (expect: 'not applied yet' PASS, 'applied' FAIL) and AFTER applying (expect all PASS
-- except 'not applied yet').
begin transaction read only;
with fn as (
  select md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure), chr(13), '')) as m6,
         md5(replace(pg_get_functiondef('public.m6_assert_learner_completion_access(uuid)'::regprocedure), chr(13), '')) as learner,
         (select proacl::text from pg_proc where oid = 'public.m6_assert_completion_access(uuid)'::regprocedure) as acl,
         (select prosecdef from pg_proc where oid = 'public.m6_assert_completion_access(uuid)'::regprocedure) as secdef
), checks(label, ok, detail) as (
  select 'not applied yet: m6_assert_completion_access is the pre-migration body', m6 = 'c9a82099899e7caa47c92ef70c800bd4', m6 from fn
  union all select 'applied: m6_assert_completion_access is the reviewed staff-practice body', m6 = '98b2de24a6764ee26c1d3b1869c4d225', m6 from fn
  union all select 'learner rules unchanged (m6_assert_learner_completion_access)', learner = '86c31b952cca1a12f3f1d0de1a5b3a95', learner from fn
  union all select 'still SECURITY INVOKER with grants postgres + service_role only', not secdef and acl = '{postgres=X/postgres,service_role=X/postgres}', acl from fn
  union all select 'm6_apply_action and the M8 completion trigger still call it', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('m6_apply_action', 'm8_on_comprehension_completed') and prosrc like '%m6_assert_completion_access%') = 2, ''
  union all select 'staff practice earns no M8 reward (completion reward limited to student/general_user)',
      (select prosrc like '%role in (''student'',''general_user'')%' from pg_proc where oid = 'public.m8_on_comprehension_completed()'::regprocedure), ''
  union all select 'M1 multi-tenancy present (schools, profiles.school_id)', to_regclass('public.schools') is not null, ''
)
select case when ok then 'PASS' else 'FAIL' end as result, label, detail from checks;
rollback;
