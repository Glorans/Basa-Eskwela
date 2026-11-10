# Independent Learner personal-material M5/M6 implementation

Local implementation review, 11 November 2026 (Asia/Manila). Final review addendum at the end of this document.

HEAD: `85fe5942f40615862d6abc44285cc76b02c6b89d`. No commit, push, deployment, Staging SQL application, real learner mutation, or paid provider request was performed. Existing unrelated working-tree changes were preserved.

## Implemented behavior

Independent Learners can confirm their saved extracted text, open the existing M5 recorder, save existing transcript-based feedback, repeat reading, generate a private nine-question set, start/resume the existing M6 assessment, and open saved results. No room, enrollment, Teacher assignment, catalog module, or Teacher-review permission is created.

The detailed actions live on View Material. The existing materials list retains Upload and View; for Independent Learners its Delete action is now "Remove from Reading Materials" with a confirmation that states what is retained (see Extraction and deletion). Personal M5/M6 navigation returns to the material. Existing published-module and classroom routes remain in place. English and Filipino use their existing language-specific scoring and UI. Azure code and pronunciation scoring are untouched; Filipino still has no unsupported pronunciation assessment.

The feature requires both proposed database changes before it can work against a database. Before installation, practice returns an unavailable message; existing upload and legacy deletion remain available. Do not treat the local implementation as deployed functionality.

## Installed Staging contracts verified read-only

The existing Staging connection was checked against project `oudfrdeqwotynihkkmze`. The connection enforced `default_transaction_read_only=on`, checked the transaction setting, queried catalogs only and rolled back. No learner records were selected. Captured metadata: 249 constraints, 136 functions, 67 triggers, 79 policies, 355 columns, 583 table-grant entries and 93 indexes. Raw metadata is in `.tmp/personal-material-staging-contracts.json` (local review evidence, not a migration).

The two uploaded-source constraints still require classroom assignment/room context. Material ownership and answer-key protections remain in force. M6 attempts retain a RESTRICT link to their saved oral reading. Existing material question sets cascade from materials, while questions, classroom assignments and module-source dependencies impose additional restrictions. This implementation keeps private banks separate and uses RESTRICT dependencies to retain them.

Some repository files named PROPOSED describe functionality already installed in Staging. In particular, the installed completion authorizer includes approved-Teacher practice, the one-assessment-per-activity guard is present, and the newer M8 performance-reward behavior is present. The proposal guards use the installed definitions, not earlier migration definitions:

| Installed function | CR-normalized definition MD5 |
| --- | --- |
| `m6_assert_completion_access(uuid)` | `b02ca1708f0d79c63b1240f2eeeaa285` |
| `m6_one_assessment_per_activity()` | `76e677bf797d8db768e11bc200abb539` |
| `m7_enqueue_completion()` | `e4a3dd2f01bd80db6ba590659068a92e` |
| `m8_on_comprehension_completed()` | `6c387f36c9af10a925533d68a44a7bd5` |
| `m8_oral_completed()` | `5e06d2ff932dd577d1e5f2ea3e185736` |
| `m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)` | `35c7a1328ebdfc9d0e6e6833cde2bdaa` |

## Database proposals and order

1. `personal_material_1_sources_PREFLIGHT_READONLY.sql`, then review `personal_material_1_sources_PROPOSED.sql`. This adds private review/deletion state, a service-only owner-authorized source resolver, narrowly extended M5/M6 source constraints, M5 source validation, and a partial unique index on `(user_id, material_id)` for personal assessments. It extends completion access and adds personal-only exclusions to the existing M7/M8 completion triggers. Run the matching VERIFY_READONLY file after a separately approved application.
2. `personal_material_2_questions_PREFLIGHT_READONLY.sql`, then review `personal_material_2_questions_PROPOSED.sql`. This adds protected private banks and generation leases, service-only access/generation functions, assessment-to-set provenance, snapshot/read-link validation, deletion-aware response guards and text/language immutability after practice starts. Run the matching VERIFY_READONLY file afterward.

All eight SQL files are proposals/read-only checks, not applied changes. Apply only after a fresh preflight, backup and separately authorized database rollout. Both forward files check function fingerprints; proposal 1 also checks the original source-constraint fingerprints. Unexpected definitions fail closed.

