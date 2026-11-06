-- PROPOSED - NOT APPLIED. Rollback of m8_f3_achievements_v1_PROPOSED.sql. It stores nothing, so nothing is lost.
begin;
drop function public.m8_my_achievements();
notify pgrst, 'reload schema';
commit;
