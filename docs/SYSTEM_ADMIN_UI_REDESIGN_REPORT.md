System Admin UI redesign ? November 18, 2026

**SAFE FOR LOCAL REVIEW.** All changes remain uncommitted in the existing `feat/m3-system-admin` worktree. Existing M1/M3/M7 work was preserved. This report covers only the redesign delta, not the earlier uncommitted functionality work.

**Snapshot before editing**

A local snapshot outside the repository (not published).

It holds the tracked and untracked source files, SHA-256 fingerprints, the change patch, the Git status and the original M3Layout used as the regression baseline. Ignored dependency/build/cache files were not archived.

**Pages and presentation**

- System Admin shell: forest-green sidebar, readable white links, restrained active indicator, original Basa Eskwela mascot, bottom Logout, minimal white header with only the existing profile/Settings dropdown (and the menu button on smaller screens).
- M1 User Management, Create School Admin and Settings: consistent typography, green actions, white surfaces, restrained borders and readable inputs/tables.
- M3 list/create/detail/edit, materials/upload and question review: the same existing components and workflows with scoped card, control, badge and confirmation-dialog styling. No duplicated editors or mutations.
- M7 Platform Analytics and Independent Learner list/individual performance: consistent summary cards, filters and tables. A new two-series weekly bar chart plots the existing API readings/completed-quiz counts for up to eight recorded weeks; the existing table remains. Empty data produces no chart. No data fetching or scoring/aggregation calculation was changed.
- Responsive treatment retains the shared sidebar controller, drawer focus behavior, desktop collapse, local table scrolling and keyboard-visible focus. Narrow layouts use stacked panels and compact header/account controls. Destructive actions retain a restrained red distinction.

**Exact files changed for this redesign**

Modified existing files:
- `readflow/src/modules/module3/components/M3Layout.tsx` ? conditional System Admin theme class, branding and page-title component only.
- `readflow/src/components/ReadFlowDialog.tsx` ? opt-in theme marker on the separately mounted dialog host only when the System Admin shell exists; confirmation/cancel/focus logic retained.
- `readflow/src/modules/module7/SystemAdminAnalyticsPage.tsx` ? render the weekly activity chart from the existing data.

Added:
- `readflow/src/modules/system-admin/systemAdmin.css`
- `readflow/src/modules/system-admin/SystemAdminPageTitle.tsx` (later removed; see Later refinements)
- `readflow/src/modules/system-admin/SystemAdminActivityChart.tsx`
- `readflow/tests/systemAdminTheme.test.ts`
- `readflow/tests/fixtures/systemAdminRoleBaseline.json`
- `readflow/tests/fixtures/systemAdminProtectedUi.json`
- `readflow/tests/browser/systemAdminTheme.mjs`
- `docs/SYSTEM_ADMIN_UI_REDESIGN_REPORT.md`

**Role isolation and preserved behavior**

Every new stylesheet selector is rooted in `.system-admin-ui`; only System Admin receives that class. No global root tokens or existing stylesheet was edited. School Admin, Teacher and Independent Learner shell render fingerprints match the pre-edit snapshot in desktop, collapsed, mobile-closed and mobile-open states. Student shell/header/sidebar, shared ProfileDropdown/SidebarLogout/sidebar controller and all 61 existing stylesheets match normalized pre-edit file hashes (67 protected files total).

The headless CSS tests compare computed styles and element geometry before/after adding the opt-in styles for all four unaffected role fixtures at 390, 768, 1024 and 1440 pixels. No differences were found. Existing navigation, Settings targets, Logout placement, active-link behavior and confirmation cancellation pass focused regression checks.

Snapshot comparison confirms no changes to backend files, SQL, API services, permissions, scoring or privacy logic. No SQL was applied or prepared for this redesign. Existing M3 SQL was not reapplied. M2/M5/M6 and Azure Speech remain untouched. No other worktree, launcher or VS Code task file was modified.

**Verification**

- 284/284 focused frontend tests passed: M3, M1 five-role routes, System Admin M7, authenticated layouts, profile/settings and the new theme/isolation tests.
- 28/28 new headless CSS fixtures passed: 16 other-role before/after comparisons and 12 System Admin analytics/editor/account page layouts across 390/768/1024/1440 pixels, with collapsed rail/mobile drawer checks and page/header overflow checks.
- 28/28 existing all-role responsive-overflow fixtures passed.
- TypeScript application and Vite config checks passed; production build passed. Existing bundle-size/mixed-import warnings remain.
- Screenshots reviewed for desktop analytics, mobile analytics and desktop editor; an inherited white-heading contrast problem was found, fixed within System Admin scope and regression-tested.
- `git diff --check` passed. Snapshot delta confirms only the three existing source files listed above changed.
- `http://127.0.0.1:5174` returned HTTP 200. The existing `Basa: Start M3 System Admin local dev` task/launcher is unchanged.

The browser checks are isolated CSS fixtures, with explicitly synthetic test content; they are not a signed-in live-account end-to-end run. Component tests cover route wiring, reused editing/publishing flows, dialogs and existing account controls. No live account was created/deleted, no module published and no real user logged out. Native/connected browser control was unavailable in this session. Review the actual authenticated pages through the existing VS Code Run Task before committing.

Screenshots (test fixtures only) were reviewed locally and are not part of the repository.

**Local review**

Use Terminal > Run Task > **Basa: Start M3 System Admin local dev**, then open `http://127.0.0.1:5174`. Sign in as System Admin and review M1, M3 and M7, the profile Settings dropdown, desktop collapse and the mobile drawer. Nothing was committed, pushed, merged or deployed.

**Later refinements (2026-11-18, same branch)**

- Original mascot restored; consistent dark-green Back links with an arrow icon.
- Redundant headings removed: no page title or "System administration" label in the top header, and no decorative "System Admin workspace" / "Admin library" labels. Each page shows its title once. `SystemAdminPageTitle.tsx` was deleted.
- Readability: darker secondary text (at least 7.3:1), input and control borders at least 3:1, visible card borders, a tinted Upload / Extract section, disabled buttons shown grey with a dashed border (not by colour alone), and errors marked with a bar and bolder text. Checked by `readflow/tests/browser/systemAdminContrast.mjs` on the real editor markup.
- Add Passage Below: a solid green circular button beside each passage card's upper-right edge (inside the card on phones), with a tooltip on hover and keyboard focus.