Rollback order is 2 then 1. Empty-install rollback was exercised locally and restores the original replaced-function fingerprints. Rollbacks deliberately refuse when saved banks, leases, review/deletion state or personal attempts would be lost. For a data-bearing installation, recovery means retaining the schema/data and disabling new personal practice at the application boundary while preparing a reviewed forward fix. Never erase history to make rollback pass. The SQL proposals do not require clearing existing learner histories.

## AI validation, quotas and costs

Private banks use `validation_state = 'ai_validated_private'`, not Teacher-reviewed. They are stored in `personal_material_question_sets`, with no catalog or classroom publication route. The existing Gemini generator performs language, structure, options, answer/explanation and complete supporting-evidence validation; the backend validates the returned bank again before persistence. SQL additionally checks the nine-question structure, balanced types, options, answer index and source evidence. Private API responses return set IDs/status, not keys or banks.

The source is server-loaded and owner-authorized. The existing prompt's document-as-data boundary remains unchanged. The 30,000-character generation limit remains. A source recheck after reservation and a database revision check at completion reject stale-source races.

Durable controls:

- Five successfully persisted new sets per user in the preceding 24 hours, using database time.
- One reusable set per material revision via a unique constraint.
- One active lease per user, serialized by a transaction-scoped advisory lock.
- Five-minute leases with random fencing tokens; expired/old workers cannot finish or release another worker's lease.
- Failed generation does not count toward the successful-set quota. Reuse calls do not call Gemini or consume quota.
- Every private generation request (new, reused or failed) is limited to 10 per learner per hour at the HTTP route (`429 PERSONAL_GENERATION_RATE_LIMITED`, `Retry-After`), checked before any provider call. Failed generations do not use the five-set quota, so this bounds repeated sequential failures. The limiter is in memory: it is per backend process and resets on restart.
- Existing generator limit: two candidates, with language-verification calls when reached; each configured provider request has a 30-second timeout. Transport/configuration failures are not retried by the application quality-repair loop.

The successful-set quota is not a monetary spending cap: failed provider calls can still incur costs, and repeated sequential failures are not counted as successes. Google also applies project/model/tier limits, visible in AI Studio. Actual cost depends on the configured model and billable token usage, including validation/repair calls; this task did not inspect billing or make a chargeable request. See Google's [rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits) and [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing). No new model or pricing promise is introduced.

## Authorization and assessment integrity

Session-derived identity is used throughout. Personal source access requires `general_user`, matching `uploaded_by`, completed extraction, supported language, usable text, explicit review of the current revision, and no deletion marker. Classroom/module identifiers are rejected in personal source requests. Client owner IDs and supplied passage text cannot determine ownership or scoring.

The new tables have RLS enabled and no anonymous/authenticated table access. New privileged RPCs are revoked from PUBLIC, anon and authenticated and granted to service_role only. Existing Teacher-review endpoints still reject Independent Learners. Admins retain their existing material oversight; Admin deletion of a material with private state uses the same history-preserving removal semantics. Service-role credentials stay server-side.

One personal material has one assessment row per user, enforced by a partial unique index with a non-null material identity. There is no nullable-assignment equality loophole. Repeated M5 readings are saved independently and resolve to the existing M6 assessment; completed assessments remain read-only. Regeneration cannot reset assessment identity. The original first-answer rule, scaffolding, per-question feedback reveal and score calculation are reused unchanged. Keys and explanations are withheld until that question has a final submitted answer.

## Extraction and deletion

Every personal upload requires explicit usable-text confirmation before practice, including older uploads whose original missing-page report is unavailable. New upload extraction warnings are persisted when the proposals are installed, and missing page numbers are displayed. Failure to save warning metadata leaves the material unconfirmed; the UI still requires review and explains that missing/unreadable pages are excluded. This is not a claim that scanned/blank PDF pages were extracted.

