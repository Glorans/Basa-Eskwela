-- PROPOSAL ONLY. READ-ONLY. Changes nothing. Every row must be ok = true.
-- Run AFTER the migration. V10 must equal PREFLIGHT P8.
select * from (values
  ('V1 personal_material_access(uuid,uuid,text,text,jsonb) is the new definition', coalesce((select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.personal_material_access(uuid,uuid,text,text,jsonb)')) = 'd4484808eee33ea4615d17127bfe573e', false), ''),
  ('V2 personal_material_generation(uuid,uuid,text,uuid,jsonb) is the new definition', coalesce((select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.personal_material_generation(uuid,uuid,text,uuid,jsonb)')) = '9c7535975ea4ca7a3ebd3b820ab6fb75', false), ''),
  ('V3 personal_material_text_guard() is the new definition', coalesce((select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.personal_material_text_guard()')) = '0877526687856b35a6cf71ea50414a0c', false), ''),
  ('V4 personal_material_assessment_guard() is the new definition', coalesce((select md5(replace(prosrc,chr(13),'')) from pg_proc where oid=to_regprocedure('public.personal_material_assessment_guard()')) = '5a35e4da891d1b0c3c02c87ff028d73c', false), ''),
  ('V5 personal_material_features() installed, service_role only', to_regprocedure('public.personal_material_features()') is not null and has_function_privilege('service_role','public.personal_material_features()','EXECUTE') and not has_function_privilege('authenticated','public.personal_material_features()','EXECUTE') and not has_function_privilege('anon','public.personal_material_features()','EXECUTE'), ''),
  ('V6 one CURRENT set per text version (partial unique index)', exists(select 1 from pg_indexes where indexname='personal_material_current_question_set' and indexdef ilike '%where (replaced_at is null)%'), ''),
  ('V7 old unique constraint gone', not exists(select 1 from pg_constraint where conname='personal_material_question_sets_material_id_revision_key'), ''),
  ('V8 no set is marked replaced yet', not exists(select 1 from public.personal_material_question_sets where replaced_at is not null), ''),
  ('V9 question sets still private (no client access)', not has_table_privilege('authenticated','public.personal_material_question_sets','SELECT') and not has_table_privilege('anon','public.personal_material_question_sets','SELECT'), ''),
  ('V10 info: personal question sets (= P8)', true, (select count(*)::text from public.personal_material_question_sets))
) as checks(check_name, ok, detail) order by check_name;
