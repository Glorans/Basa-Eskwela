-- PREPARED ONLY. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- Staging replacement for readflow/supabase/migrations/20261019000000_m8_gamification.sql
-- Original SQL preserved; only trigger-function EXECUTE revocations added before COMMIT.
-- Apply this whole file instead of the original; never apply both.
begin;
create table if not exists public.m8_learner_progress (
 user_id uuid primary key references auth.users(id) on delete cascade,
 total_xp integer not null default 0 check(total_xp>=0),
 completed_modules integer not null default 0,
 read_aloud_count integer not null default 0,
 current_streak integer not null default 0,
 longest_streak integer not null default 0,
 last_read_date date,
 unlocked_difficulty text not null default 'Easy' check(unlocked_difficulty in ('Easy','Medium','Hard')),
 updated_at timestamptz not null default now()
);
create table if not exists public.m8_xp_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 source_type text not null check(source_type in ('module','assignment')),
 source_id uuid not null,
 xp_earned integer not null check(xp_earned in (30,50,60,80)),
 created_at timestamptz not null default now(),
 unique(user_id,source_type,source_id)
);
create table if not exists public.m8_badges (
 id text primary key, name text not null, description text not null, icon text not null
);
create table if not exists public.m8_earned_badges (
 user_id uuid not null references auth.users(id) on delete cascade,
 badge_id text not null references public.m8_badges(id),
 earned_at timestamptz not null default now(),
 primary key(user_id,badge_id)
);
create table if not exists public.m8_reading_days (
 user_id uuid not null references auth.users(id) on delete cascade,
 reading_date date not null,
 primary key(user_id,reading_date)
);
insert into public.m8_badges(id,name,description,icon) values
 ('first_read','First Read','Complete your first module','Star'),
 ('streak_3','3-Day Streak','Read 3 consecutive days','Flame'),
 ('bookworm','Bookworm','Complete 5 modules','BookOpenCheck'),
 ('level_up','Level Up','Unlock Medium level','ArrowUpCircle'),
 ('consistent_reader','Consistent Reader','Read on 7 different days','CalendarCheck'),
 ('brave_reader','Brave Reader','Complete Read Aloud 10 times','Mic'),
 ('diamond','Diamond','Reach 2000 XP','Gem'),
 ('graduate','Graduate','Complete all required modules','GraduationCap')
on conflict(id) do update set name=excluded.name,description=excluded.description,icon=excluded.icon;

create or replace function public.m8_sync_diagnostic() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.reading_level not in ('Frustration','Instructional','Independent') then raise exception 'Invalid reading level'; end if;
 insert into public.m8_learner_progress(user_id,unlocked_difficulty) values
 (new.user_id,case new.reading_level when 'Independent' then 'Hard' when 'Instructional' then 'Medium' else 'Easy' end)
 on conflict(user_id) do update set unlocked_difficulty=excluded.unlocked_difficulty,updated_at=now();
 if new.reading_level in ('Independent','Instructional') then
  insert into public.m8_earned_badges(user_id,badge_id) values(new.user_id,'level_up') on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists m8_diagnostic_sync on public.diagnostic_results;
create trigger m8_diagnostic_sync after insert or update of reading_level on public.diagnostic_results
for each row execute function public.m8_sync_diagnostic();

