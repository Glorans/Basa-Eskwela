# M3/M4 Prototype 3 follow-up corrections

November 4, 2026, Philippine time. No staging reads or writes, migrations, backfills, paid Gemini/Azure requests, commits, pushes or deployments were made. Database work ran only in a new disposable container, `basa-m3m4-proposals-LOCAL` (127.0.0.1:55423). It was restored from the staging backup `2026-11-04_015918_preM3BankFix`, and the already-installed bank fix was re-applied so it matches current staging; its fingerprint is `13e35ccb…`, the live value. The container is stopped and kept. The evidence container `basa-m3fix-restore-LOCAL` was not modified.

## 1. Difficulty badges (fixed locally)

**Cause.** The previous fix kept the badge *text* on one line, but the badge sat after the learning-path name in a wrapping row. In real cards it dropped onto a row of its own below the path. That is what showed as "two lines" for Easy and Medium. Real path names are long ("Filipino Umuunlad na Mambabasa"), and the card grid chose 4 columns from the viewport width, ignoring the 250px sidebar. At 1024px each card's text area was only 106px wide. The old browser test used a bare `<div>` with no shell or grid, so it never saw this.

**Fix.**
- `ModuleCard` moves the badge into the card's top row, opposite the book icon (`white-space: nowrap`, `flex: 0 0 auto`). The path name now has its own full-width row.
- The learner card grid uses `auto-fill, minmax(min(100%, 13rem), 1fr)`, so columns follow the space beside the sidebar. 1280 and 1440px keep 4 columns; 1024px now gets 2 (text area 269px instead of 106px).
- The only other `.basa-badge` use (module detail header) is unaffected.

**Evidence.** `tests/browser/module3/learner.mjs` now renders the real Reading Materials page inside the real learner shell (sidebar, header, padding) with the real seeded English/Filipino path names. At 320, 375, 768, 1024 and 1280px in both languages it checks that every badge is on one line, unclipped, inside its card and not overlapping the icon, title or path, that the path doesn't overflow, and that the page doesn't scroll horizontally. A scratch probe also covered 900 and 1440px. Before the fix, 12 of 14 width/language combinations had misplaced badges; after it, 0. The fixture also needed `refreshModules` in its mocked context; it was already broken without it.

## 2. Question-generation messages (verified, no runtime change)

Not seeing "Gemini" is expected. The editor shows exactly these stage messages: *Creating questions for this passage. This may take a little while…*, *Questions are ready. Saving your question bank…*, *Checking whether your questions were saved…*, *Questions saved. Refreshing the preview…*, then *N questions generated and saved…*. Every error response from the passage route is a fixed neutral sentence; provider details go only to the redacted server log. Backend and service tests already assert that "Gemini" never reaches the response.

The browser test previously covered only two stages. It now records every status message shown, using mocks only, and asserts all four stages plus the success message. It asserts no message mentions gemini/google/api key/model/provider. It also asserts that an uncertain save never sends a second generation request: Check saved questions only reads.

Out of scope, not changed: the separate uploaded-material question-set workflow (`server/routes/materials.js`) passes the generator's error text through. A Teacher/Admin there can still see wording like "Gemini took too long to generate questions."

## 3. 6/9/12 questions per passage (implemented behind a database gate)

**Audit on the full-schema restore.** The only six-only rules are in `m3_save_passage_bank` and `m3_collection_publish_issues`, which the proposal replaces. Downstream code already handles any bank size:
- **M6** loads every reviewed question of the passage, freezes them in `question_snapshot` and scores against the snapshot length.
- **M7** takes `question_count` from each snapshot.
- **M8** module XP depends only on difficulty and reading level, once per module.
- Uploaded-material sets already use 3/6/9/12 (`m3_write_material_question_set`).

Existing attempts keep their snapshots, so historical results and XP cannot change.

**Gate.** The migration adds `m3_passage_bank_sizes()`, which returns `{6,9,12}` (authenticated + service_role only). Until it exists:
- the editor shows no selector and behaves exactly as today;
- the backend refuses 9/12 with a 409 before any generation, so no paid call is made;
- a request without a count still means six.

**Application changes (inactive on staging until the gate exists).** Per-passage selector (6/9/12, default the saved size or six). Size-aware status chip, readiness, read-only preview and success message. The requested size is stored in the recovery marker, and recovery accepts only a new bank of that size. Count validation and the gate check run before generation. The save-refusal mapping covers the new database wording. The publish-issue parser understands both the current wording and the 6/9/12 wording; six-question messages are word-for-word unchanged.

**SQL.** `supabase/proposed/m3_variable_passage_banks_PROPOSED.sql` (updated) aborts unless both replaced functions still have the reviewed fingerprints. `…_ROLLBACK_PROPOSED.sql` (new) drops the gate first, restores the exact previous definitions, and refuses while any unpublished draft holds a 9/12 bank.

