begin read only;
-- READ ONLY. Run after manually applying the migration.
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
from pg_constraint where conname in ('m5_reading_source_check','m6_reading_source_check');
select indexname, indexdef from pg_indexes where schemaname = 'public'
and indexname in ('m5_material_history','m6_owner_oral_result_unique');
-- Backend-only privileges must be false. M3 authenticated answer SELECT must remain true;
-- actual student visibility is checked using RLS in m5_m6_answer_key_rls.sql.
select has_table_privilege('authenticated','public.oral_reading_attempts','INSERT') as learner_can_write_m5,
 has_table_privilege('authenticated','public.m6_comprehension_attempts','SELECT') as learner_can_read_keys,
 has_table_privilege('authenticated','public.m6_comprehension_responses','INSERT') as learner_can_write_answers,
 has_table_privilege('authenticated','public.comprehension_question_answers','SELECT') as authenticated_answer_table_select_grant,
 has_function_privilege('authenticated','public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)','EXECUTE') as learner_can_score;
-- Counts only: avoid printing students' transcripts or answer keys.
select count(*) as material_oral_attempts from public.oral_reading_attempts where material_id is not null;
select status, count(*) from public.m6_comprehension_attempts where material_id is not null group by status;
-- Compare M3 answer-key and M4 policy output with preflight: all must be unchanged.
select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
where schemaname = 'public' and tablename in
('rooms','enrollments','room_modules','uploaded_materials','reading_activity_assignments','comprehension_question_answers')
order by tablename, policyname;

-- Inspect definitions, not just names; run this inventory separately if a guard fails.
select c.oid::regclass as table_name, c.relrowsecurity, c.relforcerowsecurity,
  pg_get_userbyid(c.relowner) as owner
from pg_class c where c.oid in ('public.comprehension_question_answers'::regclass,
  'public.comprehension_questions'::regclass);
select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('anon','authenticated');
select p.oid::regprocedure as helper, pg_get_userbyid(p.proowner) as owner,
  p.prosecdef, p.provolatile, p.proconfig, pg_get_functiondef(p.oid) as definition
from pg_proc p where p.oid in ('public.m1_teacher_access_allowed()'::regprocedure,
  'public.m3_current_role()'::regprocedure, 'public.m3_owns_material(uuid)'::regprocedure);
-- Include PUBLIC/inherited grants, column grants, and RPC execute rights in review.
select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
where table_schema='public' and table_name in ('comprehension_question_answers',
  'oral_reading_attempts','m6_comprehension_attempts','m6_comprehension_responses')
order by table_name, column_name, grantee, privilege_type;

-- The identical migration guard checks policy expressions, implementations and
-- backend-only privileges. It changes only transaction-local search_path.
-- BEGIN SECURITY PREFLIGHT
-- Fail closed on unreviewed effective read policies or helper definitions.
-- authenticated SELECT is REQUIRED by M3; RLS, not that grant, separates app roles.
-- This guard reads catalogs only. It does not create/change policies or grants.
-- Canonical deparsing is intentional: even a safe but differently written live
-- definition needs review rather than guessing at its semantics.
set local search_path = pg_catalog;
do $security$
declare
  client_role text;
  answer_table oid := 'public.comprehension_question_answers'::regclass;
  authenticated_oid oid := 'authenticated'::regrole;
  p record;
  helper record;
  expected_read text := $policy$((public.m3_current_role() = 'admin'::text) OR ((public.m3_current_role() = 'teacher'::text) AND (EXISTS ( SELECT 1
   FROM public.comprehension_questions question
  WHERE ((question.id = comprehension_question_answers.question_id) AND question.generated_by_ai AND (question.material_id IS NOT NULL) AND public.m3_owns_material(question.material_id))))))$policy$;
  read_count integer := 0;
  approval_count integer := 0;
