-- ReadFlow M5 oral-reading attempts.
-- REVIEW/APPLY MANUALLY in Supabase after m3_content_schema.sql and
-- m3_content_rls.sql are present. This file is not executed by the app.

begin;

create table if not exists public.oral_reading_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  module_id uuid not null references public.modules (id) on delete restrict,
  -- A module passage can be edited after an attempt. The snapshot preserves
  -- the exact reference text used to produce this historical result.
  passage_snapshot text not null,
  transcript text not null,
  duration_seconds numeric not null,
  reading_speed_wpm numeric not null,
  pronunciation_accuracy numeric not null,
  expected_word_count integer not null,
  detected_error_count integer not null,
  word_metrics jsonb not null,
  stt_confidence numeric null,
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),

  constraint oral_reading_attempts_passage_check
    check (nullif(btrim(passage_snapshot), '') is not null),
  constraint oral_reading_attempts_transcript_check
    check (length(btrim(transcript)) between 1 and 100000),
  constraint oral_reading_attempts_duration_check
    check (duration_seconds > 0 and duration_seconds <= 300),
  constraint oral_reading_attempts_wpm_check
    check (reading_speed_wpm >= 0),
  constraint oral_reading_attempts_accuracy_check
    check (pronunciation_accuracy between 0 and 100),
  constraint oral_reading_attempts_word_counts_check
    check (expected_word_count > 0 and detected_error_count >= 0),
  constraint oral_reading_attempts_word_metrics_check
    check (jsonb_typeof(word_metrics) = 'array'),
  constraint oral_reading_attempts_confidence_check
    check (stt_confidence is null or stt_confidence between 0 and 1)
);

comment on table public.oral_reading_attempts is
  'Persisted M5 learner oral-reading results. Audio is not stored in this table.';
comment on column public.oral_reading_attempts.passage_snapshot is
  'Exact published module passage used for historical scoring; retained because modules remain editable.';
comment on column public.oral_reading_attempts.word_metrics is
  'Ordered normalized alignment entries with expected, actual, and match/substitution/omission/insertion type.';

create index if not exists oral_reading_attempts_user_completed_idx
  on public.oral_reading_attempts (user_id, completed_at desc);
create index if not exists oral_reading_attempts_module_idx
  on public.oral_reading_attempts (module_id);

alter table public.oral_reading_attempts enable row level security;

revoke all on table public.oral_reading_attempts from anon, authenticated;
grant select, insert on table public.oral_reading_attempts to authenticated;

-- Keep the legacy M4 policy identifiers stable for already-provisioned databases.
-- These policies belong to M5 oral reading; only their persisted names are retained.
drop policy if exists "M4 learners read own attempts" on public.oral_reading_attempts;
create policy "M4 learners read own attempts"
on public.oral_reading_attempts
for select
to authenticated
using (
  user_id = auth.uid()
  and public.m3_current_role() in ('student', 'general_user')
);

drop policy if exists "M4 learners create own accessible attempts" on public.oral_reading_attempts;
create policy "M4 learners create own accessible attempts"
on public.oral_reading_attempts
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.m3_current_role() in ('student', 'general_user')
  and public.m3_can_read_module(module_id)
);

commit;