**Full-schema results** (`supabase/tests/full-schema/m3_variable_banks_full_schema_test.sql`, runner `%LOCALAPPDATA%\BasaEskwelaLocal\release-review\m3m4-proposals\run_m3_variable_banks_test.sh`):
- gate absent before the migration; guard passes, gate `{6,9,12}` after;
- as the real Admin, generating 6/9/12 gives equal categories and answer keys; review keeps IDs and size; readiness is empty only when ready;
- 0/3/7/15, unbalanced 9, wrong-size review and stale revision are refused with no change;
- publication goes through the real trigger, and the published bank is immutable;
- Teacher/Student cannot write; anon cannot read the gate;
- a second run is blocked by the guard;
- 86 fingerprints of history/content tables and function grants unchanged.

The rollback restored both fingerprints exactly, and its guard refused while a 9-question draft existed.

**Rollout sequence for approval:**
1. Approve the design and SQL.
2. Back up staging (same backup procedure as before) and restore-test the backup.
3. Deploy backend and frontend (backend first). With no gate, behavior is unchanged; spot-check that six-question generation still works.
4. Preflight read-only: confirm both function fingerprints and that `m3_collection_publish_issues_phase1` exists.
5. Apply `m3_variable_passage_banks_PROPOSED.sql`.
6. Verify: gate returns `{6,9,12}`, new fingerprints recorded, grants unchanged, row counts and data hash unchanged.
7. Manually test on a disposable draft: selector visible; one 9 and one 12 bank (paid, only with your approval); review, publish, learner attempt and results.
8. Rollback, if needed: run the rollback file (or just `drop function public.m3_passage_bank_sizes();` to hide 9/12 at once).

## 4. Legacy classroom subjects (audit + proposal + gated UI)

**Audit** (staging backup at 01:59 today; rerun read-only on live staging before applying, since rooms may have changed):

| Room | Subject | Students | Modules | Activities (incl. removed) | M6 attempts | Conversion |
| --- | --- | --- | --- | --- | --- | --- |
| English Reading Room (Grade 5 - Rizal) | NULL | 3 | 0 | 4: 3 Filipino, 1 English | 1 | **Conflict: refused**; keeps the picker |
| Grade 5 Filipino Class (Grade 5 - Nicole) | NULL | 2 | 0 | 2 Filipino | 2 | Filipino only |
| (two newer rooms) | en / fil | — | — | — | — | already set |

"English Reading Room" is mostly Filipino content, which shows why the subject must never be inferred from a room's name.

**Current database:** setting a NULL subject is **not possible**. `m4_protect_room_subject` rejects any change to `rooms.subject`, including NULL → value, by design.

Affected objects:
- `rooms_subject_check` constraint;
- `m4_protect_room_subject` trigger;
- `m4_check_assignment_subject` (`room_modules` and `reading_activity_assignments` triggers; it skips NULL rooms);
- `m4_protect_assigned_language` (module, path and material language locks apply only to rooms with a subject);
- the room RLS policies (Teacher owner, approval policy, Admin view-only).

No M5/M6/M7/M8 function reads `rooms.subject`. Conversion therefore changes only future assignment filtering and language locks; it changes no assignment, attempt, response, analytics or XP row.

**Proposal.** `supabase/proposed/m4_legacy_room_subject_PROPOSED.sql`, with rollback `…_ROLLBACK_PROPOSED.sql`:
- `m4_set_legacy_room_subject(room, subject)` is for the room's **approved owning Teacher** only, and only while the subject is NULL.
  - It locks the room and the assigned content, and allows a subject only when everything ever assigned (including soft-removed rows) is in that language.
  - Mixed or unknown content is refused.
  - Every conversion writes an audit row in `m4_room_subject_conversions`.
- `m4_legacy_room_subject_options(room)`: read-only options for the owner, and view-only for Admins. It also serves as the UI gate.
- The trigger exemption works only inside the setter. Direct updates stay blocked.
- `m4_check_assignment_subject` gains `FOR SHARE` on the room, so a new assignment and a conversion cannot pass their checks at the same time.
- Guarded by the reviewed fingerprints. No backfill: both legacy rooms remain NULL after the migration.
- **Admin conversion is deliberately not included** (Admins are view-only for rooms today). Allowing it is a product decision.

**Full-schema results** (`supabase/tests/full-schema/m4_legacy_room_subject_full_schema_test.sql`, runner `run_m4_legacy_subject_test.sh`):
- options are correct for the Filipino-only room, the mixed room and the Admin; other Teachers and Students are refused;
- mixed room refused for both languages; wrong language and invalid value refused; Filipino saved once, then "already set"; direct updates blocked;
- the audit row is correct; no other table changed;
- after conversion, an English assignment and an assigned material's language change are both refused;
- an unapproved Teacher is refused; anon has no access; the guard blocks a re-run;
- 85 fingerprints unchanged.

