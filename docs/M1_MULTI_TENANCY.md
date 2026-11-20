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

### The 13 Students in no Learning Room: verified 2026-11-21 (read-only on Staging, no personal data printed)

- All 13 have the Student role, are active, confirmed and have signed in. None is an Independent Learner (`general_user`), a role-less account or a Teacher.
- There is only one school today, and no record links any of them to anything outside it:
  - the oral reading they did was on modules authored by School 1 Teachers (7) and School 1 Admins (2);
  - one of them (S01) was removed from a School 1 Teacher's room by a School 1 Admin (`m4_admin_actions`), and still has one active reading assignment from that School 1 Teacher. That assignment is a pre-existing M4 leftover and not a school question.
- Their history (Initial Diagnostic results, oral reading, comprehension, M5, M7 and M8 rows) is untouched. The migration changes no row except `profiles.school_id`. The rehearsal (check S) proves their records and visibility are byte-identical.
- **Decision: the mapping to School 1 is retained.** Nothing in the data is ambiguous.

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
  - `m1_create_school` / `m1_update_school` (System Admin, service_role only);
  - `m3_collection_publish_issues` (M3 publish readiness, callable from the browser) authorizes itself before reading anything. The module must exist and the caller must be able to manage it: the owner Teacher, an Admin of the author's school, or the System Admin. Another school's module and an unknown id get the same refusal, so the answer reveals nothing, not even existence.
- **Inactive school:** accepts no new School Admins, Teachers (codes) or Students. Its accounts and records are kept. Schools are never deleted.

## Files

| File | Purpose |
| --- | --- |
| `supabase/proposed/m1_multi_tenancy_PROPOSED.sql` | Forward migration (one transaction). |
| `m1_multi_tenancy_PREFLIGHT_READONLY.sql` | Must be 6 PASS / 0 FAIL on Staging before applying. It checks the 16 replaced function bodies by md5. |
| `m1_multi_tenancy_VERIFY_READONLY.sql` | Must be 17 PASS / 0 FAIL after applying. |
| `m1_multi_tenancy_ROLLBACK_PROPOSED.sql` | Restores the 16 functions byte-for-byte (`-text`). It refuses once a second school exists. |

Local rehearsal (restored Staging copy, no network): `release-review/m1-multi-tenancy-20261121/rehearse_db.py`, **64/64**. It covers:

- preflight;
- forward and VERIFY;
- exact rollback, then forward again;
- per-account visibility identical for all 60 restored accounts;
- School 2 through the real flows;
- the 13 isolation checks;
- the M2 flow in both schools;
- M3 publish readiness: authorized and unauthorized access in both directions, an unknown id, and the publish trigger;
- the 13 Students in no Learning Room;
- M2 official results and history byte-identical.

Repository test: `supabase/tests/m1SchoolM3PublishIssues.test.cjs` (PGlite, real function bodies).

## Staging release (each step needs approval)

All from one commit of `feat/m1-multi-tenancy`, the same commit for the SQL, the backend and the frontend. Render auto-deploy is off.

1. **Backup.** Take a fresh verified Staging backup (the established `prepare_backup.py` pattern). Verify it by restoring it into a local container.
2. **PREFLIGHT** on Staging (read-only): 6 PASS / 0 FAIL. Stop on any FAIL.
3. **Prepare the deploys before the SQL:**
   - Set the backend and frontend services' commit to the release commit, but do not deploy yet.
   - Pick a quiet time, with no School Admin creating Teacher codes or invitations.
4. **Apply the forward SQL** in the Supabase SQL Editor. It is one transaction, so it applies completely or not at all.
5. **VERIFY** (read-only): 17 PASS / 0 FAIL. School 1 mapping INFO rows: 3 admin, 5 teacher, 39 student; 13 Students by role.
6. **Deploy the backend immediately** (Manual Deploy). Confirm `/health` and the deployed commit.
7. **Deploy the frontend.** Confirm the commit and the new asset hash.
8. **Check School 1** (existing accounts, read-only plus a sign-in):
   - System Admin: user list with a School column and the Schools page.
   - School Admin: their users, Teacher codes and results.
   - A Teacher: rooms, modules and M3 publish readiness.
   - A Student: room, history and results.
   - Rerun VERIFY. Confirm the per-table row counts are unchanged except `school_id`.
9. **School 2 (needs separate authorization):** the System Admin creates School 2, then invites a synthetic School Admin. That admin creates a Teacher code, approves a synthetic Teacher, creates a room, and a synthetic Student joins.
10. **Isolation and M2:**
    - No School 1 account sees School 2 and the reverse (users, rooms, results, modules, publish readiness).
    - A cross-school join is refused.
    - The M2 flow (publish, assign, official result) works in School 2.
    - The M2 switches are unchanged.

**Compatibility window (between steps 4 and 6).**

- The old backend cannot create Teacher codes or School Admin invitations:
  - the old invitation call no longer exists;
  - a code without a school is refused by the new NOT NULL rule.
- Everything else keeps working, because only School 1 exists and School 1 accounts see exactly what they saw before.
- Step 3 keeps the window to the length of one backend deploy, a few minutes. Nobody should create codes or invitations in that time.

**Recovery if a deploy fails after the SQL is applied** (no School 2 exists yet):

- **Backend deploy fails:**
  1. Redeploy (Render keeps the previous instance serving until the new one is healthy).
  2. If it cannot be fixed quickly, run `m1_multi_tenancy_ROLLBACK_PROPOSED.sql`. It restores the 16 functions byte-for-byte and removes the school objects.
  3. Keep the previous backend, which is compatible again after the rollback.
- **Frontend deploy fails:** the new backend works with the old frontend (only the Schools page and the school selector are missing). Redeploy the frontend, or roll back the frontend alone.
- **VERIFY fails or the data looks wrong:** run the ROLLBACK SQL, then rerun the PREFLIGHT checks. Every one should pass again except that the migration is no longer applied.
- **Last resort:** restore the step 1 backup.
- **After School 2 exists:** the rollback refuses. Fix forward.

## Known limits (not in scope)

- Moving an account between schools is not supported (the school is fixed once set).
- Independent Learners keep their previous read access to published school modules (unchanged behaviour).
