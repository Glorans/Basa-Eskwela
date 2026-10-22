# M5–M8 migration readiness

Status: **no migration has been executed.** The files below were imported as source only, on
branch `integration/m5-m8`. Apply them only after explicit approval, against the demo database,
with a verified backup. Do not run them against the shared team or production database.

## Required migrations, in order

For ReadFlow-Staging these are steps **C1–C8** of `docs/STAGING_DATABASE_SETUP_PLAN.md` (#1 = C1 …
#8 = C8), applied after the B2–B26 chain. Their read-only checks are `supabase/staging/verify_c1.sql`,
`verify_c2_c6.sql` and `verify_c7_c8.sql`, followed by `audit_stage_b.sql` A1–A8 after each group.

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

In staging, checks 2–4 are `verify_c1.sql` P10a, `verify_c2_c6.sql` P11a and `verify_c7_c8.sql`
P12a–P12b. The offline dry run (see the setup plan) found three M8 trigger functions
(`m8_sync_diagnostic`, `m8_oral_completed`, `m8_on_module_xp_granted`) left client-executable by
Supabase default grants; `verify_c2_c6.sql` V11c stops on them pending a reviewed REVOKE.

## Risks to M1/M4 behaviour

- M7 triggers run inside every write to `enrollments`, `rooms.teacher_id` and
  `profiles.role/teacher_status`, and M8/M7 triggers run inside M5 attempt saves and M6 completions.
  A failing trigger rolls back that write, so after applying, re-test classroom join/removal, teacher
  approval, an M5 save and an M6 completion.
- Admin M5 practice inserts `oral_reading_attempts`. With M8 installed, this records the admin's own
  read-aloud count, reading days and possibly the "Brave Reader" badge. Admins earn no XP (XP comes only
  from M6 completions, which admins cannot open) and appear on no leaderboard.

## Static audit of the eight files (2026-10-22)

No database is configured for Basa-Eskwela yet (no `server/.env` or `readflow/.env.local`, and no
Supabase variables in the user or machine environment), so the target schema could not be queried.
Findings below come from reading the SQL.

- **Transactions:** every file runs in one `BEGIN … COMMIT`; any error rolls the whole file back.
- **No destructive changes to existing data:** no `DROP TABLE/COLUMN`, no `TRUNCATE`, no column changes
  to existing tables. All `DELETE`/`UPDATE` statements target new `m7_*`/`m8_*` tables.
- **Backfills (new tables only):** #5 awards "Consistent Reader" from `m8_reading_days`; #7 queues every
  student with a completed M6 quiz into `m7_risk_queue` (evaluated only once the worker is enabled).
- **Triggers on existing tables:**
  | Trigger | Table (module) | Fires on |
  |---|---|---|
  | `m8_diagnostic_sync` | `diagnostic_results` (M2) | insert, update of `reading_level` |
  | `m8_oral_completed_trigger` | `oral_reading_attempts` (M5) | insert |
  | `m8_m6_completed` | `m6_comprehension_attempts` (M6) | insert, update of `status` |
  | `m7_completed_quiz` | `m6_comprehension_attempts` (M6) | insert, update of `status` |
  | `m7_enrollment_changed` | `enrollments` (M4) | insert, update, delete |
  | `m7_room_owner_changed` | `rooms` (M4) | update of `teacher_id` |
  | `m7_profile_authorization_changed` | `profiles` (M1) | update of `role`, `teacher_status` |
- **Grants:** browser (`authenticated`) access is read-only and row-limited: M8 own rows only (badge
  catalogue readable by all); M7 risk events/interventions only for the approved teacher of an enrolled
  student. Queues, evaluations, `weekly_reports` and recordings are service-role only. All
  `SECURITY DEFINER` functions pin `search_path`.
- **M5 recordings are private:** bucket `public = false`; no `storage.objects` policies (no direct browser
  access); the table revokes `anon`/`authenticated`. Playback goes through the backend, which checks the
  learner's own attempt or the approved teacher's enrolled student before issuing 5-minute signed URLs.
  Deleting an attempt removes its recording row but not the stored audio objects (orphans need cleanup).
- **Re-run safety:** #1, #3, #4, #6, #8 are re-runnable. #2 fails on re-run (policies lack
  `IF NOT EXISTS`) and rolls back harmlessly. #5 deletes the `perfect_score` badge; this fails and rolls
  back if any user has already earned it (no cascade). #7 is install-once and aborts if any `m7_*` object
  exists.

## Backup before applying

The Supabase plan of the target project must be checked in its dashboard (Settings → Billing).
- **Pro plan or higher:** confirm a recent daily backup under Database → Backups (and PITR if enabled).
- **Any plan, including Free:** take a logical dump with the Supabase CLI or `pg_dump` against the
  project's session-pooler connection string, kept in an environment variable and never pasted into chat
  or files in the repository: schema (`supabase db dump -f schema.sql`), data
  (`supabase db dump --data-only -f data.sql`) and roles (`supabase db dump --role-only -f roles.sql`).
  Store the dumps outside the repository. Storage objects (recordings) are not included in database dumps.
- Verify the dump by restoring it into a throwaway local or scratch project before migrating.

## Rollback plan (draft, not executed)

1. **Immediate stop (keeps data):** disable the triggers on existing tables, which restores M1–M6 write
   behaviour: `ALTER TABLE public.profiles DISABLE TRIGGER m7_profile_authorization_changed;` and likewise
   for each row of the trigger table above. Leave `M7_RISK_WORKER_ENABLED` off.
2. **Full removal of M7:** drop the four `m7_*` triggers, then `m7_save_evaluation(uuid,bigint)`,
   `m7_enqueue_authorization_change()`, `m7_enqueue_enrollment()`, `m7_enqueue_completion()`, the tables
   `m7_interventions`, `m7_risk_events`, `m7_risk_queue` and the sequence `m7_risk_generation`. Keep
   `weekly_reports` unless it was created by #8 and is empty.
3. **Full removal of M8:** drop the three `m8_*` triggers on existing tables, then the `m8_*` tables and
   functions (confirm exact signatures with `\df public.m8_*` first).
4. **M5 recordings:** drop `oral_reading_recordings`; remove the bucket only after it is empty.
5. If anything else is wrong, restore the verified dump.

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
