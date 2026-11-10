-- PROPOSED ONLY. Apply after the matching read-only preflight and a verified backup.
-- Personal uploads remain private; existing activity rules are unchanged.
begin;
set local lock_timeout = '5s';
do $$ begin
if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.m6_comprehension_attempts'::regclass and conname='m6_reading_source_check') is distinct from '1729c55d5551bfe30f8e0016e8ead08e' then raise exception 'Unexpected m6_reading_source_check'; end if;
if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.oral_reading_attempts'::regclass and conname='m5_reading_source_check') is distinct from '5024bbf14750ddb465c3ed293e4afec8' then raise exception 'Unexpected m5_reading_source_check'; end if;
if md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure),chr(13),'')) <> 'b02ca1708f0d79c63b1240f2eeeaa285' then raise exception 'Unexpected installed definition: m6_assert_completion_access(uuid)'; end if;
if md5(replace(pg_get_functiondef('public.m7_enqueue_completion()'::regprocedure),chr(13),'')) <> 'e4a3dd2f01bd80db6ba590659068a92e' then raise exception 'Unexpected installed definition: m7_enqueue_completion()'; end if;
if md5(replace(pg_get_functiondef('public.m8_on_comprehension_completed()'::regprocedure),chr(13),'')) <> '6c387f36c9af10a925533d68a44a7bd5' then raise exception 'Unexpected installed definition: m8_on_comprehension_completed()'; end if;
end $$;

create table public.personal_material_state (
 material_id uuid primary key references public.uploaded_materials(id) on delete restrict,
 reviewed_revision text,
 reviewed_at timestamptz,
 missing_pages jsonb,
 deleted_at timestamptz
);
alter table public.personal_material_state enable row level security;
revoke all on public.personal_material_state from public, anon, authenticated;
grant all on public.personal_material_state to service_role;

create function public.personal_material_revision(m public.uploaded_materials) returns text
language sql immutable set search_path = '' as $$ select md5(m.language || ':' || btrim(m.content_text)) $$;
revoke all on function public.personal_material_revision(public.uploaded_materials) from public, anon, authenticated;

-- Service-only identity is supplied by the authenticated backend, never a client RPC.
create function public.personal_material_source(actor uuid, material uuid, require_review boolean default true)
returns public.uploaded_materials language plpgsql security definer set search_path = '' as $$
declare m public.uploaded_materials; s public.personal_material_state;
begin
 select * into m from public.uploaded_materials where id=material for share;
 if not found or m.uploaded_by is distinct from actor or not exists(select 1 from public.profiles where id=actor and role='general_user') then
  raise exception 'Personal material access denied' using errcode='42501';
 end if;
 select * into s from public.personal_material_state where material_id=material;
 if s.deleted_at is not null then raise exception 'This personal material was deleted' using errcode='42501'; end if;
 if m.extraction_status <> 'completed' or nullif(btrim(m.content_text),'') is null or m.language not in ('en','fil') then
  raise exception 'Completed English or Filipino text is required';
 end if;
 if require_review and s.reviewed_revision is distinct from public.personal_material_revision(m) then
  raise exception 'Review and confirm the extracted text before practice';
 end if;
 return m;
end $$;
revoke all on function public.personal_material_source(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.personal_material_source(uuid,uuid,boolean) to service_role;

alter table public.oral_reading_attempts drop constraint m5_reading_source_check;
alter table public.oral_reading_attempts add constraint m5_reading_source_check check (
 (module_id is not null and material_id is null and activity_assignment_id is null)
 or (module_id is null and material_id is not null and passage_id is null and assignment_id is null
 and ((activity_assignment_id is not null and room_id is not null) or (activity_assignment_id is null and room_id is null)))
);
alter table public.m6_comprehension_attempts drop constraint m6_reading_source_check;
alter table public.m6_comprehension_attempts add constraint m6_reading_source_check check (
 (module_id is not null and passage_id is not null and material_id is null and activity_assignment_id is null)
 or (module_id is null and passage_id is null and material_id is not null and assignment_id is null and oral_reading_attempt_id is not null
 and ((activity_assignment_id is not null and room_id is not null) or (activity_assignment_id is null and room_id is null)))
);
-- A non-null, stable material identity: repeated readings/sets/revisions cannot reset M6.
create unique index personal_material_one_assessment on public.m6_comprehension_attempts(user_id,material_id)
 where material_id is not null and activity_assignment_id is null and room_id is null;

create function public.personal_material_reading_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.uploaded_materials;
begin
 if new.material_id is not null and new.activity_assignment_id is null and new.room_id is null then
  m := public.personal_material_source(new.user_id,new.material_id);
  if new.passage_snapshot is distinct from btrim(m.content_text) or new.language_snapshot is distinct from m.language then
   raise exception 'Personal reading must match the saved source' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.personal_material_reading_guard() from public,anon,authenticated;
create trigger personal_material_reading_guard before insert on public.oral_reading_attempts
 for each row execute function public.personal_material_reading_guard();

-- Function fingerprint guards and narrowly scoped completion/trigger extensions follow
-- in this file; generated from the verified 2026-11-11 Staging definitions.

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
end $function$
;
CREATE OR REPLACE FUNCTION public.m7_enqueue_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.material_id is not null and new.activity_assignment_id is null and new.room_id is null then return new; end if;
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
  if new.material_id is not null and new.activity_assignment_id is null and new.room_id is null then return new; end if;
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
notify pgrst,'reload schema';
commit;
