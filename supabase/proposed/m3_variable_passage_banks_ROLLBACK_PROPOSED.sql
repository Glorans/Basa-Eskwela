-- PROPOSAL ONLY. NOT APPLIED. Rollback for m3_variable_passage_banks_PROPOSED.sql.
-- Closes the 6/9/12 gate and restores the exact previous definitions (bank fix 13e35ccb...,
-- phase-2 readiness e6985165...). Refuses to run while an unpublished draft holds a 9/12 bank,
-- because the restored six-only functions could no longer review or publish it; never truncates banks.
-- Published 9/12 modules are unaffected: M6 reads whatever reviewed bank exists.
-- If you only need to hide 9/12 immediately, run step 1 alone: drop function public.m3_passage_bank_sizes();
begin;
set local lock_timeout = '5s';

do $guard$
begin
  if exists (
    select 1 from public.comprehension_questions q join public.modules m on m.id = q.module_id
    where q.passage_id is not null and m.status = 'draft' and m.published_at is null
    group by q.passage_id having count(*) <> 6
  ) then
    raise exception 'Unpublished drafts still have 9/12-question banks; regenerate them as six first or keep the migration';
  end if;
end $guard$;

-- 1. Close the gate (editor hides the selector, backend refuses 9/12 before generating).
drop function if exists public.m3_passage_bank_sizes();

-- 2. Restore the installed bank fix verbatim (supabase/proposed/m3_save_passage_bank_fix_PROPOSED.sql).
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

    DELETE FROM public.comprehension_question_answers AS answer
    WHERE answer.question_id IN (
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
      DELETE FROM public.comprehension_question_answers AS answer
      WHERE answer.question_id IN (
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

-- 3. Restore the phase-2 readiness function verbatim (supabase/m3_module_passages_phase2.sql).
create or replace function public.m3_collection_publish_issues(target_id uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare issues text[]; p record; category text;
begin
  issues:=public.m3_collection_publish_issues_phase1(target_id);
  for p in select id,display_order from public.module_passages where module_id=target_id loop
    foreach category in array array['literal','inferential','critical'] loop
      if (select count(*) from public.comprehension_questions where passage_id=p.id and question_type=category)<>2 then
        issues:=array_append(issues,format('Passage %s requires exactly two %s questions',p.display_order,category));
      end if;
    end loop;
  end loop;
  return issues;
end; $$;

notify pgrst, 'reload schema';
commit;
