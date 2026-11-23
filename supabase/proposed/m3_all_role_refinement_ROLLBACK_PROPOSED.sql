-- ROLLBACK for m3_all_role_refinement_PROPOSED.sql. Restores both function bodies byte-for-byte and the original
-- constraints. Refuses if any learner-edited or non-9 private set, or any trashed upload, exists (restore those first).
begin;
do $$
begin
  if exists (select 1 from public.personal_material_question_sets where validation_state <> 'ai_validated_private' or jsonb_array_length(questions) <> 9) then
    raise exception 'STOP: learner-edited or non-9 private sets exist; the original constraints would reject them';
  end if;
  if exists (select 1 from public.uploaded_materials where trashed_at is not null) then
    raise exception 'STOP: trashed uploads exist; restore them before removing the Trash columns';
  end if;
end $$;
drop function if exists public.personal_material_save_bank(uuid,uuid,uuid,jsonb);
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
  if jsonb_typeof(bank) is distinct from 'array' or jsonb_array_length(bank)<>9 then raise exception 'Invalid private question bank'; end if;
  foreach rev in array array['literal','inferential','critical'] loop
   if (select count(*) from jsonb_array_elements(bank) v where v->>'type'=rev)<>3 then raise exception 'Invalid question classifications'; end if;
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
    AND (actor_role <> 'teacher' OR owner_id <> actor_id) THEN
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
alter table public.personal_material_question_sets drop constraint personal_material_question_sets_validation_state_check;
alter table public.personal_material_question_sets add constraint personal_material_question_sets_validation_state_check
  check (validation_state = 'ai_validated_private');
alter table public.personal_material_question_sets drop constraint personal_material_question_sets_questions_check;
alter table public.personal_material_question_sets add constraint personal_material_question_sets_questions_check
  check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) = 9);
drop index if exists public.uploaded_materials_trashed;
alter table public.uploaded_materials drop constraint if exists uploaded_materials_trash_evidence;
alter table public.uploaded_materials drop column if exists trashed_by;
alter table public.uploaded_materials drop column if exists trashed_at;
do $$
begin
  if (select md5(prosrc) from pg_proc where proname = 'm3_write_material_question_set' and pronamespace = 'public'::regnamespace) <> '49cb55f4b09b465efca2ec438c572d31' then raise exception 'STOP: m3_write_material_question_set not restored exactly'; end if;
  if (select md5(prosrc) from pg_proc where proname = 'personal_material_generation' and pronamespace = 'public'::regnamespace) <> 'e9b569cfe2fb4cbf4064d1d56080d3a0' then raise exception 'STOP: personal_material_generation not restored exactly'; end if;
end $$;
notify pgrst, 'reload schema';
commit;
