# C9 - final completion authorization and trusted XP review

Status (2026-10-23): prepared locally, uncommitted, not deployed. DT1 is committed as
`aaa9656`. No Supabase connection or cloud-provider change was made. Local SQL execution
is confined to disposable in-memory PGlite tests; neither migration was applied to staging.

## Authorization finding and owner decision

M6 did NOT independently check current classroom/publication authorization at completion.
The earlier C9 report incorrectly equated owning an attempt with current access, and its
20-test fixture replaced `m6_apply_action` with a stub. The new tests use the actual RPC.

The owner explicitly selected: **Reject completion after authorization is revoked.**
This supersedes the earlier C9/DT1 draft text allowing withdrawn work to complete without XP.

| Scenario for a started, not-yet-completed attempt | Classification / behavior |
|---|---|
| Assignment withdrawn/deleted or assigned to a different learner/source | A: reject completion, no XP |
| Enrollment ended | A: reject completion, no XP |
| Assigning/current teacher no longer approved | A: reject completion, no XP |
| Classroom transferred to another teacher, even another approved teacher | A: reject when the original assigner is no longer the owner |
| Module unpublished, soft-deleted or physically deleted | A: reject completion, no XP |
| Wrong caller, non-learner, or learner role inconsistent with classroom/independent context | A: reject |
| Attempt language differs from its current module/material language | A: reject malformed/inconsistent context |
| Authorized independent learner without a verified same-language diagnostic | B: save completion, no XP |
| Ordinary source text/title edits, with current access still valid | B: complete the saved assessment snapshot; do not replace its questions |
| Retry of an already-completed result | B: return the existing outcome; do not perform a new completion or grant XP |

No blocking product decision remains for this scope. Historical `level_up` badges remain
preserved, as in the existing C9 design. Whether to revoke historical badges or deny access
to old answers/history after unenrollment is separate work, not silently changed here.

## Full request path

1. `server/server.js` mounts `/api/comprehension`.
2. `server/routes/comprehension.js` POST `/attempts/:attemptId/actions` calls
   `authorizeComprehensionRequest`, then `applyComprehensionAction`.
3. `authorizeComprehensionRequest` delegates to `authorizeOralReadingRequest`: validated
   session identity and a current database profile with role `student` or `general_user`.
   This does not check enrollment, teacher approval or publication.
4. `loadOwnedAttempt` filters by both attempt ID and authenticated user ID. The action
   service passes that user ID to the backend-only `m6_apply_action`; it never takes it
   from the browser's action body.
5. Original `m6_apply_action` locks the owned attempt, handles completed retries, verifies
   every snapshot question has a resolved response, and updates status/completed_at.
   It did not check current source access. Its source is in
   `readflow/supabase/m6_comprehension_functions.sql:733`.
6. C7's `m7_completed_quiz` and C3/C9's `m8_m6_completed` run in that transaction. Any
   error rolls back status, XP and completion-generated M7 queue changes together.

Start-time checks are separate: `startComprehensionAttempt` checks source access, prior
oral reading and reviewed questions, then persists the snapshot. Its existing resume
branch intentionally reuses saved assessments after source edits. That branch is preserved;
resuming/reading an old snapshot is no longer mistaken for permission to finalize it.

## Corrections in the forward-only C9 migration

File: `supabase/migrations/20261026_m8_trusted_xp.sql`.

- Adds internal `m6_assert_completion_access(uuid)` (SECURITY INVOKER, empty search path,
  no client EXECUTE). It validates current learner role, source shape, module publication,
  deletion status, source language, enrollment, exact assignment, teacher role/approval,
  and assignment ownership. Material assignments additionally require the assigned learner,
  material uploader and room teacher to match, and completed extraction.
- Calls that helper from `m6_apply_action` before a new completion. Apart from this one
  call, the original scoring/ownership/answer/retry body is preserved exactly. A regression
  test compares the bodies. Already-completed retries remain read-only/idempotent.
- Calls the same helper from the M8 completion trigger, covering trusted direct completed
  inserts as well as the RPC. There is no early no-XP return around authorization failures.
- Uses `FOR SHARE` locks on the relevant profile, source, assignment, room and enrollment
  rows through transaction end. A conflicting revocation must serialize before or after
  completion; it cannot slip between authorization and the completion write.
- Checks the original M6 source fingerprint, configuration and permissions before replacing
  it. Unexpected live function drift stops the migration. The C9 fingerprint is accepted
  only for an intentional rerun. Clients must have no access to protected M6 tables/RPC.
