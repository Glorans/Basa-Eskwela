-- READ-ONLY checks for m6_admin_practice_PROPOSED.sql. SELECT statements only; no names or emails.
-- Run before applying (preflight) and again after applying or rolling back.

-- 1. Live definitions the proposal depends on, with CR-normalized md5 for the guards.
--    Review each body against the repository before filling the md5 values into the proposal.
select p.oid::regprocedure as function, p.prosecdef as security_definer,
       md5(replace(pg_get_functiondef(p.oid), chr(13), '')) as md5,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.oid in (
  to_regprocedure('public.m6_assert_completion_access(uuid)'),
  to_regprocedure('public.m6_assert_learner_completion_access(uuid)'),
  to_regprocedure('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)'),
  to_regprocedure('public.m8_on_comprehension_completed()'),
  to_regprocedure('public.m7_enqueue_completion()'),
  to_regprocedure('public.m8_oral_completed()'))
order by 1;

-- 2. Every trigger on the M5/M6 attempt tables. Any insert-time guard here (for example from
--    the M4 recipient or archive work) must also accept an Admin's own module attempt.
select c.relname as table_name, t.tgname as trigger_name, t.tgfoid::regprocedure as function,
       md5(replace(pg_get_functiondef(t.tgfoid), chr(13), '')) as md5
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal and c.relname in ('m6_comprehension_attempts', 'm6_comprehension_responses', 'oral_reading_attempts')
order by 1, 2;

-- 3. Client privileges must stay closed.
select fn, has_function_privilege('anon', fn, 'EXECUTE') as anon, has_function_privilege('authenticated', fn, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', fn, 'EXECUTE') as service_role
from unnest(array['public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'public.m6_assert_completion_access(uuid)']) fn
where to_regprocedure(fn) is not null;

-- 4. Eligible content: published, not deleted Admin-created modules and their reviewed questions by type.
select m.id as module_id, mp.id as passage_id,
       count(*) filter (where q.question_type = 'literal') as literal,
       count(*) filter (where q.question_type = 'inferential') as inferential,
       count(*) filter (where q.question_type = 'critical') as critical
from public.modules m
join public.profiles creator on creator.id = m.created_by and creator.role = 'admin'
join public.module_passages mp on mp.module_id = m.id
left join public.comprehension_questions q on q.module_id = m.id and q.passage_id = mp.id
  and q.material_id is null and q.review_status = 'reviewed'
where m.status = 'published' and m.deleted_at is null
group by 1, 2 order by 1, 2;

-- 5. Attempts and rewards by owner role: Admin rows must never appear in XP, badges, reading days or the risk queue.
select coalesce(p.role, 'none') as role, a.status, count(*) from public.m6_comprehension_attempts a
left join public.profiles p on p.id = a.user_id group by 1, 2 order by 1, 2;
select 'xp_events' as source, count(*) from public.m8_xp_events x join public.profiles p on p.id = x.user_id where p.role = 'admin'
union all select 'earned_badges', count(*) from public.m8_earned_badges b join public.profiles p on p.id = b.user_id where p.role = 'admin'
union all select 'reading_days', count(*) from public.m8_reading_days d join public.profiles p on p.id = d.user_id where p.role = 'admin'
union all select 'learner_progress', count(*) from public.m8_learner_progress g join public.profiles p on p.id = g.user_id where p.role = 'admin'
union all select 'risk_queue', count(*) from public.m7_risk_queue q join public.profiles p on p.id = q.id where p.role = 'admin';

-- 6. Ownership integrity: every M6 attempt is linked to its owner's own reading, once.
select count(*) filter (where r.id is null or r.user_id <> a.user_id) as cross_owner_or_missing,
       count(*) - count(distinct (a.user_id, a.oral_reading_attempt_id)) as duplicates
from public.m6_comprehension_attempts a
left join public.oral_reading_attempts r on r.id = a.oral_reading_attempt_id
where a.oral_reading_attempt_id is not null;
