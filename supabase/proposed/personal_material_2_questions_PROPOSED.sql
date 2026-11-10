-- PROPOSED ONLY. Depends on personal_material_1_sources_PROPOSED.sql.
begin;
set local lock_timeout = '5s';
do $$ begin
if md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure),chr(13),'')) is distinct from 'c9a82099899e7caa47c92ef70c800bd4' then raise exception 'Unexpected installed definition: m6_assert_completion_access(uuid)'; end if;
if md5(replace(pg_get_functiondef('public.m7_enqueue_completion()'::regprocedure),chr(13),'')) is distinct from '563885607c852a10581f83699c7efd74' then raise exception 'Unexpected installed definition: m7_enqueue_completion()'; end if;
if md5(replace(pg_get_functiondef('public.m8_on_comprehension_completed()'::regprocedure),chr(13),'')) is distinct from 'f2f7fa2b71a135b195ae43d8aa19c4e3' then raise exception 'Unexpected installed definition: m8_on_comprehension_completed()'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_reading_guard()'::regprocedure),chr(13),'')) is distinct from '68313ab99e73dff64aa5562009f38994' then raise exception 'Unexpected installed definition: personal_material_reading_guard()'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_revision(uploaded_materials)'::regprocedure),chr(13),'')) is distinct from '6dbeac011e402aef96d170d7e3a04130' then raise exception 'Unexpected installed definition: personal_material_revision(uploaded_materials)'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_source(uuid,uuid,boolean)'::regprocedure),chr(13),'')) is distinct from '1695ac122729fd2d2320d4eb14746c63' then raise exception 'Unexpected installed definition: personal_material_source(uuid,uuid,boolean)'; end if;
end $$;

create table public.personal_material_question_sets (
 id uuid primary key default gen_random_uuid(),
 material_id uuid not null references public.uploaded_materials(id) on delete restrict,
 user_id uuid not null references public.profiles(id) on delete restrict,
 revision text not null,
 validation_state text not null check(validation_state='ai_validated_private'),
 questions jsonb not null check(jsonb_typeof(questions)='array' and jsonb_array_length(questions)=9),
 created_at timestamptz not null default clock_timestamp(),
 unique(material_id,revision)
);
create table public.personal_material_generation_leases (
 user_id uuid primary key references public.profiles(id) on delete restrict,
 material_id uuid not null references public.uploaded_materials(id) on delete restrict,
 revision text not null,
 token uuid not null,
 expires_at timestamptz not null
);
alter table public.personal_material_question_sets enable row level security;
alter table public.personal_material_generation_leases enable row level security;
revoke all on public.personal_material_question_sets, public.personal_material_generation_leases from public,anon,authenticated;
grant all on public.personal_material_question_sets, public.personal_material_generation_leases to service_role;
alter table public.m6_comprehension_attempts add column personal_question_set_id uuid
 references public.personal_material_question_sets(id) on delete restrict;

