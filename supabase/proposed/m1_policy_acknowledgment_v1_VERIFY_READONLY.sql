-- Read-only VERIFY after m1_policy_acknowledgment_v1_PROPOSED.sql. Every PASS/FAIL row must say PASS; the profiles
-- fingerprint must equal PREFLIGHT.
SELECT 'only the draft registered; NO version active (nobody is asked yet)' AS check,
  CASE WHEN (SELECT string_agg(version || ':' || status || ':' || is_active, ',') FROM public.m1_policy_versions) = '2026-11-draft-1:draft:false'
       THEN 'PASS' ELSE 'FAIL' END AS result, '' AS detail
UNION ALL SELECT 'no acknowledgment recorded for anyone', CASE WHEN NOT EXISTS (SELECT 1 FROM public.m1_policy_acknowledgments) THEN 'PASS' ELSE 'FAIL' END,
  (SELECT count(*)::text FROM public.m1_policy_acknowledgments)
UNION ALL SELECT 'RLS on both tables; versions not client-visible; acknowledgments read-own only',
  CASE WHEN (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.m1_policy_versions'::regclass, 'public.m1_policy_acknowledgments'::regclass))
        AND NOT has_table_privilege('authenticated', 'public.m1_policy_versions', 'SELECT')
        AND has_table_privilege('authenticated', 'public.m1_policy_acknowledgments', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'public.m1_policy_acknowledgments', 'INSERT')
        AND NOT has_table_privilege('authenticated', 'public.m1_policy_acknowledgments', 'UPDATE')
        AND NOT has_table_privilege('anon', 'public.m1_policy_acknowledgments', 'SELECT')
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'm1_policy_acknowledgments') = 1 THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'acknowledgments cannot be changed (immutable trigger enabled)',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'm1_policy_ack_immutable' AND tgenabled = 'O') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'functions: signed-in users only',
  CASE WHEN has_function_privilege('authenticated', 'public.m1_my_policy_status()', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.m1_acknowledge_policy(text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.m1_my_policy_status()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.m1_acknowledge_policy(text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.m1_policy_ack_immutable()', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL SELECT 'profiles fingerprint (must equal PREFLIGHT)', 'INFO', md5(coalesce((SELECT string_agg(p::text, ',' ORDER BY p.id) FROM public.profiles p), ''));
