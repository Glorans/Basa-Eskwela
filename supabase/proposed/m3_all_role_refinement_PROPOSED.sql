-- M3 all-role refinement (2026-11-23). PROPOSED, NOT APPLIED to Staging. Additive; no data is deleted or rewritten.
-- 1. uploaded_materials.trashed_at / trashed_by: non-destructive Trash for Teacher, School Admin and System Admin uploads
--    (replaces the delete that removed the storage file before the database rows and could leave a broken record).
-- 2. m3_write_material_question_set: "Save Reviewed Questions" may choose another correct option (0-3); otherwise the
--    saved option is kept exactly as before. School Admins may create / regenerate / delete sets on their OWN uploads
--    (owner-only, as for Teachers; System Admins already counted as Teachers).
-- 3. personal_material_question_sets: 6, 9 or 12 questions; new state 'learner_edited_private' for a learner's own edits.
-- 4. personal_material_generation: private banks of 6, 9 or 12 questions split equally (was exactly 9).
-- 5. personal_material_save_bank: the Independent Learner saves edits to their current private set (before any assessment).
-- Source bodies: live functions md5-pinned below. Rollback: m3_all_role_refinement_ROLLBACK_PROPOSED.sql.
begin;
do $$
begin
  if (select md5(prosrc) from pg_proc where proname = 'm3_write_material_question_set' and pronamespace = 'public'::regnamespace) is distinct from '49cb55f4b09b465efca2ec438c572d31' then
    raise exception 'STOP: m3_write_material_question_set differs from the reviewed version';
  end if;
  if (select md5(prosrc) from pg_proc where proname = 'personal_material_generation' and pronamespace = 'public'::regnamespace) is distinct from 'e9b569cfe2fb4cbf4064d1d56080d3a0' then
    raise exception 'STOP: personal_material_generation differs from the reviewed version';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'uploaded_materials' and column_name = 'trashed_at') then
    raise exception 'STOP: m3_all_role_refinement is already (partly) installed';
  end if;
end $$;

-- 1)
alter table public.uploaded_materials add column trashed_at timestamptz;
alter table public.uploaded_materials add column trashed_by uuid references public.profiles(id) on delete set null;
alter table public.uploaded_materials add constraint uploaded_materials_trash_evidence check (trashed_by is null or trashed_at is not null);
create index uploaded_materials_trashed on public.uploaded_materials (trashed_at) where trashed_at is not null;

