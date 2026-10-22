# ReadFlow-Staging database setup plan (Basa-Eskwela demo)

Target: **ReadFlow-Staging, project ref `oudfrdeqwotynihkkmze`** (owner-only). Never the team project
`avbubkyzmvjfnrlroehl`. Before every SQL editor session, confirm the dashboard URL contains
`/project/oudfrdeqwotynihkkmze/`; SQL cannot prove which project it runs in.

**Status (2026-10-22, user-confirmed):** B1-B26 and C1 are applied and verified.
**P11a passed:** all five M8 tables are absent. **C2-C8 have not been applied.**
Do not rerun B1-B26 or C1. C2/C3 staging-only hardened replacements are prepared,
not executed; see [C2_C3_STAGING_REVIEW.md](C2_C3_STAGING_REVIEW.md).
Older B-stage preparation/probe notes below are historical; this status supersedes
any earlier statement that those steps are still pending.

## How verification works

Every check is a short, ordinary `SELECT` against the PostgreSQL catalogs, in the style of V1a–V1g.
Each section has a heading (`P2a`, `V2a`, …), a one-line purpose and the expected result. Run **one
section at a time** (the SQL editor shows only the last result of a multi-statement run) and keep the
output. `P` sections run **before** a migration group and `V` sections **after** it. From B3 onward,
also run the security sweep `audit_stage_b.sql` (A1–A8) after every group.

**Any result that differs from "Expect" means STOP.** Do not continue to the next group, do not edit a
migration or a check to make it pass, and do not replay earlier files. Report the output for review.

| File (in `supabase/staging/`) | Sections | When |
|---|---|---|
| `verify_staging.sql` | V0a–V0c, V1a–V1g | V0 before B1, V1 after B1 (done) |
| `preflight_b2.sql` | P2a–P2i | Before B2 |
| `verify_b2.sql` | V2a–V2m | After B2 |
| `verify_b3_b7.sql` | P3a–P3d, P3f, V3a–V3h | Around B3–B7 |
| `probe_p3e_storage_policy.sql` | P3e (one rolled-back CREATE POLICY; the only non-SELECT check) | Between P3d and P3f |
| `verify_b8.sql` | P4a–P4c, V4a–V4i | Around B8 |
| `verify_b9_b15.sql` | P5a–P5b, V5a–V5f | Around B9–B15 |
| `verify_b16.sql` | P6a–P6c, V6a–V6g | Around B16 |
| `verify_b17_b23.sql` | P7a–P7b, V7a–V7h | Around B17–B23 |
| `verify_b24.sql` | P8a–P8b, V8a–V8c | Around B24, plus the two existing `supabase/tests/m5_m6_uploaded_reading_*.sql` inspectors |
| `verify_b25_b26.sql` | P9a, V9a–V9g | Around B25–B26; full Stage B checkpoint |
| `verify_c1.sql` | P10a, V10a–V10e | Around C1 |
| `verify_c2_c3.sql` | P11b, V-C2a-c, V-C3a-c, V-C23d | Before C2 / immediately after each hardened C2/C3 |
| `verify_c2_c6.sql` | P11a, V11a–V11f | Around C2–C6 |
| `verify_c7_c8.sql` | P12a–P12b, V12a–V12g | Around C7–C8; full Stage C checkpoint |
| `audit_stage_b.sql` | A1–A8 | After every group from B3 to C8 |

## Why a baseline is needed

Seven core tables were created in the team project's dashboard and are created by **no** repository
file: `profiles`, `learning_paths`, `modules`, `progress`, `rooms`, `enrollments`, `room_modules`.
`supabase/staging/00_core_baseline.sql` (staging-only) recreates them from
`readflow/src/lib/database.types.ts`, with the foreign-key names the app embeds and the UNIQUE
constraints M4 requires. Columns added by later migrations are left out so those files apply unchanged.

## Stage A — dashboard settings (ReadFlow-Staging only)

1. Authentication → URL configuration: Site URL `http://127.0.0.1:5174`; redirect URLs
   `http://127.0.0.1:5174/**` and `http://localhost:5174/**`.
2. Authentication → Providers → Email: enabled. Teacher registration requires a confirmed email.
3. Storage → New bucket `reading-materials`: **private**, 25 MiB, MIME types `application/pdf`,
   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `image/jpeg`, `image/png`
   (M3 uploads; no repository file creates it). `oral-reading-recordings` is created by C1.
4. Keep registration closed (no real users) until the whole chain and the behaviour tests pass.

## Migration checklist, B2 → C8

