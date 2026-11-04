# M3/M4 manual-feedback implementation and proposals

November 4, 2026, Philippine time. No staging writes, paid API requests, deployment, commit or push were performed. The already-installed bank-save correction was not reapplied. Your successful manual generation/save/publication/learner-visibility check of **English Reading Set (3 passages, 18 questions)** is accepted as completed; the earlier report's pending paid integration item is superseded by your feedback.

## 1. Changes implemented locally

### Language / Reading Level / Difficulty

The Admin editor now presents these three fields instead of the long Learning Path selector. A read-only staging GET confirmed exactly one path for each pair:

| Language | Reading level | Existing path ID | Default difficulty |
| --- | --- | --- | --- |
| English | Frustration | `8dbb798c-bc6b-4ea1-a78c-24e752946440` | Easy |
| English | Instructional | `e9675f2f-9607-4371-a135-8251a2c61c36` | Medium |
| English | Independent | `c7730e66-8778-4add-8ebe-8fcd88a3dd9f` | Hard |
| Filipino | Frustration | `6e712165-b161-4463-a2a6-7cba4123f06b` | Easy |
| Filipino | Instructional | `d25a2a15-8d03-4c2b-8105-1e49e2469fe7` | Medium |
| Filipino | Independent | `6cce7582-bad3-425e-8ae6-4c6f3a4a756b` | Hard |

The form still saves `learningPathId`, never a new/reconstructed path. Changing the pair defaults difficulty from that path; the Admin can override difficulty independently, preserving legitimate combinations and M8 XP rules. Loading an existing module preserves its saved difficulty. Missing or duplicate pair mappings show an explanation and cannot be saved by silently choosing the first row. M2 placement, recommendations, room subject restrictions and path records are unchanged.

### Question-generation experience

- Provider-neutral messages distinguish creating questions, saving, checking an uncertain result, and saved/refreshing.
- An authenticated read-only progress endpoint reports actual server stages; it rechecks Admin access on every poll. A very fast save may finish between polls, so the UI can go directly from creating to saved.
- Synchronous editor and service guards coalesce repeated clicks. The backend also rejects overlapping requests for the same module/passage/revision before invoking generation.
- Backend responses no longer expose provider exception wording. Technical diagnostic messages remain in logs with configured secret, bearer-token, URL and known key-pattern redaction.
- A timeout/network failure never automatically sends a second generation POST. The client first reads the saved collection and authenticated job status. A new six-question bank with new IDs and a newer revision is shown as saved. A known failed job permits an explicit retry; an unresolved outcome offers **Check saved questions** and remains blocked.
- A pending marker survives same-tab reloads through session storage; failed storage access falls back to memory. The backend registry is process-local, not a durable distributed job system. A backend restart or different instance can lose status; recovery then stays conservative instead of authorizing a blind retry. Cross-instance exactly-once generation requires a durable idempotency/job migration and is not claimed here. Do not clear an unresolved marker merely to force another paid request; inspect saved state first.
- The existing model and generator's bounded invalid-output repair behavior are unchanged. Transport/provider timeouts are not automatically retried. A user-initiated generation may still make the existing repair request for invalid generated output; this is distinct from a timeout retry.

### Learner badge and classroom subject

The difficulty badge no longer shrinks or wraps its text. Metadata can wrap onto another row; long English/Filipino path text can break without pushing the badge outside the card. Browser checks cover all three difficulty labels at 320, 375, 768 and 1280px.

Task 7 was already implemented: both assignment forms use saved `en`/`fil` as read-only subject text; NULL rooms retain language selection. It was reverified without backfilling subjects or inferring them from names. No M4 runtime change was needed.

## 2. Changes requiring a database migration

### Six / nine / twelve questions per passage

Proposal: `supabase/proposed/m3_variable_passage_banks_PROPOSED.sql` (not applied).

The selector should operate **per passage**, since generation, bank identity, review and assessment questions are passage-scoped. A module-wide default could prefill new passage choices later, but must not silently resize existing banks.