-- 2)
CREATE OR REPLACE FUNCTION public.m3_write_material_question_set(actor_id uuid, target_material uuid, target_set uuid, operation text, expected_revision integer, bank jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  actor_role text;
  owner_id uuid;
  next_number integer;
  saved_set public.material_question_sets%rowtype;
  item jsonb;
  old_question public.comprehension_questions%rowtype;
  answer_text text;
  answer_index integer;
  explanation_text text;
  evidence_text text;
  inserted_question_id uuid;
  position integer := 0;
BEGIN
  SELECT role
  INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;
  IF actor_role = 'system_admin' THEN actor_role := 'teacher'; END IF;

  IF actor_role IS NULL
    OR actor_role NOT IN ('teacher', 'admin') THEN
    RAISE EXCEPTION
      'Question management requires a Teacher or Admin'
      USING ERRCODE = '42501';
  END IF;

  SELECT uploaded_by, next_question_set_number
  INTO owner_id, next_number
  FROM public.uploaded_materials
  WHERE id = target_material
  FOR UPDATE;

  IF NOT FOUND
    OR (actor_role <> 'admin' AND owner_id <> actor_id) THEN
    RAISE EXCEPTION
      'Material unavailable to this account'
      USING ERRCODE = '42501';
  END IF;

  IF operation IS NULL
    OR operation NOT IN ('create', 'regenerate', 'review', 'delete') THEN
    RAISE EXCEPTION
      'Invalid question set operation'
      USING ERRCODE = '22023';
  END IF;

  IF operation <> 'review'
    AND owner_id <> actor_id THEN
    RAISE EXCEPTION
      'Only the owning Teacher may generate or delete sets'
      USING ERRCODE = '42501';
  END IF;

  IF operation <> 'delete' THEN
    IF jsonb_typeof(bank) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION
        'A question bank is required'
        USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(bank) NOT IN (3, 6, 9, 12)
      OR EXISTS (
        SELECT 1
        FROM unnest(
          ARRAY['literal', 'inferential', 'critical']
        ) AS category
        WHERE (
          SELECT count(*)
          FROM jsonb_array_elements(bank) AS q
          WHERE q->>'type' = category
        ) <> jsonb_array_length(bank) / 3
      ) THEN
      RAISE EXCEPTION
        'Choose 3, 6, 9 or 12 questions, evenly divided across the three categories'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF operation = 'create' THEN
    IF target_set IS NOT NULL THEN
      RAISE EXCEPTION
        'New sets must not target an existing set'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.material_question_sets (
      material_id,
      created_by,
      name,
      sequence_number
    )
    VALUES (
      target_material,
      actor_id,
      'Question Set ' || next_number,
      next_number
    )
    RETURNING * INTO saved_set;

    UPDATE public.uploaded_materials
    SET next_question_set_number = next_number + 1
    WHERE id = target_material;
  ELSE
    SELECT *
    INTO saved_set
    FROM public.material_question_sets
    WHERE id = target_set
      AND material_id = target_material
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Question set not found'
        USING ERRCODE = 'P0002';
    END IF;

    IF expected_revision IS DISTINCT FROM saved_set.revision THEN
      RAISE EXCEPTION
        'This question set changed. Reload it before saving or regenerating.'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  IF operation = 'delete' THEN
    DELETE FROM public.comprehension_question_answers
    WHERE question_id IN (
      SELECT id
      FROM public.comprehension_questions
      WHERE question_set_id = saved_set.id
        AND material_id = target_material
    );

    DELETE FROM public.comprehension_questions
    WHERE question_set_id = saved_set.id
      AND material_id = target_material;

    DELETE FROM public.material_question_sets
    WHERE id = saved_set.id
      AND material_id = target_material;

    RETURN saved_set.id;
  END IF;

  IF operation = 'regenerate'
    AND (
      SELECT count(*)
      FROM public.comprehension_questions
      WHERE question_set_id = saved_set.id
    ) <> jsonb_array_length(bank) THEN
    RAISE EXCEPTION
      'Regeneration must preserve the saved question count'
      USING ERRCODE = '22023';
  END IF;

  IF operation = 'review' THEN
    IF (
      SELECT count(*)
      FROM public.comprehension_questions
      WHERE question_set_id = saved_set.id
    ) <> jsonb_array_length(bank)
    OR (
      SELECT count(DISTINCT q->>'id')
      FROM jsonb_array_elements(bank) AS q
    ) <> jsonb_array_length(bank)
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(bank) AS submitted
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.comprehension_questions AS q
        WHERE q.id = (submitted->>'id')::uuid
          AND q.material_id = target_material
          AND q.question_set_id = saved_set.id
      )
    ) THEN
      RAISE EXCEPTION
        'Every edited question must belong to the selected set'
        USING ERRCODE = '42501';
    END IF;
  ELSIF operation = 'regenerate' THEN
    DELETE FROM public.comprehension_question_answers
    WHERE question_id IN (
      SELECT id
      FROM public.comprehension_questions
      WHERE question_set_id = saved_set.id
        AND material_id = target_material
    );

    DELETE FROM public.comprehension_questions
    WHERE question_set_id = saved_set.id
      AND material_id = target_material;
  END IF;

  FOR item IN
    SELECT value
    FROM jsonb_array_elements(bank)
  LOOP
    position := position + 1;

    explanation_text := NULL;
    evidence_text := NULL;

    IF item ? 'answerExplanation' THEN
      IF jsonb_typeof(item->'answerExplanation')
        IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION
          'Answer explanation must be text'
          USING ERRCODE = '22023';
      END IF;

      explanation_text :=
        nullif(btrim(item->>'answerExplanation'), '');

      IF explanation_text IS NULL
        OR length(explanation_text) > 1500 THEN
        RAISE EXCEPTION
          'Answer explanation must contain 1 to 1500 characters'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF item ? 'supportingEvidence' THEN
      IF jsonb_typeof(item->'supportingEvidence')
        IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION
          'Supporting evidence must be text'
          USING ERRCODE = '22023';
      END IF;

      evidence_text :=
        nullif(btrim(item->>'supportingEvidence'), '');

      IF evidence_text IS NULL
        OR length(evidence_text) > 1000 THEN
        RAISE EXCEPTION
          'Supporting evidence must contain 1 to 1000 characters'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF operation = 'review' THEN
      SELECT *
      INTO STRICT old_question
      FROM public.comprehension_questions
      WHERE id = (item->>'id')::uuid
        AND question_set_id = saved_set.id;

      SELECT correct_answer
      INTO answer_text
      FROM public.comprehension_question_answers
      WHERE question_id = old_question.id;

      answer_index := NULL;

      SELECT ordinality::integer - 1
      INTO answer_index
      FROM jsonb_array_elements_text(
        old_question.options
      ) WITH ORDINALITY
      WHERE value = answer_text;

      -- M3 all-role refinement: the reviewer may choose another correct option (0-3). Without it, keep the saved one.
      IF item ? 'correctOptionIndex' AND answer_index IS NOT NULL THEN
        IF (item->>'correctOptionIndex') !~ '^[0-3]$' THEN
          RAISE EXCEPTION 'Invalid correct answer choice' USING ERRCODE = '22023';
        END IF;
        answer_index := (item->>'correctOptionIndex')::integer;
      END IF;

      IF answer_index IS NULL THEN
        RAISE EXCEPTION
          'Invalid saved answer key'
          USING ERRCODE = '22023';
      END IF;

      UPDATE public.comprehension_questions
      SET
        question_type = item->>'type',
        question_text = btrim(item->>'questionText'),
        options = item->'options',
        scaffolding_hint = btrim(item->>'scaffoldingHint'),
        review_status = 'reviewed',
        reviewed_by = actor_id,
        reviewed_at = now()
      WHERE id = old_question.id;

      -- Preserve the system-selected correct option.
      -- Preserve feedback when the review request omits it.
      UPDATE public.comprehension_question_answers
      SET
        correct_answer = item->'options'->>answer_index,
        answer_explanation = CASE
          WHEN item ? 'answerExplanation'
            THEN explanation_text
          ELSE answer_explanation
        END,
        supporting_evidence = CASE
          WHEN item ? 'supportingEvidence'
            THEN evidence_text
          ELSE supporting_evidence
        END
      WHERE question_id = old_question.id;
    ELSE
      INSERT INTO public.comprehension_questions (
        material_id,
        question_set_id,
        question_type,
        question_text,
        options,
        scaffolding_hint,
        display_order,
        generated_by_ai,
        review_status
      )
      VALUES (
        target_material,
        saved_set.id,
        item->>'type',
        btrim(item->>'questionText'),
        item->'options',
        btrim(item->>'scaffoldingHint'),
        position,
        true,
        'generated'
      )
      RETURNING id INTO inserted_question_id;

      INSERT INTO public.comprehension_question_answers (
        question_id,
        correct_answer,
        answer_explanation,
        supporting_evidence
      )
      VALUES (
        inserted_question_id,
        item->>'correctAnswer',
        explanation_text,
        evidence_text
      );
    END IF;
  END LOOP;

  UPDATE public.material_question_sets
  SET
    revision = revision + 1,
    updated_at = now()
  WHERE id = saved_set.id;

  RETURN saved_set.id;
