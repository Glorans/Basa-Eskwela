# DT1 — trusted Module 2 diagnostic results (review)

Status: **implemented locally, not applied, not committed.** Prerequisite for C9. Nothing here
touched ReadFlow-Staging, the original ReadFlow repository, or a paid Google API.

## Why

Before DT1 the browser decided the official reading level:

| Where (before DT1) | What |
|---|---|
| `supabase/staging/03_b3_hardened.sql:68-112` | `authenticated` has `INSERT, UPDATE`; both policies only check `auth.uid() = user_id`. |
| `readflow/src/modules/module2/services/diagnosticRepository.ts:250-292` | The browser "rescores" (line 259) and then upserts `reading_level`/`difficulty_tier` (line 290). Any client can skip that code and send its own values. |
| `server/routes/diagnosticAudio.js:26`, `server/services/diagnosticSpeechStream.js:96` | Google transcripts are returned to the browser with nothing binding them to the user, language, diagnostic or recording; the browser concatenates and scores them. |
| `supabase/staging/c2_m8_gamification_hardened.sql:51-64` | `m8_sync_diagnostic` copies whatever level was written last (EN or FIL) into one shared `unlocked_difficulty`. |
| `supabase/staging/c3_m8_completion_integration_hardened.sql:22-25` | `raise exception 'Reading difficulty is locked'` rolls back the M6 completion itself. |

So M8 XP authorization depended on a learner-controlled value. The last two rows are C9's scope.

## Design

```
M2 reading page names its diagnostic when it sends audio:
  HTTP part:  language, recordingId, segmentIndex, assessmentId, assessmentVersion
  WebSocket:  configure { language, diagnostic: { assessmentId, assessmentVersion } }
backend checks that this is the ACTIVE diagnostic for the language, transcribes with Google,
and signs the FINAL transcript it produced:
  receipt = HMAC(DIAGNOSTIC_RECEIPT_SECRET, { purpose "m2-initial-diagnostic", user, language,
            assessmentId, assessmentVersion, sha256(server passage text), recordingId, part,
            source, text, confidence, audio seconds*, issued at })
browser keeps receipts while the learner answers (sessionStorage, ≤24 h)
POST /api/diagnostic/results { language, assessmentId, assessmentVersion, answers, transcriptReceipts[], recordingDurationSeconds }
  └─ learner role (student/general_user) → active assessment → every receipt: signature, purpose,
     user, language, assessment id/version, passage hash, one recording, parts 1..n in order, ≤24 h
     → join transcripts → server copy of the rubric → service-role INSERT ('server_verified')
```
\* streaming only: counted by the server from the PCM it received.

- **Receipt binding.** A receipt counts only for the learner, language, active assessment version and
  passage text it was issued for. Retired versions, the other language's diagnostic, M5 readings and a
  changed passage are rejected. M5 read-alouds (HTTP uploads without the M2 fields, and voice-follow
  streams without `diagnostic`) never receive receipts.
- **The browser never sends scores, levels, tiers or transcripts**; extra fields are ignored. Editing a
  receipt's text breaks its signature.
- **Rubric unchanged.** `server/services/diagnosticScoring.js` is a line-for-line port;
  `server/tests/diagnosticTrustedScoring.test.js` runs the frontend TypeScript and the server port on
  the same inputs (301 transcript × answer combinations per language, all 169 threshold-edge pairs) and
  checks the answer keys and passages match.
- **Duration** affects WPM only, never the level. Streaming: server-measured. Uploads: browser-reported,
  accepted only within the verified part count (`n × 25 s + 5 s`), otherwise dropped
  (`oral_reading_metrics.durationSource`). Segmentation and the five-minute limit are unchanged.
- **Retries/duplicates:** one verified row per learner/language/version and one per recording. Resending
  the same recording returns the stored row (200); a different recording returns 409
  `DIAGNOSTIC_ALREADY_COMPLETED`. Concurrent submissions resolve through the unique indexes.
- **Missing `DIAGNOSTIC_RECEIPT_SECRET`** (≥32 chars): M2 uploads, M2 streams and result saves return
  503 / close before Google is called. M5 uploads and M5 voice-follow streams are unaffected.
- **Admins** can no longer save diagnostic results (submission uses the M2 learner roles only).

## DT1 migration

`supabase/migrations/20261025_m2_trusted_diagnostics.sql` (forward-only, install-once; read-only checks in
`supabase/staging/verify_dt1_diagnostic_trust.sql`, P-DT1a–e before, V-DT1a–j after):

1. Adds `verification_status` (default `'unverified'`, so every existing row is marked unverified),
   `verification_method`, `verification_recording_id`, `verified_at`, with a check that verified rows
   carry complete evidence and unverified rows carry none.
2. Replaces B6's unique constraint with per-status partial unique indexes, so a verified result is a
   **new row** next to the historical one instead of overwriting it.
3. Revokes `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN` from `PUBLIC`, `anon`,
   `authenticated`; drops the two permissive INSERT/UPDATE policies; keeps own-row SELECT and B16's
   restrictive "M1 Teacher approval required" policy.
4. Trigger `m2_protect_diagnostic_verification` (BEFORE INSERT OR UPDATE), for every role including the
   service role: new rows must be `server_verified`; historical `unverified` rows are read-only; verified
   rows and their evidence cannot be changed. Account deletion (ON DELETE CASCADE) still works.
5. `m2_trusted_reading_level(user, language)`: latest verified level for that language, `NULL` otherwise.
   Service-role/trigger use only; not yet used (C9).

Because of (3) and (4), `m8_sync_diagnostic` (AFTER INSERT OR UPDATE OF `reading_level`) can now only
fire for server-verified rows. Its code is unchanged.

