-- Read-only PREFLIGHT for m1_policy_acknowledgment_v1_PROPOSED.sql. Changes nothing. Every PASS/FAIL row must say PASS.
SELECT 'not installed yet: no policy tables or functions' AS check,
  CASE WHEN to_regclass('public.m1_policy_acknowledgments') IS NULL AND to_regclass('public.m1_policy_versions') IS NULL
        AND to_regprocedure('public.m1_acknowledge_policy(text)') IS NULL AND to_regprocedure('public.m1_my_policy_status()') IS NULL
       THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'auth.users available for the acknowledgment foreign key', CASE WHEN to_regclass('auth.users') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'accounts by role (nobody will be marked as agreed)', 'INFO',
  (SELECT string_agg(coalesce(role, '(none)') || '=' || n, ', ' ORDER BY role) FROM (SELECT role, count(*) n FROM public.profiles GROUP BY role) x)
UNION ALL SELECT 'profiles fingerprint (must equal VERIFY)', 'INFO', md5(coalesce((SELECT string_agg(p::text, ',' ORDER BY p.id) FROM public.profiles p), ''));
