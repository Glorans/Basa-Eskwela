-- PROPOSED. Empty-install rollback only. Never delete histories to satisfy these guards.
begin;
set local lock_timeout='5s';
do $$ begin
if md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure),chr(13),'')) is distinct from 'c9a82099899e7caa47c92ef70c800bd4' then raise exception 'Unexpected installed definition: m6_assert_completion_access(uuid)'; end if;
if md5(replace(pg_get_functiondef('public.m7_enqueue_completion()'::regprocedure),chr(13),'')) is distinct from '563885607c852a10581f83699c7efd74' then raise exception 'Unexpected installed definition: m7_enqueue_completion()'; end if;
if md5(replace(pg_get_functiondef('public.m8_on_comprehension_completed()'::regprocedure),chr(13),'')) is distinct from 'f2f7fa2b71a135b195ae43d8aa19c4e3' then raise exception 'Unexpected installed definition: m8_on_comprehension_completed()'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_reading_guard()'::regprocedure),chr(13),'')) is distinct from '68313ab99e73dff64aa5562009f38994' then raise exception 'Unexpected installed definition: personal_material_reading_guard()'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_revision(uploaded_materials)'::regprocedure),chr(13),'')) is distinct from '6dbeac011e402aef96d170d7e3a04130' then raise exception 'Unexpected installed definition: personal_material_revision(uploaded_materials)'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_source(uuid,uuid,boolean)'::regprocedure),chr(13),'')) is distinct from '1695ac122729fd2d2320d4eb14746c63' then raise exception 'Unexpected installed definition: personal_material_source(uuid,uuid,boolean)'; end if;
end $$;

lock table public.personal_material_state,public.oral_reading_attempts,public.m6_comprehension_attempts in access exclusive mode;
do $$ begin
 if to_regclass('public.personal_material_question_sets') is not null then raise exception 'Roll back proposal 2 first'; end if;
 if exists(select 1 from public.personal_material_state)
 or exists(select 1 from public.oral_reading_attempts where material_id is not null and activity_assignment_id is null)
 or exists(select 1 from public.m6_comprehension_attempts where material_id is not null and activity_assignment_id is null) then
 raise exception 'Recovery required: keep personal data and schema'; end if;
end $$;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.m7_enqueue_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and not exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'admin') then
    insert into public.m7_risk_queue(id) values (new.user_id)
    on conflict(id) do update set generation = nextval('public.m7_risk_generation'), updated_at = now();
  end if;
  return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.m8_on_comprehension_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tier integer;
  v_allowed integer;
  v_granted boolean := false;
begin
  if new.status <> 'completed' or new.completed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;
  perform public.m6_assert_completion_access(new.id);
  -- Admin practice is valid but is not learner progress: no XP, reading day or badge.
  if not exists (select 1 from public.profiles where id = new.user_id and role in ('student','general_user')) then
    return new;
  end if;
  if public.m8_performance_language(public.m8_activity_language(new.material_id, new.module_id)) then
    v_granted := public.m8_evaluate_rewards(new.user_id, new.material_id, new.activity_assignment_id, new.module_id,
      new.passage_id, new.room_id, new.assignment_id, new.passage_text);
  elsif exists (select 1 from public.m8_passage_rewards pr where pr.user_id = new.user_id
      and public.m8_same_passage(pr.content_text, new.passage_text)) then
    return new;
  elsif new.activity_assignment_id is not null then
    v_granted := public.m8_grant_xp(new.user_id, 'assignment', new.activity_assignment_id, 60);
  else
    select case lower(m.difficulty) when 'easy' then 1 when 'medium' then 2 when 'hard' then 3 else 0 end
      into v_tier from public.modules m where m.id = new.module_id;
    if v_tier is null or v_tier = 0 then raise exception 'Unknown module difficulty'; end if;
    if new.room_id is not null then
      v_allowed := v_tier;
    else
      v_allowed := case public.m2_trusted_reading_level(new.user_id, new.language)
        when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end;
      if v_allowed is null then return new; end if;
    end if;
    v_granted := public.m8_grant_xp(new.user_id, 'module', new.module_id,
      case least(v_tier, v_allowed) when 1 then 30 when 2 then 50 else 80 end);
  end if;

  -- Only new verified XP records a reading day; duplicates never farm streaks.
  if v_granted then
    perform public.m8_record_reading_day(new.user_id, (new.completed_at at time zone 'Asia/Manila')::date);
  end if;
  return new;
end $function$
;
alter table public.m6_comprehension_attempts drop constraint m6_reading_source_check;
alter table public.m6_comprehension_attempts add constraint m6_reading_source_check CHECK ((((module_id IS NOT NULL) AND (passage_id IS NOT NULL) AND (material_id IS NULL) AND (activity_assignment_id IS NULL)) OR ((module_id IS NULL) AND (passage_id IS NULL) AND (material_id IS NOT NULL) AND (activity_assignment_id IS NOT NULL) AND (room_id IS NOT NULL) AND (assignment_id IS NULL) AND (oral_reading_attempt_id IS NOT NULL))));
alter table public.oral_reading_attempts drop constraint m5_reading_source_check;
alter table public.oral_reading_attempts add constraint m5_reading_source_check CHECK ((((module_id IS NOT NULL) AND (material_id IS NULL) AND (activity_assignment_id IS NULL)) OR ((module_id IS NULL) AND (material_id IS NOT NULL) AND (activity_assignment_id IS NOT NULL) AND (room_id IS NOT NULL) AND (passage_id IS NULL) AND (assignment_id IS NULL))));
drop index public.personal_material_one_assessment;
drop trigger personal_material_reading_guard on public.oral_reading_attempts;
drop function public.personal_material_reading_guard();
drop function public.personal_material_source(uuid,uuid,boolean);
drop function public.personal_material_revision(public.uploaded_materials);
drop table public.personal_material_state;
notify pgrst,'reload schema';
commit;
