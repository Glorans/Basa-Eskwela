-- PROPOSAL ONLY. NOT APPLIED. Separate activation step for m4_module_recipients_PROPOSED.sql.
-- Run only after: (1) the foundation is installed and verified, (2) the backend with the
-- recipient-aware M5 start filter and the frontend targeting form are deployed, (3) the
-- verification queries in docs/M3_M4_ROLLOUT_RUNBOOK.md pass.
begin;
do $check$
begin
  if to_regprocedure('public.m4_enforce_module_recipient()') is null
     or (select count(*) from pg_trigger where tgname = 'm4_enforce_module_recipient' and not tgisinternal) <> 2 then
    raise exception 'Recipient enforcement triggers are missing; do not enable targeting';
  end if;
end $check$;
update public.m4_targeting_rollout set enabled = true where singleton;
commit;
-- Disable again at any time (existing selected assignments stay restricted to their recipients):
--   update public.m4_targeting_rollout set enabled = false where singleton;