- Keeps the original C9 trusted XP design: classroom modules earn 30/50/80; classroom
  materials earn 60; independent modules earn the lesser of module tier and the DT1-verified
  same-language tier. With no trusted result, completion saves without XP or an XP reading day.
- Keeps the `(user, source_type, source_id)` unique XP key and existing badge/streak functions.
  No catch-all exception suppression; malformed difficulty and unrelated SQL failures still abort.
- `m8_sync_diagnostic` ignores unverified rows and grants new `level_up` badges only from
  verified Instructional/Independent results. Existing badges/XP/diagnostic history remain intact.
- `unlocked_difficulty` remains a display-only maximum of verified EN/FIL tiers. It is never
  consulted for XP or completion authorization; default display Easy does not confer Easy XP.

The backend action service now maps SQLSTATE 42501 to a safe HTTP 403. Other database
failures retain their error behavior. No M4 schema, RPC, policy, grant, or frontend was changed.
Previously applied B1-C8 migration files and committed DT1 migration were not edited.

## English/Filipino and trust boundary

Modules use `modules.path_id -> learning_paths.language`, normalized to `en`/`fil` using
backend-compatible aliases. Materials use their constrained language. The saved attempt's
`language` must match before any eligibility decision, including the no-diagnostic branch.
An EN Independent / FIL Frustration independent learner earns 80 for EN Hard and 30 for FIL
Hard. A shared Hard display does not authorize Filipino Hard XP. Teacher assignments above
student diagnostic difficulty earn their assigned tier without changing diagnostic levels.

The service-role backend remains trusted to create snapshots and supply the authenticated
user ID. C9 does not make a privileged database writer untrusted. New completions cannot be
created directly by browser roles. DT1's receipt/audio-provenance limitations remain documented
in `DT1_DIAGNOSTIC_TRUST_REVIEW.md`.

## Object and audit expectations

| Object | Post-C8 | After DT1 | After C9 |
|---|---:|---:|---:|
| Public tables | 31 | 31 | 31 |
| Public policies | 72 | 70 | 70 |
| Storage policies | 4 | 4 | 4 |
| Public functions | N | N+2 | N+5 |
| M8 functions | 10 | 10 | 12 |
| M8 triggers | 5 | 5 | 5 |
| M7 functions / triggers | 4 / 4 | 4 / 4 | 4 / 4 |
| M7/M8 triggers on old M1-M6 tables (V12e) | 7 | 7 | 7 |
| Badge catalogue | 8 | 8 | 8 |

C9 adds three functions: `m6_assert_completion_access(uuid)`,
`m8_normalize_language(text)`, `m8_verified_difficulty_summary(uuid)`.
It replaces three: `m6_apply_action(...)`, `m8_on_comprehension_completed()`,
`m8_sync_diagnostic()`. All three new helpers are SECURITY INVOKER and backend-only.
The replaced functions retain their trusted owners, SECURITY DEFINER and empty search path.

A1-A5: no new findings. A6: diagnostic authenticated SELECT only after DT1. A7: no new
client RPCs; the internal M6 helper must not appear. A8: 70 public policies, including only
the diagnostic own-row SELECT plus existing restrictive policy. Storage stays unchanged.
Older V-C6d/V11c inventory assumptions (10 M8 functions/all definers) are superseded by C9's
12 functions, including two deliberately invoker-only internal M8 helpers. Do not rerun old
migration files or treat those old inventory expectations as the C9 checkpoint.

## Coordinated staging procedure - NOT executed

Keep the app quiescent and `M7_RISK_WORKER_ENABLED=false` throughout migration/checks.
Use only ReadFlow-Staging `oudfrdeqwotynihkkmze`, verified from the dashboard URL.

1. With deployment approval, verify a recoverable backup and save the post-C8 catalog/security
   baseline. Run each SELECT section separately and retain outputs.
2. Run DT1 P-DT1a-e. Apply DT1 whole only after approval, then V-DT1a-j and A1-A8 using
   post-DT1 expectations. Do not rerun DT1 after success.
3. Run `verify_c9_trusted_xp.sql` P-C9a-f after DT1. All dependency flags true; no client
   M6 table access; module languages recognized; M6 fingerprint
   `ab592754ec820e5ed2533fa52a6adb7f`. Save history/function counts, M6 owner/ACL and M4 fingerprint.
