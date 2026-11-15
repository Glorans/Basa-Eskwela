# M1 — Provisioning the first System Admin

There is **no public System Admin registration**, by design.
- The Register page offers only Teacher, Student and Independent Learner.
- `assign_own_role` accepts only `student` and `general_user`.
- The profile-protection trigger blocks every role change made from the browser.

A System Admin can only be created by the database owner.

## Prerequisites

1. `supabase/proposed/m1_system_admin_role_PROPOSED.sql` is applied, after:
   - a verified backup;
   - every PREFLIGHT row in `m1_system_admin_role_VERIFY_READONLY.sql` being `ok = true`.
2. Every POST-APPLY row is `ok = true`.
3. The backend and frontend from this branch are deployed (backend first).

## Steps (Supabase dashboard, by the project owner)

1. **Authentication → Users → Add user**: enter the System Admin's email and set a strong password (or send an
   invite).
   - Do **not** sign in and choose a role on the Register page.
2. **SQL Editor** (runs as `postgres`, which the protection trigger allows):

   ```sql
   update public.profiles
      set role = 'system_admin', full_name = 'System Administrator', status = 'active'
    where id = (select id from auth.users where email = lower('<system-admin-email>'))
      and role is null
   returning id, role;
   ```

   - Exactly **one** row must be returned.
   - Zero rows means the account already has a role. Stop and investigate; do not overwrite it.
3. Sign in as that account. The app opens **/system-admin/users**.

## What a System Admin can and cannot do

- **Can:**
  - F2–F5 (sign in, reset their password, view and edit their profile);
  - F6 view every account and its role;
  - F7 delete Independent Learner and School Admin accounts;
  - F8 create School Admin accounts.
- **Cannot:**
  - delete itself, another System Admin, or Teachers and Students (those belong to the School Admin);
  - change anyone's role;
  - reach classrooms, content, results, analytics or rewards. `is_admin()` and every server `admin` check still mean
    School Admin only.

## Removing a System Admin

There is no in-app path. The database owner either sets `role = null` (the account then has no access), or deletes
the auth user in the dashboard. Both are deliberate owner actions.
