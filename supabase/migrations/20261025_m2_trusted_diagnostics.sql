-- PREPARED ONLY. Requires review and approval. Not applied anywhere.
-- DT1: trusted Module 2 diagnostic results (prerequisite for C9).
-- Forward-only. Apply after C8, before C9, in ONE run of this whole file.
-- Before: supabase/staging/verify_dt1_diagnostic_trust.sql P-DT1a..P-DT1e.
-- After:  V-DT1a..V-DT1j, then audit_stage_b.sql A1-A8.
--
-- Diagnostic rows were written by the browser (authenticated INSERT/UPDATE
-- with only auth.uid() = user_id checked), so their reading levels are
-- learner-controlled. From now on the backend scores the reading from
-- server-signed Google transcripts and inserts the row with the service role.
-- * Existing rows are kept unchanged and marked 'unverified'. Nothing here, or
--   anywhere else, upgrades them: a row becomes trusted only by a new
--   server-scored assessment, stored as a separate 'server_verified' row.
-- * Learners keep SELECT on their own rows and lose INSERT/UPDATE.
-- * New rows must be server_verified and unverified rows are read-only, so
--   m8_sync_diagnostic (AFTER INSERT OR UPDATE OF reading_level) can no
--   longer fire for unverified evidence. Its code is unchanged here; M8 state
--   already derived from pre-DT1 rows is left for C9 to recompute
--   (V-DT1j lists it), using m2_trusted_reading_level().
begin;

do $$
begin
  if to_regclass('public.diagnostic_results') is null then
    raise exception 'Stop: public.diagnostic_results is missing (B3-B6 not applied).';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'diagnostic_results' and column_name = 'verification_status') then
    raise exception 'Stop: DT1 is already applied. Do not rerun it.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.diagnostic_results'::regclass
      and conname = 'diagnostic_results_user_language_version_key') then
    raise exception 'Stop: expected B6 constraint diagnostic_results_user_language_version_key is missing.';
  end if;
end $$;

-- 1. Provenance. The constant default marks every existing row 'unverified'.
alter table public.diagnostic_results
  add column verification_status text not null default 'unverified',
  add column verification_method text null,
  add column verification_recording_id uuid null,
  add column verified_at timestamptz null;

alter table public.diagnostic_results
  add constraint diagnostic_results_verification_status_check
    check (verification_status in ('unverified', 'server_verified')),
  add constraint diagnostic_results_verification_evidence_check
    check (
      (verification_status = 'unverified'
        and verification_method is null
        and verification_recording_id is null
        and verified_at is null)
      or (verification_status = 'server_verified'
        and verification_method is not null
        and verification_recording_id is not null
        and verified_at is not null
        and assessment_id is not null
        and assessment_version is not null)
    );

comment on column public.diagnostic_results.verification_status is
  'unverified: written by the browser before DT1 (learner-controlled). server_verified: scored by the backend from server-signed STT transcripts.';
comment on column public.diagnostic_results.verification_recording_id is
  'Recording whose signed transcript produced this verified result; makes retries idempotent.';

-- 2. One row per learner/language/version for EACH status, so a verified
-- result never overwrites historical unverified evidence.
alter table public.diagnostic_results
  drop constraint diagnostic_results_user_language_version_key;
create unique index diagnostic_results_unverified_version_key
  on public.diagnostic_results (user_id, assessment_type, language, assessment_id, assessment_version)
  where verification_status = 'unverified';
create unique index diagnostic_results_verified_version_key
  on public.diagnostic_results (user_id, assessment_type, language, assessment_id, assessment_version)
  where verification_status = 'server_verified';
create unique index diagnostic_results_verified_recording_key
  on public.diagnostic_results (user_id, verification_recording_id)
  where verification_recording_id is not null;

-- 3. Clients may read their own rows only. RLS does not govern TRUNCATE, so
-- every write and management privilege is revoked, not just the policies.
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.diagnostic_results from public, anon, authenticated;
revoke all on table public.diagnostic_results from anon;
grant select on table public.diagnostic_results to authenticated;
grant select, insert on table public.diagnostic_results to service_role;

drop policy if exists "Users can insert their diagnostic results" on public.diagnostic_results;
drop policy if exists "Users can update their diagnostic results" on public.diagnostic_results;

-- 4. Evidence is immutable, including for the service role: every new row is
-- server-verified, historical unverified rows are read-only (no silent upgrade
-- and no re-firing of M8 from them), and a verified assessment cannot be
-- rewritten. Account deletion (ON DELETE CASCADE) still removes rows.
create or replace function public.m2_protect_diagnostic_verification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.verification_status is distinct from 'server_verified' then
      raise exception 'New diagnostic results must be server-verified.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if old.verification_status = 'unverified' then
    raise exception 'Historical unverified diagnostic results are read-only.'
      using errcode = '42501';
  end if;
  if new.verification_status is distinct from old.verification_status
    or new.verification_method is distinct from old.verification_method
    or new.verification_recording_id is distinct from old.verification_recording_id
    or new.verified_at is distinct from old.verified_at then
    raise exception 'Diagnostic verification evidence cannot be changed; record a new verified assessment instead.'
      using errcode = '42501';
  end if;
  if old.verification_status = 'server_verified' and (
    new.user_id is distinct from old.user_id
    or new.assessment_type is distinct from old.assessment_type
    or new.language is distinct from old.language
    or new.assessment_id is distinct from old.assessment_id
    or new.assessment_version is distinct from old.assessment_version
    or new.orv_score is distinct from old.orv_score
    or new.comprehension_score is distinct from old.comprehension_score
    or new.reading_level is distinct from old.reading_level
    or new.difficulty_tier is distinct from old.difficulty_tier
    or new.reading_speed_wpm is distinct from old.reading_speed_wpm
    or new.transcript is distinct from old.transcript
    or new.stt_confidence is distinct from old.stt_confidence
    or new.oral_reading_metrics is distinct from old.oral_reading_metrics
    or new.completed_at is distinct from old.completed_at) then
    raise exception 'A server-verified diagnostic result cannot be modified.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.m2_protect_diagnostic_verification() from public, anon, authenticated;

create trigger diagnostic_results_protect_verification
before insert or update on public.diagnostic_results
for each row execute function public.m2_protect_diagnostic_verification();

-- 5. Trusted, per-language eligibility for C9 (not yet used). Returns NULL
-- when the learner has no server-verified diagnostic in that language;
-- unverified rows are never consulted. Backend/trigger use only.
create or replace function public.m2_trusted_reading_level(p_user uuid, p_language text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select d.reading_level
  from public.diagnostic_results d
  where d.user_id = p_user
    and d.language = p_language
    and d.assessment_type = 'initial'
    and d.verification_status = 'server_verified'
  order by d.verified_at desc, d.id
  limit 1
$$;
revoke all on function public.m2_trusted_reading_level(uuid, text) from public, anon, authenticated;
grant execute on function public.m2_trusted_reading_level(uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
