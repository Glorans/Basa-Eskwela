-- PROPOSED - NOT APPLIED - rollback for m8_reward_eligibility_PROPOSED.sql
-- Restores m8_oral_completed() exactly as in supabase/staging/c2_m8_gamification_hardened.sql.
-- DDL only; rows written while the fix was active stay as they are.
begin;

-- Guard: only the applied eligibility definition is rolled back (PGlite fingerprint, PostgreSQL 17).
do $$ begin
  if md5(replace(pg_get_functiondef('public.m8_oral_completed()'::regprocedure), chr(13), ''))
      is distinct from '481b127983d4f167e3c005df82f30b01' then
    raise exception 'Stop: m8_oral_completed is not the applied eligibility definition (not applied, or changed since).';
  end if;
end $$;
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
REVOKE EXECUTE ON FUNCTION public.m8_oral_completed() FROM PUBLIC, anon, authenticated;

-- Postcondition: byte-identical to the live definition read from ReadFlow-Staging (2026-11-05).
do $$ begin
  if md5(replace(pg_get_functiondef('public.m8_oral_completed()'::regprocedure), chr(13), ''))
      is distinct from '76c29f67f939493194c7fb5c8a191bdb' then
    raise exception 'Postcondition: m8_oral_completed was not restored exactly.';
  end if;
end $$;
commit;
