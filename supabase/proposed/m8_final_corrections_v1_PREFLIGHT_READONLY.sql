-- Read-only PREFLIGHT for m8_final_corrections_v1_PROPOSED.sql. Changes nothing. Every PASS/FAIL row must say PASS.
-- Record the INFO rows; VERIFY must show the same claim and XP fingerprints.
SELECT 'reviewed m8_badge_eligible' AS check,
  CASE WHEN md5(replace(pg_get_functiondef('public.m8_badge_eligible(uuid,text)'::regprocedure), chr(13), '')) = '41fa600a881cdf76985d45a76cd1bb25' THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'reviewed m8_my_badges',
  CASE WHEN md5(replace(pg_get_functiondef('public.m8_my_badges()'::regprocedure), chr(13), '')) = '3ab0866dc43b6ce0772f042b2e2f667b' THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'reviewed m8_my_achievements',
  CASE WHEN md5(replace(pg_get_functiondef('public.m8_my_achievements()'::regprocedure), chr(13), '')) = '3d6433fb4df8339989802f67fc0299d5' THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'reviewed m8_claim_badge (rechecks eligibility)',
  CASE WHEN md5(replace(pg_get_functiondef('public.m8_claim_badge(text)'::regprocedure), chr(13), '')) = 'dc391554937e751cc980a88f23068473' THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'reviewed m8_claim_achievement',
  CASE WHEN md5(replace(pg_get_functiondef('public.m8_claim_achievement(text,text)'::regprocedure), chr(13), '')) = '4e548fc45ad688c24a806cfef83da158' THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'not applied yet: no m8_badges.retired_at, no retired-badge trigger',
  CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'm8_badges' AND column_name = 'retired_at')
        AND to_regprocedure('public.m8_skip_retired_badge()') IS NULL THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'the eight badges exist (none deleted)',
  CASE WHEN (SELECT count(*) FROM public.m8_badges WHERE id IN ('first_read','bookworm','brave_reader','consistent_reader','streak_3','graduate','diamond','level_up')) = 8 THEN 'PASS' ELSE 'FAIL' END,
  (SELECT count(*)::text FROM public.m8_badges)
UNION ALL SELECT 'badge claims by badge', 'INFO', coalesce((SELECT string_agg(badge_id || '=' || n, ', ' ORDER BY badge_id) FROM (SELECT badge_id, count(*) n FROM public.m8_badge_claims GROUP BY 1) x), 'none')
UNION ALL SELECT 'retired badges unlocked but not claimed (remain claimable once as past badges)', 'INFO',
  coalesce((SELECT string_agg(badge_id || '=' || n, ', ' ORDER BY badge_id) FROM (SELECT e.badge_id, count(*) n FROM public.m8_earned_badges e
    WHERE e.badge_id IN ('graduate','diamond','level_up') AND NOT EXISTS (SELECT 1 FROM public.m8_badge_claims c WHERE c.user_id = e.user_id AND c.badge_id = e.badge_id) GROUP BY 1) x), 'none')
UNION ALL SELECT 'achievement claims', 'INFO', (SELECT count(*)::text FROM public.m8_achievement_claims)
UNION ALL SELECT 'claims fingerprint (must equal VERIFY)', 'INFO',
  md5(coalesce((SELECT string_agg(c::text, ',' ORDER BY c.user_id, c.badge_id) FROM public.m8_badge_claims c), '') || '|' ||
      coalesce((SELECT string_agg(a::text, ',' ORDER BY a.user_id, a.achievement_id, a.tier) FROM public.m8_achievement_claims a), ''))
UNION ALL SELECT 'earned badges and XP fingerprint (must equal VERIFY)', 'INFO',
  md5(coalesce((SELECT string_agg(e::text, ',' ORDER BY e.user_id, e.badge_id) FROM public.m8_earned_badges e), '') || '|' ||
      coalesce((SELECT string_agg(x::text, ',' ORDER BY x.id) FROM public.m8_xp_events x), ''));
