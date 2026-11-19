-- M2 x M3/M8 REASSESSMENT SAFETY -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Requires: m2_assessment_packages, m2_reassessment_foundation (and optionally m2_independent_reassessment_eligibility).
-- Rollback: m2_m8_reassessment_safety_ROLLBACK_PROPOSED.sql   Verification: m2_m8_reassessment_safety_VERIFY_READONLY.sql
--
-- Must be applied BEFORE any reassessment gate is switched on. Without it, the LIVE M8 code reacts to any
-- server-verified diagnostic row: m8_sync_diagnostic recomputes unlocked difficulty and awards level_up for an
-- Instructional/Independent result, and m8_badge_eligible('level_up') counts every verified row.
--
-- What this does (adviser decisions D1-D3 pending, so NO new reward or placement policy is enabled):
--   1. m8_sync_diagnostic: reassessment rows return immediately. Initial rows follow the IDENTICAL existing path.
--   2. m8_badge_eligible('level_up'): counts initial diagnostics only (all existing verified rows are initial, so every
--      current eligibility answer is unchanged). Earned badges, XP events and unlocks are never touched or revoked.
--   3. m2_reading_level_change(result): READ-ONLY shared foundation: compares an official result with the learner's
--      previous official result in the same language (first | improved | unchanged | lower). Nothing uses it yet; a
--      future, approved M8 rule (e.g. an "improved reader" badge, D2) can.
--   4. m2_reassessment_settings.placement_follows_reassessment (default FALSE): the M3 placement policy switch (D1).
--      While false, placement keeps using the initial diagnostic. Only a separate, approved SQL step can set it.
-- Unchanged: m2_trusted_reading_level (initial only), m8_verified_difficulty_summary, m8_on_comprehension_completed
-- (XP caps), leaderboards, all XP events, badges, progress rows, diagnostic results and thresholds.
-- Function owners and grants are kept (CREATE OR REPLACE).
begin;

do $$
begin
  if to_regclass('public.m2_reassessment_settings') is null then
    raise exception 'STOP: apply m2_reassessment_foundation_PROPOSED.sql first';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.m2_reassessment_settings'::regclass
             and attname = 'placement_follows_reassessment' and not attisdropped)
     or to_regprocedure('public.m2_reading_level_change(uuid)') is not null then
    raise exception 'STOP: the reassessment safety migration is already (partly) installed';
  end if;
  -- Refuse to replace M8 code that differs from the reviewed live version.
  if (select md5(prosrc) from pg_proc where oid = 'public.m8_sync_diagnostic()'::regprocedure) <> '2ebfdd77f8a38176c66f396d56ec3146' then
    raise exception 'STOP: m8_sync_diagnostic differs from the reviewed version';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m8_badge_eligible(uuid,text)'::regprocedure) <> '890ab04a84fdb83ce271ba6a7b9fd9dd' then
    raise exception 'STOP: m8_badge_eligible differs from the reviewed version';
  end if;
end $$;

-- 1. and 2.
CREATE OR REPLACE FUNCTION public.m8_sync_diagnostic()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- M2 reassessment safety: M8 keeps following INITIAL diagnostics only (pending adviser decisions D1-D3).
  -- A reassessment result never changes unlocked difficulty or awards level_up here.
  if new.assessment_type is distinct from 'initial' then return new; end if;
  if new.verification_status is distinct from 'server_verified' then return new; end if;
  if new.reading_level not in ('Frustration', 'Instructional', 'Independent') then
    raise exception 'Invalid reading level';
  end if;
  insert into public.m8_learner_progress(user_id, unlocked_difficulty)
  values (new.user_id, public.m8_verified_difficulty_summary(new.user_id))
  on conflict (user_id) do update
    set unlocked_difficulty = excluded.unlocked_difficulty, updated_at = now();
  if new.reading_level in ('Independent', 'Instructional') then
    insert into public.m8_earned_badges(user_id, badge_id) values (new.user_id, 'level_up')
    on conflict do nothing;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.m8_badge_eligible(p_user uuid, p_badge text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.m8_earned_badges e where e.user_id = p_user and e.badge_id = p_badge)
  or case p_badge
    when 'first_read' then exists (select 1 from public.m8_xp_events x
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module'))
    when 'bookworm' then (select count(*) from public.m8_xp_events x
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module')) >= 5
    when 'diamond' then (select coalesce(sum(x.xp_earned), 0) from public.m8_xp_events x
      where x.user_id = p_user and x.source_type <> 'daily_login') >= 2000
    -- M2 reassessment safety: level_up stays defined by the INITIAL diagnostic (pending adviser decision D2).
    when 'level_up' then exists (select 1 from public.diagnostic_results d where d.user_id = p_user
      and d.assessment_type = 'initial'
      and d.verification_status = 'server_verified' and d.reading_level in ('Independent', 'Instructional'))
    when 'streak_3' then coalesce((select max(n) from (select count(*) n from (
        select r.reading_date - (row_number() over (order by r.reading_date))::int grp
        from public.m8_reading_days r where r.user_id = p_user) d group by grp) runs), 0) >= 3
    when 'consistent_reader' then (select count(*) from public.m8_reading_days r where r.user_id = p_user) >= 7
    when 'brave_reader' then coalesce((select p.read_aloud_count from public.m8_learner_progress p where p.user_id = p_user), 0) >= 10
    when 'graduate' then exists (select 1 from public.modules where status = 'published' and deleted_at is null)
      and not exists (select 1 from public.modules m where m.status = 'published' and m.deleted_at is null
        and not exists (select 1 from public.m8_xp_events x where x.user_id = p_user
          and ((x.source_type = 'module' and x.source_id = m.id)
            or (x.source_type = 'module_bonus' and x.source_id = coalesce(m.revision_root, m.id)))))
    else false
  end
$function$;

-- 3. Read-only comparison with the previous official result in the same language.
create function public.m2_reading_level_change(p_result uuid)
returns table (language text, previous_result_id uuid, previous_level text, new_level text, direction text)
language sql stable set search_path = '' as $$
  with official as (
    select d.id, d.user_id, d.language, d.reading_level, d.verified_at
    from public.diagnostic_results d
    where d.verification_status = 'server_verified'
      and (d.assessment_type = 'initial' or (d.assessment_type = 'reassessment' and d.package_version_id is not null))
  ), target as (select * from official where id = p_result),
  previous as (
    select o.* from official o, target t
    where o.user_id = t.user_id and o.language = t.language and o.id <> t.id
      and (o.verified_at, o.id) < (t.verified_at, t.id)
    order by o.verified_at desc, o.id desc limit 1
  ), rank(level, r) as (values ('Frustration', 0), ('Instructional', 1), ('Independent', 2))
  select t.language, p.id, p.reading_level, t.reading_level,
    case when p.id is null then 'first'
         when (select r from rank where level = t.reading_level) > (select r from rank where level = p.reading_level) then 'improved'
         when (select r from rank where level = t.reading_level) < (select r from rank where level = p.reading_level) then 'lower'
         else 'unchanged' end
  from target t left join previous p on true
$$;
revoke all on function public.m2_reading_level_change(uuid) from public, anon, authenticated;
grant execute on function public.m2_reading_level_change(uuid) to service_role;

-- 4. Placement policy switch (D1). FALSE = keep today's initial-diagnostic placement.
alter table public.m2_reassessment_settings add column placement_follows_reassessment boolean not null default false;

notify pgrst, 'reload schema';
commit;
