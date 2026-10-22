-- PREPARED ONLY. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- Staging replacement for readflow/supabase/migrations/20261020000000_m8_completion_integration.sql
-- Original SQL preserved; only trigger-function EXECUTE revocations added before COMMIT.
-- Apply this whole file instead of the original; never apply both.
-- Module 8 completion integration; run after 20261019_m8_gamification.sql.
begin;
-- Only database-verified M6 completions can award module / activity XP.
create or replace function public.m8_on_comprehension_completed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_module public.modules%rowtype; v_assignment public.reading_activity_assignments%rowtype;
 v_level text; v_allowed integer; v_tier integer; v_xp integer; v_granted boolean;
begin
 if new.status <> 'completed' or new.completed_at is null then return new; end if;
 if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;
 -- An M6 result is produced by the trusted comprehension backend, not client SQL.
 if new.module_id is not null then
   select * into v_module from public.modules where id=new.module_id;
   if not found then return new; end if;
   v_level := lower(v_module.difficulty);
   v_tier := case when v_level='easy' then 1 when v_level='medium' then 2 when v_level='hard' then 3 else 0 end;
   if v_tier=0 then raise exception 'Unknown module difficulty %',v_level; end if;
   select case unlocked_difficulty when 'Hard' then 3 when 'Medium' then 2 else 1 end
     into v_allowed from public.m8_learner_progress where user_id=new.user_id;
   -- Without a diagnostic assessment only Easy is accessible.
   if v_tier > coalesce(v_allowed,1) then raise exception 'Reading difficulty is locked'; end if;
   v_xp := case v_tier when 1 then 30 when 2 then 50 else 80 end;
   v_granted := public.m8_grant_xp(new.user_id,'module',new.module_id,v_xp);
 elsif new.activity_assignment_id is not null then
   select * into v_assignment from public.reading_activity_assignments
     where id=new.activity_assignment_id and student_id=new.user_id;
   if not found then raise exception 'Assignment does not belong to learner'; end if;
   v_granted := public.m8_grant_xp(new.user_id,'assignment',new.activity_assignment_id,60);
 else
   return new;
 end if;
 -- Only new verified completion awards a reading day; duplicates never farm streaks.
 if v_granted then
   perform public.m8_record_reading_day(new.user_id,(new.completed_at at time zone 'Asia/Manila')::date);
 end if;
 return new;
end $$;
revoke all on function public.m8_on_comprehension_completed() from public,anon,authenticated;
drop trigger if exists m8_m6_completed on public.m6_comprehension_attempts;
create trigger m8_m6_completed after insert or update of status on public.m6_comprehension_attempts
for each row execute function public.m8_on_comprehension_completed();

-- Fix the original streak logic: count consecutive days backwards from latest date.
create or replace function public.m8_record_reading_day(p_user uuid,p_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_longest int; v_current int; v_latest date; v_today date := (now() at time zone 'Asia/Manila')::date;
begin
 if p_date > v_today then raise exception 'Reading date cannot be in the future'; end if;
 insert into public.m8_reading_days(user_id,reading_date) values(p_user,p_date) on conflict do nothing;
 select max(reading_date) into v_latest from public.m8_reading_days where user_id=p_user;
 with numbered as (select reading_date, reading_date - row_number() over(order by reading_date)::int grp
 from public.m8_reading_days where user_id=p_user)
 select coalesce(max(n),0) into v_longest from (select count(*)::int n from numbered group by grp) t;
 with numbered as (select reading_date,reading_date + row_number() over(order by reading_date desc)::int grp
 from public.m8_reading_days where user_id=p_user)
 select case when v_latest >= v_today-1 then count(*)::int else 0 end into v_current
 from numbered where grp=v_latest+1;
 insert into public.m8_learner_progress(user_id,last_read_date,longest_streak,current_streak)
 values(p_user,v_latest,v_longest,v_current)
 on conflict(user_id) do update set last_read_date=excluded.last_read_date,
 longest_streak=excluded.longest_streak,current_streak=excluded.current_streak,updated_at=now();
 if v_longest>=3 then insert into public.m8_earned_badges(user_id,badge_id)
 values(p_user,'streak_3') on conflict do nothing; end if;
end $$;
revoke all on function public.m8_record_reading_day(uuid,date) from public,anon,authenticated;

-- Module 5 oral reading is counted by the earlier trigger. Make duplicate read-aloud
-- submissions harmless by only counting new rows and use the recorded completion date.
-- Graduate is based on all currently published modules; a new published module
-- can make completion progress incomplete but earned badges are permanent.
create or replace function public.m8_award_graduate(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from public.modules where status='published')
 and not exists (
   select 1 from public.modules m where m.status='published'
   and not exists(select 1 from public.m8_xp_events x where x.user_id=p_user
      and x.source_type='module' and x.source_id=m.id)
 ) then insert into public.m8_earned_badges(user_id,badge_id)
 values(p_user,'graduate') on conflict do nothing; end if;
end $$;
revoke all on function public.m8_award_graduate(uuid) from public,anon,authenticated;
create or replace function public.m8_on_module_xp_granted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.source_type='module' then perform public.m8_award_graduate(new.user_id); end if;
 return new;
end $$;
drop trigger if exists m8_graduate_check on public.m8_xp_events;
create trigger m8_graduate_check after insert on public.m8_xp_events
for each row execute function public.m8_on_module_xp_granted();

-- Secure read-only leaderboard scoped to classmates, without disclosing names.
-- Existing starter function requires enrollments; ReadFlow actually uses room_memberships.
-- Instead, return only the current learner until the exact classroom membership
-- schema is confirmed; never leak other users' progress.
create or replace function public.m8_weekly_leaderboard()
returns table(user_id uuid,display_name text,xp bigint,difficulty text)
language sql stable security definer set search_path = '' as $$
 select auth.uid(), 'You'::text, coalesce(sum(x.xp_earned),0)::bigint,
 coalesce(p.unlocked_difficulty,'Easy')
 from (select auth.uid() as id) me
 left join public.m8_learner_progress p on p.user_id=me.id
 left join public.m8_xp_events x on x.user_id=me.id
  and x.created_at >= date_trunc('week',now())
 group by p.unlocked_difficulty;
$$;
revoke all on function public.m8_weekly_leaderboard() from public,anon;
grant execute on function public.m8_weekly_leaderboard() to authenticated;
notify pgrst,'reload schema';
-- Staging-only hardening: remove PUBLIC and direct client EXECUTE grants.
REVOKE EXECUTE ON FUNCTION public.m8_on_module_xp_granted() FROM PUBLIC, anon, authenticated;
commit;
