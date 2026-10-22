-- PREPARED ONLY. Requires approval. Staging oudfrdeqwotynihkkmze ONLY. Run ONCE.
-- B3 = supabase/diagnostic_results.sql, byte-for-byte, wrapped in BEGIN ... COMMIT (B3 has
-- none), with the two B3a REVOKE statements after it, so all run in ONE transaction.
-- B3a removes privileges that Supabase default grants add and B3 does not intend:
-- authenticated keeps SELECT, INSERT, UPDATE on diagnostic_results; the trigger function is
-- executable by neither client role. Use this file INSTEAD OF the plain B3 step.
-- Before: verify_b3_b7.sql P3a-P3f. After B4-B6 and the B7 bundle: V3a-V3h, audit A1-A8.

begin;

create table if not exists public.diagnostic_results (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  assessment_type text not null default 'initial',

  orv_score numeric not null,
  comprehension_score numeric not null,

  reading_level text not null,
  difficulty_tier text not null,

  reading_speed_wpm numeric null,

  transcript text null,
  stt_confidence numeric null,
  oral_reading_metrics jsonb null,

  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint diagnostic_results_assessment_type_check
    check (assessment_type in ('initial')),

  constraint diagnostic_results_reading_level_check
    check (
      reading_level in (
        'Independent',
        'Instructional',
        'Frustration'
      )
    ),

  constraint diagnostic_results_difficulty_tier_check
    check (
      difficulty_tier in (
        'Easy',
        'Medium',
        'Hard'
      )
    ),

  constraint diagnostic_results_user_assessment_key
    unique (user_id, assessment_type)
);

alter table public.diagnostic_results
enable row level security;

revoke all
on table public.diagnostic_results
from anon;

grant select, insert, update
on table public.diagnostic_results
to authenticated;

drop policy if exists
  "Users can read their diagnostic results"
on public.diagnostic_results;

create policy
  "Users can read their diagnostic results"
on public.diagnostic_results
for select
to authenticated
using (
  auth.uid() = user_id
);

drop policy if exists
  "Users can insert their diagnostic results"
on public.diagnostic_results;

create policy
  "Users can insert their diagnostic results"
on public.diagnostic_results
for insert
to authenticated
with check (
  auth.uid() = user_id
);

drop policy if exists
  "Users can update their diagnostic results"
on public.diagnostic_results;

create policy
  "Users can update their diagnostic results"
on public.diagnostic_results
for update
to authenticated
using (
  auth.uid() = user_id
)
with check (
  auth.uid() = user_id
);

create or replace function public.set_diagnostic_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists
  diagnostic_results_set_updated_at
on public.diagnostic_results;

create trigger diagnostic_results_set_updated_at
before update
on public.diagnostic_results
for each row
execute function public.set_diagnostic_updated_at();


-- B3a (staging correction, REVOKE only).
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.diagnostic_results FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_diagnostic_updated_at () FROM PUBLIC, anon, authenticated;

commit;
