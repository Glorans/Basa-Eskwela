-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval. Apply after M8 F1-F4.
-- M8 F4 Classroom Leaderboard: classmates' short names instead of pseudonyms.
-- ============================================================================
--
-- Students never enter a full name (profile setup and Settings save only the nickname; full_name stays empty),
-- so the approved source is the nickname each learner chose, which their teacher already sees. Decision of
-- 2026-11-09. It is shortened to first word and last initial ("Maria Santos" -> "Maria S."); full names are never
-- shown to classmates.
--   * Only m8_classroom_rankings changes. Same arguments, same four columns, same opaque entry_id, same weekly,
--     per-language XP. m8_independent_rankings is NOT touched: Independent Learners stay anonymous.
--   * Membership is checked in the database, as in F4: someone who is not enrolled in the room gets no rows.
--   * Names appear only when the viewer is an active Student and the classroom is not archived, and only for
--     classmates who are active Students with a safe nickname (m8_classroom_display_name). Everyone else keeps
--     the F4 pseudonym "Reader XXXXXX". The viewer's row reads "You (First name)", or "You".
--   * Two classmates with the same short name get the pseudonym's code added ("Ana · 03DF2F").
--   * No email, profile or auth ID, reading level or other room's member ever leaves the function.
--   * The three older leaderboard functions stay closed; the postcondition checks it.
-- Rollback: m8_f4_classroom_names_v1_ROLLBACK_PROPOSED.sql restores the F4 definition exactly.
-- Test: server/tests/m8ClassroomNamesProposal.test.js
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.m8_classroom_rankings(uuid,text)') is null
    or to_regprocedure('public.m8_xp_event_in_room(uuid,text,uuid,uuid)') is null then
    raise exception 'Stop: apply M8 F1-F4 first.';
  end if;
  if to_regprocedure('public.m8_classroom_display_name(text)') is not null then
    raise exception 'Stop: classroom names are already installed.';
  end if;
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.m8_classroom_rankings(uuid,text)'::regprocedure)
    is distinct from '6c25e753256b68938ffa367f034156b0' then
    raise exception 'Stop: m8_classroom_rankings differs from the reviewed F4 definition.';
  end if;
end $$;

-- The classroom name for one learner, from the nickname they chose: first word and last initial
-- ("Maria Santos" -> "Maria S.", "Ana" -> "Ana"). Null (the caller then keeps the pseudonym) when it is empty,
-- the old "New user" placeholder, too long, or not plain words: letters, spaces, hyphens, apostrophes and
-- periods only, so no emails, numbers, links or symbols. "You" and "Reader" are refused so that nobody can look
-- like the viewer's own row or a pseudonym.
create function public.m8_classroom_display_name(p_nickname text)
returns text language sql immutable security invoker set search_path = '' as $$
  select case
    when v = '' or length(v) > 40 or lower(v) = 'new user' then null
    when v !~ '^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.''-]*( [A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.''-]*)*$' then null
    when length(w[1]) > 20 or lower(rtrim(w[1], '.')) in ('you', 'reader') then null
    else upper(left(w[1], 1)) || substr(w[1], 2)
      || case when cardinality(w) > 1 then ' ' || upper(left(w[cardinality(w)], 1)) || '.' else '' end
  end
  from (select v, string_to_array(v, ' ') w
        from (select btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g')) v) n) s
$$;
revoke all on function public.m8_classroom_display_name(text) from public, anon, authenticated, service_role;

create or replace function public.m8_classroom_rankings(p_room_id uuid, p_language text)
returns table(entry_id text, display_name text, xp bigint, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
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
end $$;
revoke all on function public.m8_classroom_rankings(uuid,text) from public, anon, service_role;
grant execute on function public.m8_classroom_rankings(uuid,text) to authenticated;

do $$ begin
  if has_function_privilege('authenticated', 'public.m8_classroom_display_name(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_classroom_display_name(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_independent_leaderboard(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_classroom_leaderboard(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.m8_weekly_leaderboard()', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_independent_leaderboard(text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_classroom_leaderboard(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_weekly_leaderboard()', 'EXECUTE')
    or has_function_privilege('anon', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE')
    or (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.m8_classroom_rankings(uuid,text)'::regprocedure) <> '20d1fb398e59a45a5a78aa3527bf9b2c' then
    raise exception 'Postcondition: classroom names access is wrong';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
