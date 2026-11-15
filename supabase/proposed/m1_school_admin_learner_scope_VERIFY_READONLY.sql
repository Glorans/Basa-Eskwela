-- READ-ONLY. m1_school_admin_learner_scope: run PREFLIGHT before applying and POST-APPLY after. Every row must be ok = true.
-- Expected expressions are the deparsed policy texts (pg_policies) of the current Staging policies and of the proposal.
-- A mismatch in PREFLIGHT means Staging differs from the 2026-11-15 backup: stop and re-review, do not apply.

-- PREFLIGHT
with expected(tbl, policyname, qual, with_check) as (values
  ('public.comprehension_question_answers', 'M3 admins and owning teachers read answer keys', '((m3_current_role() = ''admin''::text) OR ((m3_current_role() = ''teacher''::text) AND (EXISTS ( SELECT 1
   FROM comprehension_questions question
  WHERE ((question.id = comprehension_question_answers.question_id) AND question.generated_by_ai AND (question.material_id IS NOT NULL) AND m3_owns_material(question.material_id))))))', ''),
  ('public.comprehension_question_answers', 'M3 admins create answer keys', '', '(m3_current_role() = ''admin''::text)'),
  ('public.comprehension_question_answers', 'M3 admins delete answer keys', '(m3_current_role() = ''admin''::text)', ''),
  ('public.comprehension_question_answers', 'M3 admins update all answer keys', '(m3_current_role() = ''admin''::text)', '(m3_current_role() = ''admin''::text)'),
  ('public.comprehension_questions', 'M3 admins create questions', '', '(m3_current_role() = ''admin''::text)'),
  ('public.comprehension_questions', 'M3 admins delete questions', '(m3_current_role() = ''admin''::text)', ''),
  ('public.comprehension_questions', 'M3 admins update all questions', '(m3_current_role() = ''admin''::text)', '(m3_current_role() = ''admin''::text)'),
  ('public.comprehension_questions', 'M3 role-aware safe question reads', '((m3_current_role() = ''admin''::text) OR ((module_id IS NOT NULL) AND (review_status = ''reviewed''::text) AND m3_can_read_module(module_id)) OR ((material_id IS NOT NULL) AND m3_owns_material(material_id) AND ((m3_current_role() = ''teacher''::text) OR ((m3_current_role() = ''general_user''::text) AND (review_status = ''reviewed''::text)))))', ''),
  ('public.material_question_sets', 'M3 admins and owning teachers read saved sets', '((m3_current_role() = ''admin''::text) OR ((m3_current_role() = ''teacher''::text) AND m3_owns_material(material_id)))', ''),
  ('public.uploaded_materials', 'M3 material owners and admins delete safe materials', '(((m3_current_role() = ''admin''::text) OR ((m3_current_role() = ANY (ARRAY[''teacher''::text, ''general_user''::text])) AND (uploaded_by = auth.uid()))) AND m3_material_is_unreferenced(id) AND m3_material_file_is_absent(id))', ''),
  ('public.uploaded_materials', 'M3 material owners and admins read materials', '((m3_current_role() = ''admin''::text) OR ((m3_current_role() = ANY (ARRAY[''teacher''::text, ''general_user''::text])) AND (uploaded_by = auth.uid())))', ''),
  ('storage.objects', 'M3 owners and admins delete reading material objects', '((bucket_id = ''reading-materials''::text) AND ((m3_current_role() = ''admin''::text) OR ((m3_current_role() = ANY (ARRAY[''teacher''::text, ''general_user''::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text))) AND m3_storage_object_is_deletable(name))', ''),
  ('storage.objects', 'M3 owners and admins read reading material objects', '((bucket_id = ''reading-materials''::text) AND ((m3_current_role() = ''admin''::text) OR ((m3_current_role() = ANY (ARRAY[''teacher''::text, ''general_user''::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text))))', '')
)
select 'policy ' || e.tbl || ' "' || e.policyname || '" has the expected expression' as check_name,
       coalesce((select coalesce(p.qual, '') = e.qual and coalesce(p.with_check, '') = e.with_check
                 from pg_policies p where p.schemaname || '.' || p.tablename = e.tbl and p.policyname = e.policyname), false) as ok
from expected e
union all
select 'helper ' || f || ' not installed yet', to_regprocedure(f) is null
from unnest(array['public.m1_school_admin_sees_owner(uuid)', 'public.m1_school_admin_sees_material(uuid)',
                  'public.m1_school_admin_sees_question(uuid)', 'public.m1_school_admin_sees_storage_owner(text)']) f
