-- ROLLBACK for m1_account_deactivation_PROPOSED.sql -- PROPOSED. NOT APPLIED. Run only with explicit approval.
--
-- Before running: REACTIVATE every deactivated account through User Management (that also lifts its Auth ban).
-- The Auth ban lives in Supabase Auth, not in this database, so this script refuses to run while any profile is
-- 'inactive': otherwise those people would stay unable to sign in with no way to reactivate them in the app.
--
-- Removes: the pre-request check, the storage policy, the three functions and the status CHECK constraint.
-- Keeps: public.m1_account_status_events (audit history). Drop it separately only if the history is not needed.
-- Learning records, profiles and Auth users are not touched.
begin;

do $$
begin
  if exists (select 1 from public.profiles where status = 'inactive') then
    raise exception 'STOP: reactivate every deactivated account before rolling back';
  end if;
end $$;

alter role authenticator reset pgrst.db_pre_request;
drop policy if exists "M1 active account required" on storage.objects;
drop function if exists public.m1_reject_deactivated_request();
drop function if exists public.m1_account_active();
drop function if exists public.m1_set_account_status(uuid, uuid, text);
alter table public.profiles drop constraint if exists profiles_status_check;

notify pgrst, 'reload config';
commit;

-- Optional, separately approved: drop table public.m1_account_status_events;
