-- MANUAL, READ ONLY. No credentials, answer text or student answers are printed.
-- Run as the database administrator in SQL Editor, before and after the migration.
-- Requires EXISTING test personas: student, general_user, admin, approved owning
-- teacher, pending teacher, rejected teacher and teacher with NULL approval status.
-- Requires an existing AI-generated question/answer owned by the approved teacher.
-- Missing coverage raises an error; do not create/alter live records to make this pass.
-- Use a staging copy with approved fixtures if a persona is absent from production.
begin read only;
set local search_path = pg_catalog;
do $rls_test$
declare
  operator_role text := current_user;
  persona record;
  actor_id uuid;
  expected_ids uuid[];
  visible_ids uuid[];
  approval_allowed boolean;
  effective_app_role text;
begin
  if row_security_active('public.comprehension_question_answers'::regclass) then
    raise exception 'Run from a database administrator session to compute baseline visibility, not from a learner session.';
  end if;
  if not exists (select 1 from public.comprehension_question_answers) then
    raise exception 'Answer table is empty: a zero-row learner check would be inconclusive.';
  end if;
  for persona in select * from (values
    ('student','student',null::text), ('independent learner','general_user',null),
    ('approved owning teacher','teacher','approved'), ('pending teacher','teacher','pending'),
    ('rejected teacher','teacher','rejected'), ('teacher without approval','teacher',null),
    ('admin','admin',null)
  ) as cases(label, app_role, approval_status)
  loop
    actor_id := null;
    select p.id into actor_id from public.profiles p
    where p.role = persona.app_role
      and (persona.app_role <> 'teacher' or p.teacher_status is not distinct from persona.approval_status)
      and (persona.label <> 'approved owning teacher' or exists (
        select 1 from public.comprehension_question_answers a
        join public.comprehension_questions q on q.id = a.question_id
        join public.uploaded_materials m on m.id = q.material_id
        where q.generated_by_ai and m.uploaded_by = p.id))
    order by p.id limit 1;
    if actor_id is null then
      raise exception 'Missing existing fixture for %. Use staging; this check is not a pass.', persona.label;
    end if;
    if persona.app_role = 'admin' then
      select coalesce(array_agg(question_id order by question_id), '{}'::uuid[])
        into expected_ids from public.comprehension_question_answers;
    elsif persona.approval_status = 'approved' then
      select coalesce(array_agg(a.question_id order by a.question_id), '{}'::uuid[])
        into expected_ids from public.comprehension_question_answers a
        join public.comprehension_questions q on q.id = a.question_id
        join public.uploaded_materials m on m.id = q.material_id
        where q.generated_by_ai and m.uploaded_by = actor_id;
    else
      expected_ids := '{}'::uuid[];
    end if;

    -- Cover both Supabase auth.uid() claim formats. Deliberately forge app metadata:
    -- the profile-based policies must ignore it for application-role authorization.
    perform set_config('request.jwt.claim.sub', actor_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', actor_id,
      'role','authenticated','app_metadata',jsonb_build_object('role','admin'))::text, true);
    execute 'set local role authenticated';
    if not row_security_active('public.comprehension_question_answers'::regclass) then
      raise exception 'RLS was bypassed during authenticated persona test.';
    end if;
    select public.m1_teacher_access_allowed(), public.m3_current_role()
      into approval_allowed, effective_app_role;
    if approval_allowed is distinct from
      (persona.app_role <> 'teacher' or coalesce(persona.approval_status = 'approved', false)) then
      raise exception 'M1 approval behavior differs for %.', persona.label;
    end if;
    if (persona.app_role <> 'teacher' or persona.approval_status = 'approved')
      and effective_app_role is distinct from persona.app_role then
      raise exception 'M3 application role differs for %.', persona.label;
    end if;
    select coalesce(array_agg(question_id order by question_id), '{}'::uuid[])
      into visible_ids from public.comprehension_question_answers;
    if visible_ids is distinct from expected_ids then
      raise exception 'Answer-key visibility differs for %: expected % rows, observed % (IDs also compared).',
        persona.label, cardinality(expected_ids), cardinality(visible_ids);
    end if;
    execute format('set local role %I', operator_role);
    raise notice 'PASS: %; expected answer-key scope verified (% rows).', persona.label, cardinality(visible_ids);
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  begin
    perform count(*) from public.comprehension_question_answers;
    raise exception 'Anonymous answer-key SELECT unexpectedly succeeded.';
  exception when insufficient_privilege then
    raise notice 'PASS: anonymous answer-key SELECT denied.';
  end;
  execute format('set local role %I', operator_role);
end $rls_test$;
rollback;
