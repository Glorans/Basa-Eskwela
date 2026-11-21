# M5/M6 staff practice and M6 F5 Preview (Appendix N)

Status: implemented on `feat/m5-m6-staff-practice` and rehearsed locally. **Not pushed, no SQL applied to Staging, not deployed.**

## What changed

### System Admin: M5 F1–F7 and M6 F1–F4
- **Pages:** Reading Practice (`/system-admin/practice`) and Practice History (`/system-admin/practice/history`), in the sidebar.
- **Content:** every published reading module, in every school.
- **Flow:** read aloud → M5 result (English Azure pronunciation, Filipino transcript-based) → Continue to Questions (the same module and passage) → M6 result.
- **Reuse:** the existing School Admin and Teacher practice pages and scoring. Nothing is duplicated.

### School Admin
- **Practice now covers** their school's published modules (any author) and platform modules. It used to cover only modules they created.
- **Never** another school's module: it answers "not found", and the database refuses its completion.

### Teacher
- **Unchanged:** their school's and platform modules.
- **Newly refused:** another school's module, at database level too.

### All staff
- Results are saved under the staff account only.
- No XP, badge, reading day or progress (M8 rewards learners only).
- Excluded from Student analytics.
- One comprehension per module passage, as for every account. Readings can be repeated.
- A School Admin or Teacher without a school is refused (fail closed).

### M6 F5 Preview (every role)
- **Endpoint:** `GET /api/comprehension/preview?moduleId&passageId[&roomId&assignmentId]`, read-only.
- **Content:** category, question text and choices, in the order the assessment presents them. Never the correct answer, explanation, supporting evidence or hint.
- **Access:** the same rule as starting the assessment:
  - a Student: only a module assigned in their classroom, or open for personal practice;
  - staff: their school's and platform modules.
- **Side effects:** it creates, resumes and uses nothing. The one official Student attempt is untouched.
- **Entry points:** "Preview Questions" on the staff practice list and beside "Start Read-Aloud" on the Student and Independent Learner module page. The Independent Learner's own-material preview is unchanged.

## Database (`supabase/proposed/`, stored `-text`)

| File | Purpose |
| --- | --- |
| `m5_m6_staff_practice_PROPOSED.sql` | **Required.** Replaces `m6_assert_completion_access(uuid)` with one staff rule (System Admin, School Admin, approved Teacher; school-scoped). Guarded by the live md5 `c9a82099…`. |
| `m5_m6_staff_practice_VERIFY_READONLY.sql` | 7 rows. Before applying: 6 PASS / 1 FAIL ("applied"). After: 6 PASS / 1 FAIL ("not applied yet"). |
| `m5_m6_staff_practice_ROLLBACK_PROPOSED.sql` | Restores the live body byte-for-byte. |
| `m7_staff_practice_queue_PROPOSED.sql` | **Optional.** `m7_enqueue_completion()` skips every staff role (it already skipped School Admins). Guarded by md5 `56388560…`. |
| `m7_staff_practice_queue_VERIFY_READONLY.sql` / `_ROLLBACK_PROPOSED.sql` | 4 rows: 3 PASS / 1 FAIL before and after, as above. The rollback restores the live body byte-for-byte. |

Neither migration changes a table, column, policy, grant, score, reward or existing row.

## Verification (local)
- **Rehearsal:** `release-review/m5-m6-practice-20261121/rehearse_m5m6.py` passed **32/32** on a fresh restore of the verified backup `2026-11-21_085033_preM1MultiTenancy`, with M1 applied exactly as on Staging. It covered:
  - School 2 created through the real F8, F9, F10 and F11 flows;
  - the gaps reproduced before the migration;
  - M3 module → M5 reading → M6 answers → completed, for the System Admin, School Admins and Teachers of both schools;
  - 4 cross-school completions refused;
  - M8 totals and every learner, M2, classroom and content table byte-identical;
  - the M7 queue before and after the tidy-up;
  - both rollbacks byte-exact, then a clean re-apply.
- **Tests:**
  - PGlite: `server/tests/m5m6StaffPracticeProposal.test.js`;
  - services and HTTP: `server/tests/m5m6StaffPracticeAndPreview.test.js`;
  - frontend: `readflow/tests/m5m6StaffPracticePreview.test.ts`.

## Staging release order (each step needs approval)
1. Back up Staging and verify the backup with a restore.
2. Run VERIFY read-only: 6/1, where only "applied" fails.
3. Apply `m5_m6_staff_practice_PROPOSED.sql`, then VERIFY: 6/1, where only "not applied yet" fails.
4. Optionally apply `m7_staff_practice_queue_PROPOSED.sql`, then its VERIFY: 3/1.
5. Deploy the backend.
6. Deploy the frontend.

The SQL is safe with the old backend, because it only widens what the database allows and the old backend still applies its narrower rules. The new backend without the SQL would let the System Admin and School Admins start practice but not complete it, so the **SQL goes first**.

**Recovery:**
- Run the ROLLBACK file(s). Completed practice attempts are kept.
- Redeploy the previous backend and frontend.

## Still to verify live (manual, on Staging)
- Real microphone and Azure recordings for the System Admin, a School Admin and a Teacher, including an English Teacher reading with the pronunciation check (Teacher M5 F2–F4 have never run live).
- The Student and Independent Learner preview pages in the browser.
- The Filipino preview strings, which still need the usual translation review.
