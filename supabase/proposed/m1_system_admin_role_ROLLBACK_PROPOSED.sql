-- PROPOSAL ONLY. Rollback of m1_system_admin_role_PROPOSED.sql.
-- Refuses while any System Admin account exists (the old constraint would reject it); such accounts must first
-- be removed or given another role by the database owner, deliberately. No other row is touched.
begin;
set local lock_timeout = '5s';
do $$
begin
  if exists (select 1 from public.profiles where role = 'system_admin') then
    raise exception 'Rollback refused: System Admin accounts still exist.' using errcode = '55000';
  end if;
end $$;
drop function if exists public.is_system_admin();
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role is null or role in ('admin', 'teacher', 'student', 'general_user')) not valid;
commit;