The proposal replaces the corrected `m3_save_passage_bank` definition while retaining its signature, authorization/locking, revision checks, immutable published/history rules, feedback validation, answer-key alias fix and existing grants. Generate accepts 6/9/12 with 2/3/4 questions of each type. Review preserves all saved IDs and the bank size; changing size requires explicit regeneration. Delete still accepts only an empty payload. Publication readiness retains the phase-one title/text/review/key checks and adds the allowed total and equal category distribution checks. No saved question, module or assessment row is rewritten.

The current backend passage route still generates six; the shared generator already accepts a requested count for other material workflows. Rollout requires approved route validation for only 6/9/12, passing that count into generation, changing frontend exact-six readiness and review/preview text, and a per-passage selector. These changes are **not enabled** in the staging UI. Relevant frontend surfaces include `modulePassageModel`, `questionState`, `PassageBank`, `ReadOnlyPassageBank`, `publishIssues`, and generation recovery's six-question check. They must agree with the selected count before activation. Existing 6-question banks must continue to work without migration of their data.

The proposal test executes the actual replacement functions with the original lock, revision and phase-one readiness functions over synthetic PostgreSQL tables. It covers 6/9/12 generation/review, unchanged IDs, invalid totals/distribution, stale revisions, published protection, missing keys and nonadmin rejection. Full M5/M6/M8 delivery for 9/12 is not certified by those synthetic tests: before release, audit passage question selection, response denominator/completion and XP-once integration with existing attempts, without altering historical snapshots.

Recommended order: approve design → run full-schema compatibility tests → deploy backward-compatible count-aware backend/editor behind a capability gate → apply reviewed SQL → verify actual readiness/function versions → enable selector → manually validate disposable 6/9/12 banks. Default remains six. Rollback must not truncate 9/12 banks; retain compatible functions until unpublished larger banks are safely handled.

### Student-specific module assignment

Proposal: `supabase/proposed/m4_module_recipients_PROPOSED.sql` (not applied).

Current `room_modules` has one unique `(room_id,module_id)` relationship, with no Student target. Assignments grant access by classroom enrollment; uploaded activities separately carry `student_id`. Adding checkboxes to the current insert would not restrict access.

The proposed foundation adds:

- `room_modules.targeting_mode`, defaulting existing assignments to `whole_class` without changing their IDs.
- `room_module_recipients(room_module_id,student_id)` with no direct authenticated write grants.
- An atomic `m4_assign_module` RPC checking the actual approved owning Teacher, published/nondeleted module, saved subject, future/empty due date, distinct nonempty recipients and current enrollment. It locks enrollment rows while inserting parent and recipients. Existing duplicate assignment uniqueness remains.
- `m4_module_assigned_to` for new-start eligibility, respecting membership, approved owner, subject, publication, recipients and Remove state. Caller access is scoped; the service role can check the authenticated Student supplied by its trusted route.
- A restrictive Student SELECT policy alongside existing policies, immutable targeting, and a rollout gate that defaults **off** for selected assignments.

**This SQL is a tested foundation, not a complete security rollout.** `server/services/oralReadingAttemptService.js` currently loads `room_modules` through the service role and checks enrollment/removal only. That bypasses RLS. M6 completion authorization likewise refers to assignment identity/enrollment, not recipients. A recipient-policy-only deployment could still allow another enrolled Student to start a restricted assignment through a direct backend request. Do not enable the gate or UI until all module start/selection paths enforce recipient eligibility. No M5/M6/M7/M8 business logic was changed under this request's restrictions.

The public/published catalog and activity authorization are distinct: the current published-module read helper intentionally allows learners to browse published content. A targeted assignment must deny unauthorized **activity starts** even if the module remains discoverable. Hiding the module itself from an unassigned learner, including independent General Users, needs a separate product decision and catalog-policy design.

Recommended rollout:

