# M1 Minimum Viable Multi-Tenancy (Appendix N F7–F11)

One Supabase database, many schools. Status: implemented on `feat/m1-multi-tenancy`, rehearsed locally,
**not applied to Staging, not deployed**.

## Ownership mapping

| Record | School comes from | Notes |
| --- | --- | --- |
| School Admin, Teacher, school Student | `profiles.school_id` (one primary school) | Set once and never changed (trigger). The browser can never set it. |
| System Admin, Independent Learner | none | CHECK constraint: never a school. |
| Learning Room, enrollment, room assignments, M4 actions | the room's Teacher (`rooms.teacher_id`) | A room cannot move to another school. |
| Student's school (new accounts) | the first Learning Room they join | Joining another school's room is refused. |
| Modules, passages, questions, materials | the author (`created_by` / `uploaded_by`) | Authors without a school = platform content, visible as before. |
| M2 packages and assignments | the package owner / the assigned Student | |
| Results (diagnostic, oral reading, comprehension, M7, M8) | the learner (`user_id`) | Nothing references `schools` with ON DELETE CASCADE. |
| Teacher invitation code | `teacher_invite_codes.school_id` | The redeeming Teacher joins that school (F10). |
| School Admin invitation | `m1_school_admin_invitations.school_id` | Acceptance assigns the school (F9). |

No other table gets a `school_id`.

## School 1 backfill (Staging data, read-only mapping 2026-11-21)

- School 1 = `SCHOOL-1`, name "School 1", `is_legacy`. The System Admin can rename it.
- School 1 gets: 3 School Admins, 5 Teachers, 39 Students, every Teacher invitation code and the 1 School Admin invitation.
- No school: 1 System Admin, 10 Independent Learners, 2 role-less accounts.
- **Ambiguous, reported rather than guessed:**
  - 2 role-less accounts stay without a school.
  - 13 Students who are in no Learning Room are assigned to School 1 by their role (Student role means school Student on a one-school platform). The VERIFY script prints their count for review.

## Enforcement

- **Backend:** service role, so RLS is bypassed. `server/services/schoolScope.js` limits every School Admin path to the requester's school, which is read from their database profile. Covered paths:
  - user list and F7 status;
  - Teacher codes;
  - F3/F5 results;
  - M5 student review;
  - M7 analytics, interventions and reports;
  - M2 packages, assignments and Try Assessment;
  - materials;
  - the Teacher and Student shared module catalogs.

  A School Admin without a school is refused (403).
- **Database:**
  - restrictive "M1 school isolation" policies on 16 tables;
  - write-guard triggers for SECURITY DEFINER RPCs;
  - school-aware helper functions (`m1_school_admin_sees_*`, `m4_admin_classroom_teachers`, M3 trash and revisions, `m5_can_read_activity`);
  - F7, F9, F10 and F11 functions;
  - `m1_create_school` / `m1_update_school` (System Admin, service_role only).
- **Inactive school:** accepts no new School Admins, Teachers (codes) or Students. Its accounts and records are kept. Schools are never deleted.

## Files

| File | Purpose |
| --- | --- |
| `supabase/proposed/m1_multi_tenancy_PROPOSED.sql` | Forward migration (one transaction). |
| `m1_multi_tenancy_PREFLIGHT_READONLY.sql` | Must be 6 PASS / 0 FAIL on Staging before applying. It checks the 15 replaced function bodies by md5. |
| `m1_multi_tenancy_VERIFY_READONLY.sql` | Must be 16 PASS / 0 FAIL after applying. |
| `m1_multi_tenancy_ROLLBACK_PROPOSED.sql` | Restores the 15 functions byte-for-byte (`-text`). It refuses once a second school exists. |

Local rehearsal (restored Staging copy, no network): `release-review/m1-multi-tenancy-20261121/rehearse_db.py`, **64/64**. It covers:

- preflight;
- forward and VERIFY;
- exact rollback, then forward again;
- per-account visibility identical for all 60 restored accounts;
- School 2 through the real flows;
- the 13 isolation checks;
- the M2 flow in both schools.

## Staging order (each step needs approval)

1. Fresh verified Staging backup (the established `prepare_backup.py` pattern), plus a restore rehearsal of that backup.
2. PREFLIGHT on Staging (read-only).
3. Apply the forward SQL, then VERIFY.
4. Deploy the backend (it reads `profiles.school_id`, so it must come **after** the SQL). Between steps 3 and 4 the old backend cannot create Teacher codes or School Admin invitations; every other path keeps working, because only School 1 exists.
5. Deploy the frontend (Schools page, school selector).
6. Create School 2 only after steps 3–5.

**Recovery:**

- Before School 2 exists: run the ROLLBACK SQL, then redeploy the previous backend and frontend.
- After School 2 exists: fix forward (the rollback refuses).
- If needed: restore from the step 1 backup.

## Known limits (not in scope)

- Moving an account between schools is not supported (the school is fixed once set).
- `m3_collection_publish_issues(id)` still returns issue text for any module id (ids are unguessable; read-only).
- Independent Learners keep their previous read access to published school modules (unchanged behaviour).
