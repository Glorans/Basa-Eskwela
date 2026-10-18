-- Apply after diagnostic_results.sql and diagnostic_results_language.sql.
-- Review/apply manually. Existing rows and RLS policies are preserved.
begin;

alter table public.diagnostic_results
  add column if not exists assessment_id text,
  add column if not exists assessment_version text;

-- Legacy metadata stays NULL: the historical content version is not inferred.
alter table public.diagnostic_results
  drop constraint if exists diagnostic_results_user_assessment_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.diagnostic_results'::regclass
      and conname = 'diagnostic_results_user_assessment_language_key'
  ) then
    alter table public.diagnostic_results
      add constraint diagnostic_results_user_assessment_language_key
      unique (user_id, assessment_type, language);
  end if;
end $$;

commit;
