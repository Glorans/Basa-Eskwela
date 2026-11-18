-- ROLLBACK for m1_school_admin_invitations_PROPOSED.sql -- PROPOSED. NOT APPLIED. Run only with explicit approval.
--
-- Removes the role guard and the invitation functions. KEEPS both tables (authorization records and audit history),
-- still read-only for the backend and closed to browsers.
--
-- REFUSES to run while any invitation is pending (including one past its 7-day window): without the guard, a pending
-- invitee could choose a Student or Independent Learner role on Role Selection. Before running, resolve every pending
-- invitation in User Management > School Accounts > School Admin invitations:
--   * Cancel invitation (the account cannot sign in; terminal), or
--   * let the invitee accept it (they become a normal School Admin, kept after rollback).
-- Then deploy a backend that no longer calls the invitation functions (otherwise Create School Admin answers 503 and
-- makes no change). Accepted School Admins keep role 'admin'; cancelled accounts stay inactive and banned.
-- No profile, learning record or Auth user is changed.
begin;

do $$
declare v_pending integer;
begin
  select count(*) into v_pending from public.m1_school_admin_invitations where status = 'pending';
  if v_pending > 0 then
    raise exception 'STOP: % pending School Admin invitation(s). Cancel them (or let them be accepted) before rolling back.', v_pending;
  end if;
end $$;
drop trigger if exists m1_guard_school_admin_role on public.profiles;
drop function if exists public.m1_guard_school_admin_role();
drop function if exists public.m1_accept_school_admin_invitation(uuid, timestamptz);
drop function if exists public.m1_cancel_school_admin_invitation(uuid, uuid, text);
drop function if exists public.m1_record_school_admin_invitation_email(uuid, uuid, text, integer);
drop function if exists public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer);
drop function if exists public.m1_is_active_system_admin(uuid);
-- The history-protection triggers stay: the kept records remain append-only/undeletable.
commit;
-- Optional, separately approved (deletes the records): drop table public.m1_school_admin_invitation_events; drop table public.m1_school_admin_invitations;