1. Approve targeting and future-enrollment rules below; inspect actual schema/functions/grants.
2. Test on a full disposable database with existing whole-class assignments, completed and in-progress attempts, M7 attribution and M8 ledger snapshots.
3. Apply the reviewed foundation with selected-assignment gate OFF.
4. In a separately authorized change, update every service-role module-start path to enforce the helper, preserve existing attempt completion/history contracts, and add direct-HTTP cross-student tests. Verify subject/owner checks even when calling APIs without the UI.
5. Add capability-aware UI: Whole Class / Selected Students, enrolled checkboxes, empty-selection validation, RPC integration and student-specific lists. Keep it hidden if support is missing.
6. Only after those tests pass, separately enable the gate and UI. Monitor failures before wider use.

Proposed rules: **Whole Class is dynamic**—future enrollees inherit access. **Selected Students is an immutable user-ID list**—new enrollees do not inherit it. Removing enrollment blocks new starts; rejoining restores that Student's original selection. Remove/Restore remains assignment-wide and retains recipients/history. Changing recipients or assigning the same module repeatedly is not implemented by this proposal; decide whether to support additive recipients or separate assignment instances later. Never delete/reuse assignment IDs referenced by history. Disabling/dropping recipient restrictions while selected rows exist would broaden access, so rollback must retain them and use a forward fix.

## 3. Changes requiring a product-design decision

### Revise Module

The disappearing Edit button is intentional: the catalog only offers Edit for never-published drafts, the editor is read-only after publication, and `m3_lock_collection` refuses edits to published/previously-published or referenced content. This protects assessments. Do not unpublish or reset `published_at` to bypass the guard for English Reading Set.

Recommended workflow (design only, no schema-dependent implementation):

1. Admin selects **Revise Module**. An authorized atomic RPC locks the source snapshot and creates a new draft with a new module UUID, new passage UUIDs, new question UUIDs and copied answer keys. Copy source provenance and ordering; never reuse assessment identities. Record source module/version and source revision for audit.
2. Proposed metadata: module family/root ID, `supersedes_module_id`, version number unique within a family, revision author/time. Add provenance links for cloned passages if needed; these are not foreign-key replacements for old attempts.
3. Copied questions require fresh review. The new module has draft status and NULL publication timestamp. Editing text invalidates review as it does now. Normal readiness checks gate release.
4. Publishing the revision creates a new published version; it does not overwrite or delete the old one. Existing classroom assignments and completed/in-progress attempts remain pinned to old module/passage/question IDs. Assigning the revision uses a new assignment and requires an explicit Teacher decision.
5. Old records remain readable for history. Do not mark the old version deleted/archived automatically: current completion authorization checks publication availability. A future “superseded” catalog indicator must be separate from revoking historical/in-progress access.

Decisions before implementation: whether a revision appears as a second catalog entry or a family with a current version; who promotes the current version; whether future whole-class assignments choose current version automatically (recommended: explicit version); whether unchanged banks must all be reviewed (recommended: yes); and handling concurrent revision drafts. M8 duplicate/revision XP eligibility needs explicit policy approval—do not silently change XP or treat new UUIDs as an automatic fresh reward. Migration tests must snapshot old attempts/responses/XP and prove unchanged history after clone, edit, publication and new assignment.

## 4. Files modified in this pass

Runtime:

- `readflow/src/modules/module3/components/AdminCollectionEditor.tsx`
- `readflow/src/modules/module3/services/adminCollectionService.ts`
- `readflow/src/modules/module3/utils/learningPathSelection.ts` (new)
- `readflow/src/components/basa/ModuleCard.css`
- `server/routes/adminModulePassages.js`
- `server/services/passageGenerationJobs.js` (new)

Tests:

- `readflow/tests/m3AdminCollectionExtraction.test.ts`
- `readflow/tests/m3AdminCollections.test.ts`
- `readflow/tests/m3LearningPathSelection.test.ts` (new)
- `readflow/tests/browser/module3/collections.mjs`
- `server/tests/adminModulePassages.test.js`
- `server/tests/passageGenerationProgress.test.js` (new)
- `supabase/tests/m3VariableBanksProposal.test.cjs` (new)
- `supabase/tests/m4ModuleRecipientsProposal.test.cjs` (new)

