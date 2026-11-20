-- ROLLBACK for m2_initial_activation_PROPOSED.sql -- PROPOSED. NOT APPLIED. Requires explicit approval.
-- Refuses while either language has an activated (non-built-in) version: return both languages to the built-in 3.0
-- first (m2_activate_initial_version(language, NULL, current, system_admin)) and wait for in-progress learners.
-- Results recorded on an activated version stay valid (they count as initial completion in the backend and the app).
-- RECOVERY without rollback: call m2_activate_initial_version(language, NULL, <current version id>, <system admin id>).
begin;

do $$
begin
  if to_regclass('public.m2_initial_activation') is null then
    raise exception 'STOP: initial activation is not installed';
  end if;
  if exists (select 1 from public.m2_initial_activation where package_version_id is not null) then
    raise exception 'STOP: a language still has an activated version; return it to the built-in 3.0 first';
  end if;
end $$;

drop function public.m2_activate_initial_version(text, uuid, uuid, uuid);
drop trigger m2_guard_initial_activation on public.m2_initial_activation;
drop trigger m2_guard_initial_activation_events on public.m2_initial_activation_events;
drop table public.m2_initial_activation_events;
drop table public.m2_initial_activation;
drop function public.m2_guard_initial_activation();
drop function public.m2_guard_initial_activation_events();
drop index public.diagnostic_results_one_verified_initial_per_language;

notify pgrst, 'reload schema';
commit;
