// Copy of the LIVE definitions (rehearsal copy of Staging, structure only) of diagnostic_results with its DT1 and M8
// triggers and helper functions, rooms, enrollments and the M8 progress/badge tables. Disposable PGlite fixtures only.
const LIVE_FIXTURE = `
  create role authenticated; create role anon; create role service_role bypassrls;
  grant usage on schema public to authenticated, anon, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema auth; create table auth.users(id uuid primary key);
  create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, role text, teacher_status text, full_name text, nickname text);
  create table public.rooms (id uuid default gen_random_uuid() primary key, teacher_id uuid not null references public.profiles(id) on delete cascade,
    room_name text not null, room_code text not null unique, subject text check (subject = any (array['en'::text, 'fil'::text])), archived_at timestamptz, archived_by uuid references public.profiles(id) on delete restrict);
  create table public.enrollments (id uuid default gen_random_uuid() primary key, room_id uuid not null references public.rooms(id) on delete cascade,
    student_id uuid not null references public.profiles(id) on delete cascade, enrolled_at timestamptz default now() not null, unique (room_id, student_id));
  create table public.diagnostic_results (
    id uuid default gen_random_uuid() not null primary key, user_id uuid not null references auth.users(id) on delete cascade,
    assessment_type text default 'initial'::text not null, orv_score numeric not null, comprehension_score numeric not null,
    reading_level text not null, difficulty_tier text not null, reading_speed_wpm numeric, transcript text, stt_confidence numeric,
    oral_reading_metrics jsonb, completed_at timestamptz default now() not null, created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null, language text default 'en'::text not null, assessment_id text, assessment_version text,
    verification_status text default 'unverified'::text not null, verification_method text, verification_recording_id uuid, verified_at timestamptz,
    constraint diagnostic_results_assessment_type_check check ((assessment_type = 'initial'::text)),
    constraint diagnostic_results_difficulty_tier_check check ((difficulty_tier = any (array['Easy'::text, 'Medium'::text, 'Hard'::text]))),
    constraint diagnostic_results_language_check check ((language = any (array['en'::text, 'fil'::text]))),
    constraint diagnostic_results_reading_level_check check ((reading_level = any (array['Independent'::text, 'Instructional'::text, 'Frustration'::text]))),
    constraint diagnostic_results_verification_evidence_check check ((((verification_status = 'unverified'::text) and (verification_method is null) and (verification_recording_id is null) and (verified_at is null)) or ((verification_status = 'server_verified'::text) and (verification_method is not null) and (verification_recording_id is not null) and (verified_at is not null) and (assessment_id is not null) and (assessment_version is not null)))),
    constraint diagnostic_results_verification_status_check check ((verification_status = any (array['unverified'::text, 'server_verified'::text]))));
  create unique index diagnostic_results_unverified_version_key on public.diagnostic_results (user_id, assessment_type, language, assessment_id, assessment_version) where (verification_status = 'unverified'::text);
  create unique index diagnostic_results_verified_recording_key on public.diagnostic_results (user_id, verification_recording_id) where (verification_recording_id is not null);
  create unique index diagnostic_results_verified_version_key on public.diagnostic_results (user_id, assessment_type, language, assessment_id, assessment_version) where (verification_status = 'server_verified'::text);
  create table public.m8_badges(id text primary key);
  insert into public.m8_badges values ('level_up');
  create table public.m8_earned_badges(user_id uuid not null references auth.users(id) on delete cascade, badge_id text not null references public.m8_badges(id),
    earned_at timestamptz default now() not null, primary key (user_id, badge_id));
  create table public.m8_learner_progress(user_id uuid primary key references auth.users(id) on delete cascade, unlocked_difficulty text default 'Easy' not null,
    read_aloud_count integer default 0 not null, updated_at timestamptz default now() not null);
  create table public.m8_xp_events(id uuid primary key default gen_random_uuid(), user_id uuid not null, source_type text not null, source_id uuid, xp_earned integer not null default 0,
    created_at timestamptz default now() not null);
  create table public.m8_reading_days(user_id uuid not null, reading_date date not null, primary key (user_id, reading_date));
  create table public.modules(id uuid primary key default gen_random_uuid(), status text, deleted_at timestamptz, revision_root uuid);

  -- Live function bodies (copied from the rehearsal copy of Staging).
  create function public.m2_protect_diagnostic_verification() returns trigger language plpgsql set search_path = '' as $f$
  begin
    if tg_op = 'INSERT' then
      if new.verification_status is distinct from 'server_verified' then
        raise exception 'New diagnostic results must be server-verified.' using errcode = '42501';
      end if;
      return new;
    end if;
    if old.verification_status = 'unverified' then
      raise exception 'Historical unverified diagnostic results are read-only.' using errcode = '42501';
    end if;
    if new.verification_status is distinct from old.verification_status or new.verification_method is distinct from old.verification_method
      or new.verification_recording_id is distinct from old.verification_recording_id or new.verified_at is distinct from old.verified_at then
      raise exception 'Diagnostic verification evidence cannot be changed; record a new verified assessment instead.' using errcode = '42501';
    end if;
    if old.verification_status = 'server_verified' and (new.user_id is distinct from old.user_id or new.assessment_type is distinct from old.assessment_type
      or new.language is distinct from old.language or new.assessment_id is distinct from old.assessment_id or new.assessment_version is distinct from old.assessment_version
      or new.orv_score is distinct from old.orv_score or new.comprehension_score is distinct from old.comprehension_score or new.reading_level is distinct from old.reading_level
      or new.difficulty_tier is distinct from old.difficulty_tier or new.reading_speed_wpm is distinct from old.reading_speed_wpm or new.transcript is distinct from old.transcript
      or new.stt_confidence is distinct from old.stt_confidence or new.oral_reading_metrics is distinct from old.oral_reading_metrics or new.completed_at is distinct from old.completed_at) then
      raise exception 'A server-verified diagnostic result cannot be modified.' using errcode = '42501';
    end if;
    return new;
  end; $f$;
  create function public.set_diagnostic_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at = now(); return new; end; $f$;
  create function public.m2_trusted_reading_level(p_user uuid, p_language text) returns text language sql stable security invoker set search_path = '' as $f$
    select d.reading_level from public.diagnostic_results d where d.user_id = p_user and d.language = p_language and d.assessment_type = 'initial'
      and d.verification_status = 'server_verified' order by d.verified_at desc, d.id limit 1 $f$;
  create function public.m8_verified_difficulty_summary(p_user uuid) returns text language sql stable security invoker set search_path = '' as $f$
    select case greatest(
      coalesce(case public.m2_trusted_reading_level(p_user, 'en') when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end, 1),
      coalesce(case public.m2_trusted_reading_level(p_user, 'fil') when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end, 1))
    when 3 then 'Hard' when 2 then 'Medium' else 'Easy' end $f$;
  CREATE FUNCTION public.m8_sync_diagnostic()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$\r
begin\r
  if new.verification_status is distinct from 'server_verified' then return new; end if;\r
  if new.reading_level not in ('Frustration', 'Instructional', 'Independent') then\r
    raise exception 'Invalid reading level';\r
  end if;\r
  insert into public.m8_learner_progress(user_id, unlocked_difficulty)\r
  values (new.user_id, public.m8_verified_difficulty_summary(new.user_id))\r
  on conflict (user_id) do update\r
    set unlocked_difficulty = excluded.unlocked_difficulty, updated_at = now();\r
  if new.reading_level in ('Independent', 'Instructional') then\r
    insert into public.m8_earned_badges(user_id, badge_id) values (new.user_id, 'level_up')\r
    on conflict do nothing;\r
  end if;\r
  return new;\r
end $function$;
  CREATE FUNCTION public.m8_badge_eligible(p_user uuid, p_badge text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$\r
  select exists (select 1 from public.m8_earned_badges e where e.user_id = p_user and e.badge_id = p_badge)\r
  or case p_badge\r
    when 'first_read' then exists (select 1 from public.m8_xp_events x\r
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module'))\r
    when 'bookworm' then (select count(*) from public.m8_xp_events x\r
      where x.user_id = p_user and x.source_type in ('passage', 'assignment', 'module')) >= 5\r
    when 'diamond' then (select coalesce(sum(x.xp_earned), 0) from public.m8_xp_events x\r
      where x.user_id = p_user and x.source_type <> 'daily_login') >= 2000\r
    when 'level_up' then exists (select 1 from public.diagnostic_results d where d.user_id = p_user\r
      and d.verification_status = 'server_verified' and d.reading_level in ('Independent', 'Instructional'))\r
    when 'streak_3' then coalesce((select max(n) from (select count(*) n from (\r
        select r.reading_date - (row_number() over (order by r.reading_date))::int grp\r
        from public.m8_reading_days r where r.user_id = p_user) d group by grp) runs), 0) >= 3\r
    when 'consistent_reader' then (select count(*) from public.m8_reading_days r where r.user_id = p_user) >= 7\r
    when 'brave_reader' then coalesce((select p.read_aloud_count from public.m8_learner_progress p where p.user_id = p_user), 0) >= 10\r
    when 'graduate' then exists (select 1 from public.modules where status = 'published' and deleted_at is null)\r
      and not exists (select 1 from public.modules m where m.status = 'published' and m.deleted_at is null\r
        and not exists (select 1 from public.m8_xp_events x where x.user_id = p_user\r
          and ((x.source_type = 'module' and x.source_id = m.id)\r
            or (x.source_type = 'module_bonus' and x.source_id = coalesce(m.revision_root, m.id)))))\r
    else false\r
  end\r
$function$;
  create trigger diagnostic_results_protect_verification before insert or update on public.diagnostic_results for each row execute function public.m2_protect_diagnostic_verification();
  create trigger diagnostic_results_set_updated_at before update on public.diagnostic_results for each row execute function public.set_diagnostic_updated_at();
  create trigger m8_diagnostic_sync after insert or update of reading_level on public.diagnostic_results for each row execute function public.m8_sync_diagnostic();
  grant select on public.diagnostic_results to authenticated;
`;

module.exports = { LIVE_FIXTURE };
