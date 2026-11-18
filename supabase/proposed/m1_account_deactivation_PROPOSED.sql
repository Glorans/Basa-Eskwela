-- M1 F7 Deactivate / Reactivate User Account (Appendix N) -- PROPOSED. NOT APPLIED. Requires explicit approval.
--
-- Reversible deactivation replaces routine permanent deletion. Nothing here deletes or rewrites learning data.
--
-- What this changes
--   1. profiles.status vocabulary: CHECK (status in ('active','inactive')). The column already exists (text, NOT NULL,
--      default 'active'); the 2026-11-18 read-only preflight found every profile 'active'. No new column.
--   2. public.m1_account_status_events: append-only audit (administrator, affected account, action, timestamp,
--      and whether the status changed: a retry that re-applies the same status after a partial failure is logged too).
--      No foreign keys, so the history survives any later account removal. Service role only (RLS on, no policies,
--      no grants to anon/authenticated).
--   3. public.m1_set_account_status(actor, target, status): ONE transaction that re-checks the administrator scope,
--      protects the last active System Admin, updates profiles.status and writes the audit row. Service role only;
--      the backend calls it after banning the Auth user (deactivate) or before lifting the ban (reactivate).
--   4. Tokens issued BEFORE deactivation (valid until they expire, normally up to 1 hour):
--      - PostgREST pre-request check public.m1_reject_deactivated_request() refuses every table and RPC request made
--        with a deactivated account's token (HTTP 403), including SECURITY DEFINER RPCs, which RLS alone cannot cover.
--      - Storage: restrictive policy "M1 active account required" on storage.objects.
--
-- Effects
--   Supabase Auth: none from SQL. The backend bans/unbans the Auth user (ban_duration) through the Admin API; the Auth
--     user, id, email and password are kept.
--   profiles: only status changes, and only through m1_set_account_status. role, teacher_status, names unchanged.
--     The existing trigger m1_protect_profile_authorization_fields already blocks browser changes to status; the
--     m7_profile_authorization_changed trigger fires only on role/teacher_status, so status changes enqueue nothing.
--   RLS: no existing policy is altered. Active accounts see exactly what they saw before (both new checks are true for
--     every active account and for requests with no signed-in user).
--   Learning records: untouched (diagnostics, oral reading, comprehension, analytics, XP, enrollments, rooms).
--
-- Rollback: supabase/proposed/m1_account_deactivation_ROLLBACK_PROPOSED.sql (reactivate every account first).
begin;

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'status') is distinct from 'text' then
    raise exception 'STOP: public.profiles.status (text) is required';
  end if;
  if exists (select 1 from public.profiles where status is distinct from 'active') then
    raise exception 'STOP: every profile must be active before installing (unexpected status values found)';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_status_check')
     or to_regclass('public.m1_account_status_events') is not null
     or to_regprocedure('public.m1_set_account_status(uuid,uuid,text)') is not null
     or to_regprocedure('public.m1_reject_deactivated_request()') is not null
     or to_regprocedure('public.m1_account_active()') is not null then
    raise exception 'STOP: M1 account deactivation is already (partly) installed';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator'
             and array_to_string(rolconfig, ',') ~ 'pgrst\.db_pre_request') then
    raise exception 'STOP: a PostgREST pre-request function is already configured; merge it by hand';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'M1 active account required') then
    raise exception 'STOP: storage policy already exists';
  end if;
end $$;

-- 1. Status vocabulary.
alter table public.profiles add constraint profiles_status_check check (status in ('active', 'inactive'));

-- 2. Audit history.
create table public.m1_account_status_events (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null,
  target_role text,
  actor_id uuid not null,
  actor_role text not null,
  action text not null check (action in ('deactivate', 'reactivate')),
  status_changed boolean not null,
  acted_at timestamptz not null default now()
);
create index m1_account_status_events_target_idx on public.m1_account_status_events (target_id, acted_at desc);
alter table public.m1_account_status_events enable row level security;
revoke all on table public.m1_account_status_events from public, anon, authenticated;

-- 3. Atomic, scope-checked status change (mirrors server/services/m1AccountScope.js statusManageable).
create function public.m1_set_account_status(p_actor uuid, p_target uuid, p_status text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_old text;
begin
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception 'm1_invalid_status';
  end if;
  if p_actor is null or p_target is null or p_actor = p_target then
    raise exception 'm1_target_missing';
  end if;

  select role into v_actor_role from public.profiles where id = p_actor and status = 'active';
  if v_actor_role is null or v_actor_role not in ('system_admin', 'admin') then
    raise exception 'm1_actor_not_manager';
  end if;

  select role, status into v_target_role, v_old from public.profiles where id = p_target for update;
  if not found or not (
       (v_actor_role = 'system_admin' and v_target_role in ('general_user', 'admin'))
    or (v_actor_role = 'admin' and v_target_role in ('teacher', 'student'))
  ) then
    raise exception 'm1_target_missing';
  end if;

  -- Defense in depth: System Admin accounts are outside every scope above, but never leave zero active System Admins.
  if p_status = 'inactive' and v_target_role = 'system_admin' then
    perform pg_advisory_xact_lock(hashtext('m1_system_admin_status'));
    if not exists (select 1 from public.profiles where role = 'system_admin' and status = 'active' and id <> p_target) then
      raise exception 'm1_last_system_admin';
    end if;
  end if;

  if v_old is distinct from p_status then
    update public.profiles set status = p_status where id = p_target;
  end if;
  -- Every administrator action is recorded, including a retry that reconciles Supabase Auth after a partial failure.
  insert into public.m1_account_status_events (target_id, target_role, actor_id, actor_role, action, status_changed)
  values (p_target, v_target_role, p_actor, v_actor_role,
          case when p_status = 'inactive' then 'deactivate' else 'reactivate' end, v_old is distinct from p_status);
  return v_old;
end;
$$;
revoke all on function public.m1_set_account_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.m1_set_account_status(uuid, uuid, text) to service_role;

-- 4a. True unless the signed-in account is deactivated. True with no signed-in user and for the service role.
create function public.m1_account_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.profiles where id = auth.uid() and status = 'inactive');
$$;
revoke all on function public.m1_account_active() from public, anon;
grant execute on function public.m1_account_active() to authenticated, service_role;

-- 4b. PostgREST pre-request: refuses every request made with a deactivated account's token (tables and RPCs).
create function public.m1_reject_deactivated_request()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and exists (select 1 from public.profiles where id = auth.uid() and status = 'inactive') then
    raise sqlstate 'PT403' using message = 'This account has been deactivated.', hint = 'Contact your administrator.';
  end if;
end;
$$;
revoke all on function public.m1_reject_deactivated_request() from public;
grant execute on function public.m1_reject_deactivated_request() to anon, authenticated, service_role;
alter role authenticator set pgrst.db_pre_request = 'public.m1_reject_deactivated_request';

-- 4c. Storage API (does not use PostgREST): restrictive, so it only narrows existing storage policies.
create policy "M1 active account required" on storage.objects
  as restrictive for all to authenticated
  using (public.m1_account_active()) with check (public.m1_account_active());

-- Delivered at commit: PostgREST reloads its configuration and starts calling the pre-request function.
notify pgrst, 'reload config';
commit;
