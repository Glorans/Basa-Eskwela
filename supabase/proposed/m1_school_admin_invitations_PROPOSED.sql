-- M1 School Admin authorization record + invitation lifecycle -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Requires m1_account_deactivation (applied to ReadFlow-Staging 2026-11-18).
--
-- Lifecycle
--   1. Authorized : a System Admin records the authorization decision (basis, confirmation method, who, when).
--   2. Pending    : the Auth user exists, but profiles.role stays NULL, so no backend route, RLS policy, RPC or
--                   storage policy gives it any School Admin access (they all check profiles.role).
--   3. Accepted   : the invitee opens the emailed setup link, sets a password, and the backend calls
--                   m1_accept_school_admin_invitation in that same link session. Only this function can set the role.
--   4. Active     : profiles.role = 'admin'. Deactivate/Reactivate (m1_set_account_status) applies as before.
--   5. Cancelled  : terminal. The profile is set inactive and the backend bans the Auth user, so Forgot Password
--                   cannot revive it. Expired invitations cannot be accepted; a System Admin may resend (re-authorize).
--
-- Guarantees enforced in the DATABASE (not only the app)
--   * m1_guard_school_admin_role: profiles.role can become 'admin', or change at all on an invited account, only
--     inside m1_accept_school_admin_invitation. Self-service role selection, Teacher invite registration, backend
--     code and manual SQL cannot create or promote a School Admin.
--   * One invitation per account (unique user_id); one pending invitation per email address.
--   * Acceptance needs: pending, not expired, a link session issued after the latest send, a password set, the
--     email confirmed, the same email as invited, not banned, and the profile still role-less and active.
--   * Records and events: no access for anon/authenticated (RLS on, no policies, no grants). The backend's service
--     role may only READ them; every write goes through the SECURITY DEFINER functions below (direct INSERT/UPDATE/
--     DELETE are revoked). Events are append-only and records cannot be deleted, enforced by triggers.
--   * Trust boundary: the database owner (postgres / supabase_admin, e.g. the SQL Editor) and a holder of the service
--     role key remain trusted. The owner can alter these objects; the service role can call the functions.
--
-- Existing accounts: no rows are created for existing School Admins (no invented approvers or dates); their role,
-- status and permissions are untouched. The trigger only acts when a role CHANGES.
-- Rollback: m1_school_admin_invitations_ROLLBACK_PROPOSED.sql
begin;

do $$
begin
  if to_regprocedure('public.m1_set_account_status(uuid,uuid,text)') is null
     or to_regclass('public.m1_account_status_events') is null then
    raise exception 'STOP: m1_account_deactivation must be installed first';
  end if;
  if to_regclass('public.m1_school_admin_invitations') is not null
     or to_regclass('public.m1_school_admin_invitation_events') is not null
     or to_regprocedure('public.m1_accept_school_admin_invitation(uuid,timestamptz)') is not null
     or exists (select 1 from pg_trigger where tgname = 'm1_guard_school_admin_role') then
    raise exception 'STOP: M1 School Admin invitations already (partly) installed';
  end if;
end $$;

-- 1. Authorization record and invitation state (one row per invited account).
create table public.m1_school_admin_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 320),
  authorized_by uuid not null,
  authorized_at timestamptz not null default now(),
  -- The System Admin's recorded decision. This is NOT verification of identity or school affiliation.
  authorization_reference text not null check (length(btrim(authorization_reference)) between 5 and 300),
  confirmation_method text not null check (confirmation_method in
    ('official_school_email', 'official_school_phone', 'signed_letter', 'in_person', 'other_documented')),
  authorizing_position text not null check (length(btrim(authorizing_position)) between 2 and 100),
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  last_sent_at timestamptz,
  send_count integer not null default 0 check (send_count >= 0),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null and cancelled_by is not null))
);
create unique index m1_school_admin_invitations_one_pending_email on public.m1_school_admin_invitations (email) where status = 'pending';
alter table public.m1_school_admin_invitations enable row level security;
revoke all on table public.m1_school_admin_invitations from public, anon, authenticated;
-- The backend reads records (account list, own invitation state); it never writes them directly.
revoke insert, update, delete, truncate, references, trigger on table public.m1_school_admin_invitations from service_role;

-- 2. Append-only audit of the invitation lifecycle (Deactivate/Reactivate stay in m1_account_status_events).
create table public.m1_school_admin_invitation_events (
  id bigint generated always as identity primary key, -- increasing: a reliable order even within one transaction
  invitation_id uuid not null references public.m1_school_admin_invitations (id),
  target_id uuid not null,
  actor_id uuid,
  action text not null check (action in ('authorized', 'invitation_sent', 'invitation_resent', 'invitation_send_failed',
                                         'accepted', 'role_activated', 'cancelled')),
  acted_at timestamptz not null default now()
);
create index m1_school_admin_invitation_events_inv on public.m1_school_admin_invitation_events (invitation_id, acted_at);
alter table public.m1_school_admin_invitation_events enable row level security;
revoke all on table public.m1_school_admin_invitation_events from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.m1_school_admin_invitation_events from service_role;
do $$ begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role',
    pg_get_serial_sequence('public.m1_school_admin_invitation_events', 'id'));
