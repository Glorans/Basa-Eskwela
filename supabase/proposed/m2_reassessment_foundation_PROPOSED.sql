-- M2 F8/F9 reassessment DATABASE FOUNDATION -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Requires: m2_assessment_packages_PROPOSED.sql (packages, versions, educator reviews) applied first.
-- Rollback: m2_reassessment_foundation_ROLLBACK_PROPOSED.sql   Verification: m2_reassessment_foundation_VERIFY_READONLY.sql
--
-- What this adds (nothing is switched on):
--   m2_reassessment_settings      one row of gates, BOTH OFF. While official_reassessment_enabled is false no
--                                 assignment can be created and no reassessment result can be recorded. Changing a
--                                 gate is a separate, approved SQL step: the backend role can read it but not change it.
--   m2_reassessment_assignments   who must take which exact published, educator-endorsed package version.
--   diagnostic_results            may now hold assessment_type 'reassessment' rows, each linked to the exact package
--                                 version, a copy of its content fingerprint and its assignment.
--   m2_record_reassessment_result the ONLY way to write a reassessment result: checks the assignment, records the
--                                 verified result and completes the assignment in one transaction.
--   m2_current_reading_level      latest official (server-verified) result per learner and language: initial or a
--                                 recorded reassessment. Not used by M3 or M8 yet.
--   m2_initial_diagnostic_completed  "has any server-verified initial result in this language" (no version match),
--                                 so a future initial version never forces a retake. Not used by the app yet.
--
-- Not changed: the 86/88 existing initial results (new columns are NULL for them; nothing is rewritten), scoring,
-- thresholds, the code-defined version 3.0 diagnostic, m2_trusted_reading_level (still initial-only, so M8 unlocked
-- difficulty, XP caps and badges behave exactly as today), M3 placement, M5, M6, M7, M8.
-- KNOWN M8 DEPENDENCY (reported, not changed): the live M8 trigger m8_sync_diagnostic and m8_badge_eligible('level_up')
-- react to ANY server-verified diagnostic row. Once the gate is switched on, a recorded Instructional/Independent
-- reassessment would award 'level_up'. The gate must stay off until the adviser decides how M8 treats reassessments.
-- Account deletion keeps working: assignments cascade with the learner, and with a deleted room or assigner the
-- reference becomes NULL (history kept).
begin;

do $$
begin
  if to_regclass('public.m2_reassessment_assignments') is not null or to_regclass('public.m2_reassessment_settings') is not null
     or exists (select 1 from pg_attribute where attrelid = 'public.diagnostic_results'::regclass
       and attname in ('package_version_id', 'content_sha256', 'reassessment_assignment_id') and not attisdropped) then
    raise exception 'STOP: the reassessment foundation is already (partly) installed';
  end if;
  if to_regclass('public.m2_assessment_package_versions') is null
     or to_regprocedure('public.m2_version_educator_endorsed(uuid)') is null then
    raise exception 'STOP: apply m2_assessment_packages_PROPOSED.sql (with educator reviews) first';
  end if;
  if to_regclass('public.diagnostic_results') is null or to_regclass('public.rooms') is null
     or to_regclass('public.enrollments') is null or to_regclass('public.profiles') is null then
    raise exception 'STOP: diagnostic_results, rooms, enrollments and profiles are required';
  end if;
  if to_regprocedure('public.m2_protect_diagnostic_verification()') is null then
    raise exception 'STOP: the M2 trusted-diagnostics migration (DT1) is required';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.diagnostic_results'::regclass
      and conname = 'diagnostic_results_assessment_type_check') is distinct from 'CHECK ((assessment_type = ''initial''::text))' then
    raise exception 'STOP: diagnostic_results_assessment_type_check is not the expected initial-only constraint';
  end if;
  if exists (select 1 from public.diagnostic_results where assessment_type <> 'initial') then
    raise exception 'STOP: unexpected non-initial diagnostic results exist';
  end if;
end $$;

-- 1. Gates (both off). Single row.
create table public.m2_reassessment_settings (
  id boolean primary key default true check (id),
  official_reassessment_enabled boolean not null default false,
  independent_learner_enabled boolean not null default false,
  -- Pilot Independent Learner availability (adviser decision D5): minimum days between official results. NULL = unset.
  independent_min_days_between integer check (independent_min_days_between is null or independent_min_days_between > 0),
  updated_at timestamptz not null default now(),
  constraint m2_independent_needs_official check (not independent_learner_enabled or official_reassessment_enabled),
  constraint m2_independent_needs_interval check (not independent_learner_enabled or independent_min_days_between is not null)
);
insert into public.m2_reassessment_settings default values;

create function public.m2_guard_reassessment_settings() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'The reassessment settings row is permanent' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then raise exception 'There is exactly one reassessment settings row' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger m2_guard_reassessment_settings before insert or update or delete on public.m2_reassessment_settings
  for each row execute function public.m2_guard_reassessment_settings();

