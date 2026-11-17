-- PROPOSAL ONLY. READ-ONLY. Changes nothing. Every row must be ok = true.
-- Run BEFORE the migration (and after a verified backup).
select * from (values
  ('P1 personal_material_access(uuid,uuid,text,text,jsonb) is the verified definition', coalesce((select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.personal_material_access(uuid,uuid,text,text,jsonb)')) = 'b244f25e994cb429571f263fbc5e6f7e', false), ''),
  ('P2 personal_material_generation(uuid,uuid,text,uuid,jsonb) is the verified definition', coalesce((select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.personal_material_generation(uuid,uuid,text,uuid,jsonb)')) = '9e243fba6dbd1a2aa0ea0837e423efbd', false), ''),
  ('P3 personal_material_text_guard() is the verified definition', coalesce((select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.personal_material_text_guard()')) = '1dc6ba861d27c2c551e79ec5ed510433', false), ''),
  ('P4 personal_material_assessment_guard() is the verified definition', coalesce((select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.personal_material_assessment_guard()')) = 'fb5c5c6c978ea6ec2847ac64416ec612', false), ''),
  ('P5 personal_material_features() not installed yet', to_regprocedure('public.personal_material_features()') is null, ''),
  ('P6 question sets: one per text version (old unique constraint present)', exists(select 1 from pg_constraint where conname='personal_material_question_sets_material_id_revision_key'), ''),
  ('P7 text guard trigger present on uploaded_materials', exists(select 1 from pg_trigger where tgname='personal_material_text_guard' and tgrelid='public.uploaded_materials'::regclass), ''),
  ('P8 info: personal question sets', true, (select count(*)::text from public.personal_material_question_sets)),
  ('P9 info: unfinished personal assessments (their texts stay locked)', true, (select count(*)::text from public.m6_comprehension_attempts where material_id is not null and room_id is null and activity_assignment_id is null and status is distinct from 'completed'))
) as checks(check_name, ok, detail) order by check_name;
