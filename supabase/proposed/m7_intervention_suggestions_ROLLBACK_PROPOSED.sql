-- Rollback for m7_intervention_suggestions_PROPOSED.sql.                                PROPOSED - NOT APPLIED TO STAGING
-- Removes the trigger and the six new columns. The original columns and rows are untouched.
-- WARNING: competency, language, chosen suggestions, Teacher notes and follow-up outcomes saved after the migration
-- are DELETED by this rollback. Take a backup (or export those columns) first. Deploy the previous backend first:
-- the new backend writes these columns.
BEGIN;
DROP TRIGGER IF EXISTS m7_intervention_guard ON public.m7_interventions;
DROP FUNCTION IF EXISTS public.m7_intervention_guard();
ALTER TABLE public.m7_interventions
  DROP CONSTRAINT IF EXISTS m7_interventions_competency_check,
  DROP CONSTRAINT IF EXISTS m7_interventions_language_check,
  DROP CONSTRAINT IF EXISTS m7_interventions_suggestion_key_check,
  DROP CONSTRAINT IF EXISTS m7_interventions_suggestion_snapshot_check,
  DROP CONSTRAINT IF EXISTS m7_interventions_suggestion_complete,
  DROP CONSTRAINT IF EXISTS m7_interventions_teacher_notes_check,
  DROP CONSTRAINT IF EXISTS m7_interventions_follow_up_outcome_check;
ALTER TABLE public.m7_interventions
  DROP COLUMN IF EXISTS competency,
  DROP COLUMN IF EXISTS language,
  DROP COLUMN IF EXISTS suggestion_key,
  DROP COLUMN IF EXISTS suggestion_snapshot,
  DROP COLUMN IF EXISTS teacher_notes,
  DROP COLUMN IF EXISTS follow_up_outcome;
COMMIT;
