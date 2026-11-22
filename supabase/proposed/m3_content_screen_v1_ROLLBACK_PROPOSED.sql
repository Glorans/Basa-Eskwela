-- ROLLBACK for m3_content_screen_v1_PROPOSED.sql.                                        PROPOSED - NOT APPLIED TO STAGING
-- Removes the content-screen triggers and functions. No data is changed.

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.content_screen_findings(text)') IS NULL THEN
    RAISE EXCEPTION 'M3 content screen is not applied; nothing was changed';
  END IF;
END $guard$;

DROP TRIGGER content_screen ON public.uploaded_materials;
DROP TRIGGER content_screen ON public.modules;
DROP TRIGGER content_screen ON public.module_passages;
DROP TRIGGER content_screen ON public.comprehension_questions;
DROP TRIGGER content_screen ON public.comprehension_question_answers;
DROP TRIGGER content_screen ON public.personal_material_question_sets;
DROP TRIGGER content_screen ON public.reading_activity_assignments;
DROP TRIGGER content_screen ON public.room_modules;
DROP FUNCTION public.content_screen_module_assignment();
DROP FUNCTION public.content_screen_material_assignment();
DROP FUNCTION public.content_screen_personal_questions();
DROP FUNCTION public.content_screen_answer();
DROP FUNCTION public.content_screen_question();
DROP FUNCTION public.content_screen_module_passage();
DROP FUNCTION public.content_screen_module();
DROP FUNCTION public.content_screen_uploaded_material();
DROP FUNCTION public.content_screen_module_parts(uuid);
DROP FUNCTION public.content_screen_assert(text,text,text[],text[]);
DROP FUNCTION public.content_screen_jsonb_text(jsonb);
DROP FUNCTION public.content_screen_findings(text);

COMMIT;
