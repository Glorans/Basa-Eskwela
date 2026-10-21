-- M8: Classroom-scoped leaderboard. Depends on M4 rooms and enrollments.
-- Read-only, authenticated, and never exposes learners from unrelated rooms.
begin;
create or replace function public.m8_weekly_leaderboard()
returns table(user_id uuid, display_name text, xp bigint, difficulty text)
language sql stable security definer set search_path = '' as $$
 with me as (select auth.uid() id),
 classmates as (
   select distinct e2.student_id id
   from public.enrollments e1
   join public.enrollments e2 on e1.room_id=e2.room_id
   join public.rooms r on r.id=e1.room_id
   where e1.student_id=(select id from me)
   -- Only valid classroom members; no all-users ranking.
 ), visible as (
   select id from classmates
   union select id from me where id is not null
 ), weekly as (
   select x.user_id, sum(x.xp_earned)::bigint xp
   from public.m8_xp_events x
   where x.created_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
   group by x.user_id
 )
 select v.id,
   case when v.id=(select id from me) then 'You'
        else 'Reader ' || upper(substr(replace(v.id::text,'-',''),1,6)) end,
   coalesce(w.xp,0), coalesce(p.unlocked_difficulty,'Easy')
 from visible v
 left join weekly w on w.user_id=v.id
 left join public.m8_learner_progress p on p.user_id=v.id
 order by coalesce(w.xp,0) desc, v.id
 limit 100;
$$;
revoke all on function public.m8_weekly_leaderboard() from public, anon;
grant execute on function public.m8_weekly_leaderboard() to authenticated;
notify pgrst,'reload schema';
commit;
