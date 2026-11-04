-- PROPOSAL ONLY. NOT APPLIED. Rollback for m4_admin_classroom_actions_PROPOSED.sql.
-- Removes the Admin RPCs (the Admin page hides Remove again). Removed enrollments are not restored.
-- The audit table m4_admin_actions is KEPT as the record of past Admin removals; drop it separately
-- (commented below) only if that record is no longer needed.
begin;
set local lock_timeout = '5s';
drop function public.m4_admin_classroom_actions();
drop function public.m4_admin_remove_enrollment(uuid);
-- drop table public.m4_admin_actions;
notify pgrst, 'reload schema';
commit;