### Expected database objects after DT1 (post-C8 staging)

| Object | Expected |
|---|---|
| Public tables | 31 (unchanged) |
| Public policies | 70 (72 − 2) |
| Policies on `diagnostic_results` | 2: permissive own-row SELECT; B16 restrictive ALL |
| Public functions | +2: `m2_protect_diagnostic_verification()`, `m2_trusted_reading_level(uuid,text)` — both SECURITY INVOKER, `search_path=""`, no anon/authenticated EXECUTE |
| Triggers on `diagnostic_results` | 3: `diagnostic_results_protect_verification`, `diagnostic_results_set_updated_at`, `m8_diagnostic_sync` |
| Unique indexes on `diagnostic_results` | 4: primary key + 3 partial unique indexes |
| `authenticated` on `diagnostic_results` | SELECT only; `anon` none |
| A5 / A7 / V12e | unchanged (no new definer or client-callable functions; trigger name has no `m7_`/`m8_` prefix) |

## Existing (unverified) results

- Kept unchanged, labelled `unverified`, shown as "(unverified)" in the admin results table. Admin lists
  every row, so a revalidated learner appears twice per language (old and verified).
- **Not counted as a completed diagnostic** by the learner app (guard, post-login path, M3 placement,
  result page). A learner whose only rows are unverified retakes the diagnostic once after deployment.
- No path upgrades or edits a historical row.
- **M8 state already derived from them stays** (`unlocked_difficulty`, `level_up` badges, leaderboard and
  M8 UI difficulty display). C3 still authorizes module difficulty from `unlocked_difficulty` until C9.
  V-DT1j lists the affected learners. C9 must stop using that value for authorization.

## C9 prerequisite: module language

`modules` has **no language column**. The language comes from:

| Attempt kind | Source | Values |
|---|---|---|
| Module / module passage | `modules.path_id → learning_paths.language` | free text, no CHECK (seeded `'English'`/`'Filipino'`); normalized only in Node by `normalizeLanguage` (`oralReadingAttemptService.js:41`) |
| Uploaded material | `uploaded_materials.language` | CHECK `('en','fil')`, normalized in `assignedReadingSource.js:35` |
| **Every M6 attempt** | `m6_comprehension_attempts.language` | NOT NULL, CHECK `('en','fil')`, written by the backend (`comprehensionAttemptService.js:513`) from the value above; no client INSERT/UPDATE |

**C9 should use `new.language` on `m6_comprehension_attempts`**: it is server-written, constrained to the
diagnostic codes, and is the language actually read. Do not re-derive from `learning_paths.language` in
SQL (it is unconstrained free text). Optionally assert it matches the module's path when `module_id` is set.

## C9 design (prepared, not implemented)

- `m8_on_comprehension_completed` must never `raise` because XP is unavailable: a valid M6 completion
  always commits. Remove the `Reading difficulty is locked` exception; decide XP by branching.
- **Teacher-assigned work** (activity assignments, room modules): XP from verified relationships only —
  assignment `student_id` = learner, current enrollment in the room, published material/module, assignment
  not withdrawn. No diagnostic needed. A mismatched relationship still raises (unauthorized attempt).
- **Independent modules:** allowed tier = `m2_trusted_reading_level(user, new.language)`;
  XP = tier XP of `min(module tier, allowed tier)`. `NULL` → completion saved, no difficulty-dependent XP.
- Replace `m8_sync_diagnostic`'s shared last-write-wins `unlocked_difficulty` with per-language trusted
  eligibility (or keep it display-only). `level_up` only from verified rows; decide whether to recompute
  or keep badges already earned from unverified rows (V-DT1j).
- Keep `m8_grant_xp`'s `(user, source_type, source_id)` uniqueness; no `exception when others`.
- Keep trigger names/order so V12e and the M7 triggers on `m6_comprehension_attempts` stay compatible.

## Coordinated DT1 / C9 deployment (one window, staging first)

1. Set `DIAGNOSTIC_RECEIPT_SECRET` on every backend instance (same value).
2. Apply DT1 with P-/V-DT1 checks and A1–A8. From here the old frontend cannot save diagnostics.
3. Deploy the DT1 backend (new route and receipts; it needs DT1's columns), then the frontend.
4. Revalidate synthetic learners (EN and FIL diagnostics) and confirm verified rows appear.
5. Apply C9 (after its own review) in the same window or before learners use M6/M8 again, so the
   legacy-derived `unlocked_difficulty` stops authorizing XP.

Old backend + DT1 database is safe (it never wrote diagnostics). There is no DT1 rollback script on
purpose: re-granting client writes would reopen the hole.

## Residual risks

- **Answer keys are still in the frontend bundle** (`correctChoiceId`). The server scores answers itself,
  but a learner can read the keys and max comprehension. Because the level is the *lower* of word reading
  and comprehension, this cannot lift the level above genuine read-aloud performance. Recommended before
  production: remove `correctChoiceId` from the browser data (the server already has its own copy).
- **Audio provenance:** the server proves Google transcribed audio sent with this learner's session for
  this diagnostic, not who was speaking or that the passage was on screen. Inherent to remote assessment.
- A learner can make several recordings and submit any one; only the first accepted submission per
  version counts.
- Receipts contain the learner's own transcript and user id, signed but not encrypted, in sessionStorage
  (the transcript was already stored there). Rotating the secret invalidates in-progress diagnostics.
- Submission throttling (20 per 10 min per learner) is in-memory, like the speech limits.
- The manual Chrome harness `readflow/tests/browser/module2/` was already stale (pre-v3.0, and it passes
  `authenticate` to the socket, which takes `authorize` since 8f36058); it does not cover DT1.
