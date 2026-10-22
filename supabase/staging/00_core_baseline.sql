-- STAGING ONLY: ReadFlow-Staging (oudfrdeqwotynihkkmze). NOT a production migration. Not yet executed.
-- Recreates the seven core tables that the team project created in the Supabase dashboard and that
-- no repository migration creates: profiles, learning_paths, modules, progress, rooms, enrollments,
-- room_modules. Columns, types and foreign-key names follow readflow/src/lib/database.types.ts.
-- Columns added by later repository migrations are deliberately ABSENT so those files apply
-- unchanged: profiles.nickname/teacher_status/age, modules.passage/source_material_id/updated_at/
-- deleted_at/collection_revision.
-- Apply FIRST on an empty public schema, before supabase/m1_onboarding_security_migration.sql.
begin;

do $$
begin
  if to_regclass('public.profiles') is not null or to_regclass('public.modules') is not null then
    raise exception 'Core tables already exist. Stop: this baseline is only for an empty staging project.';
  end if;
end $$;

create table public.profiles (
  id uuid primary key constraint profiles_id_fkey references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text constraint profiles_role_check
    check (role is null or role in ('admin', 'teacher', 'student', 'general_user')),
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table public.learning_paths (
  id uuid primary key default gen_random_uuid(),
  path_name text not null,
  language text not null,
  reading_level text not null check (reading_level in ('Frustration', 'Instructional', 'Independent')),
  difficulty_tier text not null check (difficulty_tier in ('Easy', 'Medium', 'Hard')),
  description text
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null constraint modules_path_id_fkey references public.learning_paths(id),
  title text not null,
  difficulty text not null check (difficulty in ('Easy', 'Medium', 'Hard')),
  status text not null default 'draft' constraint modules_status_check check (status in ('draft', 'published')),
  created_by uuid not null constraint modules_created_by_fkey references public.profiles(id),
  created_at timestamptz not null default now(),
  published_at timestamptz
);

-- Referenced by M3 dependency checks only; the current app does not read or write it.
create table public.progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null constraint progress_user_id_fkey references public.profiles(id) on delete cascade,
  module_id uuid not null constraint progress_module_id_fkey references public.modules(id),
  score numeric,
  status text not null default 'not_started',
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null constraint rooms_teacher_id_fkey references public.profiles(id) on delete cascade,
  room_name text not null,
  room_code text not null constraint rooms_room_code_key unique,
  section text,
  description text,
  created_at timestamptz not null default now()
);

-- M4 requires immediate UNIQUE constraints on these exact column sets.
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null constraint enrollments_room_id_fkey references public.rooms(id) on delete cascade,
  student_id uuid not null constraint enrollments_student_id_fkey references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  constraint enrollments_room_id_student_id_key unique (room_id, student_id)
);

create table public.room_modules (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null constraint room_modules_room_id_fkey references public.rooms(id) on delete cascade,
  module_id uuid not null constraint room_modules_module_id_fkey references public.modules(id),
  assigned_by uuid not null constraint room_modules_assigned_by_fkey references public.profiles(id),
  assigned_at timestamptz not null default now(),
  constraint room_modules_module_id_room_id_key unique (module_id, room_id)
);

-- RLS on everything; policies come from the M1, M3 and M4 repository migrations.
alter table public.profiles enable row level security;
alter table public.learning_paths enable row level security;
alter table public.modules enable row level security;
alter table public.progress enable row level security;
alter table public.rooms enable row level security;
alter table public.enrollments enable row level security;
alter table public.room_modules enable row level security;

-- Explicit grants instead of relying on project default privileges. Supabase auto-grants ALL
-- (including TRUNCATE, which RLS does not restrict) on new public tables, so revoke both client
-- roles first. M1 (B2) and M3 (B8) then grant profiles/modules column-level privileges; M4
-- policies govern classroom rows.
revoke all on public.profiles, public.learning_paths, public.modules, public.progress,
  public.rooms, public.enrollments, public.room_modules from anon, authenticated;
grant select on public.learning_paths to authenticated;
grant select, insert, update, delete on public.rooms, public.enrollments, public.room_modules to authenticated;
grant all on public.profiles, public.learning_paths, public.modules, public.progress,
  public.rooms, public.enrollments, public.room_modules to service_role;

-- No repository migration defines a learning_paths policy; the browser lists paths when
-- creating modules and placing learners. Read-only for signed-in users.
create policy "Signed-in users read learning paths" on public.learning_paths
  for select to authenticated using (true);

create index enrollments_student_id_idx on public.enrollments (student_id);
create index room_modules_room_id_idx on public.room_modules (room_id);
create index modules_path_id_idx on public.modules (path_id);

commit;
