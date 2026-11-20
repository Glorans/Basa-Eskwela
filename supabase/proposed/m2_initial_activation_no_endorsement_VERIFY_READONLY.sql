-- READ-ONLY verification for m2_initial_activation_no_endorsement_PROPOSED.sql. Changes nothing.
-- Every row must say PASS.
with fn as (select prosrc, prosecdef, proacl::text acl from pg_proc
            where oid = 'public.m2_activate_initial_version(text,uuid,uuid,uuid)'::regprocedure),
checks(name, ok) as (values
  ('activation function is the reviewed no-endorsement body', (select md5(prosrc) = 'ed9266fe09773b403031f46c9ba8050b' from fn)),
  ('activation no longer calls m2_version_educator_endorsed', (select prosrc not like '%educator_endorsed%' from fn)),
  ('still System Admin only', (select prosrc like '%role = ''system_admin''%' from fn)),
  ('still published versions only', (select prosrc like '%v.status <> ''published''%' from fn)),
  ('still authored versions only (3.0 via return)', (select prosrc like '%v.source <> ''authored''%' from fn)),
  ('still same-language initial lineage, not archived', (select prosrc like '%v.language <> p_language%' and prosrc like '%v.archived_at is not null%' from fn)),
  ('still refuses a concurrent change (40001)', (select prosrc like '%40001%' from fn)),
  ('still records every change in the events table', (select prosrc like '%insert into public.m2_initial_activation_events%' from fn)),
  ('still SECURITY DEFINER', (select prosecdef from fn)),
  ('callable by the backend (service_role) only', (select acl like '%service_role=X/%' and acl not like '%authenticated%' and acl not like '%anon%' and acl not like '%=X/postgres,=%' from fn)),
  ('m2_version_educator_endorsed() still exists (reassessment uses it)', to_regprocedure('public.m2_version_educator_endorsed(uuid)') is not null),
  ('reassessment assignment rule still requires endorsement (when reassessment is installed)',
    to_regclass('public.m2_reassessment_assignments') is null
    or exists (select 1 from pg_proc where proname like 'm2\_%' and proname <> 'm2_activate_initial_version' and prosrc like '%m2_version_educator_endorsed(new.package_version_id)%'))
)
select case when ok then 'PASS' else 'FAIL' end as result, name from checks;
