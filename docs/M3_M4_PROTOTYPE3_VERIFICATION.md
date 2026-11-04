# M3/M4 Prototype 3 verification and localhost guide

Verified November 4, 2026 (Philippine time). Workspace remains on `main` at `c227a67`.

## Outcome and preservation

The existing M3 and M4 implementation passes the local checks below. No application code, authorization policy, staging record, migration, Render configuration, assessment result, or XP was changed in this pass. No Gemini/Azure request, commit, or push was made.

The initial 34 modified/untracked files were fingerprinted. All retain their initial contents except `readflow/tests/browser/module3/contentManagement.mjs`, where one reload wait was corrected without replacing the pre-existing test changes. This also preserves all unrelated files, including the Filipino review/reports, M7 edits, and SQL proposals; no excluded file was staged or removed.

Preserved M3 work: deletion confirmation, Admin question-bank preview, path labels and difficulty defaults, publication feedback, and backend bank-save error classification. Preserved M4 work: saved subject display, legacy language selection, Philippine-time deadlines, and the shared Teacher/Admin roster panel.

## English/Filipino discrepancy

**No subject-mapping defect was reproduced. The historical A/B question cannot be proved from the supplied sentence alone.** Current staging data contains distinct rooms, consistent with explanation A; it does not establish which room was open in the earlier session. It would be inaccurate to declare that report conclusively mistaken or that a saved English room was converted to Filipino.

GET-only reads from ReadFlow-Staging returned:

| Room | ID prefix | Saved subject | Current enrollments |
| --- | --- | --- | ---: |
| test room | `9b453dce` | `en` | 0 |
| Baitang 5 | `5ec6b83e` | `fil` | 0 |
| Grade 5 Filipino Class | `d633c94f` | NULL | 2 |
| English Reading Room | `9e529b0e` | NULL | 3 |

These are current observations, not a historical enrollment audit. Room names are not subject metadata: in particular, the two legacy room names do not make their subjects non-NULL.

The creation form sends `en`/`fil` unchanged; `createClassroom` inserts that value, and `getClassroomById` reads the row by ID. `RoomLanguageSelect` maps `en` to English and `fil` to Filipino. Both assignment forms receive the saved room subject. They filter content by saved language metadata, and NULL rooms keep the selectable language filter. Existing unit tests, new browser checks, and the isolated subject SQL tests pass for both languages and legacy compatibility. No speculative production fix was made.

To settle the old report conclusively, its creation response and displayed room URL would need matching room IDs. If a new mismatch occurs, capture those IDs plus the returned `subject`; do not infer subject from the room name.

## Admin permission audit

- The current Admin classroom UI is implemented as monitoring: room information, enrollment roster and assigned-module views. Teacher routes are separately role-guarded. This implementation does **not** yet meet full Admin/Teacher feature parity requested by the adviser.
- `removeEnrolledStudent` sends a direct authenticated DELETE to `enrollments`. There is no Express removal endpoint and no removal RPC in this path. The browser uses the signed-in user's session.
- The checked-in M4 policy permits DELETE only when `m4_current_role() = 'teacher'` and the room's `teacher_id = auth.uid()`. Admin receives SELECT policies. The M1 restrictive approval policy also blocks unapproved Teachers.
- The baseline already grants `authenticated` table-level DELETE. That grant alone does not bypass RLS. In an in-memory PostgreSQL test using the actual baseline/M4 policies and approval helper, Admin can read the roster but DELETE returns zero rows. Another Teacher, the Student and an unapproved owner also cannot remove it. The approved owner can.
- **Live-policy limitation:** the staging REST reads verify records/columns, not `pg_policies` or live grants. The permission conclusion is demonstrated against repository SQL, not a live Admin DELETE. No destructive permission probe was sent to staging.
- Merely adding an Admin Remove button would be wrong: the current service checks only `error`, so an RLS-filtered zero-row deletion could be shown locally as success. A future implementation must confirm a returned deleted ID or an explicit RPC result before updating the roster.
- No Teacher impersonation is necessary or acceptable. Passing a Teacher ID cannot change `auth.uid()`. Do not borrow a Teacher token, change ownership, or use a service-role deletion to bypass the caller's checks.

**Recommendation, requiring separate approval:** implement narrowly scoped Admin enrollment removal using an additional Admin DELETE policy on `enrollments`, preserving the existing owner/approval checks. A future migration could be named `m4_admin_enrollment_removal_PROPOSED.sql`; it has not been created or applied. With the recorded grants, this needs an RLS change, not an additional table grant or a replacement join function. Inspect live policies/grants first. If an audited RPC is chosen instead, authorize the actual Admin/owning Teacher inside it, restrict execute grants, and record the real actor separately from the room owner. Return a definite result. This is a separate change from granting Admin all other Teacher functions.

