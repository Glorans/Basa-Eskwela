# M3/M4 final corrections before M5 — report

November 4, 2026, Philippine time. M5 pronunciation, recording, scoring and feedback were not touched. No staging reads or writes, migrations, paid Gemini/Azure calls, commits, pushes or deployments were made. All database work ran in the disposable container `basa-m3m4-proposals-LOCAL` (restore of this morning's staging backup plus the installed bank fix); it has been rolled back to that state and stopped. English Reading Set and the installed bank fix were not touched.

Exact operational steps for every migration are in **`docs/M3_M4_ROLLOUT_RUNBOOK.md`**.

## A. Implemented and ready for localhost

These work on localhost against staging today. Database-dependent features stay hidden until their migration exists, and the browser tests check that they don't appear.

| Feature | What you see on localhost now | Evidence |
| --- | --- | --- |
| Difficulty badges (previous pass) | Badge top-right on one line, all widths | `learner.mjs` (real shell, 320–1280px, EN/FIL) |
| Generation messages (previous pass) | Provider-neutral stages | `collections.mjs` |
| **Regeneration keeps bank size** (Phase 1 req. 7) | Choosing a different size than the saved bank asks for confirmation; Cancel keeps the bank. Six-only on staging, so this appears once 6/9/12 is installed | `collections.mjs` |
| Legacy rooms | Unchanged: language picker kept, no conversion panel | `m4Prototype3.mjs`, `m4ClassroomDetailsActions` |
| Stale browser assertion fixed | `learner-delivery.mjs` now expects the intended `?passageId=` read-aloud link (see Phase 8) | passes |

Implemented and **gated** (each appears automatically after its migration; tested with mocks in the browser and against the full schema):

| Feature | Gate | Code |
| --- | --- | --- |
| 6/9/12 per passage, per-passage selector | `m3_passage_bank_sizes()` | editor, service, backend route (previous pass) |
| Delete Reading Module → Trash, Restore, Delete Permanently | `m3_trashed_modules()` | `Module3Page`, `moduleService`, `moduleDeletionMessage` |
| Revise Module + Versions list | `m3_module_revisions(uuid)` | `AdminCollectionEditor`, `adminCollectionService` |
| Whole Class / Selected Students | `m4_module_targeting_enabled()` = true (installed **and** enabled) | `ClassroomDetailsPage`, `classroomService`; M5 start filter |
| Archive / Restore classroom (Teacher and Admin pages, student labels) | `rooms.archived_at` column exists | `RoomArchivePanel`, Learning Rooms (Active/Archived), room pages, join message |
| Audited Admin removal of an enrolled student | `m4_admin_classroom_actions()` lists `remove_enrollment` | `AdminClassroomDetailsPage`, `classroomService` |

**One M5-file change, authorization only:** `server/services/oralReadingAttemptService.js` now skips selected-students assignments for which the student isn't a recipient when it resolves which classroom assignment a module start belongs to. Before the migration, rows have no `targeting_mode`, so nothing changes. No pronunciation, recording, scoring or feedback code was touched. Hard enforcement is in the database regardless (see B4).

## B. Database changes ready for approval

All are in `supabase/proposed/`, each with a `_ROLLBACK_PROPOSED.sql`. All are tested individually and together; a full reverse rollback restored all 85 data/grant fingerprints and every original function fingerprint.

### B1. `m3_variable_passage_banks_PROPOSED.sql` — 6/9/12 questions per passage
- **Purpose:** banks of 6/9/12 with equal literal/inferential/critical; six stays the default.
- **Objects:** replaces `m3_save_passage_bank` and `m3_collection_publish_issues`; adds `m3_passage_bank_sizes()`.
- **Security:** signatures and grants unchanged; gate readable by authenticated/service_role only. Existing 6-banks unaffected. M6/M7/M8 already size-agnostic: snapshots, percentages, XP per module.
- **Deploy:** backend (count validation, gate check before any paid call), then frontend, then SQL.
- **Preflight/backup:** fingerprints `13e35ccb…`/`e6985165…` (the file's guard enforces them), phase1 function present, full backup + restore test.
- **Rollback:** exact restore; refuses while a 9/12 draft exists; `drop function m3_passage_bank_sizes()` hides it at once.

### B2. `m3_module_trash_PROPOSED.sql` — recoverable Delete Reading Module
- **Purpose:** Delete → Trash (hidden everywhere); Admin Trash review; Restore (draft → draft; ever-published → **archived**, needs a validated Publish); Delete Permanently only from Trash and only without history.
- **Objects:** `m3_module_trash` (no FK, by design: an FK would make every trashed module look like it has history; this was found and fixed in testing); `m3_trash_module`, `m3_restore_module`, `m3_purge_module`, `m3_trashed_modules`; replaces `m3_protect_deleted_module` with two narrow exemptions usable only inside those RPCs. `m3_delete_module` is unchanged.
- **Security:** Admin-only; learners never see trashed modules (restrictive RLS); trashed modules can't be assigned or started. RLS lets Teachers technically read a trashed *published* module row, but every app query filters `deleted_at`; no change proposed.
- **Deploy:** frontend any time; SQL after. **Preflight:** fingerprints `fd19df94…`/`08d59851…` (guarded). **Rollback:** exact; trashed modules stay hidden.

### B3. `m3_module_revisions_PROPOSED.sql` — Revise published module (**decisions pending**)
- **Purpose:** an Admin creates a separate editable draft copy of a published module. New module/passage/question IDs; copied keys; all questions back to review; normal publication. The original and its assignments and results are never changed.
- **Objects:** `modules.revision_of/revision_root/revision_number` (immutable, one open revision per source); `m3_revise_module`, `m3_module_revisions`, a link-protection trigger.
- **Pending decisions:** (1) hide the original after a revision is published? (2) may a learner earn module XP again for a revision? Current M8 rule: once per module ID, so yes by default. No M8 change is proposed. Approve these before applying.
- **Deploy:** frontend any time; SQL after the decisions. **Rollback:** refuses while revisions exist.

### B4. `m4_module_recipients_PROPOSED.sql` + `_ENABLE_` — selected-student module assignment
- **Purpose:** Whole Class (dynamic; future enrollees included) or Selected Students (fixed list, at least one enrolled student).
- **Objects:** `room_modules.targeting_mode`; `room_module_recipients`; `m4_targeting_rollout` (off); `m4_assign_module`; `m4_module_assigned_to`; a restrictive student read policy; **new `m4_enforce_module_recipient` triggers on `oral_reading_attempts` and `m6_comprehension_attempts`**; `m4_module_targeting_enabled()`.
- **Security:** the earlier blocker is closed in the database. The M5/M6 backends write attempts with the service role (bypassing RLS), but triggers still fire, so a non-recipient's M5 or M6 attempt on a selected assignment is refused for every writer. This was tested with service-role inserts for both tables. Subject, publication, owner and removal checks are unchanged and still enforced. Whole-class and catalog (non-classroom) starts are unaffected. Hiding the *module itself* from non-recipients in the public catalog is a separate product decision (not done).
- **Deploy:** backend (start filter) and frontend → foundation SQL (off) → verify → separate ENABLE.
- **Rollback:** disable any time; full rollback refuses while selected assignments exist.

### B5. `m4_room_archive_PROPOSED.sql` — Archive / Restore classroom
- **Purpose:** archive a room without deleting anything; the room code stays reserved.
- **Objects:** `rooms.archived_at/archived_by` (protected); `m4_set_room_archived`; `m4_reject_archived_room` triggers on enrollments, `room_modules`, `reading_activity_assignments`, `oral_reading_attempts`, `m6_comprehension_attempts`.
- **Security:** while archived, joins, new assignments and new M5/M6 attempts are refused for every writer. History stays readable; M7/M8 records untouched. Teacher (owner, approved) **and Admin** may archive/restore; the Admin part is the decision in C.
- **Deploy:** frontend any time; SQL after. **Rollback:** refuses while a room is archived.

### B6. `m4_admin_classroom_actions_PROPOSED.sql` — audited Admin student removal
- **Purpose:** the one Admin gap that can be closed without M5/M6 authorization changes.
- **Objects:** `m4_admin_actions` (audit), `m4_admin_remove_enrollment`, `m4_admin_classroom_actions`.
- **Security:** Admin-only RPC; direct Admin deletes stay blocked; the actor is recorded (no Teacher impersonation).
- **Rollback:** drops the RPCs and keeps the audit table.

### Admin permission review (Phase 6)

| Function | Admin today | After proposals | Remaining work |
| --- | --- | --- | --- |
| View classroom info | ✅ read (RLS `is_admin`) | ✅ | — |
| View enrolled students | ✅ read | ✅ | — |
| Remove enrolled students | ❌ (Teacher-only delete) | ✅ audited RPC (B6) | — |
| Archive / restore classroom | n/a | ✅ (B5) | decision |
| Assign reading modules | ❌ | ❌ | `m6_assert_completion_access` and `m4_module_assigned_to` require `assigned_by` = room Teacher. Needs an M6 authorization change with tests. |
| Assign reading activities | ❌ | ❌ | `m5_can_assign_activity` requires Teacher-owned material; M6 requires `assigned_by` = Teacher and material owner = Teacher. Needs M5/M6 authorization changes. |
| Manage uploaded materials | read ✅, delete-if-unused ✅; edit/upload ❌ (owner-only, storage path is the uploader's) | unchanged | Admin edit of others' materials needs an RLS + storage-policy proposal; not prepared (no decision yet) |

## C. Features blocked by dependencies or decisions

1. **Admin assigning modules/activities:** blocked on M5/M6 authorization changes. Out of scope until M5/M6 work begins.
2. **Revise Module:** proposal ready; needs the two decisions in B3 (catalog visibility of the original; repeat XP).
3. **Selected Students:** fully enforced once installed, but **ENABLE is a separate approval**. Hiding targeted modules from non-recipients in the open catalog needs a product decision.
4. **Archive by Admin:** included per your adviser; confirm, or remove the `is_admin()` branch.
5. **Legacy NULL-subject rooms (Phase 7):** no conversion. `m4_legacy_room_subject_PROPOSED.sql` is kept for later and was not applied anywhere except the earlier disposable test (rolled back). Inventory (backup at 01:59 today; rerun the read-only query in the runbook before acting):
   - **English Reading Room** (Grade 5 - Rizal): 3 students; 4 activities (3 Filipino, 1 English); 1 comprehension attempt.
   - **Grade 5 Filipino Class** (Grade 5 - Nicole): 2 students; 2 Filipino activities; 2 attempts.

   **Safe cleanup plan, not performed:** once B5 is installed, the owning Teacher **archives** each old room. Archiving deletes nothing, keeps the code reserved, and preserves results and XP. Don't delete these rooms: they hold learner attempts. Create new English/Filipino rooms for Prototype 3 testing.

Read-only inventory query (safe on staging):
```sql
select r.room_name, r.section, r.created_at::date,
  (select count(*) from public.enrollments e where e.room_id = r.id) as students,
  (select count(*) from public.room_modules m where m.room_id = r.id) as modules,
  (select string_agg(u.language, '+') from public.reading_activity_assignments a join public.uploaded_materials u on u.id = a.material_id where a.room_id = r.id) as activity_languages,
  (select count(*) from public.m6_comprehension_attempts t where t.room_id = r.id) as attempts
from public.rooms r where r.subject is null order by r.created_at;
```

## D. Final M3/M4 manual testing checklist (Appendix N)

Capture for every row: a screenshot of the result, the account role used, the date and time, and for database-dependent rows the runbook verification output. ⚑ = needs its migration (B#) first. "Paid" = Gemini call, only with your approval.

**Admin**

| Appendix N function | Steps | Expected result |
| --- | --- | --- |
| M3-2 Create reading module | New module, 2 passages, set language/level/difficulty, Save Draft | Draft saved; difficulty defaults from the level |
| M3-2 question bank (Paid) | Generate per passage; ⚑B1: choose 9 or 12 | Stage messages; bank of the chosen size; 3/3/3 or 4/4/4 split |
| M3-2 size change ⚑B1 | Choose a different size and press Generate New Set, then Cancel | Confirmation; bank unchanged after Cancel |
| M3-4 Edit reading module | Edit a never-published draft | Saved; published modules read-only |
| M3-4 Revise ⚑B3 | Published module → Revise Module → Confirm | New draft opens; questions "Needs review"; original unchanged; Versions shows both |
| M3-7 Publish reading module | Review all banks → Publish | Published; learners see it at the matching level |
| M3-5 Delete reading module ⚑B2 | Delete → Cancel, then Delete → Confirm | Cancel keeps it; Confirm moves it to Trash and hides it from catalogs |
| Trash Restore / Delete Permanently ⚑B2 | Restore a trashed draft; restore a trashed published module; Delete Permanently an unused draft | Draft returns as draft; published returns **archived** (republish needed); permanent delete only for unused items |
| M3-6 Organize by difficulty | Filter by difficulty | Correct grouping |
| M3-8 / M3-10 Uploaded content | View, delete an unused material | Shown; in-use materials protected |
| M4-4 View classroom | Admin → Learning Rooms → a room | Details read-only |
| M4-8 View enrolled students | Open the roster | List shown |
| Admin remove student ⚑B6 | Roster → Remove → Confirm | Student removed; audit row; results kept |
| Archive/Restore as Admin ⚑B5 | Archive, then Restore | Archived banner; Restore reopens |

**Teacher**

| Appendix N function | Steps | Expected result |
| --- | --- | --- |
| M4-1 Create learning room | Create English and Filipino rooms | Subject required and saved read-only |
| M4-2 View room code | Open room | Code shown |
| M4-5 Edit learning room | Edit name/section | Saved; subject locked |
| M4-6 Assign reading module (Whole Class) | Assign English Reading Set to an English room | All students see it; other-language modules not offered |
| M4-6 Selected Students ⚑B4 + ENABLE | Selected Students with none checked → Assign; then check 1–2 students → Assign | Empty selection rejected; badge "Selected students · N"; only those students see and can start it |
| M4-7 Assign reading activity | Whole class and individual students | Matching-language materials only |
| M4-8 / M4-9 Enrolled students | View, Remove → Confirm | Removed; past results stay |
| Archive classroom ⚑B5 | Archive → Cancel, then Confirm; then Restore | Moves to *Archived Learning Rooms*; assignment buttons disabled; Restore reopens |
| M3-1 / M3-9 Upload & review questions (Paid for new sets) | Upload EN/FIL material; review an existing set | As in the earlier plan |

**Student**

| Appendix N function | Steps | Expected result |
| --- | --- | --- |
| M4-3 Join learning room | Join by code; ⚑B5 try joining an archived room | Joins; archived room refused with the archived message |
| M3-3 View reading module | Reading Materials at phone and desktop widths | Badges on one line; recommended level shown |
| Assigned module (Whole Class) | Open from the room, read aloud, answer | Works as before; results saved |
| Selected assignment ⚑B4 | As a non-recipient, open the room; open the module from the catalog | Assignment not listed; a classroom start is refused ("selected students only") |
| Archived room ⚑B5 | Open an archived room | Banner; saved work visible; new activities refused |

**Independent Learner**

| Appendix N function | Steps | Expected result |
| --- | --- | --- |
| M3-3 View reading module | English and Filipino catalogs | Published modules only; trashed or archived modules never shown |
| M3-1 / M3-8 Upload and view own material | Upload, view, delete unused | Works; only own materials |
| Practice a published module | Read aloud + comprehension | Works; no classroom context required |

## E. Recommended rollout order

1. **Approve** the decisions in C (Revise XP and visibility, Admin archive) and the migrations you want.
2. **Back up staging and restore-test** the backup (runbook §0).
3. **Deploy backend, then frontend** (Render, when you choose). Everything new is hidden, so staging behaves exactly as today. Spot-check six-question generation (paid, optional), whole-class assignment, and an M5/M6 start.
4. **Apply in order:** B1 → B2 → B3 → B4 foundation (off) → B5 → B6, running each runbook verification before the next. Every file refuses to run on unexpected definitions.
5. **Manual Appendix N checks** for each enabled feature (D).
6. **ENABLE Selected Students** (B4) last, after the security test in the runbook passes.
7. Archive the two legacy rooms only if you choose to (C5).

Staging and Render stay compatible in any order: old app + new database keeps the old behavior (for example, old Delete still uses `m3_delete_module`, the old backend always generates six). New app + old database hides every new feature.

## Phase 8 — test results

| Check | Result |
| --- | --- |
| Frontend suite | **960 passed**, 0 failed |
| Backend suite | **588 passed**, 0 failed |
| In-memory database proposal tests | **56 passed**, 0 failed |
| Full-schema, each proposal (apply → test → rollback, exact fingerprints) | 6/9/12 ✔, Trash ✔, Revisions ✔, Recipients ✔, Archive ✔, Admin actions ✔ |
| Full-schema, all six combined in rollout order + full reverse rollback | ✔ all tests pass together; 85 fingerprints and original function fingerprints restored |
| TypeScript + production build | ✔ |
| Browser: learner (badges, real shell) | ✔ |
| Browser: collections (Revise, 6/9/12, size-change confirm, messages) | ✔ |
| Browser: content management (Trash) | ✔ |
| Browser: learner delivery | ✔ after fixing the stale assertion |
| Browser: M4 Prototype 3 (targeting, archive, Admin removal, subjects, roster) | ✔ |
| Browser: responsive overflow (28 fixtures) | ✔ |
| Browser: Filipino UI review | ✔ (0 failures) |

**Failing-test review:** `learner-delivery.mjs` was the only failing browser test. It was a **stale assertion**: commit `7b20708` (2026-10-25) intentionally made read-aloud links carry `?passageId=…` so the passage being viewed is the one read; the test (last changed 2026-10-19) predates it. Fixed in the test. Separately, the first run of some browser suites after new imports can time out while Vite re-optimizes dependencies; the rerun passes. That's a fixture artifact, not a defect.

**Bugs found and fixed during testing:**
1. Trash FK made every trashed module look historical.
2. A React hook placed after an early return on the classroom page (caught by the browser test).
3. The archive test's assignment check was too weak.
4. Realm-unsafe error handling in the classroom page.

**Privacy and authorization:**
- New read RPCs are Admin-only (Trash list, Versions, Admin actions), or scoped to the room owner and the student's own recipient row.
- anon can call none of them (tested).
- No new direct write grants; every new write goes through an RPC that checks role, ownership and Teacher approval.

## Files changed in this pass

- **Runtime:** `readflow/src/modules/module3/components/AdminCollectionEditor.tsx`, `module3/services/{adminCollectionService,moduleService}.ts`, `module3/utils/moduleDeletionMessage.ts`, `module3/pages/Module3Page.tsx`, `module4/services/classroomService.ts`, `module4/pages/{ClassroomDetailsPage,AdminClassroomDetailsPage,LearningRoomsPage,JoinClassroomPage,StudentClassroomPage}.tsx`, `module4/components/RoomArchivePanel.tsx` (new), `server/services/oralReadingAttemptService.js` (authorization filter only).
- **Tests:** `readflow/tests/browser/module3/{collections,contentManagement,learner-delivery}.mjs`, `readflow/tests/browser/m4Prototype3.mjs`, `readflow/tests/{m4ClassroomDetailsActions,m4ActivityFeedback,m4Classroom,m4LearningRoomsPage,m5M6Workflow}.test.ts` (the last: stub helper only), `server/tests/oralReadingAttempts.test.js`, `supabase/tests/m4ModuleRecipientsProposal.test.cjs`, `supabase/tests/full-schema/{m4_module_recipients,m4_room_archive,m3_module_trash,m3_module_revisions,m4_admin_classroom_actions}_full_schema_test.sql` (new).
- **SQL proposals:** `m4_module_recipients_PROPOSED.sql` (updated) + `_ENABLE_` + `_ROLLBACK_`; new `m4_room_archive`, `m3_module_trash`, `m3_module_revisions`, `m4_admin_classroom_actions` (each with `_ROLLBACK_`).
- **Docs:** this report and `docs/M3_M4_ROLLOUT_RUNBOOK.md`.
- **Outside the repo** (disposable test tooling): `%LOCALAPPDATA%\BasaEskwelaLocal\release-review\m3m4-proposals\` (`run_proposal_test.sh`, `run_combined_rollout_test.sh`, earlier runners).

All earlier uncommitted work and the six excluded files were left in place.
