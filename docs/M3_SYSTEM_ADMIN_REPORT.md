M3 System Admin ? local implementation review, November 18, 2026

Worktree: `%LOCALAPPDATA%/BasaEskwelaLocal/m3-system-admin`
Branch: `feat/m3-system-admin`
Verified remote main/base: `d97255b642746ecc7c49eb3405bf36174b942083`.
No commit, push, merge, deployment or live database change was performed.

**Audit and existing behavior**

System Admin previously had the shared admin shell, account-management routes and own settings only. None of the ten M3 functions was reachable through its authorized routes. Existing server role allowlists, module RPC guards and Storage policies also excluded it. The Appendix N feature list supplied in the request is the acceptance checklist; a separate Appendix N document was not present in this checkout.

School Admin uses Module3Page, ModuleFormPage/AdminCollectionEditor and the same editor for module detail. It creates and edits collections/passages, extracts uploaded files into passages, edits question banks, validates/publishes, and uses the existing Trash/history-preserving deletion workflow. School Admin standalone material-detail/question-review routes exist, but its standalone upload API is intentionally denied. Teacher reuses this editor through workspace=teacher, filters its authoring list to its own modules, and has the shared standalone material library/upload/question interfaces. Approved Teacher checks and ownership enforcement remain intact.

RequireRole uses the authenticated profile and retains separate System Admin, School Admin and approved Teacher route groups. The new routes are exclusively under /system-admin/content. The new sidebar links use the existing admin shell and CSS. No new editor, stylesheet, scoring calculation or parallel business workflow was introduced.

**Changes and feature coverage**

| Function | Reused implementation / focused evidence |
|---|---|
| 1. Create reading module | Shared editor and m3_create_collection_draft; System Admin form interaction and actual RPC tested locally. |
| 2. Organize by difficulty | Existing difficulty/reading-level selection and list filtering; System Admin difficulty filter tested. |
| 3. Edit module | Shared draft save and revision locking; System Admin edit/save interaction and SQL lock tests. |
| 4. Delete module | Existing confirmed Trash action and fallback history-aware deletion RPC; System Admin list dispatch tested. No deletion semantics rewritten. |
| 5. Publish module | Existing explicit Publish Module, context validation and database publication workflow; interaction and publication/status tests. Saving does not auto-publish. |
| 6. View module | Existing read-only editor and revision display; System Admin links, rendering and module-read SQL tested. |
| 7. Upload reading material | Shared passage extraction and standalone UploadMaterialForm; DOCX HTTP extraction, upload authorization and own-folder Storage RLS tested. |
| 8. View uploaded content | Existing library/detail components and persisted API; own-only lists/details tested. |
| 9. Review/edit generated questions | Existing question-set UI, save/approve/regenerate API and atomic RPC; own-only authorization, real SQL create/save/approve, preserved keys and stale-revision refusal tested. |
| 10. Delete uploaded material | Existing deletion service; own unused upload removal and referenced/private upload refusal tested. |

User confirmed **own uploads only** for System Admin standalone materials. Other users' uploads (including Teacher and Independent Learner uploads) are not included in its lists or accessible via its material/question APIs. Source-ID guards in the SQL proposal also reject attaching another person's upload through forged module requests. Module management otherwise has the existing administrator scope.

Existing School Admin/Teacher API branches and policies are not broadened. The repository's shared module-library Admin branch is not school-tenant-filtered; this work does not introduce or redesign that existing scope. The actual installed policies still require read-only preflight review before SQL approval. Independent Learner Trash/practice paths are untouched, as are M2/M5/M6 and Azure Speech.

**Database proposal ? NOT applied to Supabase**

Run/review `supabase/proposed/m3_system_admin_VERIFY_READONLY.sql` before considering the separate `m3_system_admin_PROPOSED.sql`. No live database session was available or used; installed definitions and live policy state have not been certified.

Missing permissions identified in repository SQL:

- Module RPCs recognize School Admin/approved owning Teacher but not System Admin; direct module status updates and learning-path reads also need System Admin access.
- The upload form writes originals directly to Storage; System Admin needs own-folder insert/read and safe unused-object cleanup.
- The service-role-only saved-question RPC excludes System Admin actors even when they own the material.

The proposal substitutes a narrowly scoped role helper only within an enumerated M3 module-function list, retaining each installed function's validation/history/ownership logic. It does not change is_admin() or m3_current_role(), which are used outside M3. It adds only System Admin module-update/learning-path-read and own-folder Storage policies, adds own-source guards, and maps System Admin to the owning-uploader branch inside the service-only question RPC. No other role gets a new policy or grant. The proposal fails closed on missing required baseline functions or unexpected question-RPC definitions. It must be reviewed against preflight output; it is not an automatically applied migration.

**Verification**

- 248/248 frontend tests: all M3 tests plus the relevant five-role route/account regression file.
- 98/98 backend tests across m3SystemAdmin, materialPersistence, materialQuestionSets, adminModulePassages, materialAdminModuleExtraction and materialRoutes.
- 7/7 disposable PGlite checks, including actual repository module permission/create/lock functions, question-write RPC and new Storage policies. No connection to Supabase.
- Both TypeScript checks and production Vite build passed. Existing large-bundle and mixed static/dynamic import warnings remain.
- `git diff --check` passed. Scope and changed-line review found no added secrets or unrelated feature edits.