4. Apply C9 whole only after approval. Run V-C9a-i and repeat P-C9d, then A1-A8. Six reviewed
   function rows; no client EXECUTE; history unchanged; public functions = P-C9b +3;
   M6 fingerprint `ab1569a4dab7fffd71e7ff1315dd5971`; M6 owner/ACL and M4 fingerprint unchanged.
   Final inventory is 31 tables / 70 public policies / 4 storage policies / 8 badges.
5. Deploy the DT1 backend/frontend together with C9's HTTP 403 mapping in the same maintenance
   window. Set `DIAGNOSTIC_RECEIPT_SECRET` consistently across backend instances; do not expose it.
   Old clients cannot save diagnostics after DT1. Do not expose an intermediate deployment to users.
6. Use synthetic accounts to verify authorized completion, above-level classroom XP, EN/FIL
   independent caps, and no-trusted-diagnostic completion without XP. Retry: no duplicate XP/badges.
7. Start separate attempts before withdrawing assignments, ending enrollment, disapproving the
   teacher, transferring ownership, and unpublishing/deleting modules. Complete afterward:
   HTTP 403, status still in_progress, no new XP or completion-generated queue entry.
   Revocation itself may legitimately enqueue M7 work; compare against the post-revocation queue.
8. Verify M4 join/removal still works; saved snapshots survive ordinary edits; M5 save/playback
   works; completion queues M7 work. Catalog checks do not prove these runtime outcomes.

Any mismatch/SQL error means STOP. Do not weaken checks or replay earlier migrations. There
is no automatic rollback/deployment here; restoring old C3 would reintroduce the defect.

## Local validation

The fixture now loads real M4 SQL, the actual M6 RPC, C2-C7 and DT1/C9 in memory. Historical
platform/M3 prerequisites still use stand-ins; this is not a managed-Supabase staging test.
The HTTP suite loads actual route/services and connects them to PGlite via local adapters,
mocking only authentication/PostgREST transport and forcing the M7 worker gate off.

Final local results (2026-10-23):

| Check | Result |
|---|---|
| Focused SQL + HTTP authorization suites | 39/39 passed |
| Broader backend suite, including final C9 tests | 427/427 passed |
| Frontend suite, including M4 | 718/718 passed |
| TypeScript app and Node configuration checks | Passed |
| Vite production build | Passed; existing mixed-import and large-chunk warnings |
| `git diff --check` | Passed |

The broader suite excludes the seven
known OCR checks: all five tests in `materialOcr.test.js` (including its mapping-only test),
`Admin image extraction uses the existing OCR path`, and
`uploads an OCR image and deletes only its registered temporary file`. These were not rerun;
no claim is made that their known failures are fixed.

Logs are in the local temporary directory: `basa-c9-targeted-review.log`,
`basa-c9-backend-review.log`, `basa-c9-frontend-review.log`, `basa-c9-build-review.log`.
Node's default child-process runner was blocked by sandbox EPERM initially; focused tests
used `--test-isolation=none`, and the full suites/build ran with normal process permissions.

## Files in the uncommitted C9 working set

- `supabase/migrations/20261026_m8_trusted_xp.sql`
- `supabase/staging/verify_c9_trusted_xp.sql`
- `supabase/staging/audit_stage_b.sql` (expectation comments only)
- `server/services/comprehensionActionService.js` (HTTP 403 mapping)
- `server/tests/fixtures/m8TrustDatabase.js`
- `server/tests/m8TrustedXpMigration.test.js`
- `server/tests/comprehensionCompletionAuthorization.test.js`
- `server/package.json` (targeted test command)
- `docs/C9_TRUSTED_XP_REVIEW.md`
- `docs/STAGING_DATABASE_SETUP_PLAN.md`

No files were staged or committed. DT1 remains at `aaa9656`; no original ReadFlow files,
M4 implementation files, earlier migrations, provider integrations or worker configuration changed.

## Remaining limits

- Lock behavior was reviewed against PostgreSQL semantics; multi-connection revocation races
  still need staging confirmation (PGlite fixture is single-connection). Conflicting writes may
  wait or produce a retryable deadlock; no SQL error is suppressed.
  See [row locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)
  and [Read Committed rechecks](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).
- Authorization uses current relationships. If access is restored before completion, it can
  become valid again. Permanent revocation history would require a separate product/data model.
- Existing completed history, answer/hint access and already-earned badges are preserved.
  C9 gates new completion, not historical visibility or retroactive XP removal.
- No cloud speech, OCR model download, live credentials, or live database behavior was tested.