Proposals/documentation:

- `supabase/proposed/m3_variable_passage_banks_PROPOSED.sql` (new)
- `supabase/proposed/m4_module_recipients_PROPOSED.sql` (new)
- This report.

All other existing work was left in place, including the original ambiguity correction, unrelated Filipino documents, M7 edits, badge-page edits, demo checklist and existing proposals. No excluded files were staged. The existing M3 bank/save changes were extended, not replaced.

## 5. Verification

All automated writes use mocks or in-memory PostgreSQL. A temporary preload blocked external networking during tests. No paid generation was used in browser fixtures.

| Check | Result |
| --- | --- |
| Full frontend regression suite | 940 passed, 0 failed |
| Full backend regression suite | 573 passed, 0 failed |
| Final affected M3 frontend rerun after preview-refresh handling | 178 passed, 0 failed |
| New database proposals, isolated PostgreSQL | 12 passed including parent tests, 0 failed |
| M3 browser | Passed: generation/saving/saved stages, mapped metadata and difficulty default, draft editing/review/publication, badges at 320/375/768/1280px with English/Filipino path names |
| Existing M4 browser | Passed: both saved subjects, legacy fallback, module filtering, Philippine deadline, 1280/375px roster, Remove Cancel/Confirm and Admin view-only panel |
| Final TypeScript and production build | Passed |
| `git diff --check` | Passed |

The backend tests prove duplicate suppression, authenticated status access, neutral timeout responses and no retry after an uncertain database save response. Frontend service tests prove saved-bank recovery and that repeated checking of an unknown outcome sends no second generation POST. Proposal tests initially needed assertion corrections: a balanced smaller bank reaches review-size validation, and RLS-denied UPDATE can return zero rows rather than throw. Both corrected tests pass. One M4 browser run timed out loading alongside other heavy work; the isolated rerun passed without an application change. Build warnings about chunk size and mixed static/dynamic imports remain nonblocking.

The checks do not certify the future targeting rollout's service-role start paths or full historical 9/12-question assessment behavior; those approval-dependent integration gates are explicitly listed above. Temporary verification helpers were removed; ignored test logs remain in `.tmp`.

## 6. Localhost testing against staging

The implemented form, badge and generation UX need no migration. Start/restart the backend and frontend with **Terminal → Run Task → Basa: Start local dev (backend + frontend)** so the new progress endpoint is loaded. Verify `http://127.0.0.1:5001/api/health`, then use `http://127.0.0.1:5174`.

Safe read-only checks: open existing module details, inspect the new metadata fields, view learner badges at phone widths, and verify both subject forms plus a NULL-subject legacy room. On a disposable draft, changing fields without Save does not write; Save writes staging as normal. Confirm a path/level change defaults difficulty and an existing custom difficulty survives reopening. Do not alter English Reading Set just to test the form.

Generation/Regeneration still calls the configured paid provider and writes banks when successful; it is **not** an offline preview. No new paid manual test is required to repeat your completed bank fix verification. The automated mocks demonstrate stages, timeout handling, duplicate suppression and recovery without charges. If you later approve a paid UX test, use a disposable draft and check the saved bank before any retry.

Neither larger-bank selectors nor Student-targeted module controls are exposed. Do not apply the proposals as part of ordinary localhost testing. Classroom creation/assignment and enrollment removal remain staging writes; no such records were created during automated checks.

## 7. Remaining Prototype 3 blockers and limitations

No migration is needed to manually test the local metadata/badge/generation UX changes. The larger banks, safe published revision workflow, and Student-targeted module assignments remain approval-dependent work. Selected targeting specifically cannot be safely released without the service-role access integration described above. Full Admin/Teacher management parity from the earlier audit remains unchanged.

Process-local progress cannot certify exactly-once behavior across server restarts or multiple backend instances. Unknown outcomes deliberately block regeneration until saved state can be established. A durable job ledger is the appropriate future solution if multi-instance operation or recoverable cross-session retry is required.

Do not commit, apply migrations or deploy until the proposals and manual localhost results are reviewed.
