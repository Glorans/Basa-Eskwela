# M3 permanent-delete correction — applied and verified on staging

Verified 2026-11-04 (Asia/Manila). The approved function-only correction is now installed on ReadFlow-Staging; see the execution record below. All staging inspection used explicit read-only transactions, and no staging module mutation RPC was called. M4 remains unapplied in this step.

## Root cause

`m3_purge_module` deletes answer keys first. The `answers_collection_change` trigger calls `m3_collection_bank_changed`, which executes `UPDATE public.modules SET title=title WHERE id=parent_id` to maintain the collection revision. `modules_protect_deleted` invokes `m3_protect_deleted_module`, which correctly raises P0001 because that parent is already in Trash.

The purge RPC sets `m3.purge_module`, but omits the private, transaction-scoped `m3_deletion_context` marker that the bank trigger already recognizes for authorized DELETE operations. The question DELETE trigger has the same dependency. This is an integration bug, not evidence that the draft revision has learner history. The previous Trash test purged a fixture with a passage but no questions/answer keys, so it never exercised either bank trigger.

## Read-only staging findings

Two rows share the title **English Reading 2**:

| ID | State | Permanent-delete eligibility at inspection |
| --- | --- | --- |
| `c3c6de24-272d-4744-a34c-baf47a6d0389` | Draft revision 2; `deleted_at` populated; Trash entry present; never published | Eligible: history helper returns false; no assignments, progress, oral attempts, comprehension attempts, module XP events or incoming revision references. Owns one passage, six questions and six answer keys. |
| `b9b0c515-a895-4640-890f-8611f26bc9de` | Previously published original, now archived; `deleted_at` NULL; no Trash entry | Not eligible: not in Trash, and the draft's `revision_of` / `revision_root` references protect it. No learner attempts or assignments were found. |

Neither row is simultaneously archived and in Trash. `English Reading Set` remains published and unchanged. Eligibility must be checked again at any future deletion; the correction grants no permission to delete these named modules.

## Proposed correction

The approved file `supabase/proposed/m3_module_purge_bank_fix_PROPOSED.sql` was applied after backup/preflight checks. Do not rerun it or the installed Trash/Revisions migrations.

The correction replaces only `m3_purge_module`, adding two executable statements:

1. Insert `(target_id, txid_current())` into the private deletion context **after** Admin authorization, Trash validation, row locking and the existing history check pass.
2. Remove that marker after successful cleanup. An exception rolls back the operation, including the marker and any child deletions.

The file guards the reviewed purge, bank-change, deleted-module protection and history-helper fingerprints. `CREATE OR REPLACE` retains owner and grants; `SECURITY DEFINER` and the empty search path are explicit. No triggers, history checks, foreign keys, RLS policies or other functions are changed. The context remains inaccessible to API callers; merely setting the purge GUC cannot authorize child cleanup.

The frontend maps this exact purge P0001 to a clear explanation that question-bank cleanup was blocked, the module remains in Trash, and nothing was deleted. The original error stays in `causeValue`. Existing history/not-in-Trash messages and unrelated errors retain their behavior.

## Focused verification

Used the existing disposable `basa-m3-trash-restore-LOCAL` container at `127.0.0.1:55425`; relevant installed definitions matched staging before reproduction.

- Before correction: the expanded existing Trash test reproduced the exact P0001 and captured the full answer-delete → bank-change → parent-update → deleted-module-protection stack.
- After correction: only the purge function body changed; owner, SECURITY DEFINER, search path, volatility, ACLs, all triggers and all existing rows were preserved.
- Expanded Trash test passed: populated draft and published/archived banks purge successfully; classroom references and real learner-progress records refuse purge with content/history retained; Admin-only access and private-marker protections hold; normal Archive and both draft/published Restore behaviors remain unchanged.
- Expanded Revisions test passed: purging a disposable draft revision with copied question banks leaves both published ancestors unchanged; existing revision tests still pass.
- `readflow/tests/m3ModuleActions.test.ts`: 3/3 passed, including the new error mapping, preserved diagnostic cause and unchanged history/state refusals.
- All fixture transactions rolled back. Existing disposable rows were unchanged. A final read-only comparison confirmed staging schema and captured table contents unchanged, including both named modules.

Local logs and inspection fingerprints: `.tmp/m3-purge-fix/`. No full suites, paid APIs, M4/M5 changes, team-database access, commits, pushes or deployments.

## Approved staging execution — 2026-11-04

- Connection verified as ReadFlow-Staging (`oudfrdeqwotynihkkmze`); the original team target was excluded.
- The previous checkpoint predated Trash/Revisions and the new revision records, so a fresh backup was taken at `C:\Backups\basa-eskwela-staging\2026-11-04_070950_preM3PurgeFix`. Checksums passed; all earlier backups were preserved. Restore into `basa-m3-purge-backup-LOCAL` (`127.0.0.1:55426`) passed 8/8 focused restore checks, zero schema differences, and matching full-row fingerprints across all 34 public/storage tables (334 rows). The existing backup exclusions for auth data, storage file contents and platform settings still apply.
- Staging schema, security and row contents remained unchanged during backup. The final enforced read-only preflight passed all four reviewed function fingerprints, owner/security/search-path/ACL checks, and private-context protections.
- Applied **only** `m3_module_purge_bank_fix_PROPOSED.sql`, in one transaction. Pre-commit checks passed; an independent read-only connection verified the committed result.
- `m3_purge_module` retains owner `postgres`, `SECURITY DEFINER`, empty search path, volatility and its existing grants. Authorization, Trash eligibility, locking and history checks are unchanged. All other function definitions, triggers, policies, constraints and grants are unchanged.
- Installed CR-normalized definition fingerprint: `7fe028161bb7f2ff2fcd4f982fc261b6`, exactly matching the tested disposable version. The only executable body changes are the two private-context statements described above.
- All existing module, bank, assignment, assessment and XP row fingerprints are unchanged. Both `English Reading 2` rows and `English Reading Set` remain untouched. No Permanent Delete or other module mutation RPC was executed on staging.
- Evidence: `%LOCALAPPDATA%\BasaEskwelaLocal\release-review\m3-purge-rollout\` (`restore_verify.txt`, `backup_verified.json`, `committed.json`, `result.json`). No earlier M3 or M4 migration was applied; no full suites, paid API calls, commits, pushes or deployments.

**Manual testing is now available:** refresh localhost as Admin and test Permanent Delete on a disposable module in Trash. The archived original is still protected by its revision references. M4 rollout is a separate next step.
