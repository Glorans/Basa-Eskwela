-- READ-ONLY verification for m3_all_role_refinement_PROPOSED.sql. Every row should say PASS.
select case when count(*) = 2 then 'PASS' else 'FAIL' end || '  uploaded_materials.trashed_at/trashed_by present'
  from information_schema.columns where table_schema = 'public' and table_name = 'uploaded_materials' and column_name in ('trashed_at', 'trashed_by');
select case when (select count(*) from public.uploaded_materials where trashed_at is not null) = 0 then 'PASS' else 'INFO' end || '  no upload trashed by the migration itself';
select case when pg_get_constraintdef(oid) like '%6, 9, 12%' then 'PASS' else 'FAIL' end || '  private sets allow 6, 9 or 12 questions'
  from pg_constraint where conname = 'personal_material_question_sets_questions_check';
select case when pg_get_constraintdef(oid) like '%learner_edited_private%' then 'PASS' else 'FAIL' end || '  learner_edited_private state allowed'
  from pg_constraint where conname = 'personal_material_question_sets_validation_state_check';
select case when prosrc like '%correctOptionIndex%' then 'PASS' else 'FAIL' end || '  material sets accept an explicit correct option'
  from pg_proc where proname = 'm3_write_material_question_set' and pronamespace = 'public'::regnamespace;
select case when prosrc like '%not in (6,9,12)%' then 'PASS' else 'FAIL' end || '  private generation accepts 6, 9 or 12'
  from pg_proc where proname = 'personal_material_generation' and pronamespace = 'public'::regnamespace;
select case when prosecdef and not has_function_privilege('authenticated', oid, 'execute') and has_function_privilege('service_role', oid, 'execute')
  then 'PASS' else 'FAIL' end || '  personal_material_save_bank: security definer, service_role only'
  from pg_proc where proname = 'personal_material_save_bank' and pronamespace = 'public'::regnamespace;
select case when not has_function_privilege('authenticated', 'public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)', 'execute')
  then 'PASS' else 'FAIL' end || '  material set writer still not callable by clients';
select case when count(*) = 0 then 'PASS' else 'FAIL' end || '  existing private sets unchanged (all still ai_validated_private, 9 questions)'
  from public.personal_material_question_sets where validation_state <> 'ai_validated_private' or jsonb_array_length(questions) <> 9;