end $$;

-- History protection: events are append-only; authorization records are never deleted (only their state changes,
-- and only through the functions below).
create function public.m1_school_admin_history_protect()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'School Admin authorization history cannot be changed or removed' using errcode = '42501';
end $$;
create trigger m1_school_admin_events_append_only before update or delete on public.m1_school_admin_invitation_events
  for each row execute function public.m1_school_admin_history_protect();
create trigger m1_school_admin_events_no_truncate before truncate on public.m1_school_admin_invitation_events
  for each statement execute function public.m1_school_admin_history_protect();
create trigger m1_school_admin_invitations_no_delete before delete on public.m1_school_admin_invitations
  for each row execute function public.m1_school_admin_history_protect();
create trigger m1_school_admin_invitations_no_truncate before truncate on public.m1_school_admin_invitations
  for each statement execute function public.m1_school_admin_history_protect();

-- 3. Internal: is this an ACTIVE System Admin (database role, not browser data)?
create function public.m1_is_active_system_admin(p_user uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_user and role = 'system_admin' and status = 'active');
$$;

-- 4. Authorize + create the pending invitation (the Auth user was just created by the backend).
create function public.m1_create_school_admin_invitation(
  p_actor uuid, p_user uuid, p_email text, p_full_name text, p_reference text, p_method text, p_position text,
  p_note text default null, p_valid_days integer default 7)
returns uuid language plpgsql security definer set search_path = '' as $$  -- definer: reads auth.users; service_role-only
declare v_id uuid; v_email text := lower(btrim(p_email)); v_name text := regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
begin
  if not public.m1_is_active_system_admin(p_actor) then raise exception 'm1_invite_actor_not_system_admin'; end if;
  if p_valid_days is null or p_valid_days not between 1 and 14 then raise exception 'm1_invite_invalid_validity'; end if;
  if length(v_name) not between 1 and 100 then raise exception 'm1_invite_invalid_name'; end if;
  perform 1 from public.profiles where id = p_user and role is null and status = 'active' for update;
  if not found then raise exception 'm1_invite_target_not_unassigned'; end if;
  if not exists (select 1 from auth.users where id = p_user and lower(email) = v_email) then raise exception 'm1_invite_email_mismatch'; end if;
  if exists (select 1 from public.m1_school_admin_invitations where user_id = p_user) then raise exception 'm1_invite_duplicate'; end if;
  update public.profiles set full_name = v_name where id = p_user;
  insert into public.m1_school_admin_invitations (user_id, email, authorized_by, authorization_reference, confirmation_method,
      authorizing_position, note, expires_at)
    values (p_user, v_email, p_actor, btrim(p_reference), p_method, btrim(p_position), nullif(btrim(coalesce(p_note, '')), ''),
      now() + make_interval(days => p_valid_days))
    returning id into v_id;
  insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action) values (v_id, p_user, p_actor, 'authorized');
  return v_id;
end $$;

-- 5. Record a setup email (first send or resend). Each send renews the validity window; the acceptance check
--    requires a link session issued after the LATEST send.
create function public.m1_record_school_admin_invitation_email(p_actor uuid, p_invitation uuid, p_outcome text, p_valid_days integer default 7)
returns timestamptz language plpgsql security definer set search_path = '' as $$  -- definer: the only writer; service_role-only
declare v_row public.m1_school_admin_invitations;
begin
  if not public.m1_is_active_system_admin(p_actor) then raise exception 'm1_invite_actor_not_system_admin'; end if;
  if p_outcome not in ('sent', 'resent', 'failed') then raise exception 'm1_invite_invalid_outcome'; end if;
  if p_valid_days is null or p_valid_days not between 1 and 14 then raise exception 'm1_invite_invalid_validity'; end if;
  select * into v_row from public.m1_school_admin_invitations where id = p_invitation for update;
  if not found or v_row.status <> 'pending' then raise exception 'm1_invite_not_pending'; end if;
  if p_outcome = 'failed' then
    insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action)
      values (p_invitation, v_row.user_id, p_actor, 'invitation_send_failed');
    return v_row.expires_at;
  end if;
  update public.m1_school_admin_invitations
     set last_sent_at = now(), send_count = send_count + 1, expires_at = now() + make_interval(days => p_valid_days)
   where id = p_invitation returning * into v_row;
  insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action)
    values (p_invitation, v_row.user_id, p_actor, case p_outcome when 'sent' then 'invitation_sent' else 'invitation_resent' end);
  return v_row.expires_at;
