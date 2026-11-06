-- PROPOSED - NOT APPLIED. Rollback of m8_f4_rankings_v1_PROPOSED.sql.
-- Removes the new rankings. Client access to the three older leaderboard functions stays CLOSED, because
-- they return user IDs, reading levels and nicknames. Until F4 is applied again, the leaderboard pages
-- show an error instead of rankings. That is deliberate: privacy holds during a rollback.
begin;
drop function public.m8_independent_rankings(text,text);
drop function public.m8_classroom_rankings(uuid,text);
drop function public.m8_xp_event_in_room(uuid,text,uuid,uuid);
drop function public.m8_xp_event_language(text,uuid);

do $$ begin
  if has_function_privilege('authenticated', 'public.m8_independent_leaderboard(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_classroom_leaderboard(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_weekly_leaderboard()', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_independent_leaderboard(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_classroom_leaderboard(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_weekly_leaderboard()', 'EXECUTE') then
    raise exception 'Postcondition: an older leaderboard function is callable by clients';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
