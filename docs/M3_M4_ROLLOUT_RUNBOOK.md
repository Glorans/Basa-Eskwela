# M3/M4 database rollout runbook

## Approved M4 execution — 2026-11-04 (Asia/Manila)

- Render compatibility cleared using the user's dashboard confirmation of live backend `c227a67`, repository `Glorans/Basa-Eskwela`, branch `main`. Git resolves that short SHA to `c227a67ba840b73ae8273aca384f3ac65c4a66bc`. Inspection confirms additive foundation compatibility while targeting is OFF: legacy inserts use the whole-class default; Archive protections cover backend writers through database triggers; audited Admin removal preserves existing enrollment policy and history behavior. This commit lacks the recipient-aware backend filter, which remains required before enabling Selected Students. Older hosted UI may not expose the new controls; use localhost for manual tests.
- Reused verified backup `C:\Backups\basa-eskwela-staging\2026-11-04_071716_preM4Foundation` after rechecking checksums, restore integrity and exact current staging schema/data coverage. Restore checks: 8/8, zero schema differences, all 34 public/storage tables matched. All three read-only preflights passed; M3 definitions remained intact.
- Applied only, in order: `m4_module_recipients_PROPOSED.sql`, `m4_room_archive_PROPOSED.sql`, `m4_admin_classroom_actions_PROPOSED.sql`. Each passed in-transaction checks and independent post-commit read-only verification before the next migration. Installed schemas/security match the disposable restore tested in the same order.
- Focused existing SQL checks passed: recipients foundation section only (no activation), legacy whole-class insert, owning approved Teacher/Admin Archive/Restore authorization and history preservation, and Admin-only audited removal. Local test fixtures rolled back. No full suites were run.
- Final state: `m4_module_targeting_enabled() = false`; all assignments are whole-class; recipients and Admin audit tables are empty; all existing rooms have NULL archive fields. Function owners, security modes, empty search paths, grants, RLS and trigger coverage verified. All original row values/counts remained unchanged, excluding only newly added default/NULL fields. No existing staging room, enrollment, assignment, assessment or XP record was mutated. No staging action RPC was executed.
- Localhost serves the staging configuration and feature detection/actions; PostgREST discovers the capability RPCs with localhost CORS and expected anonymous denial. Authenticated read-only Admin/Teacher checks confirm archive-column access, Admin-only removal capability and targeting OFF. Refresh localhost to manually test Archive/Restore and Admin removal on disposable rooms/enrollments. Visual interaction checks remain manual.
- Selected Students ENABLE was **not executed**. Before activation: deploy/verify recipient-aware backend and UI, verify recipient/non-recipient enforcement and whole-class behavior, then obtain separate activation approval. No commits, pushes, deployments, paid API calls or M3/M5 code changes were made. Evidence: `%LOCALAPPDATA%\BasaEskwelaLocal\release-review\m4-rollout\`.

The earlier stopped checkpoint below is retained as rollout history; compatibility was subsequently cleared as recorded above.

**2026-11-04 M4 rollout checkpoint — stopped before SQL:** Fresh post-M3 backup `C:\Backups\basa-eskwela-staging\2026-11-04_071716_preM4Foundation` passed checksums and 8/8 restore checks in `basa-m4-rollout-restore-LOCAL` (port 55427), with zero schema differences and matching full-row fingerprints across 34 public/storage tables (318 rows). Read-only preflight for all three proposed M4 migrations passed; staging remained unchanged during backup. Localhost serves staging configuration and the M4 capability/action code. Render backend `/api/health` returned HTTP 200 but no commit/build identifier; candidate Git commit `c227a67ba840b73ae8273aca384f3ac65c4a66bc` is not confirmed deployed. Obtain the latest successful **live** backend deployment's full commit SHA, status/time and linked repository/branch from Render before continuing compatibility verification. None of the three M4 migrations or the ENABLE script was applied. Selected Students remains unavailable. Backup evidence: `%LOCALAPPDATA%\BasaEskwelaLocal\release-review\m4-rollout\`. Recheck staging against this checkpoint before resuming.

**2026-11-04 follow-up: M3 permanent-delete correction applied and verified.** Only `supabase/proposed/m3_module_purge_bank_fix_PROPOSED.sql` was applied, after a fresh restore-verified backup (`2026-11-04_070950_preM3PurgeFix`) and passing preflight. Security settings and all existing records were preserved; no staging module was deleted. See [root cause, eligibility, tests and execution record](M3_PERMANENT_DELETE_FIX.md). M4 was not applied; its rollout remains a separate next step.

Initial proposal validation used the disposable container `basa-m3m4-proposals-LOCAL` (127.0.0.1:55423, restored from `C:\Backups\basa-eskwela-staging\2026-11-04_015918_preM3BankFix` plus the installed bank fix). Run each step only after approval. See the execution record below for the approved staging rollout; later sections retain the original per-migration procedures.

## Approved M3 execution record — 2026-11-04 (Asia/Manila)

- Reused `C:\Backups\basa-eskwela-staging\2026-11-04_063214_postM3VariableBanks`. Checksums passed. Prior restore evidence passed 8/8 checks with zero schema differences. Immediately before this rollout, staging schema/grants matched the backup snapshot, all 33 public/storage table counts and full-row fingerprints matched the verified restore, and the auth user count was unchanged.
- Corrections: restored `SECURITY DEFINER` on the Trash trigger function; changed frontend `m3_revise_module` argument to `source_id`; replaced the stale "Module 1" test lookup with a dedicated disposable draft fixture. The Revisions SQL comments now record the approved policy: original stays published/visible, separate draft revision, existing history preserved, existing M8 once-per-new-module-ID behavior unchanged.
- Focused verification: both existing full-schema SQL tests passed in `basa-m3-trash-restore-LOCAL` (127.0.0.1:55425), including the named `source_id` call. Fixtures rolled back within the test transactions. The two focused frontend test files passed 5/5 tests. The existing read-only staging preflight passed 10/10 checks.
- **Trash committed and verified first.** The trigger retains owner `postgres`, `SECURITY DEFINER`, empty search path, volatility and its original ACL. Its CR-normalized definition fingerprint is now `38a892fd8e7e7d2e79d17c97639fea0e`. `m3_delete_module` remains `08d598518d825b6a62f3ad5de15aab64`. The Trash table is empty; the Admin list succeeds. New RPC security/grants and the complete schema match the tested restore.
- **Revisions committed only after Trash passed independent verification.** `m3_revise_module(source_id uuid)`, Admin-only authorization, owners, empty search paths and execute grants match the tested restore. Both existing modules return one Versions row (version 1); all three new revision columns remain NULL on existing rows.
- Each migration passed checks before commit and again through a fresh read-only connection. All 33 public/storage tables retained identical row counts and existing values (excluding the three newly added NULL revision columns when comparing module rows). Existing modules, assignments, learner history and M8 remain unchanged. `English Reading Set` was read only, never modified.
- Localhost `http://127.0.0.1:5174` serves the staging configuration, both feature gates and the corrected RPC argument. Live PostgREST discovers both read-only gates with localhost CORS support and denies anonymous execution as expected. Admin gate calls passed over SQL; authenticated visual UI checks remain manual.
- Only the two approved migration files were applied. No ENABLE or rollback migration scripts, team-database access, paid AI calls, full test suites, staging module mutations, Git commit/push or deployment were performed. Existing uncommitted work was retained. Local verification evidence is in `.tmp/m3-approved/`.

