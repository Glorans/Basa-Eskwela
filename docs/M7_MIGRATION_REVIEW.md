# M7 migration review

Reviewed against the repository's M6 schema/functions, M4 RLS, M1 teacher verification, M8 completion trigger, and M7 services. No SQL was executed, including in a local test database. No credentials, commits, or pushes were changed.

## Findings and necessary corrections

1. **Completion durability:** `m6_apply_action` locks the attempt, checks that every saved snapshot question has a resolved response, then updates status/completed_at. Answer/hint operations lock the same attempt and prohibit changes after completion. The M7 AFTER trigger queues in that same transaction. It is not an after-commit trigger: durable visibility is guaranteed because workers cannot see its job until the whole transaction (including M8 triggers) commits. A rollback removes both the completion and queue update. The trigger now enqueues only an INSERT already completed or an actual transition into completed; idempotent completion retries do not create another job. Historical completions are backfilled. No M6 or M8 function was replaced.

2. **Scoring and order:** completed attempts are evaluated by PostgreSQL `completed_at, id`. SQL mirrors the existing first-answer scoring, including floating-point percentage rounding, protected answer snapshots, and resolved-response validation. Invalid/missing/duplicate/foreign evidence aborts the evaluation and leaves the queue job available for retry. The JS report classifier now respects timezone offsets and sub-millisecond precision rather than sorting raw ISO strings. Thresholds and recovery are unchanged: 2 below 75 → Early Warning; 3 below 75 → At Risk; 3 below 60 → Needs Support; two consecutive scores >=75 clear At Risk/Needs Support.

3. **Persistence authorization:** the original function accepted arbitrary event JSON, including caller-chosen teacher IDs, timestamps, evidence and classifications. The revised `m7_save_evaluation(uuid,bigint)` accepts only student/queue generation, derives approved teachers from current owned rooms and enrollment, requires a student-role learner, and derives all attempt ownership, visibility, scores, evidence and transitions from database records. No untrusted alert payload is accepted. The worker was updated to the two-argument RPC. Independent quizzes and quizzes in that teacher's currently enrolled classrooms are eligible, matching the M7 report scope. The function is service-role-only with an empty search path. Direct service-role table privileges remain trusted administrative access, as elsewhere in the application.

4. **Schema and permissions:** repository types are UUID identifiers, text roles/statuses, integer first-option indices, boolean resolved flags, JSONB snapshots, and timestamptz completion dates. An initial preflight checks these required columns/types, the M6 RPC signature, and missing profile references. FK creation also checks referenced keys. New table/sequence privileges are revoked from PUBLIC/anon/authenticated; teacher SELECT access to events/interventions is guarded by approved role and current enrollment RLS. Queue and RPC are service-only. Cascading FKs preserve account-deletion behavior. Existing profile/room/enrollment policies do not reference M7, so the new policies do not add a policy cycle. These conclusions are based on repository schema, not inspection of deployed policies.

5. **Concurrency and retries:** the queue uses a monotonic sequence, avoiding generation reuse after deletion. The RPC locks and verifies the queue row, calculates/persists transitions, reconciles history, and deletes the job atomically. Concurrent completions/enrollment/authorization changes either precede the lock or enqueue a newer generation after it releases. Another worker with an old generation returns false. On transaction failure, neither alert writes nor queue deletion commit. Read acknowledgements are preserved by upsert. A new queue index supports polling.

6. **Late commit ordering:** M6 uses `now()`, which is transaction-start time; an older timestamp can become visible after a newer completion has already been processed. Unique keys alone did not correct previously emitted transitions. Each successful evaluation now marks seen transitions with its generation, upserts their canonical evidence, and marks obsolete transitions `superseded_at`. History is retained; superseded events are excluded from unread notifications and labeled in the UI. Already-viewed alerts cannot be retroactively unseen, but the current record is corrected.

7. **Authorization changes:** role/teacher approval and classroom ownership changes now enqueue affected students, in addition to enrollment changes. This prevents an evaluation based on obsolete authorization from remaining the current persisted state.

## One-time execution readiness

The migration is ready for manual execution against the documented repository schema, with these boundaries:

- Execute as the Supabase database owner/migration administrator, after the existing M1/M4/M5/M6 migrations. The schema includes Supabase roles and `auth.uid()`.
- Run the entire file once as a transaction. Existing M7 object-name collisions or incompatible prerequisites abort and roll back; it is not an upgrade script for an earlier M7 migration already applied. If any earlier version was applied, stop and prepare a separate additive upgrade migration.
- Deploy the revised worker alongside this migration: the RPC signature changed from `(uuid,bigint,jsonb)` to `(uuid,bigint)` and event rows now include `evaluation_generation` and `superseded_at`.
- PostgreSQL parsing/execution, actual RLS behavior, and concurrent transactions have not been runtime-tested because SQL execution was prohibited. Preflight verifies shape, not the live body of the M6 completion RPC or historical data quality.
- Privileged direct edits/deletions of completed M6 snapshots/responses are outside the application's immutable completion flow; these do not automatically enqueue reevaluation. Use a deliberate maintenance/backfill procedure if such corrections are made.
- Malformed existing completed results will keep the affected student's evaluation pending until repaired; no scores are fabricated or silently skipped.

## Checks performed

- Eight JS tests passed: thresholds, recovery, deterministic transitions, Needs Support priority, reused role authorization, timezone/microsecond ordering, late-arrival transition changes, and worker retry/two-argument RPC behavior.
- Changed backend files passed `node --check`.
- TypeScript and production build passed; existing diagnostic-import and chunk-size warnings remain.
- `git diff --check` passed.

These are not database deduplication/RLS/concurrency integration tests.

## Manual verification after execution

1. Complete an actual quiz through M6, confirm saved responses/completed_at and queue insertion, and verify M8 completion still occurs. Retry completion and confirm no duplicate transition.
2. Withhold commit of one older completion in a staging transaction while another completion is processed. After committing the older transaction, confirm canonical history is recomputed and obsolete notifications are marked superseded.
3. Run two workers against the same queued generation. Confirm one atomic evaluation, preserved read acknowledgements, no duplicate keys, and no lost newer queue generation. Interrupt a transaction before commit and retry.
4. Attempt RPC calls as anon/authenticated roles: denied. The old three-argument payload RPC must not exist. With a service role, process a queued student and confirm records reference only that student's completed attempts and approved currently authorized teachers.
5. Revoke teacher approval, transfer room ownership, and remove enrollment while evaluations are pending. Verify queue invalidation, subsequent reconciliation, and immediate RLS/backend authorization restrictions.
6. Exercise 75/60 boundaries and two-score recovery with actual completed assessments. Compare stored evidence with the existing M6 first-answer results.