**Two-session race test** (`run_m4_concurrency_test.sh`):
- an English assignment in flight → the conversion waits, then refuses;
- a conversion in flight → the English assignment waits, then refuses.

Data was restored afterwards and fingerprints matched. The rollback restored both functions' fingerprints exactly.

**UI.** On the Teacher's classroom page, a NULL-subject room shows a Classroom Subject panel only when the options RPC exists:
- **Allowed subject:** preselected; Save asks for confirmation, then both forms switch to the read-only subject.
- **Mixed content:** an explanation; the picker stays.

On staging today the RPC is absent, so the page is unchanged and the legacy picker stays. The browser test checks the gate, the mixed explanation, Filipino-only Cancel/Confirm, and both forms locking afterwards at 1280 and 375px.

**Rollout sequence for approval:**
1. Approve. Decide whether Admins may convert (default: no).
2. Back up staging and restore-test it.
3. Deploy the frontend (no visible change).
4. Preflight read-only: rerun the audit query and confirm both fingerprints.
5. Apply the proposal.
6. Verify: gate RPC present, both legacy rooms still NULL, fingerprints recorded, grants and data hash unchanged.
7. The Teacher of "Grade 5 Filipino Class" sets Filipino in the UI. Confirm both forms are read-only and the existing activities and results are unchanged.
8. "English Reading Room" stays on the picker. Converting it would first need its English or Filipino activities removed by a separate, explicit decision, and removed rows still count by design.

Keep the legacy fallback until every room is converted.

## 5. Files changed in this pass

Runtime: `components/basa/ModuleCard.tsx/.css`, `module3/components/LearnerReading.css`, `AdminCollectionEditor.tsx/.css`, `InlineRegeneration.tsx`, `BankSizeSelect.tsx` (new), `ReadOnlyPassageBank.tsx`, `module3/services/adminCollectionService.ts`, `module3/types/proposedPassageDatabase.ts`, `module3/utils/passageBankSize.ts` (new), `module3/utils/publishIssues.ts`, `module4/services/classroomService.ts`, `module4/pages/ClassroomDetailsPage.tsx`, `module4/components/LegacyRoomSubjectPanel.tsx` (new), `server/routes/adminModulePassages.js`.

Tests: `readflow/tests/browser/module3/{learner,collections}.mjs`, `{serve.mjs,fixture.tsx}`, `browser/m4Prototype3.mjs`, `m3PassageBankSize.test.ts` (new), `m3ReadOnlyPassageBank.test.ts`, `m3AdminCollections.test.ts`, `m3AdminCollectionExtraction.test.ts`, `m4ClassroomDetailsActions.test.ts`, `m4ActivityFeedback.test.ts`, `m4ClassroomService.test.ts`, `server/tests/adminModulePassages.test.js`, `supabase/tests/m3VariableBanksProposal.test.cjs`, `supabase/tests/full-schema/*.sql` (new).

SQL proposals: `m3_variable_passage_banks_PROPOSED.sql` (updated), `m3_variable_passage_banks_ROLLBACK_PROPOSED.sql`, `m4_legacy_room_subject_PROPOSED.sql`, `m4_legacy_room_subject_ROLLBACK_PROPOSED.sql` (new). All earlier uncommitted work and the excluded files were left in place.

## 6. Test results

| Check | Result |
| --- | --- |
| Frontend suite | 954 passed, 0 failed |
| Backend suite | 586 passed, 0 failed |
| In-memory database proposal tests | 56 passed, 0 failed |
| Full-schema M3 6/9/12 (disposable restore) | all checks passed; 86 fingerprints unchanged |
| Full-schema M4 legacy subject + two-session race | all checks passed; 85 fingerprints unchanged |
| Browser: learner (real shell, badges) | passed |
| Browser: M3 collections (messages, selector) | passed |
| Browser: M3 content management | passed |
| Browser: M4 Prototype 3 (incl. legacy conversion) | passed |
| Browser: responsive overflow | passed |
| Browser: M3 learner delivery | **fails, pre-existing**: expects `/read-aloud` without the `?passageId=` that committed code (unchanged here) adds |
| TypeScript + production build, `git diff --check` | passed |

## 7. Test now on localhost (no database change)

Restart with **Basa: Start local dev (backend + frontend)**.
- Learner Reading Materials badges at phone/tablet/desktop widths, English and Filipino.
- Generation messages. Optional: generating is a paid request, so use a disposable draft only if you choose to.
- New and legacy classrooms look exactly as before: no 6/9/12 selector and no conversion panel, because staging lacks both gates.

## 8. Needs explicit database approval

- `m3_variable_passage_banks_PROPOSED.sql`: enables 6/9/12.
- `m4_legacy_room_subject_PROPOSED.sql`: enables legacy-room conversion. Also decide on Admin conversion.

Neither is applied anywhere except the disposable container.
