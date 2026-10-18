-- Synthetic pre-M3 dependency baseline, reconstructed from database.types.ts.
-- Used only in the disposable staging transaction. This is NOT a production migration.
create table public.profiles (
 id uuid primary key references auth.users(id), full_name text not null default '',
 nickname text, role text check(role in ('admin','teacher','student','general_user')),
 status text not null default 'active', created_at timestamptz not null default now()
);
create table public.learning_paths (
 id uuid primary key default gen_random_uuid(), path_name text not null, language text not null,
 reading_level text not null, difficulty_tier text not null, description text
);
create table public.modules (
 id uuid primary key default gen_random_uuid(), path_id uuid not null references public.learning_paths(id),
 title text not null, difficulty text not null check(difficulty in ('Easy','Medium','Hard')),
 status text not null default 'draft' constraint modules_status_check check(status in ('draft','published')),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), published_at timestamptz
);
-- Only columns used by M3 dependency checks; no classroom or oral-reading behavior.
create table public.progress (id uuid primary key default gen_random_uuid(), module_id uuid not null constraint progress_module_id_fkey references public.modules(id));
create table public.room_modules (id uuid primary key default gen_random_uuid(), module_id uuid not null constraint room_modules_module_id_fkey references public.modules(id));
alter table public.profiles enable row level security;
alter table public.learning_paths enable row level security;
alter table public.progress enable row level security;
alter table public.room_modules enable row level security;
revoke all on public.profiles,public.learning_paths,public.progress,public.room_modules from anon,authenticated;
