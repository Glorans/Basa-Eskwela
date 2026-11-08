-- READ ONLY. Before and after m8_f4_classroom_names_v1_PROPOSED.sql. Selects catalog facts and counts only.
begin transaction read only;
-- 1. Before: f4_installed true, names_installed false, rankings_is_f4 true. After: true, true, false.
select to_regprocedure('public.m8_classroom_rankings(uuid,text)') is not null as f4_installed,
   to_regprocedure('public.m8_classroom_display_name(text)') is not null as names_installed,
   (select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.m8_classroom_rankings(uuid,text)'::regprocedure) = '6c25e753256b68938ffa367f034156b0' as rankings_is_f4;
-- 2. Client access: rankings for authenticated only; the three older leaderboards closed. Expect true, false, false.
select has_function_privilege('authenticated', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE') as rankings_open,
   has_function_privilege('anon', 'public.m8_classroom_rankings(uuid,text)', 'EXECUTE') as rankings_anon,
   has_function_privilege('authenticated', 'public.m8_classroom_leaderboard(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.m8_independent_leaderboard(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.m8_weekly_leaderboard()', 'EXECUTE') as legacy_open;
-- 3. How many enrolled Students would show a name rather than a pseudonym (counts only; no names).
select count(*) as enrolled_students,
   count(*) filter (where nullif(btrim(coalesce(p.nickname, '')), '') is not null) as with_nickname
from (select distinct e.student_id from public.enrollments e) s join public.profiles p on p.id = s.student_id and p.role = 'student';
rollback;