Apply each file whole, in this order, in the SQL editor. Every file has its own `BEGIN … COMMIT`
except B3, which has none: paste B3 between your own `begin;` and `commit;`. Never wrap several files
in one outer transaction (their own COMMITs would end it early). Stop at the first SQL error; a failed
file rolls back, so fix the cause and rerun only that file.

### B2 — authentication security (alone)

| # | File |
|---|------|
| B2 + B2a | `supabase/staging/02_b2_hardened.sql` |

- **Before:** `preflight_b2.sql` P2a–P2i. Stop if any value differs, especially P2a
  `can_create_signup_trigger`, P2c (must be 0/0/0), P2d (functions must be absent) or P2e (no
  existing auth/profile triggers).
- **Run** the hardened bundle: B2 (`supabase/m1_onboarding_security_migration.sql`) unchanged, with the
  two B2a REVOKE statements inside B2's own transaction. It replaces the separate B2 and B2a files.
- **After:** `verify_b2.sql` V2a–V2m. Key results: V2e — `assign_own_role(text)` executable by
  authenticated only; both trigger functions executable by neither client role. V2b
  `convalidated = false` is expected. V2g exactly 3 policies.
- **Stop if:** any trigger-function EXECUTE is true (V2e), a profile column is client-writable beyond
  `full_name`/`nickname` (V2i), or auth users exist without profiles (V2k).
- Details and the fallback route: `docs/B2_STAGING_REVIEW.md`.

### B3–B7 — diagnostics and content schema

| # | File |
|---|------|
| B3 + B3a | `supabase/staging/03_b3_hardened.sql` (B3 unchanged, wrapped in one transaction with its REVOKEs) |
| B4 | `supabase/diagnostic_results_language.sql` |
| B5 | `supabase/diagnostic_results_bilingual.sql` |
| B6 | `supabase/diagnostic_results_sentence_versions.sql` |
| B7 + B7a | `supabase/staging/07_b7_hardened.sql` (B7 working copy unchanged, plus REVOKEs before its COMMIT) |

- **Before:** P3a (B2 still correct), P3b (tables absent), P3c (recorded FAIL; not rerun to get a
  different answer), then the alternative Storage route: **P3d** (read-only), **P3e** (rolled-back
  probe, approval needed) and **P3f** (0 Storage policies). Do not start B3 unless P3e succeeded.
- **After:** V3a–V3h, then A1–A8. Expect 11 tables, 6 public policies, 0 storage policies; no client
  EXECUTE on the 7 trigger functions; authenticated `SELECT,INSERT,UPDATE` only on `diagnostic_results`;
  no client privileges on the three content tables until B8.
- **Stop if:** any V3 result differs (it would mean a plain B3/B7 file ran instead of a bundle).

### B8 — content security and storage (alone)

| # | File |
|---|------|
| B8 + B8a | `supabase/staging/08_b8_hardened.sql` (B8 unchanged, plus `REVOKE … FROM anon` on its 7 helpers) |

- **Before:** P4a (expected to repeat P3c's FAIL; record it, it is not a pass), P4b (no existing
  policies), **P4c** (alternative-route conditions still hold). The Storage policies are created by the
  SQL editor's `postgres` role through Supabase's supautils policy grant, which P3e proved.
- **After:** V4a–V4i, then A1–A8. Expect 24 public and 3 storage policies; anon has no table privileges
  on the four content tables and no EXECUTE on the helpers; answer keys readable only by admins and the
  owning teacher (V4d); Storage policies correct by definition (V4h); `storage.objects`/`storage.buckets`
  ownership unchanged (V4i).
- **Stop if:** B8 raises any error (the whole file rolls back; never split it or skip the storage
  section), or any V4 result differs. Never change managed-table owners.

### B9–B15 — classrooms, oral reading, passages, publication, deletion

| # | File |
|---|------|
| B9 | `supabase/m3_student_published_module_access.sql` |
| B10 | `readflow/supabase/migrations/20261005_m4_classroom_management.sql` |
| B11 | `supabase/m5_oral_reading_schema.sql` |
| B12 | `supabase/m3_module_passages_phase1.sql` |
| B13 | `supabase/m3_module_passages_phase2.sql` |
| B14 | `supabase/m3_enable_collection_publication.sql` |
| B15 | `supabase/m3_module_deletion.sql` |

- **Before:** P5a (three immediate UNIQUE constraints B10 needs), P5b.
- **After:** V5a–V5f, then A1–A8. Expect 15 tables, 41 public policies; V5b `as_expected` true for all
  21 functions.
- **Stop if:** any `as_expected` is false, or a classroom policy count in V5d differs.

