-- Run AFTER 20261019-20261022 M8 migrations. Uses trusted profiles.role.
BEGIN;
CREATE OR REPLACE FUNCTION public.m8_independent_leaderboard(p_period text DEFAULT 'weekly')
RETURNS TABLE(user_id uuid, display_name text, xp bigint, difficulty text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.role='general_user'
 ) THEN RAISE EXCEPTION 'Independent learner access required' USING ERRCODE='42501'; END IF;
 IF p_period NOT IN ('weekly','all_time') THEN RAISE EXCEPTION 'Invalid period'; END IF;
 RETURN QUERY
 WITH scores AS (
  SELECT x.user_id, SUM(x.xp_earned)::bigint AS points
  FROM public.m8_xp_events x
  WHERE p_period='all_time' OR x.created_at >=
   (date_trunc('week', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')
  GROUP BY x.user_id
 )
 SELECT p.id, COALESCE(NULLIF(p.nickname,''), 'Reader ' || LEFT(p.id::text,6))::text,
        COALESCE(s.points,0)::bigint,
        COALESCE(g.unlocked_difficulty,'Easy')::text
 FROM public.profiles p
 LEFT JOIN scores s ON s.user_id=p.id
 LEFT JOIN public.m8_learner_progress g ON g.user_id=p.id
 WHERE p.role='general_user'
 ORDER BY COALESCE(s.points,0) DESC, p.id
 LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.m8_independent_leaderboard(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.m8_independent_leaderboard(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
