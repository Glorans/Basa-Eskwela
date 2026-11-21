-- ROLLBACK for m5_m6_staff_practice_PROPOSED.sql -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Restores public.m6_assert_completion_access(uuid) byte-for-byte as it is on ReadFlow-Staging before the migration
-- (md5 c9a82099899e7caa47c92ef70c800bd4): School Admin practice back to own modules, System Admin back to refused.
-- Completed staff practice attempts are kept unchanged (rollback only affects future completions).
begin;
set local lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.m6_assert_completion_access(p_attempt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.m6_comprehension_attempts%rowtype; v_role text; v_teacher_status text; v_language text;
begin
  select * into a from public.m6_comprehension_attempts where id = p_attempt;
  if not found then raise exception 'Activity not found' using errcode = 'P0002'; end if;
  if a.material_id is not null and a.activity_assignment_id is null and a.room_id is null then
    perform public.personal_material_source(a.user_id,a.material_id);
    return;
  end if;
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
commit;
