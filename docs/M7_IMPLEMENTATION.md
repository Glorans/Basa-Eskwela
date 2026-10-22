# M7 implementation and testing handoff

Implemented in the existing repository without executing SQL, changing credentials, committing, or pushing. Existing staged/unstaged changes were retained. Live Supabase, browser behavior, and end-to-end regressions remain for the testing team.

## Requirements

| Requirement | Source implementation status |
| --- | --- |
| #1 Personal progress | Added student reading, pronunciation, comprehension, and assigned-reading progress |
| #2 Activity results | Added completed quiz and reading history with original result-page links |
| #3 System dashboard | Added admin-only aggregate API and page |
| #4 Student dashboard | Existing implementation preserved |
| #5 Class dashboard | Existing implementation preserved, including its classroom-attribution limitation |
| #6 Track progress | Existing implementation preserved; personal progress added |
| #7 Quiz scores | Existing implementation preserved; new reports include every eligible completed attempt |
| #8 Completion rates | Existing verified-completion logic reused for personal assigned-reading progress |
| #9 Pronunciation accuracy | Existing implementation preserved; stored accuracy shown in new reports |
| #10 Generate weekly report | Existing generator and save route preserved |
| #11 Access weekly report | Existing saved history and PDF export preserved |
| #12 At-risk alert | Added durable completion queue, worker, persisted transitions, unread/read notifications |
| #13 Competency report | Added question-weighted literal/inferential/critical comprehension and overall pronunciation |
| #14 Record intervention | Added authorized create/update, notes, date, status, follow-up date/information |
| #15 At-risk records | Added active warning/risk filter, supporting quizzes, alert/recovery history, interventions |

Implementation status is not a claim of live integration verification.

## Files changed in this implementation

Modified existing files:
- `readflow/src/App.tsx`: three protected routes.
- `readflow/src/components/basa/BasaSidebar.tsx`: student navigation.
- `readflow/src/modules/module3/components/M3Layout.tsx`: admin and teacher navigation.
- `server/server.js`: API router and lifecycle-managed background worker.
- `server/services/comprehensionActionService.js`: prompt queue processing after completion; original save response retained.

Created files:
- `readflow/src/modules/module7/M7Pages.tsx`: student, admin, and teacher interfaces.
- `readflow/src/modules/module7/m7.css`: responsive scoped styling.
- `readflow/src/modules/module7/services/m7Service.ts`: typed authenticated API client using existing API configuration.
- `server/routes/m7Analytics.js`: role-protected API endpoints.
- `server/services/m7Analytics.js`: paginated record retrieval, scoring, authorization scope, aggregates, interventions.
- `server/services/m7Risk.js`: deterministic chronological classification.
- `server/services/m7RiskWorker.js`: durable-queue processing and retries.
- `server/tests/m7Risk.test.js`: focused classification and reused authorization-helper checks.
- `supabase/migrations/20261024_m7_analytics.sql`: queue, alerts, interventions, indexes, grants, RLS, triggers, atomic persistence function.
- `supabase/migrations/20261024_m7_weekly_reports.sql`: missing weekly-report storage prerequisite.
- `docs/M7_IMPLEMENTATION.md`: this handoff.

Existing untracked M7 analytics, completion services, weekly-report files, package files, backup patches, and unrelated module changes were not overwritten.

## SQL to review and execute manually

1. Confirm the existing M1/M4/M5/M6 schemas are deployed, including `profiles.teacher_status`, `enrollments`, `rooms`, uploaded-reading assignment columns, M6 snapshots/responses, and oral-reading records. This implementation inspected repository schemas, not the live database.
2. Execute `supabase/migrations/20261024_m7_analytics.sql` once. It creates new M7 tables/functions and adds triggers to M6 completion and enrollment changes. It backfills the queue from actual completed quizzes, not fabricated scores. The script runs in a transaction and is intentionally not a rerunnable migration.
3. If `weekly_reports` is absent, review and execute `supabase/migrations/20261024_m7_weekly_reports.sql`. If it already exists, inspect its columns against `weeklyReportStorage.js` and skip this prerequisite. Do not replace an existing table. This script contains grant/RLS configuration as well as table creation.
4. Restart the Express server. The worker starts with the server, processes at most 50 students per batch, polls every 15 seconds, and is also nudged after quiz completion. Keep a backend process running for delivery. No external cron service is required.

New tables deny client writes; only the backend service role persists changes. Teacher SELECT policies also require approved teacher status and current student enrollment. Students and admins do not have direct access to intervention/alert tables. Admin aggregate access is through its authorized API only. No service credentials enter frontend code.

## Scoring, visibility, and persistence