begin
  foreach client_role in array array['anon','authenticated'] loop
    if exists (select 1 from pg_roles where rolname = client_role and (rolsuper or rolbypassrls))
      or exists (select 1 from pg_class where oid in
        (answer_table, 'public.oral_reading_attempts'::regclass,
         'public.m6_comprehension_attempts'::regclass, 'public.m6_comprehension_responses'::regclass)
        and pg_has_role(client_role, relowner, 'MEMBER')) then
      raise exception 'Client role can bypass assessment RLS. Stop and review role ownership/membership.';
    end if;
    if has_table_privilege(client_role, 'public.oral_reading_attempts', 'INSERT,UPDATE,DELETE,TRUNCATE')
      or has_any_column_privilege(client_role, 'public.oral_reading_attempts', 'INSERT,UPDATE')
      or has_table_privilege(client_role, 'public.m6_comprehension_attempts', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_any_column_privilege(client_role, 'public.m6_comprehension_attempts', 'SELECT,INSERT,UPDATE')
      or has_table_privilege(client_role, 'public.m6_comprehension_responses', 'INSERT,UPDATE,DELETE,TRUNCATE')
      or has_any_column_privilege(client_role, 'public.m6_comprehension_responses', 'INSERT,UPDATE')
      or has_function_privilege(client_role, 'public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)', 'EXECUTE') then
      raise exception 'Secure M5/M6 backend-only scoring prerequisites are missing. Stop and review grants.';
    end if;
  end loop;

  if not (select relrowsecurity from pg_class where oid = answer_table)
    or not has_table_privilege('authenticated', answer_table, 'SELECT')
    or has_any_column_privilege('anon', answer_table, 'SELECT') then
    raise exception 'Expected answer-key RLS, M3 authenticated SELECT, and no anonymous SELECT. Stop; do not change grants to bypass this check.';
  end if;

  -- Inspect all SELECT/ALL policies applicable through authenticated, PUBLIC or
  -- inherited roles. Names are deliberately irrelevant. Extra permissive policies
  -- could leak keys; extra restrictive policies could break legitimate M3 reads.
  for p in select polpermissive, polcmd, polroles, pg_get_expr(polqual, polrelid) as expression,
      pg_get_expr(polwithcheck, polrelid) as check_expression
    from pg_policy where polrelid = answer_table and polcmd in ('r','*')
    and exists (select 1 from unnest(polroles) as r(role_oid)
      where case when role_oid = 0 then true else pg_has_role('authenticated', role_oid, 'MEMBER') end)
  loop
    if p.polroles <> array[authenticated_oid] then
      raise exception 'Unreviewed answer-key read policy role scope. Inspect preflight definitions.';
    end if;
    if p.polpermissive and p.polcmd = 'r' and p.expression = replace(expected_read, E'\r\n', E'\n') then
      read_count := read_count + 1;
    elsif not p.polpermissive and p.polcmd = '*'
      and p.expression = 'public.m1_teacher_access_allowed()'
      and p.check_expression = 'public.m1_teacher_access_allowed()' then
      approval_count := approval_count + 1;
    else
      raise exception 'Unreviewed answer-key SELECT/ALL policy expression. Inspect preflight definitions; do not weaken RLS.';
    end if;
  end loop;
  if read_count <> 1 or approval_count <> 1 then
    raise exception 'Expected one M3 scoped answer read and one restrictive M1 approval rule.';
  end if;

  -- Check the implementations, not merely the policy function names. Exact source
  -- comparison tolerates Windows line endings only. Changed bodies/configuration
  -- must be reviewed, even when they are potentially equivalent and safe.
  for helper in select * from (values
    ('public.m1_teacher_access_allowed()', $body$
  select not exists (select 1 from public.profiles where id = auth.uid()
    and role = 'teacher' and teacher_status is distinct from 'approved');
$body$, $body$
  select not exists (select 1 from public.profiles where id = auth.uid()
    and role = 'teacher' and teacher_status is distinct from 'approved');
$body$),
    ('public.m3_current_role()', $body$
  select role from public.profiles where id = auth.uid()
    and (role <> 'teacher' or teacher_status = 'approved');
$body$, $body$
  select profile.role
  from public.profiles as profile
  where profile.id = auth.uid()
  limit 1
$body$),
    ('public.m3_owns_material(uuid)', $body$
  select exists (
    select 1
    from public.uploaded_materials as material
    where material.id = target_material_id
      and material.uploaded_by = auth.uid()
  )
$body$, $body$
  select exists (
    select 1
    from public.uploaded_materials as material
    where material.id = target_material_id
      and material.uploaded_by = auth.uid()
  )
$body$)
  ) as approved(signature, source, alternate_source)
  loop
    select proc.*, lang.lanname into p from pg_proc proc join pg_language lang on lang.oid = proc.prolang
      where proc.oid = to_regprocedure(helper.signature);
    if not found then raise exception 'Missing security helper: %', helper.signature; end if;
    if p.lanname <> 'sql' or not p.prosecdef or p.provolatile <> 's'
      or p.proconfig is distinct from array['search_path=""']
      or pg_has_role('authenticated', p.proowner, 'MEMBER')
      or pg_has_role('anon', p.proowner, 'MEMBER')
      or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or (replace(p.prosrc, E'\r\n', E'\n') is distinct from replace(helper.source, E'\r\n', E'\n')
        and replace(p.prosrc, E'\r\n', E'\n') is distinct from replace(helper.alternate_source, E'\r\n', E'\n')) then
      raise exception 'Unreviewed security helper implementation/configuration: %. Compare pg_get_functiondef output; do not bypass this check.', helper.signature;
    end if;
  end loop;
end $security$;
-- END SECURITY PREFLIGHT

SELECT 'B24_SECURITY_GUARD_PASSED' AS verification;

rollback;