### B16 — teacher verification (alone)

| # | File |
|---|------|
| B16 | `supabase/m1_teacher_verification.sql` |

- **Before:** P6a (expected FAIL as at P3c; proceed only if V4h passed and P4c still matches);
  **P6b must be 0** — B16 automatically
  approves every existing teacher; P6c.
- **After:** V6a–V6g, then A1–A8. Expect 17 tables, 54 public and 4 storage policies, 14 restrictive
  approval policies (V6e), and `assign_own_role` no longer offering teacher (V6d).
- **Stop if:** any check differs. **Never rerun B2 (or the B2 bundle) after B16**: it would restore the
  older teacher-selecting RPC.

### B17–B23 — M5/M6 dependencies

| # | File |
|---|------|
| B17 | `supabase/m1_profile_age.sql` |
| B18 | `supabase/m3_material_question_sets.sql` |
| B19 | `supabase/m3_question_set_options.sql` |
| B20 | `supabase/m5_reading_activity_assignments.sql` |
| B21 | `supabase/m5_selected_passage_security.sql` |
| B22 | `readflow/supabase/m6_comprehension_schema.sql` |
| B23 | `readflow/supabase/m6_comprehension_functions.sql` (live-database export; its question-set writer must be the final version) |

- **Before:** P7a (column-scoped profile SELECT; otherwise B17's guard aborts), P7b.
- **After:** V7a–V7h, then A1–A8. Expect 21 tables, 65 public policies; private `age` not
  client-readable (V7b); `m6_apply_action` and `m3_write_material_question_set` backend-only (V7c).
- **Stop if:** V7c `as_expected` false (expected for `m5_protect_activity_identity` under Supabase
  defaults), or V7d shows more than `SELECT,INSERT` + `UPDATE(status)` on
  `reading_activity_assignments`.

### B24 — uploaded-reading integration (alone)

| # | File |
|---|------|
| B24 | `supabase/migrations/20261012_m5_m6_uploaded_reading.sql` |

- **Before:** P8a–P8b, then the whole of `supabase/tests/m5_m6_uploaded_reading_preflight.sql`
  (read-only transaction with an assertion block; save its output).
- **After:** V8a–V8c, the whole of `supabase/tests/m5_m6_uploaded_reading_verify.sql`, then A1–A8.
- **Stop if:** B24's embedded security guard raises. It rolls back; inspect the reported definition.
  Never edit or remove the guard.

### B25–B26 — final Stage B setup

| # | File |
|---|------|
| B25 | `supabase/migrations/20261012_m6_activity_question_sets.sql` |
| B26 | `supabase/staging/01_seed_learning_paths.sql` (six synthetic paths) |

- **Before:** P9a (no learning paths yet).
- **After:** V9a–V9g, then A1–A8. Expect 21 tables, 65 public and 4 storage policies, exactly the six
  seeded paths, the private `reading-materials` bucket (V9f) and 0 auth users without profiles.
- **Then:** take and check the Stage B backup (see Backup) before Stage C.

**Do not apply:**
- `supabase/migrations/20261012_separate_question_review.sql`: "prepared only; not applied" in the team
  database (the live export in B23 lacks it), and it removes the `review` operation the current server
  still sends. Applying it would break M3 question review.
- `supabase/m3_material_question_sets_rollback.sql` (rollback only) and the synthetic baselines in
  `supabase/tests/` (`m3_staging_baseline.sql` is superseded by B1).

### C1 — M5 recording storage (alone)

| # | File |
|---|------|
| C1 | `supabase/migrations/20261019_m5_recording_playback.sql` |

- **Before:** Stage B backup done; P10a (no recordings table or bucket yet; bucket INSERT allowed).
- **After:** V10a–V10e, then A1–A8. Recordings table service-role only; bucket private, 25 MiB, four
  audio types; **no** storage policy for the bucket (V10d): playback is authorized by the backend,
  which checks the learner or approved teacher and issues short-lived signed URLs.
- **Stop if:** the bucket already existed before C1 (its ON CONFLICT would overwrite settings).

### C2–C6 — M8 gamification

| # | File |
|---|------|
| C2 | `supabase/staging/c2_m8_gamification_hardened.sql` (replaces the C2 original) |
| C3 | `supabase/staging/c3_m8_completion_integration_hardened.sql` (replaces the C3 original) |
| C4 | `readflow/supabase/migrations/20261021000000_m8_classroom_leaderboard.sql` |
| C5 | `readflow/supabase/migrations/20261022000000_m8_consistent_reader.sql` |
| C6 | `readflow/supabase/migrations/20261023000000_m8_independent_leaderboard.sql` |

- **Before:** P11a already passed. Run `verify_c2_c3.sql` P11b (no orphaned M8 functions/triggers).
  C2 is not re-runnable. Use the whole staging replacements, never both replacement and original.
- **After each C2/C3:** run its immediate V-C2*/V-C3* checks and V-C23d, then
  V11a/V11b/V11e/V11f and A1-A8. Exact expectations and remaining integrity/privacy risks:
  [C2_C3_STAGING_REVIEW.md](C2_C3_STAGING_REVIEW.md).
- **After:** V11a–V11f, then A1–A8. M8 tables SELECT-only for signed-in users and own rows only;
  only the two leaderboard RPCs are client-callable; 5 M8 triggers; exactly 8 badges.
- **Stop if:** any check differs. The C2/C3 replacements revoke the three known trigger-function grants before COMMIT; V11c must now pass.

### C7–C8 — M7 analytics and weekly reports

| # | File |
|---|------|
| C7 | `supabase/migrations/20261024_m7_analytics.sql` (install-once) |
| C8 | `supabase/migrations/20261024_m7_weekly_reports.sql` |

- **Before:** P12a (no M7 objects), P12b (scoring RPC, `enrollments.id`, every M6 user has a profile).
- **After:** V12a–V12g, then A1–A8. M7 functions and the risk-queue sequence backend-only; exactly 7
  M7/M8 triggers on the existing M1/M2/M4/M5/M6 tables (V12e); final totals 31 tables, 72 public and
  4 storage policies, 0 tables without RLS. Keep `M7_RISK_WORKER_ENABLED` off. Rollback and risks:
  `docs/M5_M8_MIGRATION_READINESS.md`.

### DT1 — trusted M2 diagnostics (alone; prepared, not applied; prerequisite for C9)

| # | File |
|---|------|
| DT1 | `supabase/migrations/20261025_m2_trusted_diagnostics.sql` (install-once; refuses to rerun) |

- **Before:** `verify_dt1_diagnostic_trust.sql` P-DT1a–P-DT1e; record P-DT1b's row counts and P-DT1e's totals.
  `DIAGNOSTIC_RECEIPT_SECRET` is set on the backend, and the DT1 backend and frontend are ready to deploy
  right after it (from DT1 on, the old frontend can no longer save diagnostics).
- **After:** V-DT1a–V-DT1j, then A1–A8. Existing rows all `unverified` with P-DT1b's counts;
  authenticated SELECT only on `diagnostic_results`; 2 policies on it (own-row SELECT and B16's
  restrictive approval policy); totals 31 tables, 70 public policies, public functions +2. Keep V-DT1j's
  output for C9. Design, deployment order and risks: [DT1_DIAGNOSTIC_TRUST_REVIEW.md](DT1_DIAGNOSTIC_TRUST_REVIEW.md).
- **Stop if:** the guard raises, or any V-DT1 result differs. Never upgrade an `unverified` row in place.

## Known privilege gaps (decisions needed before the affected group)

Supabase's default privileges grant new `public` tables and functions directly to `anon` and
`authenticated`. Revoking from `PUBLIC` does not remove those direct grants. Live staging's defaults were
confirmed for functions (P9 earlier; now P2i). An offline dry run with the same defaults found these
gaps. The checks above stop on each one. Corrections are REVOKE-only, without definition changes.
For C2/C3, the corrections are inside the original transactions in the staging replacements,
so there is no separate post-COMMIT correction step:

| After | Object | Left over from defaults | Intended |
|---|---|---|---|
| B2 | `handle_new_user()`, `m1_protect_profile_authorization_fields()` | anon/authenticated EXECUTE | none — **fixed by the B2 bundle** |
| B3–B7 | 7 trigger functions (V3e) | anon/authenticated EXECUTE | none — **fixed by the B3/B7 bundles** (prepared) |
| B3 | `diagnostic_results` | authenticated DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | SELECT, INSERT, UPDATE — **fixed by the B3 bundle** (prepared) |
| B7→B8 | `uploaded_materials`, `comprehension_questions`, `comprehension_question_answers` | full anon/authenticated access between B7 and B8 | none until B8 — **fixed by the B7 bundle** (prepared) |
| B8 | 7 SECURITY DEFINER helpers (V4a) | anon EXECUTE (callable over the API) | authenticated only — **fixed by the B8 bundle** (prepared) |
| B20 | `reading_activity_assignments` | anon all privileges; authenticated UPDATE (all columns), DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | authenticated SELECT, INSERT, UPDATE(status) |
| B20 | `m5_protect_activity_identity()` | anon/authenticated EXECUTE | none (trigger-only) |
| C2/C3 | `m8_sync_diagnostic()`, `m8_oral_completed()`, `m8_on_module_xp_granted()` | PUBLIC/anon/authenticated EXECUTE | none (trigger-only) -- hardened staging replacements prepared, not applied |

RLS still blocks row access for these tables (no anon policies exist), but RLS does not govern TRUNCATE
and grants should match intent. B1-B26 and C1 are now user-confirmed applied and verified.
C2/C3 corrections are prepared in the replacement files above; no C2-C8 migration was run
as part of the current review. The earlier offline validation below is historical evidence,
not a claim that these new replacements were executed.

## Stage D — accounts (synthetic adults only)

1. Authentication → Users → Add user, with **Auto Confirm**, for: admin, teacher, student, independent
   learner (test email addresses you control).
2. Admin role: profile roles are server-managed, so set it once in the SQL editor
   (`update public.profiles set role = 'admin' where id = '<admin user id>';`). This is a data write;
   run it only with approval.
3. Teacher: sign in as admin → Teacher Invitations → create a code; sign in as teacher → register with the
   code; admin approves in User Management.
4. Student and independent learner: sign in → choose role → complete the initial diagnostic
   (needs Google speech) → teacher creates a room, student joins with the room code.
5. Content: admin creates and publishes a module (pick a seeded learning path) using the test passages in
   `docs/M5_M8_DEMO_CHECKLIST.md`; generate and approve comprehension questions; teacher assigns it.

Catalog checks pass on an empty database; they do not prove behaviour. After Stage D, test with real
client sessions (not service_role): signup creates one role-neutral profile; users see only their own
profile; learners cannot read answer keys; pending teachers are restricted; M5 save and playback work for
the owner and the approved teacher only; M6 completion awards XP once; M7 reports are teacher-scoped.

## Configuring Basa-Eskwela with staging credentials only

From the **ReadFlow-Staging** dashboard (Project Settings → API / API Keys), never from the team project or
the original ReadFlow `.env` files:

- `server/.env` (copy `server/.env.example`): `SUPABASE_URL` = staging Project URL;
  `SUPABASE_SERVICE_ROLE_KEY` = staging **secret/service-role** key (backend only); `GEMINI_API_KEY` (a key
  you own); Google speech via a dedicated credential file path outside the repository (keep the example's
  deliberately invalid default until you have one); keep `PORT=5001`, the 5174 origins, and
  `M7_RISK_WORKER_ENABLED=false`.
- `readflow/.env.local` (copy `readflow/.env.example`): `VITE_SUPABASE_URL` = staging Project URL;
  `VITE_SUPABASE_PUBLISHABLE_KEY` = staging **publishable** key (never the secret key in a `VITE_*`
  variable); `VITE_API_URL=http://127.0.0.1:5001`.
- Both files are git-ignored. After filling them, ask for the read-only audit, which reports only project
  refs and yes/no presence: both refs must read `oudfrdeqwotynihkkmze`.

## Backup

Free plan projects have no dashboard backups; use a logical dump. After Stage B and again before Stage C,
with the staging session-pooler connection string held in an environment variable (never pasted into chat
or saved in the repository): `supabase db dump -f schema.sql`, `supabase db dump --data-only -f data.sql`,
`supabase db dump --role-only -f roles.sql`, stored outside the repository. Because staging starts empty,
the simplest full recovery is also available: reset the staging project and replay Stages B–C.

## Offline validation (2026-10-22)

No Supabase database was accessed. Every verification file parses as SELECT statements only. The whole
B1 → C8 order (with the B2 bundle) was replayed in an in-memory PostgreSQL 17.5 (PGlite) with stand-ins for
Supabase's roles, default privileges, `auth`/`storage` schemas and `ensure_rls`. Every migration applied,
every P/V/A section ran without a SQL error, and results matched the expectations written in the files
(the B8/B20/trigger-function gaps above appear exactly where those files say to stop). A behaviour test
of the B2 bundle confirmed signup still creates a role-neutral profile through a non-superuser role and that
role assignment and profile protections hold. A dry run is not the managed platform: verify each stage live.

## Known risks

- B1 is a reconstruction. If the team dashboard also had triggers, defaults or policies on those seven
  tables that are not visible in `database.types.ts`, behaviour could differ.
- Google speech (M2 diagnostic, M5 read-aloud) and Gemini (question generation) need working credentials.
  Learners cannot reach their dashboards without completing the diagnostic.