Personal removal is a database tombstone, not physical destruction. The Independent Learner library labels it "Remove from Reading Materials" and asks for confirmation first, stating that the uploaded file, saved text, private questions and saved results are kept, that an unfinished assessment becomes read-only, and that this is not a permanent deletion. The success notice, practice panel and M6 read-only message use the same removal wording. Teacher material deletion keeps its existing label, notice and behaviour (no new confirmation). It removes the item from the learner's library and blocks new reading, generation, assessment starts and unfinished answers. Original file, reviewed text, private question bank, completed reading/comprehension snapshots and saved recordings remain retained. Unfinished assessments stay in history but open read-only with a deletion explanation. Completed results remain accessible to their owner. Private dependencies prevent accidental FK cascades from destroying banks/history.

Rollout prerequisite: deploy this frontend only after both SQL proposals and this backend are live. Before installation the backend keeps the legacy Independent Learner deletion (which deletes the material), so the retention wording would be inaccurate if the frontend shipped first.

This removes the new personal workflow's Storage/database partial-deletion risk by doing no Storage delete. The existing Teacher/Admin deletion path for non-personal materials remains unchanged. Retained private files continue consuming storage; permanent purging and retention policy are outside this task. Language/text changes are refused after private practice or question generation begins; a corrected source requires a new upload.

## M7/M8 isolation

Staging's M7 completion trigger would queue a personal completion. Its M8 trigger would enter existing reward logic; the Filipino path would try to resolve a missing module. Proposal 1 adds an early return for the narrowly identified personal-material source to those two trigger functions, preserving all other branches and grants. It does not alter risk thresholds, scoring, existing award amounts or catalog eligibility.

Personal M5 transcript-receipt/reward verification is skipped. Saved personal readings therefore do not enter verified-reading reward/badge/streak processing. The installed oral-completed trigger is a no-op. Pronunciation code is unchanged. No fake classroom assignments are created. Existing learner-owned history/analytics can read personal results; classroom assignment progress is unchanged and no classroom risk queue is created by personal completion.

## Validation and limitations

- Backend regression suite: 926/926 passed before the final additional route/deletion cases.
- Final personal-material SQL/service/HTTP tests: 6/6 passed, covering both proposals, rollback, owner/session enforcement, mixed-context rejection, explicit review, failed extraction, partial-page metadata, invalid banks, rolling quota, lease fencing/expiry, concurrent generation requests, concurrent HTTP assessment starts, answer-key secrecy, first-answer finality, repeat M5, EN/FIL scoring, deletion, unfinished-answer refusal and retained results.
- Frontend regression suite: 1,248/1,248 passed.
- Browser fixture: production React pages and Express services with disposable SQL; text review, private generation, M5 source/save, all nine M6 submissions, completion, result navigation, answer secrecy and mobile overflow checks passed. Desktop and 390px mobile screenshots were inspected. The authentication and Gemini generator are fixtures; M5 saving uses a fixture transcript. No real microphone, Azure, Gemini or recording upload was verified.
- SQL tests use disposable PGlite PostgreSQL with the exact installed definitions of the changed completion functions and the relevant existing security schema. This is not a complete restore of Staging or a test of external PostgreSQL connection-pool scheduling. The unique index/advisory locks supply cross-process database enforcement; tests exercise overlapping service/HTTP requests and stale leases locally.
- Existing test-only fixture gaps and a circular browser-auth import were corrected. The classroom read-only source assertion now includes deleted personal material; its original archived-classroom branch remains.
- No Staging migrations were applied. A real-provider smoke test, backup/restore rehearsal on the final rollout target, and renewed preflight remain rollout steps requiring separate authorization.

Production build passed (`npm run build`, including both TypeScript checks and Vite). Vite reported its large-chunk warning; this did not fail the build. `git diff --check` passed.

## Exact task-owned file inventory

Frontend application changes:

```text
readflow/src/App.tsx
readflow/src/modules/module3/components/PersonalMaterialPractice.tsx (new)
readflow/src/modules/module3/components/PersonalMaterialPractice.css (new)
readflow/src/modules/module3/pages/MaterialDetailPage.tsx
readflow/src/modules/module3/pages/MaterialLibraryPage.tsx
readflow/src/modules/module5/services/comprehensionNavigation.ts
readflow/src/modules/module6/pages/ComprehensionPage.tsx
readflow/src/modules/module6/services/comprehensionService.ts
readflow/src/pages/reading-activity/ReadAloudPage.tsx
readflow/src/pages/reading-activity/ReadingResultPage.tsx
readflow/src/pages/reading-activity/activityLanguage.ts
```

