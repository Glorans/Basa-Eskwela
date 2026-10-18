-- ReadFlow M1 onboarding and profile security migration.
--
-- Supports:
-- Signup -> Role Selection -> Profile Setup
--
-- Establishes:
-- - Role-neutral signup
-- - Learner nickname support
-- - Profile RLS
-- - Own-profile read/update policies
-- - Protected authorization fields
-- - One-time self role assignment
-- - Role domain validation
--
-- Review and apply manually in the Supabase SQL editor/migration workflow.

begin;


-- =========================================================
-- 1. PROFILE STRUCTURE
-- =========================================================

-- New accounts begin without an application role.
alter table public.profiles
  alter column role drop default,
  alter column role drop not null;


-- Learner nicknames are separate from teacher/full names.
alter table public.profiles
  add column if not exists nickname text null;


-- Preserve learner display names from older records.
update public.profiles
set nickname = nullif(trim(full_name), '')
where role in ('student', 'general_user')
  and nickname is null;



-- =========================================================
-- 2. AUTH SIGNUP -> PROFILE CREATION
-- =========================================================

-- Auth signup creates a role-neutral application profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    full_name,
    role
  )
  values (
    new.id,
    '',
    null
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


-- The signup trigger invokes this function internally.
-- Browser/public callers do not need direct access.
revoke all on function public.handle_new_user()
from public;


-- Ensure there is only one signup trigger.
drop trigger if exists on_auth_user_created
on auth.users;


create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();



-- =========================================================
-- 3. PROFILE ROW LEVEL SECURITY
-- =========================================================

alter table public.profiles
enable row level security;


-- Remove only M1-owned policies.
-- Do not remove policies belonging to later modules such as M6.

drop policy if exists "M1 users read own profile"
on public.profiles;

drop policy if exists "M1 users update own display name"
on public.profiles;


-- =========================================================
-- 4. PROFILE PERMISSIONS
-- =========================================================

-- Remove broad browser permissions first.
revoke all on table public.profiles
from anon, authenticated;


-- Signed-in users may read profile fields.
grant select (
  id,
  full_name,
  nickname,
  role,
  status,
  created_at
)
on public.profiles
to authenticated;


-- Browser users may update profile-name fields only.
--
-- Role and status are deliberately excluded.
grant update (
  full_name,
  nickname
)
on public.profiles
to authenticated;



-- =========================================================
-- 5. OWN-PROFILE RLS POLICIES
-- =========================================================

create policy "M1 users read own profile"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
);


create policy "M1 users update own display name"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
)
with check (
  id = auth.uid()
);



-- =========================================================
-- 6. PROTECT AUTHORIZATION FIELDS
-- =========================================================

-- Defense in depth:
-- Prevent authenticated browser clients from modifying
-- authorization-sensitive fields.
--
-- The only permitted role transition is:
--
-- NULL -> teacher
-- NULL -> student
-- NULL -> general_user
--
-- and only for the signed-in user's own profile.
create or replace function public.m1_protect_profile_authorization_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and (

    new.id is distinct from old.id

    or new.status is distinct from old.status

    or new.created_at is distinct from old.created_at

    or (
      new.role is distinct from old.role
      and not (
        old.id = auth.uid()
        and old.role is null
        and new.role in (
          'teacher',
          'student',
          'general_user'
        )
      )
    )

  ) then

    raise exception
      'profile authorization fields are server-managed';

  end if;

  return new;
end;
$$;


revoke all on function
public.m1_protect_profile_authorization_fields()
from public;


drop trigger if exists
profiles_protect_authorization_fields
on public.profiles;


create trigger profiles_protect_authorization_fields
before update
on public.profiles
for each row
execute function
public.m1_protect_profile_authorization_fields();



-- =========================================================
-- 7. ONE-TIME ROLE SELECTION
-- =========================================================

-- This is the only browser-accessible path for assigning
-- an application role.
--
-- A user:
-- - must be authenticated
-- - can assign only their own role
-- - can assign it only once
-- - cannot select admin
create or replace function public.assign_own_role(
  selected_role text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_role text;
begin

  if auth.uid() is null then
    raise exception
      'authentication required'
      using errcode = '42501';
  end if;


  if selected_role is null
    or selected_role not in (
      'teacher',
      'student',
      'general_user'
    )
  then
    raise exception
      'role is not publicly assignable'
      using errcode = '22023';
  end if;


  update public.profiles
  set role = selected_role
  where id = auth.uid()
    and role is null
  returning role
  into assigned_role;


  if assigned_role is null then
    raise exception
      'role has already been assigned'
      using errcode = '23514';
  end if;


  return assigned_role;

end;
$$;


-- Do not allow anonymous/public execution.
revoke execute
on function public.assign_own_role(text)
from public, anon;


-- Authenticated users may call the controlled RPC.
grant execute
on function public.assign_own_role(text)
to authenticated;



-- =========================================================
-- 8. ROLE DOMAIN CONSTRAINT
-- =========================================================

alter table public.profiles
drop constraint if exists profiles_role_check;


alter table public.profiles
add constraint profiles_role_check
check (
  role is null
  or role in (
    'admin',
    'teacher',
    'student',
    'general_user'
  )
)
not valid;



commit;