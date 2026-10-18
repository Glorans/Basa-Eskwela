-- Apply after m6_comprehension_schema.sql.
-- Function definitions exported from the working database.
BEGIN;

CREATE OR REPLACE FUNCTION public.m3_admin_collection(target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF public.m3_current_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT jsonb_build_object(
    'id', m.id,
    'title', m.title,
    'learningPathId', m.path_id,
    'difficulty', m.difficulty,
    'status', m.status,
    'publishedAt', m.published_at,
    'revision', m.collection_revision,
    'language', (
      SELECT language
      FROM public.learning_paths
      WHERE id = m.path_id
    ),
    'passages', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'title', p.title,
            'passageText', p.passage_text,
            'sourceMaterialId', p.source_material_id,
            'displayOrder', p.display_order,
            'questions', coalesce(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', q.id,
                    'type', q.question_type,
                    'questionText', q.question_text,
                    'options', q.options,
                    'scaffoldingHint', q.scaffolding_hint,
                    'correctAnswer', a.correct_answer,
                    'reviewStatus', q.review_status
                  )
                  || CASE
                    WHEN a.answer_explanation IS NOT NULL THEN
                      jsonb_build_object(
                        'answerExplanation',
                        a.answer_explanation
                      )
                    ELSE '{}'::jsonb
                  END
                  || CASE
                    WHEN a.supporting_evidence IS NOT NULL THEN
                      jsonb_build_object(
                        'supportingEvidence',
                        a.supporting_evidence
                      )
                    ELSE '{}'::jsonb
                  END
                  ORDER BY q.display_order
                )
                FROM public.comprehension_questions AS q
                LEFT JOIN public.comprehension_question_answers AS a
                  ON a.question_id = q.id
                WHERE q.passage_id = p.id
                  AND q.module_id = m.id
                  AND q.material_id IS NULL
              ),
              '[]'::jsonb
            )
          )
          ORDER BY p.display_order
        )
        FROM public.module_passages AS p
        WHERE p.module_id = m.id
      ),
      '[]'::jsonb
    )
  )
  INTO result
  FROM public.modules AS m
  WHERE m.id = target_id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Module not found';
  END IF;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.m3_save_passage_bank(target_id uuid, target_passage uuid, expected_revision bigint, bank jsonb, bank_action text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  item jsonb;
  position integer := 0;
  question_id uuid;
  revision bigint;
  category text;
  explanation_text text;
  evidence_text text;
BEGIN
  -- Preserve the existing authorization and revision checks.
  PERFORM public.m3_lock_collection(
    target_id,
    expected_revision
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.module_passages
    WHERE id = target_passage
      AND module_id = target_id
  ) THEN
    RAISE EXCEPTION 'Passage belongs to another module';
  END IF;

  IF bank_action IS NULL
    OR bank_action NOT IN ('generate', 'review', 'delete')
    OR jsonb_typeof(bank) IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Invalid bank action';
  END IF;

  IF bank_action = 'delete' THEN
    IF jsonb_array_length(bank) <> 0 THEN
      RAISE EXCEPTION 'Delete requires an empty bank';
    END IF;

    DELETE FROM public.comprehension_question_answers
    WHERE question_id IN (
      SELECT id
      FROM public.comprehension_questions
      WHERE passage_id = target_passage
        AND module_id = target_id
    );

    DELETE FROM public.comprehension_questions
    WHERE passage_id = target_passage
      AND module_id = target_id;
  ELSE
    IF jsonb_array_length(bank) <> 6 THEN
      RAISE EXCEPTION 'Exactly six questions are required';
    END IF;

    FOREACH category IN ARRAY
      ARRAY['literal', 'inferential', 'critical']
    LOOP
      IF (
        SELECT count(*)
        FROM jsonb_array_elements(bank) AS j
        WHERE j->>'type' = category
      ) <> 2 THEN
        RAISE EXCEPTION
          'Exactly two % questions are required',
          category;
      END IF;
    END LOOP;

    IF bank_action = 'generate' THEN
      DELETE FROM public.comprehension_question_answers
      WHERE question_id IN (
        SELECT id
        FROM public.comprehension_questions
        WHERE passage_id = target_passage
          AND module_id = target_id
      );

      DELETE FROM public.comprehension_questions
      WHERE passage_id = target_passage
        AND module_id = target_id;
    ELSE
      IF (
        SELECT count(*)
        FROM public.comprehension_questions
        WHERE passage_id = target_passage
          AND module_id = target_id
      ) <> 6
      OR (
        SELECT count(DISTINCT j->>'id')
        FROM jsonb_array_elements(bank) AS j
      ) <> 6 THEN
        RAISE EXCEPTION
          'Review must preserve all six question IDs';
      END IF;
    END IF;

    FOR item IN
      SELECT value
      FROM jsonb_array_elements(bank)
    LOOP
      position := position + 1;
      explanation_text := NULL;
      evidence_text := NULL;

      IF jsonb_typeof(item->'options')
        IS DISTINCT FROM 'array'
      THEN
        RAISE EXCEPTION 'Invalid question options';
      END IF;

      IF jsonb_array_length(item->'options') <> 4
        OR (
          SELECT count(DISTINCT lower(btrim(v)))
          FROM jsonb_array_elements_text(
            item->'options'
          ) AS v
        ) <> 4
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(item->'options') AS v
          WHERE jsonb_typeof(v) <> 'string'
            OR nullif(btrim(v#>>'{}'), '') IS NULL
        )
        OR jsonb_typeof(item->'questionText')
          IS DISTINCT FROM 'string'
        OR nullif(btrim(item->>'questionText'), '') IS NULL
        OR jsonb_typeof(item->'scaffoldingHint')
          IS DISTINCT FROM 'string'
        OR nullif(btrim(item->>'scaffoldingHint'), '') IS NULL
        OR jsonb_typeof(item->'correctAnswer')
          IS DISTINCT FROM 'string'
        OR NOT coalesce(
          (item->'options') ? (item->>'correctAnswer'),
          false
        )
      THEN
        RAISE EXCEPTION 'Invalid question or answer key';
      END IF;

      -- Missing feedback remains compatible with older banks.
      -- Supplied feedback must contain valid text.
      IF item ? 'answerExplanation' THEN
        IF jsonb_typeof(item->'answerExplanation')
          IS DISTINCT FROM 'string'
        THEN
          RAISE EXCEPTION
            'Answer explanation must be text';
        END IF;

        explanation_text :=
          btrim(item->>'answerExplanation');

        IF explanation_text = ''
          OR char_length(explanation_text) > 1500
        THEN
          RAISE EXCEPTION
            'Answer explanation must contain 1 to 1500 characters';
        END IF;
      END IF;

      IF item ? 'supportingEvidence' THEN
        IF jsonb_typeof(item->'supportingEvidence')
          IS DISTINCT FROM 'string'
        THEN
          RAISE EXCEPTION
            'Supporting evidence must be text';
        END IF;

        evidence_text := btrim(item->>'supportingEvidence');

        IF evidence_text = ''
          OR char_length(evidence_text) > 1000
        THEN
          RAISE EXCEPTION
            'Supporting evidence must contain 1 to 1000 characters';
        END IF;
      END IF;

      IF bank_action = 'generate' THEN
        question_id := gen_random_uuid();

        INSERT INTO public.comprehension_questions (
          id,
          module_id,
          passage_id,
          question_type,
          question_text,
          options,
          scaffolding_hint,
          display_order,
          generated_by_ai,
          review_status
        )
        VALUES (
          question_id,
          target_id,
          target_passage,
          item->>'type',
          btrim(item->>'questionText'),
          item->'options',
          btrim(item->>'scaffoldingHint'),
          position,
          true,
          'generated'
        );

        INSERT INTO public.comprehension_question_answers (
          question_id,
          correct_answer,
          answer_explanation,
          supporting_evidence
        )
        VALUES (
          question_id,
          item->>'correctAnswer',
          explanation_text,
          evidence_text
        );
      ELSE
        question_id := (item->>'id')::uuid;

        IF NOT EXISTS (
          SELECT 1
          FROM public.comprehension_questions
          WHERE id = question_id
            AND passage_id = target_passage
            AND module_id = target_id
        ) THEN
          RAISE EXCEPTION
            'Question belongs to another passage';
        END IF;

        UPDATE public.comprehension_questions
        SET
          question_type = item->>'type',
          question_text = btrim(item->>'questionText'),
          options = item->'options',
          scaffolding_hint = btrim(item->>'scaffoldingHint'),
          review_status = 'reviewed'
        WHERE id = question_id;

        INSERT INTO public.comprehension_question_answers (
          question_id,
          correct_answer,
          answer_explanation,
          supporting_evidence
        )
        VALUES (
          question_id,
          item->>'correctAnswer',
          explanation_text,
          evidence_text
        )
        ON CONFLICT ON CONSTRAINT
          comprehension_question_answers_pkey
        DO UPDATE SET
          correct_answer = EXCLUDED.correct_answer,
          answer_explanation = CASE
            WHEN item ? 'answerExplanation'
              THEN EXCLUDED.answer_explanation
            ELSE comprehension_question_answers.answer_explanation
          END,
          supporting_evidence = CASE
            WHEN item ? 'supportingEvidence'
              THEN EXCLUDED.supporting_evidence
            ELSE comprehension_question_answers.supporting_evidence
          END;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.modules
  SET title = title
  WHERE id = target_id
  RETURNING collection_revision INTO revision;

  RETURN revision;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.m6_apply_action(target_attempt uuid, target_user uuid, target_question uuid, action_name text, selected_option integer, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  activity public.m6_comprehension_attempts%rowtype;
  response public.m6_comprehension_responses%rowtype;
  question jsonb;
  correct_index integer;
  answer_correct boolean;
  history jsonb;
  previous_action jsonb;
begin
  -- Lock the activity so answer/hint/completion requests run in order.
  select *
  into activity
  from public.m6_comprehension_attempts
  where id = target_attempt
    and user_id = target_user
  for update;

  if not found then
    raise exception 'Activity not found'
      using errcode = 'P0002';
  end if;

  if action_name is null
     or action_name not in ('answer', 'hint', 'complete') then
    raise exception 'Invalid activity action'
      using errcode = '22023';
  end if;

  if action_name = 'complete' then
    if activity.status = 'completed' then
      return jsonb_build_object('completed', true);
    end if;

    if exists (
      select 1
      from jsonb_array_elements(activity.question_snapshot) as q(value)
      where not exists (
        select 1
        from public.m6_comprehension_responses r
        where r.attempt_id = activity.id
          and r.question_id = (q.value->>'id')::uuid
          and r.resolved = true
      )
    ) then
      raise exception 'Finish every question before completing'
        using errcode = '22023';
    end if;

    update public.m6_comprehension_attempts
    set status = 'completed',
        completed_at = now()
    where id = activity.id;

    return jsonb_build_object('completed', true);
  end if;

  select q.value
  into question
  from jsonb_array_elements(activity.question_snapshot) as q(value)
  where q.value->>'id' = target_question::text;

  if question is null then
    raise exception 'Question does not belong to this activity'
      using errcode = '22023';
  end if;

  if action_name = 'answer' then
    if selected_option is null
       or selected_option < 0
       or selected_option > 3
       or request_id is null then
      raise exception 'Invalid answer request'
        using errcode = '22023';
    end if;
  end if;

  select *
  into response
  from public.m6_comprehension_responses
  where attempt_id = activity.id
    and question_id = target_question;

  -- A network retry reuses its request ID.
  if action_name = 'answer' and response.id is not null then
    select h.value
    into previous_action
    from jsonb_array_elements(response.answer_history) as h(value)
    where h.value->>'requestId' = request_id::text;

    if previous_action is not null then
      if (previous_action->>'optionIndex')::integer
         <> selected_option then
        raise exception 'Request ID already used for another answer'
          using errcode = '22023';
      end if;

      return jsonb_build_object(
        'correct', (previous_action->>'correct')::boolean,
        'resolved', response.resolved
      );
    end if;
  end if;

  if activity.status = 'completed' then
    raise exception 'This activity is already completed'
      using errcode = '22023';
  end if;

  if response.id is null then
    insert into public.m6_comprehension_responses (
      attempt_id,
      question_id
    )
    values (
      activity.id,
      target_question
    )
    returning * into response;
  end if;

  if action_name = 'hint' then
    if not response.resolved then
      update public.m6_comprehension_responses
      set hint_used = true,
          updated_at = now()
      where id = response.id;
    end if;

    return jsonb_build_object(
      'hint', question->>'scaffoldingHint',
      'resolved', response.resolved
    );
  end if;

  if response.resolved then
    raise exception 'This question is already finished'
      using errcode = '22023';
  end if;

  correct_index := (question->>'correctOptionIndex')::integer;

  if correct_index is null
     or correct_index < 0
     or correct_index > 3 then
    raise exception 'Invalid saved answer key';
  end if;

  answer_correct := selected_option = correct_index;

  history := response.answer_history || jsonb_build_array(
    jsonb_build_object(
      'requestId', request_id,
      'optionIndex', selected_option,
      'correct', answer_correct,
      'hintUsed', response.hint_used,
      'answeredAt', now()
    )
  );

  update public.m6_comprehension_responses
  set first_option_index =
        coalesce(first_option_index, selected_option),
      first_answer_correct =
        coalesce(first_answer_correct, answer_correct),
      answer_history = history,

      -- After two answers, move to explanation and the next question.
      resolved = answer_correct
        or jsonb_array_length(history) >= 2,

      updated_at = now()
  where id = response.id
  returning * into response;

  return jsonb_build_object(
    'correct', answer_correct,
    'resolved', response.resolved
  );
end;
$function$;


REVOKE ALL ON FUNCTION
  public.m3_admin_collection(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.m3_admin_collection(uuid)
TO authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.m3_save_passage_bank(uuid, uuid, bigint, jsonb, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.m3_save_passage_bank(uuid, uuid, bigint, jsonb, text)
TO authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.m3_write_material_question_set(uuid, uuid, uuid, text, integer, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.m3_write_material_question_set(uuid, uuid, uuid, text, integer, jsonb)
TO service_role;

REVOKE ALL ON FUNCTION
  public.m6_apply_action(uuid, uuid, uuid, text, integer, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.m6_apply_action(uuid, uuid, uuid, text, integer, uuid)
TO service_role;

COMMIT;