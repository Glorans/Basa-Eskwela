-- M8 leaderboard display names with learner privacy choices (Capstone).                PROPOSED - NOT APPLIED TO STAGING
--
-- Names are shown ONLY when switched on for that audience (m8_leaderboard_settings); both switches start OFF, so
-- right after this migration every learner shows a "Reader XXXXXX" code. A switch is turned on only after the
-- required name-visibility authorization (school/adviser, and for children parent or guardian permission): see
-- m8_leaderboard_privacy_v1_ENABLE_NAMES_TEMPLATE.sql. The general Terms and Privacy acknowledgment is NOT that
-- authorization. Turning a switch off hides every name at once.
--
-- Students (classroom leaderboard), one of:
--   * nickname  - their EXISTING classroom nickname, shortened and safety-filtered as in m8_f4_classroom_names_v1
--                 ("Maria S."); nothing to type. THE DEFAULT for Students (no row), shown only while classroom
--                 names are switched on;
--   * anonymous - a "Reader XXXXXX" code;
--   * hidden    - left out of the rankings; other learners do not see them at all; they still see their own row.
-- Independent Learners (Global Leaderboard), one of:
--   * nickname  - a leaderboard nickname they type themselves (never their profile or legal name);
--   * anonymous - a "Reader XXXXXX" code (THE DEFAULT for Independent Learners: no row = anonymous);
--   * hidden    - as above.
-- The choice table starts EMPTY: nobody's choice is made for them, and a saved anonymous or hidden choice is
-- always honoured (also after a switch is turned on).
--
-- Compared with m8_f4_classroom_names_v1 (classmates' nicknames shown automatically): names now also need the
-- classroom switch ON, and Students can choose anonymous or hidden.
--
-- Unchanged: XP, XP history, badges, achievements, claims, streaks, reading days, rankings' scores and order rules,
-- the room membership check (School 1 / School 2 isolation), archived-room pseudonyms, the returned columns.
-- Changing a choice never touches XP or rewards: it is only read when a ranking is listed.
-- Access: classroom rankings refuse anyone who is not a Student (42501); Independent rankings refuse anyone who is
-- not an Independent Learner (42501, as before); both are for signed-in users only.
-- Guard: stops unless both ranking functions are the reviewed bodies (md5 of the definition, CR removed).
-- Rollback: m8_leaderboard_privacy_v1_ROLLBACK_PROPOSED.sql. Checks: ..._PREFLIGHT_READONLY.sql, ..._VERIFY_READONLY.sql.

BEGIN;

DO $guard$
DECLARE
  expected CONSTANT jsonb := '{"m8_classroom_rankings(uuid,text)": "ed940ae2f9ddd05e7e8f82b7d262c7d9",
    "m8_independent_rankings(text,text)": "6bc40aa0576a2f2b27e83c440a083e1e"}';
  k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(expected) LOOP
    IF to_regprocedure('public.' || k) IS NULL
       OR md5(replace(pg_get_functiondef(to_regprocedure('public.' || k)), chr(13), '')) <> expected ->> k THEN
      RAISE EXCEPTION 'M8 leaderboard privacy: % is not the reviewed version; nothing was changed', k;
    END IF;
  END LOOP;
  IF to_regprocedure('public.m8_classroom_display_name(text)') IS NULL THEN
    RAISE EXCEPTION 'M8 leaderboard privacy: apply m8_f4_classroom_names_v1 first; nothing was changed';
  END IF;
  IF to_regclass('public.m8_leaderboard_privacy') IS NOT NULL OR to_regclass('public.m8_leaderboard_settings') IS NOT NULL THEN
    RAISE EXCEPTION 'M8 leaderboard privacy already applied; nothing was changed';
  END IF;
END $guard$;