END;
$function$;

-- 3)
alter table public.personal_material_question_sets drop constraint personal_material_question_sets_questions_check;
alter table public.personal_material_question_sets add constraint personal_material_question_sets_questions_check
  check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) in (6, 9, 12));
alter table public.personal_material_question_sets drop constraint personal_material_question_sets_validation_state_check;
alter table public.personal_material_question_sets add constraint personal_material_question_sets_validation_state_check
  check (validation_state in ('ai_validated_private', 'learner_edited_private'));

-- 4)
CREATE OR REPLACE FUNCTION public.personal_material_generation(actor uuid, material uuid, operation text, token uuid DEFAULT NULL::uuid, bank jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.uploaded_materials; q public.personal_material_question_sets; l public.personal_material_generation_leases;
 rev text; next_token uuid; item jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('personal-generation|' || actor::text,0));
 perform 1 from public.uploaded_materials where id=material for update;
 if operation='fail' then
  delete from public.personal_material_generation_leases where user_id=actor and material_id=material and personal_material_generation_leases.token=personal_material_generation.token;
  return '{}'::jsonb;
 end if;
 m := public.personal_material_source(actor,material);
 rev := public.personal_material_revision(m);
 if length(m.content_text)>30000 then raise exception 'Question generation is limited to 30,000 characters'; end if;
 select * into q from public.personal_material_question_sets where material_id=material and revision=rev and user_id=actor and replaced_at is null;
 -- New questions for the same text replace the current set (kept, marked replaced); everything else reuses it.
 if operation in ('begin_replace','finish_replace') then
  if q.id is null then raise exception 'There are no questions to replace yet'; end if;
 elsif q.id is not null then return jsonb_build_object('id',q.id,'reused',true); end if;
 if exists(select 1 from public.m6_comprehension_attempts where user_id=actor and material_id=material and activity_assignment_id is null) then
  raise exception 'This material already has an assessment. Use its saved questions and result';
 end if;
 select * into l from public.personal_material_generation_leases where user_id=actor;
 if operation in ('begin','begin_replace') then
  if l.expires_at>clock_timestamp() then raise exception 'A generation is already running. Please wait'; end if;
  if (select count(*) from public.personal_material_question_sets where user_id=actor and created_at>clock_timestamp()-interval '24 hours')>=5 then
   raise exception 'Five new question sets are allowed per rolling 24 hours. Reuse a saved set or try later';
  end if;
  next_token:=gen_random_uuid();
  insert into public.personal_material_generation_leases values(actor,material,rev,next_token,clock_timestamp()+interval '5 minutes')
   on conflict(user_id) do update set material_id=excluded.material_id,revision=excluded.revision,token=excluded.token,expires_at=excluded.expires_at;
  return jsonb_build_object('token',next_token,'reused',false);
 elsif operation in ('finish','finish_replace') then
  if l.token is distinct from token or l.material_id is distinct from material or l.revision is distinct from rev or l.expires_at<=clock_timestamp() or l.token is null then
   raise exception 'Generation expired or the material changed. Please retry';
  end if;
  if jsonb_typeof(bank) is distinct from 'array' or jsonb_array_length(bank) not in (6,9,12) then raise exception 'Invalid private question bank'; end if;
  foreach rev in array array['literal','inferential','critical'] loop
   if (select count(*) from jsonb_array_elements(bank) v where v->>'type'=rev)<>jsonb_array_length(bank)/3 then raise exception 'Invalid question classifications'; end if;
  end loop;
  for item in select value from jsonb_array_elements(bank) loop
   if nullif(btrim(item->>'questionText'),'') is null or nullif(btrim(item->>'answerExplanation'),'') is null
    or nullif(btrim(item->>'scaffoldingHint'),'') is null or nullif(btrim(item->>'supportingEvidence'),'') is null
    or jsonb_typeof(item->'options') is distinct from 'array' or jsonb_array_length(item->'options')<>4
    or item->>'correctOptionIndex' is null or (item->>'correctOptionIndex')::integer not between 0 and 3
    or nullif(item->>'id','') is null
    or (select count(distinct lower(btrim(v))) from jsonb_array_elements_text(item->'options') v where nullif(btrim(v),'') is not null)<>4
    or strpos(regexp_replace(m.content_text,'\s+',' ','g'),regexp_replace(item->>'supportingEvidence','\s+',' ','g'))=0
    then raise exception 'Invalid private question or evidence'; end if;
   perform (item->>'id')::uuid;
  end loop;
  if operation='finish_replace' then
   update public.personal_material_question_sets set replaced_at=clock_timestamp() where id=q.id;
  end if;
  insert into public.personal_material_question_sets(material_id,user_id,revision,validation_state,questions)
   values(material,actor,public.personal_material_revision(m),'ai_validated_private',bank) returning * into q;
  delete from public.personal_material_generation_leases where user_id=actor;
  return jsonb_build_object('id',q.id,'reused',false);
 else raise exception 'Invalid generation operation'; end if;
