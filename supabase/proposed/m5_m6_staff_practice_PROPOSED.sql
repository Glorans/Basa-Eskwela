-- M5/M6 staff reading practice (Appendix N M5 F1-F7, M6 F1-F4 for System Admin, School Admin, Teacher).
-- PROPOSED. NOT APPLIED. Requires explicit approval. One transaction; replaces ONE function.
--
-- public.m6_assert_completion_access(uuid) is the database check run when an M6 comprehension attempt is completed
-- (m6_apply_action 'complete' and the M8 completion trigger). Today:
--   * an approved Teacher may complete practice on any published module (no school check);
--   * a School Admin only on a published module they CREATED;
--   * the System Admin falls into the learner rules and is refused.
-- After this migration, one staff rule for the System Admin, School Admins and approved Teachers:
--   * a published, non-deleted module outside any classroom, assignment or uploaded material;
--   * the module's author has no school (platform content) or belongs to the account's own school; the System Admin
--     (no school) may use every published module; a School Admin or Teacher without a school is refused;
--   * the attempt language matches the module, and the account's own reading of this module exists (unchanged).
-- Students and Independent Learners keep m6_assert_learner_completion_access unchanged; personal materials unchanged.
-- No table, column, policy, grant, score, reward or existing row changes. Rollback: m5_m6_staff_practice_ROLLBACK_PROPOSED.sql.

begin;
set local lock_timeout = '5s';

do $guard$
begin
  if md5(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure)) <> 'c9a82099899e7caa47c92ef70c800bd4' then
    raise exception 'STOP: m6_assert_completion_access is not the reviewed definition; re-review before applying';
  end if;
  if to_regclass('public.schools') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'school_id') then
    raise exception 'STOP: M1 multi-tenancy (schools, profiles.school_id) is required first';
  end if;
end $guard$;

CREATE OR REPLACE FUNCTION public.m6_assert_completion_access(p_attempt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.m6_comprehension_attempts%rowtype; v_role text; v_teacher_status text; v_school uuid;
  v_language text; v_label text;
begin
  select * into a from public.m6_comprehension_attempts where id = p_attempt;
  if not found then raise exception 'Activity not found' using errcode = 'P0002'; end if;
  if a.material_id is not null and a.activity_assignment_id is null and a.room_id is null then
    perform public.personal_material_source(a.user_id,a.material_id);
    return;
  end if;
  select role, teacher_status, school_id into v_role, v_teacher_status, v_school from public.profiles where id = a.user_id for share;
  if not ((v_role = 'teacher' and v_teacher_status = 'approved') or v_role in ('admin', 'system_admin')) then
    -- Students, Independent Learners and every other role: the unchanged learner rules.
    perform public.m6_assert_learner_completion_access(p_attempt);
    return;
  end if;
  -- Staff practice (System Admin, School Admin, approved Teacher): published reading modules outside any classroom.
  v_label := case v_role when 'teacher' then 'Teacher' when 'admin' then 'Admin' else 'System Admin' end;
  if a.module_id is null or a.room_id is not null or a.assignment_id is not null
      or a.material_id is not null or a.activity_assignment_id is not null then
    raise exception '% practice is limited to published reading modules', v_label using errcode = '42501';
  end if;
  if v_role <> 'system_admin' and v_school is null then
    raise exception '% practice requires a school', v_label using errcode = '42501';
  end if;
  -- M1 multi-tenancy: another school's module is never available; platform modules (author without a school) are.
  select public.m8_normalize_language(p.language) into v_language
  from public.modules m join public.learning_paths p on p.id = m.path_id
  where m.id = a.module_id and m.status = 'published' and m.deleted_at is null
    and (v_role = 'system_admin'
         or coalesce((select author.school_id from public.profiles author where author.id = m.created_by), v_school) = v_school)
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
    raise exception '% practice requires the account''s own reading of this module', v_label using errcode = '42501';
  end if;
end $function$;

commit;
