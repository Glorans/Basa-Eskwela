-- Apply after diagnostic_results_bilingual.sql, before deploying Module 2 v2.
-- Non-destructive schema evolution: no rows, columns, or RLS policies are removed.
-- Details are stored in oral_reading_metrics.diagnosticV2 alongside legacy metrics.
begin;
alter table public.diagnostic_results
  drop constraint if exists diagnostic_results_user_assessment_key,
  drop constraint if exists diagnostic_results_user_assessment_language_key;

do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.diagnostic_results'::regclass
    and conname = 'diagnostic_results_user_language_version_key') then
    alter table public.diagnostic_results
      add constraint diagnostic_results_user_language_version_key
      unique (user_id, assessment_type, language, assessment_id, assessment_version);
  end if;
end $$;
commit;