Manual follow-up: refresh localhost as Admin and confirm Content Management shows Trash and a published module shows Versions / Revise Module. Test create-revision and Trash/Restore behavior only on a dedicated disposable module, preserving the original and its history; do not use `English Reading Set`. Do not generate paid AI content for these checks.

## 0. Before any migration

1. **Deploy the application first** (backend, then frontend), or test it on localhost against staging. Every new feature is gated on the database and stays hidden until its migration exists. That makes app-first safe, and any later order safe too.
2. **Back up staging.** Copy the last procedure the same way as before, e.g. `C:\Backups\basa-eskwela-staging\_procedures\preM3BankFix_backup.ps1` → `preM3M4Release_backup.ps1` (new suffix; it must also protect the earlier checkpoints). Run it non-interactively as before, then restore-test the new folder in a new disposable container with the `release-review\m3-bank-fix\restore_test.sh` pattern (new container name and port). Continue only when the restore test reports 0 schema differences and matching row counts.
3. **Apply one migration at a time**, in the order in §7, with its verification. Never run a `_ROLLBACK_` or `_ENABLE_` file as part of another step.
4. **Apply command** (same as the bank fix). The connection string comes from your private staging env and is never printed or committed:
   ```
   psql "<staging connection string>" -v ON_ERROR_STOP=1 -f supabase/proposed/<file>.sql
   ```
   Each file is one transaction with `lock_timeout = 5s`. If it stops, nothing was changed; rerun the preflight before trying again.

