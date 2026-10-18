-- REVIEW AND APPLY MANUALLY ONLY. Forward-only; no classroom records are changed.
-- Requires M5 base + selected passage security, and M6 schema + m6_apply_action.
-- Run tests/m5_m6_uploaded_reading_preflight.sql first.
begin;

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

alter table public.oral_reading_attempts
  alter column module_id drop not null,
  add column material_id uuid,
  add column activity_assignment_id uuid,
  add constraint m5_reading_source_check check (
    (module_id is not null and material_id is null and activity_assignment_id is null)
    or (module_id is null and material_id is not null and activity_assignment_id is not null
      and room_id is not null and passage_id is null and assignment_id is null)
  );

alter table public.m6_comprehension_attempts
  alter column module_id drop not null,
  alter column passage_id drop not null,
  add column material_id uuid,
  add column activity_assignment_id uuid,
  add column oral_reading_attempt_id uuid references public.oral_reading_attempts(id) on delete restrict,
  add constraint m6_reading_source_check check (
    (module_id is not null and passage_id is not null and material_id is null and activity_assignment_id is null)
    or (module_id is null and passage_id is null and material_id is not null
      and activity_assignment_id is not null and room_id is not null
      and assignment_id is null and oral_reading_attempt_id is not null)
  );

-- Source IDs are historical references, like existing room_id/assignment_id.
-- They intentionally do not add foreign keys to M4 tables or change deletion behavior.
comment on column public.oral_reading_attempts.activity_assignment_id is
  'Historical reading_activity_assignments ID; distinct from module assignment_id.';
comment on column public.m6_comprehension_attempts.activity_assignment_id is
  'Historical reading_activity_assignments ID; distinct from module assignment_id.';

create index m5_material_history on public.oral_reading_attempts
  (user_id, material_id, activity_assignment_id, completed_at desc) where material_id is not null;
create unique index m6_owner_oral_result_unique on public.m6_comprehension_attempts
  (user_id, oral_reading_attempt_id) where oral_reading_attempt_id is not null;

notify pgrst, 'reload schema';
commit;
