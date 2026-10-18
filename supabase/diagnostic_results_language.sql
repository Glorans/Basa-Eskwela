begin;

alter table public.diagnostic_results
add column if not exists language text not null default 'en';

alter table public.diagnostic_results
drop constraint if exists diagnostic_results_language_check;

alter table public.diagnostic_results
add constraint diagnostic_results_language_check
check (language in ('en', 'fil'));

commit;
