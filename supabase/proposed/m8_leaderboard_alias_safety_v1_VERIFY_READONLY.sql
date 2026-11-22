-- m8_leaderboard_alias_safety_v1 VERIFY (read-only). Every row must say PASS after the PROPOSED file is run.
-- The nickname checks only evaluate text; no row is read or written by them.
WITH cases(alias, expected) AS (VALUES
  -- accepted
  ('StarReader', NULL), ('Moon Reader', NULL), ('Bookworm22', NULL), ('Grape', NULL), ('Cassandra', NULL), ('BooBoo', NULL),
  ('Therapist', NULL), ('Kiki', NULL), ('Link', NULL), ('Angel', NULL), ('Mabait na Bata', NULL), ('Niño', NULL),
  -- format and numbers
  ('A', 'format'), ('9Lives', 'format'), ('Bad@Name', 'format'), ('ThisNicknameIsWayTooLong', 'format'),
  ('Reader12345', 'number'), ('Juan 0917 555', 'number'), ('Nico2010 11', 'number'),
  -- staff or system look-alikes
  ('Admin', 'reserved'), ('Reader X', 'reserved'), ('TheTeacher', 'reserved'), ('Moderator1', 'reserved'), ('BasaEskwela', 'reserved'),
  -- contact details
  ('nico.com', 'contact'), ('FB Nico', 'contact'), ('Gmail Nico', 'contact'), ('Insta Star', 'contact'), ('Tiktok Kid', 'contact'),
  -- words, including disguises
  ('Fuuuck', 'words'), ('F.u.c.k', 'words'), ('Sh1tHead', 'words'), ('Putangina', 'words'), ('Tang ina', 'words'),
  ('Gago', 'words'), ('Big Ass', 'words'), ('Tanga ka', 'words'), ('B0b0', 'words'), ('Gaaago', 'words'), ('Kill You', 'words'), ('Hitler', 'words')
), results AS (
  SELECT alias, expected, public.m8_leaderboard_alias_issue(alias) AS actual FROM cases
)
SELECT CASE WHEN actual IS NOT DISTINCT FROM expected THEN 'PASS' ELSE 'FAIL' END AS result,
  format('nickname %L -> %s (expected %s)', alias, coalesce(actual, 'accepted'), coalesce(expected, 'accepted')) AS check
FROM results
UNION ALL SELECT CASE WHEN public.m8_leaderboard_alias('Gago') IS NULL AND public.m8_leaderboard_alias('  Star   Reader ') = 'Star Reader' THEN 'PASS' ELSE 'FAIL' END,
  'display: refused nickname becomes null (Reader code), accepted one is tidied'
UNION ALL SELECT CASE WHEN NOT public.m8_leaderboard_alias_reveals_identity('StarReader', '00000000-0000-0000-0000-000000000000') THEN 'PASS' ELSE 'FAIL' END,
  'identity check: unknown account reveals nothing'
UNION ALL SELECT CASE WHEN NOT has_function_privilege('authenticated', 'public.m8_leaderboard_alias_issue(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.m8_leaderboard_alias_reveals_identity(text,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.m8_leaderboard_alias_issue(text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END,
  'helpers are not callable by learners or anonymous visitors'
UNION ALL SELECT CASE WHEN has_function_privilege('authenticated', 'public.m8_set_leaderboard_privacy(text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.m8_my_leaderboard_privacy()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END,
  'learners can still read and save their own choice'
UNION ALL SELECT 'INFO', 'switches (not changed by this migration): ' || coalesce((SELECT string_agg(audience || '=' || names_enabled, ', ' ORDER BY audience) FROM public.m8_leaderboard_settings), 'none');
