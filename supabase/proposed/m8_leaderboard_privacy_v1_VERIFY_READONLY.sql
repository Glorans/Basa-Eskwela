-- Read-only VERIFY after m8_leaderboard_privacy_v1_PROPOSED.sql. Every PASS/FAIL row must say PASS; the
-- fingerprints must equal the PREFLIGHT values (no XP, reward or profile row changed).
SELECT 'both names switches OFF (no approval recorded yet)' AS check,
  CASE WHEN (SELECT count(*) FROM public.m8_leaderboard_settings WHERE NOT names_enabled AND audience IN ('classroom','independent')) = 2
        AND (SELECT count(*) FROM public.m8_leaderboard_settings) = 2 THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'no choice made for anyone: no saved leaderboard choices',
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.m8_leaderboard_privacy) THEN 'PASS' ELSE 'FAIL' END, (SELECT count(*)::text FROM public.m8_leaderboard_privacy)
UNION ALL SELECT 'tables: RLS on, no client table privileges',
  CASE WHEN (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.m8_leaderboard_privacy'::regclass, 'public.m8_leaderboard_settings'::regclass))
        AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public'
          AND table_name IN ('m8_leaderboard_privacy','m8_leaderboard_settings') AND grantee IN ('anon','authenticated','PUBLIC')) THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'learner functions: authenticated only, not anon',
  CASE WHEN has_function_privilege('authenticated', 'public.m8_my_leaderboard_privacy()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.m8_set_leaderboard_privacy(text,text)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.m8_independent_rankings(text,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.m8_my_leaderboard_privacy()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.m8_set_leaderboard_privacy(text,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.m8_independent_rankings(text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'internal helpers not executable by clients',
  CASE WHEN NOT has_function_privilege('authenticated', 'public.m8_leaderboard_alias(text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.m8_leaderboard_names_enabled(text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'rankings: Students only / hidden left out / names only behind the switch',
  CASE WHEN position('Student access required' in pg_get_functiondef('public.m8_classroom_rankings(uuid,text)'::regprocedure)) > 0
        AND position('<> ''hidden''' in pg_get_functiondef('public.m8_classroom_rankings(uuid,text)'::regprocedure)) > 0
        AND position('m8_leaderboard_names_enabled(''classroom'')' in pg_get_functiondef('public.m8_classroom_rankings(uuid,text)'::regprocedure)) > 0
        AND position('m8_classroom_display_name(p.nickname) end safe' in pg_get_functiondef('public.m8_classroom_rankings(uuid,text)'::regprocedure)) > 0
        AND position('<> ''hidden''' in pg_get_functiondef('public.m8_independent_rankings(text,text)'::regprocedure)) > 0
        AND position('m8_leaderboard_names_enabled(''independent'')' in pg_get_functiondef('public.m8_independent_rankings(text,text)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'ranking columns unchanged',
  CASE WHEN pg_get_function_result('public.m8_classroom_rankings(uuid,text)'::regprocedure) = 'TABLE(entry_id text, display_name text, xp bigint, is_me boolean)'
        AND pg_get_function_result('public.m8_independent_rankings(text,text)'::regprocedure) = 'TABLE(entry_id text, display_name text, xp bigint, is_me boolean)' THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'claims fingerprint (must equal PREFLIGHT)', 'INFO',
  md5(coalesce((SELECT string_agg(c::text, ',' ORDER BY c.user_id, c.badge_id) FROM public.m8_badge_claims c), '') || '|' ||
      coalesce((SELECT string_agg(a::text, ',' ORDER BY a.user_id, a.achievement_id, a.tier) FROM public.m8_achievement_claims a), ''))
UNION ALL SELECT 'earned badges and XP fingerprint (must equal PREFLIGHT)', 'INFO',
  md5(coalesce((SELECT string_agg(e::text, ',' ORDER BY e.user_id, e.badge_id) FROM public.m8_earned_badges e), '') || '|' ||
      coalesce((SELECT string_agg(x::text, ',' ORDER BY x.id) FROM public.m8_xp_events x), ''))
UNION ALL SELECT 'profiles fingerprint (must equal PREFLIGHT)', 'INFO',
  md5(coalesce((SELECT string_agg(p::text, ',' ORDER BY p.id) FROM public.profiles p), ''));