-- 2. Assignments.
create table public.m2_reassessment_assignments (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.m2_assessment_package_versions(id) on delete restrict,
  package_id uuid not null references public.m2_assessment_packages(id) on delete restrict,
  language text not null check (language in ('en', 'fil')),
  kind text not null check (kind in ('classroom', 'independent')),
  -- NULL after the room is deleted (e.g. its Teacher's account was removed); the assignment history is kept.
  room_id uuid references public.rooms(id) on delete set null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  result_id uuid,
  completed_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  constraint m2_assignment_independent_has_no_room check (kind = 'classroom' or room_id is null),
  constraint m2_assignment_completed_evidence check ((status = 'completed') = (result_id is not null and completed_at is not null)),
  constraint m2_assignment_cancelled_evidence check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);
-- One active reassessment per learner per language; never the same version twice (unless it was cancelled).
create unique index m2_one_active_reassessment_per_language
  on public.m2_reassessment_assignments(student_id, language) where status = 'active';
create unique index m2_one_assignment_per_version
  on public.m2_reassessment_assignments(student_id, package_version_id) where status <> 'cancelled';
create index m2_reassessment_assignments_room on public.m2_reassessment_assignments(room_id);
create index m2_reassessment_assignments_version on public.m2_reassessment_assignments(package_version_id);

create function public.m2_guard_reassessment_assignment() returns trigger language plpgsql set search_path = '' as $$
declare
  s public.m2_reassessment_settings;
  v record;
  r record;
  assigner record;
  learner_role text;
begin
  -- Referential actions (learner/room/account deletion) run one trigger level deeper; let them through.
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Reassessment assignments are kept as history; cancel instead' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select * into s from public.m2_reassessment_settings;
    if not coalesce(s.official_reassessment_enabled, false) then
      raise exception 'Reassessment is not enabled' using errcode = '42501';
    end if;
    select ver.status, ver.package_id, p.kind, p.audience, p.scope, p.owner_id, p.language, p.archived_at
      into v from public.m2_assessment_package_versions ver join public.m2_assessment_packages p on p.id = ver.package_id
      where ver.id = new.package_version_id;
    if v is null or v.status <> 'published' or v.kind <> 'reassessment' or v.archived_at is not null then
      raise exception 'Only a published version of an active reassessment package can be assigned' using errcode = '42501';
    end if;
    if not public.m2_version_educator_endorsed(new.package_version_id) then
      raise exception 'This version has no documented educator endorsement' using errcode = '42501';
    end if;
    new.package_id := v.package_id;
    new.language := v.language;
    if new.status <> 'active' or new.result_id is not null or new.completed_at is not null or new.cancelled_at is not null then
      raise exception 'New assignments start active' using errcode = '42501';
    end if;
    new.assigned_at := now();
    select role into learner_role from public.profiles where id = new.student_id;

    if new.kind = 'classroom' then
      if v.audience <> 'classroom' then raise exception 'Independent Learner packages cannot be assigned in a classroom' using errcode = '42501'; end if;
      select id, teacher_id, archived_at into r from public.rooms where id = new.room_id;
      if r is null or r.archived_at is not null then raise exception 'Choose an active Learning Room' using errcode = '42501'; end if;
      if learner_role is distinct from 'student' or not exists (
          select 1 from public.enrollments e where e.room_id = new.room_id and e.student_id = new.student_id) then
        raise exception 'The Student is not enrolled in this Learning Room' using errcode = '42501';
      end if;
      -- A Teacher's private package is only ever used in that Teacher's own rooms.
      if v.scope = 'teacher' and r.teacher_id is distinct from v.owner_id then
        raise exception 'A Teacher''s private package can only be assigned in that Teacher''s Learning Rooms' using errcode = '42501';
      end if;
      select id, role, teacher_status into assigner from public.profiles where id = new.assigned_by;
      if assigner is null or not (
          (assigner.role = 'teacher' and assigner.teacher_status = 'approved' and r.teacher_id = assigner.id)
          or assigner.role = 'admin') then
        raise exception 'Only the room''s approved Teacher or a School Admin can assign reassessments' using errcode = '42501';
      end if;
    else
      if not coalesce(s.independent_learner_enabled, false) then
        raise exception 'Independent Learner reassessment is not enabled' using errcode = '42501';
      end if;
      if v.audience <> 'independent_learners' or learner_role is distinct from 'general_user'
         or new.assigned_by is distinct from new.student_id then
        raise exception 'Independent Learners start only centrally approved Independent Learner packages for themselves'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status <> 'active' then
    raise exception 'Completed and cancelled assignments are permanent records' using errcode = '42501';
  end if;
  if (new.id, new.package_version_id, new.package_id, new.language, new.kind, new.room_id, new.student_id, new.assigned_by, new.assigned_at)
     is distinct from (old.id, old.package_version_id, old.package_id, old.language, old.kind, old.room_id, old.student_id, old.assigned_by, old.assigned_at) then
    raise exception 'An assignment''s recipient, package version and room cannot change' using errcode = '42501';
  end if;
  if new.status = 'completed' then
    if current_user is distinct from public.m2_reassessment_writer() then
      raise exception 'Assignments are completed only by recording an official reassessment result' using errcode = '42501';
    end if;
  elsif new.status = 'cancelled' then
    if new.cancelled_by is null or nullif(btrim(coalesce(new.cancel_reason, '')), '') is null then
      raise exception 'Record who cancelled the assignment and why' using errcode = '23502';
    end if;
    new.cancelled_at := now();
  elsif new.result_id is not null or new.completed_at is not null or new.cancelled_at is not null then
    raise exception 'An active assignment has no result or cancellation' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger m2_guard_reassessment_assignment before insert or update or delete on public.m2_reassessment_assignments
  for each row execute function public.m2_guard_reassessment_assignment();

-- 3. diagnostic_results: allow reassessment rows, each linked to the exact version, fingerprint and assignment.
alter table public.diagnostic_results drop constraint diagnostic_results_assessment_type_check;
alter table public.diagnostic_results
  add constraint diagnostic_results_assessment_type_check check (assessment_type in ('initial', 'reassessment'));
alter table public.diagnostic_results
  add column package_version_id uuid references public.m2_assessment_package_versions(id) on delete restrict,
  add column content_sha256 text,
  -- Deleting a learner removes their assignments AND their results together (as initial results today).
  add column reassessment_assignment_id uuid references public.m2_reassessment_assignments(id) on delete cascade;
alter table public.diagnostic_results add constraint diagnostic_results_reassessment_link_check check (
  (assessment_type = 'initial' and package_version_id is null and content_sha256 is null and reassessment_assignment_id is null)
  or (assessment_type = 'reassessment' and verification_status = 'server_verified' and package_version_id is not null
      and content_sha256 ~ '^[0-9a-f]{64}$' and reassessment_assignment_id is not null)
);
create unique index diagnostic_results_one_per_assignment
  on public.diagnostic_results(reassessment_assignment_id) where reassessment_assignment_id is not null;
create unique index diagnostic_results_one_per_package_version
  on public.diagnostic_results(user_id, package_version_id) where package_version_id is not null;
alter table public.m2_reassessment_assignments
  add constraint m2_assignment_result_fk foreign key (result_id) references public.diagnostic_results(id) on delete cascade;

create function public.m2_guard_reassessment_result() returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.assessment_type = 'reassessment' and current_user is distinct from public.m2_reassessment_writer() then
      raise exception 'Reassessment results are recorded only by m2_record_reassessment_result' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.assessment_type = 'reassessment' then
      raise exception 'Official reassessment results are kept as history' using errcode = '42501';
    end if;
    return old;
  end if;
  if (new.package_version_id, new.content_sha256, new.reassessment_assignment_id)
     is distinct from (old.package_version_id, old.content_sha256, old.reassessment_assignment_id) then
    raise exception 'A result''s package version, fingerprint and assignment cannot change' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger diagnostic_results_reassessment_guard before insert or update or delete on public.diagnostic_results
  for each row execute function public.m2_guard_reassessment_result();

-- 4. The only write path for an official reassessment result. Called by the backend AFTER it has verified the
-- learner's signed reading receipts and scored them with the server-side M2 scorer against this exact version.
create function public.m2_record_reassessment_result(p_assignment uuid, p_user uuid, p_result jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.m2_reassessment_settings;
  a public.m2_reassessment_assignments;
  v record;
  v_result uuid;
begin
  select * into s from public.m2_reassessment_settings;
  if not coalesce(s.official_reassessment_enabled, false) then
    raise exception 'Reassessment is not enabled' using errcode = '42501';
  end if;
  select * into a from public.m2_reassessment_assignments where id = p_assignment for update;
  if a is null or a.student_id is distinct from p_user then
    raise exception 'Assignment not found' using errcode = '42501';
  end if;
  if a.status <> 'active' then
    raise exception 'This reassessment has already been completed or cancelled' using errcode = '42501';
  end if;
  if a.kind = 'independent' and not s.independent_learner_enabled then
    raise exception 'Independent Learner reassessment is not enabled' using errcode = '42501';
  end if;
  select ver.status, ver.version_label, ver.content_sha256, p.id as package_id, p.archived_at
    into v from public.m2_assessment_package_versions ver join public.m2_assessment_packages p on p.id = ver.package_id
    where ver.id = a.package_version_id;
  -- Pending adviser decision D7: whether a version retired after assignment may still be completed. Until then: no.
  if v.status <> 'published' or v.archived_at is not null or not public.m2_version_educator_endorsed(a.package_version_id) then
    raise exception 'This reassessment version is no longer approved for official use' using errcode = '42501';
  end if;
  if a.kind = 'classroom' and (a.room_id is null
      or not exists (select 1 from public.rooms r where r.id = a.room_id and r.archived_at is null)
      or not exists (select 1 from public.enrollments e where e.room_id = a.room_id and e.student_id = p_user)) then
    raise exception 'The Learning Room is no longer active for this Student' using errcode = '42501';
  end if;
  if (p_result ->> 'language') is distinct from a.language then
    raise exception 'The result language does not match the assignment' using errcode = '23514';
  end if;

  insert into public.diagnostic_results(
    user_id, assessment_type, language, assessment_id, assessment_version, orv_score, comprehension_score,
    reading_level, difficulty_tier, reading_speed_wpm, transcript, stt_confidence, oral_reading_metrics, completed_at,
    verification_status, verification_method, verification_recording_id, verified_at,
    package_version_id, content_sha256, reassessment_assignment_id)
  values (
    p_user, 'reassessment', a.language, v.package_id::text, v.version_label,
    (p_result ->> 'orv_score')::numeric, (p_result ->> 'comprehension_score')::numeric,
    p_result ->> 'reading_level', p_result ->> 'difficulty_tier', (p_result ->> 'reading_speed_wpm')::numeric,
    p_result ->> 'transcript', (p_result ->> 'stt_confidence')::numeric, p_result -> 'oral_reading_metrics',
    coalesce((p_result ->> 'completed_at')::timestamptz, now()),
    'server_verified', p_result ->> 'verification_method', (p_result ->> 'verification_recording_id')::uuid, now(),
    a.package_version_id, v.content_sha256, a.id)
  returning id into v_result;

  update public.m2_reassessment_assignments set status = 'completed', result_id = v_result, completed_at = now()
    where id = a.id;
  return v_result;
end $$;

-- Owner of the recording function (defined after it, because SQL function bodies are checked at creation): only it may complete assignments and write reassessment results.
create function public.m2_reassessment_writer() returns name language sql stable set search_path = '' as $$
  select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p
  where p.oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::pg_catalog.regprocedure
$$;

-- 5. Latest official reading level per language, and initial completion without a version match.
create function public.m2_current_reading_level(p_user uuid, p_language text)
returns table (result_id uuid, assessment_type text, reading_level text, difficulty_tier text,
               assessment_id text, assessment_version text, package_version_id uuid, verified_at timestamptz)
language sql stable set search_path = '' as $$
  select d.id, d.assessment_type, d.reading_level, d.difficulty_tier, d.assessment_id, d.assessment_version,
         d.package_version_id, d.verified_at
  from public.diagnostic_results d
  where d.user_id = p_user and d.language = p_language and d.verification_status = 'server_verified'
    and (d.assessment_type = 'initial'
         or (d.assessment_type = 'reassessment' and d.package_version_id is not null and d.reassessment_assignment_id is not null))
  order by d.verified_at desc, d.id
  limit 1
$$;

create function public.m2_initial_diagnostic_completed(p_user uuid, p_language text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.diagnostic_results d where d.user_id = p_user and d.language = p_language
    and d.assessment_type = 'initial' and d.verification_status = 'server_verified')
$$;

-- 6. Access: backend only.
alter table public.m2_reassessment_settings enable row level security;
alter table public.m2_reassessment_assignments enable row level security;
revoke all on public.m2_reassessment_settings, public.m2_reassessment_assignments from public, anon, authenticated, service_role;
-- The backend reads the gates but cannot switch them; switching is a separate approved SQL step.
grant select on public.m2_reassessment_settings to service_role;
grant select, insert, update on public.m2_reassessment_assignments to service_role;
revoke all on function public.m2_guard_reassessment_settings() from public, anon, authenticated, service_role;
revoke all on function public.m2_guard_reassessment_assignment() from public, anon, authenticated, service_role;
revoke all on function public.m2_guard_reassessment_result() from public, anon, authenticated, service_role;
revoke all on function public.m2_reassessment_writer() from public, anon, authenticated;
revoke all on function public.m2_record_reassessment_result(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.m2_current_reading_level(uuid, text) from public, anon, authenticated;
revoke all on function public.m2_initial_diagnostic_completed(uuid, text) from public, anon, authenticated;
grant execute on function public.m2_reassessment_writer() to service_role;
grant execute on function public.m2_record_reassessment_result(uuid, uuid, jsonb) to service_role;
grant execute on function public.m2_current_reading_level(uuid, text) to service_role;
grant execute on function public.m2_initial_diagnostic_completed(uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