Fingerprint query used below (read-only):
```sql
-- Carriage returns are ignored, as in the migration guards: some live functions were installed with CRLF.
select p.proname, md5(replace(pg_get_functiondef(p.oid), chr(13), '')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('m3_save_passage_bank','m3_collection_publish_issues','m3_protect_deleted_module','m3_delete_module')
order by 1;
```
Expected on staging today: `m3_save_passage_bank 13e35ccbace4c11e6285aae64262999c`, `m3_collection_publish_issues e698516505be140cdd4c2ed251c55974`, `m3_protect_deleted_module fd19df944007fed809ef5abc4e35f533`, `m3_delete_module 08d598518d825b6a62f3ad5de15aab64`.

Data fingerprint (read-only; run before and after each migration, the counts must not change):
```sql
select 'modules', count(*) from public.modules union all select 'module_passages', count(*) from public.module_passages
union all select 'comprehension_questions', count(*) from public.comprehension_questions
union all select 'room_modules', count(*) from public.room_modules union all select 'enrollments', count(*) from public.enrollments
union all select 'reading_activity_assignments', count(*) from public.reading_activity_assignments
union all select 'oral_reading_attempts', count(*) from public.oral_reading_attempts
union all select 'm6_comprehension_attempts', count(*) from public.m6_comprehension_attempts
union all select 'm8_xp_events', count(*) from public.m8_xp_events;
```

## 1. `m3_variable_passage_banks_PROPOSED.sql` — 6/9/12 questions per passage

- **Preflight:** fingerprints for `m3_save_passage_bank` and `m3_collection_publish_issues` as above; `select to_regprocedure('public.m3_collection_publish_issues_phase1(uuid)') is not null;` must be true; `select to_regprocedure('public.m3_passage_bank_sizes()');` must be NULL.
- **Apply:** the file. Its guard refuses unless both fingerprints match exactly.
- **Verify:**
  - `select public.m3_passage_bank_sizes();` → `{6,9,12}`.
  - Both functions have new fingerprints (record them).
  - `select proacl from pg_proc where proname in ('m3_save_passage_bank','m3_collection_publish_issues','m3_passage_bank_sizes');`: the first two are unchanged (authenticated + service_role); the gate has authenticated + service_role and no anon.
  - Data counts unchanged.
  - In the app, the editor shows "Number of questions"; existing six-question banks still show "6 / 6 questions".
- **Manual test (paid Gemini, only with your approval):** on a disposable draft, generate one 9 and one 12 bank, review, publish, then take one learner attempt.
- **Rollback:** `m3_variable_passage_banks_ROLLBACK_PROPOSED.sql`. It drops the gate first and restores both previous definitions exactly. It refuses while any unpublished draft has a 9/12 bank: regenerate those as six, or keep the migration. To hide 9/12 at once without a full rollback: `drop function public.m3_passage_bank_sizes();`.

## 2. `m3_module_trash_PROPOSED.sql` — Delete Reading Module → Trash

- **Preflight:** fingerprints for `m3_protect_deleted_module` and `m3_delete_module`; `to_regclass('public.m3_module_trash')` NULL.
- **Verify:**
  - `select * from public.m3_trashed_modules();` as an Admin through the app: Content Management shows a **Trash** section listing any module already soft-deleted.
  - `m3_delete_module` fingerprint unchanged; `m3_protect_deleted_module` changed (record it).
  - Data counts unchanged.
- **Rollback:** `m3_module_trash_ROLLBACK_PROPOSED.sql`. It restores the original trigger exactly; modules still in the Trash stay hidden, as the old Delete left them. Export `m3_module_trash` first if the who/when record matters.

## 3. `m3_module_revisions_PROPOSED.sql` — Revise published module

- **Approved policy (2026-11-04):**
  1. Publishing a revision leaves the original published and visible. A new revision starts as a separate draft.
  2. Learners may earn module XP for the new revision ID under the unchanged M8 once-per-module rule. Existing history stays attached to the original IDs.
