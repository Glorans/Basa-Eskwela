-- READ-ONLY checks for m8_reward_eligibility_PROPOSED.sql and m8_badge_completions_PROPOSED.sql.
-- SELECT only; prints IDs and counts, no names.

-- 1. Live definitions and CR-normalized md5 for the proposals' guards.
select p.oid::regprocedure as function, md5(replace(pg_get_functiondef(p.oid), chr(13), '')) as md5, pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.oid in (to_regprocedure('public.m8_oral_completed()'), to_regprocedure('public.m8_grant_xp(uuid,text,uuid,integer)'),
  to_regprocedure('public.m8_record_reading_day(uuid,date)'), to_regprocedure('public.m8_on_comprehension_completed()'))
order by 1;

-- 2. M8 rows owned by non-learners (should be none). Report only; nothing is corrected automatically.
select 'learner_progress' as source, p.role, count(*) from public.m8_learner_progress g join public.profiles p on p.id = g.user_id
  where p.role is distinct from 'student' and p.role is distinct from 'general_user' group by p.role
union all select 'reading_days', p.role, count(*) from public.m8_reading_days d join public.profiles p on p.id = d.user_id
  where p.role is distinct from 'student' and p.role is distinct from 'general_user' group by p.role
union all select 'earned_badges', p.role, count(*) from public.m8_earned_badges b join public.profiles p on p.id = b.user_id
  where p.role is distinct from 'student' and p.role is distinct from 'general_user' group by p.role
union all select 'xp_events', p.role, count(*) from public.m8_xp_events x join public.profiles p on p.id = x.user_id
  where p.role is distinct from 'student' and p.role is distinct from 'general_user' group by p.role;

-- 3. Learners who would qualify for First Read / Bookworm under the badge proposal but do not hold them
--    (they would receive them at their next XP-earning completion; nothing is backfilled).
select x.user_id, count(*) as xp_completions,
       bool_or(b.badge_id = 'first_read') as has_first_read, bool_or(b.badge_id = 'bookworm') as has_bookworm
from public.m8_xp_events x left join public.m8_earned_badges b on b.user_id = x.user_id and b.badge_id in ('first_read','bookworm')
group by x.user_id order by 2 desc;
