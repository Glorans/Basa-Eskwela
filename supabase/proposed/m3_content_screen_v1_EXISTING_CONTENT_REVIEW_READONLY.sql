-- Read-only review of EXISTING learner-facing content with the installed screen (run after the PROPOSED migration).
-- Prints only table, row id and category: never the text. Nothing is changed, hidden or deleted; a person reviews each row.
SELECT 'uploaded_materials' AS table_name, m.id::text AS row_id, f.category, f.paragraph
  FROM public.uploaded_materials m, public.content_screen_findings(coalesce(m.title, '') || E'\n' || coalesce(m.content_text, '')) f
UNION ALL SELECT 'modules', m.id::text, f.category, f.paragraph
  FROM public.modules m, public.content_screen_findings(coalesce(m.title, '') || E'\n' || coalesce(m.passage, '')) f WHERE m.deleted_at IS NULL
UNION ALL SELECT 'module_passages', p.id::text, f.category, f.paragraph
  FROM public.module_passages p, public.content_screen_findings(coalesce(p.title, '') || E'\n' || coalesce(p.passage_text, '')) f
UNION ALL SELECT 'comprehension_questions', q.id::text, f.category, f.paragraph
  FROM public.comprehension_questions q, public.content_screen_findings(coalesce(q.question_text, '') || E'\n'
    || coalesce(public.content_screen_jsonb_text(q.options), '') || E'\n' || coalesce(q.scaffolding_hint, '')) f
UNION ALL SELECT 'comprehension_question_answers', a.question_id::text, f.category, f.paragraph
  FROM public.comprehension_question_answers a, public.content_screen_findings(coalesce(a.correct_answer, '') || E'\n'
    || coalesce(a.answer_explanation, '') || E'\n' || coalesce(a.supporting_evidence, '')) f
UNION ALL SELECT 'personal_material_question_sets', s.id::text, f.category, f.paragraph
  FROM public.personal_material_question_sets s, public.content_screen_findings(public.content_screen_jsonb_text(s.questions)) f
ORDER BY 1, 3, 2;