- **Preflight:** `select count(*) from information_schema.columns where table_name = 'modules' and column_name like 'revision%';` → 0.
- **Verify:**
  - `select * from public.m3_module_revisions('<English Reading Set id>');` returns one row (version 1).
  - Admin module detail of a published module shows **Versions** and **Revise Module**.
  - Data counts unchanged.
- **Manual test:** Use a dedicated disposable published module, never `English Reading Set`. Revise Module → a new draft opens with the same passages and its questions marked for review. Confirm the published original and its learner results are unchanged. Exercise Trash/Restore only on the disposable draft when ready.
- **Rollback:** `m3_module_revisions_ROLLBACK_PROPOSED.sql`. It refuses while any revision exists.

## 4. `m4_module_recipients_PROPOSED.sql` (+ `_ENABLE_`) — Whole Class / Selected Students

- **Preflight:** `select count(*) from information_schema.columns where table_name = 'room_modules' and column_name = 'targeting_mode';` → 0. Confirm the backend with the recipient-aware M5 start filter is deployed (`server/services/oralReadingAttemptService.js`).
- **Apply:** the foundation file. Targeting stays **off**.
- **Verify (still off):**
  - `select public.m4_module_targeting_enabled();` → false.
  - `select tgname, tgrelid::regclass from pg_trigger where tgname = 'm4_enforce_module_recipient';` → 2 rows (`oral_reading_attempts`, `m6_comprehension_attempts`).
  - `select count(*) from public.room_modules where targeting_mode <> 'whole_class';` → 0.
  - The Teacher form is unchanged; existing whole-class assignments still start M5/M6 normally.
- **Enable (separate approval):** `m4_module_recipients_ENABLE_PROPOSED.sql`. It refuses if the triggers are missing. Then the Teacher form shows **Assign to: Whole Class / Selected Students**.
- **Manual security test after enabling:** assign a module to Student A only. Student B in the same room must not see it in the room; if B opens it from the catalog, the start is refused with "assigned to selected students only". Student A completes it normally.
- **Disable at any time:** `update public.m4_targeting_rollout set enabled = false where singleton;`. Existing selected assignments stay restricted.
- **Rollback:** `m4_module_recipients_ROLLBACK_PROPOSED.sql`. It refuses while any selected assignment exists, because dropping restrictions would broaden access.

## 5. `m4_room_archive_PROPOSED.sql` — Archive / Restore classroom

- **Decide first:** may Admins archive and restore? The proposal says yes, following the adviser; to restrict it to Teachers, remove the `public.is_admin()` branch before applying.
- **Preflight:** `select count(*) from information_schema.columns where table_name = 'rooms' and column_name = 'archived_at';` → 0.
- **Verify:**
  - All rooms have `archived_at` NULL.
  - `select tgname, tgrelid::regclass from pg_trigger where tgname = 'm4_reject_archived_room';` → 5 rows.
  - The Teacher room page shows **Archive Learning Room**.
  - Data counts unchanged.
- **Manual test:** archive a test room. Its card moves to *Archived Learning Rooms*; a student's join is refused; a student's new reading start is refused; old results stay visible. Restore, then everything works again.
- **Rollback:** `m4_room_archive_ROLLBACK_PROPOSED.sql`. It refuses while any room is archived.

## 6. `m4_admin_classroom_actions_PROPOSED.sql` — audited Admin student removal

- **Preflight:** `to_regclass('public.m4_admin_actions')` NULL.
- **Verify:** as Admin, `select public.m4_admin_classroom_actions();` → `{remove_enrollment}`; as a Teacher → `{}`. The Admin room page shows **Remove** in the roster. After a test removal, one row appears in `m4_admin_actions`.
- **Rollback:** `m4_admin_classroom_actions_ROLLBACK_PROPOSED.sql` (keeps the audit table).

## 7. Order and isolated evidence

Recommended order: 1 → 2 → 3 → 4 (foundation) → 5 → 6, each verified before the next; then the separate **4-ENABLE** step. `release-review\m3m4-proposals\run_combined_rollout_test.sh` applied all six in this order on the disposable restore, ran every full-schema test against the combined state (all passed), rolled everything back in reverse order, and matched all 85 data/grant fingerprints and the original function fingerprints exactly.

Not part of this rollout: `m4_legacy_room_subject_PROPOSED.sql` (kept for later review, per your decision).
