# M3 Teacher Trash and Publish Again: release procedure

**Status:** proposed and rehearsed locally only. **Not applied to Staging or production. Not deployed.**
Until this release is complete, the Teacher Trash and Publish Again do **not** work on Staging.

## Current behaviour on Staging (until the migration is applied)

- A Teacher's **Delete** calls `m3_delete_module`.
- A module with **no learner or classroom history** (most drafts) is **permanently erased**, with its passages, questions and answer keys.
- A module with history is hidden, but the Teacher cannot see it in any Trash and cannot restore it.
- Restoring, and Publish Again, are not available to Teachers.

## What the release adds

**`supabase/proposed/m3_teacher_trash_PROPOSED.sql`:**
- Teachers move their own modules to the Trash, and restore what they trashed.
- They **cannot** trash a module that is still assigned in a Learning Room.
- After restoring their own published module (it comes back Archived), they can choose **Publish Again**. It is validated exactly like a first publication.
- Teachers lose every permanent-deletion path. Permanent deletion stays with the School Admin.

**Frontend, `feat/m3-teacher-module-parity`:**
- the Trash section on My Reading Modules (Restore only);
- the Publish Again button;
- the Teacher wording.

## Recommended order: SQL first, then the frontend (no window for permanent loss)

Applying the SQL first is the order that removes the risk of permanent deletion:

| Between the steps | Effect |
|---|---|
| SQL applied, old frontend still live | A Teacher's Delete calls the old `m3_delete_module`. The database **refuses** it for Teachers ("Teachers move reading modules to the Trash; permanent deletion is not available to Teachers"), so **nothing can be erased**. Admins are unaffected. |
| New frontend deployed | Delete moves modules to the Trash; Restore and Publish Again appear. |

The reverse order (frontend first) leaves Teacher Delete permanently erasing unused drafts until the SQL is applied. **Do not use it.**

## Steps (each needs separate approval)

1. Fresh Staging backup with the established procedure, then verify it and test a restore.
2. Run `m3_teacher_trash_VERIFY_READONLY.sql` **PREFLIGHT** in the SQL Editor.
   - Every row must be true. The function fingerprints were measured on Staging on 2026-11-17.
   - A mismatch means a function changed: **stop**.
3. Apply `m3_teacher_trash_PROPOSED.sql` in one run. It is a single transaction: on any error nothing changes.
4. Run **POST-APPLY**: every row must be true.
5. **Immediately** deploy the frontend from `main` after the branch is merged (manual Render deploy). Keep the gap between steps 3 and 5 short; during it a Teacher's Delete only shows a refusal message.
6. Smoke test as an approved Teacher, on a disposable module:
   - create → save draft → generate and review questions → publish;
   - unassign if needed → Delete (moves to Trash) → Restore (comes back Archived);
   - Publish Again (validated) → assign to a Learning Room.
7. As School Admin, check that Content Management, Trash, Restore, Delete Permanently and Archive behave as before.

## Rollback

- `m3_teacher_trash_ROLLBACK_PROPOSED.sql` restores the four functions exactly, and drops the helper and the Publish Again table and function.
- It touches no module, passage, question or learner result.
- Modules Teachers put in the Trash stay in the Trash; the School Admin can restore or purge them.
- If the new frontend is still live after a rollback, a Teacher's Trash call is refused, and the page falls back to the old Delete. That is the hard-delete behaviour again, so redeploy the previous frontend in the same window.

## Evidence (local only, on a restored copy of the 2026-11-17 Staging backup, no network)

- PREFLIGHT 12/12, then apply, then POST-APPLY 12/12.
- Trash and Publish Again scenarios: **67/67**. Updated module-management test: **67/67**. Both rolled back.
- After rollback: PREFLIGHT 12/12 again (exact original functions); original test 66/66.
- No persistent data changed.
