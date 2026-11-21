-- READ-ONLY verification for m7_staff_practice_queue_PROPOSED.sql. Changes nothing. Every row is PASS or FAIL.
begin transaction read only;
with fn as (
  select md5(replace(pg_get_functiondef('public.m7_enqueue_completion()'::regprocedure), chr(13), '')) as m7,
         (select proacl::text from pg_proc where oid = 'public.m7_enqueue_completion()'::regprocedure) as acl,
         (select prosecdef from pg_proc where oid = 'public.m7_enqueue_completion()'::regprocedure) as secdef
), checks(label, ok, detail) as (
  select 'not applied yet: m7_enqueue_completion is the pre-migration body', m7 = '563885607c852a10581f83699c7efd74', m7 from fn
  union all select 'applied: m7_enqueue_completion skips every staff role', m7 = 'c891e0b55b6c6355a1e56e1e39649d28', m7 from fn
  union all select 'still SECURITY DEFINER with grants postgres + service_role only', secdef and acl = '{postgres=X/postgres,service_role=X/postgres}', acl from fn
  union all select 'trigger m7_completed_quiz still uses it', exists (select 1 from pg_trigger where tgname = 'm7_completed_quiz'
      and tgrelid = 'public.m6_comprehension_attempts'::regclass and tgfoid = 'public.m7_enqueue_completion()'::regprocedure), ''
)
select case when ok then 'PASS' else 'FAIL' end as result, label, detail from checks;
rollback;
