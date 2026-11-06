-- PROPOSED - NOT APPLIED. Rollback of m8_f2_badges_streaks_v1_PROPOSED.sql: restores the exact F1 and
-- reward-eligibility definitions and the badge descriptions. Badges earned, reading days and counts stay.
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.m8_count_verified_reading(uuid,timestamptz)') is null then
    raise exception 'Stop: M8 F2 is not installed; nothing to roll back.';
  end if;
end $$;

create or replace function public.m8_grant_xp(p_user uuid, p_type text, p_source uuid, p_xp integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare inserted_count integer; v_new_module integer := 0;
begin
  if not ((p_type = 'passage' and p_xp between 20 and 100)
      or (p_type = 'module_bonus' and p_xp = 50)
      or (p_type = 'daily_login' and p_xp = 10)
      or (p_type in ('module', 'assignment') and p_xp in (30, 50, 60, 80))) then
    raise exception 'Invalid XP grant';
  end if;
  insert into public.m8_xp_events(user_id, source_type, source_id, xp_earned)
  values (p_user, p_type, p_source, p_xp) on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return false; end if;
  if p_type = 'module' or (p_type = 'module_bonus' and not exists (
    select 1 from public.m8_xp_events x join public.modules m on m.id = x.source_id
    where x.user_id = p_user and x.source_type = 'module' and coalesce(m.revision_root, m.id) = p_source
  )) then
    v_new_module := 1;
  end if;
  insert into public.m8_learner_progress(user_id, total_xp, completed_modules)
  values (p_user, p_xp, v_new_module)
  on conflict (user_id) do update set total_xp = public.m8_learner_progress.total_xp + excluded.total_xp,
    completed_modules = public.m8_learner_progress.completed_modules + excluded.completed_modules, updated_at = now();
  if p_type in ('module', 'module_bonus') then
    insert into public.m8_earned_badges(user_id, badge_id) select p_user, 'first_read' on conflict do nothing;
    insert into public.m8_earned_badges(user_id, badge_id)
    select p_user, 'bookworm' where (select completed_modules from public.m8_learner_progress where user_id = p_user) >= 5
    on conflict do nothing;
  end if;
  -- Diamond counts reading and comprehension XP, including legacy rows, never login XP.
  insert into public.m8_earned_badges(user_id, badge_id)
  select p_user, 'diamond' where p_type <> 'daily_login' and (select coalesce(sum(x.xp_earned), 0)
    from public.m8_xp_events x where x.user_id = p_user and x.source_type <> 'daily_login') >= 2000
  on conflict do nothing;
  return true;
end $$;

create or replace function public.m8_award_graduate(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.modules where status = 'published')
  and not exists (
    select 1 from public.modules m where m.status = 'published'
    and not exists (select 1 from public.m8_xp_events x where x.user_id = p_user
      and ((x.source_type = 'module' and x.source_id = m.id)
        or (x.source_type = 'module_bonus' and x.source_id = coalesce(m.revision_root, m.id))))
  ) then
    insert into public.m8_earned_badges(user_id, badge_id) values (p_user, 'graduate') on conflict do nothing;
  end if;
end $$;

create or replace function public.m5_verify_reading(p_attempt uuid, p_user uuid, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.oral_reading_attempts%rowtype;
  v_total integer;
  v_errors integer;
  v_correct integer;
  v_receipt uuid;
begin
  select * into a from public.oral_reading_attempts where id = p_attempt and user_id = p_user for update;
  if not found then raise exception 'Reading not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.m5_verified_readings where attempt_id = p_attempt) then
    return jsonb_build_object('verified', true, 'repeat', true);
  end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('student','general_user')) then
    return jsonb_build_object('verified', false, 'reason', 'not_learner');
  end if;
  if a.language_snapshot not in ('en','fil') or a.scoring_version < 2 or jsonb_typeof(a.word_metrics) <> 'array' then
    return jsonb_build_object('verified', false, 'reason', 'unsupported');
  end if;
  -- The saved language must agree with the source, so a reading cannot be filed under another language.
  if (a.material_id is not null or a.module_id is not null)
     and public.m8_activity_language(a.material_id, a.module_id) is distinct from a.language_snapshot then
    return jsonb_build_object('verified', false, 'reason', 'language_mismatch');
  end if;
  select count(*) filter (where m.value->>'expected' is not null), count(*) filter (where m.value->>'type' <> 'match')
    into v_total, v_errors from jsonb_array_elements(a.word_metrics) as m(value);
  v_correct := greatest(a.expected_word_count - a.detected_error_count, 0);
  if v_total <> a.expected_word_count or v_errors <> a.detected_error_count or a.expected_word_count <= 0
     or abs(a.pronunciation_accuracy - (100.0 * v_correct / a.expected_word_count)) > 0.001 then
    return jsonb_build_object('verified', false, 'reason', 'inconsistent_score');
  end if;
  select r.id into v_receipt from public.m5_transcript_receipts r
  where r.user_id = p_user and r.language = a.language_snapshot and r.transcript_sha256 = p_sha256
    and r.source_id = coalesce(a.material_id, a.passage_id, a.module_id)
    and r.passage_fingerprint = public.m8_content_fingerprint(a.passage_snapshot)
    and r.submission_id = a.submission_id
    and r.consumed_attempt_id is null
    and r.issued_at <= a.created_at and r.issued_at >= now() - interval '24 hours'
  order by r.issued_at, r.id limit 1 for update skip locked;
  if v_receipt is null then
    return jsonb_build_object('verified', false, 'reason', 'no_receipt');
  end if;
  update public.m5_transcript_receipts set consumed_attempt_id = p_attempt where id = v_receipt;
  insert into public.m5_verified_readings(attempt_id, user_id, language, content_fingerprint, words_correct, words_total, completed_at)
  values (p_attempt, p_user, a.language_snapshot, public.m8_content_fingerprint(a.passage_snapshot), v_correct, a.expected_word_count, a.completed_at);
  perform public.m8_evaluate_rewards(p_user, a.material_id, a.activity_assignment_id, a.module_id,
    a.passage_id, a.room_id, a.assignment_id, a.passage_snapshot);
  return jsonb_build_object('verified', true);
end $$;
revoke all on function public.m5_verify_reading(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.m5_verify_reading(uuid,uuid,text) to service_role;

create or replace function public.m8_oral_completed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 -- Learner rewards only. Other roles' readings are saved but earn no M8 progress.
 if not exists (select 1 from public.profiles where id=new.user_id and role in ('student','general_user')) then
  return new;
 end if;
 insert into public.m8_learner_progress(user_id,read_aloud_count) values(new.user_id,1)
 on conflict(user_id) do update set read_aloud_count=public.m8_learner_progress.read_aloud_count+1,updated_at=now();
 perform public.m8_record_reading_day(new.user_id,(new.completed_at at time zone 'Asia/Manila')::date);
 insert into public.m8_earned_badges(user_id,badge_id)
 select new.user_id,'brave_reader' where
 (select read_aloud_count from public.m8_learner_progress where user_id=new.user_id)>=10 on conflict do nothing;
 return new;
end $$;
revoke all on function public.m8_oral_completed() from public, anon, authenticated;

drop function public.m8_count_verified_reading(uuid,timestamptz);

update public.m8_badges set description = 'Complete your first module' where id = 'first_read';
update public.m8_badges set description = 'Complete 5 modules' where id = 'bookworm';
update public.m8_badges set description = 'Reach 2000 XP' where id = 'diamond';
update public.m8_badges set description = 'Unlock Medium level' where id = 'level_up';
update public.m8_badges set description = 'Complete all required modules' where id = 'graduate';

notify pgrst, 'reload schema';
commit;