- Report first-answer percentages and competencies reuse `summarizeComprehension`. The protected persistence RPC independently derives the same first-answer scoring from stored snapshots/responses; callers cannot supply alert payloads. Retries/hints do not inflate first-answer scores. Integer percentage rounding matches existing quiz scoring.
- Every completed eligible attempt is included, ordered by completion timestamp and then UUID for deterministic ties; incomplete attempts are excluded. Malformed completed evidence produces an error and retains its queue job rather than treating it as zero or clearing risk.
- Students are restricted to their authenticated user ID. Teachers must be approved and have the student currently enrolled in an owned room. Consistent with existing M5 visibility, eligible teacher records include independent attempts plus attempts in the student's currently enrolled rooms owned by that teacher. Other teachers' classroom attempts are excluded. Admin aggregates cover system records without returning answer keys.
- Two consecutive scores below 75: Early Warning. Three below 75: At Risk. Three below 60: Needs Support, taking priority. At Risk/Needs Support remain active through one passing score or mixed results until two consecutive scores at least 75. Needs Support does not downgrade to At Risk before recovery. An Early Warning clears when its consecutive low-score condition breaks.
- Each transition persists once per teacher/student/attempt/classification. Late older completions are reconciled; obsolete transitions are retained as superseded history and excluded from unread notifications. Read acknowledgements survive reevaluation. Recovery is a persisted transition to On Track; historical episodes remain visible. "Active episode" refers to a transition not followed by a persisted On Track event.
- Atomic persistence checks a monotonic queue generation under a row lock. Concurrent completion/enrollment changes invalidate stale evaluations. Worker failures leave jobs pending; restarting resumes them. Queue processing is not dependent on visiting a dashboard.
- Enrollment changes, room ownership transfers, and profile role/teacher-approval changes queue reevaluation and invalidate stale work.
- New pages provide loading, error/retry, empty, and intervention-success states. Teacher notifications poll every 30 seconds.

## Automated validation completed

- `npm run build --prefix readflow`: passed TypeScript application/config checks and Vite production build.
- `node --test server/tests/m7Risk.test.js`: 8 tests passed (thresholds, recovery/recurrence, ordering/incomplete exclusion/deterministic transitions, Needs Support priority, actual reused role helpers).
- `node --check`: passed new backend route/services, modified server/comprehension files, and existing weekly-report route/generator/storage.
- `git diff --check`: passed.

Tests do not execute live SQL. Database deduplication, RLS, concurrent worker transactions, endpoint-to-database authorization, UI behavior, and PDF export require integration testing. Build warnings remain for mixed dynamic/static diagnostic imports and a large JavaScript chunk.

## Manual test steps

Use actual enrolled test accounts and complete activities through the existing UI. Do not insert fabricated production quiz results.

1. **Student progress:** sign in as a student and open `/dashboard/progress`. Compare saved readings, dates, pronunciation, speed, quiz scores, hints, and assignment completion with existing result pages. Follow both result links. Confirm a new student sees meaningful empty states. Passing a different student ID in a query must not change the authenticated student's results.
2. **Admin:** open `/admin/analytics` with an admin account. Compare counts and averages with actual stored records. Call `GET /api/analytics/system` with student and teacher tokens; expect 403. Without a token expect 401.
3. **Teacher visibility:** open `/m3/teacher/student-support` as an approved teacher. Verify only enrolled students appear, their independent and own-classroom attempts are included, and another teacher's classroom attempts are excluded. An unapproved teacher or other role must receive 403 from `GET /api/analytics/teacher`.
4. **Thresholds:** with actual completed assessments, observe one below-75 score leaves On Track; the second creates Early Warning; the third creates At Risk. A sequence of three below-60 scores creates Needs Support. Exactly 60 is not below 60, and exactly 75 is passing. Include interrupted quizzes between completed quizzes; they must not affect the sequence.
5. **Recovery:** from At Risk or Needs Support, complete one quiz at least 75: risk persists. Complete another at least 75: On Track and a recovery event appear. A low score between passing scores resets recovery. Verify warning/risk can recur afterward.
6. **Delivery/dedup:** complete quizzes while no teacher dashboard is open. Wait for the worker, then open Student Support. Confirm history and notifications persisted. Refresh repeatedly, retry a completion, and restart the backend; identical transitions must not duplicate. Mark a notification read and reload; its unread status must stay cleared. Test with concurrent server processes against staging if applicable.
7. **Competencies:** compare literal, inferential, and critical totals against the saved question types and first answers. Zero available questions show No data. Pronunciation is overall stored accuracy; no inferred phoneme-level scores exist.
8. **Interventions:** select a student, save notes/date/status/follow-up, reload, edit, and reload again. Verify notes and updates persist. Attempt POST/PATCH for a student outside the teacher's enrollment scope (403) and another teacher's intervention ID for a shared student (404). Empty notes, invalid dates, and unsupported statuses must fail validation.
9. **History:** use Active warnings and risk and Students with alert history filters. Confirm supporting scores/dates, resolved episodes, current status, and interventions. Read acknowledgement must not remove history or resolve risk.
10. **RLS:** with authenticated client credentials, confirm no direct alert/intervention writes, no student access to these tables, and no cross-teacher reads. Confirm service-role credentials remain server-only.
11. **Regression:** open existing `/m3/teacher/analytics`. Check student/class summaries, quiz scores, completion rates, and pronunciation. Generate a weekly report, reopen it from history, download its PDF, and compare dates/scores. Smoke-test existing M1–M8 routes, including reading completion and M8 rewards, after the new triggers are installed.
12. **Responsive/error states:** test the three new pages at mobile width. Disconnect the API, retry, restore it, and verify recovery. Test missing migrations in staging: an actionable error should appear and existing quiz completion must remain usable before migration installation.

## Remaining deployment/integration considerations

- SQL has not been executed or validated against the live Supabase schema. New teacher persistence features require the M7 migration.
- Existing weekly-report UI still uses its pre-existing hardcoded `http://localhost:5001/api/weekly-reports` URL; new M7 APIs use the shared configured API URL. Verify your team's backend origin/port before testing existing reports. No credentials or environment variables were changed.
- Existing class-performance attribution limitations were preserved.
- Aggregates page through stored rows but are computed on request. Load-test large datasets before production rollout; teacher polling currently reloads its report every 30 seconds.
- Browser/mobile interaction, Supabase policies/triggers, real notification delivery, and weekly-report PDF export have not been functionally tested in this session.
