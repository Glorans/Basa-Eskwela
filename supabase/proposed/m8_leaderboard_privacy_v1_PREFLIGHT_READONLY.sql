-- Read-only PREFLIGHT for m8_leaderboard_privacy_v1_PROPOSED.sql. Changes nothing. Every PASS/FAIL row must say PASS.
-- Record the INFO rows; VERIFY must show the same fingerprints (no XP, reward or profile row changed).
SELECT 'reviewed m8_classroom_rankings' AS check,
  CASE WHEN md5(replace(pg_get_functiondef('public.m8_classroom_rankings(uuid,text)'::regprocedure), chr(13), '')) = 'ed940ae2f9ddd05e7e8f82b7d262c7d9' THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'reviewed m8_independent_rankings',
  CASE WHEN md5(replace(pg_get_functiondef('public.m8_independent_rankings(text,text)'::regprocedure), chr(13), '')) = '6bc40aa0576a2f2b27e83c440a083e1e' THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'm8_classroom_display_name present (classroom names v1 applied)',
  CASE WHEN to_regprocedure('public.m8_classroom_display_name(text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'not applied yet: no privacy or settings table',
  CASE WHEN to_regclass('public.m8_leaderboard_privacy') IS NULL AND to_regclass('public.m8_leaderboard_settings') IS NULL THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'Students / Independent Learners', 'INFO',
  (SELECT count(*) FILTER (WHERE role = 'student') || ' / ' || count(*) FILTER (WHERE role = 'general_user') FROM public.profiles)
UNION ALL SELECT 'claims fingerprint (must equal VERIFY)', 'INFO',
  md5(coalesce((SELECT string_agg(c::text, ',' ORDER BY c.user_id, c.badge_id) FROM public.m8_badge_claims c), '') || '|' ||
      coalesce((SELECT string_agg(a::text, ',' ORDER BY a.user_id, a.achievement_id, a.tier) FROM public.m8_achievement_claims a), ''))
UNION ALL SELECT 'earned badges and XP fingerprint (must equal VERIFY)', 'INFO',
  md5(coalesce((SELECT string_agg(e::text, ',' ORDER BY e.user_id, e.badge_id) FROM public.m8_earned_badges e), '') || '|' ||
      coalesce((SELECT string_agg(x::text, ',' ORDER BY x.id) FROM public.m8_xp_events x), ''))
UNION ALL SELECT 'profiles fingerprint (must equal VERIFY)', 'INFO',
  md5(coalesce((SELECT string_agg(p::text, ',' ORDER BY p.id) FROM public.profiles p), ''));
