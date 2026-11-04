-- PROPOSAL ONLY. NOT APPLIED. Review docs/M3_M4_FOLLOWUP_REPORT.md first.
-- Per-passage bank sizes: 6, 9 or 12, split equally across three categories.
-- No rows, IDs, review status, RLS, existing grants, historical results, models or XP rules are changed.
-- Requires the installed M3 phases 1/2, feedback fields, and passage-bank ambiguity fix.
-- Existing function signatures/grants remain. Six stays the default everywhere.
--
-- Capability gate: m3_passage_bank_sizes() is the ONLY signal the app uses to offer 9/12.
-- Before this migration the function does not exist, so the editor shows no selector and the
-- backend refuses 9/12 before calling the question generator (no paid request is made).
--
-- Downstream (verified against a restore of the 2026-11-04 staging backup):
--   M6 loads every reviewed question of the passage, freezes them in question_snapshot and scores
--   against the snapshot length; M7 derives question_count from each snapshot; M8 module XP depends
--   only on module difficulty / reading level, once per module. Existing attempts keep their snapshots.
--
-- Rollback (forward-safe; never truncates 9/12 banks):
--   1. drop function public.m3_passage_bank_sizes();   -- closes the gate at once (UI + backend)
--   2. only when no unpublished draft has a 9/12 bank, restore m3_save_passage_bank from
--      supabase/proposed/m3_save_passage_bank_fix_PROPOSED.sql and m3_collection_publish_issues
--      from supabase/m3_module_passages_phase2.sql. Published 9/12 modules keep working in M6.
begin;
set local lock_timeout = '5s';

-- Refuse to run unless the functions being replaced are exactly the reviewed definitions
-- (installed bank fix 13e35ccb..., phase-2 readiness e6985165...). Fingerprints ignore carriage
-- returns only: the live phase-2 function was installed with CRLF line endings (12 CR characters),
-- which is not a definition change. Any other difference still refuses.
do $guard$
declare
  bank_md5 text := (select md5(replace(pg_get_functiondef('public.m3_save_passage_bank(uuid,uuid,bigint,jsonb,text)'::regprocedure), chr(13), '')));
  issues_md5 text := (select md5(replace(pg_get_functiondef('public.m3_collection_publish_issues(uuid)'::regprocedure), chr(13), '')));
begin
  if bank_md5 is distinct from '13e35ccbace4c11e6285aae64262999c' then
    raise exception 'm3_save_passage_bank is not the reviewed definition (found %); stop and re-review', bank_md5;
  end if;
  if issues_md5 is distinct from 'e698516505be140cdd4c2ed251c55974' then
    raise exception 'm3_collection_publish_issues is not the reviewed definition (found %); stop and re-review', issues_md5;
  end if;
  if to_regprocedure('public.m3_collection_publish_issues_phase1(uuid)') is null then
    raise exception 'm3_collection_publish_issues_phase1 is missing; stop and re-review';
  end if;
end $guard$;
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
  expected_count integer;
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
    expected_count := jsonb_array_length(bank);
    IF expected_count NOT IN (6, 9, 12) THEN
      RAISE EXCEPTION 'Exactly 6, 9 or 12 questions are required';
    END IF;

    FOREACH category IN ARRAY
      ARRAY['literal', 'inferential', 'critical']
    LOOP
      IF (
        SELECT count(*)
        FROM jsonb_array_elements(bank) AS j
        WHERE j->>'type' = category
      ) <> expected_count / 3 THEN
        RAISE EXCEPTION
          'Exactly % % questions are required',
          expected_count / 3, category;
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
      ) <> expected_count
      OR (
        SELECT count(DISTINCT j->>'id')
        FROM jsonb_array_elements(bank) AS j
      ) <> expected_count THEN
        RAISE EXCEPTION
          'Review must preserve all saved question IDs and the bank size';
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

CREATE OR REPLACE FUNCTION public.m3_collection_publish_issues(target_id uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare issues text[]; p record; category text; total integer;
begin
  -- Keep title/text/review/answer-key checks from the original readiness function.
  issues := public.m3_collection_publish_issues_phase1(target_id);
  for p in select id, display_order from public.module_passages where module_id = target_id loop
    select count(*) into total from public.comprehension_questions where passage_id = p.id;
    if total not in (6, 9, 12) then
      issues := array_append(issues, format('Passage %s requires 6, 9 or 12 questions', p.display_order));
    else
      foreach category in array array['literal','inferential','critical'] loop
        if (select count(*) from public.comprehension_questions where passage_id = p.id and question_type = category) <> total / 3 then
          issues := array_append(issues, format('Passage %s requires exactly %s %s questions', p.display_order, total / 3, category));
        end if;
      end loop;
    end if;
  end loop;
  return issues;
end; $$;

-- Capability gate read by the editor (authenticated) and the generation route.
create function public.m3_passage_bank_sizes() returns integer[]
language sql stable security invoker set search_path = '' as $$ select array[6, 9, 12] $$;
revoke all on function public.m3_passage_bank_sizes() from public, anon;
grant execute on function public.m3_passage_bank_sizes() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