Backend application changes:

```text
server/routes/comprehension.js
server/routes/materials.js
server/routes/oralReading.js
server/services/comprehensionActionService.js
server/services/comprehensionAttemptService.js
server/services/materialPersistenceService.js
server/services/oralReadingAttemptService.js
server/services/personalMaterialService.js (new)
server/services/readingVerification.js
```

Test changes (new except the two existing tests/fixtures identified):

```text
readflow/tests/m4ArchivedClassrooms.test.ts (existing)
readflow/tests/m3PersonalMaterialRemoval.test.ts
readflow/tests/browser/personalMaterials.mjs
readflow/tests/browser/personalMaterialsAuth.ts
readflow/tests/browser/personalMaterialsHarness.tsx
server/tests/fixtures/materialDatabase.js (existing)
server/tests/fixtures/personalMaterialDatabase.js
server/tests/fixtures/personalMaterialInstalledFunctions.json
server/tests/fixtures/personalSqlClient.js
server/tests/personalMaterialDatabase.test.js
server/tests/personalMaterialRoutes.test.js
server/tests/personalMaterialService.test.js
```

Database proposals and documentation (all new):

```text
supabase/proposed/personal_material_1_sources_PREFLIGHT_READONLY.sql
supabase/proposed/personal_material_1_sources_PROPOSED.sql
supabase/proposed/personal_material_1_sources_ROLLBACK_PROPOSED.sql
supabase/proposed/personal_material_1_sources_VERIFY_READONLY.sql
supabase/proposed/personal_material_2_questions_PREFLIGHT_READONLY.sql
supabase/proposed/personal_material_2_questions_PROPOSED.sql
supabase/proposed/personal_material_2_questions_ROLLBACK_PROPOSED.sql
supabase/proposed/personal_material_2_questions_VERIFY_READONLY.sql
docs/INDEPENDENT_PERSONAL_MATERIAL_IMPLEMENTATION.md
```

Local scratch evidence under the pre-existing `.tmp/` directory includes catalog-inspection scripts/output, test/build logs, and browser screenshots/profile artifacts. These are not application deliverables and should not be included wholesale in a future commit. All other pre-existing dirty files, including the M5/M8 checklist, M7 migration review, Filipino reports, and unrelated SQL proposals, are outside this change inventory and were preserved.

## Review readiness

Ready for local commit review, with no commit made. Review only the task-owned inventory above; do not stage the entire working tree. HEAD remains `85fe5942f40615862d6abc44285cc76b02c6b89d`.

Not yet ready to claim deployed or live-provider-verified functionality. Both SQL proposals require separate review and authorization before application. Renewed target-schema preflight, full-target backup/recovery rehearsal, and real microphone/Azure/Gemini smoke checks remain rollout requirements. Retained storage after deletion and the absence of a monetary cap on failed AI calls are documented operational limitations, not hidden cleanup or billing guarantees.

## Final review addendum (11 November 2026)

Changes made during the final review:

- Independent Learner library removal: "Remove from Reading Materials", a confirmation that discloses retention, and removal wording in the notice, practice panel, M6 read-only message and backend error. The app's navigation rules forbid the label "My Materials", so the page's own name, Reading Materials, is used.
- Per-learner HTTP limit on private generation requests (10 per hour), so failed generations cannot drive unbounded sequential Gemini calls.
- Tests: `server/tests/personalMaterialRoutes.test.js` (limiter: 429 before any provider call), `readflow/tests/m3PersonalMaterialRemoval.test.ts`, and the browser check now covers the removal confirmation (Keep material leaves it; Remove calls removal once).

### PostgreSQL rehearsal on a current baseline