create function public.personal_material_access(actor uuid, material uuid, operation text,
 expected_revision text default null, missing_pages jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.uploaded_materials; s public.personal_material_state; q public.personal_material_question_sets;
 a public.m6_comprehension_attempts; r uuid; rev text;
begin
 -- Material row lock serializes confirmation, deletion, starts and generation completion.
 perform 1 from public.uploaded_materials where id=material for update;
 select * into m from public.uploaded_materials where id=material;
 if not found or m.uploaded_by is distinct from actor or not exists(select 1 from public.profiles where id=actor and role='general_user') then
  raise exception 'Personal material access denied' using errcode='42501';
 end if;
 -- Deletion remains available even for failed/legacy extraction records.
 if operation='delete' then
  if exists(select 1 from public.modules where source_material_id=material) then raise exception 'Material is used by a module'; end if;
  insert into public.personal_material_state(material_id,deleted_at) values(material,clock_timestamp())
   on conflict(material_id) do update set deleted_at=coalesce(personal_material_state.deleted_at,clock_timestamp());
  return jsonb_build_object('deleted',true);
 end if;
 m := public.personal_material_source(actor,material,false);
 rev := public.personal_material_revision(m);
 if operation='metadata' then
  insert into public.personal_material_state(material_id,missing_pages) values(material,missing_pages)
   on conflict(material_id) do update set missing_pages=excluded.missing_pages;
 elsif operation='confirm' then
  if rev is distinct from expected_revision then raise exception 'The text changed. Review it again'; end if;
  insert into public.personal_material_state(material_id,reviewed_revision,reviewed_at) values(material,rev,clock_timestamp())
   on conflict(material_id) do update set reviewed_revision=rev,reviewed_at=clock_timestamp();
 elsif operation not in ('status','source','bank') then raise exception 'Invalid personal practice operation';
 end if;
 select * into s from public.personal_material_state where material_id=material;
 if operation in ('source','bank') then m := public.personal_material_source(actor,material); end if;
 if operation='source' then return jsonb_build_object('title',m.title,'text',btrim(m.content_text),'language',m.language); end if;
 select * into q from public.personal_material_question_sets where material_id=material and user_id=actor and revision=rev;
 if operation='bank' then
  if q.id is null then raise exception 'Generate private questions before comprehension'; end if;
  return jsonb_build_object('id',q.id,'questions',q.questions);
 end if;
 select * into a from public.m6_comprehension_attempts where user_id=actor and material_id=material and activity_assignment_id is null and room_id is null;
 select id into r from public.oral_reading_attempts where user_id=actor and material_id=material and activity_assignment_id is null
  and room_id is null and passage_snapshot=btrim(m.content_text) and language_snapshot=m.language order by completed_at desc limit 1;
 -- Never return the bank, keys, hints or explanations in status/generation responses.
 return jsonb_build_object('revision',rev,'reviewed',coalesce(s.reviewed_revision=rev,false),'missingPages',s.missing_pages,
 'questionSetId',q.id,'readingId',r,'attemptId',a.id,'attemptStatus',a.status);
end $$;
revoke all on function public.personal_material_access(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.personal_material_access(uuid,uuid,text,text,jsonb) to service_role;

create function public.personal_material_generation(actor uuid, material uuid, operation text, token uuid default null, bank jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.uploaded_materials; q public.personal_material_question_sets; l public.personal_material_generation_leases;
 rev text; next_token uuid; item jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('personal-generation|' || actor::text,0));
 perform 1 from public.uploaded_materials where id=material for update;
 if operation='fail' then
  delete from public.personal_material_generation_leases where user_id=actor and material_id=material and personal_material_generation_leases.token=personal_material_generation.token;
  return '{}'::jsonb;
 end if;
 m := public.personal_material_source(actor,material);
 rev := public.personal_material_revision(m);
 if length(m.content_text)>30000 then raise exception 'Question generation is limited to 30,000 characters'; end if;
 select * into q from public.personal_material_question_sets where material_id=material and revision=rev and user_id=actor;
 if q.id is not null then return jsonb_build_object('id',q.id,'reused',true); end if;
 if exists(select 1 from public.m6_comprehension_attempts where user_id=actor and material_id=material and activity_assignment_id is null) then
  raise exception 'This material already has an assessment. Use its saved questions and result';
 end if;
 select * into l from public.personal_material_generation_leases where user_id=actor;
 if operation='begin' then
  if l.expires_at>clock_timestamp() then raise exception 'A generation is already running. Please wait'; end if;
  if (select count(*) from public.personal_material_question_sets where user_id=actor and created_at>clock_timestamp()-interval '24 hours')>=5 then
   raise exception 'Five new question sets are allowed per rolling 24 hours. Reuse a saved set or try later';
  end if;
  next_token:=gen_random_uuid();
  insert into public.personal_material_generation_leases values(actor,material,rev,next_token,clock_timestamp()+interval '5 minutes')
   on conflict(user_id) do update set material_id=excluded.material_id,revision=excluded.revision,token=excluded.token,expires_at=excluded.expires_at;
  return jsonb_build_object('token',next_token,'reused',false);
 elsif operation='finish' then
  if l.token is distinct from token or l.material_id is distinct from material or l.revision is distinct from rev or l.expires_at<=clock_timestamp() or l.token is null then
   raise exception 'Generation expired or the material changed. Please retry';
  end if;
  if jsonb_typeof(bank) is distinct from 'array' or jsonb_array_length(bank)<>9 then raise exception 'Invalid private question bank'; end if;
  foreach rev in array array['literal','inferential','critical'] loop
   if (select count(*) from jsonb_array_elements(bank) v where v->>'type'=rev)<>3 then raise exception 'Invalid question classifications'; end if;
  end loop;
  for item in select value from jsonb_array_elements(bank) loop
   if nullif(btrim(item->>'questionText'),'') is null or nullif(btrim(item->>'answerExplanation'),'') is null
    or nullif(btrim(item->>'scaffoldingHint'),'') is null or nullif(btrim(item->>'supportingEvidence'),'') is null
    or jsonb_typeof(item->'options') is distinct from 'array' or jsonb_array_length(item->'options')<>4
    or item->>'correctOptionIndex' is null or (item->>'correctOptionIndex')::integer not between 0 and 3
    or nullif(item->>'id','') is null
    or (select count(distinct lower(btrim(v))) from jsonb_array_elements_text(item->'options') v where nullif(btrim(v),'') is not null)<>4
    or strpos(regexp_replace(m.content_text,'\s+',' ','g'),regexp_replace(item->>'supportingEvidence','\s+',' ','g'))=0
    then raise exception 'Invalid private question or evidence'; end if;
   perform (item->>'id')::uuid;
  end loop;
  insert into public.personal_material_question_sets(material_id,user_id,revision,validation_state,questions)
   values(material,actor,public.personal_material_revision(m),'ai_validated_private',bank) returning * into q;
  delete from public.personal_material_generation_leases where user_id=actor;
  return jsonb_build_object('id',q.id,'reused',false);
 else raise exception 'Invalid generation operation'; end if;
end $$;
revoke all on function public.personal_material_generation(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.personal_material_generation(uuid,uuid,text,uuid,jsonb) to service_role;

create function public.personal_material_assessment_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.uploaded_materials; q public.personal_material_question_sets;
begin
 if new.material_id is not null and new.activity_assignment_id is null and new.room_id is null then
  perform 1 from public.uploaded_materials where id=new.material_id for update;
  m:=public.personal_material_source(new.user_id,new.material_id);
  select * into q from public.personal_material_question_sets where id=new.personal_question_set_id
   and material_id=m.id and user_id=new.user_id and revision=public.personal_material_revision(m);
  if q.id is null or new.question_snapshot is distinct from q.questions or new.passage_text is distinct from btrim(m.content_text)
   or new.language is distinct from m.language then raise exception 'Invalid private assessment source' using errcode='42501'; end if;
  perform 1 from public.oral_reading_attempts where id=new.oral_reading_attempt_id and user_id=new.user_id and material_id=m.id
   and room_id is null and activity_assignment_id is null and passage_snapshot=new.passage_text and language_snapshot=new.language;
  if not found then raise exception 'Complete your own reading first' using errcode='42501'; end if;
 elsif new.personal_question_set_id is not null then raise exception 'Private sets cannot be used in shared activities' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.personal_material_assessment_guard() from public,anon,authenticated;
create trigger personal_material_assessment_guard before insert on public.m6_comprehension_attempts for each row execute function public.personal_material_assessment_guard();

-- Answers also fail closed after deletion; the saved, unfinished snapshot is retained.
create function public.personal_material_response_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.m6_comprehension_attempts;
begin
 select * into a from public.m6_comprehension_attempts where id=new.attempt_id;
 if a.material_id is not null and a.activity_assignment_id is null and a.room_id is null then
  perform public.personal_material_source(a.user_id,a.material_id);
 end if;
 return new;
end $$;
revoke all on function public.personal_material_response_guard() from public,anon,authenticated;
create trigger personal_material_response_guard before insert or update on public.m6_comprehension_responses
 for each row execute function public.personal_material_response_guard();

create function public.personal_material_text_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.content_text is distinct from old.content_text or new.language is distinct from old.language or new.uploaded_by is distinct from old.uploaded_by)
 and exists(select 1 from public.personal_material_state where material_id=old.id)
 and (exists(select 1 from public.oral_reading_attempts where material_id=old.id and activity_assignment_id is null)
   or exists(select 1 from public.personal_material_question_sets where material_id=old.id)) then
  raise exception 'Personal practice has started. Upload a corrected copy; saved practice remains unchanged';
 end if;
 return new;
end $$;
revoke all on function public.personal_material_text_guard() from public,anon,authenticated;
create trigger personal_material_text_guard before update on public.uploaded_materials for each row execute function public.personal_material_text_guard();
notify pgrst,'reload schema';
commit;
