-- ============================================================================
-- PROPOSED ROLLBACK - NOT APPLIED. Run only with explicit approval, and only if
-- m6_teacher_practice_PROPOSED.sql was applied and must be withdrawn.
-- Restores m6_assert_completion_access(uuid) to its exact pre-migration definition
-- (fingerprint 4f5aeddcb911fb2433d4f9f97c804b2b). Approved Teachers can then no longer
-- COMPLETE comprehension practice; their saved practice attempts, answers and readings are
-- kept unchanged. DDL only: no data row is touched. Apply as the postgres role.
-- ============================================================================

begin;
set local lock_timeout = '5s';

do $guard$
declare found_md5 text;
begin
  if to_regprocedure('public.m6_assert_completion_access(uuid)') is null then
    raise exception 'm6_assert_completion_access(uuid) is missing; stop and re-review';
  end if;
  found_md5 := md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure), chr(13), ''));
  if found_md5 = '4f5aeddcb911fb2433d4f9f97c804b2b' then
    raise exception 'Teacher practice is not installed; nothing to roll back';
  end if;
  if found_md5 is distinct from 'b02ca1708f0d79c63b1240f2eeeaa285' then
    raise exception 'm6_assert_completion_access differs from the reviewed Teacher-practice definition (found %); stop and re-review', found_md5;
  end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.m6_assert_completion_access(p_attempt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
declare a public.m6_comprehension_attempts%rowtype; v_role text; v_language text;
begin
  select * into a from public.m6_comprehension_attempts where id = p_attempt;
  if not found then raise exception 'Activity not found' using errcode = 'P0002'; end if;
  select role into v_role from public.profiles where id = a.user_id for share;
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
end $$;

revoke all on function public.m6_assert_completion_access(uuid) from public, anon, authenticated;
grant execute on function public.m6_assert_completion_access(uuid) to service_role;

do $check$
begin
  if md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure), chr(13), ''))
     is distinct from '4f5aeddcb911fb2433d4f9f97c804b2b' then
    raise exception 'Rollback did not restore the reviewed definition; transaction rolled back';
  end if;
end $check$;

commit;