Disposable container `basa-personal-rehearsal-LOCAL` (Supabase Postgres 17, no host port, no network). The latest verified backup (`2026-11-10_104953_preM6TeacherPractice`, checksums re-verified) was restored, and the M6 Teacher Practice migration that was applied to Staging after that backup was applied locally. A fresh read-only catalog capture of ReadFlow-Staging then matched the local baseline exactly: 0 differences across columns, constraints, indexes, RLS, policies, triggers, functions, function EXECUTE privileges, table/column grants and default ACLs. (The restore procedure revokes `supabase_admin` default ACLs; they were re-created locally to match Staging.) The live Staging fingerprints of all five guarded functions and both source constraints match the proposal guards. No personal objects exist on Staging.

Results (tooling and evidence: `%LOCALAPPDATA%\BasaEskwelaLocal\release-review\personal-material-20261111`):

- Lifecycle 43/43: read-only preflights; proposal 2 and its preflight refused before proposal 1; both rollbacks refused on an uninstalled database; apply/verify 1 and 2 (every `matches_expected` true); repeated installs refused; rollback 1 refused while proposal 2 is installed; refused operations changed nothing; empty-install rollback 2 then 1 restored the Staging-identical catalog and byte-identical rows; reinstall is deterministic.
- Changes against the baseline are limited to 3 new tables, 8 new functions, 4 new triggers, 1 new partial unique index, 1 new nullable column, the 2 source constraints, and 3 replaced functions. Each replaced function differs from its live Staging definition only by one inserted early-return block for the personal-source predicate (material set, no activity assignment, no room), which the previous constraints made impossible. No existing policy, RLS flag, grant, default ACL or trigger changed. Anon/authenticated cannot execute any `personal_material_*` function or read the new tables or column, even though Staging's default ACLs grant new objects to those roles.
- All pre-existing rows of the 43 restored tables were byte-identical after installation.
- M7/M8 regression 6/6: all 13 restored M6 completions (Student classroom-assignment XP, performance-passage XP, Admin no-XP and legacy-duplicate refusals) were replayed through the live triggers in rolled-back subtransactions. M7 queueing and M8 XP, passage reward, reading day, badge and progress outcomes were identical before and after installation. Placeholder `auth.users` rows (`@local.invalid`) were added locally only because the backup holds public data only.
- Behaviour 77/77 with synthetic accounts: ownership and role enforcement (other learner, Student and Teacher uploads); explicit review and stale-revision refusal; failed extraction; missing-page metadata; client-role privilege denial; lease fencing and expiry takeover; invalid-bank and invented-evidence refusal; reuse without quota use; the 5-per-24-hour limit; real parallel sessions (a waiting second `begin` was serialized by the advisory lock and refused, 6 simultaneous begins granted exactly one lease, two simultaneous M6 starts created exactly one assessment); forged M5/M6 sources; private sets refused in classroom attempts; text freeze after practice; first-answer finality; no M7 queue and no M8 rows for personal readings and completions; tombstone removal (idempotent timestamp; new reading, generation, answers and completion refused; readings, assessments, answers, sets and material rows byte-identical; completed result readable; hard delete and account cascade blocked); and refusal of data-bearing rollbacks with no change.

### Final test results

Backend 929/929; frontend 1,251/1,251; focused backend M5/M6/database-authorization 199/199; focused frontend M5/M6 301/301; production build (both TypeScript projects and Vite) passed with the existing large-chunk warning; browser fixture check passed; `git diff --check` clean. The repository has no ESLint flat config, so lint was not run. Gemini, Azure, the microphone and real recording uploads were not exercised: generation, authentication and the M5 transcript are fixtures.

### Known limitations

- Retained storage: removed personal files, text and private sets stay in Storage and the database until a separately approved retention/purge policy exists.
- Failed Gemini calls can still be billed. The five-set quota counts successes only, and the 10-requests-per-hour limiter is per process. Set a Google Cloud budget alert and, if needed, a project-level request quota for the Generative Language API.
- Admin system-wide aggregate analytics count all learners' quizzes, so personal practice appears in those totals. Classroom M7 analytics are Student-scoped and exclude it.
- Admin material lists are unchanged and still show a removed personal material; an Admin removal of it is idempotent.
- If an Independent Learner's role later changes, their personal practice becomes inaccessible; history rows are retained.
