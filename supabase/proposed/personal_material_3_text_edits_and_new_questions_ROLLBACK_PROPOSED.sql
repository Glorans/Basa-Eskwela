-- PROPOSAL ONLY. ROLLBACK for personal_material_3_text_edits_and_new_questions_PROPOSED.sql: restores the four functions exactly as verified on
-- ReadFlow-Staging 2026-11-18, removes personal_material_features(), and restores one question set per text version.
-- Replaced question sets (replaced_at is not null) can never be used by an assessment (the guards refuse them), so
-- they are deleted here; that is the only data this rollback removes. The ON DELETE RESTRICT foreign key from
-- m6_comprehension_attempts stops the rollback if one were referenced. Corrected reading texts stay as saved.
begin;
set local lock_timeout = '5s';
delete from public.personal_material_question_sets where replaced_at is not null;
drop index public.personal_material_current_question_set;
alter table public.personal_material_question_sets add constraint personal_material_question_sets_material_id_revision_key unique(material_id,revision);
alter table public.personal_material_question_sets drop column replaced_at;
drop function public.personal_material_features();

create or replace function public.personal_material_text_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.content_text is distinct from old.content_text or new.language is distinct from old.language or new.uploaded_by is distinct from old.uploaded_by)
 and exists(select 1 from public.personal_material_state where material_id=old.id)
 and (exists(select 1 from public.oral_reading_attempts where material_id=old.id and activity_assignment_id is null)
   or exists(select 1 from public.personal_material_question_sets where material_id=old.id)) then
  raise exception 'Personal practice has started. Upload a corrected copy; saved practice remains unchanged';
 end if;
 return new;
end $$;

create or replace function public.personal_material_access(actor uuid, material uuid, operation text,
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

create or replace function public.personal_material_generation(actor uuid, material uuid, operation text, token uuid default null, bank jsonb default null)
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

create or replace function public.personal_material_assessment_guard() returns trigger language plpgsql security definer set search_path='' as $$
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

notify pgrst, 'reload schema';
commit;
