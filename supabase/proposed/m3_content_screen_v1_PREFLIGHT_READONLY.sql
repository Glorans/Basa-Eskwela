-- Read-only PREFLIGHT for m3_content_screen_v1_PROPOSED.sql. Changes nothing. Every PASS/FAIL row must say PASS.
-- Record the INFO rows; VERIFY must show the same fingerprints (no learning content, assignment, XP or reward changed).
SELECT 'not applied yet: no content_screen_findings, no content_screen trigger' AS check,
  CASE WHEN to_regprocedure('public.content_screen_findings(text)') IS NULL
        AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'content_screen' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'screened columns exist',
  CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (VALUES
    ('uploaded_materials', 'title'),
    ('uploaded_materials', 'content_text'),
    ('modules', 'title'),
    ('modules', 'passage'),
    ('module_passages', 'title'),
    ('module_passages', 'passage_text'),
    ('comprehension_questions', 'question_text'),
    ('comprehension_questions', 'options'),
    ('comprehension_questions', 'scaffolding_hint'),
    ('comprehension_question_answers', 'correct_answer'),
    ('comprehension_question_answers', 'answer_explanation'),
    ('comprehension_question_answers', 'supporting_evidence'),
    ('personal_material_question_sets', 'questions'))) = 13 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'assignment tables exist', CASE WHEN to_regclass('public.reading_activity_assignments') IS NOT NULL AND to_regclass('public.room_modules') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'sha256() available (PostgreSQL 11+)', CASE WHEN to_regprocedure('pg_catalog.sha256(bytea)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'learner content fingerprint (must equal VERIFY)', 'INFO',
  md5(concat_ws('|',
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.uploaded_materials x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.modules x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.module_passages x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.comprehension_questions x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.question_id), '')) FROM public.comprehension_question_answers x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.reading_activity_assignments x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.room_modules x)))
UNION ALL SELECT 'XP and rewards fingerprint (must equal VERIFY)', 'INFO',
  md5(coalesce((SELECT string_agg(x::text, ',' ORDER BY x.id) FROM public.m8_xp_events x), '') || '|' ||
      coalesce((SELECT string_agg(c::text, ',' ORDER BY c.user_id, c.badge_id) FROM public.m8_badge_claims c), ''));
