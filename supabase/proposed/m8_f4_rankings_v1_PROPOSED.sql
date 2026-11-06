-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval. Apply after M8 F1.
-- M8 F4 View Leaderboard: room-scoped, per-language, private rankings.
-- ============================================================================
--
-- Found in the existing leaderboards (their definitions stay; client access is removed below):
--   * m8_classroom_leaderboard sums a member's XP from everywhere, not from that classroom.
--   * Every row sends the classmate's real user ID and reading level to the browser.
--   * English earns performance XP and Filipino fixed XP during the pilot, so one total ranks unlike things.
-- New functions:
--   * Classroom XP counts only activities done in that room. Daily login never counts. Each XP row is
--     already unique, so duplicates cannot rank.
--   * Each language ranks separately. Language comes from the activity's source.
--   * Rows carry an opaque ID, a pseudonym and is_me; no name, nickname, email, user ID or reading level.
--     The viewer's own row says "You". Classroom pseudonyms are per room. Independent Learner pseudonyms
--     stay the same across one ranking period and change when a new week starts.
--   * Clients can no longer call the three older functions, which return user IDs and reading levels (and
--     nicknames). Apply this after the frontend that uses the new functions is live; a tab left open from
--     before then shows a leaderboard error until it is refreshed.
-- Weekly means from Monday 00:00 Asia/Manila. Historical XP stays in the language of its activity.
-- Rollback: m8_f4_rankings_v1_ROLLBACK_PROPOSED.sql. Test: server/tests/m8F2F5Proposal.test.js
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.m8_passage_rewards') is null then
    raise exception 'Stop: apply m8_f1_xp_rewards_v1_PROPOSED.sql first.';
  end if;
  if to_regprocedure('public.m8_classroom_rankings(uuid,text)') is not null then
    raise exception 'Stop: M8 F4 is already installed.';
  end if;
end $$;

-- The language of the activity an XP row paid for. Null for the daily login, so it can never rank.
create function public.m8_xp_event_language(p_type text, p_source uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select case p_type
    when 'assignment' then (select public.m8_activity_language(ra.material_id, null)
      from public.reading_activity_assignments ra where ra.id = p_source)
    when 'module' then public.m8_activity_language(null, p_source)
    when 'module_bonus' then public.m8_activity_language(null, p_source)
    when 'passage' then (select public.m8_activity_language(case when pr.source_kind = 'material' then pr.source_id end, pr.module_id)
      from public.m8_passage_rewards pr where pr.id = p_source)
  end
$$;

-- Whether an XP row was earned in this classroom, from the saved activity it paid for.
create function public.m8_xp_event_in_room(p_user uuid, p_type text, p_source uuid, p_room uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case p_type
    when 'assignment' then exists (select 1 from public.reading_activity_assignments ra where ra.id = p_source and ra.room_id = p_room)
    when 'module' then exists (select 1 from public.m6_comprehension_attempts a
      where a.user_id = p_user and a.module_id = p_source and a.room_id = p_room and a.status = 'completed')
    when 'passage' then exists (select 1 from public.m8_passage_rewards pr
      left join public.m6_comprehension_attempts a on a.id = pr.comprehension_attempt_id
      left join public.oral_reading_attempts o on o.id = pr.reading_attempt_id
      where pr.id = p_source and coalesce(a.room_id, o.room_id) = p_room)
    when 'module_bonus' then exists (select 1 from public.modules m where coalesce(m.revision_root, m.id) = p_source and (
      exists (select 1 from public.m6_comprehension_attempts a where a.user_id = p_user and a.module_id = m.id and a.room_id = p_room and a.status = 'completed')
      or exists (select 1 from public.oral_reading_attempts o where o.user_id = p_user and o.module_id = m.id and o.room_id = p_room)))
    else false
  end
$$;

create function public.m8_classroom_rankings(p_room_id uuid, p_language text)
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

create function public.m8_independent_rankings(p_period text, p_language text)
returns table(entry_id text, display_name text, xp bigint, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_period_key text;
begin
  if v_me is null or not exists (select 1 from public.profiles p where p.id = v_me and p.role = 'general_user') then
    raise exception 'Independent learner access required' using errcode = '42501';
  end if;
  if p_period is null or p_period not in ('weekly','all_time') then raise exception 'Invalid period' using errcode = '22023'; end if;
  if p_language is null or p_language not in ('en','fil') then raise exception 'Invalid language' using errcode = '22023'; end if;
  -- One pseudonym per learner per ranking period, the same in both languages. A new week starts a new one.
  v_period_key := case p_period when 'all_time' then 'all_time'
    else (date_trunc('week', now() at time zone 'Asia/Manila'))::date::text end;
  return query
  with scores as (
    select x.user_id, sum(x.xp_earned)::bigint points
    from public.m8_xp_events x
    where x.source_type <> 'daily_login'
      and public.m8_xp_event_language(x.source_type, x.source_id) = p_language
      and (p_period = 'all_time' or x.created_at >= date_trunc('week', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila')
    group by x.user_id
  )
  select md5('m8-il|' || v_period_key || '|' || p.id::text),
    case when p.id = v_me then 'You' else 'Reader ' || upper(substr(md5('m8-il-name|' || v_period_key || '|' || p.id::text), 1, 6)) end,
    coalesce(s.points, 0), p.id = v_me
  from public.profiles p left join scores s on s.user_id = p.id
  where p.role = 'general_user'
  order by coalesce(s.points, 0) desc, 1
  limit 100;
end $$;
revoke all on function public.m8_independent_rankings(text,text) from public, anon, service_role;
grant execute on function public.m8_independent_rankings(text,text) to authenticated;

revoke all on function public.m8_xp_event_language(text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.m8_xp_event_in_room(uuid,text,uuid,uuid) from public, anon, authenticated, service_role;

-- The older functions keep their definitions, so F1's fingerprints and rollback still hold.
revoke execute on function public.m8_weekly_leaderboard() from authenticated;
revoke execute on function public.m8_classroom_leaderboard(uuid) from authenticated;
revoke execute on function public.m8_independent_leaderboard(text) from authenticated;

do $$ begin
  if has_function_privilege('authenticated', 'public.m8_independent_leaderboard(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_classroom_leaderboard(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_weekly_leaderboard()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.m8_independent_rankings(text,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE') then
    raise exception 'Postcondition: ranking access is wrong';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
