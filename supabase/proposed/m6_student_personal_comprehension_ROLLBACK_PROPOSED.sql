-- PROPOSAL ONLY. NOT APPLIED. Restores the three functions exactly as they were live on ReadFlow-Staging on
-- 2026-11-17 (verbatim pg_get_functiondef). Run only after m6_student_personal_comprehension_PROPOSED.sql; then run the PREFLIGHT block of
-- m6_student_personal_comprehension_VERIFY_READONLY.sql, which must pass again. No row is changed.
begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.m6_assert_learner_completion_access(p_attempt uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.m6_comprehension_attempts%rowtype; v_role text; v_language text;
begin
  select * into a from public.m6_comprehension_attempts where id = p_attempt;
  if not found then raise exception 'Activity not found' using errcode = 'P0002'; end if;
  select role into v_role from public.profiles where id = a.user_id for share;
  if v_role is null or v_role not in ('student','general_user') then
    raise exception 'Learner access required' using errcode = '42501';
  end if;
  if (a.room_id is not null and v_role <> 'student')
    or (a.room_id is null and v_role <> 'general_user') then
    raise exception 'Learner role does not match attempt context' using errcode = '42501';
  end if;
  if a.module_id is not null then
    if a.material_id is not null or a.activity_assignment_id is not null
      or (a.room_id is null) <> (a.assignment_id is null) then
      raise exception 'Malformed classroom module attempt' using errcode = '22023';
    end if;
    select public.m8_normalize_language(p.language) into v_language
    from public.modules m join public.learning_paths p on p.id = m.path_id
    where m.id = a.module_id and m.status = 'published' and m.deleted_at is null
    for share of m, p;
    if not found then raise exception 'Module access revoked' using errcode = '42501'; end if;
    if v_language is null then raise exception 'Unknown module language' using errcode = '22023'; end if;
    if v_language is distinct from a.language then
      raise exception 'Attempt language does not match its module' using errcode = '22023';
    end if;
    if a.room_id is not null then
      perform 1 from public.room_modules rm
      join public.rooms r on r.id = rm.room_id
      join public.enrollments e on e.room_id = r.id and e.student_id = a.user_id
      join public.profiles t on t.id = r.teacher_id
      where rm.id = a.assignment_id and rm.room_id = a.room_id and rm.module_id = a.module_id
        and rm.assigned_by = r.teacher_id and t.role = 'teacher' and t.teacher_status = 'approved'
      for share of rm, r, e, t;
      if not found then
        raise exception 'Classroom module access revoked or assignment does not belong to this classroom module'
          using errcode = '42501';
      end if;
    end if;
  elsif a.material_id is not null and a.activity_assignment_id is not null
      and a.room_id is not null and a.assignment_id is null then
    select public.m8_normalize_language(m.language) into v_language
    from public.reading_activity_assignments ra
    join public.uploaded_materials m on m.id = ra.material_id
    join public.rooms r on r.id = ra.room_id
    join public.enrollments e on e.room_id = r.id and e.student_id = a.user_id
    join public.profiles t on t.id = r.teacher_id
    where ra.id = a.activity_assignment_id and ra.student_id = a.user_id
      and ra.room_id = a.room_id and ra.material_id = a.material_id
      and ra.assigned_by = r.teacher_id and m.uploaded_by = r.teacher_id
      and t.role = 'teacher' and t.teacher_status = 'approved' and m.extraction_status = 'completed'
    for share of ra, m, r, e, t;
    if not found then
      raise exception 'Material access revoked or assignment does not belong to learner' using errcode = '42501';
    end if;
    if v_language is null or v_language is distinct from a.language then
      raise exception 'Attempt language does not match its material' using errcode = '22023';
    end if;
  else
    raise exception 'Malformed comprehension source' using errcode = '22023';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.m8_on_comprehension_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tier integer;
  v_allowed integer;
  v_granted boolean := false;
begin
  if new.material_id is not null and new.activity_assignment_id is null and new.room_id is null then return new; end if;
  if new.status <> 'completed' or new.completed_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;
  perform public.m6_assert_completion_access(new.id);
  -- Admin practice is valid but is not learner progress: no XP, reading day or badge.
  if not exists (select 1 from public.profiles where id = new.user_id and role in ('student','general_user')) then
    return new;
  end if;
  if public.m8_performance_language(public.m8_activity_language(new.material_id, new.module_id)) then
    v_granted := public.m8_evaluate_rewards(new.user_id, new.material_id, new.activity_assignment_id, new.module_id,
      new.passage_id, new.room_id, new.assignment_id, new.passage_text);
  elsif exists (select 1 from public.m8_passage_rewards pr where pr.user_id = new.user_id
      and public.m8_same_passage(pr.content_text, new.passage_text)) then
    return new;
  elsif new.activity_assignment_id is not null then
    v_granted := public.m8_grant_xp(new.user_id, 'assignment', new.activity_assignment_id, 60);
  else
    select case lower(m.difficulty) when 'easy' then 1 when 'medium' then 2 when 'hard' then 3 else 0 end
      into v_tier from public.modules m where m.id = new.module_id;
    if v_tier is null or v_tier = 0 then raise exception 'Unknown module difficulty'; end if;
    if new.room_id is not null then
      v_allowed := v_tier;
    else
      v_allowed := case public.m2_trusted_reading_level(new.user_id, new.language)
        when 'Independent' then 3 when 'Instructional' then 2 when 'Frustration' then 1 end;
      if v_allowed is null then return new; end if;
    end if;
    v_granted := public.m8_grant_xp(new.user_id, 'module', new.module_id,
      case least(v_tier, v_allowed) when 1 then 30 when 2 then 50 else 80 end);
  end if;

  -- Only new verified XP records a reading day; duplicates never farm streaks.
  if v_granted then
    perform public.m8_record_reading_day(new.user_id, (new.completed_at at time zone 'Asia/Manila')::date);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.m7_save_evaluation(target_student uuid, expected_generation bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END; $function$;

commit;
