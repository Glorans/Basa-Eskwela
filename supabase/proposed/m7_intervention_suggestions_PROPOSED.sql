-- M7 F10/F11: suggested interventions and richer intervention records.               PROPOSED - NOT APPLIED TO STAGING
--
-- Additive only. Existing m7_interventions rows keep every value; the new columns are NULL / '' for them.
--   competency          the competency the intervention addresses (NULL for records saved before this migration)
--   language            en / fil: which language's results it addresses (NULL = not language-specific / older record)
--   suggestion_key      the rule-based suggestion the Teacher chose (NULL = Teacher-written intervention)
--   suggestion_snapshot the server's copy of that suggestion and its evidence when it was chosen (fixed afterwards)
--   teacher_notes       optional Teacher notes
--   follow_up_outcome   the Teacher's follow-up judgement; never set automatically
-- Database rules (in addition to the backend checks, which stay the primary gate):
--   * new records: the author must be an approved-role Teacher of the Student's school (Appendix N M7 F11 is
--     Teacher-only) with the Student enrolled in one of the Teacher's classrooms (M1 multi-tenancy);
--   * records written earlier by a School Admin are kept unchanged as history and can no longer be edited;
--   * author, Student, creation time and the chosen suggestion can never be changed after saving.
-- Grants and RLS are unchanged: authenticated users may only SELECT (Teacher: own records for own Students),
-- every write goes through the authorized Express API with the service role.
-- Rollback: m7_intervention_suggestions_ROLLBACK_PROPOSED.sql. Verify: m7_intervention_suggestions_VERIFY_READONLY.sql.

BEGIN;

ALTER TABLE public.m7_interventions
  ADD COLUMN competency text,
  ADD COLUMN language text,
  ADD COLUMN suggestion_key text,
  ADD COLUMN suggestion_snapshot jsonb,
  ADD COLUMN teacher_notes text NOT NULL DEFAULT '',
  ADD COLUMN follow_up_outcome text;

ALTER TABLE public.m7_interventions
  ADD CONSTRAINT m7_interventions_competency_check
    CHECK (competency IS NULL OR competency IN ('word_recognition','fluency','literal','inferential','critical','other')),
  ADD CONSTRAINT m7_interventions_language_check CHECK (language IS NULL OR language IN ('en','fil')),
  ADD CONSTRAINT m7_interventions_suggestion_key_check CHECK (suggestion_key IS NULL OR suggestion_key ~ '^[a-z_]{1,40}$'),
  ADD CONSTRAINT m7_interventions_suggestion_snapshot_check
    CHECK (suggestion_snapshot IS NULL OR (jsonb_typeof(suggestion_snapshot) = 'object' AND pg_column_size(suggestion_snapshot) <= 20000)),
  ADD CONSTRAINT m7_interventions_suggestion_complete
    CHECK (suggestion_key IS NULL OR (suggestion_snapshot IS NOT NULL AND competency IS NOT NULL AND competency <> 'other' AND language IS NOT NULL)),
  ADD CONSTRAINT m7_interventions_teacher_notes_check CHECK (length(teacher_notes) <= 10000),
  ADD CONSTRAINT m7_interventions_follow_up_outcome_check
    CHECK (follow_up_outcome IS NULL OR follow_up_outcome IN ('improved','partly_improved','no_change','too_early'));

CREATE FUNCTION public.m7_intervention_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  author_role text; author_school uuid; learner_role text; learner_school uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.teacher_id IS DISTINCT FROM OLD.teacher_id OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'm7_interventions: author, student and creation time cannot change' USING ERRCODE = '42501';
    END IF;
    SELECT p.role INTO author_role FROM public.profiles p WHERE p.id = OLD.teacher_id;
    IF author_role IS DISTINCT FROM 'teacher' THEN
      RAISE EXCEPTION 'm7_interventions: only Teachers edit interventions; this record is kept as history' USING ERRCODE = '42501';
    END IF;
    IF NEW.suggestion_key IS DISTINCT FROM OLD.suggestion_key OR NEW.suggestion_snapshot IS DISTINCT FROM OLD.suggestion_snapshot
       OR (OLD.suggestion_key IS NOT NULL AND (NEW.competency IS DISTINCT FROM OLD.competency OR NEW.language IS DISTINCT FROM OLD.language)) THEN
      RAISE EXCEPTION 'm7_interventions: the chosen suggestion cannot change' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  SELECT p.role, p.school_id INTO author_role, author_school FROM public.profiles p WHERE p.id = NEW.teacher_id;
  SELECT p.role, p.school_id INTO learner_role, learner_school FROM public.profiles p WHERE p.id = NEW.student_id;
  IF author_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'm7_interventions: only Teachers record interventions' USING ERRCODE = '42501';
  END IF;
  IF learner_role IS DISTINCT FROM 'student'
     OR author_school IS NULL OR author_school IS DISTINCT FROM learner_school THEN
    RAISE EXCEPTION 'm7_interventions: the author and the student must belong to the same school' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.rooms r JOIN public.enrollments e ON e.room_id = r.id
       WHERE r.teacher_id = NEW.teacher_id AND e.student_id = NEW.student_id) THEN
    RAISE EXCEPTION 'm7_interventions: the student is not in this teacher''s classrooms' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.m7_intervention_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER m7_intervention_guard BEFORE INSERT OR UPDATE ON public.m7_interventions
FOR EACH ROW EXECUTE FUNCTION public.m7_intervention_guard();

COMMIT;
