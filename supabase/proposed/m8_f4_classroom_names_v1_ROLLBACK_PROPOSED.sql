-- ============================================================================
-- PROPOSED ROLLBACK - NOT APPLIED. Do not run without explicit approval.
-- Removes classroom display names (m8_f4_classroom_names_v1_PROPOSED.sql): classmates show as pseudonyms again.
-- ============================================================================
-- Restores m8_classroom_rankings to the F4 definition (013eeea), character for character, and drops the name
-- helper. It stores no data, so nothing is lost. Permissions are restated; the older leaderboards stay closed.
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.m8_classroom_display_name(text)') is null
    or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.m8_classroom_rankings(uuid,text)'::regprocedure) <> '20d1fb398e59a45a5a78aa3527bf9b2c' then
    raise exception 'Stop: classroom names are not installed as reviewed.';
  end if;
end $$;

create or replace function public.m8_classroom_rankings(p_room_id uuid, p_language text)
returns table(entry_id text, display_name text, xp bigint, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  if p_language is null or p_language not in ('en','fil') then raise exception 'Invalid language' using errcode = '22023'; end if;
  -- Only members of the room; anyone else gets no rows.
  if v_me is null or not exists (select 1 from public.enrollments e where e.room_id = p_room_id and e.student_id = v_me) then return; end if;
  return query
  with weekly as (
    select x.user_id, sum(x.xp_earned)::bigint points
    from public.m8_xp_events x
    join public.enrollments e on e.room_id = p_room_id and e.student_id = x.user_id
    where x.source_type <> 'daily_login'
      and x.created_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila'
      and public.m8_xp_event_language(x.source_type, x.source_id) = p_language
      and public.m8_xp_event_in_room(x.user_id, x.source_type, x.source_id, p_room_id)
    group by x.user_id
  )
  select md5('m8-room|' || p_room_id::text || '|' || e.student_id::text),
    case when e.student_id = v_me then 'You' else 'Reader ' || upper(substr(md5('m8-name|' || p_room_id::text || '|' || e.student_id::text), 1, 6)) end,
    coalesce(w.points, 0), e.student_id = v_me
  from public.enrollments e left join weekly w on w.user_id = e.student_id
  where e.room_id = p_room_id
  order by coalesce(w.points, 0) desc, 1
  limit 100;
end $$;
revoke all on function public.m8_classroom_rankings(uuid,text) from public, anon, service_role;
grant execute on function public.m8_classroom_rankings(uuid,text) to authenticated;
drop function public.m8_classroom_display_name(text);

do $$ begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.m8_classroom_rankings(uuid,text)'::regprocedure) <> '6c25e753256b68938ffa367f034156b0'
    or has_function_privilege('authenticated', 'public.m8_independent_leaderboard(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_classroom_leaderboard(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_weekly_leaderboard()', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_independent_leaderboard(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_classroom_leaderboard(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_weekly_leaderboard()', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE') then
    raise exception 'Postcondition: F4 classroom rankings not restored';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
