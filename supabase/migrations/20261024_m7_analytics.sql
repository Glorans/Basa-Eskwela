-- Review and execute manually after M4, M5 and M6 migrations. No live SQL is run by the app.
BEGIN;
-- Fail before making changes if prerequisite columns/types or completion RPC are absent.
-- The transaction rolls back on any incompatibility; this is a one-time migration.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('profiles','id','uuid'), ('profiles','role','text'), ('profiles','teacher_status','text'),
    ('rooms','id','uuid'), ('rooms','teacher_id','uuid'),
    ('enrollments','room_id','uuid'), ('enrollments','student_id','uuid'),
    ('m6_comprehension_attempts','id','uuid'), ('m6_comprehension_attempts','user_id','uuid'),
    ('m6_comprehension_attempts','room_id','uuid'), ('m6_comprehension_attempts','status','text'),
    ('m6_comprehension_attempts','completed_at','timestamp with time zone'),
    ('m6_comprehension_attempts','question_snapshot','jsonb'),
    ('m6_comprehension_responses','attempt_id','uuid'), ('m6_comprehension_responses','question_id','uuid'),
    ('m6_comprehension_responses','first_option_index','integer'), ('m6_comprehension_responses','resolved','boolean')
  ) AS required(table_name,column_name,type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || item.table_name)
        AND a.attname = item.column_name AND NOT a.attisdropped
        AND pg_catalog.format_type(a.atttypid,a.atttypmod) = item.type_name) THEN
      RAISE EXCEPTION 'Missing/incompatible prerequisite: public.%.% (%)', item.table_name,item.column_name,item.type_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply the existing M6 completion functions before M7';
  END IF;
  IF EXISTS (SELECT 1 FROM public.m6_comprehension_attempts a
    LEFT JOIN public.profiles p ON p.id = a.user_id WHERE p.id IS NULL) THEN
    RAISE EXCEPTION 'M6 contains users without profiles; resolve these before installing M7';
  END IF;
