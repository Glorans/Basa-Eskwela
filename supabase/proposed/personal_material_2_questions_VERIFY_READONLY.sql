-- READ ONLY. Every matches_expected must be true.
begin read only;
select 'm6_assert_completion_access(uuid)' signature, md5(replace(pg_get_functiondef('public.m6_assert_completion_access(uuid)'::regprocedure),chr(13),''))='c9a82099899e7caa47c92ef70c800bd4' matches_expected;
select 'm7_enqueue_completion()' signature, md5(replace(pg_get_functiondef('public.m7_enqueue_completion()'::regprocedure),chr(13),''))='563885607c852a10581f83699c7efd74' matches_expected;
select 'm8_on_comprehension_completed()' signature, md5(replace(pg_get_functiondef('public.m8_on_comprehension_completed()'::regprocedure),chr(13),''))='f2f7fa2b71a135b195ae43d8aa19c4e3' matches_expected;
select 'personal_material_access(uuid,uuid,text,text,jsonb)' signature, md5(replace(pg_get_functiondef('public.personal_material_access(uuid,uuid,text,text,jsonb)'::regprocedure),chr(13),''))='b0c2bd005d072559b4e6f372475847db' matches_expected;
select 'personal_material_assessment_guard()' signature, md5(replace(pg_get_functiondef('public.personal_material_assessment_guard()'::regprocedure),chr(13),''))='8c10118257606e2835a29b4ce6302e17' matches_expected;
select 'personal_material_generation(uuid,uuid,text,uuid,jsonb)' signature, md5(replace(pg_get_functiondef('public.personal_material_generation(uuid,uuid,text,uuid,jsonb)'::regprocedure),chr(13),''))='807495e3c37f24cb9d8be7622b66d67a' matches_expected;
select 'personal_material_reading_guard()' signature, md5(replace(pg_get_functiondef('public.personal_material_reading_guard()'::regprocedure),chr(13),''))='68313ab99e73dff64aa5562009f38994' matches_expected;
select 'personal_material_response_guard()' signature, md5(replace(pg_get_functiondef('public.personal_material_response_guard()'::regprocedure),chr(13),''))='ef6108272bd531afe8e04e5b7c5f265e' matches_expected;
select 'personal_material_revision(uploaded_materials)' signature, md5(replace(pg_get_functiondef('public.personal_material_revision(uploaded_materials)'::regprocedure),chr(13),''))='6dbeac011e402aef96d170d7e3a04130' matches_expected;
select 'personal_material_source(uuid,uuid,boolean)' signature, md5(replace(pg_get_functiondef('public.personal_material_source(uuid,uuid,boolean)'::regprocedure),chr(13),''))='1695ac122729fd2d2320d4eb14746c63' matches_expected;
select 'personal_material_text_guard()' signature, md5(replace(pg_get_functiondef('public.personal_material_text_guard()'::regprocedure),chr(13),''))='8543273b2f195e322f52c13e40749ba4' matches_expected;
select relname,relrowsecurity from pg_class where oid in ('public.personal_material_state'::regclass,'public.personal_material_question_sets'::regclass,'public.personal_material_generation_leases'::regclass);
select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name like 'personal_material_%';
select indexdef from pg_indexes where indexname='personal_material_one_assessment';
rollback;