-- Names switch per audience. Both OFF until the privacy approval is recorded.
CREATE TABLE public.m8_leaderboard_settings (
  audience text PRIMARY KEY CHECK (audience IN ('classroom', 'independent')),
  names_enabled boolean NOT NULL DEFAULT false,
  approval_note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.m8_leaderboard_settings (audience) VALUES ('classroom'), ('independent');

-- One learner's choice. No row = anonymous.
CREATE TABLE public.m8_leaderboard_privacy (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'anonymous' CHECK (visibility IN ('nickname', 'anonymous', 'hidden')),
  alias text CHECK (alias IS NULL OR char_length(alias) BETWEEN 2 AND 20),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Neither table is readable or writable by clients: only the functions below use them.
ALTER TABLE public.m8_leaderboard_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m8_leaderboard_privacy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m8_leaderboard_settings, public.m8_leaderboard_privacy FROM PUBLIC, anon, authenticated;

-- A safe leaderboard nickname, or null. 2-20 characters; starts with a letter; letters, digits, spaces, . _ -;
-- no e-mail, link or long number (5+ digits, e.g. an LRN or phone); not a word the rankings use themselves.
CREATE FUNCTION public.m8_leaderboard_alias(p_alias text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  select case
    when char_length(v) < 2 or char_length(v) > 20 then null
    when v !~ '^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]*$' then null
    when v ~ '[0-9]{5,}' then null
    when lower(v) ~ '^(you|reader|anonymous|hidden|admin|teacher)\M' then null
    else v
  end
  from (select btrim(regexp_replace(coalesce(p_alias, ''), '\s+', ' ', 'g')) v) n
$function$;

CREATE FUNCTION public.m8_leaderboard_names_enabled(p_audience text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  select coalesce((select s.names_enabled from public.m8_leaderboard_settings s where s.audience = p_audience), false)
$function$;

-- The signed-in learner's own choice, and whether nicknames are switched on for them.
CREATE FUNCTION public.m8_my_leaderboard_privacy()
RETURNS TABLE(visibility text, alias text, names_allowed boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
  v_audience text;
begin
  select case p.role when 'student' then 'classroom' when 'general_user' then 'independent' end into v_audience
  from public.profiles p where p.id = v_me and p.status = 'active';
  if v_audience is null then raise exception 'Learner access required' using errcode = '42501'; end if;
  return query
  -- Students: default "nickname" = their classroom nickname, sent back as alias (their own data only).
  select coalesce(l.visibility, case v_audience when 'classroom' then 'nickname' else 'anonymous' end),
    case v_audience when 'classroom'
      then (select public.m8_classroom_display_name(p.nickname) from public.profiles p where p.id = v_me)
      else l.alias end,
    public.m8_leaderboard_names_enabled(v_audience)
  from (select 1) one left join public.m8_leaderboard_privacy l on l.user_id = v_me;
end $function$;

-- Save the learner's own choice. Only the learner can change it; nothing else (XP, rewards) is touched.
CREATE FUNCTION public.m8_set_leaderboard_privacy(p_visibility text, p_alias text DEFAULT NULL)
RETURNS TABLE(visibility text, alias text, names_allowed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
  v_audience text;
  v_alias text := public.m8_leaderboard_alias(p_alias);
begin
  select case p.role when 'student' then 'classroom' when 'general_user' then 'independent' end into v_audience
  from public.profiles p where p.id = v_me and p.status = 'active';
  if v_audience is null then raise exception 'Learner access required' using errcode = '42501'; end if;
  if p_visibility is null or p_visibility not in ('nickname', 'anonymous', 'hidden') then
    raise exception 'Invalid leaderboard visibility' using errcode = '22023';
  end if;
  -- Students do not type a nickname: their classroom nickname is used, and the choice is stored without an alias.
  if v_audience = 'classroom' then
    insert into public.m8_leaderboard_privacy as l (user_id, visibility, alias, updated_at)
    values (v_me, p_visibility, null, now())
    on conflict (user_id) do update set visibility = excluded.visibility, alias = null, updated_at = now();
    return query select * from public.m8_my_leaderboard_privacy();
    return;
  end if;
  if btrim(coalesce(p_alias, '')) <> '' and v_alias is null then
    raise exception 'Use 2 to 20 letters or numbers, starting with a letter. No e-mail, link or long number.' using errcode = '22023';
  end if;
  if p_visibility = 'nickname' then
    if not public.m8_leaderboard_names_enabled(v_audience) then
      raise exception 'Leaderboard nicknames are not available yet' using errcode = 'PT409';
    end if;
    if v_alias is null then raise exception 'Choose a leaderboard nickname first' using errcode = '22023'; end if;
  end if;
  insert into public.m8_leaderboard_privacy as l (user_id, visibility, alias, updated_at)
  values (v_me, p_visibility, v_alias, now())
  on conflict (user_id) do update set visibility = excluded.visibility, alias = excluded.alias, updated_at = now();
  return query select * from public.m8_my_leaderboard_privacy();
end $function$;

-- Classroom ranking: same columns, XP and membership rule. A classmate shows their classroom nickname only when
-- classroom names are on, the room is not archived, both are active Students and the classmate did not choose
-- anonymous; classmates who chose hidden are left out.
CREATE OR REPLACE FUNCTION public.m8_classroom_rankings(p_room_id uuid, p_language text)
 RETURNS TABLE(entry_id text, display_name text, xp bigint, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := auth.uid();
  v_base boolean;
  v_names boolean;
begin
  if p_language is null or p_language not in ('en','fil') then raise exception 'Invalid language' using errcode = '22023'; end if;
  -- Classroom rankings are for Students only (not Independent Learners, staff or signed-out users).
  if v_me is null or not exists (select 1 from public.profiles p where p.id = v_me and p.role = 'student') then
    raise exception 'Student access required' using errcode = '42501';
  end if;
  -- Only members of the room; anyone else gets no rows.
  if not exists (select 1 from public.enrollments e where e.room_id = p_room_id and e.student_id = v_me) then return; end if;
  -- An active Student in a classroom that is not archived. Archived classrooms keep the pseudonyms.
  v_base := exists (select 1 from public.profiles p where p.id = v_me and p.role = 'student' and p.status = 'active')
    and exists (select 1 from public.rooms r where r.id = p_room_id and r.archived_at is null);
  v_names := v_base and public.m8_leaderboard_names_enabled('classroom');
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
    -- This room's members only; a classmate who chose "hidden" is left out (the viewer always sees their own row).
    select e.student_id sid,
      md5('m8-room|' || p_room_id::text || '|' || e.student_id::text) eid,
      'Reader ' || upper(substr(md5('m8-name|' || p_room_id::text || '|' || e.student_id::text), 1, 6)) pseudo,
      case when v_names and coalesce(l.visibility, 'nickname') = 'nickname' and p.role = 'student' and p.status = 'active'
        then public.m8_classroom_display_name(p.nickname) end safe,
      case when v_base and e.student_id = v_me then public.m8_classroom_display_name(p.nickname) end own
    from public.enrollments e
    left join public.profiles p on p.id = e.student_id
    left join public.m8_leaderboard_privacy l on l.user_id = e.student_id
    where e.room_id = p_room_id
      and (e.student_id = v_me or coalesce(l.visibility, 'anonymous') <> 'hidden')
  ), labelled as (
    select m.*, count(*) filter (where m.sid <> v_me) over (partition by lower(m.safe)) same_name
    from members m
  )
  select l.eid,
    case
      when l.sid = v_me then case when l.own is null then 'You' else 'You (' || split_part(l.own, ' ', 1) || ')' end
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

-- Independent ranking: same columns, XP, periods and pseudonyms. Others show a chosen nickname only when
-- Independent names are on; hidden learners are left out (the viewer always sees their own row).
CREATE OR REPLACE FUNCTION public.m8_independent_rankings(p_period text, p_language text)
 RETURNS TABLE(entry_id text, display_name text, xp bigint, is_me boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := auth.uid();
  v_period_key text;
  v_names boolean := public.m8_leaderboard_names_enabled('independent');
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
  ), people as (
    select p.id,
      'Reader ' || upper(substr(md5('m8-il-name|' || v_period_key || '|' || p.id::text), 1, 6)) pseudo,
      case when v_names and l.visibility = 'nickname' and p.status = 'active' then public.m8_leaderboard_alias(l.alias) end safe
    from public.profiles p
    left join public.m8_leaderboard_privacy l on l.user_id = p.id
    where p.role = 'general_user'
      and (p.id = v_me or coalesce(l.visibility, 'anonymous') <> 'hidden')
  ), labelled as (
    select q.*, count(*) filter (where q.id <> v_me) over (partition by lower(q.safe)) same_name
    from people q
  )
  select md5('m8-il|' || v_period_key || '|' || l.id::text),
    case
      when l.id = v_me then case when l.safe is null then 'You' else 'You (' || l.safe || ')' end
      when l.safe is null then l.pseudo
      when l.same_name > 1 then l.safe || ' · ' || substr(l.pseudo, 8)
      else l.safe
    end,
    coalesce(s.points, 0), l.id = v_me
  from labelled l left join scores s on s.user_id = l.id
  order by coalesce(s.points, 0) desc, 1
  limit 100;
end $function$;

REVOKE ALL ON FUNCTION public.m8_leaderboard_alias(text), public.m8_leaderboard_names_enabled(text),
  public.m8_my_leaderboard_privacy(), public.m8_set_leaderboard_privacy(text, text),
  public.m8_classroom_rankings(uuid, text), public.m8_independent_rankings(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m8_my_leaderboard_privacy(), public.m8_set_leaderboard_privacy(text, text),
  public.m8_classroom_rankings(uuid, text), public.m8_independent_rankings(text, text) TO authenticated;

COMMIT;
