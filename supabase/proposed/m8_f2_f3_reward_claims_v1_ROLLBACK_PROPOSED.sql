-- ============================================================================
-- PROPOSED ROLLBACK - NOT APPLIED. Do not run without explicit approval.
-- Removes M8 reward claiming (m8_f2_f3_reward_claims_v1_PROPOSED.sql).
-- ============================================================================
-- It refuses once any learner has claimed a badge or an achievement: dropping the tables would delete
-- those learners' claims. Badges copied in by the migration (preserved = true) are still in
-- m8_earned_badges, which this file does not touch, so removing their copies loses nothing.
-- Earned badges, XP, reading days and progress are never touched. The frontend falls back to showing
-- every unlocked badge as earned, as it did before claiming.
-- ============================================================================
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.m8_badge_claims') is null then
    raise exception 'Stop: reward claiming is not installed.';
  end if;
  if exists (select 1 from public.m8_badge_claims where not preserved)
    or exists (select 1 from public.m8_achievement_claims) then
    raise exception 'Stop: learners have claimed rewards; rolling back would delete their claims.';
  end if;
end $$;

drop function public.m8_claim_achievement(text,text);
drop function public.m8_my_achievement_claims();
drop function public.m8_claim_badge(text);
drop function public.m8_my_badges();
drop function public.m8_badge_eligible(uuid,text);
drop table public.m8_achievement_claims;
drop table public.m8_badge_claims;

notify pgrst, 'reload schema';
commit;
