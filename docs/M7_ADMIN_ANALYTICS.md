# Admin System Performance enhancement

The existing `/admin/analytics` route and `/api/analytics/system` endpoint now provide detailed analytics while preserving the nine all-time system totals. No CSS redesign, database changes, migrations, worker changes, or threshold changes were made.

## Added functionality

- Classroom and inclusive start/end date filters interpreted in Philippine time.
- Filtered reading/quiz totals and average pronunciation, comprehension and reading speed.
- Weekly performance tables with actual sample counts. Weeks without records are omitted, not filled with zero scores.
- Classroom comparisons using saved `room_id`, with enrollment, participation, performance, and assignment completion.
- Distinct student participation relative to current enrollment/current student accounts.
- Current evidence-verified completion for assignments issued during the selected period, using existing `deriveAssignedProgress()`.
- Current risk counts using full chronological quiz histories and existing `classifyRisk()` for each approved teacher's scope. Students count once at their highest-priority classification. Classroom selection selects students and teacher context but preserves that teacher's full eligible history, including independent work and other owned rooms where the student is enrolled.
- Admin-only support list with teacher contexts, recent scores, and intervention status counts. No intervention notes, emails, transcripts, or answer keys are returned.

## Data semantics and limitations

- Original summary cards remain system-wide and all-time, including any general-user assessment records already included in the old summary. Detailed performance follows the selected classroom/dates. Participation and risk concern student-role profiles.
- Risk does not reset at the start of a reporting period. Historical risk-event counts are not used as student counts; neither `m7_risk_events` nor `m7_risk_queue` is queried by the admin report.
- "No assessment data" means no eligible assessed approved-teacher context. This also includes students without an approved teacher/current enrollment, even if they have independent results; it does not label them On Track.
- Completion is a current snapshot for assignments issued in the period, not an inferred historical completion rate. The existing schema does not provide a complete status audit trail.
- Classroom performance includes saved results for that room, including historical students. Participation uses current members only, because deleted memberships cannot be reconstructed reliably.
- Independent results are not assigned to classrooms based on membership. Results from deleted/unavailable rooms remain in all-system totals but not existing-room comparisons.
- Interventions are summarized across the selected eligible teacher contexts and are not date-filtered; they support the current-risk view.
- Aggregation uses paginated reads of stored history and computes results per request. Large production datasets need load testing. A malformed completed quiz still produces the existing scoring error rather than an invented score.
- Live Supabase queries and browser/mobile interactions were not exercised in this session.

## Files

Modified:
- `server/routes/m7Analytics.js`
- `readflow/src/modules/module7/M7Pages.tsx`
- `readflow/src/modules/module7/services/m7Service.ts`

Created:
- `server/services/adminSystemAnalytics.js`
- `server/tests/adminSystemAnalytics.test.js`
- `readflow/src/modules/module7/AdminAnalyticsPage.tsx`
- `readflow/src/modules/module7/components/AdminAnalyticsSections.tsx`
- `docs/M7_ADMIN_ANALYTICS.md`

## Validation

- `npm run build --prefix readflow`: passed TypeScript/config checks and Vite production build. Existing mixed diagnostic import and large-chunk warnings remain.
- `node --test server/tests/adminSystemAnalytics.test.js server/tests/m7Risk.test.js`: 17 passed. The intentional worker retry fixture prints an expected evaluation-failure message before succeeding.
- `node --check server/services/adminSystemAnalytics.js` and `node --check server/routes/m7Analytics.js`: passed.
- `git diff --check`: passed.

## Team verification

1. Open `/admin/analytics` as admin. Confirm all nine original totals match the previous dashboard.
2. Apply a classroom and single-day period. Compare results to stored `room_id` and timestamps; verify inclusive Philippine date boundaries. Reset restores full detail history.
3. Confirm independent readings are included in all-system detail but excluded from a classroom's performance.
4. Verify students with two teachers count once in risk totals, with their teacher contexts visible. Change date filters and confirm current risk is unchanged; change classrooms and confirm the relevant teacher context is selected.
5. Compare assignment completion to actual saved reading/comprehension evidence, including read-aloud-only assignments and statuses that lack evidence.
6. Verify teacher/student/unauthenticated calls to the admin API are denied (403/401), and teacher M7/weekly reports still operate normally.
7. Verify empty classrooms, no-result periods, API errors/retry, and narrow-screen tables. Check that changing filters rapidly does not replace a newer result with an older response.

No production data was modified and no migrations, commits, pushes, or deployments were performed.
