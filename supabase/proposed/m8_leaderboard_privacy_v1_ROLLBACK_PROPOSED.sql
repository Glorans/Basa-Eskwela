-- ROLLBACK for m8_leaderboard_privacy_v1_PROPOSED.sql.                                  PROPOSED - NOT APPLIED TO STAGING
-- Restores m8_classroom_rankings and m8_independent_rankings VERBATIM (classmates' profile nicknames shown
-- automatically again, Independent Learners anonymous) and removes the privacy choices and names switches.
-- WARNING: learners' saved leaderboard choices (nickname / anonymous / hidden) are deleted. Export
-- public.m8_leaderboard_privacy first if they must be kept. XP, rewards and every other table are untouched.

BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.m8_leaderboard_privacy') IS NULL OR to_regclass('public.m8_leaderboard_settings') IS NULL THEN
    RAISE EXCEPTION 'M8 leaderboard privacy is not applied; nothing was changed';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.m8_classroom_rankings(p_room_id uuid, p_language text)
 RETURNS TABLE(entry_id text, display_name text, xp bigint, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := auth.uid();
  v_names boolean;
begin
  if p_language is null or p_language not in ('en','fil') then raise exception 'Invalid language' using errcode = '22023'; end if;
  -- Only members of the room; anyone else gets no rows.
  if v_me is null or not exists (select 1 from public.enrollments e where e.room_id = p_room_id and e.student_id = v_me) then return; end if;
  -- Names only for an active Student in a classroom that is not archived. Otherwise the F4 pseudonyms, as before.
  v_names := exists (select 1 from public.profiles p where p.id = v_me and p.role = 'student' and p.status = 'active')
    and exists (select 1 from public.rooms r where r.id = p_room_id and r.archived_at is null);
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
  ), members as (
    -- This room's members only. A classmate's name only when they are an active Student with a safe nickname.
    select e.student_id sid,
      md5('m8-room|' || p_room_id::text || '|' || e.student_id::text) eid,
      'Reader ' || upper(substr(md5('m8-name|' || p_room_id::text || '|' || e.student_id::text), 1, 6)) pseudo,
      case when v_names then (select public.m8_classroom_display_name(p.nickname) from public.profiles p
        where p.id = e.student_id and p.role = 'student' and p.status = 'active') end safe
    from public.enrollments e
    where e.room_id = p_room_id
  ), labelled as (
    select m.*, count(*) filter (where m.sid <> v_me) over (partition by m.safe) same_name
    from members m
  )
  select l.eid,
    case
      when l.sid = v_me then case when l.safe is null then 'You' else 'You (' || split_part(l.safe, ' ', 1) || ')' end
      when l.safe is null then l.pseudo
      -- Two classmates with the same short name: add the pseudonym's code so they can be told apart.
      when l.same_name > 1 then l.safe || ' · ' || substr(l.pseudo, 8)
      else l.safe
    end,
    coalesce(w.points, 0), l.sid = v_me
  from labelled l left join weekly w on w.user_id = l.sid
  order by coalesce(w.points, 0) desc, 1
  limit 100;
end $function$;

CREATE OR REPLACE FUNCTION public.m8_independent_rankings(p_period text, p_language text)
 RETURNS TABLE(entry_id text, display_name text, xp bigint, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

REVOKE ALL ON FUNCTION public.m8_classroom_rankings(uuid, text), public.m8_independent_rankings(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m8_classroom_rankings(uuid, text), public.m8_independent_rankings(text, text) TO authenticated;

DROP FUNCTION public.m8_set_leaderboard_privacy(text, text);
DROP FUNCTION public.m8_my_leaderboard_privacy();
DROP FUNCTION public.m8_leaderboard_names_enabled(text);
DROP FUNCTION public.m8_leaderboard_alias(text);
DROP TABLE public.m8_leaderboard_privacy;
DROP TABLE public.m8_leaderboard_settings;

COMMIT;