Removal deletes the enrollment relationship, not the Student profile, room, reading activity, M5/M6 result, or M8 ledger. The reviewed schemas do not make those history/XP rows children of `enrollments`. Existing access checks depend on current membership, so classroom visibility, Teacher access and classroom leaderboard membership can change after removal even while saved records and total XP remain. The M7 enrollment trigger also queues reevaluation. Do not promise unchanged access or analytics membership. Before any approved permission rollout, add a full-schema test with completed history/XP and inspect live foreign keys/triggers; this pass did not remove a real enrolled Student.

## Verification results

| Check | Result |
| --- | --- |
| Full frontend suite | 938 passed, 0 failed |
| Full backend suite, serial execution | 570 passed, 0 failed |
| Isolated PostgreSQL tests: bank save, enrollment permissions, room subjects | 24 passed, 0 failed, including parent tests |
| TypeScript checks and Vite production build | Passed |
| M3 content-management browser suite | Passed; 390px and 1366px layouts, Cancel/Confirm, single deletion on double-click, failed deletion, persistence refresh, learner catalog visibility |
| New M4 browser suite | Passed; both subject labels, legacy fallback, matching module picker, Philippine deadline conversion, 1280px/375px scrolling roster, Remove Cancel/Confirm, Admin view-only panel |
| `git diff --check` | Passed |

The frontend suite covers module creation, draft passage editing, saved/draft bank states, read-only previews, path labels, difficulty defaults, publication validation, learner visibility, room creation/join/edit, deadline validation and roster behavior. Backend route tests use fake generation and persistence. The new bank SQL test executes the corrected function with the actual collection lock/revision functions over synthetic tables; it checks generate/regenerate/review/delete, exact six and 2/2/2 counts, invalid keys, stale revisions, foreign passages, nonadmin refusal, published-content protection and atomic rollback. Its role helper is a fixture, not live Supabase authentication.

Node test workers and Vite initially encountered Windows sandbox `EPERM` process-spawn restrictions; approved reruns passed. A temporary test preload blocked external network calls. The new M4 browser harness needed fixture wait/selector corrections before passing. The existing M3 browser test had a real test race: after reload it could count cards in the old document and then click during the new document's loading phase. It now waits for a changed `performance.timeOrigin` and the expected cards. This is the only correction to a pre-existing file.

Build warnings remain for a large JavaScript chunk and mixed static/dynamic imports. They did not fail the build. Browser tests use mocked persistence; they are not evidence of live authenticated staging writes.

## Files changed in this pass

1. `readflow/tests/browser/module3/contentManagement.mjs` — fix the reload wait; preserve existing assertions and changes.
2. `readflow/tests/browser/m4Prototype3.mjs` — isolated real-browser M4 acceptance checks.
3. `supabase/tests/m3PassageBankSave.test.cjs` — in-memory corrected function integration checks.
4. `supabase/tests/m4EnrollmentPermissions.test.cjs` — in-memory enrollment RLS and authenticated join checks.
5. `docs/M3_M4_PROTOTYPE3_VERIFICATION.md` — this report and manual guide.

No application runtime file or SQL proposal was edited. Temporary verification helpers were removed; ignored local logs remain under `.tmp`.

## Start localhost

1. Open this workspace in VS Code. Choose **Terminal → Run Task… → Basa: Start local dev (backend + frontend)**. Use the existing task rather than a generic `npm start` with a different environment.
2. Wait for the backend task to report its server and Vite to report `http://127.0.0.1:5174`. The tasks check the staging project and frontend API target before starting. Configuration was verified as staging + port 5001; the M7 background worker is currently disabled.
3. Open `http://127.0.0.1:5001/api/health`, or run:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:5001/api/health
   ```

   Expect `success: true` and `ReadFlow backend is running.` This confirms the HTTP server, not Gemini, Azure or database authorization. The endpoint was unreachable during this review because the backend was not running; the reviewer did not start the staging-connected application.
4. Open `http://127.0.0.1:5174`. If a task reports a busy port, check the existing task terminal and terminate only the duplicate task through **Terminal → Terminate Task…** before restarting.

Use existing staging test accounts: **Admin**, **approved Teacher who owns the test rooms**, and **Student** (Ana if that is your designated test account). A second approved Teacher is useful for checking ownership denial. A General User is optional for the independent learner catalog. No new accounts or role changes are needed for the first read-only checks. Use separate browser profiles/private windows for each role. Credentials are deliberately not included here.

## Manual testing order and expected results

**Localhost still uses the remote ReadFlow-Staging database.** The write column below distinguishes previews/Cancel from actions that persist to staging. Use disposable test content/accounts for the write cases; this review did not perform them.

