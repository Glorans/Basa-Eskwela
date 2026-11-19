-- READ-ONLY verification for m2_m8_reassessment_safety_PROPOSED.sql. Aggregates only.
begin transaction read only;

with checks(name, ok) as (
  select 'm8_sync_diagnostic ignores reassessment rows (initial path unchanged)',
    (select prosrc from pg_proc where oid = 'public.m8_sync_diagnostic()'::regprocedure) like '%assessment_type is distinct from ''initial'' then return new%'
  union all
  select 'm8_sync_diagnostic is still SECURITY DEFINER with the same grants',
    (select prosecdef from pg_proc where oid = 'public.m8_sync_diagnostic()'::regprocedure)
    and has_function_privilege('service_role', 'public.m8_sync_diagnostic()', 'EXECUTE')
  union all
  select 'm8_badge_eligible level_up counts initial diagnostics only',
    (select prosrc from pg_proc where oid = 'public.m8_badge_eligible(uuid,text)'::regprocedure) like '%d.assessment_type = ''initial''%'
  union all
  select 'M8 difficulty and XP inputs unchanged: m2_trusted_reading_level still initial-only',
    (select prosrc from pg_proc where oid = 'public.m2_trusted_reading_level(uuid,text)'::regprocedure) like '%assessment_type = ''initial''%'
  union all
  select 'placement switch exists and is OFF', exists (select 1 from public.m2_reassessment_settings where not placement_follows_reassessment)
  union all
  select 'backend cannot change the placement switch',
    not has_table_privilege('service_role', 'public.m2_reassessment_settings', 'UPDATE')
  union all
  select 'level-change comparison is backend-only',
    has_function_privilege('service_role', 'public.m2_reading_level_change(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.m2_reading_level_change(uuid)', 'EXECUTE')

)
select name, case when ok then 'PASS' else 'FAIL' end as result from checks;

select badge_id, count(*) as earned from public.m8_earned_badges group by 1 order by 1;
select proname, md5(prosrc) as body_md5 from pg_proc
where proname in ('m8_sync_diagnostic', 'm8_badge_eligible', 'm2_trusted_reading_level', 'm8_verified_difficulty_summary', 'm8_on_comprehension_completed')
order by proname;

rollback;
