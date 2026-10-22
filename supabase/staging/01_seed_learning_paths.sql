-- STAGING ONLY. Not yet executed. Synthetic catalogue data; no users or learner records.
-- The app has no learning-path editor, so modules need these rows before Admins can create content.
-- Apply after the full M1–M6 chain (see docs/STAGING_DATABASE_SETUP_PLAN.md). Re-runnable.
begin;
insert into public.learning_paths (path_name, language, reading_level, difficulty_tier, description)
select v.path_name, v.language, v.reading_level, v.difficulty_tier, v.description
from (values
  ('English Foundations', 'English', 'Frustration', 'Easy', 'Supported English reading.'),
  ('English Growing Readers', 'English', 'Instructional', 'Medium', 'Guided English reading.'),
  ('English Independent Readers', 'English', 'Independent', 'Hard', 'Independent English reading.'),
  ('Filipino Panimulang Pagbasa', 'Filipino', 'Frustration', 'Easy', 'Gabay na pagbasa sa Filipino.'),
  ('Filipino Umuunlad na Mambabasa', 'Filipino', 'Instructional', 'Medium', 'Ginagabayang pagbasa sa Filipino.'),
  ('Filipino Malayang Mambabasa', 'Filipino', 'Independent', 'Hard', 'Malayang pagbasa sa Filipino.')
) as v(path_name, language, reading_level, difficulty_tier, description)
where not exists (select 1 from public.learning_paths p where p.path_name = v.path_name);
commit;
