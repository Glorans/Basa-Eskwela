# M1 User Management ? local review

Base: verified GitHub main 06be051b0c35f35fbb8e333c649cf029d912aef1.
Branch: ui/m1-user-management-local.
Worktree: local isolated worktree (branch ui/m1-user-management-local).

## Review URLs and startup
Fixture UI preview: http://127.0.0.1:5178/fixture (running at delivery).
This preview renders the actual components with clearly synthetic example.test accounts and mocked services; actions never change a database or send email.
Restart from this worktree:
powershell -ExecutionPolicy Bypass -File ./start-m1-local.ps1 -Fixture

Real application: http://127.0.0.1:5174/system-admin/users
First start the existing local Supabase environment at 127.0.0.1:54321.
Then, from this worktree:
powershell -ExecutionPolicy Bypass -File ./start-m1-local.ps1
The launcher uses the existing server.local.env, disables the M7 background worker, starts this worktree's backend at 5002 and frontend at 5174. It does not apply SQL. Local Supabase was unavailable during delivery; real login, live counts and email delivery were not exercised.
The ignored readflow/.env.local points only at local Supabase and the local backend. Installed dependencies are reused through node_modules junctions; no dependency files were edited.

## Behavior
Three category cards use the single existing getManagedAccounts response. Counts include active and deactivated records and are independent of list filters. Switching categories does not fetch again.
School Accounts separates School Admins, Teachers and Students. Only authorized School Admin rows have status actions; Teacher/Student rows say Managed by School Admin.
Independent Learner Accounts reuses the existing status handler. Performance analytics remains in its existing sidebar entry.
All Registered Users retains search, role/status filters and account details.
Create School Admin remains at /system-admin/school-admins/new, using the unchanged creation service, endpoint, validation, permissions and password setup flow. Navigation now comes from School Accounts, with a return link.
M3 navigation, backend authorization, Auth-ban behavior, SQL and learning records are unchanged.

## Exact source/test/document changes
- readflow/src/modules/module1/pages/admin/UserManagementPage.tsx
- readflow/src/modules/module1/pages/admin/UserManagementCategories.css (new)
- readflow/src/modules/module1/pages/admin/CreateSchoolAdminPage.tsx
- readflow/src/modules/module3/components/M3Layout.tsx
- readflow/tests/m1FiveRoles.test.ts
- readflow/tests/systemAdminTheme.test.ts
- readflow/tests/userManagementFilters.test.ts
- readflow/tests/browser/m1UserManagement.mjs (new)
- start-m1-local.ps1 (new)
- docs/M1_USER_MANAGEMENT_LOCAL_REVIEW.md (new)

Local-only generated items: .tmp/m1-review screenshots, preview logs, readflow/dist, readflow/.env.local and dependency junctions. No shared stylesheet content changes.
The outdated filter-service test rejected every PATCH, including the approved status endpoint; it now rejects role-update endpoints while the status-boundary tests verify PATCH payloads.

## Verification
- 49 frontend tests passed: m1FiveRoles, systemAdminTheme, m1AccountDeactivation, userManagementFilters.
- 31 backend tests passed: adminUsers, m1AdminSeparation, m1AccountDeactivation, m1FiveRoles.
- Browser component checks passed at 320, 390, 768 and 1366px: counts/grouping, school/independent/all navigation, no repeated list request, status transitions, Teacher/Student view-only, filters/search, create validation/success/error/direct route, School Admin actions, empty states, keyboard link activation and no page overflow.
- Desktop and mobile screenshots visually inspected.
- TypeScript application and node configurations passed; Vite production build passed (existing bundle-size and mixed-import warnings).
- Protected shared UI stylesheet and other-role layout snapshots passed.
- git diff --check passed.
- Fixture preview returned HTTP 200.

SAFE FOR LOCAL REVIEW: UI and fixture behavior. Real local-account acceptance still requires the existing local Supabase stack to be started.
No commit, push, merge, deployment, SQL application, account creation or database mutation was performed.
