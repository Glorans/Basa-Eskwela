-- ============================================================================
-- PROPOSED - NOT APPLIED. Do not run without explicit approval.
-- M6 Teacher practice: an APPROVED Teacher may complete comprehension practice on any
-- published, non-deleted reading module in the shared catalog, as the owner of their own
-- attempt, outside any classroom. M6 objects only. DDL only: no attempt, answer, score,
-- XP, badge or risk row is inserted, updated or deleted.
-- ============================================================================
--
-- What changes (one function)
--   m6_assert_completion_access(uuid) gets ONE new branch, placed before the existing ones:
--     * owner role = 'teacher' AND teacher_status = 'approved'  ->  Teacher-practice check below.
--   Everything else is unchanged and in the same order:
--     * any other non-Admin owner (Students, Independent Learners, pending/rejected Teachers,
--       accounts without a role) -> the unchanged m6_assert_learner_completion_access, which
--       refuses every role except 'student' and 'general_user';
--     * an Admin owner -> the unchanged Admin-practice check (own published modules only).
--   Callers (m6_apply_action 'complete', m8_on_comprehension_completed) call it by name and are
--   not edited.
--
-- Teacher-practice rule (all must hold)
--   * the attempt is a module attempt with no classroom, assignment, uploaded material or
--     reading activity;
--   * the module is published and not deleted (any author: the shared catalog; drafts,
--     archived and deleted modules are refused);
--   * the attempt language matches the module language;
--   * the linked M5 reading exists, belongs to the same Teacher, is for the same module and
--     has no classroom or material.
--
-- Not changed (reviewed 2026-11-10)
--   * m6_one_assessment_per_activity: one comprehension assessment per module passage applies to
--     Teacher practice exactly as it does to Admin practice.
--   * m8_on_comprehension_completed: returns before any XP, reading day or badge for every role
--     except 'student' and 'general_user'.
--   * m7_enqueue_completion (M7, not edited): a Teacher completion upserts one m7_risk_queue row
--     (as any non-Admin completion does). m7_save_evaluation only evaluates enrolled role
--     'student' targets, so for a Teacher it records no risk event and deletes the row.
--   * Scoring, question snapshots, answers and attempt limits.
--
-- Fingerprints: md5 of pg_get_functiondef with CR removed. Live values read READ-ONLY from
-- ReadFlow-Staging (oudfrdeqwotynihkkmze) on 2026-11-10:
--   m6_assert_completion_access(uuid)          4f5aeddcb911fb2433d4f9f97c804b2b (before)
--   m6_assert_learner_completion_access(uuid)  795969b21c895ea830aba4a6bbcf035c (kept)
--   m6_assert_completion_access(uuid)          b02ca1708f0d79c63b1240f2eeeaa285 (after; rehearsed on a restore)
-- Preflight first (read-only): supabase/tests/m6_teacher_practice_preflight.sql
-- Verify after:               supabase/tests/m6_teacher_practice_verify.sql
-- Apply as the postgres role (the function owner).

begin;
set local lock_timeout = '5s';

do $guard$
declare item record; found_md5 text;
begin
  for item in select * from (values
    ('public.m6_assert_completion_access(uuid)', '4f5aeddcb911fb2433d4f9f97c804b2b'),
    ('public.m6_assert_learner_completion_access(uuid)', '795969b21c895ea830aba4a6bbcf035c')
  ) as expected(signature, md5) loop
    if to_regprocedure(item.signature) is null then
      raise exception '% is missing; stop and re-review', item.signature;
    end if;
    found_md5 := md5(replace(pg_get_functiondef(item.signature::regprocedure), chr(13), ''));
    if found_md5 is distinct from item.md5 then
      raise exception '% differs from the reviewed definition (found %); stop and re-review', item.signature, found_md5;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'profiles' and column_name = 'teacher_status') then
    raise exception 'profiles.teacher_status is missing; stop and re-review';
  end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.m6_assert_completion_access(p_attempt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.m6_comprehension_attempts%rowtype; v_role text; v_teacher_status text; v_language text;
begin
  select * into a from public.m6_comprehension_attempts where id = p_attempt;
  if not found then raise exception 'Activity not found' using errcode = 'P0002'; end if;
  select role, teacher_status into v_role, v_teacher_status from public.profiles where id = a.user_id for share;
  if v_role = 'teacher' and v_teacher_status = 'approved' then
    -- Approved Teacher practice: any published module in the shared catalog, outside any classroom.
    if a.module_id is null or a.room_id is not null or a.assignment_id is not null
        or a.material_id is not null or a.activity_assignment_id is not null then
      raise exception 'Teacher practice is limited to published reading modules' using errcode = '42501';
    end if;
    select public.m8_normalize_language(p.language) into v_language
    from public.modules m join public.learning_paths p on p.id = m.path_id
    where m.id = a.module_id and m.status = 'published' and m.deleted_at is null
    for share of m, p;
    if not found then raise exception 'Module access revoked' using errcode = '42501'; end if;
    if v_language is null then raise exception 'Unknown module language' using errcode = '22023'; end if;
    if v_language is distinct from a.language then
      raise exception 'Attempt language does not match its module' using errcode = '22023';
    end if;
    perform 1 from public.oral_reading_attempts r
    where r.id = a.oral_reading_attempt_id and r.user_id = a.user_id and r.module_id = a.module_id
      and r.room_id is null and r.material_id is null;
    if not found then
      raise exception 'Teacher practice requires the Teacher''s own reading of this module' using errcode = '42501';
    end if;
    return;
  end if;
  if v_role is distinct from 'admin' then
    -- Students, Independent Learners and every other role: the unchanged learner rules.
    perform public.m6_assert_learner_completion_access(p_attempt);
    return;
  end if;
  if a.module_id is null or a.room_id is not null or a.assignment_id is not null
      or a.material_id is not null or a.activity_assignment_id is not null then
    raise exception 'Admin practice is limited to the Admin''s own published modules' using errcode = '42501';
  end if;
  select public.m8_normalize_language(p.language) into v_language
  from public.modules m join public.learning_paths p on p.id = m.path_id
  where m.id = a.module_id and m.status = 'published' and m.deleted_at is null and m.created_by = a.user_id
  for share of m, p;
  if not found then raise exception 'Module access revoked' using errcode = '42501'; end if;
  if v_language is null then raise exception 'Unknown module language' using errcode = '22023'; end if;
  if v_language is distinct from a.language then
    raise exception 'Attempt language does not match its module' using errcode = '22023';
  end if;
  perform 1 from public.oral_reading_attempts r
  where r.id = a.oral_reading_attempt_id and r.user_id = a.user_id and r.module_id = a.module_id
    and r.room_id is null and r.material_id is null;
  if not found then
    raise exception 'Admin practice requires the Admin''s own reading of this module' using errcode = '42501';
  end if;
end $function$;

-- CREATE OR REPLACE keeps the owner and privileges; restate them so the end state is explicit.
revoke all on function public.m6_assert_completion_access(uuid) from public, anon, authenticated;
grant execute on function public.m6_assert_completion_access(uuid) to service_role;

commit;
