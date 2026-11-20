-- ROLLBACK for m2_m8_reassessment_safety_PROPOSED.sql -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Restores the reviewed live M8 functions verbatim and removes the placement switch and the read-only comparison.
-- Refuses while the placement switch is ON or while any reassessment result exists (without this migration, the live
-- M8 code would react to those rows again). No XP, badge, progress or diagnostic row is changed.
begin;

do $$
begin
  if to_regprocedure('public.m2_reading_level_change(uuid)') is null then
    raise exception 'STOP: the reassessment safety migration is not installed';
  end if;
  if (select placement_follows_reassessment from public.m2_reassessment_settings) then
    raise exception 'STOP: switch placement_follows_reassessment off first';
  end if;
  if exists (select 1 from public.diagnostic_results where assessment_type <> 'initial') then
    raise exception 'STOP: reassessment results exist; the original M8 code would count them';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.m8_sync_diagnostic()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
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
    when 'level_up' then exists (select 1 from public.diagnostic_results d where d.user_id = p_user
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

drop function public.m2_reading_level_change(uuid);
alter table public.m2_reassessment_settings drop column placement_follows_reassessment;

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.m8_sync_diagnostic()'::regprocedure) <> '2ebfdd77f8a38176c66f396d56ec3146'
     or (select md5(prosrc) from pg_proc where oid = 'public.m8_badge_eligible(uuid,text)'::regprocedure) <> '890ab04a84fdb83ce271ba6a7b9fd9dd' then
    raise exception 'STOP: the restored M8 functions do not match the reviewed version';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
