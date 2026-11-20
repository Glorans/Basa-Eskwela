-- ROLLBACK for m2_f10_direct_publish_PROPOSED.sql. Restores the four functions byte-for-byte and the original
-- m2_version_approval_evidence constraint: reassessment versions again need review + approval before publishing, and
-- assignments/results again need a documented educator endorsement.
-- STOPS (changes nothing) if any version was published without approval evidence while direct publishing was on:
-- the original constraint would reject those rows. Such versions must be reviewed by the project owner first; this
-- script never deletes, retires or rewrites them. Existing assignments and results are never changed.
begin;

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_guard_assessment_version()'::regprocedure) <> '5cf32ad49b1f6256b84082ed7ac78442' then
    raise exception 'STOP: m2_guard_assessment_version() is not the direct-publish version; nothing to roll back';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_publish_assessment_version(uuid,uuid)'::regprocedure) <> '2d993cbbcad20db77091ee45a43264d1' then
    raise exception 'STOP: m2_publish_assessment_version() is not the direct-publish version';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_guard_reassessment_assignment()'::regprocedure) <> 'cb8e4e3bd227b208272dd56455c4b5a0' then
    raise exception 'STOP: m2_guard_reassessment_assignment() is not the direct-publish version';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::regprocedure) <> 'd68fcf8a6a500007fc776bb904c79787' then
    raise exception 'STOP: m2_record_reassessment_result() is not the direct-publish version';
  end if;
  if exists (select 1 from public.m2_assessment_package_versions where status in ('published', 'retired') and source <> 'code_import'
               and (reviewed_at is null or nullif(btrim(coalesce(educator_review_attestation, '')), '') is null)) then
    raise exception 'STOP: some versions were published without review evidence; the original rule would reject them. Review them first.';
  end if;
end $$;

alter table public.m2_assessment_package_versions drop constraint m2_version_approval_evidence;
alter table public.m2_assessment_package_versions add constraint m2_version_approval_evidence check (
    status not in ('approved', 'published', 'retired') or source = 'code_import'
    or (reviewed_at is not null and nullif(btrim(educator_review_attestation), '') is not null)
  );

