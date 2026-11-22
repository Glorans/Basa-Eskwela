-- m8_leaderboard_alias_safety_v1 (PROPOSED) — stricter Independent Learner leaderboard nicknames.
-- Run AFTER m8_leaderboard_privacy_v1. Does NOT switch nicknames on (m8_leaderboard_settings is not touched).
--
-- What changes
--   * New public.m8_leaderboard_alias_issue(text): the reason a nickname is refused, or null when it is acceptable:
--       format   — not 2–20 characters, or not starting with a letter / unsupported characters (unchanged rule)
--       number   — 5 digits in a row (unchanged) or more than 4 digits in total (phone numbers, birth dates)
--       reserved — reads like a system or staff label (you, reader, anonymous, hidden, admin, teacher, moderator ...)
--       contact  — links, e-mail providers, social media or messaging apps
--       words    — rude, sexual, hateful or violent words in English or Filipino, including simple disguises
--                  (spaces, dots, repeated letters, 0/1/3/4/5/7/8 for letters)
--   * public.m8_leaderboard_alias(text) keeps its signature and now also applies these rules. The Independent Learner
--     ranking already shows a nickname only through this function, so any stored nickname that breaks a rule is
--     shown as the learner's "Reader" code instead. No stored row is changed.
--   * New public.m8_leaderboard_alias_reveals_identity(text, uuid): true when the nickname contains the learner's own
--     surname, two parts of their full name, or their e-mail user name. A first name alone is allowed.
--   * public.m8_set_leaderboard_privacy: same behaviour, plus a clear message for each refused nickname and the
--     identity check. Students' classroom choices are unchanged (no alias is stored for Students).
-- Not changed: m8_leaderboard_settings and its switches, m8_leaderboard_privacy rows, rankings, XP, badges,
-- achievements, streaks, classroom names, grants of existing functions.
\set ON_ERROR_STOP 1
BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.m8_leaderboard_privacy') IS NULL OR to_regclass('public.m8_leaderboard_settings') IS NULL THEN
    RAISE EXCEPTION 'm8_leaderboard_privacy_v1 is not installed';
  END IF;
  IF md5(pg_get_functiondef('public.m8_leaderboard_alias(text)'::regprocedure)) <> '02353e946e14f9b44d61f8b96f82c8d1' THEN
    RAISE EXCEPTION 'm8_leaderboard_alias differs from the reviewed m8_leaderboard_privacy_v1 version';
  END IF;
  IF md5(pg_get_functiondef('public.m8_set_leaderboard_privacy(text,text)'::regprocedure)) <> '800637d76a0d4cafb12a5f3480c7f71f' THEN
    RAISE EXCEPTION 'm8_set_leaderboard_privacy differs from the reviewed m8_leaderboard_privacy_v1 version';
  END IF;
  IF to_regprocedure('public.m8_leaderboard_alias_issue(text)') IS NOT NULL
     OR to_regprocedure('public.m8_leaderboard_alias_reveals_identity(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'm8_leaderboard_alias_safety_v1 is already installed';
  END IF;
END
$guard$;

CREATE FUNCTION public.m8_leaderboard_alias_issue(p_alias text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
declare
  v text := btrim(regexp_replace(coalesce(p_alias, ''), '\s+', ' ', 'g'));
  l text;
  folded text;
  flat text;
  squeezed text;
  tok text;
  -- Matched anywhere in the nickname (after removing spaces, dots, dashes and underscores).
  c_anywhere constant text := '(fuck|phuck|shit|bitch|biatch|cunt|pussy|nigg|whore|slut|porn|penis|vagina|horny|nude|naked|asshole|bastard|motherf|dildo|blowjob|handjob|putangina|putanginamo|tangina|tanginamo|taena|tarantado|punyeta|pakyu|pakshet|kantot|kantutan|jakol|hindot|pokpok|burat|kupal|tamod|bilat|kingina|kinginamo|gagohan|nazi|hitler|terrorist|suicide|killyou|killme)';
  -- Matched only as a whole word (short words that also occur inside ordinary names).
  c_words constant text[] := array['ass','arse','sex','sexy','dick','cock','fag','fags','tit','tits','puta','puke','titi','gago','gaga',
    'tanga','bobo','boba','iyot','bayag','leche','engot','inutil','kill','die','dead','hate','kys','wtf','stfu','damn','hell',
    'suck','sucks','drug','drugs','shabu','weed','gun','bomb','pota','tae','ulol','tonto','bwisit','rape','rapist','boob','boobs',
    'suso','fuk','fck','cum','sht','btch','lintik'];
  c_contact constant text := '(www|http|gmail|yahoo|hotmail|outlook|icloud|facebook|instagram|insta|tiktok|youtube|discord|snapchat|telegram|whatsapp|viber|messenger|twitter|roblox|onlyfans|twitch)';
  c_contact_words constant text[] := array['fb','ig','yt','dm','tg','snap','txt','cp'];
begin
  if char_length(v) < 2 or char_length(v) > 20 then return 'format'; end if;
  if v !~ '^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]*$' then return 'format'; end if;
  if v ~ '[0-9]{5,}' or char_length(regexp_replace(v, '[^0-9]', '', 'g')) > 4 then return 'number'; end if;
  l := lower(v);
  if l ~ '^(you|reader|anonymous|hidden|admin|teacher)\M'
     or l ~ '(admin|moderator|teacher|official|support|system|basa ?eskwela|guro)' then
    return 'reserved';
  end if;
  if l ~ '\.(com|net|org|ph|io|me|gg|co|xyz|edu|gov|info|app)\M' then return 'contact'; end if;
  folded := translate(l, '0134578@$!', 'oieastbasi');
  flat := regexp_replace(folded, '[ ._-]', '', 'g');
  squeezed := regexp_replace(flat, '(.)\1+', '\1', 'g');
  if flat ~ c_contact or squeezed ~ c_contact then return 'contact'; end if;
  if flat ~ c_anywhere or squeezed ~ c_anywhere then return 'words'; end if;
  foreach tok in array regexp_split_to_array(folded, '[ ._-]+') loop
    tok := regexp_replace(tok, '[0-9]+$', '');
    if tok = any(c_contact_words) then return 'contact'; end if;
    -- Stretched words ("gaaago") are folded only when a letter repeats 3+ times, so "BooBoo" stays allowed.
    if tok = any(c_words) or (tok ~ '(.)\1\1' and regexp_replace(tok, '(.)\1+', '\1', 'g') = any(c_words)) then return 'words'; end if;
  end loop;
  return null;
end
$function$;

CREATE OR REPLACE FUNCTION public.m8_leaderboard_alias(p_alias text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case when public.m8_leaderboard_alias_issue(p_alias) is null then v end
  from (select btrim(regexp_replace(coalesce(p_alias, ''), '\s+', ' ', 'g')) v) n
$function$;

CREATE FUNCTION public.m8_leaderboard_alias_reveals_identity(p_alias text, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
declare
  v_alias text := lower(coalesce(p_alias, ''));
  v_flat text := regexp_replace(v_alias, '[^[:alpha:]]', '', 'g');
  v_tokens text[] := regexp_split_to_array(v_alias, '[^[:alpha:]]+');
  v_names text[];
  v_email text;
  v_surname text;
  v_hits int := 0;
  v_part text;
begin
  select array(select x from unnest(regexp_split_to_array(lower(btrim(coalesce(p.full_name, ''))), '[^[:alpha:]]+')) x where char_length(x) >= 3)
    into v_names from public.profiles p where p.id = p_user;
  select lower(regexp_replace(split_part(u.email, '@', 1), '[^[:alpha:]]', '', 'g')) into v_email from auth.users u where u.id = p_user;
  -- E-mail user name (letters only, at least 4), e.g. "juancruz" from juan.cruz2010@...
  if char_length(coalesce(v_email, '')) >= 4 and position(v_email in v_flat) > 0 then return true; end if;
  if coalesce(array_length(v_names, 1), 0) < 2 then return false; end if;
  -- Surname: inside the nickname when 4+ letters, or as a whole word when 3 letters (so "Ang" does not block "Angel").
  v_surname := v_names[array_length(v_names, 1)];
  if (char_length(v_surname) >= 4 and position(v_surname in v_flat) > 0) or v_surname = any(v_tokens) then return true; end if;
  -- Any two parts of the full name together (first + middle, first + last ...).
  foreach v_part in array v_names loop
    if (char_length(v_part) >= 4 and position(v_part in v_flat) > 0) or v_part = any(v_tokens) then v_hits := v_hits + 1; end if;
  end loop;
  return v_hits >= 2;
end
$function$;

CREATE OR REPLACE FUNCTION public.m8_set_leaderboard_privacy(p_visibility text, p_alias text DEFAULT NULL::text)
 RETURNS TABLE(visibility text, alias text, names_allowed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
  v_audience text;
  v_alias text := public.m8_leaderboard_alias(p_alias);
  v_issue text := public.m8_leaderboard_alias_issue(p_alias);
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
    raise exception '%', case v_issue
      when 'words' then 'That nickname is not allowed. Please choose a kind nickname.'
      when 'contact' then 'Do not put links, e-mail, social media or contact details in your nickname.'
      when 'number' then 'Use at most 4 numbers in your nickname, and no phone numbers or dates.'
      when 'reserved' then 'That nickname looks like a staff or system name. Please choose another one.'
      else 'Use 2 to 20 letters or numbers, starting with a letter.' end
      using errcode = '22023';
  end if;
  if v_alias is not null and public.m8_leaderboard_alias_reveals_identity(v_alias, v_me) then
    raise exception 'Choose a nickname that does not include your real name or e-mail.' using errcode = '22023';
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

-- The helpers are internal: only the definer functions call them. Existing grants are kept as they were.
REVOKE ALL ON FUNCTION public.m8_leaderboard_alias_issue(text), public.m8_leaderboard_alias_reveals_identity(text, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
