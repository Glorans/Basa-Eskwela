# M5 Saved Pronunciation Checks: Release Note

## Status
- **ReadFlow-Staging (`oudfrdeqwotynihkkmze`):** migration applied 2026-11-05 and verified. V1 passed 20/20, V2 passed 12/12, and existing triggers and grants are unchanged.
- **Staging pre-migration backup:** `C:\Backups\basa-eskwela-staging\2026-11-05_040015_preM5Pronunciation`. Its score fingerprint is `c3291ad0c14a6ff2e891023a590b141f`.
- **Other environments:** not applied. Never apply this to the original team ReadFlow project.

## The SQL
The applied file is `supabase/proposed/m5_pronunciation_checks_PROPOSED.sql`. SHA-256 with LF line endings: `2B5623B4FC53F725EFF175B4411DD28A277A9A43E51CD8ED9834DA3EDA0326F9`.

Its header still says "PROPOSED — NOT APPLIED". The file is kept byte-for-byte as applied, so this note records its status instead.

**Re-applying is blocked:** the file stops with `oral_reading_pronunciation_checks already exists` before creating anything. Don't run it again on staging.

## Reproducing it in a new environment
1. Take a backup.
2. Run `supabase/tests/m5_pronunciation_checks_preflight.sql`. All of its checks must pass.

   In the Supabase SQL Editor, run the checks as separate SELECTs: the editor only shows the result of the last statement, and the file ends with `rollback;`.
3. Run the migration file once.
4. Run the `supabase/tests/m5_pronunciation_checks_verify.sql` checks. Compare the score fingerprint and row counts with the preflight.
5. Deploy the backend, then the frontend. Never deploy the frontend first.

**Rollback:** `supabase/proposed/m5_pronunciation_checks_ROLLBACK_PROPOSED.sql` permanently deletes all saved checks. First back them up into a non-public schema; the procedure is in the file.

## What it adds
One table, `public.oral_reading_pronunciation_checks`:
- It holds one immutable, server-computed result per English oral-reading attempt.
- Only the backend (`service_role`) can access it. Row-level security is on and there are no policies.
- A guard trigger rejects:
  - changes to completed results,
  - rows whose owner doesn't match the attempt's owner,
  - Filipino attempts.

No existing table, score, recording, or M6/M7/M8 data is changed.

## Backend behaviour
- `GET /api/oral-reading/attempts/:id/pronunciation` (owner) and `GET /api/oral-reading/teacher/attempts/:id/pronunciation` (classroom Teacher) read the saved result. They never call the speech service.
- `POST /api/oral-reading/attempts/:id/pronunciation`:
  - returns a saved result without a new assessment;
  - otherwise takes a lease, then assesses one WAV per saved recording file, in order (`part-0.wav`, `part-1.wav`, …);
  - then saves the result.
- **Mismatched uploads:** missing, extra, duplicated or reordered files are refused before any lease or paid call.
- **Leases:** the lease is renewed before each further file. A lease not renewed for 10 minutes counts as abandoned and may be taken over.
- **Without the table:** checks still run, but each result is reported as not saved.