end $$;

-- 6. Cancel a pending invitation (terminal). Accepted School Admins are managed with Deactivate instead.
create function public.m1_cancel_school_admin_invitation(p_actor uuid, p_invitation uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$  -- definer: the only writer; service_role-only
declare v_row public.m1_school_admin_invitations;
begin
  if not public.m1_is_active_system_admin(p_actor) then raise exception 'm1_invite_actor_not_system_admin'; end if;
  select * into v_row from public.m1_school_admin_invitations where id = p_invitation for update;
  if not found or v_row.status <> 'pending' then raise exception 'm1_invite_not_pending'; end if;
  update public.m1_school_admin_invitations
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_invitation;
  update public.profiles set status = 'inactive' where id = v_row.user_id and role is null;
  insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action)
    values (p_invitation, v_row.user_id, p_actor, 'cancelled');
  return v_row.user_id;
end $$;

-- 7. Accept: the ONLY way an invited account becomes a School Admin.
--    p_link_at = the time the invitee's session was created from an emailed link (JWT amr), checked by the backend.
create function public.m1_accept_school_admin_invitation(p_user uuid, p_link_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$  -- definer: reads auth.users; service_role-only
declare v_row public.m1_school_admin_invitations; v_auth record;
begin
  select * into v_row from public.m1_school_admin_invitations where user_id = p_user for update;
  if not found then raise exception 'm1_invite_none'; end if;
  if v_row.status = 'accepted' then raise exception 'm1_invite_already_accepted'; end if;
  if v_row.status = 'cancelled' then raise exception 'm1_invite_cancelled'; end if;
  if now() >= v_row.expires_at then raise exception 'm1_invite_expired'; end if;
  if v_row.last_sent_at is null or p_link_at is null or p_link_at < v_row.last_sent_at - interval '5 seconds' or p_link_at > now() + interval '1 minute' then
    raise exception 'm1_invite_link_not_current';
  end if;
  select email, email_confirmed_at, coalesce(encrypted_password, '') <> '' as has_password, banned_until into v_auth from auth.users where id = p_user;
  if not found or lower(v_auth.email) <> v_row.email then raise exception 'm1_invite_email_mismatch'; end if;
  if v_auth.email_confirmed_at is null then raise exception 'm1_invite_email_unconfirmed'; end if;
  if not v_auth.has_password then raise exception 'm1_invite_password_not_set'; end if;
  if v_auth.banned_until is not null and v_auth.banned_until > now() then raise exception 'm1_invite_cancelled'; end if;
  perform 1 from public.profiles where id = p_user and role is null and status = 'active' for update;
  if not found then raise exception 'm1_invite_target_not_unassigned'; end if;

  perform set_config('m1.school_admin_activation', p_user::text, true);
  update public.profiles set role = 'admin' where id = p_user and role is null;
  perform set_config('m1.school_admin_activation', '', true);
  update public.m1_school_admin_invitations set status = 'accepted', accepted_at = now() where id = v_row.id;
  insert into public.m1_school_admin_invitation_events (invitation_id, target_id, actor_id, action)
    values (v_row.id, p_user, p_user, 'accepted'), (v_row.id, p_user, null, 'role_activated');
  return 'admin';
end $$;

-- 8. Database guard: no other path can grant the School Admin role or change an invited account's role.
create function public.m1_guard_school_admin_role()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_flag text := coalesce(current_setting('m1.school_admin_activation', true), '');
begin
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then return new; end if;
  if (new.role = 'admin' or exists (select 1 from public.m1_school_admin_invitations where user_id = new.id))
     and v_flag is distinct from new.id::text then
    raise exception 'School Admin access is granted only by accepting a School Admin invitation' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger m1_guard_school_admin_role before insert or update of role on public.profiles
  for each row execute function public.m1_guard_school_admin_role();

revoke all on function public.m1_is_active_system_admin(uuid) from public, anon, authenticated;
revoke all on function public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.m1_record_school_admin_invitation_email(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.m1_cancel_school_admin_invitation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.m1_accept_school_admin_invitation(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.m1_guard_school_admin_role() from public, anon, authenticated, service_role;
revoke all on function public.m1_school_admin_history_protect() from public, anon, authenticated, service_role;
-- Internal helper: used only inside the definer functions (run as the owner), so nobody else needs it.
revoke all on function public.m1_is_active_system_admin(uuid) from service_role;
grant execute on function public.m1_create_school_admin_invitation(uuid, uuid, text, text, text, text, text, text, integer) to service_role;
grant execute on function public.m1_record_school_admin_invitation_email(uuid, uuid, text, integer) to service_role;
grant execute on function public.m1_cancel_school_admin_invitation(uuid, uuid, text) to service_role;
grant execute on function public.m1_accept_school_admin_invitation(uuid, timestamptz) to service_role;
commit;