END; $$;
CREATE SEQUENCE public.m7_risk_generation;
REVOKE ALL ON SEQUENCE public.m7_risk_generation FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.m7_risk_generation TO service_role;
CREATE TABLE public.m7_risk_queue (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  generation bigint NOT NULL DEFAULT nextval('public.m7_risk_generation'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX m7_queue_updated ON public.m7_risk_queue(updated_at,id);
CREATE TABLE public.m7_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.m6_comprehension_attempts(id) ON DELETE CASCADE,
  classification text NOT NULL CHECK (classification IN ('On Track','Early Warning','At Risk','Needs Support')),
  previous_classification text NOT NULL CHECK (previous_classification IN ('On Track','Early Warning','At Risk','Needs Support')),
  occurred_at timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  read_at timestamptz,
  superseded_at timestamptz,
  evaluation_generation bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, student_id, attempt_id, classification)
);
CREATE INDEX m7_events_teacher_student ON public.m7_risk_events(teacher_id,student_id,occurred_at DESC);
CREATE TABLE public.m7_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notes text NOT NULL CHECK (length(btrim(notes)) BETWEEN 1 AND 10000),
  intervention_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('planned','in_progress','completed')),
  follow_up_date date,
  follow_up_notes text NOT NULL DEFAULT '' CHECK (length(follow_up_notes) <= 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX m7_interventions_owner ON public.m7_interventions(teacher_id,student_id,intervention_date DESC);
ALTER TABLE public.m7_risk_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m7_risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m7_interventions ENABLE ROW LEVEL SECURITY;
-- All writes go through authenticated Express authorization and the service role.
REVOKE ALL ON public.m7_risk_queue, public.m7_risk_events, public.m7_interventions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.m7_risk_events, public.m7_interventions TO authenticated;
GRANT ALL ON public.m7_risk_queue, public.m7_risk_events, public.m7_interventions TO service_role;
CREATE POLICY m7_events_teacher_read ON public.m7_risk_events FOR SELECT TO authenticated USING (
  teacher_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher' AND p.teacher_status = 'approved')
  AND EXISTS (SELECT 1 FROM public.rooms r JOIN public.enrollments e ON e.room_id = r.id WHERE r.teacher_id = auth.uid() AND e.student_id = m7_risk_events.student_id)
);
CREATE POLICY m7_interventions_teacher_read ON public.m7_interventions FOR SELECT TO authenticated USING (
  teacher_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teacher' AND p.teacher_status = 'approved')
  AND EXISTS (SELECT 1 FROM public.rooms r JOIN public.enrollments e ON e.room_id = r.id WHERE r.teacher_id = auth.uid() AND e.student_id = m7_interventions.student_id)
);
CREATE FUNCTION public.m7_enqueue_completion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    INSERT INTO public.m7_risk_queue(id) VALUES (NEW.user_id)
    ON CONFLICT(id) DO UPDATE SET generation = nextval('public.m7_risk_generation'), updated_at = now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.m7_enqueue_completion() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER m7_completed_quiz AFTER INSERT OR UPDATE OF status ON public.m6_comprehension_attempts
FOR EACH ROW EXECUTE FUNCTION public.m7_enqueue_completion();
-- Enrollment changes also schedule evaluation of existing real classroom attempts.
CREATE FUNCTION public.m7_enqueue_enrollment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    INSERT INTO public.m7_risk_queue(id) SELECT id FROM public.profiles WHERE id = OLD.student_id
    ON CONFLICT(id) DO UPDATE SET generation = nextval('public.m7_risk_generation'), updated_at = now();
  END IF;
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO public.m7_risk_queue(id) SELECT id FROM public.profiles WHERE id = NEW.student_id
    ON CONFLICT(id) DO UPDATE SET generation = nextval('public.m7_risk_generation'), updated_at = now();
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.m7_enqueue_enrollment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER m7_enrollment_changed AFTER INSERT OR UPDATE OR DELETE ON public.enrollments
FOR EACH ROW EXECUTE FUNCTION public.m7_enqueue_enrollment();
-- Role/approval and classroom-owner changes must invalidate in-flight evaluations too.
CREATE FUNCTION public.m7_enqueue_authorization_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'rooms' THEN
    IF NEW.teacher_id IS NOT DISTINCT FROM OLD.teacher_id THEN RETURN NULL; END IF;
    INSERT INTO public.m7_risk_queue(id)
    SELECT DISTINCT e.student_id FROM public.enrollments e JOIN public.profiles p ON p.id=e.student_id
    WHERE e.room_id=NEW.id ORDER BY e.student_id
    ON CONFLICT(id) DO UPDATE SET generation=nextval('public.m7_risk_generation'),updated_at=now();
  ELSE
    IF NEW.role IS NOT DISTINCT FROM OLD.role AND NEW.teacher_status IS NOT DISTINCT FROM OLD.teacher_status THEN RETURN NULL; END IF;
    INSERT INTO public.m7_risk_queue(id)
    SELECT DISTINCT p.id FROM public.profiles p WHERE p.id=NEW.id OR EXISTS (
      SELECT 1 FROM public.enrollments e JOIN public.rooms r ON r.id=e.room_id
      WHERE e.student_id=p.id AND r.teacher_id=NEW.id
    ) ORDER BY p.id
    ON CONFLICT(id) DO UPDATE SET generation=nextval('public.m7_risk_generation'),updated_at=now();
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.m7_enqueue_authorization_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER m7_room_owner_changed AFTER UPDATE OF teacher_id ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.m7_enqueue_authorization_change();
CREATE TRIGGER m7_profile_authorization_changed AFTER UPDATE OF role,teacher_status ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.m7_enqueue_authorization_change();

-- Derive rather than accept alert payloads. The service-role caller supplies only a
-- queue key/version: it cannot choose teachers, evidence, scores or classifications.
-- Mirrors summarizeComprehension() first-answer scoring and classifyRisk().
CREATE FUNCTION public.m7_save_evaluation(target_student uuid, expected_generation bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current_generation bigint;
  teacher record;
  quiz record;
  question_count integer;
  valid_count integer;
  correct_count integer;
  score integer;
  low_count integer;
  very_low_count integer;
  recovery_count integer;
  v_classification text;
  v_previous_classification text;
  evidence jsonb;
BEGIN
  SELECT generation INTO current_generation FROM public.m7_risk_queue WHERE id = target_student FOR UPDATE;
  IF current_generation IS NULL OR current_generation <> expected_generation THEN RETURN false; END IF;

  FOR teacher IN
    SELECT DISTINCT p.id FROM public.profiles p
    JOIN public.rooms r ON r.teacher_id=p.id
    JOIN public.enrollments e ON e.room_id=r.id
    JOIN public.profiles learner ON learner.id=e.student_id
    WHERE e.student_id=target_student AND learner.role='student'
      AND p.role='teacher' AND p.teacher_status='approved'
    ORDER BY p.id
  LOOP
    v_classification := 'On Track'; low_count := 0; very_low_count := 0; recovery_count := 0; evidence := '[]'::jsonb;
    FOR quiz IN
      SELECT a.* FROM public.m6_comprehension_attempts a
      WHERE a.user_id=target_student AND a.status='completed'
        AND (a.room_id IS NULL OR EXISTS (
          SELECT 1 FROM public.rooms r JOIN public.enrollments e ON e.room_id=r.id
          WHERE r.id=a.room_id AND r.teacher_id=teacher.id AND e.student_id=target_student
        ))
      ORDER BY a.completed_at,a.id
    LOOP
      IF quiz.completed_at IS NULL OR jsonb_typeof(quiz.question_snapshot) IS DISTINCT FROM 'array'
        OR jsonb_array_length(quiz.question_snapshot)=0 THEN
        RAISE EXCEPTION 'Invalid completed quiz evidence for %',quiz.id;
      END IF;
      question_count := jsonb_array_length(quiz.question_snapshot);
      -- Fail closed on malformed/duplicate/foreign evidence instead of clearing a risk.
      IF (SELECT count(DISTINCT q->>'id') FROM jsonb_array_elements(quiz.question_snapshot) q) <> question_count
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(quiz.question_snapshot) q
          WHERE (q->>'type') IS NULL OR (q->>'type') NOT IN ('literal','inferential','critical')
            OR jsonb_typeof(q->'options') IS DISTINCT FROM 'array'
            OR jsonb_array_length(q->'options') <> 4
            OR jsonb_typeof(q->'correctOptionIndex') IS DISTINCT FROM 'number'
            OR (q->>'correctOptionIndex')::numeric NOT IN (0,1,2,3))
        OR (SELECT count(*) FROM public.m6_comprehension_responses r WHERE r.attempt_id=quiz.id) <> question_count THEN
        RAISE EXCEPTION 'Invalid completed quiz evidence for %',quiz.id;
      END IF;
      SELECT count(*) FILTER (WHERE r.resolved AND r.first_option_index BETWEEN 0 AND 3),
        count(*) FILTER (WHERE r.first_option_index=(q->>'correctOptionIndex')::numeric::integer)
      INTO valid_count,correct_count
      FROM jsonb_array_elements(quiz.question_snapshot) q
      LEFT JOIN public.m6_comprehension_responses r ON r.attempt_id=quiz.id AND r.question_id=(q->>'id')::uuid;
      IF valid_count <> question_count THEN RAISE EXCEPTION 'Incomplete completed quiz evidence for %',quiz.id; END IF;
      -- Match the existing JavaScript floating-point percentage before rounding.
      score := floor((correct_count::double precision / question_count::double precision) * 100 + 0.5)::integer;
      v_previous_classification := v_classification;
      low_count := CASE WHEN score < 75 THEN low_count+1 ELSE 0 END;
      very_low_count := CASE WHEN score < 60 THEN very_low_count+1 ELSE 0 END;
      recovery_count := CASE WHEN score >= 75 THEN recovery_count+1 ELSE 0 END;
      IF v_classification IN ('At Risk','Needs Support') THEN
        IF recovery_count >= 2 THEN v_classification := 'On Track';
        ELSIF very_low_count >= 3 THEN v_classification := 'Needs Support'; END IF;
      ELSE
        v_classification := CASE WHEN very_low_count >= 3 THEN 'Needs Support'
          WHEN low_count >= 3 THEN 'At Risk' WHEN low_count >= 2 THEN 'Early Warning' ELSE 'On Track' END;
      END IF;
      evidence := evidence || jsonb_build_array(jsonb_build_object('id',quiz.id,'score',score,'completedAt',quiz.completed_at));
      IF jsonb_array_length(evidence)>3 THEN evidence := evidence-0; END IF;
      IF v_classification <> v_previous_classification THEN
        INSERT INTO public.m7_risk_events AS saved
          (teacher_id,student_id,attempt_id,classification,previous_classification,occurred_at,evidence,evaluation_generation)
        VALUES (teacher.id,target_student,quiz.id,v_classification,v_previous_classification,quiz.completed_at,evidence,current_generation)
        ON CONFLICT(teacher_id,student_id,attempt_id,classification) DO UPDATE
          SET previous_classification=EXCLUDED.previous_classification,occurred_at=EXCLUDED.occurred_at,
              evidence=EXCLUDED.evidence,evaluation_generation=EXCLUDED.evaluation_generation,superseded_at=NULL;
        -- read_at is deliberately preserved across retries and reconciliation.
      END IF;
    END LOOP;
  END LOOP;
  -- now() timestamps can predate commit order. Reconcile a late-arriving older
  -- quiz without deleting history or leaving an obsolete notification active.
  UPDATE public.m7_risk_events SET superseded_at=now()
    WHERE student_id=target_student AND evaluation_generation<>current_generation AND superseded_at IS NULL;
  DELETE FROM public.m7_risk_queue WHERE id = target_student;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.m7_save_evaluation(uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.m7_save_evaluation(uuid,bigint) TO service_role;
-- Backfill real existing completed attempts through the same worker; no fabricated scores.
INSERT INTO public.m7_risk_queue(id)
SELECT DISTINCT a.user_id FROM public.m6_comprehension_attempts a
JOIN public.profiles p ON p.id=a.user_id WHERE a.status='completed' AND p.role='student'
ON CONFLICT(id) DO NOTHING;
COMMIT;
