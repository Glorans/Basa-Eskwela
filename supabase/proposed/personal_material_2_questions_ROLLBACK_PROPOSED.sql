-- PROPOSED. Refuses to discard any saved bank, lease or assessment. Roll back #2 before #1.
begin;
set local lock_timeout='5s';
do $$ begin
if md5(replace(pg_get_functiondef('public.personal_material_access(uuid,uuid,text,text,jsonb)'::regprocedure),chr(13),'')) is distinct from 'b0c2bd005d072559b4e6f372475847db' then raise exception 'Unexpected installed definition: personal_material_access(uuid,uuid,text,text,jsonb)'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_assessment_guard()'::regprocedure),chr(13),'')) is distinct from '8c10118257606e2835a29b4ce6302e17' then raise exception 'Unexpected installed definition: personal_material_assessment_guard()'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_generation(uuid,uuid,text,uuid,jsonb)'::regprocedure),chr(13),'')) is distinct from '807495e3c37f24cb9d8be7622b66d67a' then raise exception 'Unexpected installed definition: personal_material_generation(uuid,uuid,text,uuid,jsonb)'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_response_guard()'::regprocedure),chr(13),'')) is distinct from 'ef6108272bd531afe8e04e5b7c5f265e' then raise exception 'Unexpected installed definition: personal_material_response_guard()'; end if;
if md5(replace(pg_get_functiondef('public.personal_material_text_guard()'::regprocedure),chr(13),'')) is distinct from '8543273b2f195e322f52c13e40749ba4' then raise exception 'Unexpected installed definition: personal_material_text_guard()'; end if;
end $$;

lock table public.personal_material_question_sets,public.personal_material_generation_leases,public.m6_comprehension_attempts in access exclusive mode;
do $$ begin
 if exists(select 1 from public.personal_material_question_sets) or exists(select 1 from public.personal_material_generation_leases)
 or exists(select 1 from public.m6_comprehension_attempts where personal_question_set_id is not null) then
  raise exception 'Recovery required: retain personal data and schema; do not drop or erase history'; end if;
end $$;
drop trigger personal_material_text_guard on public.uploaded_materials;
drop trigger personal_material_response_guard on public.m6_comprehension_responses;
drop trigger personal_material_assessment_guard on public.m6_comprehension_attempts;
drop function public.personal_material_text_guard();
drop function public.personal_material_response_guard();
drop function public.personal_material_assessment_guard();
drop function public.personal_material_access(uuid,uuid,text,text,jsonb);
drop function public.personal_material_generation(uuid,uuid,text,uuid,jsonb);
alter table public.m6_comprehension_attempts drop column personal_question_set_id;
drop table public.personal_material_generation_leases;
drop table public.personal_material_question_sets;
notify pgrst,'reload schema';
commit;
