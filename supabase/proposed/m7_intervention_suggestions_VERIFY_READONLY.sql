-- Read-only check after m7_intervention_suggestions_PROPOSED.sql. Every row must say PASS.
SELECT 'columns' AS check, CASE WHEN count(*) = 6 THEN 'PASS' ELSE 'FAIL' END AS result, count(*)::text AS detail
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'm7_interventions'
  AND column_name IN ('competency','language','suggestion_key','suggestion_snapshot','teacher_notes','follow_up_outcome')
UNION ALL
SELECT 'constraints', CASE WHEN count(*) = 7 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
FROM pg_constraint WHERE conrelid = 'public.m7_interventions'::regclass AND conname IN (
  'm7_interventions_competency_check','m7_interventions_language_check','m7_interventions_suggestion_key_check',
  'm7_interventions_suggestion_snapshot_check','m7_interventions_suggestion_complete','m7_interventions_teacher_notes_check',
  'm7_interventions_follow_up_outcome_check')
UNION ALL
SELECT 'guard trigger', CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
FROM pg_trigger WHERE tgrelid = 'public.m7_interventions'::regclass AND tgname = 'm7_intervention_guard' AND tgenabled = 'O'
UNION ALL
SELECT 'guard not executable by clients',
  CASE WHEN NOT has_function_privilege('authenticated', 'public.m7_intervention_guard()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.m7_intervention_guard()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'authenticated still SELECT only',
  CASE WHEN has_table_privilege('authenticated','public.m7_interventions','SELECT')
        AND NOT has_table_privilege('authenticated','public.m7_interventions','INSERT')
        AND NOT has_table_privilege('authenticated','public.m7_interventions','UPDATE')
        AND NOT has_table_privilege('authenticated','public.m7_interventions','DELETE')
        AND NOT has_table_privilege('anon','public.m7_interventions','SELECT') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'RLS on, teacher read policy kept',
  CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.m7_interventions'::regclass)
        AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'm7_interventions' AND policyname = 'm7_interventions_teacher_read')
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'm7_interventions') = 1 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'row count unchanged (compare with the count taken before applying)', 'INFO', count(*)::text
FROM public.m7_interventions
UNION ALL
SELECT 'existing rows fingerprint (original columns; must equal PREFLIGHT)', 'INFO',
  md5(coalesce(string_agg((id, teacher_id, student_id, notes, intervention_date, status, follow_up_date, follow_up_notes, created_at, updated_at)::text, ',' ORDER BY id), ''))
FROM public.m7_interventions;
