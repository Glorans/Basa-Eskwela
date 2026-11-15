-- PROPOSAL ONLY. NOT APPLIED. M1 five roles (Appendix N): adds the System Admin role.
--
-- Roles after this migration (profiles.role):
--   system_admin  System Admin  (NEW, platform level: M1 account management only)
--   admin         School Admin  (the existing Admin; every existing Admin account keeps all of its access)
--   teacher, student, general_user (Independent Learner)  (unchanged)
--
-- What changes:
--   1. profiles_role_check also accepts 'system_admin'.
--   2. public.is_system_admin(): true only for the signed-in System Admin (for future policies; nothing uses it yet).
-- What does NOT change:
--   * No row is updated. Existing 'admin' accounts are the School Admins, with all their current access.
--   * public.is_admin() still means School Admin only ('admin'), so a System Admin gains NO access to classrooms,
--     content, results, analytics or rewards through any existing policy or function.
--   * Nobody can become a System Admin by themselves: assign_own_role still accepts only 'student'/'general_user',
--     the Teacher invite RPC sets only 'teacher', and m1_protect_profile_authorization_fields still blocks every
--     role change from the browser (authenticated/anon). A System Admin is provisioned only by the database owner
--     (see docs/M1_SYSTEM_ADMIN_PROVISIONING.md).
--
-- Preflight / verify: m1_system_admin_role_VERIFY_READONLY.sql. Rollback: m1_system_admin_role_ROLLBACK_PROPOSED.sql
-- (refuses while any System Admin account exists).
begin;
set local lock_timeout = '5s';

alter table public.profiles drop constraint profiles_role_check;
-- NOT VALID, exactly like the current Staging constraint: enforced for every new or changed row, without
-- re-validating (or failing on) historical rows and without a full-table validation scan under the lock.
alter table public.profiles add constraint profiles_role_check
  check (role is null or role in ('system_admin', 'admin', 'teacher', 'student', 'general_user')) not valid;

create function public.is_system_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'system_admin');
$$;
revoke all on function public.is_system_admin() from public, anon, authenticated;
grant execute on function public.is_system_admin() to authenticated;
comment on function public.is_system_admin() is
  'True only for the signed-in System Admin (M1). Not used by any existing policy; is_admin() remains School Admin only.';

commit;
