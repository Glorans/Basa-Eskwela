# M1 — School isolation: current state and proposal (NOT IMPLEMENTED)

## Verified current state

- The database has **no `schools` table and no `school_id` column** on `profiles`, `rooms`, `enrollments` or any
  content table (checked against `supabase/staging/00_core_baseline.sql` and every migration in the repo).
- Basa Eskwela is therefore a **single-school deployment**: every Teacher and Student belongs to the one school.
- **School isolation does not exist.** Nothing in this M1 work claims or simulates it.

## How School Admin scope is enforced today (M1)

School Admin = the existing `admin` role. Its M1 account scope (`server/services/m1AccountScope.js`) is defined by
**role**, not by school:

| Manager       | F6 can view                     | F7 can delete                        | F8 create School Admin |
|---------------|---------------------------------|--------------------------------------|------------------------|
| System Admin  | all accounts                    | Independent Learners, School Admins  | yes                    |
| School Admin  | Teachers, Students              | Teachers, Students                   | no                     |
| Anyone else   | nothing (403)                   | nothing (403)                        | no (403)               |

- A School Admin can never see or delete Independent Learners, School Admins or System Admins.
- Nobody can delete their own account through User Management, and System Admin accounts can't be deleted there.
- The scope is enforced on the server, from the role stored in the database. The UI only reflects it.

This is correct for one school. If a second school is ever onboarded, a School Admin would see the other school's
Teachers and Students, so **a second school must not be onboarded until the proposal below is implemented**.

## Proposal (requires approval, a separate migration, and an app change — not prepared as SQL yet)

1. `public.schools (id uuid pk, name text not null, created_at timestamptz)`, with RLS: System Admin full read; a
   School Admin reads only its own school.
2. `profiles.school_id uuid null references public.schools(id)`, protected by
   `m1_protect_profile_authorization_fields`, the same way `role` is.
   - Null for System Admin and Independent Learners.
   - Required for School Admin, Teacher and Student; enforced by a check or trigger once the data is backfilled.
3. Backfill: create the one existing school, then set `school_id` for every existing admin, teacher and student.
   - Run this as a reviewed, reversible step.
4. Add `school_id` (or a derived check) to `rooms` and the teacher-invite flow, so new accounts inherit their school.
5. Server: `m1AccountScope` adds `target.school_id = manager.school_id` for School Admins.
   - F8 takes a `schoolId` chosen by the System Admin.
6. Update the existing `is_admin()`-based policies (M3–M8) to also compare school.
   - This is the largest piece of work and touches every module, so it needs its own audit.

Until then, the deployment is explicitly single-school.
