-- Read-only PREFLIGHT for m7_intervention_suggestions_PROPOSED.sql. Run BEFORE applying. Changes nothing.
-- Every PASS/FAIL row must say PASS. INFO rows are recorded for comparison with the VERIFY run after applying
-- (the "existing rows fingerprint" must be identical in both).
SELECT 'prerequisite: m7_interventions with the original 10 columns' AS check,
  CASE WHEN count(*) = 10 THEN 'PASS' ELSE 'FAIL' END AS result, count(*)::text AS detail
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'm7_interventions'
  AND column_name IN ('id','teacher_id','student_id','notes','intervention_date','status','follow_up_date','follow_up_notes','created_at','updated_at')
UNION ALL
SELECT 'not applied yet: none of the 6 new columns exist', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'm7_interventions'
  AND column_name IN ('competency','language','suggestion_key','suggestion_snapshot','teacher_notes','follow_up_outcome')
UNION ALL
SELECT 'not applied yet: no guard function or trigger',
  CASE WHEN to_regprocedure('public.m7_intervention_guard()') IS NULL
        AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.m7_interventions'::regclass AND tgname = 'm7_intervention_guard') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'not applied yet: none of the 7 new constraint names exist', CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
FROM pg_constraint WHERE conrelid = 'public.m7_interventions'::regclass AND conname IN (
  'm7_interventions_competency_check','m7_interventions_language_check','m7_interventions_suggestion_key_check',
  'm7_interventions_suggestion_snapshot_check','m7_interventions_suggestion_complete','m7_interventions_teacher_notes_check',
  'm7_interventions_follow_up_outcome_check')
UNION ALL
SELECT 'prerequisite (M1): profiles.school_id and schools exist',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'school_id')
        AND to_regclass('public.schools') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'grants: authenticated SELECT only, anon none',
  CASE WHEN has_table_privilege('authenticated','public.m7_interventions','SELECT')
        AND NOT has_table_privilege('authenticated','public.m7_interventions','INSERT')
        AND NOT has_table_privilege('authenticated','public.m7_interventions','UPDATE')
        AND NOT has_table_privilege('authenticated','public.m7_interventions','DELETE')
        AND NOT has_table_privilege('anon','public.m7_interventions','SELECT') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'RLS on with the single Teacher read policy',
  CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.m7_interventions'::regclass)
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'm7_interventions') = 1
        AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'm7_interventions' AND policyname = 'm7_interventions_teacher_read')
  THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'existing rows (count)', 'INFO', count(*)::text FROM public.m7_interventions
UNION ALL
SELECT 'existing rows fingerprint (original columns; must equal VERIFY)', 'INFO',
  md5(coalesce(string_agg((id, teacher_id, student_id, notes, intervention_date, status, follow_up_date, follow_up_notes, created_at, updated_at)::text, ',' ORDER BY id), ''))
FROM public.m7_interventions
UNION ALL
SELECT 'existing rows by author role (non-Teacher rows become read-only history)', 'INFO',
  coalesce(string_agg(role || '=' || n, ', ' ORDER BY role), 'none')
FROM (SELECT coalesce(p.role, 'missing') AS role, count(*) AS n FROM public.m7_interventions i LEFT JOIN public.profiles p ON p.id = i.teacher_id GROUP BY 1) r;
