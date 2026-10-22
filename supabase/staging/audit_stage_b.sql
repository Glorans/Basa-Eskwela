-- READ ONLY. Every statement is a SELECT. ReadFlow-Staging oudfrdeqwotynihkkmze ONLY.
-- SECURITY SWEEP: run A1-A8 after EVERY migration group (B3-B7 through C7-C8), after that
-- group's own verify_*.sql checks. Run one section at a time.
-- A1-A5 expect 0 rows; every row must be explained before continuing.
-- These are catalog audits, not evidence that row-level behaviour was tested.

-- A1. Every application table must have RLS enabled.
select c.oid::regclass as table_name
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;

-- A2. Client roles must not bypass RLS or inherit table ownership privileges.
select r.rolname, c.oid::regclass as table_name, r.rolsuper, r.rolbypassrls
from pg_roles r cross join pg_class c
join pg_namespace n on n.oid = c.relnamespace
where r.rolname in ('anon', 'authenticated') and n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and (r.rolsuper or r.rolbypassrls or pg_has_role(r.oid, c.relowner, 'MEMBER'));

-- A3. RLS does not control TRUNCATE. Do not retain unexpected client management
-- privileges inherited from table defaults. B3/B20 need particular attention.
select r.rolname, c.oid::regclass as table_name, privilege.name as privilege
from pg_roles r cross join pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as privilege(name)
where r.rolname in ('anon', 'authenticated') and n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and has_table_privilege(r.oid, c.oid, privilege.name)
order by 1, 2, 3;

-- A4. Anonymous CRUD privileges, including column grants, should be absent.
-- Rows indicate grants, not proof of readable rows; do not dismiss them using RLS.
select c.oid::regclass as table_name
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and (has_any_column_privilege('anon', c.oid, 'SELECT')
    or has_any_column_privilege('anon', c.oid, 'INSERT')
    or has_any_column_privilege('anon', c.oid, 'UPDATE')
    or has_table_privilege('anon', c.oid, 'DELETE'))
order by 1;

-- A5. Investigate unpinned definer functions. Compare platform functions with
-- the saved V0/P2f baseline; a platform-owned function is not silently a new app bug.
select p.oid::regprocedure as function_name, pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                  where cfg like 'search_path=%')
order by 1;

-- A6. Targeted effective grants after B3/B20. B3 diagnostic_results should have
-- only table SELECT/INSERT/UPDATE for authenticated. B20 activities should have
-- only table SELECT/INSERT plus column UPDATE(status); no anon grants on either.
select r.rolname, c.oid::regclass as table_name, privilege.name as table_privilege
from pg_roles r cross join pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as privilege(name)
where r.rolname in ('anon', 'authenticated') and n.nspname = 'public'
  and c.relname in ('diagnostic_results', 'reading_activity_assignments')
  and has_table_privilege(r.oid, c.oid, privilege.name)
order by 1, 2, 3;

select r.rolname, a.attname as activity_column,
       has_column_privilege(r.oid, c.oid, a.attnum, 'UPDATE') as can_update
from pg_roles r cross join pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where r.rolname in ('anon', 'authenticated') and n.nspname = 'public'
  and c.relname = 'reading_activity_assignments'
order by 1, a.attnum;

-- A7. Public functions that client roles can EXECUTE. Compare with the "expected EXECUTE" list
-- in the current group's verify_*.sql file. anon should be false for every application
-- function. A trigger function (returns trigger) should be false for both roles.
select p.oid::regprocedure as function_name,
       p.prorettype::regtype as returns,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname <> 'rls_auto_enable'
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
order by 1;

-- A8. Policy inventory (public and storage). Compare the per-table counts with the totals in
-- the current group's verify_*.sql file. RESTRICTIVE rows are the B16/M5 boundary policies.
select schemaname, tablename, permissive, cmd, count(*) as policies
from pg_policies where schemaname in ('public', 'storage')
group by 1, 2, 3, 4 order by 1, 2, 3, 4;
