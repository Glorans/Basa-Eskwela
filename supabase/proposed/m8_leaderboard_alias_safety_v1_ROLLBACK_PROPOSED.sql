-- m8_leaderboard_alias_safety_v1 ROLLBACK (PROPOSED): restores the exact m8_leaderboard_privacy_v1 definitions of
-- m8_leaderboard_alias and m8_set_leaderboard_privacy and removes the two helpers. No table or row is touched.
\set ON_ERROR_STOP 1
BEGIN;
CREATE OR REPLACE FUNCTION public.m8_leaderboard_alias(p_alias text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when char_length(v) < 2 or char_length(v) > 20 then null
    when v !~ '^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9 ._-]*$' then null
    when v ~ '[0-9]{5,}' then null
    when lower(v) ~ '^(you|reader|anonymous|hidden|admin|teacher)\M' then null
    else v
  end
  from (select btrim(regexp_replace(coalesce(p_alias, ''), '\s+', ' ', 'g')) v) n
$function$

;

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
end $function$

;

DROP FUNCTION public.m8_leaderboard_alias_reveals_identity(text, uuid);
DROP FUNCTION public.m8_leaderboard_alias_issue(text);

DO $check$
BEGIN
  IF md5(pg_get_functiondef('public.m8_leaderboard_alias(text)'::regprocedure)) <> '02353e946e14f9b44d61f8b96f82c8d1'
     OR md5(pg_get_functiondef('public.m8_set_leaderboard_privacy(text,text)'::regprocedure)) <> '800637d76a0d4cafb12a5f3480c7f71f' THEN
    RAISE EXCEPTION 'Rollback did not restore the reviewed definitions';
  END IF;
END
$check$;
COMMIT;
