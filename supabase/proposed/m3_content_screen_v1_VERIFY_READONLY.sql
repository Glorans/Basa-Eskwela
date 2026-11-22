-- Read-only VERIFY after m3_content_screen_v1_PROPOSED.sql. Every PASS/FAIL row must say PASS; the fingerprints must
-- equal the PREFLIGHT values (no learning content, assignment, XP or reward changed).
SELECT 'content_screen triggers enabled on the 8 learner-content tables' AS check,
  CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname = 'content_screen' AND tgenabled = 'O' AND tgrelid IN (
    'public.uploaded_materials'::regclass, 'public.modules'::regclass, 'public.module_passages'::regclass, 'public.comprehension_questions'::regclass, 'public.comprehension_question_answers'::regclass, 'public.personal_material_question_sets'::regclass, 'public.reading_activity_assignments'::regclass, 'public.room_modules'::regclass)) = 8 THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'trigger and helper functions not executable by clients',
  CASE WHEN NOT EXISTS (SELECT 1 FROM unnest(array['public.content_screen_jsonb_text(jsonb)', 'public.content_screen_assert(text,text,text[],text[])', 'public.content_screen_module_parts(uuid)', 'public.content_screen_uploaded_material()', 'public.content_screen_module()', 'public.content_screen_module_passage()', 'public.content_screen_question()', 'public.content_screen_answer()', 'public.content_screen_personal_questions()', 'public.content_screen_material_assignment()', 'public.content_screen_module_assignment()']) f
        WHERE has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') OR has_function_privilege('anon', f::regprocedure, 'EXECUTE'))
        THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'content_screen_findings: signed-in users only (not anon)',
  CASE WHEN has_function_privilege('authenticated', 'public.content_screen_findings(text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.content_screen_findings(text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'ordinary story passes; mocked categories are flagged (no inappropriate words used)',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.content_screen_findings('Maya and Leo read about whales at the library. Si Ana ay nagbasa ng aklat.'))
        AND (SELECT string_agg(category, ',' ORDER BY category) FROM public.content_screen_findings(E'Call 0917 000 0000.\nVisit http://example.com today.'))
            = 'personal_information,web_link'
        AND NOT EXISTS (SELECT 1 FROM public.content_screen_findings('Read more at www.deped.gov.ph.')) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'learner content fingerprint (must equal PREFLIGHT)', 'INFO',
  md5(concat_ws('|',
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.uploaded_materials x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.modules x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.module_passages x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.comprehension_questions x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.question_id), '')) FROM public.comprehension_question_answers x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.reading_activity_assignments x),
    (SELECT md5(coalesce(string_agg(x::text, ',' ORDER BY x.id), '')) FROM public.room_modules x)))
UNION ALL SELECT 'XP and rewards fingerprint (must equal PREFLIGHT)', 'INFO',
  md5(coalesce((SELECT string_agg(x::text, ',' ORDER BY x.id) FROM public.m8_xp_events x), '') || '|' ||
      coalesce((SELECT string_agg(c::text, ',' ORDER BY c.user_id, c.badge_id) FROM public.m8_badge_claims c), ''));
