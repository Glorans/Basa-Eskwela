# ReadFlow M1–M4 Refactor Audit (read-only)

> **Scope: M1–M4 only.** M5 and M6 are owned by a teammate and are being reworked. Do not modify
> `module5/`, `module6/`, `src/pages/reading-activity/`, or the M2 files they depend on (§0.4). M4
> changes must keep every M4→M5 contract unchanged (see Step 6's out-of-bounds list).

Date: 2026-10-17 · Baseline commit: `c4a5fcc` · Baseline tests: **596 / 596 passing**
(`node --experimental-strip-types --test tests/*.test.ts`, Node 24.15.0)

**Path conventions.** `src/…` and `tests/…` are relative to `readflow/`. There are **two SQL trees**:
`readflow/supabase/` (M4 migration + `m6_*.sql`) and the repo-root `supabase/` (M1, M3, M5, diagnostic SQL
and `supabase/migrations/20261012_*`). Both contain access-control rules that the client code depends on.

**Protected areas (from the brief):** M4 behavior (`classroomService.ts` + pages), the M5→M6 flow
(`module5`, `module6`, `src/pages/reading-activity`, `tests/m5M6*.test.ts`), and all RLS/role checks.

---

## 0. Findings that change how refactoring has to be done

Read these first. They shape every recommendation below.

1. **Most tests check source text, not behavior.** Many tests read `.tsx`/`.ts` files as strings and
   regex-match identifiers, import paths, and file names. Examples: `tests/authServiceBoundary.test.ts`,
   `tests/authProvider.test.ts:56-77`, `tests/m3MaterialPersistence.test.ts:50-51`,
   `tests/m3AdminModuleExtraction.test.ts:10,28`, and `tests/m4Migration.test.ts:189-196`. A pure rename or
   move will fail them, and they will not catch a real behavior regression. Every refactor step must update
   these tests on purpose. Never "fix them until green".
2. **The M4 tests load the code in unusual ways that block splittinPg files.**
   - `tests/m4ActivityFeedback.test.ts:12-18` transpiles `classroomService.ts` and runs it in a `vm` with
     `require: () => ({ supabase })`. *Every* import inside that file resolves to `{ supabase }`. If
     `classroomService.ts` is split into files that import each other, or turned into a re-export facade,
     this test breaks.
   - `tests/m4ActivityFeedback.test.ts:22-40, 63-77` renders `ClassroomDetailsPage` with a hand-written
     hook emulator. It tracks state by slot order, finds handlers by **function name**
     (`handleToggleActivityForm`, `handleAssignActivity`), finds elements by `id` (`readingMaterial`,
     `questionSet`), and mocks modules by substring (`classroomService`, `materialService`, `ReadFlowDialog`,
     `supabaseClient`). Child components are **not rendered** by this harness.
   - `tests/m4Classroom.test.ts:28-35` intercepts `/supabaseClient` only when the importer is exactly
     `classroomService.ts`.
3. **M4 is a dependency of the protected M5→M6 flow.**
   - `src/pages/reading-activity/ReadAloudPage.tsx:3,136,178` calls `updateReadingActivityStatus` from
     `classroomService`.
   - `tests/m5M6Workflow.test.ts:99,152-175` mocks modules by the key `classroomService` and compares the
     JSON render tree of `StudentClassroomPage`.
   - `tests/m5M6Integration.test.ts:45-58` source-asserts `StudentReadingActivityPage.tsx`.
   - `tests/browser/readingActivities/fixture.tsx:33-39` replaces exports by name.
   - So `classroomService.ts`'s **file name, export names, and signatures** are a contract with M5/M6,
     beyond the M4 requirement.
4. **M2 is also a dependency of the protected flow.** `ReadAloudPage.tsx` uses `useAudioRecorder` and
   `uploadDiagnosticAudio`. `ReadingResultPage.tsx` uses `synthesizeDiagnosticSpeech`.
   `useVoiceFollowStoryScroll.ts` uses `useDiagnosticStreamingSpeech`, `diagnosticScoring`, and
   `liveReadingAlignment`. `oralReadingProcessing.ts` uses `diagnosticAudio`, `diagnosticRecording`, and
   `types/diagnostic`. Treat these M2 files as protected.
5. **One query can run under several RLS policies.** For example, `getRoomEnrollments` reads `profiles`
   under the *teacher* policy on `ClassroomDetailsPage` and under the *admin* policy on
   `AdminClassroomDetailsPage`. Any query reshaping (joins, embeds, column changes) must satisfy every
   policy that applies to it. Section 4 lists these.
6. **Uncommitted working-tree edits appeared during this audit.** They were not made by this audit.
   `src/modules/module4/pages/JoinClassroomPage.tsx:323` and `LearningRoomsPage.tsx:326` changed
   `View Classroom →` to `View Classroom`. Commit or discard them before starting M4 work, so the M4
   baseline is clear.

---

## 1. Duplicated code

Verdict key: **SAFE** = safe to merge · **KEEP** = similar but must stay separate · **UNSURE**

### D1. Bearer-token header builders (`supabase.auth.getSession()` → `{ Authorization }`)
| Copy | Lines | Used for (server enforces role) |
|---|---|---|
| `src/modules/module1/services/adminUsers.ts` `getAdminRequestHeaders` | 21-34 | `/api/admin/users` (admin) |
| `src/services/adminDiagnosticResults.ts` `getAdminRequestHeaders` | 26-39 (text identical to the one above) | `/api/admin/diagnostic-results` (admin) |
| `src/modules/module1/services/teacherInvitations.ts` `headers` | 15-19 | `/api/admin/teacher-invitations` (admin) |
| `src/modules/module3/services/materialService.ts` `getMaterialAuthHeaders` | 16-27 | materials API (teacher/general_user/admin). Also reused for admin endpoints: `adminModuleExtraction.ts:59`, `adminCollectionService.ts` `generateBank` |
| `src/modules/module5/services/oralReadingService.ts` `getAuthHeaders` | 44-51 | M5 (protected) |
| `src/modules/module6/services/comprehensionService.ts` `authHeaders` | 107-118 | M6 (protected) |
| `src/modules/module2/hooks/useDiagnosticStreamingSpeech.ts` `getAccessToken` | 33-37 | M2 streaming (used by M5 voice-follow) |

- **Responsibility/permissions:** the same in every copy. Each attaches the *caller's own* JWT. No copy
  makes a client-side role decision; authorization happens server-side per route. Only the error text
  differs, plus the error class (`OralReadingServiceError` in M5).
- **Verdict:**
  - **SAFE** for the M1, shared, and M3 copies. Use one helper with a message parameter, and keep each
    current message. `tests/m3MaterialPersistence.test.ts:50-51` (pins `supabase.auth.getSession()` and the
    template literal inside `materialService.ts`) and `tests/m3AdminModuleExtraction.test.ts:28` (pins the
    name `getMaterialAuthHeaders`) must be updated.
  - **KEEP** for the M5, M6, and M2 copies (protected flow).

### D2. "Current user id" via `supabase.auth.getUser()`
| Copy | Lines | Role / error contract |
|---|---|---|
| `classroomService.ts` (5 inline copies) | 417-426, 507-516, 580-591, 668-679, 705-716 | teacher (L417, L507), student (L580, L668, L705). L507 throws `ReadingActivityValidationError("Your session has expired…")`; the others throw `Error("User not authenticated.")` |
| `LearningRoomsPage.tsx` | 26-37, 66-77 | teacher |
| `JoinClassroomPage.tsx` | 28-39, 86-97 | student |
| `ClassroomDetailsPage.tsx` | 306-317 | teacher (gets `assigned_by` for `room_modules` insert) |
| `moduleService.ts` `getAuthenticatedUserId` | 57-65 | admin; throws `ModuleServiceError` |
| `diagnosticRepository.ts` `getAuthenticatedUserId` | 207-220 | learner; throws `DiagnosticDatabaseError`; uses an injected client |
| `materialUpload.ts` | 121-132 | teacher/general_user (combined with `getSession`) |

- **Verdicts:**
  - **SAFE**, *inside `classroomService.ts` only*: one private helper in the same file, taking the error
    factory as a parameter. The file still imports only `supabase`, so the vm loader in
    `m4ActivityFeedback` keeps working. The `ReadingActivityValidationError` subtype must stay, because
    `getReadingActivityError` (L453-467) uses `instanceof` to surface its message.
  - **KEEP** the M4 *pages*. Swapping `getUser()` for `useAuth().user` looks equivalent but is not.
    `getUser()` revalidates the JWT with Supabase on every call; `useAuth()` returns cached session state.
    On an expired session the user-facing failure changes, which conflicts with "M4 exact functionality".
    Note that the M1 pages were already migrated to `useAuth()` (`tests/authProvider.test.ts:56-77`); M4
    deliberately was not.
  - **KEEP** the cross-module copies (`moduleService`, `diagnosticRepository`, `materialUpload`). They
    differ in error types and messages, and `diagnosticRepository` is built for client injection in tests.

### D3. Sign-out
- `src/modules/module3/components/M3Layout.tsx:92-104` calls `supabase.auth.signOut()` directly.
- `src/services/authService.ts:34-37` `logout()` is used by `BasaSidebar.tsx:27-39`, `ResetPasswordPage`,
  and `TeacherVerificationPage`.
- Same responsibility; no permission aspect. **SAFE**: route M3Layout through `logout()`. This matches the
  "auth mutations centralized" rule in `tests/authServiceBoundary.test.ts:70-97`; M3Layout is the only
  file missing from that rule. The footer button JSX (`M3Layout.tsx:158-168` vs `BasaSidebar.tsx:72-82`)
  differs only in CSS classes. Leave it.

### D4. "Published modules" query (M3 vs M4)
- `src/modules/module4/services/classroomService.ts:269-284` `getPublishedModules`: selects
  `id, title, difficulty, status`, orders by title, does not validate.
- `src/modules/module3/services/moduleService.ts:94-107` `getPublishedModules`: selects `MODULE_SELECT`
  (joined `learning_paths`, question count), orders by `created_at`, and uses the strict `mapModuleRow`,
  which **throws** on any unknown difficulty, status, or path.
- Same table, same filters (`status='published'`, `deleted_at IS NULL`), same teacher RLS context (the M3
  copy is not used by any page).
- **KEEP.** M4's shape is pinned by `tests/m4Classroom.test.ts:78-81` and the assignment UI. Swapping in
  the M3 mapper could break the whole teacher catalog because of one malformed module. The M3 copy is
  **dead in `src`**; it is only called in `tests/m3ModuleActions.test.ts:56`. See section 2.
- Related: a type-name collision. Both `classroomService.ts:254-259` and `module3/types/content.ts` export a
  type called `ReadingModule`, with different shapes. This is harmless but confusing. Do not rename M4's
  type while M4 is frozen.

### D5. In-memory "published" filters (M3)
- `src/modules/module3/services/moduleModel.ts:144-146` `filterPublishedModules` (test-only) and
  `src/modules/module3/state/studentModuleState.ts:20-26` (filter + map).
- **SAFE**, pure functions. Simplest fix: delete `filterPublishedModules` and update
  `tests/m3ModuleModel.test.ts:120`.

### D6. UUID validation
- `moduleModel.ts:190-194` `isUuid` and `modulePassageModel.ts:10` `UUID`: an identical strict v1–v5 regex.
  **SAFE** to merge (both M3, both used for client-side input checks).
- `classroomService.ts:499`: a looser regex (any version nibble). **KEEP.** Changing it changes which
  inputs M4 accepts and which validation message M4 shows (`tests/m4ActivityFeedback.test.ts:283-289`).

### D7. Language alias normalization
- `moduleModel.ts:69-75` `requirePathLanguage` and `adminModuleExtraction.ts:28-34`
  `getExtractionLanguage`: the same alias set (`en/english`, `fil/filipino/tagalog`). The comment at
  `moduleModel.ts:68` says so. They differ only in error class and message. **SAFE** to merge (keep both
  messages); both are admin M3.
- `src/pages/reading-activity/activityLanguage.ts:4-7` `normalizeActivityLanguage`: different semantics.
  It never throws, defaults to `"en"`, accepts `tl`/`fil-ph`, and is marked "presentation only".
  **KEEP** (protected M5→M6 area).

### D8. Role → workspace root path (M3 UI)
- Identical 3-way copies: `MaterialDetailPage.tsx:22` and `ModuleDetailPage.tsx:31`.
- 2-way variants: `QuestionReviewPage.tsx:37` (general_user maps to `/m3/teacher`, but no general_user
  route reaches that page) and `M3Layout.tsx:48`, `MaterialLibraryPage.tsx:23`, `ModuleCatalogPage.tsx:18`,
  `UploadMaterialPage.tsx:14` (admin maps to `/m3/general`, but admin never routes there).
- Related: `module1/utils/authOnboarding.ts:73-84` `getRoleHomePath`.
- These are link targets only; access is enforced by `RequireRole` in `App.tsx`. **SAFE** to merge into an
  M3-local helper. For every role that can reach each page, the result is the same. **Do not** reuse
  `getRoleHomePath`: `RequireAuth.tsx:275-277` uses it as the redirect target for unauthorized access, so
  coupling it to link generation risks changing guard behavior.

### D9. Material-ownership UI gates (M3)
- `MaterialDetailPage.tsx:24-33` (`canGenerate`: teacher **and** owner **and** completed **and** has text;
  `canDeleteSets`: teacher **and** owner) vs `state/questionState.ts:172-182` `canReviewMaterialQuestions`
  (admin **or** owner; never general_user).
- **KEEP.** These encode *different permission rules* (admin can review but cannot generate). They are UI
  gates only; the server and RLS (`M3 admins and owning teachers read saved sets`,
  `m3_write_material_question_set`) are authoritative. Merging them risks quietly widening a UI permission.

### D10. "Pending teacher" predicate (M1 admin)
- `PendingTeacherApprovals.tsx:19`, `userManagementFilters.ts:32`, `UserManagementPage.tsx:203`:
  `user.role === "teacher" && user.teacherStatus === "pending"`.
- Same data (`/api/admin/users`) and same admin context. **SAFE.**
- Not the same thing: `authOnboarding.ts:20-22` `isUnapprovedTeacher` (`teacher_status !== "approved"`,
  so it also covers rejected and null). **KEEP**; it drives `RequireAuth` redirects.

### D11. Role-based name validator selection (M1)
- `ProfileSetupPage.tsx:70-72`, `Settings.tsx:104-106`, and `services/authProfile.ts:54-56` each pick
  `getNicknameValidationError` or `getFullNameValidationError` by role. **SAFE** as a pure helper. The
  service-side recheck in `authProfile.ts` is intentional defense in depth; keep calling it there. The
  `"Passwords do not match."` check (`SignupPage.tsx:38-41`, `ResetPasswordPage.tsx:53`, `Settings.tsx:126`)
  is trivial; merging is optional and low value.

### D12. Error-message extractors (axios `response.data.message` || fallback)
- `adminUsers.ts:58-66`, `adminDiagnosticResults.ts:49+`, `teacherInvitations.ts:32-35`,
  `materialService.ts:51-59`, `adminModuleExtraction.ts:67-76`, `adminCollectionService.ts:207+`,
  `moduleService.ts:261-263`, `materialUpload.ts:192-201`.
- **SAFE** with an explicit option. Most surface a non-axios `Error.message`, but
  `materialUpload.ts:192-201` `getMaterialRequestError` deliberately **does not**: it hides raw errors after
  storage cleanup. That behavior must be preserved.

### D13. M3 module mutation callbacks
- `src/modules/module3/context/M3ContentContext.tsx:215-312`: publish, unpublish, archive, and restore
  share the same shape (find → status guard → call → replace → feedback). `deleteModule` (L295-312)
  differs.
- Same admin RLS context. **SAFE** to factor into one helper. Keep each status guard and message, because
  some of them are shown to users.

### D14. Profile and auth re-reads in M2
- `src/modules/module2/components/InitialDiagnosticGuard.tsx:32-50` calls `getSession()` and
  `getAuthProfile()` again, even though the route is already inside `RequireRole` and `AuthProvider`
  holds the profile. Same table and RLS (own row). **UNSURE.** It is consistent with the M1 convention,
  but the guard currently sees the *freshest* role while `AuthProvider` is cached. Decide whether the
  stale-profile window matters.
- `DiagnosticSessionProvider.tsx:45-50` adds a second `onAuthStateChange` subscription, only to clear
  storage on `SIGNED_OUT`. It could use `useAuth().authEvent`. **UNSURE** (event timing differs).
  `tests/authProvider.test.ts:75-76` counts subscriptions only inside `AuthProvider.tsx`.

### D15. M4 page markup and loaders (teacher / student / admin)
| Clone | Lines |
|---|---|
| Classroom header card | `AdminClassroomDetailsPage.tsx:124-184` ↔ `StudentClassroomPage.tsx:135-180` |
| Assigned-module cards | `AdminClassroomDetailsPage.tsx:305-350` ↔ `StudentClassroomPage.tsx:213-279` |
| Loading / error shells | `AdminClassroomDetailsPage.tsx:65-109` ↔ `StudentClassroomPage.tsx:77-121` |
| Room card grid | `LearningRoomsPage.tsx:276-330` ↔ `JoinClassroomPage.tsx:268-327` ↔ `AdminLearningRoomsPage.tsx:142-221` |
| Load effect | `ClassroomDetailsPage.tsx:137-181` ↔ `AdminClassroomDetailsPage.tsx:28-63` ↔ `StudentClassroomPage.tsx:37-75` |
| Room form fields | `ClassroomDetailsPage.tsx:556-614` ↔ `LearningRoomsPage.tsx:165-220` |
| Long-date formatting | `AdminClassroomDetailsPage.tsx:173-179, 259-265, 338-344`; `AdminLearningRoomsPage.tsx:195-201`; `StudentClassroomPage.tsx:247-253, 352-358, 368-374` |

- **Responsibility:** the markup is the same, but the *actions* and *targets* are role-specific (Remove/Edit
  buttons for teachers; `/m3/teacher/…`, `/dashboard/…`, and `/admin/…` links) and the data is fetched under
  different RLS policies.
- **Verdict:**
  - **KEEP** for `ClassroomDetailsPage` and `StudentClassroomPage`. Their render trees are what
    `m4ActivityFeedback` and `m5M6Workflow` inspect, and `StudentClassroomPage` is the M5→M6 entry point.
  - **UNSURE / low value** for the three list pages' room cards. No tests render them, but they differ in
    icon, link vs. `navigate()`, sizing, and empty-state copy. A shared card would need several props, and
    "M4 exact functionality" means pixel-level differences would count as regressions.

### D16. Small M3 internals (leave as is)
- `moduleModel.ts:153-160` vs `170-177` (create vs update payload) and `moduleService.ts:216-238`
  (unpublish/restore both set `draft` but have distinct messages): intentional. Not worth merging.

---

## 2. Dead code, unused exports, and leftover debug code

### Unused files and components (not imported anywhere in `src`)
| Item | Notes |
|---|---|
| `src/modules/module2/pages/Module2Page.tsx` (9 lines) | "Module 2 is under development" placeholder; not routed; no tests. Safe to delete. |
| `src/modules/module2/components/DiagnosticProgress.tsx` (6 lines) | Component unused, **but its CSS file `DiagnosticProgress.css` is imported** by `DiagnosticQuestionsPage`, `DiagnosticReadingPage`, and `DiagnosticResultPage`. Delete only the `.tsx`. |
| `src/modules/module3/components/LearnerPassageQuestions.tsx` (24 lines) | Not rendered anywhere. It is the only consumer of `getStudentPassageQuestions` (`M3ContentContext.tsx:63,356`). `state/learnerPassageQuestions.ts` survives only through `tests/m3LearnerPassageQuestions.test.ts`. |
| `src/modules/module3/components/ModuleForm.tsx` (318 lines) | `ModuleFormPage.tsx` renders `AdminCollectionEditor` instead. Still source-asserted by `tests/m3AdminModuleExtraction.test.ts:10`, so that test must change too. |
| `src/modules/module3/state/moduleState.ts` (300 lines) | Old in-memory "temporary" module CRUD from before Supabase. Only `tests/m3ModuleState.test.ts` uses it. |
| *(out of scope, M5)* `src/modules/module5/components/AssignedReadingAssessments.tsx` | Not imported in `src`, but `tests/m5M6Integration.test.ts:49-52` reads it. Protected; listed for information only. |

### Unused or test-only exports
| Export | Location | Used by |
|---|---|---|
| `getPublishedModules` (M3) | `moduleService.ts:94-107` | `tests/m3ModuleActions.test.ts:56` only |
| `filterPublishedModules` | `moduleModel.ts:144-146` | `tests/m3ModuleModel.test.ts:120` only |
| `mapModuleRows`, `ModuleRow` | `moduleModel.ts:12, 121-123` | internal only; no need to export |
| `getMaterialById` | `materialService.ts:37-43` | nothing |
| `deleteTemporaryMaterial` | `materialUpload.ts:184-190` | nothing. **Check:** this means the client never cleans up an abandoned temporary upload. Confirm the server expires them. |
| `getPublishedStudentModule` | `studentModuleState.ts:28+` | tests only |
| `setQuestionsForMaterial`, `getQuestionsForMaterial`, `normalizeGeneratedQuestions` | `questionState.ts:150, 165, 33` | tests only (`cloneGeneratedQuestions` L26 is used internally) |
| `getPassageQuestions`, `getPassageSummaries`, `getCollectionQuestionCount`, `getCollectionPublishIssues`, `updatePassage`, `movePassage`, `removeEmptyPassage`, `legacyModulePassage`, `PASSAGE_PUBLICATION_POLICY` | `modulePassageModel.ts` | tests only. **UNSURE:** they may be kept on purpose as a client-side mirror of the SQL publication rules (`tests/m3ModulePassages.test.ts`). Ask before deleting. |
| `MaterialLanguage`, `MaterialProcessingStatus`, `MaterialUploaderRole`, `M3FeedbackKind`, `MaterialGeneratedQuestions` | `module3/types/content.ts` | used only inside the same file |
| `CreateClassroomInput`, `UpdateClassroomInput`, `StudentAssignedReadingMaterial` | `classroomService.ts` | used only inside the file. Harmless; **leave** (M4 frozen). |
| Unused parameter `studentId` | `classroomService.ts:133-139` (`void studentId`) | Kept on purpose: the RPC uses `auth.uid()`. `tests/m4Classroom.test.ts:54-58` passes it. **Leave.** |

### Leftover debug code and defects
- **M2 `console.info` calls are all gated by `import.meta.env.DEV`**, so they are fine:
  `useAudioRecorder.ts:27-33`, `useDiagnosticStreamingSpeech.ts:48`, `DiagnosticReadingPage.tsx:159-161`,
  `diagnosticRecording.ts:136-142, 161-166`, `diagnosticScoreAudit.ts:58-62`, `diagnosticDatabase.ts:11-13`.
- **M4 logs to the console unconditionally, in production, and usually twice.** `classroomService.ts`
  has 20 `console.error` calls (L40 … L727) that log raw Supabase error objects, and each page logs the
  same error again (`ClassroomDetailsPage.tsx:114,173,217,269,327,412`, `LearningRoomsPage.tsx:42,93`,
  `JoinClassroomPage.tsx:44,115`, `StudentClassroomPage.tsx:63`, `AdminClassroomDetailsPage.tsx:51`,
  `AdminLearningRoomsPage.tsx:30`). This is not debug code, but it is noisy. Changing it is an M4 behavior
  change, so it is **an owner decision**.
- **Likely encoding defect visible in the UI:** `ClassroomDetailsPage.tsx:930` renders
  `{name} ? {status}`. The literal `?` is almost certainly a lost separator character (for example `·`).
  No test asserts it. Fixing it changes M4 output, so it is **an owner decision**.
- **Room-code uniqueness pre-check cannot work across teachers:** `classroomService.ts:62-87`. Under RLS
  (`M6 Teachers can view own learning rooms`), a teacher can only see their own rooms, so the check never
  sees another teacher's code. The real guard is the unique index `rooms_room_code_normalized_unique`
  (`readflow/supabase/migrations/20261005_m4_classroom_management.sql:63-64`). On a collision, the insert
  fails with `23505` and the UI shows "Unable to create learning room." without retrying. The chance is
  very small (32⁸ codes). Record it; do not change it under the M4 freeze.
- Duplicated section comment: `classroomService.ts:46-47` (`// CREATE CLASSROOM` twice).
- Misplaced file: `src/pages/admin/UserManagementPage.css` is imported by the M1 page
  `src/modules/module1/pages/admin/UserManagementPage.tsx:22`.
- `src/data/dashboardData.ts` holds only two shared domain types (`Difficulty`, `ReadingLevel`), imported
  by M2, M3, and admin code. The name is misleading. Rename only together with its 8 importers.
- `package.json` has a `lint` script, but `eslint` is not in `devDependencies`.

---

## 3. Oversized files and natural seams

| File | Lines | Seams | Blockers / risk |
|---|---|---|---|
| `src/modules/module4/pages/ClassroomDetailsPage.tsx` | 1175 | (a) room info + edit form L489-645 with handlers L224-275 · (b) overview stats L647-668 · (c) enrolled students L671-739 + `handleRemoveStudent` L183-222 · (d) module assignment L741-882 + `handleAssignModule` L277-333 · (e) activity list L885-950 + `refreshActivities` L109-117 · (f) activity form L952-1171 + question-set loader L66-103 + handlers L335-419. Natural hooks: `useQuestionSets(materialId)`, `useActivityAssignment(roomId)`. | **High.** The `m4ActivityFeedback` harness (§0.2) only drives the default export, by handler names and element ids. Sections (e) and (f) cannot move without rewriting that harness first. (a), (c), and (d) are not asserted by the harness and could become prop-driven child components. Run `npm run test:m4` after each extraction to confirm. |
| `src/modules/module4/services/classroomService.ts` | 734 | By role and responsibility: rooms (teacher) L29-130 + L224-252 · enrollment L131-223 + L363-407 · room modules L253-362 · activity assignment, teacher side, L408-560 · activity, student side, L561-734 (includes `updateReadingActivityStatus`, used by M5). | **High.** The vm loader (§0.2), M5/M6 mocks keyed on `classroomService`, and the browser fixture by export name. **Recommendation: do not split.** Only do in-file cleanup (the D2 helper, the comment fix) until the test harnesses are replaced. |
| `src/modules/module3/components/AdminCollectionEditor.tsx` | 1141 (admin only) | (1) `PassageBank` L938-1141 is already a separate function: move it to its own file first · (2) load/reset lifecycle L44-139 → `useAdminCollection(mode, moduleId)` · (3) mutations `perform/changePassage/addPassageBelow/reload/persist/saveDraft/extract/generateQuestions` L141-357 · (4) header and notices L373-~520 · (5) per-passage editor section L524-~860 → `PassageEditor` · (6) publish panel and issue list ~L860-936. | **Medium.** No render tests. `tests/m3MaterialPersistence.test.ts:20` asserts `<InlineRegeneration` is in this file. Behavior risk: revision/optimistic-concurrency handling, `bankDirty` gating, and the `generation` ref guard against stale loads. Add a render or browser test (`tests/browser/module3/collections.mjs` exists) before step 2. |
| `src/modules/module2/hooks/useAudioRecorder.ts` | 513 | `startRecording` is one ~330-line closure (L167-494): stream acquisition, MediaRecorder segment rotation, timers, teardown. | **High. Leave it.** Used by `ReadAloudPage` (M5→M6). Pinned by `tests/m5ActivityLanguage.test.ts:27` and `tests/diagnosticRecording.test.ts`. |
| `src/modules/module2/pages/DiagnosticResultPage.tsx` | 415 | Formatters L69-80; practice-word TTS L143+; three result sections L322/334/368. | Medium. No unit test (browser tests only). |
| `src/modules/module3/context/M3ContentContext.tsx` | 406 | Module mutations L165-312 → `useModuleMutations` (D13); materials state L100-158 + L326-336 → separate provider. | Medium. Note: the provider wraps **all** role routes, including student `/dashboard` (`App.tsx:158-164`), so every learner page load runs `getModules()` + `getLearningPaths()` (L147-150) under learner RLS. Splitting the provider would change which queries run for which role, so verify this on purpose. |
| `src/modules/module4/pages/StudentClassroomPage.tsx` | 401 | Module cards L197-280; activity cards L297-398. | **High.** Protected (M5→M6 entry; `m5M6Workflow` compares its render tree). Leave. |
| `src/modules/module3/pages/QuestionReviewPage.tsx` | 397 | Editing handlers L70-160 → hook; regenerate panel L369+. | Medium. Source-asserted by `m3MaterialPersistence`. |
| `src/modules/module2/services/diagnosticScoring.ts` | 390 | Alignment/metrics L20-224 vs. placement rules L225-390. | **High.** M5 scoring parity (`tests/m5ScoringParity.test.ts`). Leave. |
| `src/modules/module4/pages/AdminClassroomDetailsPage.tsx` | 354 | Read-only display sections. | Low behavior risk, but M4-frozen and untested. Test it first. |
| `src/modules/module1/pages/Settings.tsx` | 347 | Account load L58-82; save L84-172; form L215+. | Low–Medium. Source-asserted by `authServiceBoundary`/`authProvider`. |
| `src/lib/database.types.ts` | 1051 | Generated file. | Not a refactor target. |

---

## 4. Direct Supabase calls in M1–M4 (and the shared code they use), grouped by table

Role = the role the call assumes. RLS = the policy or function that actually enforces access.

### `profiles`
| Call | Lines | Role | RLS / grant |
|---|---|---|---|
| `getAuthProfile` select own row | `module1/services/authProfile.ts:25-29` | any signed-in user (via `AuthProvider`, `InitialDiagnosticGuard`, login flow) | `M1 users read own profile`; column grants in `supabase/m1_onboarding_security_migration.sql:118-128` + `teacher_status` in `supabase/m1_teacher_verification.sql:14`; restrictive `M1 unapproved Teachers see only own profile` |
| RPC `get_own_profile_age` | `authProfile.ts:36-41` | self | SECURITY DEFINER, `supabase/m1_profile_age.sql` (age is deliberately not column-granted) |
| `completeProfileSetup` update | `authProfile.ts:60-67` | teacher / student / general_user (self) | `M1 users update own display name`; column grant `full_name, nickname` (+ age per `m1_profile_age.sql`) |
| `updateNickname` / `updateFullName` | `authProfile.ts:83-86`, `95-98` | self; the role → field check is in `assertProfileFieldEditable` L71-79 | same as above |
| Roster names (`id, full_name, nickname, role`) | `module4/services/classroomService.ts:182-186` | **teacher** (owning teacher) **or admin**; the same function serves both | `M6 Teachers can view enrolled student profiles` / `M6 Admin can view student profiles` (both limited to `role='student'`, enrolled) |

### Profile and role RPCs (M1)
| RPC | Lines | Role |
|---|---|---|
| `assign_own_role` | `authProfile.ts:119-121` | user with no role yet (`/select-role`) |
| `register_teacher_with_invite` | `authProfile.ts:111-113` | user with no role yet, with an invite code |
| `review_teacher_registration` | `module1/services/adminUsers.ts:50-52` | admin (function checks the caller) |

### `diagnostic_results` (M2)
| Call | Lines | Role | RLS |
|---|---|---|---|
| upsert own result | `module2/services/diagnosticRepository.ts:288-292` | student / general_user | `Users can insert/update their diagnostic results` (`auth.uid() = user_id`), `supabase/diagnostic_results.sql:62-100` |
| select active version | `diagnosticRepository.ts:318-325` | learner | `Users can read their diagnostic results` |
| select completed languages | `diagnosticRepository.ts:339-340` | learner (also called by `authProfile.getPostAuthenticationPath` at login) | same |

### `learning_paths` (M3)
| Call | Lines | Role | RLS |
|---|---|---|---|
| `getLearningPaths` | `module3/services/moduleService.ts:68-71` | **every role**: `M3ContentProvider` runs it on all role routes | **No SELECT policy for `learning_paths` is defined in either SQL tree.** Only the M1 restrictive teacher-approval policy covers it. Confirm the live policy before changing anything here. |
| `getSelectedLearningPath` | `moduleService.ts:169-173` | admin (create/update) | same |

### `modules` (M3, M4)
| Call | Lines | Role | RLS |
|---|---|---|---|
| `getModules` | `moduleService.ts:81-85` | every role via context; learners only get published rows | `M3 role-aware module reads` → `m3_can_read_module`; restrictive `M5 learners read available modules` |
| `getPublishedModules` (M3, dead) | `moduleService.ts:95-100` | — | same |
| `getModuleById` | `moduleService.ts:114-119` | learner (student module view) / admin | same |
| insert / update / status update | `moduleService.ts:132-136`, `151-156`, `188-193` | admin | `M3 admins create draft modules`, `M3 admins update modules`; publish trigger `m3_validate_collection_publish` |
| `getPublishedModules` (M4) | `classroomService.ts:271-276` | teacher | `M3 role-aware module reads` |
| assigned module details | `classroomService.ts:334-339` | teacher / admin / student | same + learner restrictive policy; the client filter repeats it |

### M3 RPCs and passages
| Call | Lines | Role |
|---|---|---|
| `m3_collection_publish_issues` | `moduleService.ts:203-204`, `modulePassageService.ts:55` | admin |
| `m3_delete_module` | `moduleService.ts:252-253` | admin |
| `m3_create_collection_draft` | `modulePassageService.ts:13-18` | admin |
| `m3_admin_collection` / `m3_save_collection` / `m3_save_passage_bank` | `adminCollectionService.ts:51, 70, 161` | admin (SECURITY DEFINER in `readflow/supabase/m6_comprehension_functions.sql`) |
| `module_passages` select | `modulePassageService.ts:23-25` | learner (`getStudentModule`) / admin | `M3 authorized passage reads` + restrictive `M5 learners read available passages` |
| `comprehension_questions` select (reviewed only) | `modulePassageService.ts:34-38` | learner, via the dead `LearnerPassageQuestions` | `M3 role-aware safe question reads` |

### `uploaded_materials` and storage `reading-materials`
| Call | Lines | Role | RLS |
|---|---|---|---|
| storage upload / cleanup | `module3/services/materialUpload.ts:137-142`, `165-167` | teacher / general_user (own folder `user.id/…`) | `M3 uploaders create own reading material objects`, `M3 owners and admins delete reading material objects`, restrictive `M1 Teacher approval required` on `storage.objects` |
| own completed materials | `classroomService.ts:428-433` | teacher | `M3 material owners and admins read materials` |
| assignment preflight | `classroomService.ts:522` | teacher | same |
| assigned material titles | `classroomService.ts:624-627` | student | `M5 students read assigned materials` |
| assigned material text | `classroomService.ts:681-685` | student | same |

### `material_question_sets`
| Call | Lines | Role | RLS |
|---|---|---|---|
| set names for the activity list | `classroomService.ts:481` | teacher; failure is tolerated (display only) | `M3 admins and owning teachers read saved sets` |

### `rooms` (M4)
| Call | Lines | Role | RLS (`readflow/supabase/migrations/20261005_m4_classroom_management.sql`) |
|---|---|---|---|
| own rooms | `classroomService.ts:33-37` | teacher | `M6 Teachers can view own learning rooms` |
| room-code pre-check | `classroomService.ts:68-72` | teacher (sees own rooms only; see §2) | same |
| create | `classroomService.ts:94-104` | teacher (approved) | `M6 Teachers can create learning rooms` (`m4_current_role()='teacher'`, `auth.uid()=teacher_id`) + unique index |
| by id | `classroomService.ts:118-122` | teacher / admin / student (all three detail pages) | own / `M6 Admin can view learning rooms` / `M6 Students can view enrolled rooms` |
| update | `classroomService.ts:235-244` | teacher (owner) | `M6 Teachers can update own learning rooms` |
| student's rooms | `classroomService.ts:392-396` | student | `M6 Students can view enrolled rooms` |
| assignment preflight | `classroomService.ts:521` | teacher | own |
| **all rooms** | `module4/pages/AdminLearningRoomsPage.tsx:19-22` | admin. **The only M4 query outside the service; scoping relies entirely on RLS.** | `M6 Admin can view learning rooms` |

### `enrollments` (M4)
| Call | Lines | Role | RLS |
|---|---|---|---|
| roster | `classroomService.ts:160-164` | teacher / admin | `M6 Students and teachers can view enrollments` / `M6 Admin can view classroom enrollments` |
| remove student | `classroomService.ts:214-217` | teacher. Filters by enrollment id only; **RLS is the only ownership check.** | `M6 Teachers can remove enrolled students` |
| student's enrollments | `classroomService.ts:371-374` | student | same SELECT policy (`auth.uid() = student_id`) |
| assignment preflight | `classroomService.ts:523` | teacher | same |
| RPC `join_room_by_code` | `classroomService.ts:141-146` | student; SECURITY DEFINER, uses `auth.uid()`; the direct INSERT policy was retired | function in the M4 migration |

### `room_modules` (M4)
| Call | Lines | Role | RLS |
|---|---|---|---|
| assign | `classroomService.ts:292-298` | teacher (owner); `assigned_by` must equal `auth.uid()` | `M6 Teachers can assign classroom modules` |
| list | `classroomService.ts:311-315` | teacher / admin / student | `M6 Teachers / Admin / Students can view assigned classroom modules` |

### `reading_activity_assignments` (M4 writes; M5 owns the policies)
| Call | Lines | Role | RLS (`supabase/m5_reading_activity_assignments.sql`, `supabase/migrations/20261012_m6_activity_question_sets.sql`) |
|---|---|---|---|
| teacher list | `classroomService.ts:472-474` | teacher | `M5 read activities` + restrictive boundary → `m5_can_read_activity` |
| duplicate preflight | `classroomService.ts:524` | teacher | same |
| insert | `classroomService.ts:555-557` | teacher (approved; owns room and material; student enrolled; material has text) | `M5 assign activities` + restrictive `status='assigned'` (`m5_can_assign_activity`); triggers `m6_check_activity_question_set`, `m6_protect_activity_assignment_mode` |
| student list | `classroomService.ts:596-603` | student | `m5_can_read_activity` |
| status update | `classroomService.ts:718-724` | student (self). **Also called from `ReadAloudPage.tsx:136,178` (protected flow).** | `M5 student activity progress` + boundary; column grant `update(status)` only; identity trigger `m5_protect_activity_identity` |

### Supabase Auth API (no table)
- **Centralized:** `src/services/authService.ts:18,28,35,40,49,54`.
- **Session owner:** `src/auth/AuthProvider.tsx:118` (`onAuthStateChange`) and `:158` (`getUser`).
- **Direct reads elsewhere:**
  - M1 header helpers (D1).
  - M2: `InitialDiagnosticGuard.tsx:35`, `DiagnosticSessionProvider.tsx:46`,
    `useDiagnosticStreamingSpeech.ts:34`, `diagnosticRepository.ts:211`.
  - M3: `M3Layout.tsx:95` (`signOut`, see D3), `materialService.ts:20`, `materialUpload.ts:124,128`,
    `moduleService.ts:58`.
  - M4: the `getUser()` copies listed in D2.
  - Shared: `adminDiagnosticResults.ts:32`.
- Separate observation: `module2/services/diagnosticAudio.ts:47-50` and `diagnosticTts.ts:7-17` call the
  backend **without** an `Authorization` header (`/api/diagnostic/audio`, `/api/tts`), while other API
  calls send one. M5 also uses these endpoints. Confirm on the server that this is intentional.

---

## 5. Test coverage

### Tests per module
| Module | Unit tests (`tests/`) | Browser / manual |
|---|---|---|
| M1 | `authOnboarding`, `roleSelectionPage`, `m1OnboardingFlows`, `loginFlow`, `authServiceBoundary`, `authProvider`, `authLoadingUi`, `authenticatedLayouts`, `profileSettings`, `profileAge`, `m1UiComponents`, `m1CssOrganization`, `realUserProfiles`, `teacherInvitations`, `teacherVerification`, `userManagementFilters` | `tests/browser/profileSetup.mjs`, `roleSelection.mjs`, `teacherInvitations.mjs`; `supabase/tests/profileAge.test.cjs`, `teacherVerification.test.cjs` |
| M2 | `diagnosticAccess`, `diagnosticFilipino`, `diagnosticLanguage`, `diagnosticPassage`, `diagnosticRecording`, `diagnosticRepository`, `diagnosticScoreAudit`, `diagnosticScoring`, `diagnosticSession`, `diagnosticStreaming`, `liveReadingAlignment`. M2 code is also exercised by `m5ScoringParity`, `m5OralReading`, `m5ActivityLanguage`. | `tests/browser/module2/*` |
| M3 | 16 `m3*.test.ts` files + `learnerEmptyStates` | `tests/browser/module3/*`; `supabase/tests/*.py`, `m3_*.sql` |
| M4 | `m4Classroom` (service contract + route guards), `m4ActivityFeedback` (assignment flow + `ClassroomDetailsPage` activity UI), `m4Migration` (static SQL parse). M4 code is also covered by `m5M6Workflow` and `m5M6Integration`. | `tests/browser/readingActivities/*` |
| Shared | `apiUrl` (lib), `authProvider` / `authLoadingUi` (auth, RequireAuth), `authServiceBoundary` (services/authService), `diagnosticAccess` (services/adminDiagnosticResults) | — |

### How tests are run (gaps)
- There is **no `npm test`** that runs everything. The full run is
  `node --experimental-strip-types --test tests/*.test.ts`.
- **14 test files are in no npm script:** `apiUrl`, `authenticatedLayouts`, `diagnosticAccess`,
  `diagnosticFilipino`, `diagnosticPassage`, `diagnosticRepository`, `diagnosticScoreAudit`,
  `diagnosticSession`, `liveReadingAlignment`, `profileAge`, `realUserProfiles`, `teacherInvitations`,
  `teacherVerification`, `userManagementFilters`. Someone running only `npm run test:auth` misses half of
  the M1 tests.
- Browser tests (`tests/browser/**`) and SQL checks (`supabase/tests/**`) are manual. They need a running
  server or database.

### Risky areas with no tests
1. **M4 service functions never called by any test** (they are only mocked):
   - `getTeacherClassrooms` (L30-45)
   - `createClassroom` + `generateUniqueRoomCode` (L49-112)
   - `getClassroomById` (L115-130)
   - `removeEnrolledStudent` (L211-223)
   - `updateClassroom` (L231-252)
   - `getUploadedReadingMaterials` (L414-438)
   - `getStudentAssignedReadingMaterial` (L665-696)
2. **M4 pages with no behavior test:**
   - `LearningRoomsPage`, `JoinClassroomPage`, `AdminLearningRoomsPage`, `AdminClassroomDetailsPage`.
     Only route existence is checked (`tests/m4Classroom.test.ts:100-110`).
   - In `ClassroomDetailsPage`, only the activity-assignment path is tested. Edit room, remove student, and
     assign module (L183-333) are not.
3. **RLS is never tested against a database in CI.** `m4Migration` statically parses only the M4 SQL file.
   The `reading_activity_assignments` and `uploaded_materials` policies used by M4 (in the root `supabase/`
   tree) have no unit test. `supabase/tests/m5_assignment_preflight.sql` and `m5_m6_answer_key_rls.sql`
   are manual. The `learning_paths` SELECT policy is not in the repo at all.
4. **`AuthProvider` race handling** (the `requestIdRef` / `authChangeHandled` logic, L46-180) and the
   **`RequireAuth` redirect matrix** (L222-280) are only source-regex tested. No test renders them across
   loading, no-user, profile-error, unassigned-role, setup, and unapproved-teacher states.
5. **`AdminCollectionEditor`** has no render or unit test of the editor itself. There are service tests,
   source asserts, and manual browser scripts.
6. **`M3ContentContext`**: no behavior test of the mutation callbacks (D13) or of the material-workspace
   loading condition (L93, L152-158).
7. **M2 UI and guards:** `DiagnosticResultPage` (415 lines), `DiagnosticQuestionsPage`,
   `InitialDiagnosticGuard`, and `DiagnosticSessionProvider` have no unit tests.

---

## 6. Proposed refactor order (one module at a time)

General rules for every step:
- Run the full suite before and after the step.
- When a source-assertion test breaks, update that test in the **same** change and explain why in the
  commit message.
- Never edit SQL in either `supabase/` tree as part of a refactor.
- Never touch `module5/`, `module6/`, `src/pages/reading-activity/`, or the M2 files listed in §0.4.

### Step 0 — Safety net (no production code). Risk: **None**
- Add an aggregate `test` script that runs every unit test file.
- Add characterization tests for the untested M4 service functions (§5, item 1). Use the existing
  `m4Classroom` fake client.
- Add a render test for `RequireAuth`'s redirect matrix.
- Decide owner questions first: `ClassroomDetailsPage.tsx:930` separator, unconditional M4 console
  logging, room-code collision retry, the purpose of the `modulePassageModel` mirror exports, and the
  intent behind the unauthenticated `/api/tts` and `/api/diagnostic/audio` calls.

### Step 1 — M1. Risk: **Low**
1. Shared header helper for the admin services (D1: `adminUsers`, `adminDiagnosticResults`,
   `teacherInvitations`). Keep the messages.
2. Pending-teacher predicate helper (D10).
3. Role-based name-validator helper (D11).
4. Move `UserManagementPage.css` into `module1`.
- Do **not** change `getRoleHomePath`, `isUnapprovedTeacher`, `RequireAuth`, `AuthProvider`, or the
  `authProfile` RPC calls.
- Tests to watch: `authProvider`, `authServiceBoundary`, `teacherInvitations`, `userManagementFilters`,
  `realUserProfiles`, `teacherVerification`.

### Step 2 — M3 dead code. Risk: **Low–Medium** (mostly test edits)
Remove the following, updating `m3AdminModuleExtraction` (L10), `m3ModuleState`, `m3ModuleActions` (L56),
and `m3ModuleModel` (L120) as needed:
- `Module`-side dead files: `ModuleForm.tsx`, `moduleState.ts`, `LearnerPassageQuestions.tsx` +
  `getStudentPassageQuestions`.
- Dead exports: `moduleService.getPublishedModules`, `filterPublishedModules`, `getMaterialById`.

Defer `modulePassageModel` and `learnerPassageQuestions` until the owner answers the question in Step 0.

### Step 3 — M3 small merges. Risk: **Low**
1. `isUuid` + `UUID` (D6, M3 copies only).
2. Language aliases (D7, M3 pair only).
3. Role → root path helper (D8).
4. `M3Layout` logout → `authService.logout` (D3).
5. `getMaterialAuthHeaders` onto the shared helper from Step 1 (D1). Update `m3MaterialPersistence` L50-51
   and `m3AdminModuleExtraction` L28.
6. Error extractors with explicit options (D12). Keep `getMaterialRequestError`'s hiding behavior.

### Step 4 — M3 structure. Risk: **Medium**
1. `M3ContentContext` mutation helper (D13). Add context behavior tests first.
2. `AdminCollectionEditor`: first move `PassageBank` to its own file (mechanical), then extract the
   `useAdminCollection` lifecycle hook. Do the rest only after adding a render test. Keep the
   `<InlineRegeneration` usage in the editor file, or update `m3MaterialPersistence` L20.
- Leave the D9 permission gates separate.

### Step 5 — M2 (non-protected parts only). Risk: **Low** (deletions) / **Medium** (guard)
1. Delete `Module2Page.tsx` and `DiagnosticProgress.tsx`. **Keep `DiagnosticProgress.css`.**
2. Optional, after the owner decides (D14): have `InitialDiagnosticGuard` read the profile from
   `useAuth()`, and replace `DiagnosticSessionProvider`'s extra subscription.
- **Do not touch:** `useAudioRecorder`, `diagnosticAudio`, `diagnosticTts`, `diagnosticRecording`,
  `diagnosticScoring`, `liveReadingAlignment`, `useDiagnosticStreamingSpeech`, `types/diagnostic`
  (M5→M6 dependencies). Risk if touched: **High**.

### Step 6 — M4 (last). Risk: **High**
Only these changes, each in its own commit, with Step 0's characterization tests passing before and
after:
1. In-file private `getUser` helper inside `classroomService.ts` (D2). Keep the file name, all export
   names and signatures, the single `supabase` import, the `ReadingActivityValidationError` subtype, and
   every message.
2. Fix the duplicated comment at L46-47.
3. Optionally move `AdminLearningRoomsPage`'s direct `rooms` query into `classroomService` as an
   admin-only export. The query and the RLS context stay identical.
4. `ClassroomDetailsPage`: extract only the display-only sections (a), (c), and (d) from §3 as
   prop-driven child components. Keep `handleToggleActivityForm` and `handleAssignActivity`, the
   `readingMaterial` and `questionSet` ids, and the activity form and list **in the page file**.
   Splitting (e) and (f) needs a replacement for the `m4ActivityFeedback` harness first. That is a separate,
   reviewed piece of work.

**Explicitly out of bounds for M4:**
- splitting `classroomService.ts`
- swapping `getPublishedModules` for the M3 version (D4)
- changing the UUID regex (D6)
- replacing `getUser()` with `useAuth()` in pages (D2)
- reshaping any query listed in §4
- touching `StudentClassroomPage`, `StudentReadingActivityPage`, or `updateReadingActivityStatus`

### Risk summary
| Step | Scope | Risk |
|---|---|---|
| 0 | Tests and decisions only | None |
| 1 | M1 helpers, CSS move | Low |
| 2 | M3 dead code | Low–Medium |
| 3 | M3 small merges | Low |
| 4 | M3 context + AdminCollectionEditor | Medium |
| 5 | M2 deletions / guard | Low / Medium |
| 6 | M4 in-file cleanup + display-only extraction | High |

---

## Found during Step 1

Step 1 was done as commits `bdc70aa` (item 1), `486d14b` (item 2) and `515d32a` (item 3).
Item 4 was skipped by owner decision (see the first entry). Nothing below was fixed in Step 1.

1. **Correction: the user-management stylesheet is shared, not misplaced.** §2 and §6 Step 1 item 4
   said `src/pages/admin/UserManagementPage.css` was misplaced. It is also imported by
   `src/pages/admin/AdminDiagnosticResultsPage.tsx:13`, which uses 14 of its 18 `admin-users-*`
   classes. It is a shared stylesheet for the admin table pages. Moving it into `module1/` would make a
   non-M1 page depend on M1's folder. Owner decision: leave it where it is. If it ever moves, it
   belongs in a shared location, with a neutral name.
2. **The three name-validation call sites read the role differently.** `ProfileSetupPage` and
   `authProfile.completeProfileSetup` use `isDiagnosticLearnerRole`, which trims and lowercases the
   role. `Settings` uses `getEditableProfileField`, which matches exactly. Item 3 kept both on purpose.
   Database role values are fixed, so this has no effect today, but the two rules could disagree for a
   role value with stray spaces or capitals.
3. **Line endings are mixed, and nothing enforces them.** 113 of 196 tracked `src` files are CRLF on
   disk and the rest are LF. `core.autocrlf` is `true`, and there is no `.gitattributes`. Lesson from
   Step 0: `sed -i` in Git Bash rewrote CRLF files as LF, which git then hid as "no diff". Use the
   editor tool for source edits, and compare CR counts before committing. A `.gitattributes` would
   remove this risk, but it is a repo-wide change and needs an owner decision.
4. **Line numbers in this document refer to commit `cd8c1f4`.** Step 1 shifted lines in
   `adminUsers.ts`, `adminDiagnosticResults.ts`, `teacherInvitations.ts`, `userManagementFilters.ts`,
   `UserManagementPage.tsx`, `ProfileSetupPage.tsx`, `Settings.tsx`, `authProfile.ts` and
   `authOnboarding.ts`. Re-locate code by name, not by line number, in those files.
5. **D1 status for Step 3.** `src/services/authHeaders.ts` `getSessionAuthHeaders(failureMessage)` now
   exists and has its own tests (`tests/authHeaders.test.ts`). `materialService.getMaterialAuthHeaders`
   still has its own copy. When Step 3 moves it onto the helper, update
   `tests/m3MaterialPersistence.test.ts:50-51` and `tests/m3AdminModuleExtraction.test.ts:28`.

---

## Found during Step 2

Step 2 was done as commits `d6de20b` (ModuleForm), `a25b0ad` (moduleState), `82eff15`
(LearnerPassageQuestions + `getStudentPassageQuestions`), `3e8234e` (M3 `getPublishedModules`),
`edc1ebd` (`filterPublishedModules`) and `158d0bc` (`getMaterialById`). Unit tests went from 640 to
634. Nothing below was fixed in Step 2.

1. **Missing test for the live admin editor.** The deleted ModuleForm test was the only check that
   admin extraction is optional and the passage stays editable. AdminCollectionEditor has no
   equivalent test. Add one in Step 4 before restructuring the editor.
2. **Correction: the audit missed a browser test.** §2 listed only the unit-test reference to
   `ModuleForm.tsx`. `tests/browser/module3/admin.mjs` also rendered it. That script covered only
   `ModuleForm`, nothing in the repo referenced it, and it was deleted in `d6de20b`.
3. **The repository's question reader is now unused in `src`.** `createModulePassageRepository(...)`
   `.getQuestions` (`modulePassageService.ts`) had one consumer, the context's
   `getStudentPassageQuestions`. It is still tested in `tests/m3ModulePassages.test.ts:105`.
4. **`state/learnerPassageQuestions.ts` is now entirely unused in `src`.** Its only importers were
   `LearnerPassageQuestions.tsx` and the context's `QuestionReader` type import. It was already deferred
   (see the Step 2 brief) and is still tested by `tests/m3LearnerPassageQuestions.test.ts`.
5. **Orphaned CSS from LearnerPassageQuestions:** `.basa-passage-questions` and
   `.basa-question-category` in `src/pages/StudentModuleViewPage.css` no longer match any markup.
6. **`adminModuleExtraction.getAdminModuleExtractionError` has no caller left.** `ModuleForm` was its
   only user. `ADMIN_MODULE_FILE_ACCEPT` and `extractAdminModulePassage` are still used by
   `AdminCollectionEditor`.
7. **Orphaned CSS from ModuleForm:** `.m3-form-note`, `.m3-module-file-controls`,
   `.m3-module-file-help`, `.m3-module-file-upload` and `.m3-module-selected-file` in
   `src/modules/module3/styles/module3.css` no longer match any markup.
8. **A browser-test stub now guards nothing.** `tests/browser/module3/learner-delivery.mjs:51` stubs
   `getStudentPassageQuestions` in its fake context to throw if a learner page asks for questions. The
   real context no longer has that function, so the guard can never fire. It is harmless; the owner
   chose to leave it as is.
9. **The server route `GET /api/materials/:id` has no client caller.** `getMaterialById` was the only
   one. The server is outside this audit; check there whether the route is still needed.

---

## Found during Step 3

Step 3 was done as commits `9d43b9f` (item 1, `isUuid`), `190dd2b` (item 2, language aliases), `dbe5784`
(item 3, `getM3WorkspaceRoot`), `b909d13` (item 4, M3Layout sign-out) and `b7d5f4e` (item 5, material
auth headers). Item 6 was skipped (entry 1). Commit `38f450e` holds separate work from another session,
committed on its own (entry 2). Unit tests stayed at 634. Nothing below was fixed in Step 3.

1. **Item 6 skipped: the M3 error extractors are too different for one helper.** The six copies
   (`getMaterialServiceError`, `getMaterialRequestError`, `getMaterialPersistenceError`,
   `getAdminModuleExtractionError`, `collectionError`, `getModuleErrorMessage`) differ in four
   independent ways:
   - whether they read the server's `response.data.message`;
   - what they return for an Axios error with no server message (the fallback, or Axios's own text);
   - whether they show a plain `Error`'s message (`getMaterialRequestError` deliberately hides it);
   - how they treat an empty message. `collectionError` also accepts any object with a `message`.

   One helper would need at least four option flags, against the one-flag limit, so they stay as they
   are.
2. **Possible regression: no way to mark a question set as reviewed.** Commit `38f450e` (another
   session) removed the "Mark as Reviewed" action from `QuestionReviewPage`, so
   `materialService.reviewMaterialQuestionSet` now has no caller in `src`. The server still has
   `POST /:materialId/question-sets/:setId/review`.
   - **Why it matters:** M4's activity form (`ClassroomDetailsPage`) only offers sets with
     `reviewStatus === "reviewed"`. If nothing can mark a set as reviewed, teachers can only assign
     read-aloud-only activities.
   - **What decides it:** whether saving ("Save Reviewed Questions") marks a set as reviewed depends on
     which `m3_write_material_question_set` is live. `supabase/migrations/20261012_separate_question_review.sql`
     is marked "Prepared only; NOT applied" and says to deploy it "with the separate save/approve API".
     Confirm against the live database and the server before release.
   - **No test caught it:** all 634 tests passed after the removal. Add a test for the review path.
   - **Update:** confirmed broken in both database states, and resolved. See entry 7.
3. **The audit missed one role → path copy.** `M3Layout` `getProfileRoute` (`/m3/{admin,teacher,general}/settings`)
   repeats the mapping now in `getM3WorkspaceRoot`. It was left as is because
   `tests/authenticatedLayouts.test.ts:41` pins it by name.
4. **The audit missed one error extractor.** `materialUpload.getMaterialPersistenceError` was not in
   D12's list. It is the sixth copy in entry 1.
5. **The audit missed one login-token copy.** `materialUpload.persistUploadedMaterial` calls
   `getSession()` and `getUser()` itself and builds its own `Authorization: Bearer` header for
   `/api/materials/finalize`. It also needs the user id for the storage path, so it was not part of
   item 5.
6. **`getMaterialServiceError` crosses into M4.** M4's `ClassroomDetailsPage` imports it, and
   `tests/m4ActivityFeedback.test.ts` stubs it by name. Renaming or moving it is an M4 change.
7. **Confirmed: after `38f450e` no set could be marked as reviewed, whichever database version is live.**
   The review page's only remaining action, "Save Reviewed Questions", sends the `save` operation
   (`server/services/materialQuestionSetService.js`). What happens next depends on whether
   `supabase/migrations/20261012_separate_question_review.sql` is applied:
   - **Migration applied:** `m3_write_material_question_set` accepts `save`, but `save` never marks a set
     as reviewed. It resets every edited question to `review_status = 'generated'` (migration lines
     115-118). Only the `approve` operation sets `reviewed`, and after `38f450e` the UI no longer called
     approve.
   - **Migration not applied:** the older function allows only `create`, `regenerate`, `review` and
     `delete`, so `save` fails with "Invalid question set operation". The server turns that into a 409:
     "Saving edits separately from approval is not supported by this database version…". No edits are
     saved.
   - **The server's fallback covers approve only.** On an older database, the server retries `approve` as
     the legacy `review` operation (`materialQuestionSetService.js:338-359`). It never retries `save`
     (`:360-362`), because the legacy `review` would also approve the edits.

   In both cases teachers had no way to reach `reviewed`, and M4's activity form offers only reviewed
   sets, so activities could only be read-aloud only. A read-only SQL check for which function version
   is live was provided separately; it inspects `pg_proc` for the `save`/`approve` operations.

   **Live check (2026-10-18):** the owner ran that check on the live Supabase database. Result:
   `m3_write_material_question_set(uuid,uuid,uuid,text,integer,jsonb)`, `is_security_definer = false`,
   verdict "NOT APPLIED: M3 legacy review version". The separate-review migration is **not** applied
   live. Redoing 38f450e requires applying 20261012_separate_question_review.sql AND making the UI
   call approve, together.

   **Applied (2026-10-18):** the owner applied `20261012_separate_question_review.sql` to the live
   database. The pre-flight prerequisite check was all true, and the live function definition was saved
   first as the rollback. The verdict query now reports "APPLIED: separate save/approve version". Save
   Changes and Mark as Reviewed both work. Do not re-run readflow/supabase/m6_comprehension_functions.sql;
   it would revert this function.

   **Resolution:** `38f450e` was reverted in `65d24f3`, keeping only the `getM3WorkspaceRoot` line from
   `dbe5784`. `tests/m3QuestionSetApproval.test.ts` (`22f061e`) now fails if `QuestionReviewPage` loses
   the approve call or the "Mark as Reviewed" control. **38f450e reverted; redo it only once the UI calls
   approve.**

---

## Found during Step 4

Step 4 was done as commits `b65f9d5` (context callback tests), `59895cd` (shared `changeModuleStatus`
helper), `983ce37` (editor extraction tests) and `6d1c113` (`PassageBank` moved to its own file). Unit
tests went from 637 to 658. As instructed, `useAdminCollection` was **not** extracted. Entry 1 describes
what that would take. Nothing below was fixed in Step 4.

1. **What extracting `useAdminCollection` from `AdminCollectionEditor` would take.** Risk:
   Medium-High.
   - **Inputs it needs:** `mode`, `moduleId` (`useParams`), `location.state.draftSaved` plus `navigate`
     (read by the load effect and by `persist`), and `learningPaths`, `refreshModules` and
     `publishModule` from `useM3Content`.
   - **State that moves:** 12 values (`collection`, `removed`, `dirty`, `bankDirty`, `busy`, `saving`,
     `generating`, `generationFeedback`, `message`, `draftMessage`, `issues`, `extracting`) and 3 refs
     (`generation`, `savedIds`, `extractionController`).
   - **Effects that move:** the "clear the draft message when dirty" effect, and the load/reset effect on
     `[mode, moduleId]`. The load/reset effect bumps `generation`, resets all state, loads or creates the
     collection, and aborts any running extraction on cleanup.
   - **Handlers that move:** `perform`, `changePassage`, `addPassageBelow`, `reload`, `persist`,
     `saveDraft`, `extract` and `generateQuestions`. Logic that is still inline in the JSX would need named
     handlers first: moving passages, removing a passage (`confirmReadFlow` plus `savedIds`/`removed`),
     saving or deleting a question bank (`saveBank` with a confirmation), publishing (`getPublishIssues`
     then `publishModule`), and cancelling an extraction.
   - **What must not break:**
     - the `generation` guard: 8 reads, shared by the effect, `reload` and `extract`, so it must stay one
       ref;
     - `bankDirty` gating: 15 references in UI conditions and in `PassageBank`'s `onDirty`;
     - `busy`: 16 references;
     - `readOnly`, which is derived from `mode` and the collection.
   - **Tests to add first** (the harness in `tests/m3AdminCollectionExtraction.test.ts` can drive edit mode
     with a fake `loadCollection`):
     - a stale load, where `moduleId` changes while a load is pending and the old result must be ignored;
     - an edit-mode save that reloads the collection;
     - a revision conflict surfaced through `collectionError`;
     - cancelling an extraction, which keeps the text and shows "Extraction cancelled. Passage text was
       preserved.";
     - `bankDirty` blocking draft saves, question generation and passage edits;
     - a create-mode save that navigates with `draftSaved` and then shows "Draft saved successfully.".
2. **The editor test calls event handlers directly.** It does not simulate the browser, so DOM attributes
   do not block anything. With the textarea set to `readOnly`, the "draft saves typed text" test still
   passed. Editability is therefore checked through the element's props (`readOnly`, `disabled`,
   `onChange`, the fieldset's `disabled`), which four of the five tests do.
3. **The context tests stub `getModuleErrorMessage` with a copy of `moduleService`'s version.** If the
   real function changes, `tests/m3ContentContextMutations.test.ts` will not notice.
4. **There are now two hook emulators.** `tests/helpers/hookRuntime.ts` memoizes `useCallback`/`useMemo`
   by their dependencies, like React. The one inside `tests/m4ActivityFeedback.test.ts` does not. Moving
   the M4 test onto the shared helper would be an M4 test change, under the Step 6 constraints.
5. **`AdminCollectionEditor`'s edit and detail modes still have no render tests**; only create mode is
   covered.

---

## Found during Step 5

Step 5 was done in two parts. Part A removed code left unused by Step 2: commits `c1c4fe0` (orphaned
CSS), `80bf7e4` (`getAdminModuleExtractionError`), `c59cc1a` (`state/learnerPassageQuestions.ts` and the
repository's `getQuestions`) and `c7b7f41` (the browser-test stub). Part B was Step 5's deletions:
`dca0a9f` (`Module2Page.tsx`) and `c7322a8` (`DiagnosticProgress.tsx`; `DiagnosticProgress.css` kept).
D14 stays **KEEP** by owner decision: `InitialDiagnosticGuard` and the extra auth subscription were not
changed. Unit tests went from 658 to 653 (−5, all in `c59cc1a`). Nothing below was fixed in Step 5.

1. **The answer-key check for learner question reads is gone with its code.** The deleted
   `m3ModulePassages` test (L96-111) was the only check in M3 that learner question reads never select
   answer keys. That code path is gone, but learners still receive questions through M6/server
   (`comprehensionAttemptService` and related routes). Confirm an equivalent "no answer keys to
   learners" test exists there; if not, the M5/M6 owner should add one.
   - A read-only search found M6 server tests (`server/tests/comprehension.test.js`,
     `assignedReadingIntegration.test.js`), but none was confirmed to assert that delivered questions
     omit `correct_answer`. `comprehension.test.js:37` is about rejecting submitted answer keys, not
     withholding them. This was not checked further.
   - Separately, `tests/m3StudentModuleDetail.test.ts:114` still checks that loading a learner module
     never touches `comprehension_question*` or `correct_answer`.
2. **Correction: the "7 orphaned CSS rules" were 7 classes in 16 rule blocks.** §Step 2 entries 5 and 7
   listed class names. `StudentModuleViewPage.css` had 6 blocks (`.basa-passage-questions` and 4
   descendant rules, plus `.basa-question-category`); `module3.css` had 10, including the combined
   `.m3-module-file-upload .m3-inline-notice, …` rule. All were deleted. The base notice and message
   rules were not touched.
3. **Two extra removals were required by `noUnusedLocals`.** Deleting `getAdminModuleExtractionError`
   left the `AdminModuleExtractionErrorResponse` interface and the `axios` value import unused, so both
   went (the file now imports only `type AxiosProgressEvent`). Deleting `getQuestions` left
   `PassageQuestion` unused in `modulePassageService.ts`'s import. The type itself is still used
   elsewhere.
4. **The editor tool drops a file's lone trailing CRLF.** `modulePassageService.ts` and
   `m3ModulePassages.test.ts` were LF except for a CRLF on their last line. Editing them turned that
   into LF. The byte was restored in the working copy. The committed blobs are unaffected, because
   `core.autocrlf=true` stores both as LF anyway. Keep comparing CR counts before committing; a
   `.gitattributes` (Step 1 entry 3) would end this.
5. **The learner-delivery browser script was syntax-checked, not run.** `c7b7f41` passed
   `node --check`. The script needs a running dev server, so the change was not exercised in a browser.

---

## Found during Step 6

Step 6 was done as commits `b57e36a` (item 1, the in-file `getAuthenticatedUser` helper), `f8c3772`
(item 2, the duplicated comment), `82e20c6` (item 4a, behavior tests), `7faaa47` (item 4b, the section
extraction) and `684d77d` (the `·` separator). Item 3 was skipped (entry 1). Unit tests went from 653 to
666 (+13, all in `82e20c6`); `test:m4` went from 67 to 80 and `test:m5` stayed at 67. No
`m4ActivityFeedback` or `m5M6*` test was edited. Nothing below was fixed in Step 6.

1. **Item 3 skipped: `AdminLearningRoomsPage` still queries `rooms` directly.** Owner decision. Moving
   the query would add an export to `classroomService.ts`, the file M5/M6 mock and import by name, for
   no change in behavior. `AdminLearningRoomsPage` also has no behavior test, so the move could not be
   checked. If it is done later, add a render test first and keep the query and its admin RLS context
   identical.
2. **`updateReadingActivityStatus` keeps its own `getUser()` copy.** D2 listed five copies; four now
   use `getAuthenticatedUser`. The fifth is in `updateReadingActivityStatus`, which is out of bounds
   for M4 because `ReadAloudPage` (M5) calls it. It throws the same `"User not authenticated."`, so
   moving it onto the helper is a one-line change, but it needs the M5/M6 owner's agreement.
3. **Correction: `classroomService.ts` has two imports, not one.** §1 D2 and §6 Step 6 speak of "the
   single `supabase` import". The file also imports `getProfileDisplayName` from
   `module1/utils/profileFields.ts`. Inside `tests/m4ActivityFeedback.test.ts`'s vm loader, every import
   resolves to `{ supabase }`, so `getProfileDisplayName` is `undefined` there. Those tests pass only
   because none of them calls `getRoomEnrollments`, its only user. A future test of `getRoomEnrollments`
   through that loader would fail for this reason, not because of the code under test.
4. **The new section components live in `ClassroomDetailsPage.tsx`, not in their own files.**
   `m4ActivityFeedback`'s `require` stub passes any import it does not recognize to Node's `require`,
   resolved from `tests/`, which cannot load a relative `.tsx` path. A page import such as
   `./ClassroomInfoSection` would break all of that file's page tests. Moving `ClassroomInfoSection`,
   `EnrolledStudentsSection` and `ModuleAssignmentSection` to their own files therefore needs the same
   harness replacement as splitting the activity list and form (§3, sections e and f).
5. **How "markup unchanged" was checked for 4b.** A one-off script, not committed, rendered the page
   before and after `7faaa47` with the fakes from `tests/m4ClassroomDetailsActions.test.ts`. It
   expanded child components and compared the element trees, with handlers reduced to placeholders, in
   13 states: view; edit open, typed, saved, and failed; student removed and removal failed; module
   form open, selected, empty-submit error, assigned, and failed; and the activity form open. All 13
   were identical. Run against `684d77d`, the same script reported the `?` → `·` change in every state,
   so it does detect differences; with that one character applied to the `7faaa47` copy, all 13 states
   matched again. It runs on the hook emulator, not in a browser, so CSS and layout were not
   compared. They were not touched: class strings were moved verbatim.
6. **The new tests render child components; `m4ActivityFeedback` still does not.**
   `m4ClassroomDetailsActions` expands function-type elements with a small `expand` helper in the test
   file and finds elements by visible text and `id`. If more tests need it, move `expand` into
   `tests/helpers/hookRuntime.ts`. `loadComponentModule` there now takes an optional `globals`
   argument; the existing M3 callers do not pass it.
7. **Line numbers for M4 in this document refer to commit `cd8c1f4`.** Step 6 shifted lines in
   `classroomService.ts` (−23) and `ClassroomDetailsPage.tsx` (+104, the three components sit above
   the page function). The old line 930 separator is now around line 1034. Re-locate M4 code by name.
