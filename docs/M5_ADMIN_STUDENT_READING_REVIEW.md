# M5 Admin Student Reading Assessments

**Status: local only. Do not deploy until the authorized scope below has been confirmed by the project adviser or the participating school.**

Admin can review students' saved oral-reading assessments (M5 F5 and F7) from the sidebar item **Student Reading Assessments**. The view is read-only. Admin's own practice readings stay in **Reading History**.

## Authorized scope
This scope is for the current **single-school prototype**.

- **In scope:** every account whose database role is `student`, whether or not the student is enrolled in a classroom.
- **Out of scope:** Independent Learners, Teachers and other Admins. Their attempts return the same 404 as an attempt that doesn't exist. This includes the requesting Admin's own attempts.

The schema has no school or organization field, so this rule can't separate schools. It must not be treated as permission across multiple schools or organizations; that would need a real school boundary and a new decision.

## How access is enforced
- Every request passes `authorizeAdminRequest`, which reads the Admin role from the database. Nothing the browser sends can grant access.
- Every read of one attempt goes through `getStudentAttempt` in `server/services/adminStudentReadingService.js`, which checks the owner's database role on each request.
- Recording links are issued only after that check, and expire after 5 minutes. The storage bucket stays private.
- The router has only `GET` routes. It can't change a result or start a pronunciation assessment, and it loads no speech code.
- No migration or RLS change was made. Data goes through the backend's service role; adding an Admin RLS policy would let the browser read student rows directly.

## Routes
All are under `/api/oral-reading/admin`:

| Route | Returns |
|---|---|
| `GET /students` | Students with saved readings: name and counts, no emails |
| `GET /students/:studentId/attempts` | One student's reading list |
| `GET /attempts/:attemptId` | One saved reading |
| `GET /attempts/:attemptId/pronunciation` | The saved check, without raw assessment data |
| `GET /attempts/:attemptId/recording` | 5-minute signed links |

The page is at `/admin/student-reading-assessments`.

## Access logging
Each request writes one server log line prefixed `[M5 admin student review]`, with only these fields:

| Field | Meaning |
|---|---|
| `adminId` | The verified Admin's ID; null if the requester wasn't verified as an Admin |
| `attemptId` | The reading attempt; null for list requests or a malformed ID |
| `at` | Access time (UTC) |
| `operation` | `list_students`, `list_student_readings`, `view_assessment`, `view_pronunciation` or `open_recording` |
| `outcome` | `allowed`, `not_found`, `forbidden`, `unauthenticated` or `error` |

Recording contents, transcripts, names, authentication tokens and signed recording URLs are never logged.

**Server logs are not permanent audit records.** They can rotate, be lost on restart or redeploy, and can't prove that a record is complete. A durable audit trail would need a dedicated table, which means a migration and a separate approval.

## Before deploying
1. Get the scope above confirmed by the adviser or participating school.
2. Deploy the backend before the frontend. On an older backend the page shows "could not be loaded" and exposes nothing.