These are local component/service/database-fixture tests, not a live authenticated browser acceptance run. The SQL fixture verifies permission/status paths, not the entire deployed schema or live Azure/Gemini services. Existing shared publication and deletion regression tests remain the coverage for those unchanged workflows.

**Verdict: SAFE TO COMMIT as a local implementation with an explicitly unapplied SQL proposal.**

Not ready for live use until preflight has been reviewed and the required SQL is separately approved/applied. No commit is authorized or performed in this task.

**Files changed**

- `readflow/src/App.tsx`
- `readflow/src/modules/module3/components/AdminCollectionEditor.tsx`
- `readflow/src/modules/module3/components/M3Layout.tsx`
- `readflow/src/modules/module3/context/M3ContentContext.tsx`
- `readflow/src/modules/module3/pages/MaterialDetailPage.tsx`
- `readflow/src/modules/module3/pages/MaterialLibraryPage.tsx`
- `readflow/src/modules/module3/pages/Module3Page.tsx`
- `readflow/src/modules/module3/pages/QuestionReviewPage.tsx`
- `readflow/src/modules/module3/pages/UploadMaterialPage.tsx`
- `readflow/src/modules/module3/types/content.ts`
- `readflow/src/modules/module3/utils/workspaceRoot.ts`
- `readflow/tests/m1FiveRoles.test.ts`
- `readflow/tests/m3AdminCollectionExtraction.test.ts`
- `readflow/tests/m3AdminModuleExtraction.test.ts`
- `readflow/tests/m3MaterialPersistence.test.ts`
- `readflow/tests/m3TeacherContent.test.ts`
- `server/routes/adminModuleExtraction.js`
- `server/services/materialPersistenceService.js`
- `server/services/materialQuestionSetService.js`
- `server/tests/m3SystemAdmin.test.js`
- `server/tests/materialAdminModuleExtraction.test.js`
- `server/tests/materialRoutes.test.js`
- `supabase/proposed/m3_system_admin_PROPOSED.sql`
- `supabase/proposed/m3_system_admin_VERIFY_READONLY.sql`
- `supabase/tests/m3SystemAdmin.test.cjs` (superseded, see below)
- `docs/M3_SYSTEM_ADMIN_REPORT.md`

**Staging preflight and SQL revision (Claude Code, November 18, 2026)**

A read-only preflight ran against ReadFlow-Staging (`oudfrdeqwotynihkkmze`; session forced read-only, still read-only at the end). It ran `m3_system_admin_VERIFY_READONLY.sql` unchanged, plus two catalog-only queries (function bodies, columns, policies, grants, aggregate counts). No data, policy, grant or schema was changed.

What the installed schema showed:

- The original proposal could not be applied. The question RPC's role lookup on Staging is uppercase and spread over several CRLF lines, so the proposal's single-line anchor matched 0 times; its own check would have aborted the whole migration. Codex's PGlite test passed only because it loaded an older repository version of that function.
- No hidden scope widening. `m3_require_admin` is called only by M3 Trash functions. The rewrite touches exactly nine functions (`m3_can_manage_module`, `m3_can_read_module`, `m3_create_collection_draft`, `m3_delete_module`, `m3_require_admin`, `m3_trash_manager`, `m3_trashed_modules`, `m3_revise_module`, `m3_module_revisions`). Each keeps `search_path = ''` and its grants. `m3_current_role()` and `is_admin()` are unchanged.
- The editor's other RPCs are covered through these helpers (save/bank via `m3_lock_collection` -> `m3_can_manage_module`; Trash via `m3_trash_manager`/`m3_require_admin`). `m3_republish_module` is deliberately Teacher-only, as for School Admin.
- Both tables have `source_material_id`, so the new guard trigger is safe. Currently 0 passages link to an upload. The restrictive "M1 Teacher approval required" policies block only unapproved Teachers.
- `learning_paths` is already readable by every signed-in user, so the separate System Admin policy was redundant.

Revisions to `m3_system_admin_PROPOSED.sql`:

- All ten functions are pinned to their Staging fingerprints; if anything changed, nothing is applied.
- The question-RPC patch uses a whitespace-tolerant pattern that must match exactly once.
- The redundant `learning_paths` policy is removed.
- There is no `authenticated` grant on the new helper, because every caller is SECURITY DEFINER.
- The migration verifies each rewrite and the grants before it commits.

New `m3_system_admin_ROLLBACK_PROPOSED.sql` restores the ten functions byte-for-byte (fingerprint-checked) and removes every System Admin object.

`supabase/tests/m3SystemAdminStaging.test.cjs` (2/2, PGlite) loads the exact Staging definitions (`m3_system_admin_staging_definitions.json`) and proves:

- identical fingerprints;
- only System Admin's permissions change;
- own-material question access only, with Independent Learner and Teacher uploads refused;
- forged source IDs are refused;
- Storage access is limited to the System Admin's own folder;
- Trash rows are not directly editable;
- rollback restores byte-identical originals;
- re-applying works, and a second apply is refused.

The old `m3SystemAdmin.test.cjs` exercised outdated definitions and now correctly stops at the pin check. It was moved out of the repository to `release-review/m3-system-admin-20261118/`. Neither SQL file has been applied.