| Order / role / location | Action and expected result | Staging write / paid call |
| --- | --- | --- |
| 1. Admin, `/m3/admin` | View Details on a draft and saved-bank module. Passage text, six question rows when present, 2 literal/2 inferential/2 critical counts, options, correct answer, hint and available explanation/evidence should be read-only. Missing/unreviewed banks should be identified. | Read-only; no paid call |
| 2. Admin, Create Reading Module | Select English then Filipino learning paths. Label includes language, reading level and tier; difficulty defaults to the selected tier. Manually changing difficulty shows a mismatch notice where appropriate. Save a uniquely named disposable draft, edit a passage, save and reload. | Save/create/edit writes; no Gemini needed for typed text |
| 3. Admin, draft editor | Validate an incomplete draft. Expect grouped module/passage issues and blocked publication. For an existing reviewed test bank, edit/review/save, then confirm six questions and 2/2/2 categories. Only a valid reviewed collection should publish. | Validation reads; bank review/publish writes; no Gemini unless generation is clicked |
| 4. Student, `/dashboard/materials` | Verify an unpublished draft is absent, including after reload; a published module follows normal placement/access rules. Do not start a reading attempt for this check. | Read-only; no paid call |
| 5. Admin, Content Management | Click Delete on a disposable draft, then Cancel: item remains. Only on disposable content, Confirm and reload: deletion persists. Published/referenced content should use preservation-aware wording and database behavior. | Cancel does not write; Confirm writes and can permanently delete an unused draft; no paid call |
| 6. Teacher, `/m3/teacher/learning-rooms` | Create uniquely named English and Filipino rooms; record each URL/room ID and displayed code. Open each and its assignment forms. Classroom Subject must be read-only English/Filipino respectively. Edit room name/section/description; subject must remain unchanged. | Create/edit writes; viewing code does not; no paid call |
| 7. Teacher, existing legacy room | Open a room whose stored subject is NULL. Expect the explanatory legacy message and selectable language filter. Choosing a language filters available content without changing the room subject. | Filter/view only; no paid call |
| 8. Student, `/dashboard/join-classroom` | Join the disposable room by its code. Expect the correct room; joining again should not duplicate enrollment. Teacher should see the Student after refresh. | Join writes enrollment; no paid call |
| 9. Teacher, disposable room | Assign an existing published module of the matching language. Opposite-language content and drafts should be absent from the picker. Test blank deadline, past date, earlier today and later today in Philippine time. Past times must be rejected; blank is allowed; future time displays in Philippine time after save/reload. | Successful assignment writes; invalid input does not; no paid call |
| 10. Teacher, Assign Activity | Select existing extracted material in the room's language and an existing reviewed bank, or the offered read-aloud-only mode. Test selected/all enrolled Students and the same deadline rules. Verify saved activity list after reload; do not start M5. | Successful assignment writes; no paid call using existing material/questions |
| 11. Teacher, Enrolled Students | Open/close roster at desktop and phone widths. Names/count agree, long lists scroll. Remove → Cancel preserves the test Student. On a disposable enrollment only, Confirm removes that enrollment and updates count; reload to verify persistence. | Cancel/read does not write; Confirm deletes enrollment and may queue analytics reevaluation; no paid call |
| 12. Admin, `/admin/learning-rooms` | Open the same room and Enrolled Students. Expect the shared roster, count and Close behavior, with no Remove action. This is current behavior, not full adviser-requested management parity. | Read-only; no paid call |

The staging read confirmed `room_modules.due_at`, `room_modules.removed_at`, and `reading_activity_assignments.due_at` exist. Presence is not proof that all optional constraints/RPCs are installed. Future-deadline checks were verified in the client/service; database-side future-date enforcement was not claimed. **Do not apply `m4_future_due_dates_PROPOSED.sql` for this guide.** Existing past deadlines stay intact, and deadlines are informational rather than a late-work lock.

## Paid actions and pending verification

- **Gemini:** Generate/Regenerate Questions (module passages or uploaded materials) can incur charges and persist a generated bank. Skip until you explicitly choose to approve that paid test. Existing bank preview/review, room operations and assigning existing content need no Gemini call.
- **Azure:** speech recording/assessment and Listen/TTS actions can incur charges. They are outside this M3/M4 pass; do not start diagnostics or M5 recording for these checks.
- The handoff says `m3_save_passage_bank_fix_PROPOSED.sql` is already installed and verified. That installation was accepted as supplied, and the function was tested locally in memory. **Real Gemini → backend → installed staging bank-save integration remains pending manual verification.** The correction was not reapplied, and its live function body was not retrieved through REST.
- No automated blocker was found for beginning the manual M3/M4 checks after starting localhost. Full Admin/Teacher parity remains an approval-dependent product requirement. Live authenticated write flows remain manual because staging writes were prohibited during this review. The historical subject-report identity remains unresolved without its original room IDs.

## What to report if a manual check fails

Capture the role, room/module/passage ID, exact action, expected versus actual result and Philippine timestamp. Include browser Console errors and the failing Network request's method, URL path, HTTP status and sanitized response body. For subject mismatches, include the creation request's `subject`, returned room ID/subject and the subsequently opened room URL. For deadlines, include the entered Philippine time and submitted ISO `due_at`. For generation/save failures, include the matching backend terminal error and distinguish a generation failure from a database save failure.

Remove Authorization headers, API keys, cookies, session tokens, room join codes and unnecessary Student details before sharing. Report a successful-looking removal that reappears after refresh too: an RLS-filtered zero-row DELETE may return no API error. Stop repeated paid retries after a generation error until its cause is understood.

Verification is complete. Commit, deployment, additional database changes and Admin permission implementation remain for your later review after manual testing.