end $function$;
-- Grants restated as on Staging (postgres + service_role only); CREATE OR REPLACE keeps them, this only enforces them.
revoke all on function public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb) to service_role;
revoke all on function public.personal_material_generation(uuid,uuid,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.personal_material_generation(uuid,uuid,text,uuid,jsonb) to service_role;

-- 5) The learner's own edits to their current private set (same validation as generation; before any assessment only).
create or replace function public.personal_material_save_bank(actor uuid, material uuid, target_set uuid, bank jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.uploaded_materials; q public.personal_material_question_sets; rev text; item jsonb; kind text; n integer;
begin
 perform 1 from public.uploaded_materials where id=material for update;
 select * into m from public.uploaded_materials where id=material;
 if not found or m.uploaded_by is distinct from actor or not exists(select 1 from public.profiles where id=actor and role='general_user') then
  raise exception 'Personal material access denied' using errcode='42501';
 end if;
 m := public.personal_material_source(actor,material);
 rev := public.personal_material_revision(m);
 select * into q from public.personal_material_question_sets where id=target_set and material_id=material and user_id=actor
  and revision=rev and replaced_at is null for update;
 if q.id is null then raise exception 'These questions changed. Reload them before saving' using errcode='40001'; end if;
 if exists(select 1 from public.m6_comprehension_attempts where user_id=actor and material_id=material and activity_assignment_id is null) then
  raise exception 'This material already has an assessment. Its questions can no longer be changed' using errcode='55000';
 end if;
 n := jsonb_array_length(q.questions);
 if jsonb_typeof(bank) is distinct from 'array' or jsonb_array_length(bank)<>n then raise exception 'Keep the same number of questions' using errcode='22023'; end if;
 if (select count(*) from jsonb_array_elements(bank) v where (v->>'id') in (select x->>'id' from jsonb_array_elements(q.questions) x))<>n
  or (select count(distinct v->>'id') from jsonb_array_elements(bank) v)<>n then
  raise exception 'Questions cannot be added or removed while editing' using errcode='22023';
 end if;
 foreach kind in array array['literal','inferential','critical'] loop
  if (select count(*) from jsonb_array_elements(bank) v where v->>'type'=kind)<>n/3 then raise exception 'Keep the categories equal' using errcode='22023'; end if;
 end loop;
 for item in select value from jsonb_array_elements(bank) loop
  if nullif(btrim(item->>'questionText'),'') is null or nullif(btrim(item->>'answerExplanation'),'') is null
   or nullif(btrim(item->>'scaffoldingHint'),'') is null or nullif(btrim(item->>'supportingEvidence'),'') is null
   or jsonb_typeof(item->'options') is distinct from 'array' or jsonb_array_length(item->'options')<>4
   or (item->>'correctOptionIndex') is null or (item->>'correctOptionIndex') !~ '^[0-3]$'
   or (select count(distinct lower(btrim(v))) from jsonb_array_elements_text(item->'options') v where nullif(btrim(v),'') is not null)<>4
   or strpos(regexp_replace(m.content_text,'\s+',' ','g'),regexp_replace(btrim(item->>'supportingEvidence'),'\s+',' ','g'))=0
  then raise exception 'Invalid private question or evidence' using errcode='22023'; end if;
 end loop;
 update public.personal_material_question_sets set questions=bank, validation_state='learner_edited_private' where id=q.id;
 return jsonb_build_object('id',q.id,'validationState','learner_edited_private');
end $$;
revoke all on function public.personal_material_save_bank(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.personal_material_save_bank(uuid,uuid,uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
