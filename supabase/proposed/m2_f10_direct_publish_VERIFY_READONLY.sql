-- READ-ONLY verification for m2_f10_direct_publish_PROPOSED.sql. Changes nothing. Every row must say PASS.
with checks(name, ok) as (values
  ('version guard is the reviewed direct-publish body', md5((select prosrc from pg_proc where oid = 'public.m2_guard_assessment_version()'::regprocedure)) = '5cf32ad49b1f6256b84082ed7ac78442'),
  ('publish function is the reviewed direct-publish body', md5((select prosrc from pg_proc where oid = 'public.m2_publish_assessment_version(uuid,uuid)'::regprocedure)) = '2d993cbbcad20db77091ee45a43264d1'),
  ('assignment guard is the reviewed body', md5((select prosrc from pg_proc where oid = 'public.m2_guard_reassessment_assignment()'::regprocedure)) = 'cb8e4e3bd227b208272dd56455c4b5a0'),
  ('result recording is the reviewed body', md5((select prosrc from pg_proc where oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::regprocedure)) = 'd68fcf8a6a500007fc776bb904c79787'),
  ('direct publishing is limited to reassessment packages', (select prosrc from pg_proc where oid = 'public.m2_guard_assessment_version()'::regprocedure) like '%v_kind = ''reassessment''%'),
  ('direct publishing runs the structural validation', (select prosrc from pg_proc where oid = 'public.m2_guard_assessment_version()'::regprocedure) like '%not ready to publish%'),
  ('initial diagnostic lifecycle unchanged (draft -> in_review -> approved -> published)', (select prosrc from pg_proc where oid = 'public.m2_guard_assessment_version()'::regprocedure) like '%(''in_review'', ''approved''),%(''approved'', ''published'')%'),
  ('published content still cannot be edited', (select prosrc from pg_proc where oid = 'public.m2_guard_assessment_version()'::regprocedure) like '%Only draft content can be edited%'),
  ('assignments no longer need an educator endorsement', (select prosrc from pg_proc where oid = 'public.m2_guard_reassessment_assignment()'::regprocedure) not like '%educator_endorsed%'),
  ('assignments still need the reassessment switch', (select prosrc from pg_proc where oid = 'public.m2_guard_reassessment_assignment()'::regprocedure) like '%Reassessment is not enabled%'),
  ('assignments still need a published version of an active package', (select prosrc from pg_proc where oid = 'public.m2_guard_reassessment_assignment()'::regprocedure) like '%v.status <> ''published''%'),
  ('Teacher packages still only in that Teacher''s rooms', (select prosrc from pg_proc where oid = 'public.m2_guard_reassessment_assignment()'::regprocedure) like '%teacher_id is distinct from v.owner_id%'),
  ('School Admins assign school packages only', (select prosrc from pg_proc where oid = 'public.m2_guard_reassessment_assignment()'::regprocedure) like '%assigner.role = ''admin'' and v.scope = ''school''%'),
  ('results no longer need an educator endorsement', (select prosrc from pg_proc where oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::regprocedure) not like '%educator_endorsed%'),
  ('results still need the switches and a published version', (select prosrc from pg_proc where oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::regprocedure) like '%independent_learner_enabled%' and (select prosrc from pg_proc where oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::regprocedure) like '%v.status <> ''published''%'),
  ('approval evidence is still required for approved versions', exists (select 1 from pg_constraint where conname = 'm2_version_approval_evidence'
     and pg_get_constraintdef(oid) like '%status <> ''approved''::text%')),
  ('one published version per package (index kept)', to_regclass('public.m2_one_published_version_per_package') is not null),
  ('educator review history kept', to_regclass('public.m2_assessment_educator_reviews') is not null),
  ('result recording still SECURITY DEFINER, backend only', (select prosecdef and proacl::text like '%service_role=X/%' and proacl::text not like '%authenticated%'
     from pg_proc where oid = 'public.m2_record_reassessment_result(uuid,uuid,jsonb)'::regprocedure))
)
select case when ok then 'PASS' else 'FAIL' end as result, name from checks;
