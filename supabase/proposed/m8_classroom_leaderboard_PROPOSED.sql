-- PROPOSAL ONLY. Do not execute against Staging, production, or a team database without approval.
-- Team feedback F: per-classroom weekly leaderboard.
-- m8_weekly_leaderboard() ranks the caller with classmates from ALL of their classrooms combined,
-- and students cannot read classmates' enrollments under RLS, so the page cannot split it by room.
-- This adds a room-scoped variant. Same week boundary (Monday 00:00 Asia/Manila), same XP source
-- (m8_xp_events), same pseudonymous names and same 100-row limit. XP rules are NOT changed and
-- m8_weekly_leaderboard() is left exactly as it is.
-- Not re-runnable: a second run fails on the existing function and rolls back unchanged.
begin;
set local lock_timeout = '5s';

create function public.m8_classroom_leaderboard(p_room_id uuid)
returns table(user_id uuid, display_name text, xp bigint, difficulty text)
language sql stable security definer set search_path = '' as $$
 with me as (select auth.uid() id),
 members as (
   -- Only members of a room the caller is enrolled in; anyone else gets no rows.
   select e.student_id id from public.enrollments e
   where e.room_id = p_room_id
     and exists (select 1 from public.enrollments mine
                 where mine.room_id = p_room_id and mine.student_id = (select id from me))
 ), weekly as (
   select x.user_id, sum(x.xp_earned)::bigint xp
   from public.m8_xp_events x
   where x.created_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
     and x.user_id in (select id from members)
   group by x.user_id
 )
 select m.id,
   case when m.id = (select id from me) then 'You'
        else 'Reader ' || upper(substr(replace(m.id::text, '-', ''), 1, 6)) end,
   coalesce(w.xp, 0), coalesce(p.unlocked_difficulty, 'Easy')
 from members m
 left join weekly w on w.user_id = m.id
 left join public.m8_learner_progress p on p.user_id = m.id
 order by coalesce(w.xp, 0) desc, m.id
 limit 100;
$$;

revoke all on function public.m8_classroom_leaderboard(uuid) from public, anon;
grant execute on function public.m8_classroom_leaderboard(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

-- ROLLBACK:
--   begin;
--   drop function public.m8_classroom_leaderboard(uuid);
--   notify pgrst, 'reload schema';
--   commit;
