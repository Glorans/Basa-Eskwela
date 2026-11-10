-- READ ONLY. Capture before any proposal; never run a proposal as a preflight.
begin read only;
select current_setting('transaction_read_only') as read_only;
select p.oid::regprocedure::text signature, md5(replace(pg_get_functiondef(p.oid),chr(13),'')) fingerprint, p.proacl, p.prosecdef, p.proconfig from pg_proc p where p.oid in ('public.m6_assert_completion_access(uuid)'::regprocedure,'public.m7_enqueue_completion()'::regprocedure,'public.m8_on_comprehension_completed()'::regprocedure,'public.m6_one_assessment_per_activity()'::regprocedure);
select conrelid::regclass,conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.uploaded_materials'::regclass,'public.oral_reading_attempts'::regclass,'public.m6_comprehension_attempts'::regclass,'public.material_question_sets'::regclass);
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in ('public.oral_reading_attempts'::regclass,'public.m6_comprehension_attempts'::regclass,'public.m6_comprehension_responses'::regclass,'public.uploaded_materials'::regclass);
select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in ('uploaded_materials','material_question_sets','comprehension_question_answers','oral_reading_attempts','m6_comprehension_attempts');
select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('uploaded_materials','comprehension_question_answers','oral_reading_attempts','m6_comprehension_attempts');
rollback;
