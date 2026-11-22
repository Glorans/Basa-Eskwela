-- Read-only VERIFY after m8_final_corrections_v1_PROPOSED.sql. Every PASS/FAIL row must say PASS; the two
-- fingerprints must equal the PREFLIGHT values (no claim, earned badge or XP row changed).
SELECT 'retired: graduate, diamond, level_up only' AS check,
  CASE WHEN (SELECT string_agg(id, ',' ORDER BY id) FROM public.m8_badges WHERE retired_at IS NOT NULL) = 'diamond,graduate,level_up' THEN 'PASS' ELSE 'FAIL' END AS result,
  (SELECT string_agg(id, ',' ORDER BY id) FROM public.m8_badges WHERE retired_at IS NOT NULL) AS detail
UNION ALL SELECT 'all eight badge rows kept', CASE WHEN (SELECT count(*) FROM public.m8_badges) >= 8 THEN 'PASS' ELSE 'FAIL' END, (SELECT count(*)::text FROM public.m8_badges)
UNION ALL SELECT 'retired-badge trigger enabled, not executable by clients',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.m8_earned_badges'::regclass AND tgname = 'm8_skip_retired_badge' AND tgenabled = 'O')
        AND NOT has_function_privilege('authenticated', 'public.m8_skip_retired_badge()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'retired badges: only an unlock recorded before retirement; Bookworm at 3',
  CASE WHEN position('e.earned_at < b.retired_at' in pg_get_functiondef('public.m8_badge_eligible(uuid,text)'::regprocedure)) > 0
        AND position('>= 3' in pg_get_functiondef('public.m8_badge_eligible(uuid,text)'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'm8_my_badges returns retired; executable by authenticated only',
  CASE WHEN pg_get_function_result('public.m8_my_badges()'::regprocedure) LIKE '%retired boolean%'
        AND has_function_privilege('authenticated', 'public.m8_my_badges()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.m8_my_badges()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'achievement tiers 1 / 2 / 3',
  CASE WHEN position('where t.n = 1)' in pg_get_functiondef('public.m8_my_achievements()'::regprocedure)) > 0
        AND position('where t.n = 2)' in pg_get_functiondef('public.m8_my_achievements()'::regprocedure)) > 0
        AND position('where t.n = 3)' in pg_get_functiondef('public.m8_my_achievements()'::regprocedure)) > 0
        AND position('t.n = 10' in pg_get_functiondef('public.m8_my_achievements()'::regprocedure)) = 0
        AND position('t.n = 25' in pg_get_functiondef('public.m8_my_achievements()'::regprocedure)) = 0 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'achievements count only published modules and Teacher-assigned materials',
  CASE WHEN position('o.module_id is not null or o.activity_assignment_id is not null' in pg_get_functiondef('public.m8_my_achievements()'::regprocedure)) > 0
        AND position('a.module_id is not null or a.activity_assignment_id is not null' in pg_get_functiondef('public.m8_my_achievements()'::regprocedure)) > 0 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'claims recheck eligibility and refuse with 409 (PT409)',
  CASE WHEN position('m8_badge_eligible(v_me, p_badge_id)' in pg_get_functiondef('public.m8_claim_badge(text)'::regprocedure)) > 0
        AND position('PT409' in pg_get_functiondef('public.m8_claim_badge(text)'::regprocedure)) > 0
        AND position('PT409' in pg_get_functiondef('public.m8_claim_achievement(text,text)'::regprocedure)) > 0
        AND has_function_privilege('authenticated', 'public.m8_claim_badge(text)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.m8_claim_achievement(text,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'claims fingerprint (must equal PREFLIGHT)', 'INFO',
  md5(coalesce((SELECT string_agg(c::text, ',' ORDER BY c.user_id, c.badge_id) FROM public.m8_badge_claims c), '') || '|' ||
      coalesce((SELECT string_agg(a::text, ',' ORDER BY a.user_id, a.achievement_id, a.tier) FROM public.m8_achievement_claims a), ''))
UNION ALL SELECT 'earned badges and XP fingerprint (must equal PREFLIGHT)', 'INFO',
  md5(coalesce((SELECT string_agg(e::text, ',' ORDER BY e.user_id, e.badge_id) FROM public.m8_earned_badges e), '') || '|' ||
      coalesce((SELECT string_agg(x::text, ',' ORDER BY x.id) FROM public.m8_xp_events x), ''));