create or replace function public.m2_guard_assessment_version() returns trigger language plpgsql set search_path = '' as $fn$
declare issues text[]; probe public.m2_assessment_package_versions;
begin
  -- Account deletion (ON DELETE SET NULL) may clear who created/submitted/reviewed/published/retired, nothing else.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    probe := new;
    probe.created_by := old.created_by; probe.submitted_by := old.submitted_by; probe.reviewed_by := old.reviewed_by;
    probe.published_by := old.published_by; probe.retired_by := old.retired_by;
    if probe is not distinct from old
       and (new.created_by is null or new.created_by = old.created_by) and (new.submitted_by is null or new.submitted_by = old.submitted_by)
       and (new.reviewed_by is null or new.reviewed_by = old.reviewed_by) and (new.published_by is null or new.published_by = old.published_by)
       and (new.retired_by is null or new.retired_by = old.retired_by) then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft versions can be deleted; submitted, approved and published versions are kept' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.created_by is null then raise exception 'Record who created the version' using errcode = '23502'; end if;
    if new.source = 'code_import' then
      if new.status <> 'published' or not exists (
        select 1 from public.m2_assessment_packages p where p.id = new.package_id and p.legacy_assessment_id is not null) then
        raise exception 'Only the code-defined diagnostic can be imported, as its published version' using errcode = '42501';
      end if;
      issues := public.m2_assessment_content_issues(new.passage_title, new.paragraphs, new.questions);
      if cardinality(issues) > 0 then raise exception 'Imported content is invalid: %', array_to_string(issues, ' ') using errcode = '23514'; end if;
      new.content_sha256 := public.m2_assessment_content_sha256(new.passage_title, new.paragraphs, new.questions);
      new.published_at := coalesce(new.published_at, now());
    elsif new.status <> 'draft' or new.submitted_at is not null or new.reviewed_at is not null or new.published_at is not null then
      raise exception 'New versions start as drafts' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.package_id, new.version_number, new.version_label, new.source, new.based_on_version_id, new.created_by, new.created_at)
     is distinct from (old.id, old.package_id, old.version_number, old.version_label, old.source, old.based_on_version_id, old.created_by, old.created_at) then
    raise exception 'A version''s identity cannot change' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (new.passage_title, new.paragraphs, new.questions, new.content_sha256)
     is distinct from (old.passage_title, old.paragraphs, old.questions, old.content_sha256) then
    raise exception 'Only draft content can be edited; create a new version to change submitted, approved or published content'
      using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status, new.status) in (('draft', 'in_review'), ('in_review', 'draft'), ('in_review', 'approved'),
                                          ('approved', 'published'), ('approved', 'retired'), ('published', 'retired'))) then
      raise exception 'A version cannot move from % to %', old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'in_review' then
      issues := public.m2_assessment_content_issues(new.passage_title, new.paragraphs, new.questions);
      if cardinality(issues) > 0 then raise exception 'This version is not ready for review: %', array_to_string(issues, ' ') using errcode = '23514'; end if;
      if new.submitted_by is null then raise exception 'Record who submitted the version' using errcode = '23502'; end if;
      new.submitted_at := now();
      new.content_sha256 := public.m2_assessment_content_sha256(new.passage_title, new.paragraphs, new.questions);
      new.reviewed_by := null; new.reviewed_at := null; new.educator_review_attestation := null;
    elsif new.status = 'draft' then
      -- Returned for changes: the review note is kept; the freeze is lifted.
      new.content_sha256 := null; new.submitted_at := null; new.submitted_by := null;
    elsif new.status = 'approved' then
      if new.reviewed_by is null or nullif(btrim(coalesce(new.educator_review_attestation, '')), '') is null then
        raise exception 'Approval needs a reviewer and a written educator-review attestation' using errcode = '23502';
      end if;
      new.reviewed_at := now();
    elsif new.status = 'published' then
      if new.published_by is null then raise exception 'Record who published the version' using errcode = '23502'; end if;
      new.published_at := now();
    elsif new.status = 'retired' then
      if new.retired_by is null then raise exception 'Record who retired the version' using errcode = '23502'; end if;
      new.retired_at := now();
    end if;
  elsif old.status <> 'draft' and (new.submitted_by, new.submitted_at, new.reviewed_by, new.reviewed_at, new.review_note,
         new.educator_review_attestation, new.published_by, new.published_at, new.retired_by, new.retired_at)
       is distinct from (old.submitted_by, old.submitted_at, old.reviewed_by, old.reviewed_at, old.review_note,
         old.educator_review_attestation, old.published_by, old.published_at, old.retired_by, old.retired_at) then
    raise exception 'Review and publication records cannot be rewritten' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $fn$;

create or replace function public.m2_publish_assessment_version(p_version uuid, p_actor uuid)
returns void language plpgsql set search_path = '' as $fn$
declare v_package uuid;
begin
  if p_actor is null then raise exception 'Record who published the version' using errcode = '23502'; end if;
  select v.package_id into v_package from public.m2_assessment_package_versions v
    join public.m2_assessment_packages p on p.id = v.package_id
    where v.id = p_version and v.status = 'approved' and p.archived_at is null
    for update of v;
  if v_package is null then
    raise exception 'Only an approved version of an active package can be published' using errcode = '42501';
  end if;
  update public.m2_assessment_package_versions set status = 'retired', retired_by = p_actor
    where package_id = v_package and status = 'published';
  update public.m2_assessment_package_versions set status = 'published', published_by = p_actor where id = p_version;
end $fn$;

create or replace function public.m2_guard_reassessment_assignment() returns trigger language plpgsql set search_path = '' as $fn$
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
end $fn$;

create or replace function public.m2_record_reassessment_result(p_assignment uuid, p_user uuid, p_result jsonb)
returns uuid language plpgsql security definer set search_path = '' as $fn$
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
end $fn$;

do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_guard_assessment_version()'::regprocedure) <> '08cc2107fb3e37fbf2fe48e4af0d992d' then
    raise exception 'STOP: restored m2_guard_assessment_version() does not match the original';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_publish_assessment_version(uuid,uuid)'::regprocedure) <> '94a15859e110ab4cd13686fadf8b2428' then
    raise exception 'STOP: restored m2_publish_assessment_version() does not match the original';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_guard_reassessment_assignment()'::regprocedure) <> '63d5b2129f2432f9e3da6f3b570703d8' then
    raise exception 'STOP: restored m2_guard_reassessment_assignment() does not match the original';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::regprocedure) <> 'e055f14f89b18c4d8301b4e3f8904601' then
    raise exception 'STOP: restored m2_record_reassessment_result() does not match the original';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