union all
select 'no School Admin rule on these tables still uses the bare Admin check',
       exists (select 1 from pg_policies p
         where p.schemaname || '.' || p.tablename in ('public.uploaded_materials', 'public.material_question_sets',
               'public.comprehension_questions', 'public.comprehension_question_answers', 'storage.objects')
           and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%m3_current_role() = ''admin''::text%');

-- POST-APPLY
with expected(tbl, policyname, qual, with_check) as (values
  ('public.comprehension_question_answers', 'M3 admins and owning teachers read answer keys', '(m1_school_admin_sees_question(question_id) OR ((m3_current_role() = ''teacher''::text) AND (EXISTS ( SELECT 1
   FROM comprehension_questions question
  WHERE ((question.id = comprehension_question_answers.question_id) AND question.generated_by_ai AND (question.material_id IS NOT NULL) AND m3_owns_material(question.material_id))))))', ''),
  ('public.comprehension_question_answers', 'M3 admins create answer keys', '', 'm1_school_admin_sees_question(question_id)'),
  ('public.comprehension_question_answers', 'M3 admins delete answer keys', 'm1_school_admin_sees_question(question_id)', ''),
  ('public.comprehension_question_answers', 'M3 admins update all answer keys', 'm1_school_admin_sees_question(question_id)', 'm1_school_admin_sees_question(question_id)'),
  ('public.comprehension_questions', 'M3 admins create questions', '', 'm1_school_admin_sees_material(material_id)'),
  ('public.comprehension_questions', 'M3 admins delete questions', 'm1_school_admin_sees_material(material_id)', ''),
  ('public.comprehension_questions', 'M3 admins update all questions', 'm1_school_admin_sees_material(material_id)', 'm1_school_admin_sees_material(material_id)'),
  ('public.comprehension_questions', 'M3 role-aware safe question reads', '(m1_school_admin_sees_material(material_id) OR ((module_id IS NOT NULL) AND (review_status = ''reviewed''::text) AND m3_can_read_module(module_id)) OR ((material_id IS NOT NULL) AND m3_owns_material(material_id) AND ((m3_current_role() = ''teacher''::text) OR ((m3_current_role() = ''general_user''::text) AND (review_status = ''reviewed''::text)))))', ''),
  ('public.material_question_sets', 'M3 admins and owning teachers read saved sets', '(m1_school_admin_sees_material(material_id) OR ((m3_current_role() = ''teacher''::text) AND m3_owns_material(material_id)))', ''),
  ('public.uploaded_materials', 'M3 material owners and admins delete safe materials', '((m1_school_admin_sees_owner(uploaded_by) OR ((m3_current_role() = ANY (ARRAY[''teacher''::text, ''general_user''::text])) AND (uploaded_by = auth.uid()))) AND m3_material_is_unreferenced(id) AND m3_material_file_is_absent(id))', ''),
  ('public.uploaded_materials', 'M3 material owners and admins read materials', '(m1_school_admin_sees_owner(uploaded_by) OR ((m3_current_role() = ANY (ARRAY[''teacher''::text, ''general_user''::text])) AND (uploaded_by = auth.uid())))', ''),
  ('storage.objects', 'M3 owners and admins delete reading material objects', '((bucket_id = ''reading-materials''::text) AND (m1_school_admin_sees_storage_owner((storage.foldername(name))[1]) OR ((m3_current_role() = ANY (ARRAY[''teacher''::text, ''general_user''::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text))) AND m3_storage_object_is_deletable(name))', ''),
  ('storage.objects', 'M3 owners and admins read reading material objects', '((bucket_id = ''reading-materials''::text) AND (m1_school_admin_sees_storage_owner((storage.foldername(name))[1]) OR ((m3_current_role() = ANY (ARRAY[''teacher''::text, ''general_user''::text])) AND ((storage.foldername(name))[1] = (auth.uid())::text))))', '')
)
select 'policy ' || e.tbl || ' "' || e.policyname || '" has the expected expression' as check_name,
       coalesce((select coalesce(p.qual, '') = e.qual and coalesce(p.with_check, '') = e.with_check
                 from pg_policies p where p.schemaname || '.' || p.tablename = e.tbl and p.policyname = e.policyname), false) as ok
from expected e
union all
select 'helper ' || f || ' is SECURITY DEFINER with empty search_path; authenticated may execute, anon may not',
       coalesce((select p.prosecdef and p.proconfig @> array['search_path=""']
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE')
                 from pg_proc p where p.oid = to_regprocedure(f)), false)
from unnest(array['public.m1_school_admin_sees_owner(uuid)', 'public.m1_school_admin_sees_material(uuid)',
                  'public.m1_school_admin_sees_question(uuid)', 'public.m1_school_admin_sees_storage_owner(text)']) f
union all
select 'no School Admin rule on these tables still uses the bare Admin check',
       not exists (select 1 from pg_policies p
         where p.schemaname || '.' || p.tablename in ('public.uploaded_materials', 'public.material_question_sets',
               'public.comprehension_questions', 'public.comprehension_question_answers', 'storage.objects')
           and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%m3_current_role() = ''admin''::text%');
