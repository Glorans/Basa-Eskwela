-- REVIEW AND APPLY MANUALLY after the existing M1, M3, M4 and M5 migrations.
-- Never rerun the historical M1 migration after this file (it replaces role RPCs).
begin;
set local lock_timeout = '5s';
lock table public.profiles in share row exclusive mode;

alter table public.profiles add column teacher_status text;
-- Only accounts already present at migration time are grandfathered in.
update public.profiles set teacher_status = 'approved' where role = 'teacher';
alter table public.profiles add constraint profiles_teacher_status_check check (
  (role = 'teacher' and teacher_status is not null and teacher_status in ('pending','approved','rejected'))
  or (role is distinct from 'teacher' and teacher_status is null)
);
grant select (teacher_status) on public.profiles to authenticated;

create table public.teacher_invite_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses integer check (max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0)
);
create table public.teacher_invite_attempts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.teacher_invite_codes enable row level security;
alter table public.teacher_invite_attempts enable row level security;
revoke all on public.teacher_invite_codes, public.teacher_invite_attempts from public, anon, authenticated;
grant all on public.teacher_invite_codes, public.teacher_invite_attempts to service_role;

-- Trusted definer RPCs may change authorization; direct clients may not.
create or replace function public.m1_protect_profile_authorization_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (
    new.id is distinct from old.id or new.role is distinct from old.role
    or new.status is distinct from old.status or new.created_at is distinct from old.created_at
    or new.teacher_status is distinct from old.teacher_status
  ) then
    raise exception 'profile authorization fields are server-managed' using errcode = '42501';
  end if;
  return new;
end $$;

-- Keep the existing learner RPC and contract; Teacher now has a separate atomic RPC.
create or replace function public.assign_own_role(selected_role text)
returns text language plpgsql security definer set search_path = '' as $$
declare assigned_role text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if selected_role is null or selected_role not in ('student','general_user') then
    raise exception 'Teacher registration requires a valid invite code' using errcode = '22023';
  end if;
  update public.profiles set role = selected_role where id = auth.uid() and role is null
    returning role into assigned_role;
  if assigned_role is null then raise exception 'role has already been assigned' using errcode = '23514'; end if;
  return assigned_role;
end $$;

create function public.register_teacher_with_invite(invite_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare code_row public.teacher_invite_codes%rowtype; attempt_row public.teacher_invite_attempts%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
  ) then raise exception 'Verify your email before selecting Teacher.' using errcode = '42501'; end if;
  -- Serializes concurrent submissions by the same user before consuming a code.
  perform 1 from public.profiles where id = auth.uid() and role is null for update;
  if not found then raise exception 'role has already been assigned' using errcode = '23514'; end if;
  insert into public.teacher_invite_attempts(user_id) values(auth.uid()) on conflict do nothing;
  select * into attempt_row from public.teacher_invite_attempts where user_id = auth.uid() for update;
  if attempt_row.window_start <= now() - interval '15 minutes' then
    update public.teacher_invite_attempts set window_start = now(), attempts = 0 where user_id = auth.uid();
    attempt_row.attempts := 0;
  end if;
  if attempt_row.attempts >= 5 then return false; end if;
  update public.teacher_invite_attempts set attempts = attempts + 1 where user_id = auth.uid();
  -- Return false (not an exception) so failed-attempt accounting commits.
  if invite_code is null or length(btrim(invite_code)) not between 16 and 256 then return false; end if;
  select * into code_row from public.teacher_invite_codes
    where code_hash = encode(sha256(convert_to(btrim(invite_code), 'UTF8')), 'hex') for update;
  if not found or not code_row.active or code_row.expires_at <= now()
    or (code_row.max_uses is not null and code_row.use_count >= code_row.max_uses) then return false; end if;
  update public.profiles set role = 'teacher', teacher_status = 'pending' where id = auth.uid();
  update public.teacher_invite_codes set use_count = use_count + 1 where id = code_row.id;
  return true;
end $$;

create function public.review_teacher_registration(target_user uuid, decision text)
returns text language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved','rejected') then
    raise exception 'Invalid Teacher review decision.' using errcode = '22023';
  end if;
  update public.profiles set teacher_status = decision
    where id = target_user and role = 'teacher' and teacher_status = 'pending'
      and nullif(btrim(full_name), '') is not null
    returning teacher_status into result;
  if result is null then
    raise exception 'Teacher is no longer pending or has not completed their profile.' using errcode = '40001';
  end if;
  return result;
end $$;

-- Approval is always read from the current profile, not JWT metadata.
create function public.m1_teacher_access_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where id = auth.uid()
    and role = 'teacher' and teacher_status is distinct from 'approved');
$$;
create or replace function public.m3_current_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
    and (role <> 'teacher' or teacher_status = 'approved');
$$;

-- Restrictive policies AND with existing module policies; they grant no new access.
-- Enumerate the actual Teacher data surfaces, preserving existing learner policies.
do $$
declare table_name text;
begin
  foreach table_name in array array['rooms','enrollments','room_modules','reading_activity_assignments',
    'modules','module_passages','learning_paths','uploaded_materials','material_question_sets',
    'comprehension_questions','comprehension_question_answers','oral_reading_attempts','progress','diagnostic_results'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('create policy "M1 Teacher approval required" on public.%I as restrictive for all to authenticated using (public.m1_teacher_access_allowed()) with check (public.m1_teacher_access_allowed())', table_name);
    end if;
  end loop;
end $$;
create policy "M1 unapproved Teachers see only own profile" on public.profiles
  as restrictive for all to authenticated
  using (id = auth.uid() or public.m1_teacher_access_allowed())
  with check (id = auth.uid() or public.m1_teacher_access_allowed());
create policy "M1 Teacher approval required" on storage.objects
  as restrictive for all to authenticated
  using (public.m1_teacher_access_allowed()) with check (public.m1_teacher_access_allowed());

revoke all on function public.register_teacher_with_invite(text),
  public.review_teacher_registration(uuid,text), public.m1_teacher_access_allowed() from public, anon;
revoke all on function public.assign_own_role(text) from public, anon;
grant execute on function public.assign_own_role(text), public.register_teacher_with_invite(text),
  public.review_teacher_registration(uuid,text), public.m1_teacher_access_allowed() to authenticated;
commit;
