-- Read-only diagnostics: run in Supabase SQL Editor before applying the M5 repair.
-- Do not paste tokens or credentials into issue reports.
select to_regclass('public.reading_activity_assignments') as assignment_table;
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='reading_activity_assignments'
order by ordinal_position;
select c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class t on t.oid=c.conrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname='reading_activity_assignments';
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public'
and tablename in ('reading_activity_assignments','rooms','enrollments','uploaded_materials','modules');
select table_name, privilege_type from information_schema.role_table_grants
where table_schema='public' and grantee='authenticated'
and table_name='reading_activity_assignments';
-- If the table exists, separately check duplicates before creating the unique index:
-- select room_id,material_id,student_id,count(*) from public.reading_activity_assignments
-- group by room_id,material_id,student_id having count(*)>1;