-- Atomic XP grants from trusted completion records. Never expose this function to clients.
create or replace function public.m8_grant_xp(p_user uuid,p_type text,p_source uuid,p_xp integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted_count integer;
begin
 if p_type not in ('module','assignment') or p_xp not in (30,50,60,80) then raise exception 'Invalid XP grant'; end if;
 insert into public.m8_xp_events(user_id,source_type,source_id,xp_earned)
 values(p_user,p_type,p_source,p_xp) on conflict do nothing;
 get diagnostics inserted_count = row_count;
 if inserted_count=0 then return false; end if;
 insert into public.m8_learner_progress(user_id,total_xp,completed_modules)
 values(p_user,p_xp,case when p_type='module' then 1 else 0 end)
 on conflict(user_id) do update set total_xp=public.m8_learner_progress.total_xp+excluded.total_xp,
 completed_modules=public.m8_learner_progress.completed_modules+excluded.completed_modules,updated_at=now();
 if p_type='module' then
  insert into public.m8_earned_badges(user_id,badge_id)
  select p_user,'first_read' on conflict do nothing;
  insert into public.m8_earned_badges(user_id,badge_id)
  select p_user,'bookworm' where (select completed_modules from public.m8_learner_progress where user_id=p_user)>=5
  on conflict do nothing;
 end if;
 insert into public.m8_earned_badges(user_id,badge_id)
 select p_user,'diamond' where (select total_xp from public.m8_learner_progress where user_id=p_user)>=2000
 on conflict do nothing;
 return true;
end $$;
revoke all on function public.m8_grant_xp(uuid,text,uuid,integer) from public,anon,authenticated;

create or replace function public.m8_record_reading_day(p_user uuid,p_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare n integer; latest_date date;
begin
 insert into public.m8_reading_days(user_id,reading_date) values(p_user,p_date) on conflict do nothing;
 -- Recompute historical longest streak using consecutive-day islands.
 select coalesce(max(cnt),0) into n from (
  select count(*)::integer cnt from (
   select reading_date, reading_date - (row_number() over(order by reading_date))::integer as grp
   from public.m8_reading_days where user_id=p_user
  ) d group by grp
 ) s;
 select max(reading_date) into latest_date from public.m8_reading_days where user_id=p_user;
 insert into public.m8_learner_progress(user_id,last_read_date,longest_streak,current_streak)
 values(p_user,latest_date,n,0) on conflict(user_id) do update set
 last_read_date=excluded.last_read_date,longest_streak=greatest(public.m8_learner_progress.longest_streak,excluded.longest_streak),updated_at=now();
 -- Current streak counts backwards from the latest date if today/yesterday is active.
 update public.m8_learner_progress set current_streak=case
 when latest_date < (now() at time zone 'Asia/Manila')::date - 1 then 0
 else (select count(*) from (
  select reading_date,reading_date+(row_number() over(order by reading_date desc))::integer as grp
  from public.m8_reading_days where user_id=p_user
 ) x where grp=latest_date+1) end
 where user_id=p_user;
 if n>=3 then insert into public.m8_earned_badges(user_id,badge_id) values(p_user,'streak_3') on conflict do nothing; end if;
end $$;
revoke all on function public.m8_record_reading_day(uuid,date) from public,anon,authenticated;

create or replace function public.m8_oral_completed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.m8_learner_progress(user_id,read_aloud_count) values(new.user_id,1)
 on conflict(user_id) do update set read_aloud_count=public.m8_learner_progress.read_aloud_count+1,updated_at=now();
 perform public.m8_record_reading_day(new.user_id,(new.completed_at at time zone 'Asia/Manila')::date);
 insert into public.m8_earned_badges(user_id,badge_id)
 select new.user_id,'brave_reader' where
 (select read_aloud_count from public.m8_learner_progress where user_id=new.user_id)>=10 on conflict do nothing;
 return new;
end $$;
drop trigger if exists m8_oral_completed_trigger on public.oral_reading_attempts;
create trigger m8_oral_completed_trigger after insert on public.oral_reading_attempts
for each row execute function public.m8_oral_completed();

-- Learners may only SELECT their own records. No client writes to gamification tables.
do $$ declare t text; begin
 foreach t in array array['m8_learner_progress','m8_xp_events','m8_badges','m8_earned_badges','m8_reading_days'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy m8_self_progress on public.m8_learner_progress for select to authenticated using(user_id=auth.uid());
create policy m8_self_xp on public.m8_xp_events for select to authenticated using(user_id=auth.uid());
create policy m8_all_badges on public.m8_badges for select to authenticated using(true);
create policy m8_self_badges on public.m8_earned_badges for select to authenticated using(user_id=auth.uid());
create policy m8_self_days on public.m8_reading_days for select to authenticated using(user_id=auth.uid());

-- Weekly leaderboard is scoped to shared learning rooms. Independent learners see themselves only.
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

-- Sync existing diagnostic results (no XP backfill).
insert into public.m8_learner_progress(user_id,unlocked_difficulty)
select distinct on(user_id) user_id,
 case reading_level when 'Independent' then 'Hard' when 'Instructional' then 'Medium' else 'Easy' end
from public.diagnostic_results order by user_id,completed_at desc
on conflict(user_id) do update set unlocked_difficulty=excluded.unlocked_difficulty;
insert into public.m8_earned_badges(user_id,badge_id)
select user_id,'level_up' from public.m8_learner_progress where unlocked_difficulty in ('Medium','Hard')
on conflict do nothing;
notify pgrst,'reload schema';
-- Staging-only hardening: remove PUBLIC and direct client EXECUTE grants.
REVOKE EXECUTE ON FUNCTION public.m8_sync_diagnostic() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.m8_oral_completed() FROM PUBLIC, anon, authenticated;
commit;
