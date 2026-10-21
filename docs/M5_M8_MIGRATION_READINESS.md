# M5–M8 migration readiness

Status: **no migration has been executed.** The files below were imported as source only, on
branch `integration/m5-m8`. Apply them only after explicit approval, against the demo database,
with a verified backup. Do not run them against the shared team or production database.

## Required migrations, in order

| # | File | Creates / changes | Depends on |
|---|------|-------------------|------------|
| 1 | `supabase/migrations/20261019_m5_recording_playback.sql` | Table `oral_reading_recordings` (RLS on; anon/authenticated revoked; service role only). Private storage bucket `oral-reading-recordings` (25 MB, webm/ogg/mp4/wav). Re-runnable. | `oral_reading_attempts`, `auth.users` |
| 2 | `readflow/supabase/migrations/20261019000000_m8_gamification.sql` | `m8_learner_progress`, `m8_xp_events`, `m8_badges` (seeded), `m8_earned_badges`, `m8_reading_days`; XP/streak functions; **trigger on `oral_reading_attempts` insert** | `profiles`, `oral_reading_attempts`, `diagnostic_results`, `auth.users` |
| 3 | `readflow/supabase/migrations/20261020000000_m8_completion_integration.sql` | XP on verified M6 completion; **trigger on `m6_comprehension_attempts` insert/update of status**; graduate badge; own-row weekly leaderboard | #2, `m6_comprehension_attempts`, `modules`, `reading_activity_assignments` |
| 4 | `readflow/supabase/migrations/20261021000000_m8_classroom_leaderboard.sql` | Classroom leaderboard RPC | #2, `rooms`, `enrollments` |
| 5 | `readflow/supabase/migrations/20261022000000_m8_consistent_reader.sql` | Consistent-reader badge trigger on `m8_reading_days` | #2 |
| 6 | `readflow/supabase/migrations/20261023000000_m8_independent_leaderboard.sql` | Independent-learner leaderboard RPC (`profiles.role = 'general_user'` only) | #2, `profiles` |
| 7 | `supabase/migrations/20261024_m7_analytics.sql` | `m7_risk_queue`, `m7_risk_events`, `m7_interventions`, `m7_save_evaluation(uuid,bigint)`; **triggers on `m6_comprehension_attempts`, `enrollments`, `rooms` (teacher_id) and `profiles` (role, teacher_status)** | M1, M4, M5, M6 schemas; `m6_apply_action(uuid,uuid,uuid,text,integer,uuid)`; every M6 attempt user has a profile |
| 8 | `supabase/migrations/20261024_m7_weekly_reports.sql` | Table `weekly_reports` | `profiles` |

M8's files live in `readflow/supabase/migrations/`, separate from the main `supabase/migrations/`.
M8's Supabase CLI `config.toml` was deliberately not imported, so apply these files manually in
the order above rather than with `supabase db push`.

## Pre-flight checks (read-only) before approval

1. Back up the demo database and confirm the restore works.
2. Record which of the eight files are already applied (for example `to_regclass('public.m8_badges')`,
   `to_regclass('public.m7_risk_queue')`, `to_regclass('public.oral_reading_recordings')`). M7 #7 is a
   one-time install, not an upgrade: if any `m7_*` object already exists, stop and review.
3. Confirm `public.m6_apply_action(uuid,uuid,uuid,text,integer,uuid)` exists, and that every
   `m6_comprehension_attempts.user_id` has a `profiles` row. #7 checks both and rolls back otherwise.
4. Confirm `enrollments.id` exists (M4 code already reads it; M7 pages through rows by `id`).

## Risks to M1/M4 behaviour

- M7 triggers run inside every write to `enrollments`, `rooms.teacher_id` and
  `profiles.role/teacher_status`, and M8/M7 triggers run inside M5 attempt saves and M6 completions.
  A failing trigger rolls back that write, so after applying, re-test classroom join/removal, teacher
  approval, an M5 save and an M6 completion.
- Admin M5 practice inserts `oral_reading_attempts`. With M8 installed, this records the admin's own
  read-aloud count, reading days and possibly the "Brave Reader" badge. Admins earn no XP (XP comes only
  from M6 completions, which admins cannot open) and appear on no leaderboard.

## Activating the M7 risk worker

Leave `M7_RISK_WORKER_ENABLED` unset or `false` until #7 is applied and `m7_risk_queue` and
`m7_save_evaluation(uuid,bigint)` are verified. Then set `M7_RISK_WORKER_ENABLED=true` in the backend
environment and restart the backend.

## What works before the migrations

| Feature | Before migration |
|---------|------------------|
| M5 read-aloud, scoring, results, history (students, independent learners, admin practice) | Works (existing tables) |
| M5 recording save | Result saves; upload reports that recording storage is not installed and offers "Continue Without Recording" |
| M5 recording playback (learner and teacher) | Shows "Recording unavailable for this activity" |
| M5 automatic part-to-part playback (saved recordings on result and teacher pages) | Works once recordings can be saved (#1) |
| M8 badges, XP, weekly/classroom/independent leaderboards | Pages show a load error (tables/RPCs absent) |
| M7 student progress, teacher completion analytics, teacher analytics page | Expected to work (existing tables only); not verified against a database |
| M7 admin System Performance | Expected to fail (reads `m7_interventions`) |
| M7 student support, risk alerts, interventions | Fail until #7 |
| M7 weekly reports (generate/list/open) | Fail until #8 |
